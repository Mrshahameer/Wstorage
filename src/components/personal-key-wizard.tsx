"use client";
import { useState } from "react";

export function PersonalKeyWizard({ onComplete }: { onComplete?: () => void }) {
  const [provider, setProvider] = useState<"backblaze" | "r2">("backblaze");
  const [step, setStep] = useState(1);
  const [keyId, setKeyId] = useState("");
  const [applicationKey, setApplicationKey] = useState("");
  const [bucketName, setBucketName] = useState("");
  const [region, setRegion] = useState("us-east-005");
  const [accountId, setAccountId] = useState("");
  const [label, setLabel] = useState("My Personal Storage");
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [error, setError] = useState("");

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setStatusMsg(`Testing ${provider === "r2" ? "Cloudflare R2" : "Backblaze B2"} connection...`);
    setLoading(true);

    try {
      const res = await fetch("/api/storage-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          label: label.trim() || `My Personal ${provider === "r2" ? "R2" : "B2"} Storage`,
          keyId: keyId.trim(),
          applicationKey: applicationKey.trim(),
          bucketName: bucketName.trim(),
          region: provider === "r2" ? "auto" : region.trim() || "us-east-005",
          accountId: provider === "r2" ? accountId.trim() : undefined,
          makeActive: false, // Keep personal key available for personal uploads
        }),
      });

      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Failed to save personal storage key");

      setStatusMsg(`✅ Connection test successful! Your Personal ${provider === "r2" ? "Cloudflare R2" : "Backblaze B2"} storage is active.`);
      setTimeout(() => {
        onComplete?.();
      }, 1500);
    } catch (err: any) {
      setError(err.message || "Connection failed. Please verify your credentials.");
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
            Personal Storage Setup Wizard
          </h2>
        </div>
        <div className="flex gap-1 text-xs font-semibold text-indigo-600">
          <span className={step === 1 ? "underline" : "opacity-50"}>1. Guide</span> •{" "}
          <span className={step === 2 ? "underline" : "opacity-50"}>2. Connect</span>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <span className="text-xs font-semibold text-slate-500">Storage Provider:</span>
        <button
          type="button"
          onClick={() => { setProvider("backblaze"); setLabel("My Personal B2 Storage"); }}
          className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
            provider === "backblaze" ? "bg-indigo-600 text-white shadow-sm" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
          }`}
        >
          Backblaze B2
        </button>
        <button
          type="button"
          onClick={() => { setProvider("r2"); setLabel("My Personal R2 Storage"); }}
          className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
            provider === "r2" ? "bg-indigo-600 text-white shadow-sm" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
          }`}
        >
          Cloudflare R2
        </button>
      </div>

      {step === 1 && (
        <div className="mt-5 space-y-4">
          <p className="text-sm text-slate-600">
            Follow these 4 simple steps in your {provider === "r2" ? "Cloudflare Dashboard" : "Backblaze B2 dashboard"} to attach your personal storage bucket:
          </p>

          {provider === "backblaze" ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              <div className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-1">
                <div className="font-semibold text-indigo-600">Step 1: Open Backblaze B2</div>
                <p className="text-slate-500">
                  Log into Backblaze, go to <strong>Buckets</strong> ➔ <strong>Create a Bucket</strong> (Private).
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
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              <div className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-1">
                <div className="font-semibold text-indigo-600">Step 1: Open Cloudflare R2</div>
                <p className="text-slate-500">
                  Log into Cloudflare, go to <strong>R2</strong> ➔ <strong>Create bucket</strong>.
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-1">
                <div className="font-semibold text-indigo-600">Step 2: Create API Token</div>
                <p className="text-slate-500">
                  Click <strong>Manage R2 API Tokens</strong> ➔ <strong>Create API Token</strong> (Edit permissions).
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-1">
                <div className="font-semibold text-indigo-600">Step 3: S3 Credentials</div>
                <p className="text-slate-500">
                  Copy the <strong>Access Key ID</strong> and <strong>Secret Access Key</strong> under S3 clients.
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-1">
                <div className="font-semibold text-indigo-600">Step 4: Account ID</div>
                <p className="text-slate-500">
                  Copy your 32-character <strong>Account ID</strong> from your endpoint URL.
                </p>
              </div>
            </div>
          )}

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
                placeholder="my-personal-bucket"
              />
            </label>

            {provider === "r2" && (
              <label className="block sm:col-span-2">
                <span className="text-xs font-medium text-slate-600">Cloudflare Account ID</span>
                <input
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                  required
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs outline-none focus:border-indigo-500"
                  placeholder="eb58d34f19bab0c4945809f10e3dd539"
                />
              </label>
            )}

            <label className="block">
              <span className="text-xs font-medium text-slate-600">{provider === "r2" ? "Access Key ID" : "keyID"}</span>
              <input
                value={keyId}
                onChange={(e) => setKeyId(e.target.value)}
                required
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs outline-none focus:border-indigo-500"
                placeholder={provider === "r2" ? "2eed938146c..." : "005aa838221..."}
              />
            </label>

            <label className="block">
              <span className="text-xs font-medium text-slate-600">
                {provider === "r2" ? "Secret Access Key" : "applicationKey (Secret)"}
              </span>
              <input
                type="password"
                value={applicationKey}
                onChange={(e) => setApplicationKey(e.target.value)}
                required
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs outline-none focus:border-indigo-500"
                placeholder="secret..."
              />
            </label>

            {provider === "backblaze" && (
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
            )}
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
              {loading ? "Testing Connection..." : "Save Personal Storage Key"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
