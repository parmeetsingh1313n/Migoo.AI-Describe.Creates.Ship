import { db } from "@/config/db";
import { chapterGenerationStatus, chapterContentSlides } from "@/config/schema";
import { apiError, apiSuccess, apiOptions } from "@/lib/api-helpers";
import { currentUser } from "@clerk/nextjs/server";
import { eq, and } from "drizzle-orm";
import { NextRequest } from "next/server";

export async function POST(req: NextRequest) {
    const user = await currentUser();
    if (!user?.primaryEmailAddress?.emailAddress) {
        return apiError("Authentication required", 401, "UNAUTHORIZED");
    }

    try {
        const body = await req.json();
        const { courseId, chapterId } = body;

        if (!courseId || !chapterId) {
            return apiError("courseId and chapterId are required", 400, "MISSING_PARAM");
        }

        console.log(`🧹 Resetting audio for chapter: ${chapterId} of course: ${courseId}`);

        // 1. Set audioUrl, audioDuration, captions to null for all slides in this chapter
        await db
            .update(chapterContentSlides)
            .set({
                audioUrl: null,
                audioDuration: null,
                captions: null,
            })
            .where(
                and(
                    eq(chapterContentSlides.courseId, courseId),
                    eq(chapterContentSlides.chapterId, chapterId)
                )
            );

        // 2. Set the status of the chapter in chapterGenerationStatus to 'idle'
        await db
            .insert(chapterGenerationStatus)
            .values({
                courseId,
                chapterId,
                status: "idle",
                slidesTotal: 7,
                slidesComplete: 7,
                audioComplete: 0,
                errorMessage: null,
                updatedAt: new Date(),
            })
            .onConflictDoUpdate({
                target: chapterGenerationStatus.chapterId,
                set: {
                    status: "idle",
                    audioComplete: 0,
                    errorMessage: null,
                    updatedAt: new Date(),
                },
            });

        console.log(`✅ Reset complete for chapter: ${chapterId}`);
        return apiSuccess({ success: true, message: "Chapter audio reset successfully. You can now generate from scratch." });

    } catch (error: any) {
        console.error("❌ reset-chapter-audio error:", error.message);
        return apiError("Failed to reset chapter audio", 500, "INTERNAL_ERROR", error.message);
    }
}

export async function OPTIONS() {
    return apiOptions();
}
