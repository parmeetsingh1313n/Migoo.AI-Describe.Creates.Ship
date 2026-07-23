/**
 * @module api/slide-content
 * @description Stage 3 — persist an edited narration for a single slide, during
 * the review gate (status `review:slides`), before TTS runs.
 *
 * PATCH /api/slide-content { courseId, chapterId, slideId, narration } -> { slide }
 *
 * The narration text drives the Sarvam TTS in the audio phase, so editing it
 * here means the generated voiceover reflects the user's final script. Editing
 * clears any stale audio for that slide.
 *
 * @requires Authentication via Clerk
 * @requires Course ownership
 */

import { db } from "@/config/db";
import { chapterContentSlides, coursesTable } from "@/config/schema";
import { apiError, apiSuccess, apiOptions } from "@/lib/api-helpers";
import { uploadSlideNarration, resolveSlideNarration } from "@/lib/slide-narration";
import { validateInput, updateSlideNarrationSchema } from "@/lib/validations";
import { currentUser } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { NextRequest } from "next/server";

export async function PATCH(req: NextRequest) {
    try {
        const user = await currentUser();
        const email = user?.primaryEmailAddress?.emailAddress;
        if (!email) return apiError("Authentication required", 401, "UNAUTHORIZED");

        const body = await req.json();
        const validation = validateInput(updateSlideNarrationSchema, body);
        if (!validation.success) {
            return apiError("Invalid request input", 400, "VALIDATION_ERROR", validation.errors);
        }
        const { courseId, chapterId, slideId, narration } = validation.data;

        // Ownership guard
        const [course] = await db.select({ userId: coursesTable.userId })
            .from(coursesTable).where(eq(coursesTable.courseId, courseId));
        if (!course) return apiError("Course not found", 404, "NOT_FOUND");
        if (course.userId !== email) return apiError("You do not have access to this course", 403, "FORBIDDEN");

        // Load the slide to preserve any extra narration fields
        const [slide] = await db.select().from(chapterContentSlides)
            .where(and(eq(chapterContentSlides.courseId, courseId), eq(chapterContentSlides.slideId, slideId)));
        if (!slide) return apiError("Slide not found", 404, "NOT_FOUND");

        // Resolve existing narration (may be in Appwrite) so we can merge fullText.
        const prevNarration = (await resolveSlideNarration(slide)) ?? {};
        const nextNarration = { ...prevNarration, fullText: narration.trim() };

        // Offload updated narration to Appwrite; store only the URL.
        let narrationUrl: string | null = null;
        let narrationInline: any | null = nextNarration;
        try {
            narrationUrl = await uploadSlideNarration(slideId, nextNarration);
            narrationInline = null;
        } catch (e: any) {
            console.warn(`⚠️ slide-content narration upload failed for ${slideId}, keeping inline: ${e?.message?.slice(0, 100)}`);
        }

        // Persist edited narration; clear stale audio (regenerated after approval)
        const [updated] = await db.update(chapterContentSlides)
            .set({
                narration: narrationInline,
                narrationUrl,
                audioUrl: null,
                captions: null,
                audioDuration: null,
            })
            .where(eq(chapterContentSlides.slideId, slideId))
            .returning();

        return apiSuccess({
            slide: {
                slideId: updated.slideId,
                slideIndex: updated.slideIndex,
                narration: nextNarration,
            },
        });
    } catch (error: any) {
        console.error("slide-content PATCH error:", error?.message);
        return apiError("Failed to update slide narration", 500, "UPDATE_ERROR", error?.message);
    }
}

export async function OPTIONS() {
    return apiOptions();
}
