import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { handleError } from "@/lib/api";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const adminUser = await requireRole("super_admin");
    const { id } = await ctx.params;
    const { action, notes } = await req.json(); // action: "approve" | "reject"

    if (!["approve", "reject"].includes(action)) {
      return NextResponse.json({ error: "Invalid action. Use approve or reject." }, { status: 400 });
    }

    const db = supabaseAdmin();
    const newStatus = action === "approve" ? "approved" : "rejected";

    const { data, error } = await db
      .from("key_requests")
      .update({
        status: newStatus,
        reviewed_by: adminUser.id,
        reviewed_at: new Date().toISOString(),
        notes: notes || `Request ${newStatus} by Super Admin`,
      })
      .eq("id", id)
      .select()
      .single();

    if (error) throw new Error(error.message);

    return NextResponse.json({ success: true, request: data });
  } catch (e) {
    return handleError(e);
  }
}
