"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const item = (active: boolean) =>
  `flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition ${
    active ? "bg-slate-800 text-white" : "text-slate-300 hover:bg-slate-800/60 hover:text-white"
  }`;

export function SidebarNav({ isAdmin, isSuper }: { isAdmin: boolean; isSuper: boolean }) {
  const path = usePathname();
  const main: { href: string; label: string; show: boolean }[] = [
    { href: "/dashboard", label: "Dashboard", show: true },
    { href: "/library", label: "Campaign Library", show: true },
    { href: "/files", label: "Search", show: true },
    { href: "/shared", label: "Shared with me", show: true },
  ];
  const admin: { href: string; label: string; show: boolean }[] = [
    { href: "/settings/campaigns", label: "Campaign management", show: isAdmin },
    { href: "/settings/categories", label: "Categories", show: isAdmin },
    { href: "/settings/folders", label: "Folders", show: isAdmin },
    { href: "/settings/users", label: "Users & access", show: isAdmin },
    { href: "/settings/roles", label: "Roles & permissions", show: isAdmin },
    { href: "/settings/share-links", label: "Share links", show: isAdmin },
    { href: "/settings/activity", label: "Activity logs", show: isAdmin },
    { href: "/settings/storage-keys", label: "Storage keys", show: isAdmin },
  ];
  const render = (l: { href: string; label: string }) => (
    <Link key={l.href} href={l.href} className={item(path === l.href || path.startsWith(l.href + "/"))}>
      {l.label}
    </Link>
  );
  return (
    <nav className="px-3 py-4 space-y-1">
      {main.filter((l) => l.show).map(render)}
      {admin.some((l) => l.show) && (
        <div className="px-3 pt-5 pb-1 text-[11px] font-medium uppercase tracking-wider text-slate-500">
          Administration
        </div>
      )}
      {admin.filter((l) => l.show).map(render)}
    </nav>
  );
}
