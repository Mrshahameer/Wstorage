import { NextRequest, NextResponse } from "next/server";
import { requireUser, logActivity } from "@/lib/auth";
import { getProviderForKeyId } from "@/lib/storage";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { handleError } from "@/lib/api";
import { env } from "@/lib/env";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ fileId: string }> }) {
  try {
    // Any logged-in, active user may download (employees included, per PRD).
    const user = await requireUser();
    const { fileId } = await ctx.params;
    const db = supabaseAdmin();

    const { data: file, error } = await db
      .from("files")
      .select("id,name,object_key,storage_key_id,status")
      .eq("id", fileId)
      .single();
    if (error || !file || file.status !== "ready") {
      return NextResponse.json({ error: "File not available" }, { status: 404 });
    }

    const provider = await getProviderForKeyId(file.storage_key_id);
    const ttl = env.signedUrlTtl(); // 60-300s per PRD
    const url = await provider.createDownloadUrl(file.object_key, ttl, file.name);

    // Record the download (best-effort; don't block the redirect on logging).
    await Promise.allSettled([
      db.from("downloads").insert({ file_id: file.id, user_id: user.id }),
      db.rpc("increment_download_count", { p_file_id: file.id }),
      logActivity(user.id, "download", { type: "file", id: file.id, detail: { name: file.name } }),
    ]);

    // 307 keeps the method and sends the browser straight to the short-lived URL.
    return NextResponse.redirect(url, { status: 307 });
  } catch (e) {
    return handleError(e);
  }
}
