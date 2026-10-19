import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, requireRole, logActivity } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { handleError } from "@/lib/api";
import { isAdmin, accessScope } from "@/lib/access";

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const verticalId = req.nextUrl.searchParams.get("verticalId");
    const scope = req.nextUrl.searchParams.get("scope");
    let q = supabaseAdmin()
      .from("campaigns")
      .select("id,vertical_id,campaign_type_id,name,buyer,status,created_at")
      .order("name");
    if (verticalId) q = q.eq("vertical_id", verticalId);
    // scope=accessible limits a non-admin to the campaigns they can access.
    if (scope === "accessible" && !isAdmin(user)) {
      const s = await accessScope(user.id);
      if (!s.campaignIds.length) return NextResponse.json({ campaigns: [] });
      q = q.in("id", s.campaignIds);
    }
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
