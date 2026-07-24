import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getActiveProvider } from "@/lib/storage";
import { handleError } from "@/lib/api";

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireRole("admin"); // Admin or Super Admin
    const { id } = await ctx.params;
    const db = supabaseAdmin();

    // 1. Fetch file record from Supabase
    const { data: file, error: fetchErr } = await db
      .from("files")
      .select("id, object_key, name")
      .eq("id", id)
      .single();

    if (fetchErr || !file) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    // 2. Delete object from Backblaze B2 storage
    try {
      const provider = await getActiveProvider();
      await provider.delete(file.object_key);
    } catch (b2Err) {
      console.warn("Storage provider delete warning:", b2Err);
      // Continue to remove DB record even if storage object is already gone
    }

    // 3. Delete record from Supabase database
    const { error: deleteErr } = await db.from("files").delete().eq("id", id);
    if (deleteErr) throw new Error(deleteErr.message);

    return NextResponse.json({ success: true, message: `Deleted ${file.name}` });
  } catch (e) {
    return handleError(e);
  }
}
