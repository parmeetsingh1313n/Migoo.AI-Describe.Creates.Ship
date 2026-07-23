/**
 * @module lib/slide-narration
 * @description Narration JSON now lives in Appwrite Storage instead of inline
 * in Postgres (Neon), eliminating the last large column driving Neon egress.
 *
 * Mirrors the slide-html seam exactly:
 *   - uploadSlideNarration(slideId, narration) → upload JSON, return Appwrite URL
 *   - resolveSlideNarration(row)               → dual-read: prefer narrationUrl, else inline narration
 *
 * DUAL-READ CONTRACT:
 *   1. new : { narration: null,  narrationUrl: "https://…" }  → read from Appwrite
 *   2. old : { narration: {...}, narrationUrl: null        }  → read inline (legacy)
 *   3. mid : { narration: {...}, narrationUrl: "https://…" }  → prefer narrationUrl
 *
 * Appwrite URLs are content-addressed (fresh ID.unique() per upload) so the
 * URL-keyed cache is always correct — no staleness possible.
 */
import { putWithRotation, fetchAppwriteFile } from "@/lib/blob";

export interface SlideNarrationSource {
    narration?: any | null;
    narrationUrl?: string | null;
}

// ── URL-keyed in-memory cache (same LRU pattern as slide-html) ────────────────
const NARRATION_CACHE_MAX = 500;
const narrationCache = new Map<string, any>();

function cacheGet(url: string): any | undefined {
    const hit = narrationCache.get(url);
    if (hit !== undefined) {
        narrationCache.delete(url);
        narrationCache.set(url, hit);
    }
    return hit;
}

function cacheSet(url: string, narration: any): void {
    if (narrationCache.has(url)) narrationCache.delete(url);
    narrationCache.set(url, narration);
    if (narrationCache.size > NARRATION_CACHE_MAX) {
        const oldest = narrationCache.keys().next().value;
        if (oldest !== undefined) narrationCache.delete(oldest);
    }
}

/**
 * Upload a slide's narration JSON to Appwrite Storage and return its view URL.
 * The URL is stored in chapter_content_slides.narrationUrl; narration is set null.
 */
export async function uploadSlideNarration(slideId: string, narration: any): Promise<string> {
    const safeId = String(slideId).replace(/[^a-zA-Z0-9._-]/g, "_");
    const json = JSON.stringify(narration);
    const { url } = await putWithRotation(`slides/${safeId}.narration.json`, json, {
        contentType: "application/json; charset=utf-8",
        access: "public",
        allowOverwrite: true,
    });
    return url;
}

/**
 * Resolve a slide's narration from whichever source is populated.
 * Prefers narrationUrl (Appwrite); falls back to inline narration (legacy rows).
 * Returns null if neither source yields anything.
 */
export async function resolveSlideNarration(row: SlideNarrationSource): Promise<any | null> {
    if (row.narrationUrl) {
        const cached = cacheGet(row.narrationUrl);
        if (cached !== undefined) return cached;
        try {
            const buf = await fetchAppwriteFile(row.narrationUrl);
            const narration = JSON.parse(buf.toString("utf-8"));
            cacheSet(row.narrationUrl, narration);
            return narration;
        } catch (err: any) {
            if (row.narration) {
                console.warn(
                    `⚠️ resolveSlideNarration: Appwrite fetch failed (${err?.message?.slice(0, 100)}), ` +
                    `falling back to inline narration.`
                );
                return row.narration;
            }
            throw err;
        }
    }
    return row.narration ?? null;
}

/**
 * Resolve many slide rows' narration concurrently, returning a new array where
 * each row's `narration` is populated and `narrationUrl` is cleared.
 */
export async function resolveSlidesNarration<T extends SlideNarrationSource>(
    rows: T[]
): Promise<Array<T & { narration: any | null; narrationUrl: null }>> {
    return Promise.all(
        rows.map(async (row) => ({
            ...row,
            narration: await resolveSlideNarration(row),
            narrationUrl: null as null,
        }))
    );
}
