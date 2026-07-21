/**
 * GET /api/chapter-status?courseId=xxx
 * Returns the generation status for every chapter in a course.
 * Used by CourseChapters.tsx to poll live progress.
 *
 * Falls back to LEGACY_DATABASE_URL when the primary DB has no records
 * for the given courseId (historical data migration scenario).
 */
import { db, dbLegacy } from "@/config/db";
import { chapterGenerationStatus, chapterContentSlides } from "@/config/schema";
import { apiError, apiSuccess, apiOptions } from "@/lib/api-helpers";
import { currentUser } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import fs from 'fs';
import path from 'path';

export async function GET(req: NextRequest) {
    const user = await currentUser();
    if (!user?.primaryEmailAddress?.emailAddress) {
        return apiError("Authentication required", 401, "UNAUTHORIZED");
    }

    const courseId = req.nextUrl.searchParams.get("courseId");
    if (!courseId) {
        return apiError("courseId is required", 400, "MISSING_PARAM");
    }

    try {
        let statuses = await db
            .select()
            .from(chapterGenerationStatus)
            .where(eq(chapterGenerationStatus.courseId, courseId));

        let actualSlides = await db
            .select({ chapterId: chapterContentSlides.chapterId })
            .from(chapterContentSlides)
            .where(eq(chapterContentSlides.courseId, courseId));

        // ── Legacy DB fallback ────────────────────────────────────────────────
        // If the primary DB has no status rows for this course (it lived in the
        // old Neon project), transparently read from the legacy database instead.
        if (statuses.length === 0 && dbLegacy) {
            console.log(`📦 No chapter status in primary DB for ${courseId} — checking legacy DB...`);
            try {
                const legacyStatuses = await dbLegacy
                    .select()
                    .from(chapterGenerationStatus)
                    .where(eq(chapterGenerationStatus.courseId, courseId));
                if (legacyStatuses.length > 0) {
                    console.log(`✅ Legacy DB: found ${legacyStatuses.length} chapter statuses`);
                    statuses = legacyStatuses;
                }
            } catch (legacyErr: any) {
                console.warn('⚠️ Legacy DB fallback failed (statuses):', legacyErr.message?.substring(0, 120));
            }
        }

        if (actualSlides.length === 0 && dbLegacy) {
            console.log(`📦 No slides in primary DB for ${courseId} — checking legacy DB...`);
            try {
                const legacySlides = await dbLegacy
                    .select({ chapterId: chapterContentSlides.chapterId })
                    .from(chapterContentSlides)
                    .where(eq(chapterContentSlides.courseId, courseId));
                if (legacySlides.length > 0) {
                    console.log(`✅ Legacy DB: found ${legacySlides.length} slides`);
                    actualSlides = legacySlides;
                }
            } catch (legacyErr: any) {
                console.warn('⚠️ Legacy DB fallback failed (slides):', legacyErr.message?.substring(0, 120));
            }
        }

        // Check for any mismatches (e.g. if the user deleted slides from the DB to restart)
        for (const row of statuses) {
            const chSlides = actualSlides.filter(s => s.chapterId === row.chapterId);
            const actualCount = chSlides.length;

            if (
                row.status !== "idle" &&
                row.status !== "queued" &&
                actualCount < row.slidesComplete
            ) {
                console.log(`⚠️ Mismatch detected for chapter ${row.chapterId}: status is ${row.status} (complete: ${row.slidesComplete}) but DB has ${actualCount} slides. Resetting to idle.`);

                // Only update if the row lives in the primary DB (don't write to legacy)
                try {
                    await db
                        .update(chapterGenerationStatus)
                        .set({
                            status: "idle",
                            slidesComplete: 0,
                            audioComplete: 0,
                            errorMessage: null,
                            updatedAt: new Date(),
                        })
                        .where(eq(chapterGenerationStatus.chapterId, row.chapterId));
                } catch { /* ignore — row may be from legacy DB (read-only) */ }

                row.status = "idle";
                row.slidesComplete = 0;
                row.audioComplete = 0;
            }

            // Sync local dev render presence dynamically
            if (row.renderStatus !== 'video:completed' || !row.videoUrl) {
                const localOutputPath = path.join(process.cwd(), 'public', 'renders', `chapter-${row.chapterId}.mp4`);
                if (fs.existsSync(localOutputPath)) {
                    row.renderStatus = 'video:completed';
                    row.videoUrl = `/renders/chapter-${row.chapterId}.mp4`;
                }
            }

            // Check for stale render status
            if (row.renderStatus === 'rendering:video') {
                const STALE_MS = 60 * 60 * 1000; // 60 minutes
                const lastUpdate = row.updatedAt ? new Date(row.updatedAt).getTime() : 0;
                const isStale = Date.now() - lastUpdate > STALE_MS;

                if (isStale) {
                    console.log(`⏰ Stale render detected in status API for chapter ${row.chapterId} (last update: ${row.updatedAt ?? 'never'}). Auto-resetting to idle.`);
                    try {
                        await db
                            .update(chapterGenerationStatus)
                            .set({
                                renderStatus: 'idle',
                                renderProgress: 0,
                                renderError: null,
                                updatedAt: new Date(),
                            })
                            .where(eq(chapterGenerationStatus.chapterId, row.chapterId));
                    } catch { /* ignore — row may be from legacy DB (read-only) */ }

                    row.renderStatus = 'idle';
                    row.renderProgress = 0;
                }
            }

            // Check for a stale SLIDE/AUDIO generation phase. A slides job that
            // dies mid-run (Vercel timeout, interrupted deploy) leaves the chapter
            // stuck in generating:slides forever, so the UI keeps showing a phantom
            // "Designing slides 0/N" the user never started. If the row hasn't
            // updated in 15 min, auto-reset to idle so the card returns to normal.
            if (['generating:slides', 'generating:audio', 'queued'].includes(row.status ?? '')) {
                const GEN_STALE_MS = 15 * 60 * 1000; // 15 minutes
                const lastUpdate = row.updatedAt ? new Date(row.updatedAt).getTime() : 0;
                const isStale = Date.now() - lastUpdate > GEN_STALE_MS;

                if (isStale) {
                    console.log(`⏰ Stale slide/audio generation for chapter ${row.chapterId} (status="${row.status}", last update: ${row.updatedAt ?? 'never'}). Auto-resetting to idle.`);
                    try {
                        await db
                            .update(chapterGenerationStatus)
                            .set({ status: 'idle', errorMessage: null, updatedAt: new Date() })
                            .where(eq(chapterGenerationStatus.chapterId, row.chapterId));
                    } catch { /* ignore — legacy DB is read-only */ }

                    row.status = 'idle';
                }
            }
        }

        return apiSuccess({ statuses });

    } catch (error: any) {
        console.error("❌ chapter-status error:", error.message);
        return apiError("Failed to fetch chapter status", 500, "INTERNAL_ERROR", error.message);
    }
}

export async function OPTIONS() {
    return apiOptions();
}
