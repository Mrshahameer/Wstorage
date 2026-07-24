import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { handleError } from "@/lib/api";

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    await requireRole("admin");
    const { id } = await ctx.params;
    const db = supabaseAdmin();

    const { error } = await db.from("folders").delete().eq("id", id);
    if (error) throw new Error(error.message);

    return NextResponse.json({ success: true });
  } catch (e) {
    return handleError(e);
  }
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    await requireRole("admin");
    const { id } = await ctx.params;
    const { name } = await req.json();
    if (!name || typeof name !== "string") {
      return NextResponse.json({ error: "Folder name is required" }, { status: 400 });
    }

    const db = supabaseAdmin();
    const folderName = name.trim();
    const { data, error } = await db
      .from("folders")
      .update({ name: folderName, path: `/${folderName}` })
      .eq("id", id)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return NextResponse.json({ folder: data });
  } catch (e) {
    return handleError(e);
  }
}
