// Returns a short-lived INLINE signed URL for previewing a file (no attachment
// disposition, no download logging). Access-checked. Used by the asset detail page.
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getProviderForKeyId } from "@/lib/storage";
import { handleError } from "@/lib/api";
import { env } from "@/lib/env";
import { canFile } from "@/lib/permissions";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const db = supabaseAdmin();

    const { data: file, error } = await db
      .from("files")
      .select("id,name,object_key,storage_key_id,status,content_type")
      .eq("id", id)
      .single();
    if (error || !file || file.status !== "ready") {
      return NextResponse.json({ error: "File not available" }, { status: 404 });
    }
    if (!(await canFile(user, "view", id))) {
      return NextResponse.json({ error: "You don't have access to this file" }, { status: 403 });
    }

    const provider = await getProviderForKeyId(file.storage_key_id);
    // No downloadName -> no attachment disposition -> browser renders inline.
    const url = await provider.createDownloadUrl(file.object_key, env.signedUrlTtl());
    return NextResponse.json({ url, contentType: file.content_type });
  } catch (e) {
    return handleError(e);
  }
}
