import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, logActivity, AuthError, type SessionUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { handleError } from "@/lib/api";
import { isAdmin } from "@/lib/access";

const PatchSchema = z.object({ status: z.enum(["active", "disabled"]) });

/** Non-admins may only act on links they created. Throws 403 otherwise. */
async function assertOwns(actor: SessionUser, linkId: string) {
  if (isAdmin(actor)) return;
  const { data: link } = await supabaseAdmin().from("share_links").select("created_by").eq("id", linkId).single();
  if (!link || link.created_by !== actor.id) throw new AuthError(403, "Forbidden");
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireRole("bd_manager");
    const { id } = await ctx.params;
    await assertOwns(actor, id);
    const body = PatchSchema.parse(await req.json());
    const { error } = await supabaseAdmin().from("share_links").update({ status: body.status }).eq("id", id);
    if (error) throw new Error(error.message);
    await logActivity(actor.id, "share_link_updated", { type: "share_link", id, detail: { status: body.status } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireRole("bd_manager");
    const { id } = await ctx.params;
    await assertOwns(actor, id);
    const { error } = await supabaseAdmin().from("share_links").delete().eq("id", id);
    if (error) throw new Error(error.message);
    await logActivity(actor.id, "share_link_deleted", { type: "share_link", id });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
