import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { handleError } from "@/lib/api";

export async function GET() {
  try {
    await requireUser();
    const { data } = await supabaseAdmin().from("categories").select("id,name").order("name");
    return NextResponse.json({ categories: data ?? [] });
  } catch (e) {
    return handleError(e);
  }
}
