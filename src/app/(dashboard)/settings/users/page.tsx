import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { UsersManager } from "@/components/users-manager";

export default async function UsersPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== "admin" && user.role !== "super_admin") redirect("/dashboard");
  return <UsersManager canManage={user.role === "super_admin"} />;
}
