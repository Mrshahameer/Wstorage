// AI Search Assistant endpoint. The model reads the user's catalog and calls
// tools that run real queries. If no model is reachable, keyword mode answers
// from the same catalog and tools. Every reply says which path produced it.
import { NextRequest, NextResponse, after } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { handleError } from "@/lib/api";
import { getAiSettings, pickKey, markKeyUsed, coolDownKey, modelList } from "@/lib/ai-keys";
import { catalogText } from "@/lib/assistant/catalog";
import { loadCatalog, supabaseFileSource } from "@/lib/assistant/data";
import { runAgent, systemPrompt, type CallLog, type Provider } from "@/lib/assistant/agent";
import { geminiSession, groqSession, type ChatTurn } from "@/lib/assistant/providers";
import { runTool, summarizeSections, TOOL_DECLARATIONS, type ToolCall } from "@/lib/assistant/tools";
import { planFallback } from "@/lib/assistant/fallback";
import { saveCallLogs } from "@/lib/assistant/log";
import { MAX_QUERY_CHARS, type AssistantResponse, type Section } from "@/lib/assistant/types";

export const maxDuration = 60;

const Body = z.object({
  query: z
    .string()
    .trim()
    .min(1, "Type a message first.")
    .max(MAX_QUERY_CHARS, `That message is too long. Please keep it under ${MAX_QUERY_CHARS.toLocaleString()} characters.`),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() }))
    .max(40)
    .optional()
    .default([]),
});

// Plain chat text: strip markdown the bubble would show literally, and any
// internal catalog ref (C12) the model let slip.
const clean = (s: string) =>
  s
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/(^|\s)\*(\S.*?)\*/g, "$1$2")
    .replace(/`/g, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*•]\s+/gm, "")
    .replace(/\(\s*C\d{1,4}\s*\)\s?|\bC\d{1,4}\b\s*[–—:|-]\s*/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "That request was not valid." }, { status: 400 });
    }
    const { query } = parsed.data;
    const history: ChatTurn[] = parsed.data.history.slice(-10).map((h) => ({ role: h.role, content: h.content.slice(0, 2000) }));
    const t0 = Date.now();

    const catalog = await loadCatalog(user);
    const src = supabaseFileSource();
    const exec = (c: ToolCall) => runTool(c, catalog, src);
    const respond = (body: AssistantResponse) => NextResponse.json(body);

    let failure: { code: string; reason: string };
    let settings: Awaited<ReturnType<typeof getAiSettings>> | null = null;
    try { settings = await getAiSettings(); } catch { settings = null; }

    if (!settings) {
      failure = { code: "not_ready", reason: "AI is not set up yet. Run migration 0008 and add a key in AI Control." };
    } else if (!settings.enabled) {
      failure = { code: "disabled", reason: "AI is turned off in AI Control." };
    } else {
      const s = settings;
      const logs: CallLog[] = [];
      const r = await runAgent(systemPrompt(catalogText(catalog), new Date().toISOString().slice(0, 10)), history, query, {
        order: s.provider_order as Provider[],
        models: (p) => (p === "gemini" ? modelList(s.gemini_model) : [s.groq_model]),
        pickKey: (p) => pickKey(p),
        markKeyUsed,
        coolDownKey,
        session: (p, model, key, system, hist, u) =>
          p === "gemini" ? geminiSession(model, key, system, hist, u, TOOL_DECLARATIONS) : groqSession(model, key, system, hist, u, TOOL_DECLARATIONS),
        runTool: exec,
        log: (e) => logs.push(e),
      });
      after(() => saveCallLogs(user.id, logs)); // written after the reply is sent
      if (r.ok) {
        return respond({
          reply: clean(r.reply ?? "") || summarizeSections(r.sections ?? []),
          sections: r.sections ?? [],
          meta: { mode: "ai", provider: r.provider, model: r.model, steps: r.steps, ms: Date.now() - t0 },
        });
      }
      failure = { code: r.code ?? "error", reason: r.reason ?? "The AI request failed." };
    }

    // Keyword mode: same catalog, same tools, plainer wording.
    const plan = planFallback(catalog, query);
    let reply: string;
    let sections: Section[] = [];
    if (plan.kind === "answer") {
      reply = plan.reply;
      sections = plan.sections ?? [];
    } else {
      for (const call of plan.calls) sections.push(...(await exec(call)).sections);
      reply = summarizeSections(sections);
    }
    return respond({ reply, sections, meta: { mode: "keyword", ms: Date.now() - t0, reasonCode: failure.code, reason: failure.reason } });
  } catch (e) {
    return handleError(e);
  }
}
