"use client";
import Link from "next/link";
import { useEffect, useReducer, useRef, useState } from "react";
import type { AssistantMeta, CampaignItem, FileItem, Section } from "@/lib/assistant/types";
import { MAX_QUERY_CHARS } from "@/lib/assistant/types";

interface Msg {
  role: "user" | "assistant";
  content: string;
  sections?: Section[];
  meta?: AssistantMeta;
  query?: string; // the question this reply answers (for feedback)
  error?: boolean;
  rating?: 1 | -1;
}

const SUGGESTIONS = [
  "ACA inbound landing page and the auto insurance inbound call recordings",
  "Creatives from ACA and recordings from auto insurance",
  "Which campaigns are missing verification recordings?",
  "What do we have for roofing?",
];

// ---- small helpers -------------------------------------------------------------

function Sparkle({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 2l1.8 4.6L18.5 8.5l-4.7 1.9L12 15l-1.8-4.6L5.5 8.5l4.7-1.9L12 2z" />
      <path d="M18 13l.9 2.3L21.5 16l-2.6 1-.9 2.3-.9-2.3-2.6-1 2.6-.7L18 13z" />
    </svg>
  );
}
const Ico = ({ d, className = "h-3.5 w-3.5" }: { d: string; className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className}><path d={d} /></svg>
);
const I = {
  open: "M7 7h10v10M7 17L17 7",
  tab: "M14 3h7v7M21 3l-9 9M19 14v5a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h5",
  copy: "M9 9h10v10H9zM5 15V5h10",
  share: "M18 8a3 3 0 10-2.8-4M6 15a3 3 0 100-6 3 3 0 000 6zm9 7a3 3 0 100-6 3 3 0 000 6zM8.6 13.5l6.8 4M15.4 6.5l-6.8 4",
  down: "M12 4v12M6 10l6 6 6-6M4 20h16",
  play: "M8 5v14l11-7z",
  up: "M7 10v10M7 10l4-7a2 2 0 013 2l-1 5h5a2 2 0 012 2l-1.5 6a2 2 0 01-2 1.5H7",
  dn: "M17 14V4M17 14l-4 7a2 2 0 01-3-2l1-5H6a2 2 0 01-2-2l1.5-6A2 2 0 017.5 4H17",
  globe: "M12 21a9 9 0 100-18 9 9 0 000 18zM3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18",
};

const fmtSize = (n: number) => {
  if (!n) return "";
  const u = ["B", "KB", "MB", "GB"]; let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
};
const fmtDate = (s: string) => new Date(s).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
const kind = (f: FileItem) => {
  const e = (f.ext ?? "").toLowerCase();
  const ct = (f.contentType ?? "").toLowerCase();
  if (ct.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(e)) return "image";
  if (ct.startsWith("audio/") || ["mp3", "wav", "m4a", "ogg", "aac"].includes(e)) return "audio";
  if (ct.startsWith("video/") || ["mp4", "mov", "webm"].includes(e)) return "video";
  return "doc";
};
const emoji = (f: FileItem) => {
  const e = (f.ext ?? "").toLowerCase();
  if (e === "pdf") return "📄";
  if (["doc", "docx", "txt", "md"].includes(e)) return "📝";
  if (["xls", "xlsx", "csv"].includes(e)) return "📊";
  if (["html", "htm", "zip"].includes(e)) return "🌐";
  if (kind(f) === "video") return "🎬";
  return "📁";
};
const origin = () => (typeof window !== "undefined" ? window.location.origin : "");
async function previewUrl(id: string): Promise<string | null> {
  try {
    const r = await fetch(`/api/files/${id}/preview`);
    if (!r.ok) return null;
    return (await r.json()).url ?? null;
  } catch { return null; }
}

function useFlash() {
  const [msg, setMsg] = useState<string | null>(null);
  return { msg, flash: (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 2200); } };
}

function Btn({ onClick, href, title, icon, children, newTab }: { onClick?: () => void; href?: string; title: string; icon: string; children?: React.ReactNode; newTab?: boolean }) {
  const cls = "tapsable inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-100 hover:text-indigo-600";
  if (href) {
    return newTab
      ? <a href={href} target="_blank" rel="noopener noreferrer" title={title} className={cls}><Ico d={icon} />{children}</a>
      : <Link href={href} title={title} className={cls}><Ico d={icon} />{children}</Link>;
  }
  return <button onClick={onClick} title={title} className={cls}><Ico d={icon} />{children}</button>;
}

// ---- file row ---------------------------------------------------------------------

function Thumb({ f }: { f: FileItem }) {
  const ref = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(async (entries) => {
      if (entries.some((e) => e.isIntersecting)) { io.disconnect(); setUrl(await previewUrl(f.id)); }
    }, { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, [f.id]);
  return (
    <div ref={ref} className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
      {url ? <img src={url} alt="" className="h-full w-full object-cover" /> : <span className="text-lg">🖼️</span>}
    </div>
  );
}

function FileRow({ f, showFolder }: { f: FileItem; showFolder: boolean }) {
  const { msg, flash } = useFlash();
  const [audio, setAudio] = useState<string | null>(null);
  const k = kind(f);
  const updated = f.updatedAt && f.updatedAt.slice(0, 10) !== f.createdAt.slice(0, 10);
  return (
    <li className="px-4 py-3">
      <div className="flex items-start gap-3">
        {k === "image" ? <Thumb f={f} /> : (
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-lg border border-slate-200 bg-slate-50 text-lg">{k === "audio" ? "🎧" : emoji(f)}</div>
        )}
        <div className="min-w-0 flex-1">
          <p className="break-all text-sm font-semibold text-slate-900 sm:truncate sm:break-normal" title={f.name}>{f.name}</p>
          <p className="mt-0.5 text-xs text-slate-500">
            {[showFolder && f.folder, fmtSize(f.size), `Added ${fmtDate(f.createdAt)}`, updated && `Updated ${fmtDate(f.updatedAt)}`].filter(Boolean).join(" · ")}
          </p>
          {f.tags.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {f.tags.map((t) => <span key={t} className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-600">#{t}</span>)}
            </div>
          )}
          {audio && <audio src={audio} controls autoPlay className="mt-2 h-9 w-full" />}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-0.5 pl-[3.75rem]">
        <Btn href={`/files/${f.id}`} title="Open the asset page" icon={I.open}>Open</Btn>
        {k === "audio" && !audio && (
          <Btn onClick={async () => { const u = await previewUrl(f.id); if (u) setAudio(u); else flash("Could not load audio"); }} title="Play here" icon={I.play}>Play</Btn>
        )}
        {f.liveUrl && <Btn href={f.liveUrl} newTab title="Open the live page" icon={I.globe}>Live page</Btn>}
        <Btn href={`/api/download/${f.id}`} newTab title="Download" icon={I.down}>Download</Btn>
        <Btn onClick={async () => { try { await navigator.clipboard.writeText(`${origin()}/files/${f.id}`); flash("Link copied"); } catch { flash("Copy failed"); } }} title="Copy link" icon={I.copy}>Copy link</Btn>
        {msg && <span className="ml-1 text-[11px] font-medium text-emerald-600">{msg}</span>}
      </div>
    </li>
  );
}

// ---- share panel (BD manager and up) ---------------------------------------------

function SharePanel({ type, id, name, onDone }: { type: "folder" | "campaign"; id: string; name: string; onDone: (m: string) => void }) {
  const [pwOn, setPwOn] = useState(false);
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  async function create() {
    setBusy(true);
    try {
      const body: Record<string, unknown> = { name, resources: [{ type, id }] };
      if (pwOn && pw.trim()) body.password = pw.trim();
      const res = await fetch("/api/share-links", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await res.json();
      if (!res.ok) return onDone(j.error || "Could not create the link");
      const url: string = j.shareLink.url;
      await navigator.clipboard.writeText(pwOn && pw.trim() ? `${url}\nPassword: ${pw.trim()}` : url);
      onDone(pwOn && pw.trim() ? "Share link and password copied" : "Share link copied");
    } catch {
      onDone("Something went wrong");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mx-4 mb-3 rounded-xl bg-slate-50 p-3">
      <p className="text-xs text-slate-600">Creates a public link anyone can open, no account needed.</p>
      <label className="mt-2 flex items-center gap-2 text-xs text-slate-700">
        <input type="checkbox" checked={pwOn} onChange={(e) => setPwOn(e.target.checked)} className="rounded" /> Password protect
      </label>
      {pwOn && (
        <input value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Set a password"
          className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500" />
      )}
      <div className="mt-2 flex items-center gap-2">
        <button onClick={create} disabled={busy || (pwOn && !pw.trim())} className="tapsable rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
          {busy ? "Creating…" : "Create and copy"}
        </button>
        <span className="text-[11px] text-slate-500">The password is copied with the link.</span>
      </div>
    </div>
  );
}

// ---- sections ---------------------------------------------------------------------

function SectionHeader({ n, label, count, sub }: { n: number; label: string; count: string; sub?: string }) {
  return (
    <div className="px-4 pt-3">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-slate-900 px-1.5 text-[10px] font-bold text-white">{n}</span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold leading-snug text-slate-900">{label}</h3>
          {sub && <p className="truncate text-xs text-slate-500">{sub}</p>}
        </div>
        <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">{count}</span>
      </div>
    </div>
  );
}

function FilesSection({ s, n, canShare }: { s: Extract<Section, { kind: "files" }>; n: number; canShare: boolean }) {
  const { msg, flash } = useFlash();
  const [share, setShare] = useState(false);
  const count = s.total === 0 ? "empty" : s.total > s.files.length ? `${s.files.length} of ${s.total} files` : `${s.total} file${s.total === 1 ? "" : "s"}`;
  async function copyAll() {
    const text = s.files.map((f) => `${f.name}: ${origin()}/files/${f.id}`).join("\n");
    try { await navigator.clipboard.writeText(text); flash(`${s.files.length} links copied`); } catch { flash("Copy failed"); }
  }
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <SectionHeader n={n} label={s.label} count={count} sub={s.path} />
      <div className="flex flex-wrap items-center gap-0.5 px-3 pb-2 pt-1">
        <Btn href={s.link} title={s.folder ? "Open this folder in the library" : "Open this campaign in the library"} icon={I.open}>{s.folder ? "Open folder" : "Open campaign"}</Btn>
        <Btn href={s.link} newTab title="Open in a new tab" icon={I.tab}>New tab</Btn>
        {s.files.length > 0 && <Btn onClick={copyAll} title="Copy every file link in this section" icon={I.copy}>Copy all links</Btn>}
        {canShare && <Btn onClick={() => setShare((v) => !v)} title="Create a public share link" icon={I.share}>Share</Btn>}
        {msg && <span className="ml-1 text-[11px] font-medium text-emerald-600">{msg}</span>}
      </div>
      {share && canShare && (
        <SharePanel
          type={s.folder ? "folder" : "campaign"}
          id={s.folder ? s.folder.id : s.campaign.id}
          name={s.label}
          onDone={(m) => { flash(m); setShare(false); }}
        />
      )}
      {s.files.length > 0 ? (
        <ul className="divide-y divide-slate-100 border-t border-slate-100">
          {s.files.map((f) => <FileRow key={f.id} f={f} showFolder={!s.folder} />)}
        </ul>
      ) : (
        <p className="border-t border-slate-100 px-4 py-3 text-sm text-slate-600">{s.note ?? "No files here yet."}</p>
      )}
      {s.total > s.files.length && (
        <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">Showing the newest {s.files.length}. Open the folder to see all {s.total}.</p>
      )}
    </section>
  );
}

function CampaignRow({ c }: { c: CampaignItem }) {
  return (
    <li className="flex items-center justify-between gap-3 px-4 py-2.5">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-slate-900 sm:truncate">{c.name}</p>
        <p className="truncate text-xs text-slate-500">{c.path}{c.note ? ` · ${c.note}` : ""}</p>
      </div>
      <div className="flex shrink-0 gap-0.5">
        <Btn href={c.link} title="Open in the library" icon={I.open}>Open</Btn>
        <Btn href={c.link} newTab title="Open in a new tab" icon={I.tab} />
      </div>
    </li>
  );
}

function SectionView({ s, n, canShare }: { s: Section; n: number; canShare: boolean }) {
  if (s.kind === "files") return <FilesSection s={s} n={n} canShare={canShare} />;
  if (s.kind === "campaigns") {
    return (
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <SectionHeader n={n} label={s.label} count={`${s.campaigns.length}`} />
        {s.campaigns.length ? (
          <ul className="mt-2 max-h-96 divide-y divide-slate-100 overflow-y-auto border-t border-slate-100 nice-scroll">
            {s.campaigns.map((c) => <CampaignRow key={c.id} c={c} />)}
          </ul>
        ) : (
          <p className="mt-2 border-t border-slate-100 px-4 py-3 text-sm text-slate-600">{s.note ?? "Nothing to show."}</p>
        )}
      </section>
    );
  }
  return (
    <section className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
      <p className="text-sm font-semibold text-amber-900">{n}. {s.label}</p>
      <p className="text-sm text-amber-800">{s.text}</p>
    </section>
  );
}

// ---- status line + feedback ---------------------------------------------------------

function StatusLine({ meta }: { meta: AssistantMeta }) {
  const secs = `${(meta.ms / 1000).toFixed(1)}s`;
  if (meta.mode === "ai") {
    return (
      <p className="flex items-center gap-1.5 text-[11px] text-slate-500">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        AI · {meta.model}{meta.steps && meta.steps > 1 ? ` · ${meta.steps} steps` : ""} · {secs}
      </p>
    );
  }
  return (
    <p className="flex items-start gap-1.5 text-[11px] text-amber-700" title={meta.reasonCode}>
      <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
      <span>Keyword mode (no AI) · {meta.reason ?? "AI unavailable"} · {secs}</span>
    </p>
  );
}

function Feedback({ m, onRate }: { m: Msg; onRate: (r: 1 | -1) => void }) {
  const btn = (r: 1 | -1, d: string, label: string) => (
    <button onClick={() => onRate(r)} disabled={!!m.rating} title={label}
      className={"rounded-md p-1 transition " + (m.rating === r ? "text-indigo-600" : "text-slate-400 hover:text-slate-700 disabled:opacity-40")}>
      <Ico d={d} className="h-3.5 w-3.5" />
    </button>
  );
  return (
    <span className="flex items-center gap-0.5">
      {btn(1, I.up, "Good answer")}
      {btn(-1, I.dn, "Bad answer")}
      {m.rating && <span className="text-[11px] text-slate-500">Thanks</span>}
    </span>
  );
}

// ---- chat store ---------------------------------------------------------------
// Lives outside the component, so switching tabs keeps the chat (and a reply that
// arrives while you are elsewhere). Saved per user in the browser, so a reload
// keeps it too. "New chat" clears it.
interface ChatStore { msgs: Msg[]; busy: boolean; listeners: Set<() => void> }
const stores = new Map<string, ChatStore>();
const KEEP = 30;

function chatStore(key: string): ChatStore {
  let s = stores.get(key);
  if (!s) {
    let msgs: Msg[] = [];
    try { msgs = JSON.parse(window.localStorage.getItem(key) ?? "[]"); } catch { msgs = []; }
    s = { msgs: Array.isArray(msgs) ? msgs : [], busy: false, listeners: new Set() };
    stores.set(key, s);
  }
  return s;
}
function updateChat(key: string, fn: (s: ChatStore) => void) {
  const s = chatStore(key);
  fn(s);
  s.msgs = s.msgs.slice(-KEEP);
  for (let keep = s.msgs.length; keep > 0; keep = Math.floor(keep / 2)) {
    try { window.localStorage.setItem(key, JSON.stringify(s.msgs.slice(-keep))); break; } catch { /* storage full: keep fewer */ }
  }
  s.listeners.forEach((l) => l());
}

// ---- main -------------------------------------------------------------------------------

export function SearchAssistant({ canShare, userId }: { canShare: boolean; userId: string }) {
  const key = `wstorage.assistant.v1.${userId}`;
  const [mounted, setMounted] = useState(false);
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    setMounted(true);
    const s = chatStore(key);
    s.listeners.add(rerender);
    rerender();
    return () => { s.listeners.delete(rerender); };
  }, [key]);
  const store = mounted ? chatStore(key) : null;
  const msgs = store?.msgs ?? [];
  const busy = store?.busy ?? false;

  const [input, setInput] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const started = msgs.length > 0;
  const tooLong = input.length > MAX_QUERY_CHARS;
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, busy]);
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }, [input]);

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy || q.length > MAX_QUERY_CHARS) return;
    // Give the model what was shown, so "send those in bulk" has context.
    const history = msgs.filter((m) => !m.error).slice(-10).map((m) => ({
      role: m.role,
      content: m.role === "assistant" && m.sections?.length ? `${m.content}\n[Shown: ${m.sections.map((s) => s.label).join("; ")}]` : m.content,
    }));
    updateChat(key, (s) => { s.msgs.push({ role: "user", content: q }); s.busy = true; });
    setInput("");
    let reply: Msg;
    try {
      const r = await fetch("/api/assistant/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: q, history }) });
      const j = await r.json().catch(() => ({}));
      reply = r.ok
        ? { role: "assistant", content: j.reply, sections: j.sections ?? [], meta: j.meta, query: q }
        : { role: "assistant", content: typeof j.error === "string" ? j.error : "Something went wrong. Please try again.", error: true };
    } catch {
      reply = { role: "assistant", content: "Network error. Please check your connection and try again.", error: true };
    }
    updateChat(key, (s) => { s.msgs.push(reply); s.busy = false; });
  }

  function rate(i: number, rating: 1 | -1) {
    const m = msgs[i];
    updateChat(key, (s) => { if (s.msgs[i]) s.msgs[i] = { ...s.msgs[i], rating }; });
    fetch("/api/assistant/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rating, query: m.query ?? "", reply: m.content, meta: { ...m.meta, sections: m.sections?.map((s) => s.label) } }),
    }).catch(() => {});
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-7rem)] max-w-3xl flex-col">
      <div className="flex items-center gap-3 pb-4">
        <span className="grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-500 text-white shadow-lg shadow-indigo-900/20">
          <Sparkle className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">AI Search Assistant</h1>
          <p className="text-sm text-slate-500">Ask about the library, or ask for assets from one or many campaigns at once.</p>
        </div>
        {started && (
          <button
            onClick={() => updateChat(key, (s) => { s.msgs = []; })}
            disabled={busy}
            className="tapsable ml-auto rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
          >
            New chat
          </button>
        )}
      </div>

      <div className="nice-scroll flex-1 overflow-y-auto">
        {!mounted ? null : !started ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="relative mb-6">
              <div className="animate-blob absolute -inset-6 rounded-full bg-gradient-to-br from-indigo-300/40 to-violet-300/40 blur-2xl" />
              <div className="animate-float relative grid h-20 w-20 place-items-center rounded-3xl bg-gradient-to-br from-indigo-500 to-violet-500 text-white shadow-xl shadow-indigo-900/25">
                <Sparkle className="h-9 w-9" />
              </div>
            </div>
            <h2 className="text-lg font-semibold text-slate-800">What are you looking for?</h2>
            <p className="mt-1 max-w-md text-sm text-slate-500">Ask in plain words. You can ask for several assets from different campaigns in one message.</p>
            <div className="mt-5 grid w-full max-w-xl grid-cols-1 gap-2 sm:grid-cols-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => send(s)}
                  className="tapsable rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left text-sm text-slate-700 shadow-sm transition hover:-translate-y-0.5 hover:border-indigo-300 hover:text-indigo-600 hover:shadow-md">
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-5 pb-2">
            {msgs.map((m, i) => (
              <div key={i} className={"animate-msg-in flex gap-2.5 " + (m.role === "user" ? "justify-end" : "justify-start")}>
                {m.role === "assistant" && (
                  <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-500 text-white shadow-md">
                    <Sparkle className="h-4 w-4" />
                  </span>
                )}
                <div className={m.role === "user" ? "max-w-[85%]" : "min-w-0 flex-1"}>
                  <div className={
                    "whitespace-pre-wrap break-words px-4 py-2.5 text-sm leading-relaxed shadow-sm " +
                    (m.role === "user"
                      ? "rounded-[18px] rounded-br-md bg-gradient-to-br from-indigo-500 to-violet-500 text-white"
                      : m.error
                        ? "rounded-[18px] rounded-tl-md border border-rose-200 bg-rose-50 text-rose-800"
                        : "rounded-[18px] rounded-tl-md border border-slate-200/70 bg-white text-slate-800")
                  }>
                    {m.content}
                  </div>
                  {m.sections && m.sections.length > 0 && (
                    <div className="mt-3 space-y-3">
                      {m.sections.map((s, si) => <SectionView key={si} s={s} n={si + 1} canShare={canShare} />)}
                    </div>
                  )}
                  {m.role === "assistant" && m.meta && (
                    <div className="mt-1.5 flex items-center justify-between gap-2 px-1">
                      <StatusLine meta={m.meta} />
                      <Feedback m={m} onRate={(r) => rate(i, r)} />
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

      <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="pt-3">
        <div className={"flex items-end gap-2 rounded-2xl border bg-white/80 p-1.5 pl-4 shadow-lg shadow-slate-900/5 backdrop-blur focus-within:ring-2 " +
          (tooLong ? "border-rose-300 focus-within:ring-rose-100" : "border-slate-200 focus-within:border-indigo-300 focus-within:ring-indigo-100")}>
          <textarea
            ref={taRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
            placeholder="Ask about the library, or ask for assets…"
            className="nice-scroll max-h-[200px] flex-1 resize-none bg-transparent py-2 text-sm text-slate-800 outline-none placeholder:text-slate-400"
          />
          <button type="submit" disabled={busy || !input.trim() || tooLong} aria-label="Send"
            className="tapsable grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 text-white shadow-md shadow-indigo-900/20 transition hover:brightness-110 disabled:opacity-40">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
          </button>
        </div>
        <div className="mt-1 flex justify-between px-2 text-[11px] text-slate-400">
          <span>Enter to send · Shift+Enter for a new line</span>
          {input.length > MAX_QUERY_CHARS * 0.8 && (
            <span className={tooLong ? "font-semibold text-rose-600" : ""}>{input.length.toLocaleString()} / {MAX_QUERY_CHARS.toLocaleString()}</span>
          )}
        </div>
      </form>
    </div>
  );
}
