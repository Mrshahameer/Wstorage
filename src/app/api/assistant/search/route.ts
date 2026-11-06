import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { handleError } from "@/lib/api";
import { parseIntent, looksLikeQuestion } from "@/lib/ai";
import { buildTaxonomy, buildFacts, factsToString, deterministicAnswer, searchCampaigns, analyzeMissing, answerData } from "@/lib/assistant-search";

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

    // Gap analysis: "what is missing / which campaigns lack recordings" runs a
    // real query over every campaign's folders instead of a canned reply.
    const gapQ = /\b(missing|without|lack(?:s|ing)?|incomplete|gaps?|don'?t have|do(?:es)? not have|dont have|not have|empty)\b/i.test(query);
    if (gapQ) {
      const report = await analyzeMissing(user, intent.asset_type, query);
      if (!report) {
        return NextResponse.json({ reply: "Which folder do you mean? For example recordings, agent scripts, creatives, data samples, landing pages, or compliance.", results: [], usedAI });
      }
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
    }

    // List / name / scope questions ("name 10 campaigns", "the folders",
    // "what do we have in insurance") answered from real data, AI up or not.
    const dataReply = answerData(query, facts);
    if (dataReply) {
      return NextResponse.json({ reply: dataReply, results: [], usedAI });
    }

    // Decide whether this turn shows result cards or is reply-only (an answer,
    // a greeting, or a clarifying question). The model picks the mode; a few
    // hard signals force reply-only so a clear question never returns cards.
    const countQ = /\b(how many|how much|number of|count of|total|do we have|are there)\b/i.test(query) || /^\s*total\b/i.test(query);
    const chatQ = /^(hi|hello|hey|yo|hola|sup|greetings|good (morning|afternoon|evening|day))\b/i.test(query.trim())
      || /\b(what can you do|who are you|what are you|help me|how do you work)\b/i.test(query)
      || /(inside|in each|each folder|what.*folder|folder.*have|contain|how.*organi[sz]ed)/i.test(query);
    const replyOnly = intent.mode === "answer" || intent.mode === "clarify" || countQ || chatQ || (!usedAI && looksLikeQuestion(query));
    if (replyOnly) {
      const reply = clean(intent.reply || deterministicAnswer(query, facts));
      return NextResponse.json({ reply, results: [], usedAI });
    }

    const results = await searchCampaigns(user, intent, query);
    // Do not let an optimistic model reply stand when nothing matched.
    const reply = results.length
      ? clean(intent.reply || `Here ${results.length === 1 ? "is 1 match" : `are ${results.length} matches`}.`)
      : "I did not find a match for that. Want to try a vertical and asset, like 'auto insurance live transfer scripts'?";

    return NextResponse.json({ reply, results, usedAI });
  } catch (e) {
    return handleError(e);
  }
}
