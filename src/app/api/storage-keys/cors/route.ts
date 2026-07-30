import { NextRequest, NextResponse } from "next/server";
import { requireRole, logActivity } from "@/lib/auth";
import { enableActiveBucketCors } from "@/lib/storage-cors";
import { handleError } from "@/lib/api";

export async function POST(req: NextRequest) {
  try {
    const user = await requireRole("admin");
    const origin = req.nextUrl?.origin || `https://${req.headers.get("host")}`;
    const result = await enableActiveBucketCors(origin);
    await logActivity(user.id, "bucket_cors_enabled", { type: "storage_key", detail: result });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return handleError(e);
  }
}
