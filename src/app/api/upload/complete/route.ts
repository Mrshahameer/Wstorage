import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, logActivity } from "@/lib/auth";
import { getProviderForKeyId } from "@/lib/storage";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { handleError } from "@/lib/api";

const Schema = z.object({ fileId: z.string().uuid() });

export async function POST(req: NextRequest) {
  try {
    const user = await requireRole("admin");
    const { fileId } = Schema.parse(await req.json());
    const db = supabaseAdmin();

    const { data: file, error } = await db
      .from("files")
      .select("id,object_key,storage_key_id,name")
      .eq("id", fileId)
      .single();
    if (error || !file) throw new Error("File not found");

    // Verify the object actually landed in the bucket before marking ready.
    const provider = await getProviderForKeyId(file.storage_key_id);
    const size = await provider.headSize(file.object_key);
    if (size === null) throw new Error("Object not found in storage — upload may have failed.");

    await db.from("files").update({ status: "ready", size_bytes: size, updated_at: new Date().toISOString() }).eq("id", fileId);
    await db.from("file_versions").insert({
      file_id: fileId,
      version: 1,
      object_key: file.object_key,
      storage_key_id: file.storage_key_id,
      size_bytes: size,
      uploaded_by: user.id,
    });
    await logActivity(user.id, "upload", { type: "file", id: fileId, detail: { name: file.name } });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
