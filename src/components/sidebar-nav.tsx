"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const item = (active: boolean) =>
  `flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition ${
    active ? "bg-slate-800 text-white" : "text-slate-300 hover:bg-slate-800/60 hover:text-white"
  }`;

export function SidebarNav({ isAdmin, isSuper }: { isAdmin: boolean; isSuper: boolean }) {
  const path = usePathname();
  const links: { href: string; label: string; show: boolean }[] = [
    { href: "/dashboard", label: "Dashboard", show: true },
    { href: "/files", label: "Files", show: true },
    { href: "/settings/categories", label: "Categories", show: isAdmin },
    { href: "/settings/folders", label: "Folders", show: isAdmin },
    { href: "/settings/users", label: "Users & access", show: isAdmin },
    { href: "/settings/storage-keys", label: "Storage keys", show: isAdmin },
  ];
  return (
    <nav className="px-3 py-4 space-y-1">
      {links.filter((l) => l.show).map((l) => (
        <Link key={l.href} href={l.href} className={item(path === l.href || path.startsWith(l.href + "/"))}>
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
