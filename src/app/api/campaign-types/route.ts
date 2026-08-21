import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, requireRole, logActivity } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { handleError } from "@/lib/api";

export async function GET() {
  try {
    await requireUser();
    const { data } = await supabaseAdmin()
      .from("campaign_types")
      .select("id,name,sort")
      .order("sort")
      .order("name");
    return NextResponse.json({ campaignTypes: data ?? [] });
  } catch (e) {
    return handleError(e);
  }
}

const CreateSchema = z.object({ name: z.string().min(1), sort: z.number().int().optional() });

export async function POST(req: NextRequest) {
  try {
    const actor = await requireRole("admin");
    const body = CreateSchema.parse(await req.json());
    const { data, error } = await supabaseAdmin()
      .from("campaign_types")
      .insert({ name: body.name, sort: body.sort ?? 0 })
      .select("id,name")
      .single();
    if (error) throw new Error(error.message);
    await logActivity(actor.id, "campaign_type_created", { type: "campaign_type", id: data.id, detail: { name: body.name } });
    return NextResponse.json({ campaignType: data });
  } catch (e) {
    return handleError(e);
  }
}
