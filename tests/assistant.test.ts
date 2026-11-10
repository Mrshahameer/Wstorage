// Offline tests for the assistant core. Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCatalog, catalogText, type Catalog } from "../src/lib/assistant/catalog";
import { resolveFolder, namesMentioned, typeWords, matchesTypeWords, foldersMentioned } from "../src/lib/assistant/match";
import { runTool, summarizeSections } from "../src/lib/assistant/tools";
import { planFallback } from "../src/lib/assistant/fallback";
import { runAgent, resetCooldowns, type AgentDeps, type CallLog } from "../src/lib/assistant/agent";
import { ProviderError, classify, type Session, type Turn } from "../src/lib/assistant/providers";
import { ROWS, memorySource } from "./fixtures/library";

const admin = () => buildCatalog(ROWS, null);
const ref = (c: Catalog, id: string) => c.byId.get(id)!.ref;
const itemsOf = (plan: ReturnType<typeof planFallback>) => {
  assert.equal(plan.kind, "tools");
  const call = plan.kind === "tools" ? plan.calls[0] : null;
  return (call!.args.items as { campaign: string; folder: string }[]);
};

// ---- Catalog -----------------------------------------------------------------

test("catalog: every campaign, real counts, nested folders counted in their top folder", () => {
  const c = admin();
  assert.equal(c.totals.campaigns, 10);
  assert.equal(c.totals.files, 21);
  assert.equal(c.totals.categories, 3);
  const a1 = c.byId.get("a1")!;
  assert.equal(a1.folders.find((f) => f.name === "Creatives")!.files, 3); // 2 + 1 in the subfolder
  assert.equal(a1.folders.length, 7); // the subfolder is not a top folder
  assert.equal(c.byRef.get("C1")!.name, "Bathroom Remodeling Live Transfer"); // sorted by category, vertical, name
  assert.deepEqual(c.categories, ["Home Services", "Insurance", "Web Leads"]);
});

test("catalog: non-admin sees only granted campaigns and granted folders", () => {
  const c = buildCatalog(ROWS, { campaignIds: ["a1"], folderIds: ["u1-vr"] });
  assert.deepEqual(c.campaigns.map((x) => x.id).sort(), ["a1", "u1"]);
  assert.equal(c.byId.get("a1")!.folders.length, 7);
  assert.deepEqual(c.byId.get("u1")!.folders.map((f) => f.name), ["Verification Recordings"]);
  assert.equal(c.byId.get("u2"), undefined);
});

test("catalog text lists refs, types and per-folder counts", () => {
  const t = catalogText(admin());
  assert.match(t, /C\d+ \| ACA \(Obamacare\) Pure Inbound \| Insurance > ACA \(Obamacare\) \| Pure Inbound \| 5 files: Creatives 3, Landing Pages 1, Verification Recordings 1/);
  assert.match(t, /Folder names in use: .*Landing Pages/);
});

// ---- Matching ----------------------------------------------------------------

test("folder phrases resolve to the real folder", () => {
  const f = admin().byId.get("a1")!.folders;
  const r = (w: string) => resolveFolder(f, w)?.name ?? null;
  assert.equal(r("lander"), "Landing Pages");
  assert.equal(r("Landing Page"), "Landing Pages");
  assert.equal(r("call recording"), "Verification Recordings");
  assert.equal(r("ads previews"), "Creatives");
  assert.equal(r("call scripts"), "Agent Scripts");
  assert.equal(r("TCPA"), "TCPA & Compliance");
  assert.equal(r("lead samples"), "Data Samples");
  assert.equal(r("email templates"), null);
});

test("folders mentioned keep their order and do not over-match", () => {
  const names = admin().folderNames;
  assert.deepEqual(foldersMentioned(names, "ACA landers, creatives and recordings"), ["Landing Pages", "Creatives", "Verification Recordings"]);
  assert.deepEqual(foldersMentioned(names, "call scripts for roofing"), ["Agent Scripts"]);
  assert.deepEqual(foldersMentioned(names, "what do we have in roofing"), []);
});

test("vertical names: full name wins, longest wins, unique word works", () => {
  const v = admin().verticals.map((x) => x.name);
  assert.deepEqual(namesMentioned(v, "call recording from auto insurance inbounds"), ["Auto Insurance"]);
  assert.deepEqual(namesMentioned(v, "auto insurance web leads landers"), ["Auto Insurance Web Leads"]);
  assert.deepEqual(namesMentioned(v, "ACA inbound landing page"), ["ACA (Obamacare)"]);
  assert.deepEqual(namesMentioned(v, "insurance stuff"), []);
});

test("campaign type words filter correctly", () => {
  const c = admin();
  const tw = typeWords(c.types, "ACA live transfer");
  assert.deepEqual(tw.sort(), ["live", "transfer"]);
  assert.equal(matchesTypeWords(c.byId.get("a2")!, tw), true);
  assert.equal(matchesTypeWords(c.byId.get("a3")!, tw), false);
  assert.deepEqual(typeWords(c.types, "auto insurance inbounds"), ["inbound"]);
});

// ---- Tools -------------------------------------------------------------------

test("get_assets returns one section per part with real files and totals", async () => {
  const c = admin();
  const out = await runTool({ name: "get_assets", args: { items: [
    { campaign: ref(c, "a1"), folder: "Landing Pages" },
    { campaign: ref(c, "u1"), folder: "call recording" },
    { campaign: ref(c, "a3"), folder: "Landing Pages" },
  ] } }, c, memorySource);
  assert.equal(out.sections.length, 3);
  const [s1, s2, s3] = out.sections;
  assert.ok(s1.kind === "files" && s1.label === "ACA (Obamacare) Pure Inbound · Landing Pages" && s1.total === 1);
  assert.ok(s1.kind === "files" && s1.files[0].liveUrl === "https://example.com/aca-inbound" && s1.files[0].tags.includes("tcpa-ok"));
  assert.ok(s2.kind === "files" && s2.label === "Auto Insurance Pure Inbound · Verification Recordings" && s2.total === 3);
  assert.ok(s3.kind === "files" && s3.total === 0 && /empty/.test(s3.note ?? ""));
});

test("get_assets: whole campaign includes subfolder files; bad refs and folders become notes", async () => {
  const c = admin();
  const whole = await runTool({ name: "get_assets", args: { items: [{ campaign: ref(c, "a1") }] } }, c, memorySource);
  assert.ok(whole.sections[0].kind === "files" && whole.sections[0].total === 5);
  const bad = await runTool({ name: "get_assets", args: { items: [{ campaign: "C999" }, { campaign: ref(c, "a1"), folder: "Email Templates" }] } }, c, memorySource);
  assert.deepEqual(bad.sections.map((s) => s.kind), ["note", "note"]);
});

test("get_assets cannot reach a campaign outside the user's access", async () => {
  const scoped = buildCatalog(ROWS, { campaignIds: ["a1"], folderIds: [] });
  const out = await runTool({ name: "get_assets", args: { items: [{ campaign: "Auto Insurance Live Transfer", folder: "Verification Recordings" }] } }, scoped, memorySource);
  assert.equal(out.sections[0].kind, "note");
});

test("find_missing lists campaigns with an empty or absent folder", async () => {
  const c = admin();
  const out = await runTool({ name: "find_missing", args: { folder: "recordings", vertical: "ACA" } }, c, memorySource);
  const s = out.sections[0];
  assert.ok(s.kind === "campaigns");
  assert.deepEqual(s.campaigns.map((x) => x.name).sort(), ["ACA (Obamacare) Live Transfer", "ACA (Obamacare) Warm Transfer"]);
  assert.match(s.label, /Missing Verification Recordings · 2 of 3 campaigns/);
});

test("search_files finds by name and only within visible folders", async () => {
  const out = await runTool({ name: "search_files", args: { text: "shower" } }, admin(), memorySource);
  const names = out.sections.flatMap((s) => (s.kind === "files" ? s.files.map((f) => f.name) : []));
  assert.ok(names.includes("BathroomRemodeling_LT_01_Shower_1x1.png") && names.includes("ACA_PureInbound_Shower_9x16.png"));
  const scoped = buildCatalog(ROWS, { campaignIds: ["a1"], folderIds: [] });
  const out2 = await runTool({ name: "search_files", args: { text: "shower" } }, scoped, memorySource);
  const names2 = out2.sections.flatMap((s) => (s.kind === "files" ? s.files.map((f) => f.name) : []));
  assert.deepEqual(names2, ["ACA_PureInbound_Shower_9x16.png"]);
});

test("summary reply names each part and says when one is empty", async () => {
  const c = admin();
  const out = await runTool({ name: "get_assets", args: { items: [{ campaign: ref(c, "a1"), folder: "Landing Pages" }, { campaign: ref(c, "a3"), folder: "Landing Pages" }] } }, c, memorySource);
  assert.match(summarizeSections(out.sections), /Pure Inbound · Landing Pages: 1 file\. ACA \(Obamacare\) Warm Transfer · Landing Pages: empty/);
});

// ---- Keyword fallback ----------------------------------------------------------

test("fallback: two assets from two campaigns in one message", () => {
  const c = admin();
  const items = itemsOf(planFallback(c, "give me Landing Page from ACA Inbound Campaign and Call recording from Auto insurance inbounds"));
  assert.deepEqual(items, [
    { campaign: ref(c, "a1"), folder: "Landing Pages" },
    { campaign: ref(c, "u1"), folder: "Verification Recordings" },
  ]);
});

test("fallback: several assets for one vertical carry the vertical forward", () => {
  const c = admin();
  const items = itemsOf(planFallback(c, "ACA landers, creatives and recordings"));
  const aca = new Set(["a1", "a2", "a3"].map((id) => ref(c, id)));
  assert.ok(items.every((i) => aca.has(i.campaign)));
  assert.deepEqual([...new Set(items.map((i) => i.folder))], ["Landing Pages", "Creatives", "Verification Recordings"]);
});

test("fallback: assets from different verticals stay separate", () => {
  const c = admin();
  const items = itemsOf(planFallback(c, "creatives from ACA and recordings from auto insurance"));
  const aca = new Set(["a1", "a2", "a3"].map((id) => ref(c, id)));
  const auto = new Set(["u1", "u2"].map((id) => ref(c, id)));
  assert.ok(items.filter((i) => i.folder === "Creatives").every((i) => aca.has(i.campaign)));
  assert.ok(items.filter((i) => i.folder === "Verification Recordings").every((i) => auto.has(i.campaign)));
  assert.equal(items.length, 5);
});

test("fallback: counts, lists, gaps and greetings", () => {
  const c = admin();
  const count = planFallback(c, "how many campaigns in ACA?");
  assert.ok(count.kind === "answer" && /3 campaigns/.test(count.reply));
  const list = planFallback(c, "name 2 campaigns");
  assert.ok(list.kind === "answer" && list.sections![0].kind === "campaigns" && list.sections![0].campaigns.length === 2);
  const gap = planFallback(c, "which campaigns are missing verification recordings");
  assert.ok(gap.kind === "tools" && gap.calls[0].name === "find_missing");
  const hi = planFallback(c, "hello");
  assert.ok(hi.kind === "answer" && /10 campaigns/.test(hi.reply));
  const vague = planFallback(c, "give me landing pages");
  assert.ok(vague.kind === "answer" && /Which vertical/.test(vague.reply));
});

// ---- Agent loop and failover --------------------------------------------------

function scripted(turns: (Turn | ProviderError)[]): () => Session {
  return () => {
    let i = 0;
    return {
      async send() { const t = turns[i++]; if (!t) throw new ProviderError("no more turns", "error"); if (t instanceof ProviderError) throw t; return t; },
      addResults() {},
    };
  };
}

function deps(over: Partial<AgentDeps> & { sessions: Record<string, () => Session> }): AgentDeps & { logs: CallLog[] } {
  const logs: CallLog[] = [];
  const keys = [{ id: "k1", key: "x" }, { id: "k2", key: "y" }];
  const cooled = new Set<string>();
  const c = admin();
  return {
    logs,
    order: ["gemini"],
    models: () => ["m1", "m2"],
    pickKey: async () => keys.find((k) => !cooled.has(k.id)) ?? null,
    markKeyUsed: async () => {},
    coolDownKey: async (id) => { cooled.add(id); },
    session: (_p, model, key) => over.sessions[`${key}|${model}`]?.() ?? over.sessions["*"]!(),
    runTool: (call) => runTool(call, c, memorySource),
    log: (e) => logs.push(e),
    ...over,
  };
}

test("agent: tool round then reply", async () => {
  resetCooldowns();
  const c = admin();
  const d = deps({ sessions: { "*": scripted([
    { text: null, calls: [{ name: "get_assets", args: { items: [{ campaign: ref(c, "a1"), folder: "Landing Pages" }] } }] },
    { text: "Here is the ACA inbound landing page.", calls: [] },
  ]) } });
  const r = await runAgent("sys", [], "ACA inbound lander", d);
  assert.ok(r.ok && r.steps === 2 && r.sections.length === 1 && r.model === "m1");
});

test("agent: quota on one model fails over to the next model", async () => {
  resetCooldowns();
  const d = deps({ sessions: {
    "x|m1": scripted([new ProviderError("GenerateRequestsPerDay exceeded", "quota", 429)]),
    "x|m2": scripted([{ text: "Hi.", calls: [] }]),
  } });
  const r = await runAgent("sys", [], "hello", d);
  assert.ok(r.ok && r.model === "m2");
  assert.deepEqual(d.logs.map((l) => l.status), ["quota", "ok"]);
});

test("agent: every key and model out of quota reports quota", async () => {
  resetCooldowns();
  const d = deps({ sessions: { "*": scripted([new ProviderError("per day", "quota", 429)]) } });
  const r = await runAgent("sys", [], "hello", d);
  assert.ok(!r.ok && r.code === "quota" && /quota/.test(r.reason));
});

test("agent: a rejected key moves to the next key", async () => {
  resetCooldowns();
  const d = deps({ sessions: {
    "x|m1": scripted([new ProviderError("API key not valid", "auth", 400)]),
    "y|m1": scripted([{ text: "Hi.", calls: [] }]),
  } });
  const r = await runAgent("sys", [], "hello", d);
  assert.ok(r.ok);
});

test("agent: no keys at all", async () => {
  resetCooldowns();
  const d = deps({ sessions: {}, pickKey: async () => null });
  const r = await runAgent("sys", [], "hello", d);
  assert.ok(!r.ok && r.code === "no_keys");
});

test("agent: if the reply step fails after tools ran, keep the real results", async () => {
  resetCooldowns();
  const c = admin();
  const d = deps({ sessions: { "*": scripted([
    { text: null, calls: [{ name: "get_assets", args: { items: [{ campaign: ref(c, "u1"), folder: "Verification Recordings" }] } }] },
    new ProviderError("overloaded", "overloaded", 503),
  ]) } });
  const r = await runAgent("sys", [], "auto recordings", d);
  assert.ok(r.ok && r.sections.length === 1 && /3 files/.test(r.reply));
});

test("provider errors are classified for the status line", () => {
  assert.equal(classify(429, '{"error":{"message":"Quota exceeded for quota metric GenerateRequestsPerDayPerProjectPerModel-FreeTier"}}').code, "quota");
  assert.equal(classify(429, '{"error":{"message":"Rate limit reached: requests per minute"}}').code, "rate_limited");
  assert.equal(classify(503, '{"error":{"message":"The model is overloaded"}}').code, "overloaded");
  assert.equal(classify(400, '{"error":{"message":"API key not valid. Please pass a valid API key."}}').code, "auth");
});

test("keyword-mode summary turns a gap list into a sentence", async () => {
  const out = await runTool({ name: "find_missing", args: { folder: "recordings", vertical: "ACA" } }, admin(), memorySource);
  assert.equal(summarizeSections(out.sections), "2 of 3 campaigns are missing Verification Recordings.");
});
