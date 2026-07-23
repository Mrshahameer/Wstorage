// Centralized, validated env access. Fails fast if something critical is missing.
function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}
function opt(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

export const env = {
  supabaseUrl: () => req("NEXT_PUBLIC_SUPABASE_URL"),
  supabaseAnonKey: () => req("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  supabaseServiceRoleKey: () => req("SUPABASE_SERVICE_ROLE_KEY"),
  appEncryptionKey: () => req("APP_ENCRYPTION_KEY"),
  signedUrlTtl: () => parseInt(opt("SIGNED_URL_TTL_SECONDS", "180"), 10),
  bootstrap: () => ({
    keyId: opt("B2_KEY_ID"),
    applicationKey: opt("B2_APPLICATION_KEY"),
    bucketId: opt("B2_BUCKET_ID"),
    bucketName: opt("B2_BUCKET_NAME"),
    region: opt("B2_REGION", "us-west-004"),
  }),
};
