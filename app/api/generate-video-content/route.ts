/**
 * POST /api/generate-video-content
 * Thin dispatcher — sends an Inngest event per chapter, returns immediately.
 */
import { inngest } from "@/inngest/client";
import { apiError, apiSuccess, apiOptions } from "@/lib/api-helpers";
import { validateInput, generateVideoContentSchema } from "@/lib/validations";
import { currentUser } from "@clerk/nextjs/server";
import { NextRequest } from "next/server";

export async function POST(req: NextRequest) {
    const user = await currentUser();
    if (!user?.primaryEmailAddress?.emailAddress) {
        return apiError("Authentication required", 401, "UNAUTHORIZED");
    }

    const body = await req.json();
    const validation = validateInput(generateVideoContentSchema, body);
    if (!validation.success) {
        return apiError("Invalid request input", 400, "VALIDATION_ERROR", validation.errors);
    }

    const { chapter, courseId, courseName, chapterIndex } = validation.data;

    await inngest.send({
        name: "course/video-content.generate",
        data: { chapter, courseId, courseName, chapterIndex },
    });

    console.log(`📤 Queued video content generation: ${courseId} / chapter ${chapterIndex}`);
    return apiSuccess({ queued: true, courseId, chapterId: chapter.chapterId, chapterIndex }, 202);
}

export async function OPTIONS() {
    return apiOptions();
}