// The tool-calling loop. The model reads the catalog, decides which tools to
// call, the server runs them, and the model writes the reply. Fails over across
// keys and models; when every option fails it reports exactly why, so the chat
// can say "quota used up" instead of silently switching to keyword mode.
import { ProviderError, type ChatTurn, type FailCode, type Session } from "./providers";
import { summarizeSections, type ToolCall, type ToolOutcome } from "./tools";
import type { Section } from "./types";

export type Provider = "gemini" | "groq";

export interface CallLog {
  provider: Provider;
  model: string;
  keyId: string;
  status: "ok" | FailCode;
  http?: number;
  latencyMs: number;
  round: number;
  error?: string;
}

export interface AgentDeps {
  order: Provider[];
  models(p: Provider): string[];
  pickKey(p: Provider): Promise<{ id: string; key: string } | null>;
  markKeyUsed(id: string): Promise<void>;
  coolDownKey(id: string, seconds: number): Promise<void>;
  session(p: Provider, model: string, key: string, system: string, history: ChatTurn[], user: string): Session;
  runTool(call: ToolCall): Promise<ToolOutcome>;
  log(entry: CallLog): void;
  now?: () => number;
}

// One flat shape (this repo compiles non-strict, where unions do not narrow):
// ok=true carries the reply; ok=false carries code + reason.
export interface AgentResult {
  ok: boolean;
  reply?: string;
  sections?: Section[];
  provider?: Provider;
  model?: string;
  steps?: number;
  code?: string;
  reason?: string;
}

const MAX_ROUNDS = 3;
const MAX_CALLS_PER_ROUND = 6;
const DEADLINE_MS = 40_000;

// Free-tier quota is per key AND per model, so remember exhausted pairs (per
// server instance) and skip them instead of paying a failed call each time.
const pairCooldown = new Map<string, number>();
const pairReason = new Map<string, string>();
export function resetCooldowns() { pairCooldown.clear(); pairReason.clear(); }

const REASONS: Record<string, string> = {
  quota: "The daily AI quota is used up on every key and model. Gemini resets at midnight Pacific time. Add another key in AI Control to keep going.",
  rate_limited: "The AI is getting too many requests per minute. Try again in a minute.",
  overloaded: "Google's AI service is overloaded right now.",
  timeout: "The AI took too long to answer.",
  auth: "An AI key was rejected. Check the keys in AI Control.",
  bad_output: "The AI returned an unusable answer.",
  error: "The AI request failed.",
  no_keys: "No AI keys are set up in AI Control.",
};
const PRIORITY: string[] = ["auth", "overloaded", "rate_limited", "timeout", "bad_output", "error", "quota"];

function dedupe(sections: Section[]): Section[] {
  const seen = new Set<string>();
  return sections.filter((s) => { const k = `${s.kind}|${s.label}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

async function converse(p: Provider, model: string, k: { id: string; key: string }, system: string, history: ChatTurn[], user: string, deps: AgentDeps) {
  const now = deps.now ?? Date.now;
  const session = deps.session(p, model, k.key, system, history, user);
  const sections: Section[] = [];
  let steps = 0;
  let lastText: string | null = null;
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const t0 = now();
    let turn;
    try {
      turn = await session.send();
      deps.log({ provider: p, model, keyId: k.id, status: "ok", http: 200, latencyMs: now() - t0, round });
    } catch (e) {
      const pe = e instanceof ProviderError ? e : new ProviderError(String(e), "error");
      deps.log({ provider: p, model, keyId: k.id, status: pe.code, http: pe.http, latencyMs: now() - t0, round, error: pe.message });
      // Tools already ran: keep the real results and write the reply ourselves.
      if (sections.length) return { reply: summarizeSections(dedupe(sections)), sections: dedupe(sections), steps };
      throw pe;
    }
    steps++;
    lastText = turn.text;
    if (!turn.calls.length) return { reply: turn.text ?? summarizeSections(dedupe(sections)), sections: dedupe(sections), steps };
    const calls = turn.calls.slice(0, MAX_CALLS_PER_ROUND);
    const outs = await Promise.all(calls.map((c) => deps.runTool(c)));
    outs.forEach((o) => sections.push(...o.sections));
    session.addResults(calls.map((c, i) => ({ id: c.id, name: c.name, result: outs[i].forModel })));
  }
  return { reply: lastText ?? summarizeSections(dedupe(sections)), sections: dedupe(sections), steps };
}

export async function runAgent(system: string, history: ChatTurn[], user: string, deps: AgentDeps): Promise<AgentResult> {
  const now = deps.now ?? Date.now;
  const start = now();
  const codes: string[] = [];
  let sawKey = false;

  for (const p of deps.order) {
    const models = deps.models(p);
    const tried = new Set<string>();
    for (let i = 0; i < 8; i++) {
      if (now() - start > DEADLINE_MS) { codes.push("timeout"); break; }
      let k: { id: string; key: string } | null = null;
      try { k = await deps.pickKey(p); } catch { k = null; }
      if (!k || tried.has(k.id)) break;
      tried.add(k.id);
      sawKey = true;

      const keyCodes: string[] = [];
      for (const model of models) {
        const pair = `${k.id}|${model}`;
        if ((pairCooldown.get(pair) ?? 0) > now()) { keyCodes.push(pairReason.get(pair) ?? "quota"); continue; }
        if (now() - start > DEADLINE_MS) { keyCodes.push("timeout"); break; }
        try {
          const r = await converse(p, model, k, system, history, user, deps);
          await deps.markKeyUsed(k.id).catch(() => {});
          return { ok: true, ...r, provider: p, model };
        } catch (e) {
          const code = e instanceof ProviderError ? e.code : "error";
          keyCodes.push(code);
          pairReason.set(pair, code);
          // Circuit breaker: skip a model that is out of quota, rate limited,
          // overloaded or hanging, instead of paying for the same failure again.
          if (code === "quota") pairCooldown.set(pair, now() + 60 * 60_000);
          if (code === "rate_limited") pairCooldown.set(pair, now() + 60_000);
          if (code === "overloaded" || code === "timeout") pairCooldown.set(pair, now() + 2 * 60_000);
          if (code === "auth") break; // a rejected key fails for every model
        }
      }
      codes.push(...keyCodes);
      const seconds = keyCodes.includes("auth") ? 600 : keyCodes.every((c) => c === "quota") ? 600 : keyCodes.includes("rate_limited") ? 60 : 15;
      await deps.coolDownKey(k.id, seconds).catch(() => {});
    }
  }

  if (!sawKey) return { ok: false, code: "no_keys", reason: REASONS.no_keys };
  const code = codes.every((c) => c === "quota") ? "quota" : PRIORITY.find((c) => codes.includes(c)) ?? "error";
  return { ok: false, code, reason: REASONS[code] ?? REASONS.error };
}

export function systemPrompt(catalog: string, today: string): string {
  return [
    "You are the assistant inside Wstorage, the marketing-asset library of a lead-generation team (insurance, home services, web leads).",
    "Talk like a sharp, friendly teammate. Keep replies to one to three short sentences. Answer the actual question first.",
    "Do not end with a stock offer like 'What else can I help with?'. Never repeat a sentence you already said.",
    "Write plain sentences: no markdown, no headings, no bullet lists, no bold. Never show catalog REF codes (like C12) to the user; name campaigns instead.",
    "",
    "You can see the full catalog of what this user can access, below. Use it:",
    "- Questions about what exists, counts, lists, overviews, or what a vertical or campaign has: answer directly from the catalog. No tool needed.",
    "- When the user wants actual assets (files, links, landing pages, recordings, creatives, previews, downloads): call get_assets with exact campaign REFs and exact folder names from the catalog. One item per campaign + folder asked for. A message that asks for several things gets several items in ONE call.",
    "- If they name a vertical or campaign type and several campaigns match, include each matching campaign (up to 6). If it is truly unclear what they want, ask one short question instead of guessing.",
    "- Request every part the user asked for, even when the catalog shows that folder has no files, so the app can show it as empty instead of silently leaving it out.",
    "- Which campaigns lack an asset: call find_missing. A file by its name or tag: call search_files. To show campaigns as clickable cards: call show_campaigns.",
    "- Only use REFs and folder names that appear in the catalog. Never invent files, links, numbers, dates or names.",
    "- After tools return, reply briefly with what you found for each part, and say plainly when something was empty or not found. Do not list every file name; the app already shows the files with their dates, tags and links.",
    "- Questions unrelated to this library: one polite line saying what you can help with.",
    "",
    "Common phrasings: lander, LP = Landing Pages. Ads, ad previews, banners, images = Creatives. Call recordings, recordings = Verification Recordings. Call scripts, scripts = Agent Scripts. Samples, lead data = Data Samples. TCPA, compliance, consent = TCPA & Compliance. Car insurance = Auto Insurance. Inbound = Pure Inbound. LT = Live Transfer. WT = Warm Transfer. Map these to the closest real names in the catalog.",
    `Today is ${today}.`,
    "",
    "CATALOG",
    catalog,
  ].join("\n");
}
