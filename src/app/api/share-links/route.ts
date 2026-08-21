import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, logActivity } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { handleError } from "@/lib/api";
import { generateToken, hashPassword } from "@/lib/share";

export async function GET() {
  try {
    await requireRole("admin");
    const { data } = await supabaseAdmin()
      .from("share_links")
      .select(
        "id,token,name,allow_download,allow_preview,expires_at,max_downloads,current_downloads,status,created_at"
      )
      .order("created_at", { ascending: false });
    return NextResponse.json({ shareLinks: data ?? [] });
  } catch (e) {
    return handleError(e);
  }
}

const CreateSchema = z.object({
  name: z.string().optional(),
  password: z.string().min(1).optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  allowDownload: z.boolean().optional().default(true),
  allowPreview: z.boolean().optional().default(true),
  maxDownloads: z.number().int().positive().nullable().optional(),
  resources: z
    .array(
      z.object({
        type: z.enum(["file", "folder", "campaign"]),
        id: z.string().uuid(),
      })
    )
    .min(1),
});

export async function POST(req: NextRequest) {
  try {
    const actor = await requireRole("admin");
    const body = CreateSchema.parse(await req.json());
    const db = supabaseAdmin();
    const token = generateToken();

    const { data: link, error } = await db
      .from("share_links")
      .insert({
        token,
        name: body.name ?? null,
        password_hash: body.password ? hashPassword(body.password) : null,
        allow_download: body.allowDownload,
        allow_preview: body.allowPreview,
        expires_at: body.expiresAt ?? null,
        max_downloads: body.maxDownloads ?? null,
        created_by: actor.id,
      })
      .select("id,token")
      .single();
    if (error) throw new Error(error.message);

    const rows = body.resources.map((r) => ({
      share_link_id: link.id,
      resource_type: r.type,
      resource_id: r.id,
    }));
    const { error: rErr } = await db.from("share_link_resources").insert(rows);
    if (rErr) throw new Error(rErr.message);

    await logActivity(actor.id, "share_link_created", {
      type: "share_link",
      id: link.id,
      detail: { name: body.name ?? null, resources: body.resources.length },
    });

    const url = `${req.nextUrl.origin}/share/${link.token}`;
    return NextResponse.json({ shareLink: { id: link.id, token: link.token, url } });
  } catch (e) {
    return handleError(e);
  }
}
