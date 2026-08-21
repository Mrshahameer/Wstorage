import { getSessionUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { DashboardHome } from "@/components/dashboard-home";
import { KeyRequestsPanel } from "@/components/key-requests-panel";

export default async function DashboardPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const isSuper = user.role === "super_admin";

  return (
    <div className="space-y-8">
      {/* Analytics + activity are super-admin only. */}
      <DashboardHome isAdmin={isSuper} email={user.email} />
      {isSuper && <KeyRequestsPanel isSuperAdmin={isSuper} />}
    </div>
  );
}
