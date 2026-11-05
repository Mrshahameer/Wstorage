// AI intent layer for the Search Assistant. Turns a natural-language query into
// structured search intent. Rotates across the admin's keys and fails over
// Gemini <-> Groq. If no key works, falls back to a deterministic parser so the
// assistant never goes down. SERVER ONLY.
import { getAiSettings, pickKey, markKeyUsed, coolDownKey, type AiProvider } from "@/lib/ai-keys";

export interface Intent {
  mode: "search" | "answer";
  category: string | null;
  vertical: string | null;
  campaign: string | null;
  asset_type: string | null;
  keywords: string[];
  reply: string | null;
}

export interface ParseResult {
  intent: Intent;
  usedAI: boolean;
  provider: AiProvider | null;
}

function systemPrompt(taxonomy: string, facts: string): string {
  return [
    "You are the Wstorage assistant for a marketing-asset library.",
    "You help users find campaign folders and assets, AND answer questions about the library.",
    "",
    "Decide the mode:",
    "- mode 'answer': the user asks a question you can answer from the Library facts below",
    "  (how many campaigns, what verticals exist, list categories, overviews, counts, yes/no).",
    "  Put the full answer in reply, using the real numbers and names. Set keywords to [].",
    "- mode 'search': the user wants to find or open a specific campaign, folder, or asset.",
    "  Fill vertical/campaign/asset_type/keywords. reply is one short line of what you are finding.",
    "",
    "Map synonyms: car insurance = auto insurance, live calls = live transfer,",
    "old leads = aged leads, ads/banners/images = creatives, call scripts = agent scripts.",
    "If the message is unrelated to this library, set mode 'answer', keywords [], and politely",
    "redirect in reply. Stay professional and concise. Never invent folders, numbers, or links.",
    "",
    "Library facts (the current real data):",
    facts,
    "",
    "Taxonomy (categories > verticals, plus campaign types):",
    taxonomy,
    "",
    'Return ONLY JSON: {"mode":"search"|"answer","category":string|null,"vertical":string|null,',
    '"campaign":string|null,"asset_type":string|null,"keywords":string[],"reply":string|null}.',
  ].join("\n");
}

type ChatTurn = { role: "user" | "assistant"; content: string };

function normalize(raw: unknown): Intent {
  const o = (raw ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const kws = Array.isArray(o.keywords) ? o.keywords.filter((k): k is string => typeof k === "string").slice(0, 20) : [];
  return {
    mode: o.mode === "answer" ? "answer" : "search",
    category: str(o.category),
    vertical: str(o.vertical),
    campaign: str(o.campaign),
    asset_type: str(o.asset_type),
    keywords: kws,
    reply: str(o.reply),
  };
}

function extractJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(t);
  } catch {
    const s = t.indexOf("{");
    const e = t.lastIndexOf("}");
    if (s >= 0 && e > s) {
      try { return JSON.parse(t.slice(s, e + 1)); } catch { /* fall through */ }
    }
    return {};
  }
}

class RateLimit extends Error {}

async function callGemini(model: string, key: string, query: string, history: ChatTurn[], sys: string): Promise<unknown> {
  const contents = [
    ...history.slice(-6).map((t) => ({ role: t.role === "assistant" ? "model" : "user", parts: [{ text: t.content }] })),
    { role: "user", parts: [{ text: query }] },
  ];
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: sys }] },
        contents,
        generationConfig: { responseMimeType: "application/json", temperature: 0.2, maxOutputTokens: 512 },
      }),
    }
  );
  if (res.status === 429) throw new RateLimit("gemini rate limit");
  if (!res.ok) throw new Error(`gemini ${res.status}`);
  const j = await res.json();
  const text = j?.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
  return extractJson(text);
}

async function callGroq(model: string, key: string, query: string, history: ChatTurn[], sys: string): Promise<unknown> {
  const messages = [
    { role: "system", content: sys },
    ...history.slice(-6).map((t) => ({ role: t.role, content: t.content })),
    { role: "user", content: query },
  ];
  // Note: no response_format. Some Groq models (gpt-oss) reject strict JSON mode;
  // the prompt asks for JSON only and extractJson tolerates fences / stray text.
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.2,
      max_tokens: 512,
    }),
  });
  if (res.status === 429) throw new RateLimit("groq rate limit");
  if (!res.ok) throw new Error(`groq ${res.status}`);
  const j = await res.json();
  const text = j?.choices?.[0]?.message?.content ?? "{}";
  return extractJson(text);
}

/** Parse a query into intent, trying the admin's AI keys with failover, else deterministic. */
export async function parseIntent(query: string, history: ChatTurn[], taxonomy: string, facts: string): Promise<ParseResult> {
  const sys = systemPrompt(taxonomy, facts);
  let settings;
  try {
    settings = await getAiSettings();
  } catch {
    settings = { provider_order: ["gemini", "groq"] as AiProvider[], enabled: true, gemini_model: "gemini-flash-latest", groq_model: "openai/gpt-oss-120b" };
  }

  if (settings.enabled) {
    for (const provider of settings.provider_order) {
      // Try several keys of this provider; each rate-limited key is skipped next time.
      for (let attempt = 0; attempt < 8; attempt++) {
        let picked: { id: string; key: string } | null = null;
        try {
          picked = await pickKey(provider);
        } catch {
          picked = null; // table missing or DB error -> treat as no keys
        }
        if (!picked) break;
        try {
          const raw = provider === "gemini"
            ? await callGemini(settings.gemini_model, picked.key, query, history, sys)
            : await callGroq(settings.groq_model, picked.key, query, history, sys);
          await markKeyUsed(picked.id);
          return { intent: normalize(raw), usedAI: true, provider };
        } catch (e) {
          // Rate-limited: long cooldown. Other errors (incl. 503 overload): short cooldown, try next key/provider.
          await coolDownKey(picked.id, e instanceof RateLimit ? 90 : 15);
        }
      }
    }
  }

  return { intent: deterministicIntent(query), usedAI: false, provider: null };
}

// ---- Deterministic fallback -------------------------------------------------
const STOP = new Set([
  "the", "a", "an", "and", "or", "for", "of", "to", "in", "on", "me", "i", "need",
  "want", "find", "get", "show", "some", "please", "my", "with", "give", "looking",
  "search", "campaign", "folder", "asset", "assets", "file", "files",
]);
const SYNONYMS: Record<string, string[]> = {
  "auto insurance": ["car insurance", "vehicle insurance", "auto"],
  "live transfer": ["live calls", "warm transfer", "live", "transfers"],
  "aged leads": ["old leads", "historical leads", "aged"],
  "creatives": ["ads", "banners", "images", "creative"],
  "agent scripts": ["call scripts", "sales scripts", "scripts"],
  "landing pages": ["landers", "lp", "landing"],
  "call recording": ["recordings", "verification recordings", "recording"],
};

/** Expand a query with known synonyms (used by both the parser and the search). */
export function expandTerms(text: string): string[] {
  const low = text.toLowerCase();
  const out = new Set<string>();
  for (const w of low.split(/[^a-z0-9]+/).filter((w) => w && !STOP.has(w))) out.add(w);
  for (const [canonical, alts] of Object.entries(SYNONYMS)) {
    if (low.includes(canonical) || alts.some((a) => low.includes(a))) {
      canonical.split(" ").forEach((w) => out.add(w));
    }
  }
  return Array.from(out);
}

/** Does the query look like a question about the library rather than a search? */
export function looksLikeQuestion(query: string): boolean {
  return /\b(how many|how much|count|total|number of|list|what('| i)?s|which|do we have|are there|overview|summary|show me all)\b/i.test(query);
}

function deterministicIntent(query: string): Intent {
  return {
    mode: looksLikeQuestion(query) ? "answer" : "search",
    category: null,
    vertical: null,
    campaign: null,
    asset_type: null,
    keywords: expandTerms(query),
    reply: null,
  };
}
