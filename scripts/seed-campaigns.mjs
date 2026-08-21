// Seeds the mode campaigns under each vertical:
//   Insurance + Home Services verticals -> Pure Inbound, Warm Transfer, Live Transfer
//   Web Leads verticals                 -> Inbound (only)
// Campaign names are prefixed with the vertical, e.g. "Auto Insurance Pure Inbound".
// Idempotent: skips a campaign that already exists for that vertical+name.
// Run: node --env-file=.env.local scripts/seed-campaigns.mjs
import { createClient } from "@supabase/supabase-js";
const url = process.env.SUPABASE_URL, service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const w = createClient(url, service, { db: { schema: "wstorage" }, auth: { persistSession: false } });

async function ensureType(name, sort) {
  const ex = await w.from("campaign_types").select("id").eq("name", name).maybeSingle();
  if (ex.data) return ex.data.id;
  const ins = await w.from("campaign_types").insert({ name, sort }).select("id").single();
  return ins.data.id;
}

async function main() {
  // Modes -> campaign_type ids
  const tPureInbound = await ensureType("Pure Inbound", 5);
  const tWarm = await ensureType("Warm Transfer", 20);
  const tLive = await ensureType("Live Transfer", 30);
  const tInbound = await ensureType("Inbound", 10);

  const STANDARD = [
    { suffix: "Pure Inbound", type: tPureInbound },
    { suffix: "Warm Transfer", type: tWarm },
    { suffix: "Live Transfer", type: tLive },
  ];
  const WEBLEADS = [{ suffix: "Inbound", type: tInbound }];

  const { data: cats } = await w.from("categories").select("id,name");
  const catName = Object.fromEntries(cats.map((c) => [c.id, c.name]));
  const { data: verts } = await w.from("verticals").select("id,name,category_id").order("sort");

  // Existing campaigns to stay idempotent.
  const { data: existing } = await w.from("campaigns").select("vertical_id,name");
  const have = new Set((existing ?? []).map((c) => `${c.vertical_id}::${c.name}`));

  const rows = [];
  for (const v of verts) {
    const modes = catName[v.category_id] === "Web Leads" ? WEBLEADS : STANDARD;
    for (const m of modes) {
      const name = `${v.name} ${m.suffix}`;
      if (have.has(`${v.id}::${name}`)) continue;
      rows.push({ vertical_id: v.id, campaign_type_id: m.type, name, status: "active" });
    }
  }

  if (rows.length) {
    // Insert in chunks to be safe.
    for (let i = 0; i < rows.length; i += 100) {
      const chunk = rows.slice(i, i + 100);
      const { error } = await w.from("campaigns").insert(chunk);
      if (error) throw new Error(error.message);
    }
  }
  console.log(`inserted ${rows.length} campaigns`);

  // Verify
  const { count } = await w.from("campaigns").select("*", { count: "exact", head: true });
  console.log(`total campaigns now: ${count}`);
  for (const c of cats) {
    const vs = verts.filter((v) => v.category_id === c.id).map((v) => v.id);
    if (!vs.length) continue;
    const { count: cc } = await w.from("campaigns").select("*", { count: "exact", head: true }).in("vertical_id", vs);
    console.log(`  ${c.name}: ${cc} campaigns across ${vs.length} verticals`);
  }
  console.log("done.");
}
main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
