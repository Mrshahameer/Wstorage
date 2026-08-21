// Public share-link engine. A share link exposes a set of resources
// (files, folders, or campaigns) to someone WITHOUT an account, optionally
// behind a password / expiry / download cap. SERVER ONLY.
//
// Security: the original storage URL is never exposed. Every hit re-validates
// the token, then mints a short-lived signed storage URL. See docs/PROJECT_PLAN.md §7.
import crypto from "crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getProviderForKeyId } from "@/lib/storage";
import { env } from "@/lib/env";

export interface ShareLinkRow {
  id: string;
  token: string;
  name: string | null;
  password_hash: string | null;
  allow_preview: boolean;
  allow_download: boolean;
  expires_at: string | null;
  max_downloads: number | null;
  current_downloads: number;
  max_views: number | null;
  current_views: number;
  status: "active" | "disabled";
}

export interface ShareFile {
  id: string;
  name: string;
  size_bytes: number;
  content_type: string | null;
  object_key: string;
  storage_key_id: string;
}

/** URL-safe token, ~22 chars. */
export function generateToken(): string {
  return crypto.randomBytes(16).toString("base64url");
}

/** scrypt password hash, stored as salt_b64.hash_b64. */
export function hashPassword(plain: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(plain, salt, 32);
  return `${salt.toString("base64")}.${hash.toString("base64")}`;
}

export function verifyPassword(plain: string, stored: string): boolean {
  const [saltB64, hashB64] = stored.split(".");
  if (!saltB64 || !hashB64) return false;
  const salt = Buffer.from(saltB64, "base64");
  const expected = Buffer.from(hashB64, "base64");
  const actual = crypto.scryptSync(plain, salt, 32);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

/** Reasons a link may be unusable. null = OK. */
export function linkProblem(link: ShareLinkRow): string | null {
  if (link.status !== "active") return "This link has been disabled.";
  if (link.expires_at && new Date(link.expires_at).getTime() <= Date.now()) return "This link has expired.";
  if (link.max_downloads != null && link.current_downloads >= link.max_downloads)
    return "This link has reached its download limit.";
  return null;
}

export async function loadLink(token: string): Promise<ShareLinkRow | null> {
  const { data } = await supabaseAdmin()
    .from("share_links")
    .select(
      "id,token,name,password_hash,allow_preview,allow_download,expires_at,max_downloads,current_downloads,max_views,current_views,status"
    )
    .eq("token", token)
    .maybeSingle();
  return (data as ShareLinkRow) ?? null;
}

/** Expand the link's resource refs into a flat, de-duplicated list of files. */
export async function expandFiles(shareLinkId: string): Promise<ShareFile[]> {
  const db = supabaseAdmin();
  const { data: refs } = await db
    .from("share_link_resources")
    .select("resource_type,resource_id")
    .eq("share_link_id", shareLinkId);

  const fileIds = new Set<string>();
  const cols = "id,name,size_bytes,content_type,object_key,storage_key_id,status";
  const files: Record<string, ShareFile> = {};

  const addRows = (rows: (ShareFile & { status: string })[] | null) => {
    for (const r of rows ?? []) {
      if (r.status === "ready" && !files[r.id]) {
        files[r.id] = {
          id: r.id,
          name: r.name,
          size_bytes: r.size_bytes,
          content_type: r.content_type,
          object_key: r.object_key,
          storage_key_id: r.storage_key_id,
        };
      }
    }
  };

  for (const ref of refs ?? []) {
    if (ref.resource_type === "file") {
      fileIds.add(ref.resource_id);
    } else if (ref.resource_type === "folder") {
      const { data: descendants } = await db.rpc("folder_descendants", { root: ref.resource_id });
      const folderIds = (descendants ?? []).map((d: { id: string }) => d.id);
      if (folderIds.length) {
        const { data } = await db.from("files").select(cols).in("folder_id", folderIds);
        addRows(data);
      }
    } else if (ref.resource_type === "campaign") {
      const { data } = await db.from("files").select(cols).eq("campaign_id", ref.resource_id);
      addRows(data);
    }
  }
  if (fileIds.size) {
    const { data } = await db.from("files").select(cols).in("id", Array.from(fileIds));
    addRows(data);
  }
  return Object.values(files);
}

/** Mint a short-lived signed download URL for one file in a link, and count it. */
export async function signShareDownload(link: ShareLinkRow, file: ShareFile): Promise<string> {
  const provider = await getProviderForKeyId(file.storage_key_id);
  const url = await provider.createDownloadUrl(file.object_key, env.signedUrlTtl(), file.name);
  await supabaseAdmin()
    .from("share_links")
    .update({ current_downloads: link.current_downloads + 1 })
    .eq("id", link.id);
  return url;
}
