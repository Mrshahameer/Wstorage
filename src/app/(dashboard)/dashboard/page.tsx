import { getSessionUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { DashboardHome } from "@/components/dashboard-home";
import { KeyRequestsPanel } from "@/components/key-requests-panel";

export default async function DashboardPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const isAdmin = user.role === "admin" || user.role === "super_admin";
  const isSuper = user.role === "super_admin";

  return (
    <div className="space-y-8">
      <DashboardHome isAdmin={isAdmin} email={user.email} />
      {isAdmin && <KeyRequestsPanel isSuperAdmin={isSuper} />}
    </div>
  );
}
