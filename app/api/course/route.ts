/**
 * @module api/course
 * @description API route for fetching course data and associated slides.
 *
 * GET /api/course - Returns all courses for the authenticated user
 * GET /api/course?courseId=xxx - Returns a specific course with all its slides
 *
 * @requires Authentication via Clerk
 */

import { db, dbRetry } from "@/config/db";
import { chapterContentSlides, coursesTable } from "@/config/schema";
import { apiError, apiSuccess } from "@/lib/api-helpers";
import { validateInput, getCourseQuerySchema } from "@/lib/validations";
import { currentUser } from "@clerk/nextjs/server";
import { eq, desc } from "drizzle-orm";
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
            // Return all courses for the authenticated user
            const userCourses = await dbRetry(() =>
                db
                    .select()
                    .from(coursesTable)
                    .where(eq(coursesTable.userId, user?.primaryEmailAddress?.emailAddress ?? ""))
                    .orderBy(desc(coursesTable.id))
            );

            return apiSuccess(userCourses);
        }

        // Fetch specific course
        let course;
        try {
            course = await db
                .select()
                .from(coursesTable)
                .where(eq(coursesTable.courseId, courseId));
        } catch (dbError: any) {
            console.error("❌ DB error fetching course:", dbError.message);
            return apiError("Database error fetching course", 500, "DB_COURSE_ERROR", dbError.message);
        }

        if (!course || course.length === 0) {
            return apiError("Course not found", 404, "COURSE_NOT_FOUND");
        }

        // Get all slides for this course
        let slides = [];
        try {
            slides = await db
                .select()
                .from(chapterContentSlides)
                .where(eq(chapterContentSlides.courseId, courseId));
        } catch (dbError: any) {
            console.error("❌ DB error fetching slides:", dbError.message);
            // Return course without slides rather than failing entirely
            return apiSuccess({
                ...course[0],
                chapterContentSlides: []
            });
        }

        // Return combined data
        return apiSuccess({
            ...course[0],
            chapterContentSlides: slides
        });

    } catch (error: any) {
        console.error("❌ Course API Error:", error.message);
        console.error("❌ Full error stack:", error.stack);
        return apiError(
            "Failed to fetch course data",
            500,
            "INTERNAL_ERROR",
            error.message
        );
    }
}