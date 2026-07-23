import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { StorageKeysManager } from "@/components/storage-keys-manager";

export default async function StorageKeysPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== "admin" && user.role !== "super_admin") redirect("/dashboard");

  return (
    <div>
      <h1 className="text-xl font-semibold">Storage Keys</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Manage the Backblaze credentials the system uploads to. Add a new key, make it active, and revoke the old one — no redeploy needed.
      </p>
      <div className="mt-6">
        <StorageKeysManager />
      </div>
    </div>
  );
}
