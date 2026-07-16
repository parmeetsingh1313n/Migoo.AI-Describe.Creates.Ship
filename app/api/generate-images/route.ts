/**
 * POST /api/generate-images
 * Thin dispatcher — sends an Inngest event, returns immediately.
 *
 * GET /api/generate-images?courseId=xxx
 * Lightweight image-readiness status — returns the set of present global image
 * indices so the client can gate each chapter's "Generate Video Content" button
 * until THAT chapter's images (globalIdx range [chIdx*25, chIdx*25+slides)) exist.
 */
import { db } from "@/config/db";
import { courseImages } from "@/config/schema";
import { inngest } from "@/inngest/client";
import { apiError, apiOptions, apiSuccess } from "@/lib/api-helpers";
import { currentUser } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";

// Must match MAX_SLIDES_PER_CHAPTER in inngest/course-functions.ts
const MAX_SLIDES_PER_CHAPTER = 25;

export async function GET(req: NextRequest) {
    const user = await currentUser();
    if (!user?.primaryEmailAddress?.emailAddress) {
        return apiError("Authentication required", 401, "UNAUTHORIZED");
    }
    const courseId = req.nextUrl.searchParams.get("courseId");
    if (!courseId) {
        return apiError("courseId is required", 400, "VALIDATION_ERROR");
    }
    const rows = await db.select({ imageIndex: courseImages.imageIndex })
        .from(courseImages).where(eq(courseImages.courseId, courseId));
    const indices = rows.map(r => r.imageIndex).sort((a, b) => a - b);
    return apiSuccess({ courseId, stride: MAX_SLIDES_PER_CHAPTER, indices, count: indices.length });
}

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
