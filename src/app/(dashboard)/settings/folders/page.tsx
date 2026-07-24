"use client";
import { useEffect, useState } from "react";

interface Folder {
  id: string;
  name: string;
  path: string;
  created_at: string;
}

export default function FoldersSettingsPage() {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [name, setName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/folders");
      const j = await res.json();
      if (res.ok) setFolders(j.folders ?? []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setError("");
    const res = await fetch("/api/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim() }),
    });
    if (res.ok) {
      setName("");
      load();
    } else {
      const j = await res.json();
      setError(j.error || "Failed to create folder");
    }
  };

  const handleUpdate = async (id: string) => {
    if (!editName.trim()) return;
    setError("");
    const res = await fetch(`/api/folders/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editName.trim() }),
    });
    if (res.ok) {
      setEditingId(null);
      setEditName("");
      load();
    } else {
      const j = await res.json();
      setError(j.error || "Failed to update folder");
    }
  };

  const handleDelete = async (id: string, folderName: string) => {
    if (!confirm(`Are you sure you want to delete folder "${folderName}"?`)) return;
    setError("");
    const res = await fetch(`/api/folders/${id}`, { method: "DELETE" });
    if (res.ok) {
      load();
    } else {
      const j = await res.json();
      setError(j.error || "Failed to delete folder");
    }
  };

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Folder Management</h1>
        <p className="text-sm text-slate-500 mt-1">
          Create, edit, and manage storage directories and access boundaries.
        </p>
      </div>

      {error && (
        <div className="rounded-lg bg-rose-50 border border-rose-200 p-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      {/* Create form */}
      <form onSubmit={handleCreate} className="flex gap-3 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New Folder Name (e.g. Marketing Assets, Legal Documents, Engineering)"
          className="flex-1 rounded-lg border border-slate-300 px-3.5 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
        />
        <button
          type="submit"
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition"
        >
          Create Folder
        </button>
      </form>

      {/* List */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-slate-400 border-b border-slate-100 bg-slate-50/50">
              <th className="px-5 py-3 font-medium">Folder Name</th>
              <th className="px-5 py-3 font-medium">Path</th>
              <th className="px-5 py-3 font-medium">Created Date</th>
              <th className="px-5 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr>
                <td colSpan={4} className="px-5 py-8 text-center text-slate-400">Loading folders...</td>
              </tr>
            ) : folders.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-5 py-8 text-center text-slate-400">
                  No folders found. Create your first folder above!
                </td>
              </tr>
            ) : (
              folders.map((f) => (
                <tr key={f.id} className="hover:bg-slate-50/50">
                  <td className="px-5 py-3 font-medium text-slate-800">
                    {editingId === f.id ? (
                      <input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="rounded border border-slate-300 px-2 py-1 text-sm outline-none focus:border-indigo-500"
                        autoFocus
                      />
                    ) : (
                      <div className="flex items-center gap-2">
                        <span>📁</span>
                        <span>{f.name}</span>
                      </div>
                    )}
                  </td>
                  <td className="px-5 py-3 text-slate-500 font-mono text-xs">{f.path}</td>
                  <td className="px-5 py-3 text-slate-500">
                    {new Date(f.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-5 py-3 text-right space-x-2">
                    {editingId === f.id ? (
                      <>
                        <button
                          onClick={() => handleUpdate(f.id)}
                          className="rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="rounded bg-slate-200 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-300"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => {
                            setEditingId(f.id);
                            setEditName(f.name);
                          }}
                          className="rounded border border-slate-200 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                        >
                          Rename
                        </button>
                        <button
                          onClick={() => handleDelete(f.id, f.name)}
                          className="rounded border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-medium text-rose-700 hover:bg-rose-100"
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
