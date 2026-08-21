// Admin activity log feed (blueprint §29). Joins actor emails onto the log rows.
import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { handleError } from "@/lib/api";

export async function GET(req: NextRequest) {
  try {
    await requireRole("admin");
    const db = supabaseAdmin();
    const limit = Math.min(200, parseInt(req.nextUrl.searchParams.get("limit") ?? "100", 10));

    const { data: logs } = await db
      .from("activity_logs")
      .select("id,actor_id,action,target_type,target_id,detail,created_at")
      .order("created_at", { ascending: false })
      .limit(limit);

    const ids = Array.from(new Set((logs ?? []).map((l: { actor_id: string | null }) => l.actor_id).filter(Boolean)));
    const emailById: Record<string, string> = {};
    if (ids.length) {
      const { data: profs } = await db.from("profiles").select("id,email").in("id", ids);
      (profs ?? []).forEach((p: { id: string; email: string }) => { emailById[p.id] = p.email; });
    }
    const rows = (logs ?? []).map((l: { actor_id: string | null }) => ({ ...l, actor_email: l.actor_id ? emailById[l.actor_id] ?? null : null }));
    return NextResponse.json({ logs: rows });
  } catch (e) {
    return handleError(e);
  }
}
