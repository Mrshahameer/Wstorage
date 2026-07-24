"use client";
import { useEffect, useRef, useState } from "react";

async function sha256Hex(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

interface Item { name: string; progress: number; status: string; done: boolean; }
type Folder = { id: string; name: string };
type Category = { id: string; name: string };

export function UploadPanel({ onDone }: { onDone?: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Record<string, Item>>({});
  const [folders, setFolders] = useState<Folder[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [folderId, setFolderId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    fetch("/api/folders").then((r) => r.json()).then((j) => setFolders(j.folders ?? [])).catch(() => {});
    fetch("/api/categories").then((r) => r.json()).then((j) => setCategories(j.categories ?? [])).catch(() => {});
  }, []);

  const update = (name: string, patch: Partial<Item>) =>
    setItems((s) => ({ ...s, [name]: { ...(s[name] ?? { name, progress: 0, status: "", done: false }), ...patch } }));

  async function uploadOne(file: File) {
    update(file.name, { name: file.name, progress: 0, status: "Hashing…", done: false });
    const sha = await sha256Hex(file);

    update(file.name, { status: "Preparing…" });
    const presignRes = await fetch("/api/upload/presign", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fileName: file.name,
        contentType: file.type || "application/octet-stream",
        sizeBytes: file.size,
        description,
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        folderId: folderId || null,
        categoryId: categoryId || null,
        sha256: sha,
      }),
    });
    const presign = await presignRes.json();
    if (!presignRes.ok) return update(file.name, { status: presign.error || "Failed" });

    if (presign.duplicate && !confirm(`"${presign.duplicate.name}" already exists (same content). Upload anyway?`)) {
      return update(file.name, { status: "Skipped (duplicate)" });
    }

    update(file.name, { status: "Uploading…" });
    const result = await new Promise<{ ok: boolean; status: number; body: string }>((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", presign.presigned.url);
      xhr.setRequestHeader("Content-Type", presign.presigned.headers["Content-Type"]);
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) update(file.name, { progress: Math.round((e.loaded / e.total) * 100) }); };
      xhr.onload = () => resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, body: (xhr.responseText || "").slice(0, 300) });
      xhr.onerror = () => resolve({ ok: false, status: 0, body: "" }); // CORS/network → status 0
      xhr.send(file);
    });
    if (!result.ok) {
      const msg =
        result.status === 0
          ? "Blocked by CORS/network (status 0)"
          : `Storage rejected upload — HTTP ${result.status}${result.body ? ": " + result.body.replace(/<[^>]+>/g, " ").trim().slice(0, 160) : ""}`;
      console.error("Upload failed:", result.status, result.body);
      return update(file.name, { status: msg });
    }

    update(file.name, { status: "Finalizing…" });
    const complete = await fetch("/api/upload/complete", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileId: presign.fileId }),
    });
    if (!complete.ok) { const j = await complete.json(); return update(file.name, { status: j.error || "Failed" }); }
    update(file.name, { status: "Done", progress: 100, done: true });
    onDone?.();
  }

  async function handleFiles(files: FileList | null) {
    if (!files) return;
    for (const f of Array.from(files)) await uploadOne(f);
  }

  const inputCls = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none";

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="text-sm">
          <span className="text-slate-600">Folder</span>
          <select value={folderId} onChange={(e) => setFolderId(e.target.value)} className={inputCls + " mt-1"}>
            <option value="">No folder (shared with everyone)</option>
            {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </label>
        <label className="text-sm">
          <span className="text-slate-600">Category</span>
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={inputCls + " mt-1"}>
            <option value="">None</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="text-sm sm:col-span-2">
          <span className="text-slate-600">Description</span>
          <input value={description} onChange={(e) => setDescription(e.target.value)} className={inputCls + " mt-1"} placeholder="Optional" />
        </label>
        <label className="text-sm sm:col-span-2">
          <span className="text-slate-600">Tags</span>
          <input value={tags} onChange={(e) => setTags(e.target.value)} className={inputCls + " mt-1"} placeholder="comma, separated, tags" />
        </label>
      </div>

      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files); }}
        onClick={() => inputRef.current?.click()}
        className={`cursor-pointer rounded-xl border-2 border-dashed p-8 text-center text-sm transition ${
          dragging ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-slate-300 text-slate-500 hover:border-indigo-400 hover:bg-slate-50"
        }`}
      >
        <div className="font-medium text-slate-700">Drag & drop files here</div>
        <div className="text-slate-400 mt-1">or click to browse — large files upload directly to storage</div>
        <input ref={inputRef} type="file" multiple className="hidden" onChange={(e) => handleFiles(e.target.files)} />
      </div>

      {Object.values(items).length > 0 && (
        <div className="space-y-2">
          {Object.values(items).map((it) => (
            <div key={it.name} className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
              <div className="flex justify-between">
                <span className="truncate text-slate-700">{it.name}</span>
                <span className={it.done ? "text-emerald-600" : "text-slate-500"}>{it.status}</span>
              </div>
              <div className="mt-2 h-1.5 w-full rounded bg-slate-100 overflow-hidden">
                <div className={`h-1.5 rounded ${it.done ? "bg-emerald-500" : "bg-indigo-500"}`} style={{ width: `${it.progress}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
