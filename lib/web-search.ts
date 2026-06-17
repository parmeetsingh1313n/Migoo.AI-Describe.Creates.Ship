/**
 * @module web-search
 * @description Advanced Deep-Crawl RAG System for AI Script Generation.
 *
 * Pipeline:
 *  1. Tavily Search → get top URLs + snippets (real-time web)
 *  2. Deep-Crawl → actually FETCH and extract full page text from top URLs
 *  3. Wikipedia Full-Extract → fetch full section text, not just summary
 *  4. Chunk + Summarize → use Groq to distill raw crawled content into a
 *     structured, verified "Fact Sheet" with specific dates, numbers, names
 *  5. Build ContextBlock → structured fact sheet injected into script prompt
 *
 * Graceful degradation: any step failing falls back gracefully.
 */

import { shortsLLM } from "@/lib/shorts-llm";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WebSource {
    title:       string;
    url:         string;
    snippet:     string;   // ~200 chars from search API
    fullText?:   string;   // full crawled page text (up to 8000 chars)
    source:      'tavily' | 'wikipedia';
}

export interface WebResearchResult {
    query:        string;
    sources:      WebSource[];
    factSheet:    string;    // structured bullet-point fact sheet distilled from full crawl
    contextBlock: string;    // formatted block for LLM prompt injection
    searchedAt:   string;
}

// ─── HTML Text Extractor ──────────────────────────────────────────────────────

/**
 * Strip HTML tags and extract clean text from a web page response.
 * Removes scripts, styles, nav, footer etc. for signal-only text.
 */
function extractTextFromHtml(html: string): string {
    try {
        // Remove script/style/nav/footer/header blocks entirely
        let text = html
            .replace(/<script[\s\S]*?<\/script>/gi, ' ')
            .replace(/<style[\s\S]*?<\/style>/gi, ' ')
            .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
            .replace(/<header[\s\S]*?<\/header>/gi, ' ')
            .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
            .replace(/<aside[\s\S]*?<\/aside>/gi, ' ')
            .replace(/<form[\s\S]*?<\/form>/gi, ' ')
            .replace(/<!--[\s\S]*?-->/g, ' ')
            // Convert block elements to newlines for structure
            .replace(/<\/?(p|h[1-6]|li|div|br|tr|td|th|blockquote|section|article)[^>]*>/gi, '\n')
            // Strip remaining tags
            .replace(/<[^>]+>/g, ' ')
            // Decode HTML entities
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;|&apos;/g, "'")
            .replace(/&nbsp;/g, ' ')
            .replace(/&[a-z]+;/gi, ' ')
            // Collapse whitespace
            .replace(/[ \t]+/g, ' ')
            .replace(/\n{3,}/g, '\n\n')
            .trim();

        // Remove very short lines (nav menus, breadcrumbs etc.)
        const lines = text.split('\n')
            .map(l => l.trim())
            .filter(l => l.length > 40); // only lines with real content

        return lines.join('\n').slice(0, 12000); // max 12k chars per page
    } catch {
        return '';
    }
}

// ─── Deep Page Crawler ────────────────────────────────────────────────────────

/**
 * Fetch a URL and extract its full readable text content.
 * Times out quickly to avoid blocking the pipeline.
 */
async function crawlPage(url: string): Promise<string> {
    // Skip URLs that are likely to be problematic
    const skipPatterns = [
        /youtube\.com/i,
        /twitter\.com|x\.com/i,
        /facebook\.com/i,
        /instagram\.com/i,
        /tiktok\.com/i,
        /reddit\.com/i,
        /\.pdf$/i,
        /\.jpg$|\.jpeg$|\.png$|\.gif$|\.webp$/i,
        /amazon\.com/i,
        /ebay\.com/i,
    ];
    if (skipPatterns.some(p => p.test(url))) {
        console.log(`⏭️ Skipping URL (pattern match): ${url.slice(0, 60)}`);
        return '';
    }

    try {
        console.log(`🕷️ Crawling: ${url.slice(0, 80)}`);
        const res = await fetch(url, {
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; ContentBot/1.0; +https://migoo.ai)',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
            },
            signal: AbortSignal.timeout(8000), // 8s timeout per page
        });

        if (!res.ok) {
            console.warn(`⚠️ Crawl failed ${res.status}: ${url.slice(0, 60)}`);
            return '';
        }

        const contentType = res.headers.get('content-type') || '';
        if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
            return '';
        }

        const html = await res.text();
        const extracted = extractTextFromHtml(html);
        console.log(`   ✅ Extracted ${extracted.length} chars from ${new URL(url).hostname}`);
        return extracted;
    } catch (err: any) {
        console.warn(`⚠️ Crawl error for ${url.slice(0, 60)}: ${err.message}`);
        return '';
    }
}

// ─── Tavily Search ────────────────────────────────────────────────────────────

async function searchTavily(query: string): Promise<WebSource[]> {
    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) {
        console.warn('⚠️ TAVILY_API_KEY not set, skipping Tavily search');
        return [];
    }

    try {
        const res = await fetch('https://api.tavily.com/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                api_key:             apiKey,
                query,
                search_depth:        'advanced',
                max_results:         10,          // more candidates to crawl
                include_answer:      true,
                include_raw_content: true,
            }),
        });

        if (!res.ok) {
            console.error(`❌ Tavily search failed: ${res.status} ${res.statusText}`);
            return [];
        }

        const data = await res.json();

        // Log Tavily's AI answer if available
        if (data.answer) {
            console.log(`💡 Tavily Answer: "${data.answer.slice(0, 150)}..."`);
        }

        const results: WebSource[] = (data.results || []).map((r: any) => ({
            title:   (r.title || 'Untitled').slice(0, 120),
            url:     r.url || '',
            snippet: (r.raw_content || r.content || '').slice(0, 3000), // raised to 3k for richer context
            source:  'tavily' as const,
        }));

        // Prepend Tavily AI answer as a synthetic source if available
        if (data.answer && data.answer.length > 50) {
            results.unshift({
                title:   `Tavily AI Answer for: ${query}`,
                url:     'https://tavily.com',
                snippet: data.answer,
                source:  'tavily',
            });
        }

        console.log(`🔍 Tavily: ${results.length} results for "${query.slice(0, 50)}"`);
        return results;
    } catch (err: any) {
        console.error('❌ Tavily search error:', err.message);
        return [];
    }
}

// ─── Wikipedia Full-Article Extractor ─────────────────────────────────────────

/**
 * Fetch a full Wikipedia article (not just the summary) using the parse API.
 * Returns much richer content: multiple sections, dates, names, facts.
 */
async function getWikipediaFullArticle(title: string): Promise<string> {
    try {
        // Use the Mediawiki parse API to get the full text
        const url = `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=false&explaintext=true&titles=${encodeURIComponent(title)}&format=json&origin=*&exsectionformat=plain`;
        const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
        if (!res.ok) return '';

        const data = await res.json();
        const pages = data?.query?.pages || {};
        const page = Object.values(pages)[0] as any;

        if (!page || !page.extract) return '';

        // Clean up Wikipedia-specific text
        const text = page.extract
            .replace(/\n{3,}/g, '\n\n')
            .trim();

        console.log(`   📖 Wikipedia full article for "${title}": ${text.length} chars`);
        return text.slice(0, 15000); // up to 15k chars for rich Wikipedia content
    } catch (err: any) {
        console.warn(`⚠️ Wikipedia full article error: ${err.message}`);
        return '';
    }
}

async function searchWikipedia(query: string): Promise<WebSource[]> {
    try {
        // Step 1: Primary search — find matching article titles
        const primaryUrl = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=5&format=json`;
        const primaryRes = await fetch(primaryUrl, { signal: AbortSignal.timeout(8000) });
        if (!primaryRes.ok) return [];

        const [, titles, , urls] = await primaryRes.json() as [string, string[], string[], string[]];
        if (!titles || titles.length === 0) return [];

        // Step 2: Also run a focused sub-query to catch related articles
        // e.g. "Amritsar historical facts" → also try "Golden Temple" or "Jallianwala Bagh"
        const words = query.split(/\s+/).filter(w => w.length > 4);
        const subQuery = words.slice(0, 3).join(' '); // first 3 meaningful words
        let subTitles: string[] = [];
        let subUrls:   string[] = [];
        if (subQuery && subQuery !== query) {
            try {
                const subUrl = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(subQuery)}&limit=3&format=json`;
                const subRes = await fetch(subUrl, { signal: AbortSignal.timeout(6000) });
                if (subRes.ok) {
                    const [, st, , su] = await subRes.json() as [string, string[], string[], string[]];
                    subTitles = st || [];
                    subUrls   = su || [];
                }
            } catch { /* ignore sub-query failures */ }
        }

        // Merge primary + sub-query, deduplicate by title
        const allTitles = [...titles, ...subTitles];
        const allUrls   = [...urls,   ...subUrls];
        const seen      = new Set<string>();
        const uniqueTitles: string[] = [];
        const uniqueUrls:   string[] = [];
        for (let i = 0; i < allTitles.length; i++) {
            const t = allTitles[i];
            if (!seen.has(t)) { seen.add(t); uniqueTitles.push(t); uniqueUrls.push(allUrls[i]); }
        }

        // Step 3: Fetch full article text for top 3 unique matches
        const sources: WebSource[] = [];
        for (let i = 0; i < Math.min(uniqueTitles.length, 3); i++) {
            try {
                const fullText = await getWikipediaFullArticle(uniqueTitles[i]);
                if (fullText && fullText.length > 200) {
                    sources.push({
                        title:    uniqueTitles[i],
                        url:      uniqueUrls[i] || `https://en.wikipedia.org/wiki/${encodeURIComponent(uniqueTitles[i])}`,
                        snippet:  fullText.slice(0, 2000), // larger snippet
                        fullText: fullText,
                        source:   'wikipedia',
                    });
                }
            } catch { /* skip failed article */ }
        }

        console.log(`📚 Wikipedia: ${sources.length} full articles (primary + sub-query) for "${query.slice(0, 50)}"`);
        return sources;
    } catch (err: any) {
        console.error('❌ Wikipedia search error:', err.message);
        return [];
    }
}

// ─── Deep Crawl Orchestrator ──────────────────────────────────────────────────

/**
 * Takes Tavily results, picks top crawlable URLs, fetches full page content.
 * Returns sources enriched with fullText.
 */
async function deepCrawlSources(sources: WebSource[]): Promise<WebSource[]> {
    // Filter to crawlable Tavily sources — Wikipedia already has fullText via API
    const crawlable = sources
        .filter(s => s.source === 'tavily' && s.url && !s.url.includes('tavily.com'))
        .slice(0, 6); // crawl up to 6 pages (raised from 4)

    if (crawlable.length === 0) return sources;

    console.log(`\n🕷️ Starting deep crawl of ${crawlable.length} pages...`);

    // Crawl all pages in parallel (Wikipedia sources already have fullText, skip them)
    const crawlResults = await Promise.allSettled(
        crawlable.map(async (source) => {
            const fullText = await crawlPage(source.url);
            return { url: source.url, fullText };
        })
    );

    // Merge crawled text back into sources
    const enriched = sources.map(source => {
        // Wikipedia already has fullText from the parse API — never overwrite it
        if (source.source === 'wikipedia' && source.fullText) return source;

        const crawlResult = crawlResults.find(
            r => r.status === 'fulfilled' && r.value.url === source.url
        );
        if (crawlResult && crawlResult.status === 'fulfilled' && crawlResult.value.fullText) {
            return { ...source, fullText: crawlResult.value.fullText };
        }
        return source;
    });

    const crawledCount = enriched.filter(s => s.fullText && s.fullText.length > 100).length;
    console.log(`✅ Deep crawl complete: ${crawledCount}/${sources.length} sources have full text`);
    return enriched;
}

// ─── AI Fact-Sheet Distiller ──────────────────────────────────────────────────

/**
 * Uses Groq to distill ALL crawled raw content into a structured, verified fact sheet.
 * This is the core of the advanced RAG — model reads raw web content and extracts
 * only the most valuable, specific, accurate facts.
 */
export async function distillFactSheet(query: string, sources: WebSource[]): Promise<string> {
    // Build raw content from all sources
    const sourcesWithContent = sources.filter(s => 
        (s.fullText && s.fullText.length > 100) || s.snippet.length > 100
    );

    if (sourcesWithContent.length === 0) {
        return '';
    }

    // Sort: Wikipedia sources first (most authoritative), then Tavily by content length
    const sorted = [
        ...sourcesWithContent.filter(s => s.source === 'wikipedia'),
        ...sourcesWithContent.filter(s => s.source !== 'wikipedia')
            .sort((a, b) => (b.fullText?.length || b.snippet.length) - (a.fullText?.length || a.snippet.length)),
    ];

    // Aggregate all content — raised to 6k per source, 28k total
    const allContent = sorted
        .map((s, i) => {
            const content = s.fullText || s.snippet;
            const label   = s.source === 'wikipedia' ? '⭐ WIKIPEDIA (authoritative)' : `Web Source`;
            return `\n--- SOURCE ${i + 1} [${label}]: ${s.title} ---\nURL: ${s.url}\n${content.slice(0, 6000)}`;
        })
        .join('\n\n')
        .slice(0, 28000);

    console.log(`\n🧠 Distilling fact sheet from ${sorted.length} sources (${allContent.length} chars)...`);

    const systemPrompt = `You are a research analyst, fact extractor, AND narrative architect. You will be given raw web content from multiple sources (Wikipedia marked ⭐ is most authoritative). Your job is to:
1. Extract specific, verifiable facts (real dates, names, numbers, measurements).
2. Identify a CENTRAL NARRATIVE THREAD — one overarching story that connects the facts.
3. Arrange facts so they build on each other logically (cause → effect, before → after, problem → solution).

Rules:
- WIKIPEDIA facts take priority over web sources when they conflict.
- Extract ONLY facts confirmed by at least one source (never hallucinate).
- If 2+ sources confirm a fact, mark it (confirmed ✓).
- Group facts into CHRONOLOGICAL or THEMATIC categories that flow naturally into each other.
- End with a "NARRATIVE THREAD" section: 3-5 sentences describing the story arc these facts tell.
- Do NOT include vague opinions. Every bullet must have a date, name, or number.

Output format:
CENTRAL NARRATIVE: [2-3 sentence story arc that ties all facts together]

CATEGORY: [Name — ordered chronologically or thematically]
• [Specific fact with date/name/number] (Source: source name)[confirmed ✓ if multi-source]

CATEGORY: [Next logical chapter]
• [...]`;

    const userPrompt = `Topic: "${query}"

Raw web content from ${sorted.length} sources (⭐ = Wikipedia, highest authority):
${allContent}

Extract 30-45 specific facts grouped into 5-7 chronological/thematic categories. Start with a CENTRAL NARRATIVE paragraph. Mark facts confirmed by multiple sources. Prioritise Wikipedia data. Focus on facts that are surprising, specific, and would flow naturally in a short documentary narration.`;

    try {
        const factSheet = await shortsLLM.text(systemPrompt, userPrompt, {
            temperature: 0.2, // very low — factual extraction, not creativity
            maxTokens: 4000, // raised to capture more facts
        });

        const factCount = factSheet.split('\n').filter(l => /^[•\-\*]/.test(l.trim())).length;
        console.log(`✅ Fact sheet distilled: ${factSheet.length} chars, ~${factCount} facts`);
        return factSheet.trim();
    } catch (err: any) {
        console.error('❌ Fact sheet distillation failed:', err.message);
        // Fallback: concatenate snippets directly
        return sourcesWithContent
            .map(s => `[${s.title}]\n${(s.fullText || s.snippet).slice(0, 500)}`)
            .join('\n\n');
    }
}

// ─── Main Export: Advanced Deep-Crawl Search ──────────────────────────────────

/**
 * Advanced RAG: Search → Deep Crawl → Wikipedia Full Extract → Fact Distillation
 *
 * @param query - Topic to research
 * @param options.deepCrawl - Whether to crawl full page content (default: true)
 * @returns WebResearchResult with distilled fact sheet and context block
 */
export async function searchWeb(query: string, options: { deepCrawl?: boolean; skipDistillation?: boolean } = {}): Promise<WebResearchResult> {
    const { deepCrawl = true, skipDistillation = false } = options;

    if (!query || query.trim().length < 3) {
        return { query, sources: [], factSheet: '', contextBlock: '', searchedAt: new Date().toISOString() };
    }

    console.log(`\n${'═'.repeat(70)}`);
    console.log(`🌐 ADVANCED RAG RESEARCH: "${query.slice(0, 60)}"`);
    console.log(`${'═'.repeat(70)}`);
    const startTime = Date.now();

    // ── Step 1: Run Tavily + Wikipedia in parallel ───────────────────────────
    const [tavilyResults, wikiResults] = await Promise.all([
        searchTavily(query),
        searchWikipedia(query),
    ]);

    // Combine: Tavily first (diverse, current), then Wikipedia (authoritative)
    let allSources = [...tavilyResults, ...wikiResults];

    // Deduplicate by domain
    const seen = new Set<string>();
    allSources = allSources.filter(s => {
        try {
            const domain = new URL(s.url).hostname;
            if (seen.has(domain)) return false;
            seen.add(domain);
            return true;
        } catch {
            return true;
        }
    });

    console.log(`📊 Total sources before crawl: ${allSources.length}`);

    // ── Step 2: Deep-Crawl top web pages ────────────────────────────────────
    let enrichedSources = allSources;
    if (deepCrawl) {
        enrichedSources = await deepCrawlSources(allSources);
    }

    // ── Step 3: Distill fact sheet using LLM ────────────────────────────────
    // skipDistillation:true → skip the ~50-60s LLM call; use raw snippets.
    // Use this for topic-discovery / angles generation where snippets suffice.
    let factSheet = '';
    if (skipDistillation) {
        console.log(`⏭️ Skipping fact distillation (skipDistillation:true) — using raw source snippets`);
    } else {
        factSheet = await distillFactSheet(query, enrichedSources);
    }

    // ── Step 4: Build context block for LLM prompt injection ────────────────
    let contextBlock = '';
    if (factSheet || enrichedSources.length > 0) {
        const fallbackSnippets = enrichedSources.length > 0 && !factSheet
            ? enrichedSources
                .slice(0, 6)
                .map((s, i) => `[${i + 1}] ${s.title} (${s.source})\n${(s.fullText || s.snippet).slice(0, 800)}`)
                .join('\n\n')
            : '';

        const wikiCount  = enrichedSources.filter(s => s.source === 'wikipedia').length;
        const webCount   = enrichedSources.filter(s => s.source === 'tavily').length;
        contextBlock = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📚 VERIFIED RESEARCH (Deep-Crawl RAG — ${wikiCount} Wikipedia + ${webCount} web sources)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Topic: ${query}
Authority Sources: ${enrichedSources.filter(s=>s.source==='wikipedia').map(s=>s.title).join(' | ')}
Web Sources: ${enrichedSources.filter(s=>s.source!=='wikipedia').map(s=>{ try{ return new URL(s.url).hostname; } catch{ return ''; }}).filter(Boolean).slice(0,5).join(', ')}

${factSheet || fallbackSnippets}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🚨 SCRIPT-WRITING RULES (MANDATORY):
1. Follow the CENTRAL NARRATIVE thread above — every scene must advance that story.
2. Use SPECIFIC facts (dates, names, numbers) from the research in EVERY scene.
3. Facts marked (confirmed ✓) are verified by multiple sources — use them FIRST.
4. Wikipedia data overrides your training knowledge when they conflict.
5. Each scene must END with a natural bridge to the NEXT scene topic.
6. Do NOT introduce any fact not present in this research block.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
    }

    const elapsed = Date.now() - startTime;
    const crawledPages = enrichedSources.filter(s => s.fullText && s.fullText.length > 100).length;
    console.log(`\n✅ RAG complete: ${enrichedSources.length} sources, ${crawledPages} pages crawled, fact sheet: ${factSheet.length} chars (${elapsed}ms)\n`);

    return {
        query,
        sources:      enrichedSources.slice(0, 10),
        factSheet,
        contextBlock,
        searchedAt:   new Date().toISOString(),
    };
}
