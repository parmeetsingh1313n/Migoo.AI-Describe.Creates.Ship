/**
 * @module api/regenerate-slide
 * @description Stage 2 — regenerate ONE slide's visuals + narration from a user's
 * change request, during the review gate (status `review:slides`).
 *
 * POST /api/regenerate-slide { courseId, chapterId, slideId, instruction } -> { slide }
 *
 * Reuses the same single-slide LLM prompt + openrouter client that the pipeline
 * uses, so it inherits the shared NVIDIA key rotation + 3-model fallback — no
 * rate-limit handling needed here. The regenerated slide is persisted with its
 * audio fields cleared (audio is synthesised later, after final approval).
 *
 * @requires Authentication via Clerk
 * @requires Course ownership
 */

import { db } from "@/config/db";
import { openrouter } from "@/config/openrouter";
import { chapterContentSlides, courseImages, coursesTable } from "@/config/schema";
import { GENERATE_SINGLE_SLIDE_PROMPT } from "@/data/Prompt";
import { apiError, apiSuccess, apiOptions } from "@/lib/api-helpers";
import { validateInput, regenerateSlideSchema } from "@/lib/validations";
import { currentUser } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { NextRequest } from "next/server";

// Slide LLM generation is token-heavy — give it the full serverless budget.
export const maxDuration = 300;

// Per-slide component rotation (mirrors inngest/course-functions.ts)
const SLIDE_ARCHETYPES = [
    "COVER — kicker + one large headline + single-line dek in the header zone; body shows a clean image in a bounded ~40% side column (image never full-width, never over text)",
    "COMPARISON TABLE — the body is a premium 3-5 row table (Aspect / Option A / Option B) with a tinted header row; great for differences and 'X vs Y'",
    "DONUT / RING STAT — a conic-gradient percentage ring on one side + a short label/explanation on the other",
    "BEFORE / AFTER DIFF — two side-by-side columns (red-tinted Before, green-tinted After) each with an accent left-border and a small-caps label",
    "BUBBLE CARDS — a row of 2-3 soft rounded bubble cards (big radius, inset highlight, soft shadow), each with a gradient chip + title + one line",
    "NUMBERED STEPPER — 3-4 vertical steps with circular numbers joined by a spine; for sequences / how-to",
    "MINI BAR-CHART — 3-4 gradient columns of varying height with short labels; quick visual data compare",
    "METRIC CALLOUT ROW — 2-3 label → big number → delta metrics; results / dashboard feel",
    "PROGRESS / METER BARS — 3-4 labelled gradient progress bars with percentages, stacked",
    "NUMBERED FEATURE ROWS — 3-4 rows separated by hairlines, each = big serif index number + bold title + one-line detail (no boxes)",
    "HORIZONTAL TIMELINE / FLOW — 3-5 circular step nodes joined by arrows across the body, each with a short label",
    "STAT ROW — 2-3 huge gradient statistics with captions, plus a short supporting line; data-forward",
    "DEFINITION / CALLOUT CARD — one key term with an accent spine, the term in serif + a concise one-line meaning",
    "TAG / CHIP CLOUD — 6-9 concept keywords as rounded pills in varied accent tints; fast overview / glossary",
    "CONCEPT vs EXAMPLE — two labelled columns: the abstract concept on one side, a concrete example (mono font) on the other",
    "PRINCIPLE BAND — one strong italic serif statement in a tinted full-width band; a memorable takeaway",
];
const SLIDE_TYPE_PAIRS = [
    "Playfair Display headline + Outfit body",
    "Space Grotesk headline + Inter body",
    "Playfair Display headline + DM Sans body",
    "Outfit bold headline + Inter body",
    "Instrument Serif italic headline + Space Grotesk body",
];
const SLIDE_ACCENTS = ["#6D5BD3", "#3EA5D6", "#E0653A", "#E8B84B", "#2FA98C", "#D64B7F"];

export async function POST(req: NextRequest) {
    try {
        const user = await currentUser();
        const email = user?.primaryEmailAddress?.emailAddress;
        if (!email) return apiError("Authentication required", 401, "UNAUTHORIZED");

        const body = await req.json();
        const validation = validateInput(regenerateSlideSchema, body);
        if (!validation.success) {
            return apiError("Invalid request input", 400, "VALIDATION_ERROR", validation.errors);
        }
        const { courseId, chapterId, slideId, instruction } = validation.data;

        // ── Load course (name, layout, ownership) ────────────────────────────
        const [course] = await db.select().from(coursesTable).where(eq(coursesTable.courseId, courseId));
        if (!course) return apiError("Course not found", 404, "NOT_FOUND");
        if (course.userId !== email) return apiError("You do not have access to this course", 403, "FORBIDDEN");

        const layout: any = course.courseLayout;
        const chapters: any[] = Array.isArray(layout?.chapters) ? layout.chapters : [];
        const chapterIndex = chapters.findIndex((c) => c?.chapterId === chapterId);
        if (chapterIndex === -1) return apiError("Chapter not found in this course", 404, "NOT_FOUND");
        const chapter = chapters[chapterIndex];

        const subTopics: string[] = (chapter.subContent?.slice(0, 15)) || [chapter.chapterTitle];

        // ── Load the chapter's slides (target + siblings for context) ────────
        const chapterSlides = await db.select().from(chapterContentSlides)
            .where(and(eq(chapterContentSlides.courseId, courseId), eq(chapterContentSlides.chapterId, chapterId)));
        chapterSlides.sort((a, b) => (a.slideIndex ?? 0) - (b.slideIndex ?? 0));

        const target = chapterSlides.find((s) => s.slideId === slideId);
        if (!target) return apiError("Slide not found in this chapter", 404, "NOT_FOUND");

        const si = (target.slideIndex ?? 1) - 1;
        const totalSlides = Math.min(15, Math.max(chapterSlides.length, subTopics.length));
        const slideTopic = subTopics[si] ?? chapter.chapterTitle;

        // ── Load course images for placeholder injection ─────────────────────
        const allImages = await db.select().from(courseImages).where(eq(courseImages.courseId, courseId));
        allImages.sort((a, b) => a.imageIndex - b.imageIndex);

        // ── Build context from the other slides in this chapter ──────────────
        const previousContext = chapterSlides
            .filter((s) => (s.slideIndex ?? 0) < (target.slideIndex ?? 0))
            .map((s) => ({
                slideIndex: s.slideIndex,
                topic: subTopics[(s.slideIndex ?? 1) - 1] ?? "",
                narrationSummary: ((s.narration as any)?.fullText ?? "").substring(0, 500) + "...",
            }));

        const slideInput = JSON.stringify({
            chapterTitle: chapter.chapterTitle,
            chapterOverview: chapter.chapterDescription ?? `This chapter covers ${chapter.chapterTitle} comprehensively.`,
            chapterIndex: chapterIndex + 1,
            fullChapterOutline: subTopics.map((t: string, i: number) => `Slide ${i + 1}: ${t}`),
            slideTopic,
            slideIndex: si + 1,
            totalSlides,
            slidePosition: si === 0 ? "INTRO" : si === totalSlides - 1 ? "CONCLUSION" : "MIDDLE",
            previousSlidesContext: previousContext,
            nextSlideTopic: si + 1 < totalSlides ? subTopics[si + 1] : null,
            designHint: `Layout archetype: ${si === 0 ? SLIDE_ARCHETYPES[0] : SLIDE_ARCHETYPES[si % SLIDE_ARCHETYPES.length]}. Type pairing: ${SLIDE_TYPE_PAIRS[si % SLIDE_TYPE_PAIRS.length]}. Accent color: ${SLIDE_ACCENTS[si % SLIDE_ACCENTS.length]}.`,
            // ── The user's requested change — the whole point of this endpoint ──
            userChangeRequest: instruction,
        });

        // Emphasise the change request so the model actually honours it.
        const systemPrompt = GENERATE_SINGLE_SLIDE_PROMPT +
            `\n\n═══════════════════════════════════════════════════════════════════════════════
🔧 USER REVISION REQUEST (HIGHEST PRIORITY)
═══════════════════════════════════════════════════════════════════════════════
The learner has reviewed the current version of THIS slide and asked for a specific change.
Apply the change described in the input field "userChangeRequest" faithfully while keeping
the slide coherent with the rest of the chapter. Regenerate the slide's html, narration and
fragmentData completely to reflect the requested change. Honour the request precisely.`;

        let slideContent: any = null;
        const MODEL = "mistralai/mistral-large-3-675b-instruct-2512";
        let lastErr: any = null;
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                slideContent = await openrouter.json(systemPrompt, slideInput, { model: MODEL, temperature: 0.75, maxTokens: 12000 });
                if (Array.isArray(slideContent)) slideContent = slideContent[0];
                if (slideContent) break;
            } catch (e: any) {
                lastErr = e;
                console.warn(`⚠️ regenerate-slide attempt ${attempt}: ${e.message?.substring(0, 120)}`);
                if (attempt < 3) await new Promise((r) => setTimeout(r, 2000));
            }
        }
        if (!slideContent) {
            return apiError("Failed to regenerate slide", 502, "LLM_ERROR", lastErr?.message);
        }

        // Inject image URLs into placeholders
        let html: string = slideContent.html ?? "";
        if (html && allImages.length > 0) {
            let imgIdx = 0;
            html = html.replace(/\{\{IMAGE_PLACEHOLDER\}\}/g, () => {
                const url = allImages[(chapterIndex * totalSlides + si + imgIdx++) % allImages.length].imageUrl;
                return url;
            });
        }

        const narration = slideContent.narration ?? { fullText: (target.narration as any)?.fullText ?? "" };
        const revealData = slideContent.fragmentData ?? slideContent.revealData ?? target.revealData ?? [];

        // Persist — clear any stale audio (audio is synthesised after final approval)
        const [updated] = await db.update(chapterContentSlides)
            .set({
                html: html || target.html,
                narration,
                revealData,
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
                html: updated.html,
                narration: updated.narration,
                revealData: updated.revealData,
            },
        });
    } catch (error: any) {
        console.error("regenerate-slide error:", error?.message);
        return apiError("Failed to regenerate slide", 500, "INTERNAL_ERROR", error?.message);
    }
}

export async function OPTIONS() {
    return apiOptions();
}
