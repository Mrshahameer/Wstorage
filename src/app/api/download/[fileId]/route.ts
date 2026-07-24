import { NextRequest, NextResponse } from "next/server";
import { requireUser, logActivity } from "@/lib/auth";
import { getProviderForKeyId } from "@/lib/storage";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { handleError } from "@/lib/api";
import { env } from "@/lib/env";
import { canAccessFile } from "@/lib/access";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ fileId: string }> }) {
  try {
    const user = await requireUser();
    const { fileId } = await ctx.params;
    const db = supabaseAdmin();

    const { data: file, error } = await db
      .from("files")
      .select("id,name,object_key,storage_key_id,status,folder_id")
      .eq("id", fileId)
      .single();
    if (error || !file || file.status !== "ready") {
      return NextResponse.json({ error: "File not available" }, { status: 404 });
    }

    if (!(await canAccessFile(user, { folder_id: file.folder_id }))) {
      return NextResponse.json({ error: "You don't have access to this file" }, { status: 403 });
    }

    const provider = await getProviderForKeyId(file.storage_key_id);
    const url = await provider.createDownloadUrl(file.object_key, env.signedUrlTtl(), file.name);

    await Promise.allSettled([
      db.from("downloads").insert({ file_id: file.id, user_id: user.id }),
      db.rpc("increment_download_count", { p_file_id: file.id }),
      logActivity(user.id, "download", { type: "file", id: file.id, detail: { name: file.name } }),
    ]);

    return NextResponse.redirect(url, { status: 307 });
  } catch (e) {
    return handleError(e);
  }
}
