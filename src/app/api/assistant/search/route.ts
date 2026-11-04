import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { handleError } from "@/lib/api";
import { parseIntent } from "@/lib/ai";
import { buildTaxonomy, searchCampaigns } from "@/lib/assistant-search";

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

    const taxonomy = await buildTaxonomy();
    const hist = history as { role: "user" | "assistant"; content: string }[];
    const { intent, usedAI } = await parseIntent(query, hist, taxonomy);
    const results = await searchCampaigns(user, intent);

    let reply = intent.reply;
    if (!reply) {
      reply = results.length
        ? `I found ${results.length} matching campaign${results.length > 1 ? "s" : ""}.`
        : "I could not find a matching campaign. Try naming the vertical and campaign type, for example 'auto insurance live transfer'.";
    } else if (results.length === 0 && intent.keywords.length === 0) {
      // Off-topic redirect from the model: keep its reply, no results.
    }

    return NextResponse.json({ reply, results, usedAI });
  } catch (e) {
    return handleError(e);
  }
}
