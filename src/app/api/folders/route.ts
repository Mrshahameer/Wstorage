import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, requireRole, logActivity } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { handleError } from "@/lib/api";
import { isAdmin, grantedFolderIds } from "@/lib/access";

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const db = supabaseAdmin();
    const campaignId = req.nextUrl.searchParams.get("campaignId");

    let query = db
      .from("folders")
      .select("id,name,path,parent_id,folder_type,campaign_id,sort,created_at")
      .order("sort")
      .order("name");
    if (campaignId) query = query.eq("campaign_id", campaignId);
    const { data } = await query;
    let folders = data ?? [];

    // When scoped to a campaign, resource folders are visible to anyone who can
    // see that campaign (its files are separately access-gated by /api/files).
    // The unscoped list still respects legacy per-folder grants for employees.
    if (!isAdmin(user) && !campaignId) {
      const ids = new Set(await grantedFolderIds(user.id));
      folders = folders.filter((f: { id: string }) => ids.has(f.id));
    }
    return NextResponse.json({ folders });
  } catch (e) {
    return handleError(e);
  }
}

const CreateSchema = z.object({ name: z.string().min(1), parentId: z.string().uuid().nullable().optional() });

export async function POST(req: NextRequest) {
  try {
    const actor = await requireRole("admin");
    const body = CreateSchema.parse(await req.json());
    const db = supabaseAdmin();
    const { data, error } = await db
      .from("folders")
      .insert({ name: body.name, parent_id: body.parentId ?? null, path: `/${body.name}`, created_by: actor.id })
      .select("id,name,path")
      .single();
    if (error) throw new Error(error.message);
    await logActivity(actor.id, "folder_created", { type: "folder", id: data.id, detail: { name: body.name } });
    return NextResponse.json({ folder: data });
  } catch (e) {
    return handleError(e);
  }
}
