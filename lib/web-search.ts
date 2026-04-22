/**
 * @module web-search
 * @description Unified web search using Tavily + Wikipedia APIs.
 * Used to enrich AI script generation with real-time facts, history, and news.
 *
 * - Tavily: General web search (news, articles, facts)
 * - Wikipedia: Structured encyclopedic data (free, no key)
 *
 * Graceful degradation: if both APIs fail, returns empty result (never crashes).
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WebSource {
    title:   string
    url:     string
    snippet: string           // ~200 chars of relevant content
    source:  'tavily' | 'wikipedia'
}

export interface WebResearchResult {
    query:        string
    sources:      WebSource[]   // max 8 sources
    contextBlock: string        // formatted text block for LLM prompt injection
    searchedAt:   string        // ISO timestamp
}

// ─── Tavily Search ────────────────────────────────────────────────────────────

async function searchTavily(query: string): Promise<WebSource[]> {
    const apiKey = process.env.TAVILY_API_KEY
    if (!apiKey) {
        console.warn('⚠️ TAVILY_API_KEY not set, skipping Tavily search')
        return []
    }

    try {
        const res = await fetch('https://api.tavily.com/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                api_key:      apiKey,
                query,
                search_depth: 'basic',
                max_results:  5,
                include_answer: false,
                include_raw_content: false,
            }),
        })

        if (!res.ok) {
            console.error(`❌ Tavily search failed: ${res.status} ${res.statusText}`)
            return []
        }

        const data = await res.json()
        const results: WebSource[] = (data.results || []).map((r: any) => ({
            title:   (r.title || 'Untitled').slice(0, 120),
            url:     r.url || '',
            snippet: (r.content || '').slice(0, 300),
            source:  'tavily' as const,
        }))

        console.log(`🔍 Tavily: ${results.length} results for "${query.slice(0, 50)}"`)
        return results
    } catch (err: any) {
        console.error('❌ Tavily search error:', err.message)
        return []
    }
}

// ─── Wikipedia Search ─────────────────────────────────────────────────────────

async function searchWikipedia(query: string): Promise<WebSource[]> {
    try {
        // Step 1: Search for matching articles
        const searchUrl = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=3&format=json`
        const searchRes = await fetch(searchUrl)
        if (!searchRes.ok) return []

        const [, titles, , urls] = await searchRes.json() as [string, string[], string[], string[]]
        if (!titles || titles.length === 0) return []

        // Step 2: Get summaries for top matches
        const sources: WebSource[] = []
        for (let i = 0; i < Math.min(titles.length, 2); i++) {
            try {
                const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(titles[i])}`
                const summaryRes = await fetch(summaryUrl)
                if (!summaryRes.ok) continue

                const summary = await summaryRes.json()
                if (summary.extract) {
                    sources.push({
                        title:   summary.title || titles[i],
                        url:     urls[i] || summary.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(titles[i])}`,
                        snippet: summary.extract.slice(0, 400),
                        source:  'wikipedia',
                    })
                }
            } catch {
                // Skip failed individual article
            }
        }

        console.log(`📚 Wikipedia: ${sources.length} articles for "${query.slice(0, 50)}"`)
        return sources
    } catch (err: any) {
        console.error('❌ Wikipedia search error:', err.message)
        return []
    }
}

// ─── Combined Search ──────────────────────────────────────────────────────────

/**
 * Search both Tavily and Wikipedia for a topic. Returns combined results
 * with a pre-formatted context block ready for LLM prompt injection.
 *
 * @param query - The topic to search for
 * @returns WebResearchResult with sources and contextBlock
 */
export async function searchWeb(query: string): Promise<WebResearchResult> {
    if (!query || query.trim().length < 3) {
        return { query, sources: [], contextBlock: '', searchedAt: new Date().toISOString() }
    }

    console.log(`\n🌐 Web Research starting for: "${query.slice(0, 60)}"`)
    const startTime = Date.now()

    // Run both searches in parallel
    const [tavilyResults, wikiResults] = await Promise.all([
        searchTavily(query),
        searchWikipedia(query),
    ])

    // Combine: Tavily first (more diverse), then Wikipedia (authoritative)
    const allSources = [...tavilyResults, ...wikiResults].slice(0, 8)

    // Deduplicate by domain
    const seen = new Set<string>()
    const sources = allSources.filter(s => {
        try {
            const domain = new URL(s.url).hostname
            if (seen.has(domain)) return false
            seen.add(domain)
            return true
        } catch {
            return true
        }
    })

    // Build context block for LLM (max ~2000 chars)
    let contextBlock = ''
    if (sources.length > 0) {
        const snippets = sources
            .map((s, i) => `[${i + 1}] ${s.title}\n${s.snippet}`)
            .join('\n\n')
            .slice(0, 2000)

        contextBlock = `
WEB RESEARCH RESULTS (searched: ${new Date().toISOString()}):
The following are real, verified facts found from web research. Use these to make the script accurate and current.
---
${snippets}
---
IMPORTANT: Prefer these real facts over your training data when they conflict. Cite specific numbers, dates, and names from the research above.
`
    }

    const elapsed = Date.now() - startTime
    console.log(`✅ Web Research done: ${sources.length} sources in ${elapsed}ms\n`)

    return {
        query,
        sources,
        contextBlock,
        searchedAt: new Date().toISOString(),
    }
}
