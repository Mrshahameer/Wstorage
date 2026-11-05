import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { handleError } from "@/lib/api";
import { parseIntent, looksLikeQuestion } from "@/lib/ai";
import { buildTaxonomy, buildFacts, factsToString, deterministicAnswer, searchCampaigns } from "@/lib/assistant-search";

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

    // Answer mode (questions about the library) vs search mode (find a folder).
    // A clear count question always answers in chat, even if the model tagged it
    // as a search, so "how many / total …" never returns cards instead of a number.
    const countQ = /\b(how many|how much|number of|count of|total|do we have|are there)\b/i.test(query) || /^\s*total\b/i.test(query);
    // Greetings, meta, and "what is inside each folder" are conversation, not a search.
    const chatQ = /^(hi|hello|hey|yo|hola|sup|greetings|good (morning|afternoon|evening|day))\b/i.test(query.trim())
      || /\b(what can you do|who are you|what are you|help me|how do you work)\b/i.test(query)
      || /(inside|in each|each folder|what.*folder|folder.*have|contain|how.*organi[sz]ed)/i.test(query);
    const answerMode = intent.mode === "answer" || countQ || chatQ || (!usedAI && looksLikeQuestion(query));
    if (answerMode) {
      const reply = clean(intent.reply || deterministicAnswer(query, facts));
      return NextResponse.json({ reply, results: [], usedAI });
    }

    const results = await searchCampaigns(user, intent, query);
    const reply = clean(intent.reply || (results.length
      ? `I found ${results.length} matching campaign${results.length > 1 ? "s" : ""}.`
      : "I could not find a matching campaign. Try naming the vertical and campaign type, for example 'auto insurance live transfer'."));

    return NextResponse.json({ reply, results, usedAI });
  } catch (e) {
    return handleError(e);
  }
}
