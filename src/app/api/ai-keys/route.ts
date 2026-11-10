import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, logActivity } from "@/lib/auth";
import { handleError } from "@/lib/api";
import { listAiKeys, addAiKey, getAiSettings, setAiSettings, AI_PROVIDERS, modelList } from "@/lib/ai-keys";
import { aiUsage, recentFeedback } from "@/lib/assistant/log";

// GET: list keys (no secrets) + settings. Admin only.
export async function GET() {
  try {
    await requireRole("admin");
    const [keys, settings, usage, feedback] = await Promise.all([listAiKeys(), getAiSettings(), aiUsage(), recentFeedback(15)]);
    // usage / feedback are null until migration 0009 is run.
    return NextResponse.json({ keys, settings, chain: modelList(settings.gemini_model), usage, feedback });
  } catch (e) {
    return handleError(e);
  }
}

// One key, or many pasted one per line (or comma separated). Each becomes its
// own row, labeled "<label> 1", "<label> 2"… so they rotate independently.
const AddSchema = z.object({
  provider: z.enum(["gemini", "groq"]),
  label: z.string().min(1).max(80),
  apiKey: z.string().min(10).max(20000),
});

// POST: add a key. Admin only.
export async function POST(req: NextRequest) {
  try {
    const actor = await requireRole("admin");
    const body = AddSchema.parse(await req.json());
    const raw = Array.from(new Set(body.apiKey.split(/[\s,]+/).map((k) => k.trim()).filter((k) => k.length >= 10)));
    if (!raw.length) return NextResponse.json({ error: "No valid key found in what you pasted." }, { status: 400 });
    if (raw.length > 50) return NextResponse.json({ error: "Add at most 50 keys at a time." }, { status: 400 });
    const added = [];
    for (let i = 0; i < raw.length; i++) {
      const label = raw.length > 1 ? `${body.label} ${i + 1}` : body.label;
      const key = await addAiKey(body.provider, label, raw[i], actor.id);
      added.push(key);
      await logActivity(actor.id, "ai_key_added", { type: "ai_key", id: key.id, detail: { provider: body.provider, label } });
    }
    return NextResponse.json({ key: added[0], added: added.length });
  } catch (e) {
    return handleError(e);
  }
}

const SettingsSchema = z.object({
  provider_order: z.array(z.enum(["gemini", "groq"])).min(1).optional(),
  enabled: z.boolean().optional(),
  gemini_model: z.string().min(1).max(100).optional(),
  groq_model: z.string().min(1).max(100).optional(),
});

// PATCH: update provider order / enabled. Admin only.
export async function PATCH(req: NextRequest) {
  try {
    const actor = await requireRole("admin");
    const body = SettingsSchema.parse(await req.json());
    // De-dupe provider order and keep only known providers.
    const order = body.provider_order
      ? Array.from(new Set(body.provider_order)).filter((p) => AI_PROVIDERS.includes(p))
      : undefined;
    await setAiSettings({ provider_order: order, enabled: body.enabled, gemini_model: body.gemini_model, groq_model: body.groq_model });
    await logActivity(actor.id, "ai_settings_updated", { type: "ai_settings" });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
