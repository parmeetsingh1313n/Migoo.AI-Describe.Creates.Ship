/**
 * @module lib/slide-html
 * @description Slide HTML now lives in Appwrite Storage instead of inline in
 * Postgres (Neon), which was the last large column driving Neon data-transfer
 * cost. These helpers are the single seam for that move:
 *
 *   - uploadSlideHtml(slideId, html)  → upload markup, return its Appwrite URL
 *   - resolveSlideHtml(row)           → dual-read: prefer htmlUrl, else inline html
 *
 * DUAL-READ CONTRACT (why old slides never break):
 *   A slide row may be in one of three states —
 *     1. new  : { html: null,        htmlUrl: "https://…" }  → read from Appwrite
 *     2. old  : { html: "<section…", htmlUrl: null        }  → read inline (legacy)
 *     3. mid  : { html: "<section…", htmlUrl: "https://…" }  → prefer htmlUrl
 *   resolveSlideHtml handles all three, so a partial backfill or a legacy-DB
 *   row is always readable.
 *
 * Appwrite is itself bandwidth-quota-limited (fetchAppwriteFile can 402), so
 * this SHIFTS egress off Neon rather than making it free. Combined with the
 * Phase-1 polling fix, it spreads the load across two quotas.
 */
import { putWithRotation, fetchAppwriteFile } from "@/lib/blob";

/** Minimal shape resolveSlideHtml needs — any slide row satisfies it. */
export interface SlideHtmlSource {
    html?: string | null;
    htmlUrl?: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// htmlUrl → markup cache.
//
// Appwrite file URLs are CONTENT-ADDRESSED: every uploadSlideHtml() call creates
// a brand-new file with a fresh ID.unique(), so a given URL's bytes never change.
// That makes caching by URL always-correct (no staleness possible) — and it's the
// key lever for cutting Appwrite egress: a course page reloaded 10× fetches each
// slide's HTML from Appwrite ONCE, not 10×. Bounded to avoid unbounded memory.
// ─────────────────────────────────────────────────────────────────────────────
const HTML_CACHE_MAX = 500;
const htmlCache = new Map<string, string>();

function cacheGet(url: string): string | undefined {
    const hit = htmlCache.get(url);
    if (hit !== undefined) {
        // LRU touch: re-insert to mark as most-recently used.
        htmlCache.delete(url);
        htmlCache.set(url, hit);
    }
    return hit;
}

function cacheSet(url: string, html: string): void {
    if (htmlCache.has(url)) htmlCache.delete(url);
    htmlCache.set(url, html);
    if (htmlCache.size > HTML_CACHE_MAX) {
        // Evict oldest (first inserted).
        const oldest = htmlCache.keys().next().value;
        if (oldest !== undefined) htmlCache.delete(oldest);
    }
}

/**
 * Upload a slide's HTML markup to Appwrite Storage and return its view URL.
 * The URL is what gets stored in chapter_content_slides.htmlUrl.
 *
 * @param slideId  Used only to build a human-readable object path.
 * @param html     The slide markup.
 * @returns        A `.../files/<id>/view?project=<p>` URL.
 */
export async function uploadSlideHtml(slideId: string, html: string): Promise<string> {
    const safeId = String(slideId).replace(/[^a-zA-Z0-9._-]/g, "_");
    const { url } = await putWithRotation(`slides/${safeId}.html`, html, {
        contentType: "text/html; charset=utf-8",
        access: "public",
        allowOverwrite: true,
    });
    return url;
}

/**
 * Resolve a slide's HTML from whichever source is populated.
 *
 * Prefers `htmlUrl` (Appwrite) and falls back to inline `html` (legacy rows).
 * If an Appwrite fetch fails but inline html is ALSO present (the mid-migration
 * state), we fall back to inline rather than throwing — belt-and-suspenders so
 * an Appwrite blip can't break a render that had the markup available anyway.
 *
 * @returns The HTML string, or null if neither source yields anything.
 */
export async function resolveSlideHtml(row: SlideHtmlSource): Promise<string | null> {
    if (row.htmlUrl) {
        // Content-addressed URL → cache is always fresh. Serve without a network
        // round-trip when we've fetched this exact file before.
        const cached = cacheGet(row.htmlUrl);
        if (cached !== undefined) return cached;
        try {
            const buf = await fetchAppwriteFile(row.htmlUrl);
            const html = buf.toString("utf-8");
            cacheSet(row.htmlUrl, html);
            return html;
        } catch (err: any) {
            if (row.html) {
                console.warn(
                    `⚠️ resolveSlideHtml: Appwrite fetch failed (${err?.message?.slice(0, 100)}), ` +
                    `falling back to inline html.`
                );
                return row.html;
            }
            throw err;
        }
    }
    return row.html ?? null;
}

/**
 * Resolve many slide rows' HTML concurrently, returning a NEW array where each
 * row's `html` is populated with the resolved markup and `htmlUrl` is cleared.
 * Convenience for read sites (render fetchData) that want inline html to hand
 * to a downstream consumer unchanged.
 */
export async function resolveSlidesHtml<T extends SlideHtmlSource>(
    rows: T[]
): Promise<Array<T & { html: string | null; htmlUrl: null }>> {
    return Promise.all(
        rows.map(async (row) => ({
            ...row,
            html: await resolveSlideHtml(row),
            htmlUrl: null as null,
        }))
    );
}
