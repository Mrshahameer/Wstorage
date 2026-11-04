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

const SUGGESTIONS = [
  "Auto insurance live transfer creatives",
  "Final expense transfer scripts",
  "Windows warm transfer landing pages",
  "Roofing inbound recordings",
];

function Badge({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const tone = pct >= 80 ? "bg-emerald-100 text-emerald-700" : pct >= 55 ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-500";
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${tone}`}>{pct}% match</span>;
}

export function SearchAssistant() {
  const [msgs, setMsgs] = useState<Msg[]>([
    { role: "assistant", content: "Hi. Tell me what you are looking for and I will find the campaign folder. For example, 'auto insurance live transfer creatives'." },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, busy]);

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    const history = msgs.filter((m) => m.content).slice(-10).map((m) => ({ role: m.role, content: m.content }));
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
      if (!r.ok) {
        setMsgs((m) => [...m, { role: "assistant", content: j.error || "Something went wrong. Please try again." }]);
      } else {
        setMsgs((m) => [...m, { role: "assistant", content: j.reply, results: j.results ?? [] }]);
      }
    } catch {
      setMsgs((m) => [...m, { role: "assistant", content: "Network error. Please try again." }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-8rem)] max-w-3xl flex-col">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">AI Search Assistant</h1>
        <p className="mt-1 text-sm text-slate-500">Find any campaign, folder, or asset using natural language.</p>
      </div>

      <div className="mt-4 flex-1 space-y-4 overflow-y-auto rounded-xl border border-slate-200 bg-white p-5">
        {msgs.map((m, i) => (
          <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div className={m.role === "user" ? "max-w-[85%]" : "w-full max-w-[90%]"}>
              <div
                className={
                  "rounded-2xl px-4 py-2 text-sm " +
                  (m.role === "user" ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-800")
                }
              >
                {m.content}
              </div>
              {m.results && m.results.length > 0 && (
                <div className="mt-3 space-y-2">
                  {m.results.map((r) => (
                    <Link
                      key={r.id}
                      href={r.link}
                      className="group flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition hover:border-indigo-300 hover:shadow"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-indigo-50 text-lg group-hover:bg-indigo-100">📣</span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-slate-800">{r.title}</p>
                          <p className="truncate text-xs text-slate-400">{r.path}</p>
                          {r.assetHint && <p className="text-[11px] text-indigo-500">looking for: {r.assetHint}</p>}
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <Badge score={r.score} />
                        <span className="text-xs font-medium text-indigo-600 group-hover:underline">Open ↗</span>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {busy && <div className="flex justify-start"><div className="rounded-2xl bg-slate-100 px-4 py-2 text-sm text-slate-400">Searching…</div></div>}
        <div ref={endRef} />
      </div>

      {msgs.length <= 1 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
            <button key={s} onClick={() => send(s)} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 hover:border-indigo-300 hover:text-indigo-600">
              {s}
            </button>
          ))}
        </div>
      )}

      <form
        onSubmit={(e) => { e.preventDefault(); send(input); }}
        className="mt-3 flex items-center gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Describe what you are looking for…"
          className="flex-1 rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  );
}
