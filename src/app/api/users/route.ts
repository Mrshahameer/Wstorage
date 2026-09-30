import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, logActivity, type Role } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { handleError } from "@/lib/api";
import type { SupabaseClient } from "@supabase/supabase-js";

const ROLES = ["client", "employee", "bd_manager", "manager", "admin", "super_admin"] as const;
type AuthUser = { id: string; email?: string; created_at?: string; user_metadata?: Record<string, unknown> };

// Coerce any metadata role to a value the DB enum accepts; fall back to employee.
function safeRole(raw: unknown): Role {
  return (ROLES as readonly string[]).includes(raw as string) ? (raw as Role) : "employee";
}

// Pull every Supabase Auth user, across all pages.
async function listAllAuthUsers(db: SupabaseClient): Promise<AuthUser[]> {
  const all: AuthUser[] = [];
  for (let page = 1; page <= 100; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(error.message || "Failed to list auth users");
    const batch = (data?.users ?? []) as AuthUser[];
    all.push(...batch);
    if (batch.length < 1000) break;
  }
  return all;
}

// List users. Supabase Auth is the source of truth: every auth user appears,
// and any missing profile row is backfilled so roles/access can be managed.
export async function GET() {
  try {
    await requireRole("admin");
    const db = supabaseAdmin();

    const authUsers = await listAllAuthUsers(db);

    const { data: profileRows } = await db
      .from("profiles")
      .select("id,email,full_name,role,is_active,created_at");
    const profById = new Map<string, Record<string, unknown>>(
      (profileRows ?? []).map((p: { id: string }) => [p.id, p])
    );

    // Backfill profiles for any auth user that has none yet.
    const missing = authUsers.filter((u) => !profById.has(u.id));
    if (missing.length) {
      const toInsert = missing.map((u) => ({
        id: u.id,
        email: u.email ?? "",
        full_name: (u.user_metadata?.full_name as string) ?? "",
        role: safeRole(u.user_metadata?.role),
        is_active: true,
      }));
      const { data: inserted } = await db
        .from("profiles")
        .upsert(toInsert, { onConflict: "id" })
        .select("id,email,full_name,role,is_active,created_at");
      (inserted ?? []).forEach((p: { id: string }) => profById.set(p.id, p));
    }

    const { data: access } = await db.from("folder_access").select("user_id,folder_id");
    const byUser: Record<string, string[]> = {};
    (access ?? []).forEach((a: { user_id: string; folder_id: string }) => {
      (byUser[a.user_id] ||= []).push(a.folder_id);
    });

    const users = authUsers
      .map((u) => {
        const p = (profById.get(u.id) ?? {}) as Record<string, unknown>;
        return {
          id: u.id,
          email: (p.email as string) || u.email || "",
          full_name: (p.full_name as string) ?? (u.user_metadata?.full_name as string) ?? "",
          role: safeRole(p.role ?? u.user_metadata?.role),
          is_active: p.is_active === undefined ? true : Boolean(p.is_active),
          created_at: (p.created_at as string) ?? u.created_at ?? null,
          folderIds: byUser[u.id] ?? [],
        };
      })
      .sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? ""));

    return NextResponse.json({ users });
  } catch (e) {
    return handleError(e);
  }
}

const CreateSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  fullName: z.string().optional().default(""),
  role: z.enum(ROLES).default("employee"),
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
    if (error) throw new Error(error.message || "Could not create the user");

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
