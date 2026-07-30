import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, logActivity } from "@/lib/auth";
import { addStorageKey, listStorageKeys } from "@/lib/storage-keys";
import { handleError } from "@/lib/api";

export async function GET() {
  try {
    await requireRole("admin");
    const keys = await listStorageKeys();
    return NextResponse.json({ keys });
  } catch (e) {
    return handleError(e);
  }
}

const AddSchema = z.object({
  provider: z.enum(["backblaze", "r2"]).optional().default("backblaze"),
  label: z.string().min(1),
  keyId: z.string().min(1),
  applicationKey: z.string().min(1),
  bucketId: z.string().optional().default(""),
  bucketName: z.string().min(1),
  // Not required for r2 (region is always "auto" there); validated below
  // per-provider instead of at the schema level (avoids a TS inference
  // quirk where chaining .refine()/.superRefine() onto an object with
  // several .optional().default() fields collapses z.infer to all-optional).
  region: z.string().optional().default(""),
  accountId: z.string().optional().default(""),
  makeActive: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const user = await requireRole("admin");
    const parsed = AddSchema.parse(await req.json());
    const provider = parsed.provider as "backblaze" | "r2";
    const region: string = parsed.region;
    const accountId: string = parsed.accountId;

    if (provider === "backblaze" && !region.trim()) {
      return NextResponse.json({ error: "Region is required for Backblaze B2." }, { status: 400 });
    }
    if (provider === "r2" && !accountId.trim()) {
      return NextResponse.json({ error: "Cloudflare account ID is required for R2." }, { status: 400 });
    }

    // Built explicitly (rather than passing `parsed` straight through) because
    // z.infer on this schema resolves to an all-optional type in this
    // project's TS/zod setup — see the comment above AddSchema.
    const input = {
      provider,
      label: parsed.label as string,
      keyId: parsed.keyId as string,
      applicationKey: parsed.applicationKey as string,
      bucketId: parsed.bucketId as string,
      bucketName: parsed.bucketName as string,
      region,
      accountId,
      makeActive: parsed.makeActive as boolean | undefined,
    };

    const key = await addStorageKey(input, user.id);
    await logActivity(user.id, "key_added", { type: "storage_key", id: key.id, detail: { label: input.label } });
    return NextResponse.json({ key });
  } catch (e) {
    return handleError(e);
  }
}
