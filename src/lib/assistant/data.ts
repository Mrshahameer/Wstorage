// Server-side data access for the assistant: loads the catalog rows (paged, so
// it never stops at Supabase's 1,000-row default), caches them briefly, and
// fetches the actual file rows the tools return. SERVER ONLY.
import { supabaseAdmin } from "@/lib/supabase/admin";
import { accessScope, isAdmin } from "@/lib/access";
import type { SessionUser } from "@/lib/auth";
import { buildCatalog, type Catalog, type Rows, type Scope } from "./catalog";

const PAGE = 1000;
const TTL_MS = 30_000;

type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

/** Read every row of a query, 1,000 at a time. The query must have a stable order. */
async function selectAll<T>(page: (from: number, to: number) => Page<T>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < 100_000; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

async function fetchRows(): Promise<Rows> {
  const db = supabaseAdmin();
  const [categories, verticals, campaignTypes, campaigns, folders, files] = await Promise.all([
    selectAll<Rows["categories"][number]>((a, b) => db.from("categories").select("id,name").order("id").range(a, b)),
    selectAll<Rows["verticals"][number]>((a, b) => db.from("verticals").select("id,name,category_id").order("id").range(a, b)),
    selectAll<Rows["campaignTypes"][number]>((a, b) => db.from("campaign_types").select("id,name").order("id").range(a, b)),
    selectAll<Rows["campaigns"][number]>((a, b) => db.from("campaigns").select("id,name,vertical_id,campaign_type_id").order("id").range(a, b)),
    selectAll<Rows["folders"][number]>((a, b) => db.from("folders").select("id,name,parent_id,campaign_id,sort").order("id").range(a, b)),
    selectAll<Rows["files"][number]>((a, b) =>
      db.from("files").select("folder_id").eq("status", "ready").eq("is_archived", false).order("id").range(a, b)),
  ]);
  return { categories, verticals, campaignTypes, campaigns, folders, files };
}

// Short cache so a chat burst does not re-read the library on every message.
// Same-instance writes call invalidateCatalog(); other instances refresh in 30s.
let rowsCache: { at: number; rows: Promise<Rows> } | null = null;
const scopeCache = new Map<string, { at: number; scope: Promise<Scope> }>();

export function invalidateCatalog() {
  rowsCache = null;
  scopeCache.clear();
}

function cachedRows(): Promise<Rows> {
  if (!rowsCache || Date.now() - rowsCache.at > TTL_MS) {
    const rows = fetchRows();
    rowsCache = { at: Date.now(), rows };
    rows.catch(() => { if (rowsCache?.rows === rows) rowsCache = null; });
  }
  return rowsCache.rows;
}

function cachedScope(userId: string): Promise<Scope> {
  const hit = scopeCache.get(userId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.scope;
  const scope = accessScope(userId).then((s) => ({ campaignIds: s.campaignIds, folderIds: s.folderIds }));
  scopeCache.set(userId, { at: Date.now(), scope });
  scope.catch(() => scopeCache.delete(userId));
  return scope;
}

export async function loadCatalog(user: SessionUser): Promise<Catalog> {
  const [rows, scope] = await Promise.all([cachedRows(), isAdmin(user) ? Promise.resolve(null) : cachedScope(user.id)]);
  return buildCatalog(rows, scope);
}

// ---- File rows for tool results ---------------------------------------------

export interface FileRow {
  id: string;
  name: string;
  description: string | null;
  extension: string | null;
  content_type: string | null;
  size_bytes: number;
  created_at: string;
  updated_at: string;
  tags: string[] | null;
  live_url: string | null;
  folder_id: string | null;
}

export interface FileSource {
  /** Files in any of these folders, newest first, capped at `limit`, plus the true total. */
  byFolders(folderIds: string[], limit: number): Promise<{ rows: FileRow[]; total: number }>;
  /** Files whose name, description or tags contain any of these words. */
  search(words: string[], limit: number): Promise<FileRow[]>;
}

const FILE_COLS = "id,name,description,extension,content_type,size_bytes,created_at,updated_at,tags,live_url,folder_id";

export function supabaseFileSource(): FileSource {
  const db = supabaseAdmin();
  return {
    async byFolders(folderIds, limit) {
      if (!folderIds.length) return { rows: [], total: 0 };
      const rows: FileRow[] = [];
      let total = 0;
      for (let i = 0; i < folderIds.length; i += 100) {
        const chunk = folderIds.slice(i, i + 100);
        const { data, count, error } = await db
          .from("files")
          .select(FILE_COLS, { count: "exact" })
          .in("folder_id", chunk)
          .eq("status", "ready")
          .eq("is_archived", false)
          .order("created_at", { ascending: false })
          .limit(limit);
        if (error) throw new Error(error.message);
        rows.push(...((data ?? []) as FileRow[]));
        total += count ?? 0;
      }
      rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
      return { rows: rows.slice(0, limit), total };
    },
    async search(words, limit) {
      const safe = words.map((w) => w.replace(/[^a-z0-9]/gi, "")).filter((w) => w.length >= 2).slice(0, 6);
      if (!safe.length) return [];
      const or = safe.flatMap((w) => [`name.ilike.%${w}%`, `description.ilike.%${w}%`, `tags.cs.{${w}}`]).join(",");
      const { data, error } = await db
        .from("files")
        .select(FILE_COLS)
        .or(or)
        .eq("status", "ready")
        .eq("is_archived", false)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw new Error(error.message);
      return (data ?? []) as FileRow[];
    },
  };
}
