/**
 * @module api/approve-slides
 * @description Approve a chapter's reviewed slides + narration and kick off the
 * gated TTS/audio phase of the pipeline.
 *
 * POST /api/approve-slides  { chapter, courseId, courseName, chapterIndex }
 *
 * The slide visuals + narration were already generated (status `review:slides`)
 * and possibly edited by the user in the Studio cockpit. This fires
 * `course/audio.generate`, which synthesises narration audio from the final
 * (edited) slides and marks the chapter `completed`.
 *
 * @requires Authentication via Clerk
 * @requires Course ownership (userId must match the caller's email)
 */

import { db } from "@/config/db";
import { coursesTable } from "@/config/schema";
import { inngest } from "@/inngest/client";
import { apiError, apiSuccess, apiOptions } from "@/lib/api-helpers";
import { validateInput, approveSlidesSchema } from "@/lib/validations";
import { currentUser } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";

export async function POST(req: NextRequest) {
    const user = await currentUser();
    const email = user?.primaryEmailAddress?.emailAddress;
    if (!email) {
        return apiError("Authentication required", 401, "UNAUTHORIZED");
    }

    const body = await req.json();
    const validation = validateInput(approveSlidesSchema, body);
    if (!validation.success) {
        return apiError("Invalid request input", 400, "VALIDATION_ERROR", validation.errors);
    }
    const { chapter, courseId, courseName, chapterIndex } = validation.data;

    // Ownership guard — only the owner may advance their course
    const [course] = await db
        .select({ userId: coursesTable.userId })
        .from(coursesTable)
        .where(eq(coursesTable.courseId, courseId));
    if (!course) {
        return apiError("Course not found", 404, "NOT_FOUND");
    }
    if (course.userId !== email) {
        return apiError("You do not have access to this course", 403, "FORBIDDEN");
    }

    await inngest.send({
        name: "course/audio.generate",
        data: { chapter, courseId, courseName, chapterIndex },
    });

    console.log(`✅ Slides approved — queued audio (Phase 2): ${courseId} / chapter ${chapterIndex}`);
    return apiSuccess({ queued: true, courseId, chapterId: chapter.chapterId, chapterIndex }, 202);
}

export async function OPTIONS() {
    return apiOptions();
}
