import { NextRequest, NextResponse } from "next/server";
import { requireRole, logActivity } from "@/lib/auth";
import { enableBucketCors } from "@/lib/b2-cors";
import { handleError } from "@/lib/api";

export async function POST(req: NextRequest) {
  try {
    const user = await requireRole("admin");
    const origin = req.nextUrl?.origin || `https://${req.headers.get("host")}`;
    const result = await enableBucketCors(origin);
    await logActivity(user.id, "b2_cors_enabled", { type: "storage_key", detail: result });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return handleError(e);
  }
}
