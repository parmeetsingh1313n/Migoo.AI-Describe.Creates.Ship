/**
 * POST /api/generate-images
 * Thin dispatcher — sends an Inngest event, returns immediately.
 */
import { inngest } from "@/inngest/client";
import { apiError, apiOptions, apiSuccess } from "@/lib/api-helpers";
import { currentUser } from "@clerk/nextjs/server";
import { NextRequest } from "next/server";

export async function POST(req: NextRequest) {
    const user = await currentUser();
    if (!user?.primaryEmailAddress?.emailAddress) {
        return apiError("Authentication required", 401, "UNAUTHORIZED");
    }

    const { courseName, courseId, chapters } = await req.json();
    if (!courseName || !courseId || !chapters) {
        return apiError("courseName, courseId, and chapters are required", 400, "VALIDATION_ERROR");
    }

    await inngest.send({
        name: "course/images.generate",
        data: { courseId, courseName, chapters },
    });

    console.log(`📤 Queued image generation for course: ${courseId} (${chapters.length} chapters)`);
    return apiSuccess({ queued: true, courseId, chapters: chapters.length }, 202);
}

export async function OPTIONS() {
    return apiOptions();
}
