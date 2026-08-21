// PUBLIC (no auth). Returns a share link's metadata + file list.
// If the link is password protected, the caller must POST the correct password
// before any file list is revealed.
import { NextRequest, NextResponse } from "next/server";
import { handleError } from "@/lib/api";
import { loadLink, linkProblem, expandFiles, verifyPassword } from "@/lib/share";

export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const password: string | undefined = body?.password;

    const link = await loadLink(token);
    if (!link) return NextResponse.json({ error: "Link not found." }, { status: 404 });

    const problem = linkProblem(link);
    if (problem) return NextResponse.json({ error: problem }, { status: 410 });

    if (link.password_hash) {
      if (!password) return NextResponse.json({ requiresPassword: true }, { status: 401 });
      if (!verifyPassword(password, link.password_hash))
        return NextResponse.json({ requiresPassword: true, error: "Incorrect password." }, { status: 401 });
    }

    const files = await expandFiles(link.id);
    return NextResponse.json({
      name: link.name,
      allowDownload: link.allow_download,
      allowPreview: link.allow_preview,
      files: files.map((f) => ({
        id: f.id,
        name: f.name,
        size_bytes: f.size_bytes,
        content_type: f.content_type,
      })),
    });
  } catch (e) {
    return handleError(e);
  }
}
