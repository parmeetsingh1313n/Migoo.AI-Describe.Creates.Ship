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
import { GENERATE_SINGLE_SLIDE_PROMPT, PLAN_SLIDE_PROMPT } from "@/data/Prompt";
import { SLIDE_TYPE_PAIRS, SLIDE_ACCENTS, SLIDE_ARCHETYPES, pickArchetype, componentName, isCodeArchetype, isCodeCompanionArchetype, isLikelyCodeTopic } from "@/data/slide-design";
import { fetchSlideResearch } from "@/lib/tavily";
import { uploadSlideHtml, resolveSlideHtml } from "@/lib/slide-html";
import { apiError, apiSuccess, apiOptions } from "@/lib/api-helpers";
import { validateInput, regenerateSlideSchema } from "@/lib/validations";
import { currentUser } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { NextRequest } from "next/server";

// Slide LLM generation is token-heavy — give it the full serverless budget.
export const maxDuration = 300;

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

        // Same deterministic component assignment the bulk pipeline uses, so a
        // regenerated slide keeps this chapter's varied, non-repeating design —
        // topic-aware override too, so regenerating a code-y slide doesn't lose
        // its code-card just because the rotation landed elsewhere.
        const naturalArchetype = pickArchetype(chapterIndex, si);
        const wantsCode = isLikelyCodeTopic(slideTopic);
        const archetype = (wantsCode && !isCodeArchetype(naturalArchetype))
            ? (SLIDE_ARCHETYPES.filter(isCodeArchetype)[si % SLIDE_ARCHETYPES.filter(isCodeArchetype).length] ?? naturalArchetype)
            : naturalArchetype;
        const primaryComponent = componentName(archetype);
        const isCodeSlide = isCodeArchetype(archetype);
        const isCodeCompanion = isCodeCompanionArchetype(archetype);

        // Tavily RAG — ground the regenerated narration in accurate, current facts.
        const researchContext = await fetchSlideResearch(slideTopic, `${course.courseName} · ${chapter.chapterTitle}`);

        const slideContext: Record<string, any> = {
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
            mandatoryComponent: primaryComponent,
            mandatoryComponentSpec: archetype,
            isCodeSlide,
            imageAllowed: !isCodeSlide,
            researchContext: researchContext || null,
            designHint: `🎯 BUILD THIS EXACT COMPONENT unless the user's change request below asks for a different one: ${archetype}. `
                + (isCodeCompanion
                    ? `2-COLUMN slide: a .code-card (header + <pre><code>, real line breaks, a REAL COMPLETE snippet up to ~20 lines, auto-scrolls) on ONE side and a COMPANION component on the OTHER — do NOT always use callouts; pick the catalog component that best fits this code (stepper, definition cards, metric row, mini comparison table, concept-vs-example, feature list, chip cloud). Those are the only two blocks. NEVER a table cell or an image of code. NO {{IMAGE_PLACEHOLDER}} / <img>. `
                    : isCodeSlide
                    ? `CODE slide: the ENTIRE body is ONE .code-card (header + <pre><code>, real line breaks) — NEVER a table cell or plain text. A REAL, COMPLETE, working snippet up to ~50 lines is fine (it auto-scrolls in sync with narration — never fake-truncate it). NO {{IMAGE_PLACEHOLDER}} / <img>. `
                    : `Include ONE {{IMAGE_PLACEHOLDER}} where it genuinely helps, kept SMALL (~28-30% side column, max-height 300px) unless the component is image-free. `)
                + `🔴 DENSITY: every item in the component (row / card / step / callout / metric / node) MUST carry a bold title PLUS a real one-line detail (8-14 words) that teaches — bare 2-3 word labels are a FAILED slide. `
                + `Type pairing: ${SLIDE_TYPE_PAIRS[si % SLIDE_TYPE_PAIRS.length]}. Accent color: ${SLIDE_ACCENTS[si % SLIDE_ACCENTS.length]}.`,
            // ── The user's requested change — the whole point of this endpoint ──
            userChangeRequest: instruction,
        };

        // ── Phase 1: PLAN (GLM thinking ON, small output). Best-effort — on
        // timeout/error we fall through plan-less so a slide is always produced.
        // This whole route shares ONE 300s budget, so cap Phase 1 at ~100s and
        // leave the rest for the write. ──
        let slidePlan: string | null = null;
        try {
            slidePlan = await openrouter.text(PLAN_SLIDE_PROMPT, JSON.stringify(slideContext), {
                model: "z-ai/glm-5.2",
                disableThinking: false,
                maxTokens: 4000,
                timeoutMs: 100000,
            });
        } catch (e: any) {
            console.warn(`⚠️ regenerate-slide Phase-1 plan failed (proceeding plan-less): ${e?.message?.substring(0, 120)}`);
            slidePlan = null;
        }

        const slideInput = JSON.stringify(
            slidePlan ? { ...slideContext, slidePlan } : slideContext
        );

        // Emphasise the change request so the model actually honours it.
        let systemPrompt = GENERATE_SINGLE_SLIDE_PROMPT +
            `\n\n═══════════════════════════════════════════════════════════════════════════════
🔧 USER REVISION REQUEST (HIGHEST PRIORITY)
═══════════════════════════════════════════════════════════════════════════════
The learner has reviewed the current version of THIS slide and asked for a specific change.
Apply the change described in the input field "userChangeRequest" faithfully while keeping
the slide coherent with the rest of the chapter. Regenerate the slide's html, narration and
fragmentData completely to reflect the requested change. Honour the request precisely.`;

        // When Phase 1 produced a plan, tell the writer to render it (not re-plan).
        if (slidePlan) {
            systemPrompt += `\n\nA finished PLAN for this slide is in the input field "slidePlan" — render it faithfully into the final JSON (html + narration.fragments + fragmentData), applying the userChangeRequest on top. Do NOT re-plan from scratch.`;
        }

        let slideContent: any = null;
        const MODEL = "z-ai/glm-5.2";
        let lastErr: any = null;
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                // Phase 2: WRITE — thinking OFF so GLM only renders, fast. Cap the
                // fetch at ~160s so it aborts before the 300s function limit.
                slideContent = await openrouter.json(systemPrompt, slideInput, {
                    model: MODEL,
                    temperature: 0.75,
                    maxTokens: 12000,
                    disableThinking: true,
                    clearThinking: true,
                    timeoutMs: 160000,
                });
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

        // Inject image URLs into placeholders — this slide's OWN image (global index).
        let html: string = slideContent.html ?? "";
        if (html && allImages.length > 0) {
            const gIdx = chapterIndex * 15 + si;
            let extra = 0;
            html = html.replace(/\{\{IMAGE_PLACEHOLDER\}\}/g, () => {
                const url = allImages.find(im => im.imageIndex === gIdx)?.imageUrl
                    ?? allImages[(gIdx + extra++) % allImages.length].imageUrl;
                return url;
            });
        }

        const narration = slideContent.narration ?? { fullText: (target.narration as any)?.fullText ?? "" };
        const revealData = slideContent.fragmentData ?? slideContent.revealData ?? target.revealData ?? [];

        // Final markup: the freshly generated html, or (if the LLM returned none)
        // the slide's previous markup — which may live in Appwrite, so resolve it.
        const finalHtml = html || (await resolveSlideHtml(target)) || "";

        // Offload to Appwrite; store only the URL. On upload failure, keep inline.
        let htmlUrl: string | null = null;
        let htmlInline: string | null = finalHtml || null;
        if (finalHtml) {
            try {
                htmlUrl = await uploadSlideHtml(slideId, finalHtml);
                htmlInline = null;
            } catch (e: any) {
                console.warn(`⚠️ regenerate-slide HTML upload failed for ${slideId}, keeping inline: ${e?.message?.slice(0, 100)}`);
            }
        }

        // Persist — clear any stale audio (audio is synthesised after final approval)
        const [updated] = await db.update(chapterContentSlides)
            .set({
                html: htmlInline,
                htmlUrl,
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
                html: finalHtml, // return resolved markup so the client renders immediately
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
