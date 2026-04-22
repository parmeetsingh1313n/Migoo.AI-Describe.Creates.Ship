/**
 * Content Cache Utility — Vercel Blob-based LLM Content Caching
 * 
 * Stores LLM-generated slide content in Vercel Blob so that re-runs
 * of the pipeline (e.g. after Sarvam STT/TTS or Blob errors) can
 * reuse the cached content instead of calling the LLM again.
 * 
 * Works both locally (dev) and when deployed to Vercel.
 */

import { putWithRotation } from "@/lib/blob";
import { del, list } from "@vercel/blob";

// ═══════════════════════════════════════════════════════════════════════════════
// CACHE KEY HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function getCachePath(courseId: string, chapterId: string): string {
    return `content-cache/${courseId}/${chapterId}/slides.json`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SAVE — Persist LLM-generated slides to Vercel Blob
// ═══════════════════════════════════════════════════════════════════════════════

export async function saveSlidesContent(
    courseId: string,
    chapterId: string,
    slidesData: any[]
): Promise<string | null> {
    try {
        const cachePath = getCachePath(courseId, chapterId);
        const jsonContent = JSON.stringify(slidesData, null, 2);
        const buffer = Buffer.from(jsonContent, 'utf-8');

        console.log(`💾 Saving slides content to cache: ${cachePath}`);
        console.log(`📦 Cache size: ${buffer.length} bytes (${slidesData.length} slides)`);

        const { url } = await putWithRotation(cachePath, buffer, {
            access: 'public',
            contentType: 'application/json',
            allowOverwrite: true,
        });

        console.log(`✅ Content cached at: ${url}`);
        return url;
    } catch (error: any) {
        console.error(`❌ Failed to cache content: ${error.message}`);
        // Non-fatal — pipeline continues without caching
        return null;
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// LOAD — Retrieve cached slides from Vercel Blob
// ═══════════════════════════════════════════════════════════════════════════════

export async function loadSlidesContent(
    courseId: string,
    chapterId: string
): Promise<any[] | null> {
    try {
        const cachePath = getCachePath(courseId, chapterId);
        console.log(`🔍 Looking for cached content: ${cachePath}`);

        // List blobs matching this prefix
        const { blobs } = await list({ prefix: cachePath, limit: 1 });

        if (blobs.length === 0) {
            console.log(`📭 No cached content found for ${cachePath}`);
            return null;
        }

        const blobUrl = blobs[0].url;
        console.log(`📦 Found cached content: ${blobUrl}`);

        // Fetch the cached JSON
        const response = await fetch(blobUrl);
        if (!response.ok) {
            console.warn(`⚠️ Failed to fetch cached content: ${response.status}`);
            return null;
        }

        const slidesData = await response.json();

        if (!Array.isArray(slidesData) || slidesData.length === 0) {
            console.warn(`⚠️ Cached content is empty or invalid`);
            return null;
        }

        console.log(`✅ Loaded ${slidesData.length} slides from cache`);
        return slidesData;
    } catch (error: any) {
        console.error(`❌ Failed to load cached content: ${error.message}`);
        // Non-fatal — just return null so pipeline regenerates
        return null;
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// DELETE — Remove cached content from Vercel Blob
// ═══════════════════════════════════════════════════════════════════════════════

export async function deleteSlidesContent(
    courseId: string,
    chapterId: string
): Promise<boolean> {
    try {
        const cachePath = getCachePath(courseId, chapterId);
        console.log(`🗑️ Deleting cached content: ${cachePath}`);

        // Find existing blobs with this prefix
        const { blobs } = await list({ prefix: cachePath, limit: 10 });

        if (blobs.length === 0) {
            console.log(`📭 No cached content to delete for ${cachePath}`);
            return true;
        }

        // Delete all matching blobs
        for (const blob of blobs) {
            await del(blob.url);
            console.log(`🗑️ Deleted: ${blob.url}`);
        }

        console.log(`✅ Cached content deleted (${blobs.length} blob(s))`);
        return true;
    } catch (error: any) {
        console.error(`❌ Failed to delete cached content: ${error.message}`);
        // Non-fatal — continue anyway
        return false;
    }
}
