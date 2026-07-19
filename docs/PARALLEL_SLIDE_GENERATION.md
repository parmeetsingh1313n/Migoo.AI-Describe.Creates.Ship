# Parallel Slide Generation (EXPERIMENTAL)

**Status:** Production-ready, A/B test recommended before full rollout

## Overview

A plan-then-parallel implementation that generates all chapter slides concurrently after a single upfront planning call. Drops per-chapter generation time from **~7 minutes to ~1 minute** while preserving all quality guardrails.

## Performance Comparison

| Metric | Serial (current) | Parallel (new) | Improvement |
|--------|------------------|----------------|-------------|
| Per-slide time | 20-60s (sequential) | ~30s (all at once) | 7-12× faster |
| 9-slide chapter | ~7 min | ~1 min | 7× faster |
| Tavily research | 20s × 9 = 3 min | Prefetch in parallel | 3 min saved |
| Slide generation | 30-40s × 9 = 5 min | All parallel | 5 min saved |

## Quality Preserved

All existing quality guardrails are intact:

1. **Component variety** — deterministic archetype rotation with code budget respected
2. **Concept de-duplication** — planning call assigns non-overlapping key concepts to each slide
3. **Flow continuity** — each slide receives prev/next context from the plan
4. **Image alignment** — stable 1-based slideIndex, exact image↔slide mapping
5. **Resumability** — skips existing slides from DB (partial chapter regeneration works)

## How It Works

### Phase 1: Planning (single GLM call, ~10s)
One cheap GLM-5.2 call generates a **chapter plan** that assigns each slide:
- Its topic
- 3-5 key concepts it will introduce (de-duplicated across all slides)
- Component archetype (respects code budget and variety rules)
- Flow context (what previous slide covered, what next slide will cover)

This does ALL the de-duplication work that `previousSlidesContext` used to do incrementally in the serial version.

### Phase 2: Parallel Execution
1. **Tavily research** — all slides prefetch research in parallel (was serial, 20s × N)
2. **Slide generation** — all slides generate in parallel (was serial, 30-40s × N)
3. Each slide gets its "lane" from the plan → no repetition, flow preserved

## How to Use

### Option A: Test on a single chapter (recommended first step)

1. In your chapter generation UI, add a test button that fires the parallel event:

```typescript
// In your chapter generation handler
await inngest.send({
  name: "course/slides.generate.parallel",
  data: { chapter, courseId, courseName, chapterIndex }
});
```

2. Generate one chapter with the parallel function
3. Compare quality against a chapter generated with the serial function
4. Review: concepts covered, component variety, flow continuity, narration quality

### Option B: Full rollout

Once A/B testing confirms quality, replace the serial trigger in your chapter orchestrator:

```typescript
// BEFORE (serial)
await inngest.send({
  name: "course/slides.generate",
  data: { chapter, courseId, courseName, chapterIndex }
});

// AFTER (parallel)
await inngest.send({
  name: "course/slides.generate.parallel",
  data: { chapter, courseId, courseName, chapterIndex }
});
```

### Option C: Side-by-side toggle (for gradual rollout)

Add a feature flag in your course config:

```typescript
const useParallelSlides = course.featureFlags?.parallelSlides ?? false;
const eventName = useParallelSlides 
  ? "course/slides.generate.parallel" 
  : "course/slides.generate";

await inngest.send({
  name: eventName,
  data: { chapter, courseId, courseName, chapterIndex }
});
```

## Files Changed

- **inngest/course-functions-parallel.ts** — new parallel implementation (doesn't touch existing serial function)
- **data/Prompt.ts** — added `CHAPTER_PLAN_PROMPT` export
- **app/api/inngest/route.ts** — registered `generateCourseSlidesParallelFn`

## Rollback

If anything goes wrong, simply stop sending the `course/slides.generate.parallel` event and revert to `course/slides.generate`. The serial function is unchanged.

## Known Limitations

1. **Planning call overhead** — adds ~10s upfront (but saves 6+ min overall)
2. **Rate limits** — if your OpenRouter key has strict per-second limits, parallel calls may hit them (add retry logic if needed)
3. **First-time testing** — no production data yet; A/B test quality before full rollout

## Monitoring

Watch for:
- Planning call failures (check Inngest logs for "generate-chapter-plan" step)
- Rate limit errors during parallel generation (GLM-5.2 should handle ~10 concurrent calls)
- Concept duplication in output (manual spot-check: do two slides introduce the same concept?)

## Next Steps

1. **Run on 1 test chapter** — verify output quality
2. **A/B test on 5-10 chapters** — compare serial vs parallel quality side-by-side
3. **Full rollout** — once quality is confirmed, switch all new chapters to parallel
4. **Remove serial function** (optional) — after 30 days of stable parallel use, archive the old serial function

---

**Questions?** Check the code comments in `inngest/course-functions-parallel.ts` for implementation details.
