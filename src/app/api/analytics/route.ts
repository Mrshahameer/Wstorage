// Admin analytics for the Super-Admin dashboard (blueprint §30).
// Totals + widget lists, computed from existing tables/logs.
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { handleError } from "@/lib/api";

export async function GET() {
  try {
    await requireRole("admin");
    const db = supabaseAdmin();

    const [
      { count: assets },
      { count: users },
      { count: campaigns },
      { count: activeShareLinks },
      { data: sizeRows },
      { data: recentUploads },
      { data: mostDownloaded },
      { data: recentShareLinks },
      { data: downloadRows },
    ] = await Promise.all([
      db.from("files").select("id", { count: "exact", head: true }).eq("status", "ready"),
      db.from("profiles").select("id", { count: "exact", head: true }),
      db.from("campaigns").select("id", { count: "exact", head: true }),
      db.from("share_links").select("id", { count: "exact", head: true }).eq("status", "active"),
      db.from("files").select("size_bytes").eq("status", "ready"),
      db.from("files").select("id,name,created_at").eq("status", "ready").order("created_at", { ascending: false }).limit(6),
      db.from("files").select("id,name,download_count").eq("status", "ready").order("download_count", { ascending: false }).limit(6),
      db.from("share_links").select("id,name,token,current_downloads,expires_at,status,created_at").order("created_at", { ascending: false }).limit(6),
      db.from("downloads").select("user_id").limit(5000),
    ]);

    const storageBytes = (sizeRows ?? []).reduce((a: number, r: { size_bytes: number }) => a + Number(r.size_bytes || 0), 0);

    // Most active users = download counts grouped by user, resolved to emails.
    const counts: Record<string, number> = {};
    (downloadRows ?? []).forEach((d: { user_id: string | null }) => { if (d.user_id) counts[d.user_id] = (counts[d.user_id] || 0) + 1; });
    const topIds = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 6);
    let mostActiveUsers: { email: string; downloads: number }[] = [];
    if (topIds.length) {
      const { data: profs } = await db.from("profiles").select("id,email").in("id", topIds.map(([id]) => id));
      const emailById: Record<string, string> = {};
      (profs ?? []).forEach((p: { id: string; email: string }) => { emailById[p.id] = p.email; });
      mostActiveUsers = topIds.map(([id, n]) => ({ email: emailById[id] || id.slice(0, 8), downloads: n }));
    }

    return NextResponse.json({
      totals: {
        assets: assets ?? 0,
        users: users ?? 0,
        campaigns: campaigns ?? 0,
        activeShareLinks: activeShareLinks ?? 0,
        storageBytes,
      },
      recentUploads: recentUploads ?? [],
      mostDownloaded: mostDownloaded ?? [],
      mostActiveUsers,
      recentShareLinks: recentShareLinks ?? [],
    });
  } catch (e) {
    return handleError(e);
  }
}
