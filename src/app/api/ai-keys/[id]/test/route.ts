// "Test" button in AI Control: sends one tiny request with this key to the first
// model in the chain and reports ok / quota / rate limit / rejected, with timing.
import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { handleError } from "@/lib/api";
import { getAiKeyForTest, getAiSettings, modelList } from "@/lib/ai-keys";
import { geminiSession, groqSession, ProviderError } from "@/lib/assistant/providers";

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireRole("admin");
    const { id } = await ctx.params;
    const k = await getAiKeyForTest(id);
    if (!k) return NextResponse.json({ error: "Key not found." }, { status: 404 });
    const settings = await getAiSettings();
    const model = k.provider === "gemini" ? modelList(settings.gemini_model)[0] : settings.groq_model;
    const make = k.provider === "gemini" ? geminiSession : groqSession;
    const s = make(model, k.key, "Reply with the single word OK.", [], "Say OK.", []);
    const t0 = Date.now();
    try {
      await s.send();
      return NextResponse.json({ ok: true, model, ms: Date.now() - t0 });
    } catch (e) {
      const pe = e instanceof ProviderError ? e : new ProviderError(String(e), "error");
      return NextResponse.json({ ok: false, model, ms: Date.now() - t0, code: pe.code, error: pe.message });
    }
  } catch (e) {
    return handleError(e);
  }
}
