import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, logActivity, AuthError } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { handleError } from "@/lib/api";

const PatchSchema = z.object({
  role: z.enum(["client", "employee", "bd_manager", "manager", "admin", "super_admin"]).optional(),
  isActive: z.boolean().optional(),
  email: z.string().email().optional(),
  password: z.string().min(6).optional(),
  fullName: z.string().optional(),
  folderIds: z.array(z.string().uuid()).optional(), // full replace of access
});

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireRole("super_admin");
    const { id } = await ctx.params;
    const body = PatchSchema.parse(await req.json());
    const db = supabaseAdmin();

    // Auth-level changes (email / password) go through the admin API.
    if (body.email !== undefined || body.password !== undefined) {
      const attrs: Record<string, unknown> = {};
      if (body.email !== undefined) {
        attrs.email = body.email;
        attrs.email_confirm = true; // keep the account confirmed, skip re-verification email
      }
      if (body.password !== undefined) attrs.password = body.password;
      const { error } = await db.auth.admin.updateUserById(id, attrs);
      if (error) throw new Error(error.message || "Could not update the account");
    }

    // Profile-level changes.
    const patch: Record<string, unknown> = {};
    if (body.role) patch.role = body.role;
    if (body.isActive !== undefined) patch.is_active = body.isActive;
    if (body.email !== undefined) patch.email = body.email;
    if (body.fullName !== undefined) patch.full_name = body.fullName;
    if (Object.keys(patch).length) {
      const { error } = await db.from("profiles").update(patch).eq("id", id);
      if (error) throw new Error(error.message || "Could not update the profile");
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
    if (id === actor.id) throw new AuthError(400, "You cannot delete your own account");
    const db = supabaseAdmin();
    const { error } = await db.auth.admin.deleteUser(id);
    // Deleting the auth user cascades the profile + grants. If the auth user was
    // already gone, still clean up any leftover profile row.
    if (error && !/not found/i.test(error.message || "")) {
      throw new Error(error.message || "Could not delete the user");
    }
    await db.from("profiles").delete().eq("id", id);
    await logActivity(actor.id, "user_deleted", { type: "user", id });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
