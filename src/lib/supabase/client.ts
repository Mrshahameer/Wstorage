// Browser client. Must reference NEXT_PUBLIC_* env vars STATICALLY — Next.js only
// inlines literal process.env.NEXT_PUBLIC_X references into the browser bundle,
// not dynamic lookups. Uses the publishable key (or anon key if present).
"use client";
import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL as string) || "https://placeholder.supabase.co";
  const key = ((process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) as string) || "placeholder-anon-key";
  return createBrowserClient(url, key);
}
