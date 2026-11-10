// Live eval of the assistant against real models, using the test fixture
// library. Checks which tools the model calls and with which campaigns and
// folders. Run before changing the prompt or tools:
//   GEMINI_API_KEY=... npm run eval:assistant
//   AI_EVAL_MODELS=gemini-3.5-flash-lite,gemini-3.1-flash-lite (optional)
import { buildCatalog, catalogText, type Catalog } from "../src/lib/assistant/catalog";
import { runAgent, systemPrompt, resetCooldowns } from "../src/lib/assistant/agent";
import { geminiSession } from "../src/lib/assistant/providers";
import { runTool, TOOL_DECLARATIONS, type ToolCall } from "../src/lib/assistant/tools";
import { ROWS, memorySource } from "../tests/fixtures/library";

const KEY = process.env.GEMINI_API_KEY;
if (!KEY) { console.error("Set GEMINI_API_KEY to run the live eval."); process.exit(1); }
const PAUSE_MS = Number(process.env.AI_EVAL_PAUSE_MS ?? 4000); // stay under free-tier per-minute limits
const MODELS = (process.env.AI_EVAL_MODELS ?? "gemini-3.5-flash-lite,gemini-3.1-flash-lite").split(",").map((m) => m.trim()).filter(Boolean);

const cat: Catalog = buildCatalog(ROWS, null);
const nameOf = (r: string) => cat.byRef.get(String(r).toUpperCase())?.name ?? cat.campaigns.find((c) => c.name.toLowerCase() === String(r).toLowerCase())?.name ?? `?${r}`;
type Got = { calls: ToolCall[]; text: string };
const pairs = (g: Got) => g.calls.filter((c) => c.name === "get_assets").flatMap((c) =>
  ((c.args.items as { campaign: string; folder?: string }[]) ?? []).map((i) => `${nameOf(i.campaign)} | ${i.folder ?? "*"}`.toLowerCase()));
const has = (g: Got, campaign: string, folderWord: string) => pairs(g).some((p) => p.startsWith(campaign.toLowerCase()) && p.includes(folderWord));
const tools = (g: Got) => g.calls.map((c) => c.name);

const CASES: { q: string; check: (g: Got) => string | true }[] = [
  {
    q: "Please retrieve two specific assets from our campaign repository: 1. Asset 1: The Landing Page (live URL, preview link, or HTML/design file) associated with the ACA Inbound Campaign. 2. Asset 2: A Call Recording (audio file or shareable link) from our Auto Insurance Inbound campaign. For both assets, please include the campaign ID or name, date created or last updated, and any tracking or compliance tags attached to them.",
    check: (g) => (has(g, "ACA (Obamacare) Pure Inbound", "landing") && has(g, "Auto Insurance Pure Inbound", "record")) || `got ${pairs(g).join("; ") || tools(g).join(",") || "no tools"}`,
  },
  {
    q: "give me Landing Page from ACA Inbound Campaign and Call recording from Auto insurance inbounds",
    check: (g) => (has(g, "ACA (Obamacare) Pure Inbound", "landing") && has(g, "Auto Insurance Pure Inbound", "record")) || `got ${pairs(g).join("; ") || "no tools"}`,
  },
  {
    q: "ACA transfer lander, its creatives, recordings and ads previews",
    check: (g) => {
      const ok = ["ACA (Obamacare) Live Transfer", "ACA (Obamacare) Warm Transfer"].every((c) => has(g, c, "landing") && has(g, c, "creative") && has(g, c, "record"));
      return ok || `got ${pairs(g).join("; ") || "no tools"}`;
    },
  },
  {
    q: "creatives from ACA and the recordings from auto insurance",
    check: (g) => {
      const p = pairs(g);
      const wrong = p.filter((x) => (x.includes("creative") && !x.startsWith("aca")) || (x.includes("record") && !x.startsWith("auto insurance")));
      return (has(g, "ACA (Obamacare)", "creative") && has(g, "Auto Insurance", "record") && !wrong.length) || `got ${p.join("; ") || "no tools"}`;
    },
  },
  { q: "agent scripts for auto insurance live transfer", check: (g) => has(g, "Auto Insurance Live Transfer", "script") || `got ${pairs(g).join("; ") || "no tools"}` },
  { q: "which campaigns are missing verification recordings?", check: (g) => tools(g).includes("find_missing") || `tools: ${tools(g).join(",") || "none"}` },
  { q: "how many campaigns do we have in ACA?", check: (g) => (!tools(g).includes("get_assets") && /\b3\b|three/i.test(g.text)) || `text: ${g.text}` },
  { q: "hello", check: (g) => !g.calls.length || `tools: ${tools(g).join(",")}` },
  { q: "what categories do we have?", check: (g) => (!g.calls.length && /insurance/i.test(g.text) && /home services/i.test(g.text)) || `text: ${g.text}` },
  { q: "find the shower image", check: (g) => tools(g).includes("search_files") || `tools: ${tools(g).join(",") || "none"}` },
  { q: "what do we have for roofing?", check: (g) => (/roofing/i.test(g.text) && !pairs(g).some((p) => !p.startsWith("roofing"))) || `text: ${g.text}` },
  { q: "live transfer", check: (g) => (!tools(g).includes("get_assets") || pairs(g).length > 0) || "empty get_assets" },
];

async function main() {
  for (const model of MODELS) {
    let pass = 0, ms = 0;
    const fails: string[] = [];
    for (const c of CASES) {
      resetCooldowns();
      await new Promise((r) => setTimeout(r, PAUSE_MS));
      const calls: ToolCall[] = [];
      const t0 = Date.now();
      const r = await runAgent(systemPrompt(catalogText(cat), "2026-11-10"), [], c.q, {
        order: ["gemini"],
        models: () => [model],
        pickKey: async () => ({ id: "eval", key: KEY! }),
        markKeyUsed: async () => {},
        coolDownKey: async () => {},
        session: (_p, m, k, sys, h, u) => geminiSession(m, k, sys, h, u, TOOL_DECLARATIONS),
        runTool: (call) => { calls.push(call); return runTool(call, cat, memorySource); },
        log: () => {},
      });
      ms += Date.now() - t0;
      if (!r.ok) { fails.push(`  [${model}] "${c.q.slice(0, 70)}" -> AI failed: ${r.code}`); continue; }
      const verdict = c.check({ calls, text: r.reply });
      if (verdict === true) pass++;
      else fails.push(`  [${model}] "${c.q.slice(0, 70)}" -> ${verdict}`);
    }
    console.log(`${model.padEnd(26)} ${pass}/${CASES.length} correct, avg ${(ms / CASES.length / 1000).toFixed(1)}s per question`);
    fails.forEach((f) => console.log(f));
  }
}
main();
