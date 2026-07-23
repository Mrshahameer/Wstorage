import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { handleError } from "@/lib/api";

export async function GET(req: NextRequest) {
  try {
    await requireUser();
    const db = supabaseAdmin();
    const { searchParams } = new URL(req.url);

    const q = searchParams.get("q")?.trim();
    const folderId = searchParams.get("folderId");
    const categoryId = searchParams.get("categoryId");
    const sort = searchParams.get("sort") ?? "created_at";
    const dir = (searchParams.get("dir") ?? "desc") === "asc" ? true : false;
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
    const pageSize = Math.min(100, parseInt(searchParams.get("pageSize") ?? "24", 10));

    let query = db
      .from("files")
      .select("id,name,description,extension,content_type,size_bytes,tags,download_count,created_at,current_version", { count: "exact" })
      .eq("status", "ready");

    if (q) query = query.ilike("name", `%${q}%`);
    if (folderId) query = query.eq("folder_id", folderId);
    if (categoryId) query = query.eq("category_id", categoryId);

    const allowedSort = ["created_at", "name", "download_count", "size_bytes"];
    const sortCol = allowedSort.includes(sort) ? sort : "created_at";
    query = query.order(sortCol, { ascending: dir }).range((page - 1) * pageSize, page * pageSize - 1);

    const { data, count, error } = await query;
    if (error) throw new Error(error.message);
    return NextResponse.json({ files: data, total: count ?? 0, page, pageSize });
  } catch (e) {
    return handleError(e);
  }
}
