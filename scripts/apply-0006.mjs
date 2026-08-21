// One-off: apply migration 0006 to the live DB and verify. Run: node scripts/apply-0006.mjs
import { readFileSync } from "node:fs";
import pg from "pg";

const raw = process.env.POSTGRES_URL_NON_POOLING;
if (!raw) { console.error("Missing POSTGRES_URL_NON_POOLING"); process.exit(1); }
const conn = raw.split("?")[0]; // drop sslmode= so our ssl object governs

const sql = readFileSync(new URL("../supabase/migrations/0006_campaign_intelligence.sql", import.meta.url), "utf8");
const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });

async function main() {
  await client.connect();
  console.log("connected. applying 0006 …");
  await client.query(sql);           // whole file, one implicit tx (PG15 allows enum add in tx)
  console.log("✓ migration applied");

  const checks = [
    ["verticals table", "select count(*)::int c from wstorage.verticals"],
    ["campaign_types seeded", "select count(*)::int c from wstorage.campaign_types"],
    ["campaigns table", "select count(*)::int c from wstorage.campaigns"],
    ["resource_types seeded", "select count(*)::int c from wstorage.resource_types"],
    ["categories", "select count(*)::int c from wstorage.categories"],
    ["user_resource_permissions", "select count(*)::int c from wstorage.user_resource_permissions"],
    ["share_links", "select count(*)::int c from wstorage.share_links"],
    ["share_link_resources", "select count(*)::int c from wstorage.share_link_resources"],
    ["files.resource_type_id col", "select count(*)::int c from information_schema.columns where table_schema='wstorage' and table_name='files' and column_name='resource_type_id'"],
    ["files.live_url col", "select count(*)::int c from information_schema.columns where table_schema='wstorage' and table_name='files' and column_name='live_url'"],
    ["app_role has bd_manager", "select count(*)::int c from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='app_role' and e.enumlabel='bd_manager'"],
    ["folder_descendants() fn", "select count(*)::int c from pg_proc where proname='folder_descendants'"],
  ];
  for (const [label, q] of checks) {
    const { rows } = await client.query(q);
    console.log(`  ${rows[0].c > 0 ? "✓" : "✗"} ${label}: ${rows[0].c}`);
  }
  await client.end();
  console.log("done.");
}
main().catch(async (e) => { console.error("ERROR:", e.message); await client.end().catch(()=>{}); process.exit(1); });
