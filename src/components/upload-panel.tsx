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
type Vertical = { id: string; name: string };
type Campaign = { id: string; name: string; buyer: string | null };
type ResourceType = { id: string; name: string };
type StorageKey = { id: string; label: string; provider: string; bucket_name: string; is_active: boolean };

export function UploadPanel({ onDone, preset }: {
  onDone?: () => void;
  preset?: { folderId: string; campaignId?: string | null; verticalId?: string | null; destinationLabel?: string };
}) {
  const compact = !!preset;
  const inputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  // webkitdirectory/directory aren't in the React input typings; set them imperatively.
  useEffect(() => {
    const el = folderInputRef.current;
    if (el) { el.setAttribute("webkitdirectory", ""); el.setAttribute("directory", ""); }
  }, []);
  const [items, setItems] = useState<Record<string, Item>>({});
  const [folders, setFolders] = useState<Folder[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [verticals, setVerticals] = useState<Vertical[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [resourceTypes, setResourceTypes] = useState<ResourceType[]>([]);
  const [storageKeys, setStorageKeys] = useState<StorageKey[]>([]);
  const [storageKeyId, setStorageKeyId] = useState("");
  const [folderId, setFolderId] = useState(preset?.folderId ?? "");
  const [categoryId, setCategoryId] = useState("");
  const [verticalId, setVerticalId] = useState(preset?.verticalId ?? "");
  const [campaignId, setCampaignId] = useState(preset?.campaignId ?? "");
  const [resourceTypeId, setResourceTypeId] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (compact) return; // preset upload doesn't need the destination pickers
    fetch("/api/folders").then((r) => r.json()).then((j) => setFolders(j.folders ?? [])).catch(() => {});
    fetch("/api/categories").then((r) => r.json()).then((j) => setCategories(j.categories ?? [])).catch(() => {});
    fetch("/api/verticals").then((r) => r.json()).then((j) => setVerticals(j.verticals ?? [])).catch(() => {});
    fetch("/api/resource-types").then((r) => r.json()).then((j) => setResourceTypes(j.resourceTypes ?? [])).catch(() => {});
    fetch("/api/storage-keys").then((r) => r.json()).then((j) => setStorageKeys(j.keys ?? [])).catch(() => {});
  }, [compact]);

  // Campaigns depend on the chosen vertical (interactive mode only).
  useEffect(() => {
    if (compact) return;
    setCampaignId("");
    if (!verticalId) return setCampaigns([]);
    fetch(`/api/campaigns?verticalId=${verticalId}`).then((r) => r.json()).then((j) => setCampaigns(j.campaigns ?? [])).catch(() => {});
  }, [verticalId, compact]);

  const update = (name: string, patch: Partial<Item>) =>
    setItems((s) => ({ ...s, [name]: { ...(s[name] ?? { name, progress: 0, status: "", done: false }), ...patch } }));

  async function uploadOne(file: File, overrideFolderId?: string, label?: string) {
    const key = label || file.name;
    update(key, { name: key, progress: 0, status: "Hashing…", done: false });
    const sha = await sha256Hex(file);

    update(key, { status: "Preparing…" });
    const presignRes = await fetch("/api/upload/presign", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fileName: file.name,
        contentType: file.type || "application/octet-stream",
        sizeBytes: file.size,
        description,
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        folderId: overrideFolderId ?? (folderId || null),
        categoryId: categoryId || null,
        verticalId: verticalId || null,
        campaignId: campaignId || null,
        resourceTypeId: resourceTypeId || null,
        storageKeyId: storageKeyId || undefined,
        sha256: sha,
      }),
    });
    const presign = await presignRes.json();
    if (!presignRes.ok) return update(key, { status: presign.error || "Failed" });

    if (presign.duplicate && !confirm(`"${presign.duplicate.name}" already exists (same content). Upload anyway?`)) {
      return update(key, { status: "Skipped (duplicate)" });
    }

    update(key, { status: "Uploading…" });
    const result = await new Promise<{ ok: boolean; status: number; body: string }>((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", presign.presigned.url);
      xhr.setRequestHeader("Content-Type", presign.presigned.headers["Content-Type"]);
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) update(key, { progress: Math.round((e.loaded / e.total) * 100) }); };
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
      return update(key, { status: msg });
    }

    update(key, { status: "Finalizing…" });
    const complete = await fetch("/api/upload/complete", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileId: presign.fileId }),
    });
    if (!complete.ok) { const j = await complete.json(); return update(key, { status: j.error || "Failed" }); }
    update(key, { status: "Done", progress: 100, done: true });
    onDone?.();
  }

  // Ensure a nested folder path exists under the preset folder; returns the leaf id.
  // Cached per batch; only used in compact (folder-scoped) uploads.
  async function resolveFolder(dirPath: string[], cache: Map<string, string>): Promise<string> {
    let parentId = preset!.folderId;
    for (const seg of dirPath) {
      const ck = `${parentId}/${seg}`;
      const cached = cache.get(ck);
      if (cached) { parentId = cached; continue; }
      const children = await fetch(`/api/folders?parentId=${parentId}`).then((r) => r.json()).then((j) => j.folders ?? []);
      let child = children.find((c: { name: string }) => c.name === seg);
      if (!child) {
        const res = await fetch("/api/folders", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: seg, parentId, campaignId: preset!.campaignId ?? undefined }),
        });
        if (!res.ok) throw new Error((await res.json()).error || "Failed to create subfolder");
        child = (await res.json()).folder;
      }
      cache.set(ck, child.id);
      parentId = child.id;
    }
    return parentId;
  }

  // Upload a batch of files, each carrying its subfolder path (empty = the target folder).
  async function uploadBatch(items: { file: File; dirPath: string[] }[]) {
    const cache = new Map<string, string>();
    for (const { file, dirPath } of items) {
      let target = overrideBase();
      let label = file.name;
      if (compact && dirPath.length) {
        label = [...dirPath, file.name].join("/");
        update(label, { name: label, progress: 0, status: "Creating folder…", done: false });
        try { target = await resolveFolder(dirPath, cache); }
        catch (e) { update(label, { status: (e as Error).message }); continue; }
      }
      await uploadOne(file, target, label);
    }
  }
  const overrideBase = () => (compact ? preset!.folderId : (folderId || undefined));

  async function handleFiles(files: FileList | null) {
    if (!files) return;
    // webkitRelativePath is set when a directory was chosen ("Root/sub/file.ext").
    const items = Array.from(files).map((f) => {
      const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || "";
      const parts = rel ? rel.split("/") : [];
      return { file: f, dirPath: parts.length > 1 ? parts.slice(0, -1) : [] };
    });
    await uploadBatch(items);
  }

  // Recursively read dropped items so whole folders (incl. subfolders) upload.
  async function handleDrop(dt: DataTransfer) {
    const entries: FileSystemEntry[] = [];
    const list = dt.items;
    for (let i = 0; i < list.length; i++) {
      const e = list[i].webkitGetAsEntry?.();
      if (e) entries.push(e);
    }
    if (!entries.length) return handleFiles(dt.files);

    const items: { file: File; dirPath: string[] }[] = [];
    const readEntry = (entry: FileSystemEntry, dirPath: string[]): Promise<void> =>
      new Promise((resolve) => {
        if (entry.isFile) {
          (entry as FileSystemFileEntry).file((f) => { items.push({ file: f, dirPath }); resolve(); });
        } else if (entry.isDirectory) {
          const reader = (entry as FileSystemDirectoryEntry).createReader();
          const all: FileSystemEntry[] = [];
          const readBatch = () => reader.readEntries(async (batch) => {
            if (!batch.length) {
              for (const child of all) await readEntry(child, [...dirPath, entry.name]);
              resolve();
            } else { all.push(...batch); readBatch(); }
          });
          readBatch();
        } else resolve();
      });
    for (const e of entries) await readEntry(e, []);
    await uploadBatch(items);
  }

  const inputCls = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none";

  return (
    <div className="space-y-4">
      {compact && preset?.destinationLabel && (
        <div className="rounded-lg bg-indigo-50 border border-indigo-200 px-3 py-2 text-sm text-indigo-800">
          Uploading to <span className="font-semibold">{preset.destinationLabel}</span>
        </div>
      )}
      {!compact && (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="text-sm sm:col-span-2">
          <span className="text-slate-600 font-medium">Storage Destination</span>
          <select value={storageKeyId} onChange={(e) => setStorageKeyId(e.target.value)} className={inputCls + " mt-1 font-medium bg-slate-50 border-indigo-200"}>
            <option value="">Default Active Storage Provider</option>
            {storageKeys.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label} — {k.provider.toUpperCase()} ({k.bucket_name}){k.is_active ? " [ACTIVE]" : ""}
              </option>
            ))}
          </select>
        </label>
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
        <label className="text-sm">
          <span className="text-slate-600">Vertical</span>
          <select value={verticalId} onChange={(e) => setVerticalId(e.target.value)} className={inputCls + " mt-1"}>
            <option value="">None</option>
            {verticals.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </label>
        <label className="text-sm">
          <span className="text-slate-600">Campaign</span>
          <select value={campaignId} onChange={(e) => setCampaignId(e.target.value)} className={inputCls + " mt-1"} disabled={!verticalId}>
            <option value="">{verticalId ? "None" : "Pick a vertical first"}</option>
            {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}{c.buyer ? ` · ${c.buyer}` : ""}</option>)}
          </select>
        </label>
        <label className="text-sm">
          <span className="text-slate-600">Resource type</span>
          <select value={resourceTypeId} onChange={(e) => setResourceTypeId(e.target.value)} className={inputCls + " mt-1"}>
            <option value="">None</option>
            {resourceTypes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
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
      )}

      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); handleDrop(e.dataTransfer); }}
        onClick={() => inputRef.current?.click()}
        className={`cursor-pointer rounded-xl border-2 border-dashed p-8 text-center text-sm transition ${
          dragging ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-slate-300 text-slate-500 hover:border-indigo-400 hover:bg-slate-50"
        }`}
      >
        <div className="font-medium text-slate-700">Drag &amp; drop files or a whole folder here</div>
        <div className="text-slate-400 mt-1">Any file type — images, video, audio, PDF, docs, ZIP, and more. Large files upload directly to storage.</div>
        <div className="mt-3 flex items-center justify-center gap-2" onClick={(e) => e.stopPropagation()}>
          <button type="button" onClick={() => inputRef.current?.click()}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">Browse files</button>
          <button type="button" onClick={() => folderInputRef.current?.click()}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">Upload a folder</button>
        </div>
        <input ref={inputRef} type="file" multiple className="hidden" onChange={(e) => handleFiles(e.target.files)} />
        <input ref={folderInputRef} type="file" multiple className="hidden" onChange={(e) => handleFiles(e.target.files)} />
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
