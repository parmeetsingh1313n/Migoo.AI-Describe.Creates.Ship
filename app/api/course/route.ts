/**
 * @module api/course
 * @description API route for fetching course data and associated slides.
 *
 * GET /api/course - Returns all courses for the authenticated user
 * GET /api/course?courseId=xxx - Returns a specific course with all its slides
 *
 * Falls back to LEGACY_DATABASE_URL for read-only access to historical data
 * created before the primary database was migrated.
 *
 * @requires Authentication via Clerk
 */

import { db, dbLegacy, dbRetry } from "@/config/db";
import { chapterContentSlides, coursesTable } from "@/config/schema";
import { apiError, apiSuccess } from "@/lib/api-helpers";
import { resolveSlideHtml } from "@/lib/slide-html";
import { resolveSlideNarration } from "@/lib/slide-narration";
import { logEgress } from "@/lib/egress-log";
import { validateInput, getCourseQuerySchema } from "@/lib/validations";
import { currentUser } from "@clerk/nextjs/server";
import { eq, desc, asc } from "drizzle-orm";
import { NextRequest } from "next/server";

export async function GET(req: NextRequest) {
    try {
        const user = await currentUser();

        // Auth guard
        if (!user?.primaryEmailAddress?.emailAddress) {
            return apiError("Authentication required", 401, "UNAUTHORIZED");
        }

        const courseId = req.nextUrl.searchParams.get('courseId');

        // Validate query params
        const validation = validateInput(getCourseQuerySchema, { courseId: courseId || undefined });
        if (!validation.success) {
            return apiError("Invalid query parameters", 400, "VALIDATION_ERROR", validation.errors);
        }

        if (!courseId) {
            // ── List all courses ──────────────────────────────────────────────
            let userCourses = await dbRetry(() =>
                db
                    .select()
                    .from(coursesTable)
                    .where(eq(coursesTable.userId, user?.primaryEmailAddress?.emailAddress ?? ""))
                    .orderBy(desc(coursesTable.id))
            );

            // Fallback: if primary DB is empty, check legacy DB for historical courses
            if (userCourses.length === 0 && dbLegacy) {
                console.log('📦 Primary DB empty — checking legacy DB for courses...');
                try {
                    const legacyCourses = await dbLegacy
                        .select()
                        .from(coursesTable)
                        .where(eq(coursesTable.userId, user?.primaryEmailAddress?.emailAddress ?? ""))
                        .orderBy(desc(coursesTable.id));
                    if (legacyCourses.length > 0) {
                        console.log(`✅ Legacy DB: found ${legacyCourses.length} courses`);
                        userCourses = legacyCourses;
                    }
                } catch (legacyErr: any) {
                    console.warn('⚠️ Legacy DB fallback failed (list):', legacyErr.message?.substring(0, 120));
                }
            }

            return apiSuccess(userCourses);
        }

        // ── Fetch specific course ─────────────────────────────────────────────
        let course;
        try {
            course = await dbRetry(() =>
                db
                    .select()
                    .from(coursesTable)
                    .where(eq(coursesTable.courseId, courseId))
            );
        } catch (dbError: any) {
            console.error("❌ DB error fetching course:", dbError.message);
            return apiError("Database error fetching course", 500, "DB_COURSE_ERROR", dbError.message);
        }

        // Fallback: course not in primary — check legacy DB
        if ((!course || course.length === 0) && dbLegacy) {
            console.log(`📦 Course ${courseId} not in primary DB — checking legacy DB...`);
            try {
                const legacyCourse = await dbLegacy
                    .select()
                    .from(coursesTable)
                    .where(eq(coursesTable.courseId, courseId));
                if (legacyCourse && legacyCourse.length > 0) {
                    console.log(`✅ Legacy DB: course found — ${legacyCourse[0].courseName}`);
                    course = legacyCourse;
                }
            } catch (legacyErr: any) {
                console.warn('⚠️ Legacy DB fallback failed (course):', legacyErr.message?.substring(0, 120));
            }
        }

        if (!course || course.length === 0) {
            return apiError("Course not found", 404, "COURSE_NOT_FOUND");
        }

        // ── Fetch slides ──────────────────────────────────────────────────────
        let slides: any[] = [];
        try {
            slides = await dbRetry(() =>
                db
                    .select()
                    .from(chapterContentSlides)
                    .where(eq(chapterContentSlides.courseId, courseId))
                    .orderBy(asc(chapterContentSlides.chapterId), asc(chapterContentSlides.slideIndex))
            );
        } catch (dbError: any) {
            console.error("❌ DB error fetching slides:", dbError.message);
        }

        // Fallback: slides not in primary — check legacy DB.
        // The legacy DB predates the html_url column, so we must NOT select it
        // (a bare .select() would emit html_url and error). Select the real
        // columns explicitly; htmlUrl is absent there and defaults to undefined.
        if (slides.length === 0 && dbLegacy) {
            console.log(`📦 No slides in primary DB for ${courseId} — checking legacy DB...`);
            try {
                const legacySlides = await dbLegacy
                    .select({
                        id: chapterContentSlides.id,
                        courseId: chapterContentSlides.courseId,
                        chapterId: chapterContentSlides.chapterId,
                        slideId: chapterContentSlides.slideId,
                        slideIndex: chapterContentSlides.slideIndex,
                        audioUrl: chapterContentSlides.audioUrl,
                        imageUrl: chapterContentSlides.imageUrl,
                        narration: chapterContentSlides.narration,
                        captions: chapterContentSlides.captions,
                        html: chapterContentSlides.html,
                        revealData: chapterContentSlides.revealData,
                        audioDuration: chapterContentSlides.audioDuration,
                        createdAt: chapterContentSlides.createdAt,
                    })
                    .from(chapterContentSlides)
                    .where(eq(chapterContentSlides.courseId, courseId))
                    .orderBy(asc(chapterContentSlides.chapterId), asc(chapterContentSlides.slideIndex));
                if (legacySlides.length > 0) {
                    console.log(`✅ Legacy DB: found ${legacySlides.length} slides`);
                    slides = legacySlides;
                }
            } catch (legacyErr: any) {
                console.warn('⚠️ Legacy DB fallback failed (slides):', legacyErr.message?.substring(0, 120));
            }
        }

        // Resolve HTML + narration (Appwrite URL → content, else inline) so the
        // preview player receives inline `html` and `narration` exactly as before.
        // Concurrent per slide; leaves all other fields untouched.
        try {
            slides = await Promise.all(
                slides.map(async (s) => ({
                    ...s,
                    html: await resolveSlideHtml(s),
                    htmlUrl: undefined,
                    narration: await resolveSlideNarration(s),
                    narrationUrl: undefined,
                }))
            );
        } catch (resolveErr: any) {
            console.error('❌ Failed resolving slide content from Appwrite:', resolveErr?.message?.substring(0, 120));
        }

        return apiSuccess(logEgress("/api/course", {
            ...course[0],
            chapterContentSlides: slides
        }, { course: courseId, rows: slides.length }));

    } catch (error: any) {
        console.error("❌ Course API Error:", error.message);
        return apiError(
            "Failed to fetch course data",
            500,
            "INTERNAL_ERROR",
            error.message
        );
    }
}