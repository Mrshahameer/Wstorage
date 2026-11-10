import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser, roleAtLeast } from "@/lib/auth";
import { SidebarNav } from "@/components/sidebar-nav";
import { SignOutButton } from "@/components/sign-out-button";
import { MobileNav } from "@/components/mobile-nav";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const isAdmin = user.role === "admin" || user.role === "super_admin";
  const isSuper = user.role === "super_admin";
  const canShare = roleAtLeast(user.role, "bd_manager");

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 md:flex-row">
      <MobileNav
        isAdmin={isAdmin}
        isSuper={isSuper}
        canShare={canShare}
        email={user.email}
        role={user.role}
        version={process.env.NEXT_PUBLIC_BUILD_SHA ?? "local"}
      />
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col justify-between overflow-y-auto border-r border-slate-800/60 bg-gradient-to-b from-slate-900 to-slate-950 text-slate-300 md:flex">
        <div>
          <div className="flex items-center gap-2.5 px-5 h-16 border-b border-slate-800/60">
            <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 grid place-items-center text-white font-bold text-sm shadow-lg shadow-indigo-900/30">W</div>
            <span className="text-white font-semibold tracking-tight">Wstorage</span>
          </div>
          <SidebarNav isAdmin={isAdmin} isSuper={isSuper} canShare={canShare} />
        </div>
        <div className="px-5 py-4 border-t border-slate-800">
          <div className="text-sm text-slate-200 truncate">{user.email}</div>
          <div className="text-[11px] uppercase tracking-wider text-indigo-400 mt-0.5">
            {user.role.replace("_", " ")}
          </div>
          <div className="mt-3"><SignOutButton /></div>
          <div className="mt-3 text-[10px] text-slate-500" title={`Built ${process.env.NEXT_PUBLIC_BUILD_TIME}`}>
            Version {process.env.NEXT_PUBLIC_BUILD_SHA} · {new Date(process.env.NEXT_PUBLIC_BUILD_TIME ?? Date.now()).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}
          </div>
        </div>
      </aside>
      <main className="flex-1 min-w-0">
        <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">{children}</div>
      </main>
    </div>
  );
}
