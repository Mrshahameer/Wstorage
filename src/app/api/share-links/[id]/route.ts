import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, logActivity } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { handleError } from "@/lib/api";

const PatchSchema = z.object({ status: z.enum(["active", "disabled"]) });

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireRole("admin");
    const { id } = await ctx.params;
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
    const actor = await requireRole("admin");
    const { id } = await ctx.params;
    const { error } = await supabaseAdmin().from("share_links").delete().eq("id", id);
    if (error) throw new Error(error.message);
    await logActivity(actor.id, "share_link_deleted", { type: "share_link", id });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
