// Server client bound to the request cookies (respects RLS as the logged-in user).
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { env } from "@/lib/env";

type CookieToSet = { name: string; value: string; options: CookieOptions };

export async function createServerSupabase() {
  const cookieStore = await cookies();
  const url = env.supabaseUrl() || "https://placeholder.supabase.co";
  const key = env.supabaseAnonKey() || "placeholder-anon-key";
  return createServerClient(url, key, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet: CookieToSet[]) => {
        try {
          toSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // Called from a Server Component — safe to ignore; middleware refreshes.
        }
      },
    },
  });
}
