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
