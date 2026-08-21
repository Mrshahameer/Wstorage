// Granular, resource-level authorization for Wstorage.
//
// Model (see docs/PROJECT_PLAN.md §6 and migration 0006):
//   * Permissions attach to any resource: category | vertical | campaign | folder | file.
//   * Each grant is ALLOW or DENY for one action, may inherit to children, may expire.
//   * DENY always beats ALLOW. The MOST SPECIFIC matching rule wins.
//   * Admins (admin/super_admin) bypass everything.
//   * If NO explicit rule exists, we fall back to the legacy view-grants
//     (category_access / folder_access / file_access) so existing behavior is intact.
//
// SERVER ONLY — uses the service-role client.
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { SessionUser } from "@/lib/auth";
import { isAdmin } from "@/lib/access";

export type Action =
  | "view"
  | "download"
  | "upload"
  | "edit"
  | "delete"
  | "share"
  | "manage_access";

export type ResourceKind = "category" | "vertical" | "campaign" | "folder" | "file";

/** One node in a resource's ancestry chain, most-specific first. */
export interface ChainNode {
  kind: ResourceKind;
  id: string;
  /** higher = more specific; used to pick the winning rule */
  specificity: number;
}

interface PermRow {
  resource_type: ResourceKind;
  resource_id: string;
  permission: Action;
  access_mode: "allow" | "deny";
  inherit_to_children: boolean;
  expires_at: string | null;
}

const BASE_SPECIFICITY: Record<ResourceKind, number> = {
  file: 100,
  folder: 60, // folder depth added on top so nearer folders win
  campaign: 50,
  vertical: 40,
  category: 30,
};

function notExpired(row: PermRow): boolean {
  if (!row.expires_at) return true;
  return new Date(row.expires_at).getTime() > Date.now();
}

/** Build the ancestry chain for a file: file → folders(up) → campaign → vertical → category. */
export async function fileChain(fileId: string): Promise<ChainNode[]> {
  const db = supabaseAdmin();
  const { data: file } = await db
    .from("files")
    .select("id,folder_id,campaign_id,vertical_id")
    .eq("id", fileId)
    .single();
  if (!file) return [];

  const chain: ChainNode[] = [{ kind: "file", id: file.id, specificity: BASE_SPECIFICITY.file }];

  // Walk folder ancestry (nearer folders are more specific).
  let folderId: string | null = file.folder_id ?? null;
  let depth = 0;
  const seen = new Set<string>();
  while (folderId && !seen.has(folderId)) {
    seen.add(folderId);
    chain.push({ kind: "folder", id: folderId, specificity: BASE_SPECIFICITY.folder - depth });
    const { data: f } = await db.from("folders").select("parent_id,campaign_id,category_id").eq("id", folderId).single();
    folderId = f?.parent_id ?? null;
    depth += 1;
  }

  const campaignId: string | null = file.campaign_id ?? null;
  let verticalId: string | null = file.vertical_id ?? null;
  let categoryId: string | null = null;

  if (campaignId) {
    chain.push({ kind: "campaign", id: campaignId, specificity: BASE_SPECIFICITY.campaign });
    const { data: c } = await db.from("campaigns").select("vertical_id").eq("id", campaignId).single();
    if (c?.vertical_id) verticalId = c.vertical_id;
  }
  if (verticalId) {
    chain.push({ kind: "vertical", id: verticalId, specificity: BASE_SPECIFICITY.vertical });
    const { data: v } = await db.from("verticals").select("category_id").eq("id", verticalId).single();
    if (v?.category_id) categoryId = v.category_id;
  }
  if (categoryId) {
    chain.push({ kind: "category", id: categoryId, specificity: BASE_SPECIFICITY.category });
  }
  return chain;
}

/** Build the ancestry chain for a folder: folder → folders(up) → category. */
export async function folderChain(folderId: string): Promise<ChainNode[]> {
  const db = supabaseAdmin();
  const chain: ChainNode[] = [];
  let id: string | null = folderId;
  let depth = 0;
  let categoryId: string | null = null;
  const seen = new Set<string>();
  while (id && !seen.has(id)) {
    seen.add(id);
    chain.push({ kind: "folder", id, specificity: BASE_SPECIFICITY.folder - depth });
    const { data: f } = await db.from("folders").select("parent_id,category_id").eq("id", id).single();
    if (f?.category_id && !categoryId) categoryId = f.category_id;
    id = f?.parent_id ?? null;
    depth += 1;
  }
  if (categoryId) chain.push({ kind: "category", id: categoryId, specificity: BASE_SPECIFICITY.category });
  return chain;
}

/**
 * Resolve an action against a pre-computed resource chain.
 * Returns true/false when an explicit rule applies, or null when no rule exists
 * (caller decides the fallback).
 */
export async function resolveChain(
  userId: string,
  action: Action,
  chain: ChainNode[]
): Promise<boolean | null> {
  if (chain.length === 0) return null;
  const db = supabaseAdmin();
  const ids = chain.map((c) => c.id);
  const { data } = await db
    .from("user_resource_permissions")
    .select("resource_type,resource_id,permission,access_mode,inherit_to_children,expires_at")
    .eq("user_id", userId)
    .eq("permission", action)
    .in("resource_id", ids);

  const rows = (data ?? []) as PermRow[];
  let winner: { specificity: number; mode: "allow" | "deny" } | null = null;

  for (const node of chain) {
    for (const row of rows) {
      if (row.resource_id !== node.id || row.resource_type !== node.kind) continue;
      if (!notExpired(row)) continue;
      // Ancestor rules only apply if they inherit; the resource itself always applies.
      const isSelf = node.specificity >= BASE_SPECIFICITY.file || node === chain[0];
      if (!isSelf && !row.inherit_to_children) continue;
      // Most specific wins; DENY beats ALLOW at equal specificity.
      if (
        !winner ||
        node.specificity > winner.specificity ||
        (node.specificity === winner.specificity && row.access_mode === "deny")
      ) {
        winner = { specificity: node.specificity, mode: row.access_mode };
      }
    }
  }
  if (!winner) return null;
  return winner.mode === "allow";
}

/** Full check for a file: admins bypass, then explicit rules, then legacy view-grants. */
export async function canFile(user: SessionUser, action: Action, fileId: string): Promise<boolean> {
  if (isAdmin(user)) return true;
  const chain = await fileChain(fileId);
  const explicit = await resolveChain(user.id, action, chain);
  if (explicit !== null) return explicit;
  // Fallback: legacy behavior. View/download gated by folder/category/file grants;
  // mutating actions denied for non-admins by default.
  if (action === "view" || action === "download") {
    return legacyCanView(user, chain);
  }
  return false;
}

/** Full check for a folder. */
export async function canFolder(user: SessionUser, action: Action, folderId: string): Promise<boolean> {
  if (isAdmin(user)) return true;
  const chain = await folderChain(folderId);
  const explicit = await resolveChain(user.id, action, chain);
  if (explicit !== null) return explicit;
  if (action === "view" || action === "download") {
    return legacyCanView(user, chain);
  }
  return false;
}

/** Legacy fallback: user can view if any folder/category in the chain is granted to them. */
async function legacyCanView(user: SessionUser, chain: ChainNode[]): Promise<boolean> {
  const db = supabaseAdmin();
  const folderIds = chain.filter((c) => c.kind === "folder").map((c) => c.id);
  const categoryIds = chain.filter((c) => c.kind === "category").map((c) => c.id);
  if (folderIds.length) {
    const { data } = await db
      .from("folder_access")
      .select("folder_id")
      .eq("user_id", user.id)
      .in("folder_id", folderIds);
    if ((data ?? []).length) return true;
  }
  if (categoryIds.length) {
    const { data } = await db
      .from("category_access")
      .select("category_id")
      .eq("user_id", user.id)
      .in("category_id", categoryIds);
    if ((data ?? []).length) return true;
  }
  // No folder in the chain at all → shared pool (matches existing canAccessFile).
  if (folderIds.length === 0) return true;
  return false;
}
