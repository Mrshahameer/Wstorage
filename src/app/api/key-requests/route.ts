import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { handleError } from "@/lib/api";

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const db = supabaseAdmin();

    const isSuper = user.role === "super_admin";
    let query = db.from("key_requests").select("id, user_id, status, notes, requested_at, reviewed_at");

    if (!isSuper) {
      query = query.eq("user_id", user.id);
    }

    const { data: requests, error } = await query.order("requested_at", { ascending: false });
    if (error) {
      // If table is not created yet, return empty list gracefully
      return NextResponse.json({ requests: [] });
    }

    return NextResponse.json({ requests: requests ?? [] });
  } catch (e) {
    return handleError(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const db = supabaseAdmin();
    const { notes } = await req.json().catch(() => ({ notes: "" }));

    const { data, error } = await db
      .from("key_requests")
      .insert({
        user_id: user.id,
        notes: notes || "Requested permission to add personal Backblaze B2 key",
        status: "pending",
      })
      .select()
      .single();

    if (error) throw new Error(error.message);

    return NextResponse.json({ request: data, message: "Request submitted to Super Admin" });
  } catch (e) {
    return handleError(e);
  }
}
