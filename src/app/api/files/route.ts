import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { handleError } from "@/lib/api";
import { isAdmin, accessScope } from "@/lib/access";

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const db = supabaseAdmin();
    const { searchParams } = new URL(req.url);

    const q = searchParams.get("q")?.trim();
    const folderId = searchParams.get("folderId");
    const categoryId = searchParams.get("categoryId");
    const campaignId = searchParams.get("campaignId");
    const verticalId = searchParams.get("verticalId");
    const resourceTypeId = searchParams.get("resourceTypeId");
    const ext = searchParams.get("ext")?.trim().toLowerCase().replace(/^\./, "");
    const sort = searchParams.get("sort") ?? "created_at";
    const dir = (searchParams.get("dir") ?? "desc") === "asc";
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
    const pageSize = Math.min(100, parseInt(searchParams.get("pageSize") ?? "50", 10));

    let query = db
      .from("files")
      .select("id,name,description,extension,content_type,size_bytes,tags,download_count,created_at,folder_id,category_id,resource_type_id,resource_types(name),storage_key_id,storage_keys(provider,label,bucket_name)", { count: "exact" })
      .eq("status", "ready");

    if (q) {
      // Multi-field search across Name, Description, Extension, and Tags array
      query = query.or(`name.ilike.%${q}%,description.ilike.%${q}%,extension.ilike.%${q}%,tags.cs.{${q}}`);
    }
    if (folderId) query = query.eq("folder_id", folderId);
    if (categoryId) query = query.eq("category_id", categoryId);
    if (campaignId) query = query.eq("campaign_id", campaignId);
    if (verticalId) query = query.eq("vertical_id", verticalId);
    if (resourceTypeId) query = query.eq("resource_type_id", resourceTypeId);
    if (ext) query = query.eq("extension", ext);

    // Access control for non-admins: the shared (no-folder) pool + everything granted
    // to them across folders / categories / verticals / campaigns (with inheritance).
    if (!isAdmin(user)) {
      const scope = await accessScope(user.id);
      const ors = ["folder_id.is.null"];
      if (scope.folderIds.length) ors.push(`folder_id.in.(${scope.folderIds.join(",")})`);
      if (scope.categoryIds.length) ors.push(`category_id.in.(${scope.categoryIds.join(",")})`);
      if (scope.verticalIds.length) ors.push(`vertical_id.in.(${scope.verticalIds.join(",")})`);
      if (scope.campaignIds.length) ors.push(`campaign_id.in.(${scope.campaignIds.join(",")})`);
      query = query.or(ors.join(","));
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
