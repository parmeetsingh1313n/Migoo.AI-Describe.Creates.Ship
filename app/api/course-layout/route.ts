/**
 * @module api/course-layout
 * @description Mutate a course's stored layout (coursesTable.courseLayout).
 *
 * PATCH /api/course-layout
 * Replaces a single chapter's `subContent` (the outline bullet points) inside
 * the course layout JSON. One point ≈ one generated slide, so this is what the
 * Outline Editor cockpit persists before generation runs.
 *
 * @requires Authentication via Clerk
 * @requires Course ownership (userId must match the caller's email)
 */

import { db } from "@/config/db";
import { coursesTable } from "@/config/schema";
import { apiError, apiSuccess, apiOptions } from "@/lib/api-helpers";
import { validateInput, updateCourseOutlineSchema } from "@/lib/validations";
import { currentUser } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";

export async function PATCH(req: NextRequest) {
    try {
        const user = await currentUser();

        // Auth guard
        const email = user?.primaryEmailAddress?.emailAddress;
        if (!email) {
            return apiError("Authentication required", 401, "UNAUTHORIZED");
        }

        // Parse + validate
        const body = await req.json();
        const validation = validateInput(updateCourseOutlineSchema, body);
        if (!validation.success) {
            return apiError("Invalid request input", 400, "VALIDATION_ERROR", validation.errors);
        }
        const { courseId, chapterId, subContent } = validation.data;

        // Load the course
        const [course] = await db
            .select()
            .from(coursesTable)
            .where(eq(coursesTable.courseId, courseId));

        if (!course) {
            return apiError("Course not found", 404, "NOT_FOUND");
        }

        // Ownership guard — only the owner may edit their outline
        if (course.userId !== email) {
            return apiError("You do not have access to this course", 403, "FORBIDDEN");
        }

        // Locate + replace the chapter's subContent inside the layout JSON
        const layout: any = course.courseLayout;
        const chapters: any[] = Array.isArray(layout?.chapters) ? layout.chapters : [];
        const chapterIdx = chapters.findIndex((c) => c?.chapterId === chapterId);

        if (chapterIdx === -1) {
            return apiError("Chapter not found in this course", 404, "NOT_FOUND");
        }

        // Trim empties defensively (schema already enforces 1–12 non-empty items)
        const cleaned = subContent.map((p) => p.trim()).filter(Boolean);
        if (cleaned.length === 0) {
            return apiError("A chapter needs at least one point", 400, "VALIDATION_ERROR");
        }

        const updatedChapters = chapters.map((c, i) =>
            i === chapterIdx ? { ...c, subContent: cleaned } : c
        );
        const updatedLayout = { ...layout, chapters: updatedChapters };

        await db
            .update(coursesTable)
            .set({ courseLayout: updatedLayout })
            .where(eq(coursesTable.courseId, courseId));

        return apiSuccess({
            courseId,
            chapterId,
            subContent: cleaned,
        });
    } catch (error: any) {
        console.error("course-layout PATCH error:", error?.message);
        return apiError("Failed to update course outline", 500, "UPDATE_ERROR", error?.message);
    }
}

/** Handle CORS preflight requests */
export async function OPTIONS() {
    return apiOptions();
}
