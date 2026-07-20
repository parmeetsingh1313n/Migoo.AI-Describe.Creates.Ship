/**
 * TEST ENDPOINT: Trigger parallel slide generation for a specific chapter.
 * POST /api/test-parallel-slides
 * Body: { chapter, courseId, courseName, chapterIndex }
 *   — same payload shape as /api/generate-video-content, but routes to the
 *     experimental parallel generator instead of the serial one.
 *
 * Temporary A/B-test endpoint. Remove once parallel generation is validated.
 */

import { inngest } from "@/inngest/client";
import { apiError, apiSuccess, apiOptions } from "@/lib/api-helpers";
import { currentUser } from "@clerk/nextjs/server";
import { NextRequest } from "next/server";

export async function POST(req: NextRequest) {
    const user = await currentUser();
    if (!user?.primaryEmailAddress?.emailAddress) {
        return apiError("Authentication required", 401, "UNAUTHORIZED");
    }

    const body = await req.json();
    const { chapter, courseId, courseName, chapterIndex } = body ?? {};

    if (!chapter || !courseId || typeof chapterIndex !== "number") {
        return apiError(
            "chapter, courseId, and chapterIndex are required",
            400,
            "VALIDATION_ERROR"
        );
    }

    await inngest.send({
        name: "course/slides.generate.parallel",
        data: { chapter, courseId, courseName: courseName ?? "Course", chapterIndex },
    });

    console.log(`🧪 Queued PARALLEL slide generation: ${courseId} / chapter ${chapterIndex} (${chapter.chapterTitle ?? "?"})`);
    return apiSuccess({
        queued: true,
        courseId,
        chapterId: chapter.chapterId,
        chapterIndex,
        event: "course/slides.generate.parallel",
    }, 202);
}

export async function OPTIONS() {
    return apiOptions();
}
