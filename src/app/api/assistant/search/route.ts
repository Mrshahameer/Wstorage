import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { handleError } from "@/lib/api";
import { parseIntent, looksLikeQuestion } from "@/lib/ai";
import {
  buildTaxonomy, buildFacts, factsToString, deterministicAnswer, searchCampaigns, analyzeMissing,
  answerData, listCampaigns, listFolders, listVerticals, listCategories, areaSummary, loadSearchContext,
  type AssistantResult,
} from "@/lib/assistant-search";
import type { SubRequest } from "@/lib/ai";

const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

/** "ACA (Obamacare) · Landing Pages": the area asked about, then the real folder found. */
function groupLabel(r: SubRequest, results: AssistantResult[]): string {
  const top = results[0];
  const pathParts = top ? top.path.split("›").map((p) => p.trim()) : [];
  const area = r.campaign || r.vertical || r.category || pathParts[1] || "";
  const asset = top && top.resourceType === "folder" && top.assetHint ? top.assetHint : r.asset_type ? titleCase(r.asset_type) : "";
  return [area, asset].filter(Boolean).join(" · ") || "Results";
}

const Schema = z.object({
  query: z.string().min(1).max(500),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(2000) }))
    .max(12)
    .optional()
    .default([]),
});

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const { query, history } = Schema.parse(await req.json());

    const hist = history as { role: "user" | "assistant"; content: string }[];
    const [taxonomy, facts] = await Promise.all([buildTaxonomy(), buildFacts(user)]);
    const { intent, usedAI } = await parseIntent(query, hist, taxonomy, factsToString(facts));

    // Strip markdown emphasis so the chat bubble reads clean.
    const clean = (s: string) => s.replace(/\*\*(.*?)\*\*/g, "$1").replace(/\*(.*?)\*/g, "$1").replace(/`/g, "").trim();
    const json = (reply: string, results: unknown[] = []) => NextResponse.json({ reply, results, usedAI });

    // Run a search and phrase the reply, shared by the model path and the fallback.
    // A multi-part ask ("ACA landers, creatives and recordings", or "ACA creatives
    // and auto insurance recordings") runs one real query per part, in parallel,
    // and returns one labeled group per part.
    const runSearch = async () => {
      const reqs: SubRequest[] = intent.requests.length ? intent.requests : [intent];
      const ctx = await loadSearchContext(user);

      if (reqs.length === 1) {
        const results = await searchCampaigns(user, reqs[0], query, ctx);
        const reply = results.length
          ? clean(intent.reply || `Here ${results.length === 1 ? "is 1 match" : `are ${results.length} matches`}.`)
          : "I did not find a match for that. Want to try a vertical and asset, like 'auto insurance live transfer scripts'?";
        return NextResponse.json({ reply, results, usedAI });
      }

      // With AI each part carries its own fields, so score it on those alone. Without
      // AI the parts share the message's context words, so keep the full query.
      const partQuery = (r: SubRequest) =>
        usedAI ? [r.campaign, r.vertical, r.category, r.asset_type, ...r.keywords].filter(Boolean).join(" ") : query;
      const all = await Promise.all(reqs.map((r) => searchCampaigns(user, r, partQuery(r), ctx)));

      const groups: { key: string; label: string; results: AssistantResult[] }[] = [];
      reqs.forEach((r, i) => {
        const results = all[i];
        const key = results.map((x) => x.id).join(",");
        // Two parts that resolve to the same folders (creatives + ads previews) show once.
        if (key && groups.some((g) => g.key === key)) return;
        groups.push({ key, label: groupLabel(r, results), results });
      });

      const found = groups.filter((g) => g.results.length);
      const missing = groups.filter((g) => !g.results.length).map((g) => g.label);
      if (!found.length) {
        return NextResponse.json({ reply: "I did not find a match for any of those. Try naming the vertical for each asset, like 'ACA creatives and auto insurance recordings'.", results: [], usedAI });
      }
      let reply = clean(intent.reply || `Here is what I found for ${found.length} of your ${groups.length} requests.`);
      if (missing.length) reply += ` Nothing matched for ${missing.join(", ")}.`;
      return NextResponse.json({
        reply,
        results: [],
        groups: groups.map(({ label, results }) => ({ label, results })),
        usedAI,
      });
    };

    // Build the "missing asset" answer (and cards) from a real query.
    const runMissing = async () => {
      const report = await analyzeMissing(user, intent.asset_type, query);
      if (!report) return json("Which folder do you mean? For example recordings, agent scripts, creatives, data samples, landing pages, or compliance.");
      let reply: string;
      if (report.total === 0) reply = "You do not have any campaigns to check.";
      else if (report.missing.length === 0) reply = `All ${report.total} campaigns have ${report.label}.`;
      else {
        const names = report.missing.map((m) => m.name);
        const shown = names.slice(0, 12).join(", ");
        const extra = names.length > 12 ? `, and ${names.length - 12} more` : "";
        reply = `${report.missing.length} of ${report.total} campaigns are missing ${report.label}: ${shown}${extra}.`;
      }
      const results = report.missing.slice(0, 8).map((m) => ({
        id: m.id, title: m.name, path: m.path, score: 0,
        link: `/library?campaignId=${m.id}`, assetHint: null,
        resourceType: "campaign" as const, note: `needs ${report.label}`,
      }));
      return NextResponse.json({ reply, results, usedAI });
    };

    // AI path: the model chose the action; the server runs the matching query.
    if (usedAI) {
      switch (intent.action) {
        case "search":
          return await runSearch();
        case "missing":
          return await runMissing();
        case "list_campaigns":
          return json(listCampaigns(facts, { vertical: intent.vertical, category: intent.category, limit: intent.limit }));
        case "list_folders":
          return json(listFolders(facts) ?? "No folders found.");
        case "list_verticals":
          return json(listVerticals(facts, intent.category) ?? "No verticals found.");
        case "list_categories":
          return json(listCategories(facts) ?? "No categories found.");
        case "area_summary": {
          const s = areaSummary(facts, { vertical: intent.vertical, category: intent.category });
          return json(s ?? clean(intent.reply || deterministicAnswer(query, facts)));
        }
        case "clarify":
        case "answer":
        default:
          return json(clean(intent.reply || deterministicAnswer(query, facts)));
      }
    }

    // AI is off: keyword fallback over the same real-data helpers.
    const gapQ = /\b(missing|without|lack(?:s|ing)?|incomplete|gaps?|don'?t have|do(?:es)? not have|dont have|not have|empty)\b/i.test(query);
    if (gapQ) return await runMissing();

    const dataReply = answerData(query, facts);
    if (dataReply) return json(dataReply);

    if (looksLikeQuestion(query)) return json(clean(intent.reply || deterministicAnswer(query, facts)));

    return await runSearch();
  } catch (e) {
    return handleError(e);
  }
}
