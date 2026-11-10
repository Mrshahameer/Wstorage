"use client";
// Phone and small-tablet navigation: a top bar with a menu button that opens the
// same links as the desktop sidebar in a slide-out panel. Hidden from md up.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { SidebarNav } from "./sidebar-nav";
import { SignOutButton } from "./sign-out-button";

interface Props {
  isAdmin: boolean;
  isSuper: boolean;
  canShare: boolean;
  email: string;
  role: string;
  version: string;
}

export function MobileNav({ isAdmin, isSuper, canShare, email, role, version }: Props) {
  const [open, setOpen] = useState(false);
  const path = usePathname();

  // Close after navigating, and on Escape.
  useEffect(() => { setOpen(false); }, [path]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden"; // keep the page still behind the menu
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener("keydown", onKey); };
  }, [open]);

  return (
    <>
      <header className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-slate-800/60 bg-slate-900 px-4 text-white md:hidden">
        <button
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          aria-expanded={open}
          className="tapsable -ml-1 grid h-10 w-10 place-items-center rounded-lg text-slate-200 hover:bg-white/10"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="h-6 w-6">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>
        <Link href="/dashboard" className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-500 text-xs font-bold">W</span>
          <span className="font-semibold tracking-tight">Wstorage</span>
        </Link>
        <Link
          href="/assistant"
          aria-label="AI Search Assistant"
          className="tapsable ml-auto grid h-10 w-10 place-items-center rounded-lg text-indigo-300 hover:bg-white/10"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
            <path d="M12 2l1.8 4.6L18.5 8.5l-4.7 1.9L12 15l-1.8-4.6L5.5 8.5l4.7-1.9L12 2z" />
            <path d="M18 13l.9 2.3L21.5 16l-2.6 1-.9 2.3-.9-2.3-2.6-1 2.6-.7L18 13z" />
          </svg>
        </Link>
      </header>

      <div
        className={"fixed inset-0 z-50 md:hidden " + (open ? "" : "pointer-events-none")}
        aria-hidden={!open}
      >
        <div
          onClick={() => setOpen(false)}
          className={"absolute inset-0 bg-slate-950/60 transition-opacity duration-200 " + (open ? "opacity-100" : "opacity-0")}
        />
        <aside
          role="dialog"
          aria-label="Menu"
          className={
            "absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-gradient-to-b from-slate-900 to-slate-950 text-slate-300 shadow-2xl transition-transform duration-200 " +
            (open ? "translate-x-0" : "-translate-x-full")
          }
        >
          <div className="flex h-14 shrink-0 items-center justify-between border-b border-slate-800/60 px-4">
            <span className="flex items-center gap-2">
              <span className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-500 text-xs font-bold text-white">W</span>
              <span className="font-semibold tracking-tight text-white">Wstorage</span>
            </span>
            <button onClick={() => setOpen(false)} aria-label="Close menu" className="tapsable grid h-10 w-10 place-items-center rounded-lg text-slate-300 hover:bg-white/10">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="h-5 w-5"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </div>
          <div className="nice-scroll flex-1 overflow-y-auto">
            <SidebarNav isAdmin={isAdmin} isSuper={isSuper} canShare={canShare} />
          </div>
          <div className="shrink-0 border-t border-slate-800 px-5 py-4">
            <div className="truncate text-sm text-slate-200">{email}</div>
            <div className="mt-0.5 text-[11px] uppercase tracking-wider text-indigo-400">{role.replace("_", " ")}</div>
            <div className="mt-3"><SignOutButton /></div>
            <div className="mt-3 text-[10px] text-slate-500">Version {version}</div>
          </div>
        </aside>
      </div>
    </>
  );
}
