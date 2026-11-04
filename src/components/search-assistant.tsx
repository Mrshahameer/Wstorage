"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

interface Result {
  id: string;
  title: string;
  path: string;
  score: number;
  link: string;
  assetHint: string | null;
}
interface Msg {
  role: "user" | "assistant";
  content: string;
  results?: Result[];
}

const GREETING = "Hi. Tell me what you are looking for and I will find the campaign folder.";
const SUGGESTIONS = [
  "Auto insurance live transfer creatives",
  "Final expense transfer scripts",
  "Windows warm transfer landing pages",
  "Roofing inbound recordings",
];

function Sparkle({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 2l1.8 4.6L18.5 8.5l-4.7 1.9L12 15l-1.8-4.6L5.5 8.5l4.7-1.9L12 2z" />
      <path d="M18 13l.9 2.3L21.5 16l-2.6 1-.9 2.3-.9-2.3-2.6-1 2.6-.7L18 13z" />
    </svg>
  );
}
function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
  );
}
function Badge({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const tone = pct >= 80 ? "bg-emerald-50 text-emerald-600 ring-emerald-200" : pct >= 55 ? "bg-amber-50 text-amber-600 ring-amber-200" : "bg-slate-100 text-slate-500 ring-slate-200";
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${tone}`}>{pct}% match</span>;
}

function ActionBtn({ onClick, title, children }: { onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button onClick={onClick} title={title} className="tapsable inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-100 hover:text-indigo-600">
      {children}
    </button>
  );
}

function ResultCard({ r, canShare }: { r: Result; canShare: boolean }) {
  const [open, setOpen] = useState(false);
  const [pwOn, setPwOn] = useState(false);
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const appUrl = () => (typeof window !== "undefined" ? window.location.origin : "") + r.link;
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 2200); };

  async function copyAppLink() {
    try { await navigator.clipboard.writeText(appUrl()); flash("Link copied"); } catch { flash("Copy failed"); }
  }
  async function createShare() {
    setBusy(true); setMsg(null);
    try {
      const body: Record<string, unknown> = { name: r.title, resources: [{ type: "campaign", id: r.id }] };
      if (pwOn && pw.trim()) body.password = pw.trim();
      const res = await fetch("/api/share-links", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await res.json();
      if (!res.ok) { flash(j.error || "Could not create link"); return; }
      const url: string = j.shareLink.url;
      const text = pwOn && pw.trim() ? `${url}\nPassword: ${pw.trim()}` : url;
      await navigator.clipboard.writeText(text);
      flash(pwOn && pw.trim() ? "Share link + password copied" : "Share link copied");
      setOpen(false); setPw(""); setPwOn(false);
    } catch {
      flash("Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-3.5 shadow-sm transition-all hover:border-indigo-200 hover:shadow-lg hover:shadow-indigo-900/5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 text-white shadow-md shadow-indigo-900/20">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
              <path d="M3 11l14-6v14L3 13v-2zM3 11v2a2 2 0 002 2h1M17 7a4 4 0 010 6" />
            </svg>
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-800">{r.title}</p>
            <p className="truncate text-xs text-slate-400">{r.path}</p>
            {r.assetHint && <p className="mt-0.5 text-[11px] font-medium text-indigo-500">looking for: {r.assetHint}</p>}
          </div>
        </div>
        <Badge score={r.score} />
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-1 border-t border-slate-100 pt-2">
        <Link href={r.link} className="tapsable inline-flex items-center gap-1.5 rounded-lg bg-indigo-50 px-2.5 py-1.5 text-xs font-semibold text-indigo-600 transition hover:bg-indigo-100">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5"><path d="M7 7h10v10M7 17L17 7" /></svg>
          Open
        </Link>
        <ActionBtn onClick={() => window.open(r.link, "_blank", "noopener")} title="Open in a new tab">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5"><path d="M14 3h7v7M21 3l-9 9M19 14v5a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h5" /></svg>
          New tab
        </ActionBtn>
        <ActionBtn onClick={copyAppLink} title="Copy the in-app link">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5"><path d="M9 9h10v10H9zM5 15V5h10" /></svg>
          Copy link
        </ActionBtn>
        {canShare && (
          <ActionBtn onClick={() => setOpen((o) => !o)} title="Create a public share link">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5"><path d="M18 8a3 3 0 10-2.8-4M6 15a3 3 0 100-6 3 3 0 000 6zm9 7a3 3 0 100-6 3 3 0 000 6zM8.6 13.5l6.8 4M15.4 6.5l-6.8 4" /></svg>
            Share link
          </ActionBtn>
        )}
        {msg && <span className="ml-auto text-[11px] font-medium text-emerald-600">{msg}</span>}
      </div>

      {open && canShare && (
        <div className="mt-2 rounded-xl bg-slate-50 p-3">
          <p className="text-xs text-slate-500">Creates a public link anyone can open, no account needed.</p>
          <label className="mt-2 flex items-center gap-2 text-xs text-slate-600">
            <input type="checkbox" checked={pwOn} onChange={(e) => setPwOn(e.target.checked)} className="rounded" />
            Password protect
          </label>
          {pwOn && (
            <input
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              placeholder="Set a password"
              className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
            />
          )}
          <div className="mt-2 flex items-center gap-2">
            <button onClick={createShare} disabled={busy || (pwOn && !pw.trim())} className="tapsable rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
              {busy ? "Creating…" : "Create & copy"}
            </button>
            <span className="text-[11px] text-slate-400">The password is copied with the link.</span>
          </div>
        </div>
      )}
    </div>
  );
}

export function SearchAssistant({ canShare }: { canShare: boolean }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const started = msgs.length > 0;
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, busy]);

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    const history = msgs.slice(-10).map((m) => ({ role: m.role, content: m.content }));
    setMsgs((m) => [...m, { role: "user", content: q }]);
    setInput("");
    setBusy(true);
    try {
      const r = await fetch("/api/assistant/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q, history }),
      });
      const j = await r.json();
      setMsgs((m) => [...m, r.ok
        ? { role: "assistant", content: j.reply, results: j.results ?? [] }
        : { role: "assistant", content: j.error || "Something went wrong. Please try again." }]);
    } catch {
      setMsgs((m) => [...m, { role: "assistant", content: "Network error. Please try again." }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-7rem)] max-w-3xl flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 pb-4">
        <span className="grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-500 text-white shadow-lg shadow-indigo-900/20">
          <Sparkle className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">AI Search Assistant</h1>
          <p className="text-sm text-slate-500">Find any campaign, folder, or asset in plain language.</p>
        </div>
      </div>

      {/* Conversation / empty state */}
      <div ref={scrollRef} className="nice-scroll flex-1 overflow-y-auto">
        {!started ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="relative mb-6">
              <div className="animate-blob absolute -inset-6 rounded-full bg-gradient-to-br from-indigo-300/40 to-violet-300/40 blur-2xl" />
              <div className="animate-float relative grid h-20 w-20 place-items-center rounded-3xl bg-gradient-to-br from-indigo-500 to-violet-500 text-white shadow-xl shadow-indigo-900/25">
                <Sparkle className="h-9 w-9" />
              </div>
            </div>
            <h2 className="text-lg font-semibold text-slate-800">What are you looking for?</h2>
            <p className="mt-1 max-w-sm text-sm text-slate-500">{GREETING} Try one of these:</p>
            <div className="mt-5 grid w-full max-w-lg grid-cols-1 gap-2 sm:grid-cols-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="tapsable rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left text-sm text-slate-600 shadow-sm transition hover:-translate-y-0.5 hover:border-indigo-300 hover:text-indigo-600 hover:shadow-md"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4 pb-2">
            {msgs.map((m, i) => (
              <div key={i} className={"animate-msg-in flex gap-2.5 " + (m.role === "user" ? "justify-end" : "justify-start")}>
                {m.role === "assistant" && (
                  <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-500 text-white shadow-md">
                    <Sparkle className="h-4 w-4" />
                  </span>
                )}
                <div className={m.role === "user" ? "max-w-[82%]" : "w-full max-w-[88%]"}>
                  <div
                    className={
                      "px-4 py-2.5 text-sm leading-relaxed shadow-sm " +
                      (m.role === "user"
                        ? "rounded-[18px] rounded-br-md bg-gradient-to-br from-indigo-500 to-violet-500 text-white"
                        : "rounded-[18px] rounded-tl-md border border-slate-200/70 bg-white text-slate-800")
                    }
                  >
                    {m.content}
                  </div>
                  {m.results && m.results.length > 0 && (
                    <div className="mt-2.5 space-y-2">
                      {m.results.map((r) => <ResultCard key={r.id} r={r} canShare={canShare} />)}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {busy && (
              <div className="animate-msg-in flex items-center gap-2.5">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-500 text-white shadow-md">
                  <Sparkle className="h-4 w-4" />
                </span>
                <div className="typing rounded-[18px] rounded-tl-md border border-slate-200/70 bg-white px-4 py-3 text-slate-500 shadow-sm">
                  <span /><span /><span />
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>
        )}
      </div>

      {/* Input bar */}
      <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="pt-3">
        <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white/80 p-1.5 pl-4 shadow-lg shadow-slate-900/5 backdrop-blur focus-within:border-indigo-300 focus-within:ring-2 focus-within:ring-indigo-100">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Describe what you are looking for…"
            className="flex-1 bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400"
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className="tapsable grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 text-white shadow-md shadow-indigo-900/20 transition hover:brightness-110 disabled:opacity-40"
            aria-label="Send"
          >
            <SendIcon />
          </button>
        </div>
      </form>
    </div>
  );
}
