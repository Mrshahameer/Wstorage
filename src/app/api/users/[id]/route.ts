import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, logActivity } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { handleError } from "@/lib/api";

const PatchSchema = z.object({
  role: z.enum(["employee", "admin", "super_admin"]).optional(),
  isActive: z.boolean().optional(),
  folderIds: z.array(z.string().uuid()).optional(), // full replace of access
});

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireRole("super_admin");
    const { id } = await ctx.params;
    const body = PatchSchema.parse(await req.json());
    const db = supabaseAdmin();

    if (body.role || body.isActive !== undefined) {
      const patch: Record<string, unknown> = {};
      if (body.role) patch.role = body.role;
      if (body.isActive !== undefined) patch.is_active = body.isActive;
      await db.from("profiles").update(patch).eq("id", id);
    }

    if (body.folderIds) {
      // Replace this user's folder grants with the provided set.
      await db.from("folder_access").delete().eq("user_id", id);
      if (body.folderIds.length) {
        await db.from("folder_access").insert(
          body.folderIds.map((fid) => ({ user_id: id, folder_id: fid, granted_by: actor.id }))
        );
      }
    }

    await logActivity(actor.id, "user_updated", { type: "user", id });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireRole("super_admin");
    const { id } = await ctx.params;
    const db = supabaseAdmin();
    await db.auth.admin.deleteUser(id).catch(() => {});
    await db.from("profiles").delete().eq("id", id);
    await logActivity(actor.id, "user_deleted", { type: "user", id });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
