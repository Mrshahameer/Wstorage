import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { StorageKeysManager } from "@/components/storage-keys-manager";

export default async function StorageKeysPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== "admin" && user.role !== "super_admin") redirect("/dashboard");
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Storage keys</h1>
      <p className="text-sm text-slate-500 mt-1">Manage the Backblaze credentials used for uploads. Add a new key, make it active, revoke the old one — no redeploy.</p>
      <div className="mt-6"><StorageKeysManager /></div>
    </div>
  );
}
