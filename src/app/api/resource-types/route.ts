import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, requireRole, logActivity } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { handleError } from "@/lib/api";

export async function GET() {
  try {
    await requireUser();
    const { data } = await supabaseAdmin()
      .from("resource_types")
      .select("id,name,slug,icon,is_system,sort")
      .order("sort")
      .order("name");
    return NextResponse.json({ resourceTypes: data ?? [] });
  } catch (e) {
    return handleError(e);
  }
}

const CreateSchema = z.object({ name: z.string().min(1), icon: z.string().optional() });

function slugify(s: string) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requireRole("admin");
    const body = CreateSchema.parse(await req.json());
    const { data, error } = await supabaseAdmin()
      .from("resource_types")
      .insert({ name: body.name, slug: slugify(body.name), icon: body.icon ?? "file", is_system: false, sort: 500 })
      .select("id,name")
      .single();
    if (error) throw new Error(error.message);
    await logActivity(actor.id, "resource_type_created", { type: "resource_type", id: data.id, detail: { name: body.name } });
    return NextResponse.json({ resourceType: data });
  } catch (e) {
    return handleError(e);
  }
}
