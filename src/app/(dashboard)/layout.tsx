import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { SidebarNav } from "@/components/sidebar-nav";
import { SignOutButton } from "@/components/sign-out-button";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const isAdmin = user.role === "admin" || user.role === "super_admin";
  const isSuper = user.role === "super_admin";

  return (
    <div className="min-h-screen flex bg-slate-50">
      <aside className="hidden md:flex w-60 shrink-0 flex-col justify-between border-r border-slate-800 bg-slate-900 text-slate-300">
        <div>
          <div className="flex items-center gap-2 px-5 h-16 border-b border-slate-800">
            <div className="h-7 w-7 rounded-md bg-indigo-500 grid place-items-center text-white font-bold text-sm">W</div>
            <span className="text-white font-semibold tracking-tight">Wstorage</span>
          </div>
          <SidebarNav isAdmin={isAdmin} isSuper={isSuper} />
        </div>
        <div className="px-5 py-4 border-t border-slate-800">
          <div className="text-sm text-slate-200 truncate">{user.email}</div>
          <div className="text-[11px] uppercase tracking-wider text-indigo-400 mt-0.5">
            {user.role.replace("_", " ")}
          </div>
          <div className="mt-3"><SignOutButton /></div>
        </div>
      </aside>
      <main className="flex-1 min-w-0">
        <div className="mx-auto max-w-6xl px-6 py-8">{children}</div>
      </main>
    </div>
  );
}
