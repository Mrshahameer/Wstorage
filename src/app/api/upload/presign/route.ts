import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { getActiveProvider } from "@/lib/storage";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { handleError } from "@/lib/api";
import crypto from "crypto";

const Schema = z.object({
  fileName: z.string().min(1),
  contentType: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  description: z.string().optional().default(""),
  tags: z.array(z.string()).optional().default([]),
  folderId: z.string().uuid().nullable().optional(),
  categoryId: z.string().uuid().nullable().optional(),
  sha256: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const user = await requireRole("admin"); // employees can't upload
    const input = Schema.parse(await req.json());
    const db = supabaseAdmin();

    let duplicate = null;
    if (input.sha256) {
      const { data } = await db
        .from("files").select("id,name").eq("sha256", input.sha256).eq("status", "ready").limit(1).maybeSingle();
      duplicate = data ?? null;
    }

    const provider = await getActiveProvider();
    const ext = input.fileName.includes(".") ? input.fileName.split(".").pop()! : "";
    const objectKey = `${new Date().getFullYear()}/${crypto.randomUUID()}${ext ? "." + ext : ""}`;

    const { data: file, error } = await db
      .from("files")
      .insert({
        name: input.fileName,
        description: input.description || null,
        tags: input.tags,
        extension: ext || null,
        content_type: input.contentType,
        size_bytes: input.sizeBytes,
        sha256: input.sha256 ?? null,
        folder_id: input.folderId ?? null,
        category_id: input.categoryId ?? null,
        storage_key_id: provider.storageKeyId,
        object_key: objectKey,
        status: "pending",
        uploaded_by: user.id,
      })
      .select("id").single();
    if (error) throw new Error(error.message);

    const presigned = await provider.createUploadUrl(objectKey, input.contentType, 900);
    return NextResponse.json({ fileId: file.id, presigned, duplicate });
  } catch (e) {
    return handleError(e);
  }
}
