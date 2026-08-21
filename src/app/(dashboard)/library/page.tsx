import { getSessionUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { CampaignLibrary } from "@/components/campaign-library";

export default async function LibraryPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  // Only super admins may upload into asset folders.
  const canUpload = user.role === "super_admin";
  return <CampaignLibrary canUpload={canUpload} />;
}
