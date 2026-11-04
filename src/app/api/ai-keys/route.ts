import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, logActivity } from "@/lib/auth";
import { handleError } from "@/lib/api";
import { listAiKeys, addAiKey, getAiSettings, setAiSettings, AI_PROVIDERS } from "@/lib/ai-keys";

// GET: list keys (no secrets) + settings. Admin only.
export async function GET() {
  try {
    await requireRole("admin");
    const [keys, settings] = await Promise.all([listAiKeys(), getAiSettings()]);
    return NextResponse.json({ keys, settings });
  } catch (e) {
    return handleError(e);
  }
}

const AddSchema = z.object({
  provider: z.enum(["gemini", "groq"]),
  label: z.string().min(1).max(80),
  apiKey: z.string().min(10),
});

// POST: add a key. Admin only.
export async function POST(req: NextRequest) {
  try {
    const actor = await requireRole("admin");
    const body = AddSchema.parse(await req.json());
    const key = await addAiKey(body.provider, body.label, body.apiKey.trim(), actor.id);
    await logActivity(actor.id, "ai_key_added", { type: "ai_key", id: key.id, detail: { provider: body.provider, label: body.label } });
    return NextResponse.json({ key });
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
