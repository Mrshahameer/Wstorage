import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, logActivity } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { handleError } from "@/lib/api";

// List all users with their role + granted folder ids.
export async function GET() {
  try {
    await requireRole("admin");
    const db = supabaseAdmin();
    const [{ data: profiles }, { data: access }] = await Promise.all([
      db.from("profiles").select("id,email,full_name,role,is_active,created_at").order("created_at"),
      db.from("folder_access").select("user_id,folder_id"),
    ]);
    const byUser: Record<string, string[]> = {};
    (access ?? []).forEach((a: { user_id: string; folder_id: string }) => {
      (byUser[a.user_id] ||= []).push(a.folder_id);
    });
    const users = (profiles ?? []).map((p: { id: string }) => ({
      ...p,
      folderIds: byUser[p.id] ?? [],
    }));
    return NextResponse.json({ users });
  } catch (e) {
    return handleError(e);
  }
}

const CreateSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  fullName: z.string().optional().default(""),
  role: z.enum(["employee", "admin", "super_admin"]).default("employee"),
});

// Create (invite) a user: makes the auth account and sets the role via metadata,
// which our trigger reads to populate wstorage.profiles.
export async function POST(req: NextRequest) {
  try {
    const actor = await requireRole("super_admin");
    const body = CreateSchema.parse(await req.json());
    const db = supabaseAdmin();

    const { data, error } = await db.auth.admin.createUser({
      email: body.email,
      password: body.password,
      email_confirm: true,
      user_metadata: { role: body.role, full_name: body.fullName },
    });
    if (error) throw new Error(error.message);

    // Belt-and-suspenders: ensure the profile exists with the right role.
    if (data.user) {
      await db.from("profiles").upsert(
        { id: data.user.id, email: body.email, full_name: body.fullName, role: body.role, is_active: true },
        { onConflict: "id" }
      );
    }
    await logActivity(actor.id, "user_created", { type: "user", id: data.user?.id, detail: { email: body.email, role: body.role } });
    return NextResponse.json({ ok: true, id: data.user?.id });
  } catch (e) {
    return handleError(e);
  }
}
