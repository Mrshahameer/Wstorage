// Thumbs up / down on an assistant reply. Thumbs-down replies show in AI Control
// so bad answers can be fixed and added to the test set.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { handleError } from "@/lib/api";
import { saveFeedback } from "@/lib/assistant/log";

const Body = z.object({
  rating: z.union([z.literal(1), z.literal(-1)]),
  query: z.string().max(20000),
  reply: z.string().max(20000),
  meta: z.unknown().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "That feedback was not valid." }, { status: 400 });
    const d = parsed.data;
    const stored = await saveFeedback({ userId: user.id, rating: d.rating as 1 | -1, query: String(d.query), reply: String(d.reply), meta: d.meta ?? null });
    return NextResponse.json({ stored });
  } catch (e) {
    return handleError(e);
  }
}
