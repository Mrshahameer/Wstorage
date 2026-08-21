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

export function UsersManager({ canManage }: { canManage: boolean }) {
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [managing, setManaging] = useState<User | null>(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("employee");
  const [busy, setBusy] = useState(false);

  async function load() {
    const r = await fetch("/api/users");
    const j = await r.json();
    if (r.ok) setUsers(j.users); else setError(j.error);
  }
  useEffect(() => { load(); }, []);

  async function createUser() {
    setBusy(true); setError(null);
    const r = await fetch("/api/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, role }) });
    const j = await r.json(); setBusy(false);
    if (!r.ok) return setError(j.error || "Failed to create user");
    setEmail(""); setPassword(""); setRole("employee"); load();
  }
  async function updateRole(id: string, newRole: string) {
    await fetch(`/api/users/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: newRole }) });
    load();
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Users &amp; access</h1>
        <p className="text-sm text-slate-500 mt-1">Invite people, set roles, and choose exactly which categories, campaigns, and folders each person can see.</p>
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
          {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
        </section>
      )}

      <section>
        <h2 className="font-medium mb-3">Team members</h2>
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-400 border-b border-slate-100">
                <th className="px-5 py-3 font-medium">Email</th>
                <th className="px-5 py-3 font-medium">Role</th>
                <th className="px-5 py-3 font-medium">Access</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-slate-50/70">
                  <td className="px-5 py-3 font-medium text-slate-800">{u.email}</td>
                  <td className="px-5 py-3">
                    {canManage ? (
                      <select value={u.role} onChange={(e) => updateRole(u.id, e.target.value)} className={inputCls + " py-1"}>
                        {ROLE_OPTIONS.map((o) => <option key={o.v} value={o.v}>{roleLabel(o.v)}</option>)}
                      </select>
                    ) : <span className="text-slate-600">{roleLabel(u.role)}</span>}
                  </td>
                  <td className="px-5 py-3">
                    {isFullAccess(u.role) ? <span className="text-slate-400 text-xs">All files (admin)</span>
                      : canManage ? <button onClick={() => setManaging(u)} className="text-indigo-600 text-xs hover:underline">Manage access</button>
                      : <span className="text-slate-500 text-xs">Assigned resources</span>}
                  </td>
                </tr>
              ))}
              {users.length === 0 && <tr><td colSpan={3} className="px-5 py-10 text-center text-slate-400">No members yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {managing && (
        <AccessTree userId={managing.id} email={managing.email} onClose={() => setManaging(null)} onSaved={load} />
      )}
    </div>
  );
}
