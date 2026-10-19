import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, logActivity, AuthError } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { handleError } from "@/lib/api";
import { isAdmin, accessScope } from "@/lib/access";
import { canShareResource } from "@/lib/permissions";
import { generateToken, hashPassword } from "@/lib/share";

export async function GET() {
  try {
    const user = await requireRole("bd_manager");
    let q = supabaseAdmin()
      .from("share_links")
      .select(
        "id,token,name,allow_download,allow_preview,expires_at,max_downloads,current_downloads,status,created_at"
      )
      .order("created_at", { ascending: false });
    // Non-admins see only the links they created.
    if (!isAdmin(user)) q = q.eq("created_by", user.id);
    const { data } = await q;
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
        type: z.enum(["file", "folder", "campaign", "vertical", "category"]),
        id: z.string().uuid(),
      })
    )
    .min(1),
});

export async function POST(req: NextRequest) {
  try {
    const actor = await requireRole("bd_manager");
    const body = CreateSchema.parse(await req.json());
    const db = supabaseAdmin();
    const admin = isAdmin(actor);
    const scope = admin ? null : await accessScope(actor.id);
    const accCampaigns = scope ? new Set(scope.campaignIds) : null;

    // The share_link_resources table stores only file/folder/campaign. A vertical
    // or category is expanded here into the campaigns beneath it. Non-admins get
    // only the parts they can access, so nothing is over-shared.
    const final: { type: "file" | "folder" | "campaign"; id: string }[] = [];
    const seen = new Set<string>();
    const addCampaign = (id: string) => {
      if (accCampaigns && !accCampaigns.has(id)) return;
      const k = "campaign:" + id;
      if (!seen.has(k)) { seen.add(k); final.push({ type: "campaign", id }); }
    };
    for (const r of body.resources) {
      if (r.type === "campaign") {
        addCampaign(r.id);
      } else if (r.type === "vertical") {
        const { data } = await db.from("campaigns").select("id").eq("vertical_id", r.id);
        (data ?? []).forEach((c: { id: string }) => addCampaign(c.id));
      } else if (r.type === "category") {
        const { data: verts } = await db.from("verticals").select("id").eq("category_id", r.id);
        for (const v of verts ?? []) {
          const { data } = await db.from("campaigns").select("id").eq("vertical_id", v.id);
          (data ?? []).forEach((c: { id: string }) => addCampaign(c.id));
        }
      } else {
        // file or folder — keep as-is, but a non-admin must have access to it.
        if (admin || (await canShareResource(actor, r.type, r.id))) {
          const k = r.type + ":" + r.id;
          if (!seen.has(k)) { seen.add(k); final.push({ type: r.type, id: r.id }); }
        }
      }
    }
    if (!final.length) throw new AuthError(400, "Nothing to share — pick a resource you have access to.");

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

    const rows = final.map((r) => ({
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
