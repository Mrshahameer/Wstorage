import { getSessionUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { FilesBrowser } from "@/components/files-browser";

export default async function FilesPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const canUpload = user.role === "admin" || user.role === "super_admin";
  return <FilesBrowser canUpload={canUpload} />;
}
