/**
 * EXPERIMENTAL: Plan-then-parallel slide generation
 * ──────────────────────────────────────────────────
 * A parallel version of generateCourseSlidesFn that generates all slides
 * concurrently after a single upfront planning call. Preserves all quality
 * guardrails (concept de-duplication, component variety, flow) while dropping
 * per-chapter time from ~7 min to ~1 min.
 *
 * Trigger with event: `course/slides.generate.parallel`
 *
 * Quality preserved:
 *   - Component variety (deterministic archetype rotation + code budget)
 *   - Concept de-duplication (planning call assigns non-overlapping concepts)
 *   - Flow (each slide gets prev/next context from the plan)
 *   - Image alignment (stable 1-based slideIndex)
 *   - Resumability (skips existing DB slides)
 *
 * Speed improvement:
 *   - Tavily research: serial 20s × N → parallel prefetch
 *   - Slide generation: serial 30s × N → all at once
 *   - 9-slide chapter: ~7 min → ~1 min
 */

import { db } from "@/config/db";
import { openrouter } from "@/config/openrouter";
import { chapterContentSlides, courseImages, coursesTable } from "@/config/schema";
import { GENERATE_SINGLE_SLIDE_PROMPT, CHAPTER_PLAN_PROMPT } from "@/data/Prompt";
import { fetchSlideResearch } from "@/lib/tavily";
import {
    SLIDE_TYPE_PAIRS, SLIDE_ACCENTS, SLIDE_ARCHETYPES,
    pickArchetype, pickNonCodeArchetype, componentName,
    isCodeArchetype, isCodeCompanionArchetype, codeSlideBudget
} from "@/data/slide-design";
import { eq, and } from "drizzle-orm";
import { inngest } from "./client";
import { makeUpsertStatus, expandChapterTopics, MAX_SLIDES_PER_CHAPTER, type ChapterTopic } from "./course-functions";

export const generateCourseSlidesParallelFn = inngest.createFunction(
    {
        id: "generate-course-slides-parallel",
        triggers: [{ event: "course/slides.generate.parallel" }],
        concurrency: [{ limit: 2 }],  // max 2 chapters in parallel globally
    },
    async ({ event, step }) => {
        const { chapter, courseId, courseName, chapterIndex } = event.data as {
            chapter: any; courseId: string; courseName: string; chapterIndex: number;
        };

        const TAG = `[Ch${chapterIndex + 1}||]`;
        const chapterId = chapter.chapterId;
        console.log(`\n🚀 ${TAG} SLIDES (PARALLEL): ${courseId} — ${chapter.chapterTitle}`);

        const upsertStatus = makeUpsertStatus(courseId, chapterId);

        // ── Step 0: Load existing slides ──────────────────────────────────────
        const existingSlides = await step.run("check-existing-slides", async () => {
            return await db.select().from(chapterContentSlides).where(eq(chapterContentSlides.chapterId, chapterId));
        });

        // ── Load or expand slide topics (identical to serial version) ─────────
        const rawSubContent: string[] = chapter.subContent?.slice(0, MAX_SLIDES_PER_CHAPTER) || [chapter.chapterTitle];
        const persistedTopics = await step.run("load-persisted-slide-topics", async () => {
            const [course] = await db.select({ slideTopics: coursesTable.slideTopics })
                .from(coursesTable).where(eq(coursesTable.courseId, courseId));
            const map = (course?.slideTopics as Record<string, ChapterTopic[]>) ?? {};
            const t = map[chapterId];
            return Array.isArray(t) && t.length > 0 ? t : null;
        });

        let chapterTopics: ChapterTopic[];
        if (existingSlides.length > 0) {
            // Keep 1:1 mapping for chapters with existing slides (continuity)
            chapterTopics = rawSubContent.map(topic => ({ topic, needsCode: false }));
        } else if (persistedTopics) {
            console.log(`📎 ${TAG} Reusing persisted expansion (${persistedTopics.length} topics)`);
            chapterTopics = persistedTopics;
        } else {
            chapterTopics = await step.run("expand-chapter-topics", () => expandChapterTopics(chapter.chapterTitle, rawSubContent));
            await step.run("persist-slide-topics", async () => {
                const [course] = await db.select({ slideTopics: coursesTable.slideTopics })
                    .from(coursesTable).where(eq(coursesTable.courseId, courseId));
                const map = (course?.slideTopics as Record<string, ChapterTopic[]>) ?? {};
                if (!map[chapterId]) {
                    map[chapterId] = chapterTopics;
                    await db.update(coursesTable).set({ slideTopics: map })
                        .where(eq(coursesTable.courseId, courseId));
                }
            });
        }

        const subTopics = chapterTopics.map(t => t.topic);
        const totalSlides = subTopics.length;

        // Early exit if fully complete
        const isComplete = existingSlides.length >= totalSlides && existingSlides.every(s => s.audioUrl);
        if (isComplete) {
            console.log(`✅ ${TAG} Already complete — skipping`);
            await upsertStatus({ status: "completed", slidesComplete: totalSlides, slidesTotal: totalSlides, audioComplete: totalSlides, completedAt: new Date() });
            return { skipped: true, slides: existingSlides };
        }

        // Mark as generating
        const existingSlideCount = existingSlides.filter(s => s.html).length;
        const existingAudioCount = existingSlides.filter(s => s.audioUrl).length;
        await step.run("mark-generating-slides", async () => {
            await upsertStatus({
                status: "generating:slides",
                slidesTotal: totalSlides,
                slidesComplete: existingSlideCount,
                audioComplete: existingAudioCount,
                startedAt: new Date(),
                completedAt: null,
                errorMessage: null,
            });
        });

        // Load images for placeholder injection
        const allImages = await step.run("load-course-images", async () => {
            const imgs = await db.select().from(courseImages).where(eq(courseImages.courseId, courseId));
            imgs.sort((a, b) => a.imageIndex - b.imageIndex);
            return imgs;
        });

        // ══════════════════════════════════════════════════════════════════════
        // NEW: Plan-then-parallel
        // ══════════════════════════════════════════════════════════════════════

        // ── PHASE 1: Planning call ────────────────────────────────────────────
        // One cheap GLM call assigns each slide its topic, key concepts, component
        // archetype, and flow context. This does ALL the de-duplication work that
        // previousContext used to do incrementally.

        const slidePlan = await step.run("generate-chapter-plan", async () => {
            // Deterministic archetype rotation (same as serial version)
            const codeMax = codeSlideBudget(totalSlides);
            const archetypeList = subTopics.map((_, si) => {
                const naturalArchetype = pickArchetype(chapterIndex, si);
                const needsCode = chapterTopics[si]?.needsCode ?? false;
                const isCode = isCodeArchetype(naturalArchetype);

                // If natural rotation landed on code but topic doesn't need it, swap to non-code
                if (isCode && !needsCode) return pickNonCodeArchetype(chapterIndex, si);
                // If topic needs code but rotation didn't give it, force a code archetype
                if (!isCode && needsCode && si > 0) {
                    const codeArchetypes = SLIDE_ARCHETYPES.filter(a => isCodeArchetype(a));
                    return codeArchetypes[si % codeArchetypes.length];
                }
                return naturalArchetype;
            });

            const planInput = JSON.stringify({
                chapterTitle: chapter.chapterTitle,
                chapterDescription: chapter.chapterDescription ?? `This chapter covers ${chapter.chapterTitle} comprehensively.`,
                chapterIndex: chapterIndex + 1,
                totalSlides,
                slideTopics: subTopics,
                archetypes: archetypeList,
                codeBudget: codeMax,
            });

            console.log(`🗺️ ${TAG} Generating chapter plan via GLM...`);
            const plan = await openrouter.json(CHAPTER_PLAN_PROMPT, planInput, {
                model: "z-ai/glm-5.2",
                temperature: 0.3,  // low temp for deterministic concept assignment
                maxTokens: 8000,
            });

            if (!plan?.slides || !Array.isArray(plan.slides) || plan.slides.length !== totalSlides) {
                throw new Error(`${TAG} Planning call returned invalid structure (expected ${totalSlides} slides, got ${plan?.slides?.length ?? 0})`);
            }

            console.log(`✅ ${TAG} Plan ready: ${plan.slides.length} slides, concepts de-duplicated`);
            return plan.slides;
        });

        // ── PHASE 2: Prefetch all Tavily research (parallel) ──────────────────
        const researchMap = await step.run("prefetch-tavily-research", async () => {
            console.log(`🔍 ${TAG} Prefetching Tavily research for ${totalSlides} slides...`);
            const researchPromises = subTopics.map((topic, si) =>
                fetchSlideResearch(topic, `${courseName} — ${chapter.chapterTitle}`)
                    .then(ctx => ({ si, ctx }))
                    .catch(err => {
                        console.warn(`⚠️ ${TAG} Tavily failed for slide ${si + 1}: ${err.message}`);
                        return { si, ctx: "" };
                    })
            );
            const results = await Promise.all(researchPromises);
            const map: Record<number, string> = {};
            results.forEach(r => { map[r.si] = r.ctx; });
            console.log(`✅ ${TAG} Research prefetched for ${Object.keys(map).length} slides`);
            return map;
        });

        // ── PHASE 3: Generate slides — each in its OWN step, bounded concurrency ──
        // CRITICAL: every slide is its own step.run() so Inngest checkpoints each
        // one independently. If a Vercel 300s timeout hits, only the in-flight
        // slides retry — every slide already saved is memoized and NEVER
        // regenerated. (The old single mega-step regenerated ALL slides on any
        // timeout — that's the duplicate-generation bug.)
        //
        // Concurrency is capped at CONCURRENCY (not all-at-once) to avoid the
        // NVIDIA 429 "thundering herd" that made every call back off for minutes.
        const CONCURRENCY = 3;

        const generateOneSlide = async (topic: string, si: number) => {
            return await step.run(`generate-slide-${si}`, async () => {
                // Fresh per-slide DB check — never regenerate an existing slide,
                // even across a completely fresh re-trigger of the function.
                const [existing] = await db.select().from(chapterContentSlides)
                    .where(and(
                        eq(chapterContentSlides.chapterId, chapterId),
                        eq(chapterContentSlides.slideIndex, si + 1),
                    ));
                if (existing && existing.html) {
                    console.log(`⏭️  ${TAG} Slide ${si + 1}/${totalSlides} already exists — skipping`);
                    let existingHtml = existing.html;
                    if (allImages.length > 0 && existingHtml.includes('{{IMAGE_PLACEHOLDER}}')) {
                        const gIdx = chapterIndex * MAX_SLIDES_PER_CHAPTER + si;
                        let extra = 0;
                        existingHtml = existingHtml.replace(/\{\{IMAGE_PLACEHOLDER\}\}/g, () => {
                            const url = allImages.find(im => im.imageIndex === gIdx)?.imageUrl
                                ?? allImages[(gIdx + extra++) % allImages.length]?.imageUrl ?? "";
                            return url;
                        });
                        await db.update(chapterContentSlides)
                            .set({ html: existingHtml })
                            .where(eq(chapterContentSlides.slideId, existing.slideId));
                    }
                    return {
                        slideId: existing.slideId,
                        slideIndex: existing.slideIndex,
                        narration: existing.narration,
                        html: existingHtml,
                        revealData: existing.revealData,
                        audioUrl: existing.audioUrl,
                        captions: existing.captions,
                        audioDuration: existing.audioDuration,
                    };
                }

                // Generate new slide
                const planEntry = slidePlan[si];
                const archetype = planEntry.archetype;
                const isCodeSlide = planEntry.isCodeSlide ?? false;
                const isCodeCompanion = isCodeCompanionArchetype(archetype);
                const primaryComponent = componentName(archetype);

                const slideInput = JSON.stringify({
                    chapterTitle: chapter.chapterTitle,
                    chapterOverview: chapter.chapterDescription ?? `This chapter covers ${chapter.chapterTitle} comprehensively.`,
                    chapterIndex: chapterIndex + 1,
                    fullChapterOutline: subTopics.map((t, i) => `Slide ${i + 1}: ${t}`),
                    slideTopic: topic,
                    slideIndex: si + 1,
                    totalSlides,
                    slidePosition: si === 0 ? "INTRO" : si === totalSlides - 1 ? "CONCLUSION" : "MIDDLE",
                    // Flow context from the plan (replaces previousSlidesContext)
                    conceptsAlreadyCovered: planEntry.keyConcepts,
                    flowContext: planEntry.contextNote,
                    nextSlideTopic: si + 1 < totalSlides ? subTopics[si + 1] : null,
                    mandatoryComponent: primaryComponent,
                    mandatoryComponentSpec: archetype,
                    doNotReuseComponents: [],  // plan already ensures variety
                    isCodeSlide,
                    imageAllowed: !isCodeSlide,
                    researchContext: researchMap[si] || null,
                    designHint: `🎯 BUILD THIS EXACT COMPONENT: ${archetype}. ${isCodeCompanion ? 'This is a 2-column slide: code card + companion (NOT always callouts).' : isCodeSlide ? 'Full code card only, no images.' : 'Include ONE {{IMAGE_PLACEHOLDER}} if it helps (~28-30% side column, max-height:300px).'} Type: ${SLIDE_TYPE_PAIRS[(chapterIndex + si) % SLIDE_TYPE_PAIRS.length]}. Accent: ${SLIDE_ACCENTS[(chapterIndex * 2 + si) % SLIDE_ACCENTS.length]}.`,
                });

                const MODEL = "z-ai/glm-5.2";
                console.log(`🎬 ${TAG} Slide ${si + 1}/${totalSlides} via ${MODEL}...`);

                let slideContent: any = null;
                for (let attempt = 1; attempt <= 3; attempt++) {
                    try {
                        slideContent = await openrouter.json(GENERATE_SINGLE_SLIDE_PROMPT, slideInput, {
                            model: MODEL,
                            temperature: 0.75,
                            maxTokens: 12000,
                        });
                        if (Array.isArray(slideContent)) slideContent = slideContent[0];
                        break;
                    } catch (e: any) {
                        console.warn(`⚠️ ${TAG} Slide ${si + 1} attempt ${attempt}: ${e.message?.substring(0, 120)}`);
                        if (attempt < 3) await new Promise(r => setTimeout(r, 3000));
                        else throw e;
                    }
                }

                if (!slideContent) throw new Error(`${TAG} Failed to generate slide ${si + 1}`);

                slideContent.slideIndex = si + 1;
                slideContent.slideId = slideContent.slideId || `${chapterId}-slide-${si + 1}`;

                // Inject image URLs
                if (slideContent.html && allImages.length > 0) {
                    const gIdx = chapterIndex * MAX_SLIDES_PER_CHAPTER + si;
                    let extra = 0;
                    slideContent.html = slideContent.html.replace(/\{\{IMAGE_PLACEHOLDER\}\}/g, () => {
                        const url = allImages.find(im => im.imageIndex === gIdx)?.imageUrl
                            ?? allImages[(gIdx + extra++) % allImages.length]?.imageUrl ?? "";
                        return url;
                    });
                }

                // Save to DB
                const revealData = slideContent.fragmentData ?? slideContent.revealData ?? [];
                await db.insert(chapterContentSlides).values({
                    courseId,
                    chapterId,
                    slideId: slideContent.slideId,
                    slideIndex: si + 1,
                    narration: slideContent.narration,
                    html: slideContent.html ?? null,
                    revealData,
                    audioUrl: null,
                    captions: null,
                    audioDuration: null,
                }).onConflictDoUpdate({
                    target: chapterContentSlides.slideId,
                    set: { narration: slideContent.narration, html: slideContent.html ?? null, revealData },
                });

                console.log(`💾 ${TAG} Slide ${si + 1}/${totalSlides} saved ✅`);
                return slideContent;
            });
        };

        // Run slides in bounded-concurrency waves (3 at a time). Each slide is an
        // independent Inngest step, so a timeout only ever re-runs the unfinished
        // ones — completed slides stay memoized.
        console.log(`🎬 ${TAG} Generating ${totalSlides} slides (${CONCURRENCY} at a time)...`);
        const slidesData: any[] = new Array(totalSlides);
        for (let start = 0; start < totalSlides; start += CONCURRENCY) {
            const wave = subTopics
                .map((topic, si) => ({ topic, si }))
                .slice(start, start + CONCURRENCY);
            const waveResults = await Promise.all(wave.map(({ topic, si }) => generateOneSlide(topic, si)));
            wave.forEach(({ si }, k) => { slidesData[si] = waveResults[k]; });
            // Progress update after each wave
            await step.run(`progress-after-slide-${start}`, async () => {
                const done = Math.min(start + CONCURRENCY, totalSlides);
                await upsertStatus({
                    status: "generating:slides",
                    slidesTotal: totalSlides,
                    slidesComplete: done,
                    audioComplete: existingAudioCount,
                });
                return { done };
            });
        }
        console.log(`✅ ${TAG} All ${totalSlides} slides generated`);

        // ── Final image injection pass (race-condition guard) ─────────────────
        await step.run("slides-image-injection", async () => {
            const finalImages = await db.select().from(courseImages).where(eq(courseImages.courseId, courseId));
            if (finalImages.length === 0) return { injected: 0 };
            finalImages.sort((a, b) => a.imageIndex - b.imageIndex);

            const chapterSlides = await db.select().from(chapterContentSlides).where(eq(chapterContentSlides.chapterId, chapterId));
            let injected = 0;
            for (const slide of chapterSlides) {
                if (!slide.html || !slide.html.includes('{{IMAGE_PLACEHOLDER}}')) continue;
                const slideNum = (slide.slideIndex ?? 1) - 1;
                const gIdx = chapterIndex * MAX_SLIDES_PER_CHAPTER + slideNum;
                let extra = 0;
                const newHtml = slide.html.replace(/\{\{IMAGE_PLACEHOLDER\}\}/g, () => {
                    const url = finalImages.find(im => im.imageIndex === gIdx)?.imageUrl
                        ?? finalImages[(gIdx + extra++) % finalImages.length]?.imageUrl ?? "";
                    return url;
                });
                await db.update(chapterContentSlides).set({ html: newHtml }).where(eq(chapterContentSlides.slideId, slide.slideId));
                injected++;
            }
            console.log(`🖼️ ${TAG} ${injected} slides had placeholders replaced`);
            return { injected };
        });

        // ── Park at review gate ───────────────────────────────────────────────
        await step.run("mark-review-slides", async () => {
            await upsertStatus({
                status: "review:slides",
                slidesTotal: totalSlides,
                slidesComplete: totalSlides,
                audioComplete: existingAudioCount,
                completedAt: null,
                errorMessage: null,
            });
        });

        console.log(`🟣 ${TAG} ${slidesData.length} slides ready for review (parallel generation complete)`);
        return { slides: slidesData, chapterId, courseId, chapterIndex, review: true };
    }
);
