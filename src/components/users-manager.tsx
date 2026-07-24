"use client";
import { useEffect, useState } from "react";

type User = { id: string; email: string; full_name: string | null; role: string; is_active: boolean; folderIds: string[] };
type Folder = { id: string; name: string };

const inputCls = "rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none";

export function UsersManager({ canManage }: { canManage: boolean }) {
  const [users, setUsers] = useState<User[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  // create-user form
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("employee");
  const [busy, setBusy] = useState(false);

  // create-folder
  const [folderName, setFolderName] = useState("");

  async function load() {
    const [u, f] = await Promise.all([fetch("/api/users"), fetch("/api/folders")]);
    const uj = await u.json(); const fj = await f.json();
    if (u.ok) setUsers(uj.users); else setError(uj.error);
    if (f.ok) setFolders(fj.folders);
  }
  useEffect(() => { load(); }, []);

  async function createUser() {
    setBusy(true); setError(null);
    const r = await fetch("/api/users", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, role }),
    });
    const j = await r.json(); setBusy(false);
    if (!r.ok) return setError(j.error || "Failed to create user");
    setEmail(""); setPassword(""); setRole("employee"); load();
  }

  async function updateRole(id: string, newRole: string) {
    await fetch(`/api/users/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: newRole }) });
    load();
  }

  async function saveAccess(id: string, folderIds: string[]) {
    await fetch(`/api/users/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ folderIds }) });
    setExpanded(null); load();
  }

  async function createFolder() {
    if (!folderName.trim()) return;
    await fetch("/api/folders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: folderName.trim() }) });
    setFolderName(""); load();
  }

  return (
    <div className="space-y-8">
      {/* Invite */}
      {canManage && (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="font-medium">Add a team member</h2>
          <p className="text-sm text-slate-500 mt-1">Creates the account instantly with the password you set — no email needed.</p>
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <label className="text-sm"><span className="text-slate-600 block mb-1">Email</span>
              <input value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls + " w-64"} placeholder="name@company.com" /></label>
            <label className="text-sm"><span className="text-slate-600 block mb-1">Password</span>
              <input value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls + " w-48"} placeholder="min 6 chars" /></label>
            <label className="text-sm"><span className="text-slate-600 block mb-1">Role</span>
              <select value={role} onChange={(e) => setRole(e.target.value)} className={inputCls}>
                <option value="employee">Employee (view/download)</option>
                <option value="admin">Admin (upload/manage)</option>
                <option value="super_admin">Super admin</option>
              </select></label>
            <button onClick={createUser} disabled={busy || !email || password.length < 6}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
              {busy ? "Adding…" : "Add member"}
            </button>
          </div>
          {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
        </section>
      )}

      {/* Folders */}
      {canManage && (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="font-medium">Folders</h2>
          <p className="text-sm text-slate-500 mt-1">Group files into folders, then grant employees access to specific folders below.</p>
          <div className="mt-4 flex items-center gap-3">
            <input value={folderName} onChange={(e) => setFolderName(e.target.value)} className={inputCls + " w-64"} placeholder="Folder name" />
            <button onClick={createFolder} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">Create folder</button>
          </div>
          {folders.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {folders.map((f) => <span key={f.id} className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">{f.name}</span>)}
            </div>
          )}
        </section>
      )}

      {/* Users list */}
      <section>
        <h2 className="font-medium mb-3">Team members</h2>
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-400 border-b border-slate-100">
                <th className="px-5 py-3 font-medium">Email</th>
                <th className="px-5 py-3 font-medium">Role</th>
                <th className="px-5 py-3 font-medium">Folder access</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {users.map((u) => (
                <UserRow key={u.id} u={u} folders={folders} canManage={canManage}
                  expanded={expanded === u.id} onToggle={() => setExpanded(expanded === u.id ? null : u.id)}
                  onRole={(r) => updateRole(u.id, r)} onSaveAccess={(ids) => saveAccess(u.id, ids)} />
              ))}
              {users.length === 0 && <tr><td colSpan={3} className="px-5 py-10 text-center text-slate-400">No members yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function UserRow({ u, folders, canManage, expanded, onToggle, onRole, onSaveAccess }: {
  u: User; folders: Folder[]; canManage: boolean; expanded: boolean;
  onToggle: () => void; onRole: (r: string) => void; onSaveAccess: (ids: string[]) => void;
}) {
  const [sel, setSel] = useState<string[]>(u.folderIds);
  useEffect(() => setSel(u.folderIds), [u.folderIds]);
  const isEmployee = u.role === "employee";
  return (
    <>
      <tr className="hover:bg-slate-50/70">
        <td className="px-5 py-3 font-medium text-slate-800">{u.email}</td>
        <td className="px-5 py-3">
          {canManage ? (
            <select value={u.role} onChange={(e) => onRole(e.target.value)} className={inputCls + " py-1"}>
              <option value="employee">Employee</option>
              <option value="admin">Admin</option>
              <option value="super_admin">Super admin</option>
            </select>
          ) : <span className="capitalize text-slate-600">{u.role.replace("_", " ")}</span>}
        </td>
        <td className="px-5 py-3">
          {!isEmployee ? <span className="text-slate-400 text-xs">All files (admin)</span>
            : canManage ? <button onClick={onToggle} className="text-indigo-600 text-xs hover:underline">{expanded ? "Close" : `Manage (${u.folderIds.length})`}</button>
            : <span className="text-slate-500 text-xs">{u.folderIds.length} folders</span>}
        </td>
      </tr>
      {expanded && isEmployee && canManage && (
        <tr className="bg-slate-50/50">
          <td colSpan={3} className="px-5 py-4">
            <div className="text-xs text-slate-500 mb-2">Files with no folder are shared with everyone. Check the folders this member may also access:</div>
            <div className="flex flex-wrap gap-3">
              {folders.length === 0 && <span className="text-xs text-slate-400">No folders yet — create one above.</span>}
              {folders.map((f) => (
                <label key={f.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={sel.includes(f.id)}
                    onChange={(e) => setSel(e.target.checked ? [...sel, f.id] : sel.filter((x) => x !== f.id))} />
                  {f.name}
                </label>
              ))}
            </div>
            <button onClick={() => onSaveAccess(sel)} className="mt-3 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700">Save access</button>
          </td>
        </tr>
      )}
    </>
  );
}
