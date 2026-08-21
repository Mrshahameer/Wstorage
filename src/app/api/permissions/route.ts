// Granular per-resource grants for a user (blueprint §15-17, §45).
// GET  ?userId=  -> the nodes the user can VIEW (category/vertical/campaign/folder)
// POST { userId, nodes[], expiresAt? } -> replace their view+download allow grants.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, logActivity } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { handleError } from "@/lib/api";

export async function GET(req: NextRequest) {
  try {
    await requireRole("admin");
    const userId = req.nextUrl.searchParams.get("userId");
    if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });
    const { data } = await supabaseAdmin()
      .from("user_resource_permissions")
      .select("resource_type,resource_id,expires_at")
      .eq("user_id", userId)
      .eq("permission", "view")
      .eq("access_mode", "allow");
    // De-dupe to unique nodes.
    const seen = new Set<string>();
    const nodes = (data ?? []).filter((r: { resource_type: string; resource_id: string }) => {
      const k = `${r.resource_type}:${r.resource_id}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    return NextResponse.json({ nodes });
  } catch (e) {
    return handleError(e);
  }
}

const Node = z.object({
  type: z.enum(["category", "vertical", "campaign", "folder"]),
  id: z.string().uuid(),
});
const PostSchema = z.object({
  userId: z.string().uuid(),
  nodes: z.array(Node),
  expiresAt: z.string().datetime().nullable().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const actor = await requireRole("super_admin");
    const body = PostSchema.parse(await req.json());
    const db = supabaseAdmin();

    // Replace the user's view+download allow grants with the new selection.
    await db
      .from("user_resource_permissions")
      .delete()
      .eq("user_id", body.userId)
      .in("permission", ["view", "download"])
      .eq("access_mode", "allow");

    if (body.nodes.length) {
      const rows = body.nodes.flatMap((n) =>
        (["view", "download"] as const).map((permission) => ({
          user_id: body.userId,
          resource_type: n.type,
          resource_id: n.id,
          permission,
          access_mode: "allow",
          inherit_to_children: true,
          expires_at: body.expiresAt ?? null,
          created_by: actor.id,
        }))
      );
      const { error } = await db.from("user_resource_permissions").insert(rows);
      if (error) throw new Error(error.message);
    }

    await logActivity(actor.id, "permissions_changed", { type: "user", id: body.userId, detail: { nodes: body.nodes.length } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
