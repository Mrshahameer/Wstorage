import { getSessionUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { CampaignLibrary } from "@/components/campaign-library";

export default async function LibraryPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return <CampaignLibrary />;
}
