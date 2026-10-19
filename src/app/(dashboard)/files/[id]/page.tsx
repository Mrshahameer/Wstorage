import { getSessionUser, roleAtLeast } from "@/lib/auth";
import { redirect } from "next/navigation";
import { AssetDetail } from "@/components/asset-detail";

export default async function AssetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const { id } = await params;
  const canShare = roleAtLeast(user.role, "bd_manager");
  return <AssetDetail id={id} canShare={canShare} />;
}
