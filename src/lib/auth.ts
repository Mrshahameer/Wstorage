// Auth + RBAC helpers for server routes and server components.
import { createServerSupabase } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export type Role = "super_admin" | "admin" | "employee";

export interface SessionUser {
  id: string;
  email: string;
  role: Role;
  is_active: boolean;
}

/** Returns the current user + role, or null if not logged in. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  // Profile carries the role. Use admin client to avoid RLS recursion edge-cases.
  const { data: profile } = await supabaseAdmin()
    .from("profiles")
    .select("id,email,role,is_active")
    .eq("id", user.id)
    .single();

  if (!profile || !profile.is_active) return null;
  return profile as SessionUser;
}

export function roleAtLeast(role: Role, min: Role): boolean {
  const order: Record<Role, number> = { employee: 1, admin: 2, super_admin: 3 };
  return order[role] >= order[min];
}

/** Throws a Response-friendly error object when the user lacks the role. */
export class AuthError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new AuthError(401, "Not authenticated");
  return user;
}

export async function requireRole(min: Role): Promise<SessionUser> {
  const user = await requireUser();
  if (!roleAtLeast(user.role, min)) throw new AuthError(403, "Forbidden");
  return user;
}

export async function logActivity(
  actorId: string | null,
  action: string,
  target?: { type?: string; id?: string; detail?: Record<string, unknown> }
) {
  await supabaseAdmin().from("activity_logs").insert({
    actor_id: actorId,
    action,
    target_type: target?.type ?? null,
    target_id: target?.id ?? null,
    detail: target?.detail ?? {},
  });
}
