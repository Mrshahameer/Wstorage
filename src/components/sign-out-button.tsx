"use client";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function SignOutButton() {
  const router = useRouter();
  async function signOut() {
    await createClient().auth.signOut();
    router.replace("/login");
  }
  return (
    <button onClick={signOut} className="text-brand hover:underline">Sign out</button>
  );
}
