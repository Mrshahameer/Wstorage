import { NextRequest, NextResponse } from "next/server";
import { requireRole, logActivity } from "@/lib/auth";
import { activateStorageKey, revokeStorageKey } from "@/lib/storage-keys";
import { handleError } from "@/lib/api";

export async function PATCH(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRole("admin");
    const { id } = await ctx.params;
    await activateStorageKey(id);
    await logActivity(user.id, "key_activated", { type: "storage_key", id });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRole("admin");
    const { id } = await ctx.params;
    await revokeStorageKey(id);
    await logActivity(user.id, "key_revoked", { type: "storage_key", id });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
