// DESTRUCTIVE: wipes all files, folders, and taxonomy, then reseeds exactly
// 3 categories (Insurance, Home Services, Web Leads) with their verticals.
// Keeps: campaign_types, resource_types, users. Storage objects in the bucket
// are NOT deleted (can't decrypt keys here) — they just become orphaned.
// Run: node --env-file=.env.local scripts/reset-and-seed.mjs
import { createClient } from "@supabase/supabase-js";
const url = process.env.SUPABASE_URL, service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const w = createClient(url, service, { db: { schema: "wstorage" }, auth: { persistSession: false } });

const ALL = (q) => q.not("id", "is", null); // match every row

async function wipe(table) {
  const { error, count } = await ALL(w.from(table).delete({ count: "exact" }));
  console.log(`  ${error ? "ERR " + error.message : "cleared"} ${table}${count != null ? ` (${count})` : ""}`);
}

const INSURANCE = [
  "Auto Insurance", "Final Expense", "ACA (Obamacare)", "Medicare", "Medicare Advantage",
  "U65 Health", "SSDI", "Home Insurance", "Life Insurance", "Term Life Insurance",
  "Health Insurance", "Dental Insurance", "Debt Settlement", "Home Warranty", "Pharmacy",
];
const HOME_SERVICES = [
  "Roofing", "Windows", "Bathroom Remodeling", "Kitchen Remodeling", "Siding",
  "Flooring", "Gutters", "Solar", "HVAC", "Plumbing", "Pest Control", "Home Security",
];
const WEB_LEADS = [
  "Auto Insurance Web Leads", "Roofing Web Leads", "Windows Web Leads", "Bathroom Web Leads",
  "Siding Web Leads", "Plumbing Web Leads", "HVAC Web Leads", "Pest Control Web Leads",
];

async function main() {
  console.log("== WIPE ==");
  // Share links + granular grants reference resources by uuid; clear them first.
  await wipe("share_link_resources");
  await wipe("share_links");
  await wipe("user_resource_permissions");
  // Files cascade file_versions/favorites/collection_files/file_access; downloads set null.
  await wipe("files");
  await wipe("folders");        // cascades folder_access
  await wipe("campaigns");
  await wipe("verticals");
  await wipe("categories");     // cascades category_access

  console.log("== SEED categories ==");
  const cats = [
    { name: "Insurance", icon: "shield", sort: 10 },
    { name: "Home Services", icon: "home", sort: 20 },
    { name: "Web Leads", icon: "globe", sort: 30 },
  ];
  const { data: created, error } = await w.from("categories").insert(cats).select("id,name");
  if (error) throw new Error(error.message);
  const idByName = Object.fromEntries(created.map((c) => [c.name, c.id]));
  console.log("  created:", created.map((c) => c.name).join(", "));

  const seedVerts = async (catName, names) => {
    const catId = idByName[catName];
    const rows = names.map((name, i) => ({ category_id: catId, name, sort: (i + 1) * 10 }));
    const { error } = await w.from("verticals").insert(rows);
    if (error) throw new Error(`${catName}: ${error.message}`);
    console.log(`  ${catName}: ${names.length} verticals`);
  };
  console.log("== SEED verticals ==");
  await seedVerts("Insurance", INSURANCE);
  await seedVerts("Home Services", HOME_SERVICES);
  await seedVerts("Web Leads", WEB_LEADS);

  console.log("== VERIFY ==");
  for (const t of ["categories", "verticals", "campaigns", "folders", "files"]) {
    const { count } = await w.from(t).select("*", { count: "exact", head: true });
    console.log(`  ${t}: ${count}`);
  }
  console.log("done.");
}
main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
