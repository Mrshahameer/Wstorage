import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, requireRole, logActivity } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { handleError } from "@/lib/api";

export async function GET(req: NextRequest) {
  try {
    await requireUser();
    const verticalId = req.nextUrl.searchParams.get("verticalId");
    let q = supabaseAdmin()
      .from("campaigns")
      .select("id,vertical_id,campaign_type_id,name,buyer,status,created_at")
      .order("name");
    if (verticalId) q = q.eq("vertical_id", verticalId);
    const { data } = await q;
    return NextResponse.json({ campaigns: data ?? [] });
  } catch (e) {
    return handleError(e);
  }
}

const CreateSchema = z.object({
  verticalId: z.string().uuid(),
  campaignTypeId: z.string().uuid().nullable().optional(),
  name: z.string().min(1),
  buyer: z.string().optional(),
  description: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const actor = await requireRole("admin");
    const body = CreateSchema.parse(await req.json());
    const { data, error } = await supabaseAdmin()
      .from("campaigns")
      .insert({
        vertical_id: body.verticalId,
        campaign_type_id: body.campaignTypeId ?? null,
        name: body.name,
        buyer: body.buyer ?? null,
        description: body.description ?? null,
        created_by: actor.id,
      })
      .select("id,name")
      .single();
    if (error) throw new Error(error.message);
    await logActivity(actor.id, "campaign_created", { type: "campaign", id: data.id, detail: { name: body.name } });
    return NextResponse.json({ campaign: data });
  } catch (e) {
    return handleError(e);
  }
}
