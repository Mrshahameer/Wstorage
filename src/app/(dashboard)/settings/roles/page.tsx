import { getSessionUser } from "@/lib/auth";
import { redirect } from "next/navigation";

const ROLES = ["Super Admin", "Admin / Manager", "BD Manager", "Employee", "Client"] as const;
const PERMS: { name: string; values: string[] }[] = [
  { name: "View", values: ["Yes", "Yes", "Yes", "Assigned", "Assigned"] },
  { name: "Download", values: ["Yes", "Yes", "Yes", "Assigned", "Configurable"] },
  { name: "Upload", values: ["Yes", "Assigned", "Optional", "No", "No"] },
  { name: "Edit", values: ["Yes", "Assigned", "No", "No", "No"] },
  { name: "Delete", values: ["Yes", "Assigned", "No", "No", "No"] },
  { name: "Share", values: ["Yes", "Optional", "Optional", "No", "No"] },
  { name: "Manage users", values: ["Yes", "Optional", "No", "No", "No"] },
];

function cell(v: string) {
  const base = "rounded-full px-2.5 py-0.5 text-[11px] font-semibold";
  if (v === "Yes") return <span className={`${base} bg-emerald-100 text-emerald-700`}>Yes</span>;
  if (v === "No") return <span className={`${base} bg-rose-100 text-rose-600`}>No</span>;
  return <span className={`${base} bg-amber-100 text-amber-700`}>{v}</span>;
}

export default async function RolesPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Roles &amp; permissions</h1>
        <p className="text-sm text-slate-500 mt-1">
          Roles set default capabilities. Fine-grained, per-resource access (which categories,
          campaigns, and folders a person can see) is assigned on the <b>Users &amp; access</b> page.
        </p>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-slate-400 border-b border-slate-100 bg-slate-50/50">
              <th className="px-5 py-3 font-medium">Permission</th>
              {ROLES.map((r) => <th key={r} className="px-4 py-3 font-medium text-center">{r}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {PERMS.map((p) => (
              <tr key={p.name} className="hover:bg-slate-50/50">
                <td className="px-5 py-3 font-medium text-slate-700">{p.name}</td>
                {p.values.map((v, i) => <td key={i} className="px-4 py-3 text-center">{cell(v)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
        <h2 className="font-semibold text-slate-800 mb-2">How access is decided</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li><b>Assigned</b> means the person only sees the categories, campaigns, or folders granted to them.</li>
          <li>Grants inherit down the tree (grant a vertical → its campaigns and folders come with it) unless a specific <b>Deny</b> overrides it.</li>
          <li><b>Deny</b> always beats <b>Allow</b>. Temporary access can be given an expiry date.</li>
          <li>Every request is re-checked on the server — hiding an item in the UI is never the only protection.</li>
        </ul>
      </div>
    </div>
  );
}
