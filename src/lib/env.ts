// Centralized env access. Reads BOTH the NEXT_PUBLIC_* names and the plain
// SUPABASE_* names that Vercel's Supabase integration injects, so it works no
// matter which the integration set. Returns "" instead of throwing on the
// server-side clients that only need the value at request time.
function first(...names: string[]): string {
  for (const n of names) {
    const v = process.env[n];
    if (v) return v;
  }
  return "";
}

export const env = {
  supabaseUrl: () => first("NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL"),
  supabaseAnonKey: () =>
    first("NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_ANON_KEY", "SUPABASE_KEY", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
  supabaseServiceRoleKey: () =>
    first("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_KEY"),
  appEncryptionKey: () => first("APP_ENCRYPTION_KEY"),
  signedUrlTtl: () => parseInt(first("SIGNED_URL_TTL_SECONDS") || "180", 10),
  bootstrap: () => ({
    keyId: first("B2_KEY_ID"),
    applicationKey: first("B2_APPLICATION_KEY"),
    bucketId: first("B2_BUCKET_ID"),
    bucketName: first("B2_BUCKET_NAME"),
    region: first("B2_REGION") || "us-west-004",
  }),
};
