/**
 * POST /api/generate-thumbnail
 * Thin dispatcher — sends an Inngest event, returns immediately.
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

    const { courseId, courseName } = await req.json();
    if (!courseId || !courseName) {
        return apiError("courseId and courseName are required", 400, "VALIDATION_ERROR");
    }

    await inngest.send({
        name: "course/thumbnail.generate",
        data: { courseId, courseName },
    });

    console.log(`📤 Queued thumbnail generation for course: ${courseId}`);
    return apiSuccess({ queued: true, courseId }, 202);
}

export async function OPTIONS() {
    return apiOptions();
}
