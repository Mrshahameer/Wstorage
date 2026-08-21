// Seeds resource folders inside each campaign, differing by mode.
// Mode is read from the campaign's campaign_type name.
// Idempotent: skips a folder that already exists for that campaign+name.
// Run: node --env-file=.env.local scripts/seed-folders.mjs
import { createClient } from "@supabase/supabase-js";
const url = process.env.SUPABASE_URL, service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const w = createClient(url, service, { db: { schema: "wstorage" }, auth: { persistSession: false } });

const INBOUND = ["Creatives", "Landing Pages", "Ad Copy", "Ad Spend Screenshots", "Ads Preview Screenshots", "TCPA & Compliance", "Other Assets"];
const WARM = ["Creatives", "Landing Pages", "Ad Copy", "Agent Scripts", "Data Samples", "Call Recordings", "TCPA & Compliance", "Other Assets"];
const LIVE = ["Creatives", "Landing Pages", "Agent Scripts", "Verification Recordings", "Data Samples", "TCPA & Compliance", "Other Assets"];

function foldersFor(typeName) {
  if (typeName === "Warm Transfer") return WARM;
  if (typeName === "Live Transfer") return LIVE;
  return INBOUND; // Pure Inbound + Inbound (web leads)
}

async function main() {
  const { data: types } = await w.from("campaign_types").select("id,name");
  const typeName = Object.fromEntries(types.map((t) => [t.id, t.name]));
  const { data: camps } = await w.from("campaigns").select("id,name,campaign_type_id");
  const { data: existing } = await w.from("folders").select("campaign_id,name");
  const have = new Set((existing ?? []).map((f) => `${f.campaign_id}::${f.name}`));

  const rows = [];
  for (const c of camps) {
    const names = foldersFor(typeName[c.campaign_type_id]);
    names.forEach((name, i) => {
      if (have.has(`${c.id}::${name}`)) return;
      rows.push({ name, path: `/${c.name}/${name}`, folder_type: "resource", campaign_id: c.id, sort: (i + 1) * 10 });
    });
  }
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const { error } = await w.from("folders").insert(chunk);
    if (error) throw new Error(error.message);
  }
  console.log(`inserted ${rows.length} folders`);

  const { count } = await w.from("folders").select("*", { count: "exact", head: true });
  console.log(`total folders now: ${count}`);
  // sample
  const sample = await w.from("campaigns").select("id").eq("name", "Auto Insurance Pure Inbound").single();
  const sf = await w.from("folders").select("name,sort").eq("campaign_id", sample.data.id).order("sort");
  console.log("Auto Insurance Pure Inbound folders:", sf.data.map((x) => x.name).join(", "));
  console.log("done.");
}
main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
