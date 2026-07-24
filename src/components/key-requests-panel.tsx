"use client";
import { useEffect, useState } from "react";

interface KeyRequest {
  id: string;
  user_id: string;
  status: "pending" | "approved" | "rejected";
  notes: string;
  requested_at: string;
}

export function KeyRequestsPanel({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const [requests, setRequests] = useState<KeyRequest[]>([]);
  const [userStatus, setUserStatus] = useState<KeyRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [requesting, setRequesting] = useState(false);
  const [notes, setNotes] = useState("");
  const [msg, setMsg] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/key-requests");
      const j = await res.json();
      if (res.ok) {
        const list: KeyRequest[] = j.requests ?? [];
        setRequests(list);
        if (!isSuperAdmin && list.length > 0) {
          setUserStatus(list[0]);
        }
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [isSuperAdmin]);

  const handleAction = async (id: string, action: "approve" | "reject") => {
    const res = await fetch(`/api/key-requests/${id}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    if (res.ok) {
      load();
    }
  };

  const handleRequestSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setRequesting(true);
    try {
      const res = await fetch("/api/key-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes }),
      });
      const j = await res.json();
      if (res.ok) {
        setMsg("✅ Request submitted! Super Admin has been notified.");
        load();
      } else {
        setMsg("❌ " + (j.error || "Failed to submit request"));
      }
    } finally {
      setRequesting(false);
    }
  };

  const pendingCount = requests.filter((r) => r.status === "pending").length;

  if (isSuperAdmin) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold text-slate-800">
              Personal Storage Key Requests
            </h3>
            {pendingCount > 0 && (
              <span className="rounded-full bg-amber-500 px-2.5 py-0.5 text-xs font-bold text-white animate-pulse">
                {pendingCount} Pending
              </span>
            )}
          </div>
        </div>

        {requests.length === 0 ? (
          <p className="text-xs text-slate-400">No key requests from users yet.</p>
        ) : (
          <div className="divide-y divide-slate-100 text-xs">
            {requests.map((r) => (
              <div key={r.id} className="py-3 flex items-center justify-between">
                <div>
                  <div className="font-medium text-slate-700">User ID: {r.user_id.slice(0, 8)}...</div>
                  <div className="text-slate-500 italic mt-0.5">"{r.notes}"</div>
                  <div className="text-slate-400 text-[10px] mt-0.5">
                    Requested on {new Date(r.requested_at).toLocaleDateString()}
                  </div>
                </div>

                <div>
                  {r.status === "pending" ? (
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleAction(r.id, "approve")}
                        className="rounded bg-emerald-600 px-3 py-1 font-medium text-white hover:bg-emerald-700"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => handleAction(r.id, "reject")}
                        className="rounded bg-rose-600 px-3 py-1 font-medium text-white hover:bg-rose-700"
                      >
                        Reject
                      </button>
                    </div>
                  ) : (
                    <span
                      className={`rounded-full px-2.5 py-0.5 font-semibold text-[10px] uppercase ${
                        r.status === "approved"
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-rose-100 text-rose-800"
                      }`}
                    >
                      {r.status}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Employee / User view
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
      <h3 className="text-sm font-semibold text-slate-800">
        Personal Backblaze Storage Key Access
      </h3>

      {userStatus ? (
        <div className="text-xs space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-slate-600">Status:</span>
            <span
              className={`rounded-full px-2.5 py-0.5 font-semibold text-[10px] uppercase ${
                userStatus.status === "approved"
                  ? "bg-emerald-100 text-emerald-800"
                  : userStatus.status === "pending"
                  ? "bg-amber-100 text-amber-800"
                  : "bg-rose-100 text-rose-800"
              }`}
            >
              {userStatus.status}
            </span>
          </div>

          {userStatus.status === "pending" && (
            <p className="text-slate-500 italic">
              Your request is awaiting review by Super Admin.
            </p>
          )}

          {userStatus.status === "approved" && (
            <p className="text-emerald-700 font-medium">
              ✅ Super Admin approved your request! You can now use the Setup Wizard to attach your B2 bucket.
            </p>
          )}
        </div>
      ) : (
        <form onSubmit={handleRequestSubmit} className="space-y-3 text-xs">
          <p className="text-slate-500">
            Want to store files directly in your own Backblaze B2 bucket? Submit a request for Super Admin approval:
          </p>

          {msg && <div className="text-indigo-600 font-medium">{msg}</div>}

          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional reason (e.g., Storing personal project assets & raw video backups)"
            className="w-full rounded-lg border border-slate-300 p-2 text-xs outline-none focus:border-indigo-500"
            rows={2}
          />

          <button
            type="submit"
            disabled={requesting}
            className="rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {requesting ? "Submitting..." : "Request Personal B2 Key Permission"}
          </button>
        </form>
      )}
    </div>
  );
}
