import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, requireRole, logActivity } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { handleError } from "@/lib/api";
import { isAdmin, grantedFolderIds } from "@/lib/access";

export async function GET() {
  try {
    const user = await requireUser();
    const db = supabaseAdmin();
    const { data } = await db.from("folders").select("id,name,path,parent_id,created_at").order("name");
    let folders = data ?? [];
    // Employees only see folders they're granted.
    if (!isAdmin(user)) {
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
