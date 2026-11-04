"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

// Clean line icons (Lucide-style), inline so there is no extra dependency.
const I = {
  dashboard: "M3 12l9-9 9 9M5 10v10a1 1 0 001 1h4v-6h4v6h4a1 1 0 001-1V10",
  library: "M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z",
  assistant: "M12 3l1.9 4.6L18.5 9l-4.6 1.9L12 15l-1.9-4.1L5.5 9l4.6-1.4L12 3zM18 14l.9 2.1L21 17l-2.1.9L18 20l-.9-2.1L15 17l2.1-.9L18 14z",
  search: "M11 19a8 8 0 100-16 8 8 0 000 16zm10 2l-4.3-4.3",
  shared: "M4 12v7a1 1 0 001 1h14a1 1 0 001-1v-7M16 6l-4-4-4 4M12 2v13",
  campaigns: "M3 11l14-6v14L3 13v-2zM3 11v2a2 2 0 002 2h1M17 7a4 4 0 010 6",
  categories: "M4 5h7v7H4V5zm9 0h7v4h-7V5zm0 6h7v7h-7v-7zm-9 3h7v4H4v-4z",
  folders: "M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z",
  users: "M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM22 21v-2a4 4 0 00-3-3.9M16 3.1a4 4 0 010 7.8",
  roles: "M12 2l8 4v6c0 5-3.4 8.3-8 10-4.6-1.7-8-5-8-10V6l8-4z",
  share: "M18 8a3 3 0 10-2.8-4H15M6 15a3 3 0 100-6 3 3 0 000 6zm9 7a3 3 0 100-6 3 3 0 000 6zM8.6 13.5l6.8 4M15.4 6.5l-6.8 4",
  ai: "M9 3h6M12 3v3M7 6h10a2 2 0 012 2v9a2 2 0 01-2 2H7a2 2 0 01-2-2V8a2 2 0 012-2zM9 11h.01M15 11h.01M9 15h6",
  activity: "M3 12h4l3 8 4-16 3 8h4",
  keys: "M15 7a4 4 0 11-5.9 3.5L3 16.6V20h3.4l.9-.9H9v-1.8h1.8l1.2-1.2A4 4 0 1015 7zm2 2h.01",
};
type IconKey = keyof typeof I;

function Icon({ name }: { name: IconKey }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px] shrink-0">
      <path d={I[name]} />
    </svg>
  );
}

type Row = { href: string; label: string; icon: IconKey; show: boolean };

export function SidebarNav({ isAdmin, isSuper, canShare }: { isAdmin: boolean; isSuper: boolean; canShare: boolean }) {
  const path = usePathname();
  const main: Row[] = [
    { href: "/dashboard", label: "Dashboard", icon: "dashboard", show: true },
    { href: "/library", label: "Campaign Library", icon: "library", show: true },
    { href: "/assistant", label: "AI Search Assistant", icon: "assistant", show: true },
    { href: "/files", label: "Search", icon: "search", show: true },
    { href: "/shared", label: "Shared with me", icon: "shared", show: true },
  ];
  const admin: Row[] = [
    { href: "/settings/campaigns", label: "Campaign management", icon: "campaigns", show: isAdmin },
    { href: "/settings/categories", label: "Categories", icon: "categories", show: isAdmin },
    { href: "/settings/folders", label: "Folders", icon: "folders", show: isAdmin },
    { href: "/settings/users", label: "Users & access", icon: "users", show: isAdmin },
    { href: "/settings/roles", label: "Roles & permissions", icon: "roles", show: isAdmin },
    { href: "/settings/share-links", label: "Share links", icon: "share", show: canShare },
    { href: "/settings/ai", label: "AI Control", icon: "ai", show: isAdmin },
    { href: "/settings/activity", label: "Activity logs", icon: "activity", show: isSuper },
    { href: "/settings/storage-keys", label: "Storage keys", icon: "keys", show: isAdmin },
  ];

  const render = (l: Row) => {
    const active = path === l.href || path.startsWith(l.href + "/");
    return (
      <Link
        key={l.href}
        href={l.href}
        className={
          "group relative flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-all duration-150 tapsable " +
          (active
            ? "bg-gradient-to-r from-indigo-500 to-violet-500 text-white shadow-lg shadow-indigo-900/30"
            : "text-slate-300 hover:bg-white/5 hover:text-white")
        }
      >
        {active && <span className="absolute -left-1.5 top-1/2 h-5 w-1 -translate-y-1/2 rounded-full bg-white/90" />}
        <span className={active ? "text-white" : "text-slate-400 group-hover:text-indigo-300"}>
          <Icon name={l.icon} />
        </span>
        <span className="truncate">{l.label}</span>
      </Link>
    );
  };

  return (
    <nav className="px-3 py-4 space-y-1">
      {main.filter((l) => l.show).map(render)}
      {admin.some((l) => l.show) && (
        <div className="px-3 pt-6 pb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          Administration
        </div>
      )}
      {admin.filter((l) => l.show).map(render)}
    </nav>
  );
}
