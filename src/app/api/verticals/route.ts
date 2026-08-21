import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, requireRole, logActivity } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { handleError } from "@/lib/api";

export async function GET(req: NextRequest) {
  try {
    await requireUser();
    const categoryId = req.nextUrl.searchParams.get("categoryId");
    let q = supabaseAdmin()
      .from("verticals")
      .select("id,category_id,name,slug,description,sort,created_at")
      .order("sort")
      .order("name");
    if (categoryId) q = q.eq("category_id", categoryId);
    const { data } = await q;
    return NextResponse.json({ verticals: data ?? [] });
  } catch (e) {
    return handleError(e);
  }
}

const CreateSchema = z.object({
  categoryId: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().optional(),
  sort: z.number().int().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const actor = await requireRole("admin");
    const body = CreateSchema.parse(await req.json());
    const { data, error } = await supabaseAdmin()
      .from("verticals")
      .insert({
        category_id: body.categoryId,
        name: body.name,
        description: body.description ?? null,
        sort: body.sort ?? 0,
        created_by: actor.id,
      })
      .select("id,category_id,name")
      .single();
    if (error) throw new Error(error.message);
    await logActivity(actor.id, "vertical_created", { type: "vertical", id: data.id, detail: { name: body.name } });
    return NextResponse.json({ vertical: data });
  } catch (e) {
    return handleError(e);
  }
}
