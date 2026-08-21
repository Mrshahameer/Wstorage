// Central access logic. Admins see everything. Employees see files whose folder
// is granted to them, plus files with no folder (the shared pool).
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { SessionUser } from "@/lib/auth";

export function isAdmin(user: SessionUser) {
  return user.role === "admin" || user.role === "super_admin";
}

/** Folder ids this user is granted (employees only need this). */
export async function grantedFolderIds(userId: string): Promise<string[]> {
  const { data } = await supabaseAdmin()
    .from("folder_access")
    .select("folder_id")
    .eq("user_id", userId);
  return (data ?? []).map((r: { folder_id: string }) => r.folder_id);
}

/** Can this user access a specific file? */
export async function canAccessFile(
  user: SessionUser,
  file: { folder_id: string | null }
): Promise<boolean> {
  if (isAdmin(user)) return true;
  if (!file.folder_id) return true; // shared pool
  const ids = await grantedFolderIds(user.id);
  return ids.includes(file.folder_id);
}

/**
 * The set of resources a (non-admin) user may VIEW, drawn from BOTH the legacy
 * grant tables (folder_access / category_access) AND the granular permission
 * table (user_resource_permissions, view+allow), with inheritance expanded:
 *   category grant  -> its verticals + their campaigns
 *   vertical grant  -> its campaigns
 *   folder grant    -> its descendant folders
 * The files listing ORs these together (plus the no-folder shared pool).
 */
export interface AccessScope {
  folderIds: string[];
  categoryIds: string[];
  verticalIds: string[];
  campaignIds: string[];
}

export async function accessScope(userId: string): Promise<AccessScope> {
  const db = supabaseAdmin();
  const folderIds = new Set<string>();
  const categoryIds = new Set<string>();
  const verticalIds = new Set<string>();
  const campaignIds = new Set<string>();

  const [{ data: fa }, { data: ca }, { data: urp }] = await Promise.all([
    db.from("folder_access").select("folder_id").eq("user_id", userId),
    db.from("category_access").select("category_id").eq("user_id", userId),
    db
      .from("user_resource_permissions")
      .select("resource_type,resource_id,access_mode,expires_at")
      .eq("user_id", userId)
      .eq("permission", "view"),
  ]);

  (fa ?? []).forEach((r: { folder_id: string }) => folderIds.add(r.folder_id));
  (ca ?? []).forEach((r: { category_id: string }) => categoryIds.add(r.category_id));
  const now = Date.now();
  (urp ?? []).forEach((r: { resource_type: string; resource_id: string; access_mode: string; expires_at: string | null }) => {
    if (r.access_mode !== "allow") return;
    if (r.expires_at && new Date(r.expires_at).getTime() <= now) return;
    if (r.resource_type === "folder") folderIds.add(r.resource_id);
    else if (r.resource_type === "category") categoryIds.add(r.resource_id);
    else if (r.resource_type === "vertical") verticalIds.add(r.resource_id);
    else if (r.resource_type === "campaign") campaignIds.add(r.resource_id);
  });

  // Expand categories -> verticals -> campaigns.
  if (categoryIds.size) {
    const { data: verts } = await db.from("verticals").select("id,category_id").in("category_id", Array.from(categoryIds));
    (verts ?? []).forEach((v: { id: string }) => verticalIds.add(v.id));
  }
  if (verticalIds.size) {
    const { data: camps } = await db.from("campaigns").select("id,vertical_id").in("vertical_id", Array.from(verticalIds));
    (camps ?? []).forEach((c: { id: string }) => campaignIds.add(c.id));
  }

  // Expand folders -> descendants.
  for (const fid of Array.from(folderIds)) {
    const { data: desc } = await db.rpc("folder_descendants", { root: fid });
    (desc ?? []).forEach((d: { id: string }) => folderIds.add(d.id));
  }

  return {
    folderIds: Array.from(folderIds),
    categoryIds: Array.from(categoryIds),
    verticalIds: Array.from(verticalIds),
    campaignIds: Array.from(campaignIds),
  };
}
