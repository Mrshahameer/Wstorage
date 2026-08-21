import { getSessionUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { AssetDetail } from "@/components/asset-detail";

export default async function AssetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const { id } = await params;
  const canShare = user.role === "admin" || user.role === "super_admin";
  return <AssetDetail id={id} canShare={canShare} />;
}
