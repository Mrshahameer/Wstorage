// PUBLIC (no auth). Validates the link + password + limits, then returns a
// short-lived signed URL for ONE file that belongs to the link.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleError } from "@/lib/api";
import { loadLink, linkProblem, expandFiles, verifyPassword, signShareDownload } from "@/lib/share";

const Schema = z.object({ fileId: z.string().uuid(), password: z.string().optional() });

export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await ctx.params;
    const { fileId, password } = Schema.parse(await req.json());

    const link = await loadLink(token);
    if (!link) return NextResponse.json({ error: "Link not found." }, { status: 404 });
    if (!link.allow_download) return NextResponse.json({ error: "Downloads are disabled for this link." }, { status: 403 });

    const problem = linkProblem(link);
    if (problem) return NextResponse.json({ error: problem }, { status: 410 });

    if (link.password_hash) {
      if (!password || !verifyPassword(password, link.password_hash))
        return NextResponse.json({ error: "Incorrect password." }, { status: 401 });
    }

    // The requested file must actually belong to this link.
    const files = await expandFiles(link.id);
    const file = files.find((f) => f.id === fileId);
    if (!file) return NextResponse.json({ error: "File is not part of this link." }, { status: 404 });

    const url = await signShareDownload(link, file);
    return NextResponse.json({ url });
  } catch (e) {
    return handleError(e);
  }
}
