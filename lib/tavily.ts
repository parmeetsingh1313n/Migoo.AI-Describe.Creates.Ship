/**
 * Tavily RAG helper
 * ─────────────────
 * Per-slide research augmentation: given a slide topic, Tavily crawls the live
 * web and returns a compact, factual context block that we feed into the slide
 * generation prompt. This grounds the narration + on-screen facts in accurate,
 * up-to-date information instead of the model's stale/hallucinated knowledge.
 *
 * Design goals:
 *   - NON-FATAL: any failure (no key, timeout, HTTP error) returns "" so slide
 *     generation always proceeds — research is an enhancement, never a blocker.
 *   - BOUNDED: the returned context is capped (~7000 chars — enough for real
 *     facts/definitions/code/stats to ground a deep, multi-slide narration)
 *     so it never blows the model's context window.
 *   - CACHED: identical queries within a server session hit an in-memory cache,
 *     so re-running a chapter doesn't re-crawl the same topics.
 */

const TAVILY_ENDPOINT = "https://api.tavily.com/search";
const MAX_CONTEXT_CHARS = 7000;
const REQUEST_TIMEOUT_MS = 20000;

// In-memory cache (query → context). Lives for the server session only.
const researchCache = new Map<string, string>();

function collapse(text: string): string {
    return (text || "").replace(/\s+/g, " ").trim();
}

interface TavilyResult {
    title?: string;
    url?: string;
    content?: string;
    score?: number;
}

interface TavilyResponse {
    answer?: string;
    results?: TavilyResult[];
}

/**
 * Fetch a compact research context for a single slide topic.
 *
 * @param topic     The specific slide topic to research.
 * @param context   Optional broader context (course/chapter title) to sharpen the query.
 * @returns A bounded plain-text research block, or "" if research is unavailable.
 */
export async function fetchSlideResearch(topic: string, context?: string): Promise<string> {
    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey || !topic?.trim()) return "";

    const query = context ? `${collapse(topic)} — ${collapse(context)}` : collapse(topic);
    const cacheKey = query.toLowerCase();
    if (researchCache.has(cacheKey)) return researchCache.get(cacheKey)!;

    try {
        const res = await fetch(TAVILY_ENDPOINT, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                api_key: apiKey,
                query,
                search_depth: "advanced",
                max_results: 8,
                include_answer: true,
                include_raw_content: false,
            }),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });

        if (!res.ok) {
            console.warn(`⚠️ Tavily research failed (${res.status}) for "${topic.substring(0, 60)}" — continuing without it`);
            return "";
        }

        const data = (await res.json()) as TavilyResponse;

        // Build a compact context: the synthesized answer first, then the most
        // relevant source snippets (highest score first), each attributed.
        const parts: string[] = [];
        if (data.answer) parts.push(`SUMMARY: ${collapse(data.answer)}`);

        const results = (data.results || [])
            .filter(r => r.content)
            .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
            .slice(0, 7);

        results.forEach((r, i) => {
            const host = (() => { try { return new URL(r.url || "").hostname.replace(/^www\./, ""); } catch { return "source"; } })();
            parts.push(`[${i + 1}] (${host}) ${collapse(r.content || "").substring(0, 800)}`);
        });

        let ctx = parts.join("\n");
        if (ctx.length > MAX_CONTEXT_CHARS) ctx = ctx.substring(0, MAX_CONTEXT_CHARS) + "…";

        researchCache.set(cacheKey, ctx);
        if (ctx) console.log(`🔎 Tavily research for "${topic.substring(0, 50)}": ${ctx.length} chars, ${results.length} sources`);
        return ctx;
    } catch (err: any) {
        console.warn(`⚠️ Tavily research error for "${topic.substring(0, 60)}": ${err?.message?.substring(0, 120)} — continuing without it`);
        return "";
    }
}
