import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { handleError } from "@/lib/api";

interface Named { id: string; name: string }

// Resolves a deep link for the Campaign Library. Given a campaignId (and an
// optional folderId), it returns the full chain with names so the library can
// open straight to that campaign's folders, or into one specific folder.
export async function GET(req: NextRequest) {
  try {
    await requireUser();
    const db = supabaseAdmin();
    const campaignId = req.nextUrl.searchParams.get("campaignId");
    const folderId = req.nextUrl.searchParams.get("folderId");
    if (!campaignId) return NextResponse.json({ error: "campaignId required" }, { status: 400 });

    const { data: camp } = await db
      .from("campaigns")
      .select("id,name,vertical_id")
      .eq("id", campaignId)
      .single();
    if (!camp) return NextResponse.json({ error: "not found" }, { status: 404 });

    const { data: vert } = await db
      .from("verticals")
      .select("id,name,category_id")
      .eq("id", camp.vertical_id)
      .single();
    const { data: cat } = vert
      ? await db.from("categories").select("id,name").eq("id", vert.category_id).single()
      : { data: null };

    // Walk the folder chain up to the root so nested folders open correctly.
    const stack: Named[] = [];
    if (folderId) {
      let cur: string | null = folderId;
      for (let i = 0; i < 10 && cur; i++) {
        const { data: f }: { data: { id: string; name: string; parent_id: string | null } | null } =
          await db.from("folders").select("id,name,parent_id").eq("id", cur).single();
        if (!f) break;
        stack.unshift({ id: f.id, name: f.name });
        cur = f.parent_id;
      }
    }

    return NextResponse.json({
      category: cat ? { id: cat.id, name: cat.name } : null,
      vertical: vert ? { id: vert.id, name: vert.name } : null,
      campaign: { id: camp.id, name: camp.name },
      stack,
    }, { headers: { "Cache-Control": "private, max-age=60, stale-while-revalidate=300" } });
  } catch (e) {
    return handleError(e);
  }
}
