"use client";
import { useEffect, useState } from "react";
import { AccessTree } from "./access-tree";

type User = { id: string; email: string; full_name: string | null; role: string; is_active: boolean; folderIds: string[] };

const inputCls = "rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none";

const ROLE_OPTIONS = [
  { v: "client", l: "Client (external, assigned only)" },
  { v: "employee", l: "Employee (assigned)" },
  { v: "bd_manager", l: "BD Manager (browse/share assigned)" },
  { v: "manager", l: "Manager" },
  { v: "admin", l: "Admin (all access)" },
  { v: "super_admin", l: "Super admin" },
];
const roleLabel = (r: string) => r.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const isFullAccess = (r: string) => r === "admin" || r === "super_admin";

export function UsersManager({ canManage, currentUserId }: { canManage: boolean; currentUserId?: string }) {
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [managing, setManaging] = useState<User | null>(null);
  const [editing, setEditing] = useState<User | null>(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("employee");
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch("/api/users");
      const j = await r.json();
      if (r.ok) { setUsers(j.users); setError(null); }
      else setError(j.error || "Failed to load users");
    } catch {
      setError("Failed to load users");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  async function createUser() {
    setBusy(true); setError(null);
    try {
      const r = await fetch("/api/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, role }) });
      const j = await r.json();
      if (!r.ok) return setError(j.error || "Failed to create user");
      setEmail(""); setPassword(""); setRole("employee"); load();
    } finally {
      setBusy(false);
    }
  }
  async function updateRole(id: string, newRole: string) {
    setError(null);
    const r = await fetch(`/api/users/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: newRole }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) setError(j.error || "Failed to update role");
    load();
  }
  async function toggleActive(u: User) {
    setError(null);
    const r = await fetch(`/api/users/${u.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive: !u.is_active }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) setError(j.error || "Failed to update status");
    load();
  }
  async function deleteUser(u: User) {
    if (!confirm(`Delete ${u.email}? This permanently removes their account and access.`)) return;
    setError(null);
    const r = await fetch(`/api/users/${u.id}`, { method: "DELETE" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return setError(j.error || "Failed to delete user");
    load();
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Users &amp; access</h1>
        <p className="text-sm text-slate-500 mt-1">Invite people, set roles, reset passwords, and choose exactly which categories, campaigns, and folders each person can see.</p>
      </div>

      {canManage && (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="font-medium">Add a team member or client</h2>
          <p className="text-sm text-slate-500 mt-1">Creates the account instantly with the password you set — no email needed.</p>
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <label className="text-sm"><span className="text-slate-600 block mb-1">Email</span>
              <input value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls + " w-64"} placeholder="name@company.com" /></label>
            <label className="text-sm"><span className="text-slate-600 block mb-1">Password</span>
              <input value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls + " w-48"} placeholder="min 6 chars" /></label>
            <label className="text-sm"><span className="text-slate-600 block mb-1">Role</span>
              <select value={role} onChange={(e) => setRole(e.target.value)} className={inputCls}>
                {ROLE_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
              </select></label>
            <button onClick={createUser} disabled={busy || !email || password.length < 6}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
              {busy ? "Adding…" : "Add member"}
            </button>
          </div>
        </section>
      )}

      {error && <p className="text-sm text-rose-600">{error}</p>}

      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-medium">Team members{users.length > 0 && <span className="text-slate-400 font-normal"> · {users.length}</span>}</h2>
          <button onClick={load} className="text-xs text-slate-500 hover:text-slate-800">Refresh</button>
        </div>
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-400 border-b border-slate-100">
                <th className="px-5 py-3 font-medium">Email</th>
                <th className="px-5 py-3 font-medium">Role</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Access</th>
                {canManage && <th className="px-5 py-3 font-medium text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-slate-50/70">
                  <td className="px-5 py-3 font-medium text-slate-800">
                    {u.email}
                    {u.id === currentUserId && <span className="ml-2 text-[10px] uppercase tracking-wide text-indigo-500">You</span>}
                  </td>
                  <td className="px-5 py-3">
                    {canManage ? (
                      <select value={u.role} onChange={(e) => updateRole(u.id, e.target.value)} className={inputCls + " py-1"}>
                        {ROLE_OPTIONS.map((o) => <option key={o.v} value={o.v}>{roleLabel(o.v)}</option>)}
                      </select>
                    ) : <span className="text-slate-600">{roleLabel(u.role)}</span>}
                  </td>
                  <td className="px-5 py-3">
                    {canManage ? (
                      <button onClick={() => toggleActive(u)}
                        className={"rounded-full px-2.5 py-1 text-xs font-medium " + (u.is_active ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100" : "bg-slate-100 text-slate-500 hover:bg-slate-200")}>
                        {u.is_active ? "Active" : "Disabled"}
                      </button>
                    ) : <span className={u.is_active ? "text-emerald-600 text-xs" : "text-slate-400 text-xs"}>{u.is_active ? "Active" : "Disabled"}</span>}
                  </td>
                  <td className="px-5 py-3">
                    {isFullAccess(u.role) ? <span className="text-slate-400 text-xs">All files (admin)</span>
                      : canManage ? <button onClick={() => setManaging(u)} className="text-indigo-600 text-xs hover:underline">Manage access</button>
                      : <span className="text-slate-500 text-xs">Assigned resources</span>}
                  </td>
                  {canManage && (
                    <td className="px-5 py-3 text-right whitespace-nowrap">
                      <button onClick={() => setEditing(u)} className="text-indigo-600 text-xs hover:underline">Edit</button>
                      {u.id !== currentUserId && (
                        <button onClick={() => deleteUser(u)} className="ml-3 text-rose-600 text-xs hover:underline">Delete</button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
              {users.length === 0 && (
                <tr><td colSpan={canManage ? 5 : 4} className="px-5 py-10 text-center text-slate-400">
                  {loading ? "Loading…" : "No members yet."}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {managing && (
        <AccessTree userId={managing.id} email={managing.email} onClose={() => setManaging(null)} onSaved={load} />
      )}

      {editing && (
        <EditUserModal
          user={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
          onError={(m) => setError(m)}
        />
      )}
    </div>
  );
}

function EditUserModal({ user, onClose, onSaved, onError }: { user: User; onClose: () => void; onSaved: () => void; onError: (m: string) => void }) {
  const [email, setEmail] = useState(user.email);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  async function save() {
    setBusy(true); setLocalError(null);
    const payload: Record<string, unknown> = {};
    if (email && email !== user.email) payload.email = email;
    if (password) payload.password = password;
    if (Object.keys(payload).length === 0) { onClose(); return; }
    try {
      const r = await fetch(`/api/users/${user.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { const msg = j.error || "Failed to update user"; setLocalError(msg); onError(msg); return; }
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-medium">Edit user</h3>
        <p className="text-sm text-slate-500 mt-1">{user.email}</p>
        <div className="mt-4 space-y-3">
          <label className="text-sm block"><span className="text-slate-600 block mb-1">Email</span>
            <input value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls + " w-full"} placeholder="name@company.com" /></label>
          <label className="text-sm block"><span className="text-slate-600 block mb-1">New password</span>
            <input value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls + " w-full"} placeholder="leave blank to keep current" /></label>
          {password && password.length < 6 && <p className="text-xs text-amber-600">Password must be at least 6 characters.</p>}
        </div>
        {localError && <p className="mt-3 text-sm text-rose-600">{localError}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-slate-600 hover:bg-slate-100">Cancel</button>
          <button onClick={save} disabled={busy || (!!password && password.length < 6)}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
            {busy ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
