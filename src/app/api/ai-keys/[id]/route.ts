import { NextRequest, NextResponse } from "next/server";
import { requireRole, logActivity } from "@/lib/auth";
import { handleError } from "@/lib/api";
import { revokeAiKey } from "@/lib/ai-keys";

// DELETE: remove a key. Admin only.
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireRole("admin");
    const { id } = await ctx.params;
    await revokeAiKey(id);
    await logActivity(actor.id, "ai_key_deleted", { type: "ai_key", id });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
