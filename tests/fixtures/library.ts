// A small library shaped like production: 3 categories, 7 verticals, 10
// campaigns, the 7 standard folders per campaign, one nested subfolder, and
// some empty folders. Used by the unit tests and the live model eval.
import type { Rows } from "../../src/lib/assistant/catalog";
import type { FileRow, FileSource } from "../../src/lib/assistant/data";

const FOLDERS: [string, string][] = [
  ["cr", "Creatives"],
  ["lp", "Landing Pages"],
  ["as", "Agent Scripts"],
  ["vr", "Verification Recordings"],
  ["ds", "Data Samples"],
  ["tc", "TCPA & Compliance"],
  ["oa", "Other Assets"],
];

const campaigns: Rows["campaigns"] = [
  { id: "a1", name: "ACA (Obamacare) Pure Inbound", vertical_id: "vA", campaign_type_id: "tP" },
  { id: "a2", name: "ACA (Obamacare) Live Transfer", vertical_id: "vA", campaign_type_id: "tL" },
  { id: "a3", name: "ACA (Obamacare) Warm Transfer", vertical_id: "vA", campaign_type_id: "tW" },
  { id: "u1", name: "Auto Insurance Pure Inbound", vertical_id: "vU", campaign_type_id: "tP" },
  { id: "u2", name: "Auto Insurance Live Transfer", vertical_id: "vU", campaign_type_id: "tL" },
  { id: "f1", name: "Final Expense Pure Inbound", vertical_id: "vF", campaign_type_id: "tP" },
  { id: "r1", name: "Roofing Pure Inbound", vertical_id: "vR", campaign_type_id: "tP" },
  { id: "w1", name: "Windows Pure Inbound", vertical_id: "vWn", campaign_type_id: "tP" },
  { id: "b1", name: "Bathroom Remodeling Live Transfer", vertical_id: "vB", campaign_type_id: "tL" },
  { id: "uw1", name: "Auto Insurance Web Leads Inbound", vertical_id: "vUW", campaign_type_id: "tWI" },
];

const folders: Rows["folders"] = [
  ...campaigns.flatMap((c) => FOLDERS.map(([k, name], i) => ({ id: `${c.id}-${k}`, name, parent_id: null, campaign_id: c.id, sort: i }))),
  { id: "a1-cr-sub", name: "Shower Variants", parent_id: "a1-cr", campaign_id: "a1", sort: 0 },
];

let n = 0;
const file = (folder: string, name: string, ext: string, tags: string[] = [], live: string | null = null): FileRow => {
  n++;
  const day = String((n % 27) + 1).padStart(2, "0");
  return {
    id: `file-${n}`,
    name,
    description: null,
    extension: ext,
    content_type: ext === "png" ? "image/png" : ext === "mp3" ? "audio/mpeg" : ext === "html" ? "text/html" : "application/octet-stream",
    size_bytes: 1000 * n,
    created_at: `2026-10-${day}T10:00:00Z`,
    updated_at: `2026-10-${day}T12:00:00Z`,
    tags,
    live_url: live,
    folder_id: folder,
  };
};

export const FILES: FileRow[] = [
  file("a1-lp", "ACA_PureInbound_Landing.html", "html", ["tcpa-ok"], "https://example.com/aca-inbound"),
  file("a1-cr", "ACA_PureInbound_Banner_1x1.png", "png"),
  file("a1-cr", "ACA_PureInbound_Banner_16x9.png", "png"),
  file("a1-cr-sub", "ACA_PureInbound_Shower_9x16.png", "png"),
  file("a1-vr", "ACA_PureInbound_Verification_01.mp3", "mp3", ["verified"]),
  file("a2-lp", "ACA_LiveTransfer_Landing.html", "html"),
  file("a2-cr", "ACA_LiveTransfer_Banner.png", "png"),
  file("a3-cr", "ACA_WarmTransfer_Banner.png", "png"),
  file("u1-lp", "AutoInsurance_PureInbound_Landing.html", "html"),
  file("u1-vr", "AutoInsurance_PureInbound_Call_01.mp3", "mp3", ["tcpa-consent"]),
  file("u1-vr", "AutoInsurance_PureInbound_Call_02.mp3", "mp3"),
  file("u1-vr", "AutoInsurance_PureInbound_Call_03.mp3", "mp3"),
  file("u2-vr", "AutoInsurance_LiveTransfer_Call_01.mp3", "mp3"),
  file("u2-as", "AutoInsurance_LiveTransfer_Agent_Script.docx", "docx"),
  file("f1-lp", "FinalExpense_PureInbound_Landing.html", "html"),
  file("r1-lp", "Roofing_PureInbound_Landing.html", "html"),
  file("w1-lp", "Windows_PureInbound_Landing.html", "html"),
  file("b1-cr", "BathroomRemodeling_LT_01_Shower_1x1.png", "png"),
  file("b1-cr", "BathroomRemodeling_LT_01_Shower_9x16.png", "png"),
  file("b1-tc", "BathroomRemodeling_LT_TCPA_Compliance.docx", "docx", ["tcpa"]),
  file("uw1-lp", "AutoInsurance_WebLeads_Landing.html", "html"),
];

export const ROWS: Rows = {
  categories: [
    { id: "cI", name: "Insurance" },
    { id: "cH", name: "Home Services" },
    { id: "cW", name: "Web Leads" },
  ],
  verticals: [
    { id: "vA", name: "ACA (Obamacare)", category_id: "cI" },
    { id: "vU", name: "Auto Insurance", category_id: "cI" },
    { id: "vF", name: "Final Expense", category_id: "cI" },
    { id: "vR", name: "Roofing", category_id: "cH" },
    { id: "vWn", name: "Windows", category_id: "cH" },
    { id: "vB", name: "Bathroom Remodeling", category_id: "cH" },
    { id: "vUW", name: "Auto Insurance Web Leads", category_id: "cW" },
  ],
  campaignTypes: [
    { id: "tL", name: "Live Transfer" },
    { id: "tW", name: "Warm Transfer" },
    { id: "tP", name: "Pure Inbound" },
    { id: "tWI", name: "Web Leads Inbound" },
  ],
  campaigns,
  folders,
  files: FILES.map((f) => ({ folder_id: f.folder_id })),
};

/** In-memory stand-in for the Supabase file queries. */
export const memorySource: FileSource = {
  async byFolders(ids, limit) {
    const rows = FILES.filter((f) => f.folder_id && ids.includes(f.folder_id)).sort((a, b) => b.created_at.localeCompare(a.created_at));
    return { rows: rows.slice(0, limit), total: rows.length };
  },
  async search(words, limit) {
    const ws = words.map((w) => w.toLowerCase());
    return FILES.filter((f) => ws.some((w) => `${f.name} ${(f.tags ?? []).join(" ")}`.toLowerCase().includes(w))).slice(0, limit);
  },
};
