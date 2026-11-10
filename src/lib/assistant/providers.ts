// Native tool calling for each AI provider. A Session holds one conversation in
// the provider's own format: send() returns either text or tool calls, and
// addResults() hands tool output back for the next round. SERVER ONLY.
import type { ToolCall } from "./tools";

export type FailCode = "quota" | "rate_limited" | "overloaded" | "timeout" | "auth" | "bad_output" | "error";

export class ProviderError extends Error {
  constructor(message: string, public code: FailCode, public http?: number) {
    super(message);
  }
}

export interface Turn {
  text: string | null;
  calls: ToolCall[];
}
export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}
export interface ToolDecl {
  name: string;
  description: string;
  parameters: object;
}
export interface Session {
  send(): Promise<Turn>;
  addResults(results: { id?: string; name: string; result: unknown }[]): void;
}

const TIMEOUT_MS = 15_000; // a hung model fails fast so the next one can answer

async function post(url: string, headers: Record<string, string>, body: unknown) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* keep raw text */ }
    return { status: res.status, json, text };
  } catch (e) {
    if ((e as Error).name === "AbortError") throw new ProviderError("the model took too long to answer", "timeout");
    throw new ProviderError((e as Error).message, "error");
  } finally {
    clearTimeout(timer);
  }
}

/** Turn an HTTP failure into a reason the UI can show plainly. */
export function classify(status: number, raw: string): ProviderError {
  let msg = raw;
  try { msg = JSON.parse(raw)?.error?.message ?? raw; } catch { /* raw text */ }
  msg = String(msg).slice(0, 300);
  if (status === 429) {
    const daily = /per ?day|perday|daily|\bRPD\b|\bTPD\b/i.test(raw);
    return new ProviderError(msg, daily ? "quota" : "rate_limited", status);
  }
  if (status === 401 || status === 403 || /api key not valid|invalid api key|api_key_invalid/i.test(raw)) return new ProviderError(msg, "auth", status);
  if (status >= 500) return new ProviderError(msg, "overloaded", status);
  return new ProviderError(msg, "error", status);
}

/** Providers want a clean user/assistant alternation that starts with the user. */
function tidy(history: ChatTurn[]): ChatTurn[] {
  const out: ChatTurn[] = [];
  for (const h of history) {
    if (!h.content.trim()) continue;
    if (!out.length && h.role === "assistant") continue;
    const last = out[out.length - 1];
    if (last && last.role === h.role) last.content += `\n${h.content}`;
    else out.push({ role: h.role, content: h.content });
  }
  if (out.length && out[out.length - 1].role === "user") out.pop(); // the new message follows
  return out;
}

export function geminiSession(model: string, key: string, system: string, history: ChatTurn[], user: string, tools: ToolDecl[]): Session {
  const contents: any[] = [
    ...tidy(history).map((h) => ({ role: h.role === "assistant" ? "model" : "user", parts: [{ text: h.content }] })),
    { role: "user", parts: [{ text: user }] },
  ];
  return {
    async send() {
      const r = await post(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        { "x-goog-api-key": key },
        {
          system_instruction: { parts: [{ text: system }] },
          contents,
          ...(tools.length ? { tools: [{ functionDeclarations: tools }], toolConfig: { functionCallingConfig: { mode: "AUTO" } } } : {}),
          generationConfig: { temperature: 0.2, maxOutputTokens: 2048 },
        },
      );
      if (r.status !== 200) throw classify(r.status, r.text);
      const cand = r.json?.candidates?.[0];
      const parts: any[] = cand?.content?.parts ?? [];
      const calls: ToolCall[] = parts
        .filter((p) => p.functionCall)
        .map((p) => ({ id: p.functionCall.id, name: String(p.functionCall.name), args: p.functionCall.args ?? {} }));
      const text = parts.filter((p) => typeof p.text === "string" && !p.thought).map((p) => p.text).join("").trim() || null;
      if (!calls.length && !text) {
        throw new ProviderError(`empty answer (${cand?.finishReason ?? r.json?.promptFeedback?.blockReason ?? "no candidate"})`, "bad_output", 200);
      }
      contents.push(cand.content); // verbatim, so Gemini 3 thought signatures carry into the next round
      return { text, calls };
    },
    addResults(results) {
      contents.push({
        role: "user",
        parts: results.map((x) => ({ functionResponse: { ...(x.id ? { id: x.id } : {}), name: x.name, response: { result: x.result } } })),
      });
    },
  };
}

export function groqSession(model: string, key: string, system: string, history: ChatTurn[], user: string, tools: ToolDecl[]): Session {
  const messages: any[] = [
    { role: "system", content: system },
    ...tidy(history).map((h) => ({ role: h.role, content: h.content })),
    { role: "user", content: user },
  ];
  return {
    async send() {
      const r = await post(
        "https://api.groq.com/openai/v1/chat/completions",
        { Authorization: `Bearer ${key}` },
        {
          model,
          messages,
          ...(tools.length ? { tools: tools.map((t) => ({ type: "function", function: t })), tool_choice: "auto" } : {}),
          temperature: 0.2,
          max_tokens: 2048,
        },
      );
      if (r.status !== 200) throw classify(r.status, r.text);
      const msg = r.json?.choices?.[0]?.message;
      if (!msg) throw new ProviderError("empty answer", "bad_output", 200);
      const tcs: any[] = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
      const calls: ToolCall[] = tcs.map((tc) => {
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(tc.function?.arguments || "{}"); } catch { /* leave empty */ }
        return { id: tc.id, name: String(tc.function?.name), args };
      });
      const text = typeof msg.content === "string" && msg.content.trim() ? msg.content.trim() : null;
      if (!calls.length && !text) throw new ProviderError("empty answer", "bad_output", 200);
      messages.push(tcs.length ? { role: "assistant", content: msg.content ?? "", tool_calls: tcs } : { role: "assistant", content: msg.content });
      return { text, calls };
    },
    addResults(results) {
      for (const x of results) messages.push({ role: "tool", tool_call_id: x.id, content: JSON.stringify(x.result) });
    },
  };
}
