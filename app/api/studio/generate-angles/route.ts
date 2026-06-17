import { shortsLLM } from "@/lib/shorts-llm";
import { searchWeb } from "@/lib/web-search";
import { NextRequest, NextResponse } from "next/server";

// Each call to this route can take up to 5 minutes (RAG + LLM).
export const maxDuration = 300;

export async function POST(req: NextRequest) {
    try {
        const { niche, seriesTitle } = await req.json();

        const topic = seriesTitle || niche || "general content";

        // ── RAG: Fast web search (no deep crawl) to discover real, trending subtopics ──
        let webContext = "";
        try {
            console.log(`🌐 [generate-angles] RAG search for topic ideas: "${topic}"`);
            const research = await searchWeb(
                `${topic} unique lesser known facts mysteries hidden history secrets`,
                { deepCrawl: false, skipDistillation: true }   // fast snippets only — no 60s LLM distillation
            );
            webContext = research.contextBlock || "";
            console.log(`✅ [generate-angles] RAG done — ${research.sources.length} sources`);
        } catch (err: any) {
            console.warn(`⚠️ [generate-angles] RAG search failed, proceeding without context: ${err.message}`);
        }

        const systemPrompt = `You are an expert viral YouTube Shorts title creator. Given a channel niche and a specific Series Title, generate 8 highly compelling, click-worthy, and unique video titles explicitly tailored to the Series Title.

RULES:
1. EVERY title MUST be specifically about "${topic}" — not generic world history, not other topics.
2. Use the REAL-TIME WEB RESEARCH block below to discover NEW, SPECIFIC, and LESSER-KNOWN angles.
3. Each title must target a DIFFERENT specific angle — no repetitive themes.
4. Titles should feel like real top-performing YouTube Shorts titles: shocking, specific, and curiosity-driven.
5. Do NOT include emojis or bullet points in the titles themselves.
6. Output ONLY a valid JSON object. No markdown, no extra text. Start with { and end with }.

JSON SCHEMA:
{
  "titles": [
    "Title 1",
    "Title 2",
    "Title 3",
    "Title 4",
    "Title 5",
    "Title 6",
    "Title 7",
    "Title 8"
  ]
}`;

        const userPrompt = `Series Niche: "${niche || "general content"}"
Specific Series Title: "${topic}"

${webContext ? `REAL-TIME WEB RESEARCH (use these to discover fresh, specific angles):\n${webContext}` : ""}

Generate 8 unique, viral, click-worthy video titles perfectly scoped to "${topic}".
Each must focus on a DIFFERENT lesser-known, surprising, or controversial sub-angle of this topic.
Output ONLY valid JSON.`;

        const result = await shortsLLM.json(systemPrompt, userPrompt, {
            temperature: 0.85,
            maxTokens: 1024,
        });

        const titles: string[] = Array.isArray(result?.titles) ? result.titles : [];

        if (titles.length === 0) {
            throw new Error("Invalid format returned by AI — no titles array");
        }

        return NextResponse.json({ angles: titles.slice(0, 8) });
    } catch (err: any) {
        console.error("studio/generate-angles error:", err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
