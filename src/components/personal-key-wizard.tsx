"use client";
import { useState } from "react";

export function PersonalKeyWizard({ onComplete }: { onComplete?: () => void }) {
  const [step, setStep] = useState(1);
  const [keyId, setKeyId] = useState("");
  const [applicationKey, setApplicationKey] = useState("");
  const [bucketName, setBucketName] = useState("");
  const [region, setRegion] = useState("us-east-005");
  const [label, setLabel] = useState("My Personal B2 Storage");
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [error, setError] = useState("");

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setStatusMsg("Testing Backblaze B2 connection...");
    setLoading(true);

    try {
      const res = await fetch("/api/storage-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "backblaze",
          label: label.trim() || "My Personal B2 Storage",
          keyId: keyId.trim(),
          applicationKey: applicationKey.trim(),
          bucketName: bucketName.trim(),
          region: region.trim() || "us-east-005",
          makeActive: false, // Keep personal key available for personal uploads
        }),
      });

      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Failed to save personal storage key");

      setStatusMsg("✅ Connection test successful! Your Personal Backblaze Storage is active.");
      setTimeout(() => {
        onComplete?.();
      }, 1500);
    } catch (err: any) {
      setError(err.message || "Connection failed. Please verify your Backblaze B2 credentials.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50/50 to-white p-6 shadow-sm">
      <div className="flex items-center justify-between border-b border-indigo-100 pb-4">
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-100 px-3 py-1 text-xs font-semibold text-indigo-700">
            🎉 Approved by Super Admin
          </span>
          <h2 className="text-lg font-semibold text-slate-800 mt-2">
            Personal Backblaze B2 Setup Wizard
          </h2>
        </div>
        <div className="flex gap-1 text-xs font-semibold text-indigo-600">
          <span className={step === 1 ? "underline" : "opacity-50"}>1. Guide</span> •{" "}
          <span className={step === 2 ? "underline" : "opacity-50"}>2. Connect</span>
        </div>
      </div>

      {step === 1 && (
        <div className="mt-5 space-y-4">
          <p className="text-sm text-slate-600">
            Follow these 4 simple steps in your Backblaze B2 dashboard to attach your personal storage bucket:
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            <div className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-1">
              <div className="font-semibold text-indigo-600">Step 1: Open Backblaze B2</div>
              <p className="text-slate-500">
                Log into your Backblaze account, go to <strong>Buckets</strong> ➔ <strong>Create a Bucket</strong> (Private).
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-1">
              <div className="font-semibold text-indigo-600">Step 2: Add Application Key</div>
              <p className="text-slate-500">
                Go to <strong>Application Keys</strong> ➔ Click <strong>Add a New Application Key</strong>.
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-1">
              <div className="font-semibold text-indigo-600">Step 3: Enable Capabilities</div>
              <p className="text-slate-500">
                Check: <code className="bg-slate-100 px-1">readFiles</code>, <code className="bg-slate-100 px-1">writeFiles</code>, <code className="bg-slate-100 px-1">deleteFiles</code>, <code className="bg-slate-100 px-1">listFiles</code>.
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-1">
              <div className="font-semibold text-indigo-600">Step 4: Copy Secret Key</div>
              <p className="text-slate-500">
                Copy the <strong>keyID</strong> and the 31-character <strong>applicationKey</strong> secret.
              </p>
            </div>
          </div>

          <div className="pt-2 text-right">
            <button
              onClick={() => setStep(2)}
              className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition"
            >
              I Have My Keys ➔ Continue to Setup
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <form onSubmit={handleSave} className="mt-5 space-y-4 text-sm">
          {error && (
            <div className="rounded-lg bg-rose-50 border border-rose-200 p-3 text-xs text-rose-700">
              {error}
            </div>
          )}

          {statusMsg && (
            <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-xs text-emerald-700">
              {statusMsg}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-slate-600">Label</span>
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                required
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-indigo-500"
                placeholder="My Personal Vault"
              />
            </label>

            <label className="block">
              <span className="text-xs font-medium text-slate-600">Bucket Name</span>
              <input
                value={bucketName}
                onChange={(e) => setBucketName(e.target.value)}
                required
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-indigo-500"
                placeholder="my-personal-b2-bucket"
              />
            </label>

            <label className="block">
              <span className="text-xs font-medium text-slate-600">keyID</span>
              <input
                value={keyId}
                onChange={(e) => setKeyId(e.target.value)}
                required
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs outline-none focus:border-indigo-500"
                placeholder="005aa838221..."
              />
            </label>

            <label className="block">
              <span className="text-xs font-medium text-slate-600">applicationKey (Secret)</span>
              <input
                type="password"
                value={applicationKey}
                onChange={(e) => setApplicationKey(e.target.value)}
                required
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs outline-none focus:border-indigo-500"
                placeholder="K005ZHPPnB35..."
              />
            </label>

            <label className="block sm:col-span-2">
              <span className="text-xs font-medium text-slate-600">Region</span>
              <input
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                required
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs outline-none focus:border-indigo-500"
                placeholder="us-east-005 or us-west-004"
              />
            </label>
          </div>

          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="text-xs font-medium text-slate-500 hover:text-slate-800"
            >
              ← Back to Guide
            </button>

            <button
              type="submit"
              disabled={loading}
              className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition disabled:opacity-50"
            >
              {loading ? "Testing Connection..." : "Save & Activate Personal Storage"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
