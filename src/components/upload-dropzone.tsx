"use client";
import { useRef, useState } from "react";

async function sha256Hex(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

interface Item { name: string; progress: number; status: string; }

export function UploadDropzone({ onDone }: { onDone?: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Record<string, Item>>({});

  function update(name: string, patch: Partial<Item>) {
    setItems((s) => ({ ...s, [name]: { ...s[name], ...patch } }));
  }

  async function uploadOne(file: File) {
    update(file.name, { name: file.name, progress: 0, status: "hashing" });
    const sha = await sha256Hex(file);

    update(file.name, { status: "requesting" });
    const presignRes = await fetch("/api/upload/presign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fileName: file.name,
        contentType: file.type || "application/octet-stream",
        sizeBytes: file.size,
        sha256: sha,
      }),
    });
    const presign = await presignRes.json();
    if (!presignRes.ok) return update(file.name, { status: `error: ${presign.error}` });

    if (presign.duplicate) {
      const go = confirm(`"${presign.duplicate.name}" already exists (same content). Upload anyway?`);
      if (!go) return update(file.name, { status: "skipped (duplicate)" });
    }

    // Direct PUT to Backblaze via presigned URL, with progress.
    update(file.name, { status: "uploading" });
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", presign.presigned.url);
      xhr.setRequestHeader("Content-Type", presign.presigned.headers["Content-Type"]);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) update(file.name, { progress: Math.round((e.loaded / e.total) * 100) });
      };
      xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`PUT ${xhr.status}`)));
      xhr.onerror = () => reject(new Error("network error"));
      xhr.send(file);
    }).catch((err) => update(file.name, { status: `error: ${err.message}` }));

    // Finalize
    update(file.name, { status: "finalizing" });
    const complete = await fetch("/api/upload/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileId: presign.fileId }),
    });
    if (!complete.ok) {
      const j = await complete.json();
      return update(file.name, { status: `error: ${j.error}` });
    }
    update(file.name, { status: "done", progress: 100 });
    onDone?.();
  }

  async function handleFiles(files: FileList | null) {
    if (!files) return;
    for (const f of Array.from(files)) await uploadOne(f);
  }

  return (
    <div>
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); handleFiles(e.dataTransfer.files); }}
        onClick={() => inputRef.current?.click()}
        className="cursor-pointer rounded-xl border-2 border-dashed bg-white p-8 text-center text-sm text-neutral-500 hover:border-brand"
      >
        Drag & drop files here, or click to browse
        <input ref={inputRef} type="file" multiple className="hidden" onChange={(e) => handleFiles(e.target.files)} />
      </div>
      <div className="mt-4 space-y-2">
        {Object.values(items).map((it) => (
          <div key={it.name} className="rounded-md border bg-white p-3 text-sm">
            <div className="flex justify-between">
              <span className="truncate">{it.name}</span>
              <span className="text-neutral-500">{it.status}</span>
            </div>
            <div className="mt-1 h-1.5 w-full rounded bg-neutral-100">
              <div className="h-1.5 rounded bg-brand" style={{ width: `${it.progress}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
