"use client";
import { createClient } from "@/lib/supabase/client";

export function SignOutButton() {
  return (
    <button
      onClick={async () => {
        // Saved assistant chats stay on this device only until sign-out.
        try {
          Object.keys(window.localStorage).filter((k) => k.startsWith("wstorage.assistant.")).forEach((k) => window.localStorage.removeItem(k));
        } catch { /* storage unavailable */ }
        await createClient().auth.signOut();
        window.location.replace("/login"); // full reload drops the in-memory chat too
      }}
      className="text-sm text-slate-400 hover:text-white transition"
    >
      Sign out
    </button>
  );
}
