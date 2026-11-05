import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, requireRole, logActivity } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { handleError } from "@/lib/api";

export async function GET() {
  try {
    await requireUser();
    const { data } = await supabaseAdmin()
      .from("categories")
      .select("id,name,icon,sort")
      .order("sort")
      .order("name");
    return NextResponse.json({ categories: data ?? [] }, { headers: { "Cache-Control": "private, max-age=60, stale-while-revalidate=300" } });
  } catch (e) {
    return handleError(e);
  }
}

const CreateSchema = z.object({
  name: z.string().min(1),
  icon: z.string().optional(),
  description: z.string().optional(),
  sort: z.number().int().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const actor = await requireRole("admin");
    const body = CreateSchema.parse(await req.json());
    const { data, error } = await supabaseAdmin()
      .from("categories")
      .insert({
        name: body.name,
        icon: body.icon ?? null,
        description: body.description ?? null,
        sort: body.sort ?? 0,
        created_by: actor.id,
      })
      .select("id,name")
      .single();
    if (error) throw new Error(error.message);
    await logActivity(actor.id, "category_created", { type: "category", id: data.id, detail: { name: body.name } });
    return NextResponse.json({ category: data });
  } catch (e) {
    return handleError(e);
  }
}
