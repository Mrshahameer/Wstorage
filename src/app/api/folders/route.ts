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
    const parentId = req.nextUrl.searchParams.get("parentId");

    let query = db
      .from("folders")
      .select("id,name,path,parent_id,folder_type,campaign_id,sort,created_at")
      .order("sort")
      .order("name");
    if (parentId) {
      // Direct children of a specific folder (nested subfolders).
      query = query.eq("parent_id", parentId);
    } else if (campaignId) {
      // Top-level resource folders of a campaign (parent_id is null).
      query = query.eq("campaign_id", campaignId).is("parent_id", null);
    }
    const { data } = await query;
    let folders = data ?? [];

    // When scoped (campaign or parent), folders are visible to anyone who can see
    // the campaign (files are separately access-gated by /api/files). The unscoped
    // list still respects legacy per-folder grants for employees.
    if (!isAdmin(user) && !campaignId && !parentId) {
      const ids = new Set(await grantedFolderIds(user.id));
      folders = folders.filter((f: { id: string }) => ids.has(f.id));
    }
    return NextResponse.json({ folders });
  } catch (e) {
    return handleError(e);
  }
}

const CreateSchema = z.object({
  name: z.string().min(1),
  parentId: z.string().uuid().nullable().optional(),
  campaignId: z.string().uuid().nullable().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const actor = await requireRole("admin");
    const body = CreateSchema.parse(await req.json());
    const db = supabaseAdmin();

    // A subfolder inherits its parent's campaign when campaignId isn't given.
    let campaignId = body.campaignId ?? null;
    let path = `/${body.name}`;
    if (body.parentId) {
      const { data: parent } = await db.from("folders").select("campaign_id,path").eq("id", body.parentId).single();
      if (parent) {
        if (!campaignId) campaignId = parent.campaign_id ?? null;
        path = `${parent.path || ""}/${body.name}`;
      }
    }

    const { data, error } = await db
      .from("folders")
      .insert({
        name: body.name,
        parent_id: body.parentId ?? null,
        campaign_id: campaignId,
        folder_type: body.parentId || campaignId ? "resource" : null,
        path,
        created_by: actor.id,
      })
      .select("id,name,path,parent_id,campaign_id")
      .single();
    if (error) throw new Error(error.message);
    await logActivity(actor.id, "folder_created", { type: "folder", id: data.id, detail: { name: body.name } });
    return NextResponse.json({ folder: data });
  } catch (e) {
    return handleError(e);
  }
}
