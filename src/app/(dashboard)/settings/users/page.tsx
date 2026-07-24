import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { UsersManager } from "@/components/users-manager";

export default async function UsersPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== "admin" && user.role !== "super_admin") redirect("/dashboard");
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Users &amp; access</h1>
      <p className="text-sm text-slate-500 mt-1">Invite people, set roles, and choose which folders each employee can see.</p>
      <div className="mt-6"><UsersManager canManage={user.role === "super_admin"} /></div>
    </div>
  );
}
