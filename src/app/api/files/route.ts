import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { handleError } from "@/lib/api";
import { isAdmin, grantedFolderIds } from "@/lib/access";

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const db = supabaseAdmin();
    const { searchParams } = new URL(req.url);

    const q = searchParams.get("q")?.trim();
    const folderId = searchParams.get("folderId");
    const sort = searchParams.get("sort") ?? "created_at";
    const dir = (searchParams.get("dir") ?? "desc") === "asc";
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
    const pageSize = Math.min(100, parseInt(searchParams.get("pageSize") ?? "50", 10));

    let query = db
      .from("files")
      .select("id,name,description,extension,content_type,size_bytes,tags,download_count,created_at,folder_id,category_id", { count: "exact" })
      .eq("status", "ready");

    if (q) query = query.ilike("name", `%${q}%`);
    if (folderId) query = query.eq("folder_id", folderId);

    // Access control for non-admins: only granted folders + the shared (no-folder) pool.
    if (!isAdmin(user)) {
      const ids = await grantedFolderIds(user.id);
      if (ids.length) query = query.or(`folder_id.is.null,folder_id.in.(${ids.join(",")})`);
      else query = query.is("folder_id", null);
    }

    const allowedSort = ["created_at", "name", "download_count", "size_bytes"];
    const sortCol = allowedSort.includes(sort) ? sort : "created_at";

    const { data, count, error } = await query
      .order(sortCol, { ascending: dir })
      .range((page - 1) * pageSize, page * pageSize - 1);
    if (error) throw new Error(error.message);
    return NextResponse.json({ files: data ?? [], total: count ?? 0, page, pageSize });
  } catch (e) {
    return handleError(e);
  }
}
