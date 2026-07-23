import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { SignOutButton } from "@/components/sign-out-button";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const isAdmin = user.role === "admin" || user.role === "super_admin";

  return (
    <div className="min-h-screen flex">
      <aside className="w-56 shrink-0 border-r bg-white p-4">
        <div className="text-lg font-semibold">Wisko DAM</div>
        <nav className="mt-6 space-y-1 text-sm">
          <Link className="block rounded px-2 py-1.5 hover:bg-neutral-100" href="/dashboard">Dashboard</Link>
          <Link className="block rounded px-2 py-1.5 hover:bg-neutral-100" href="/files">Files</Link>
          {isAdmin && (
            <Link className="block rounded px-2 py-1.5 hover:bg-neutral-100" href="/settings/storage-keys">
              Storage Keys
            </Link>
          )}
        </nav>
        <div className="mt-8 text-xs text-neutral-500">
          <div>{user.email}</div>
          <div className="uppercase tracking-wide">{user.role.replace("_", " ")}</div>
          <div className="mt-3"><SignOutButton /></div>
        </div>
      </aside>
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
