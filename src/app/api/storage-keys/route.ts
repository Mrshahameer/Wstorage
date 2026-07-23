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
  label: z.string().min(1),
  keyId: z.string().min(1),
  applicationKey: z.string().min(1),
  bucketId: z.string().min(1),
  bucketName: z.string().min(1),
  region: z.string().min(1),
  makeActive: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const user = await requireRole("admin");
    const body = AddSchema.parse(await req.json());
    const key = await addStorageKey(body, user.id);
    await logActivity(user.id, "key_added", { type: "storage_key", id: key.id, detail: { label: body.label } });
    return NextResponse.json({ key });
  } catch (e) {
    return handleError(e);
  }
}
