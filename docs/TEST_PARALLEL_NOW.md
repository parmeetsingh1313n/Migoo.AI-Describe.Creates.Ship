# Quick Test Guide: Parallel Slide Generation

## How to Test Right Now

### Option 1: Use the Test UI (Easiest)

1. **Start your dev server** (if not already running):
   ```bash
   npm run dev
   ```

2. **Navigate to the test page**:
   ```
   http://localhost:3000/test-parallel
   ```

3. **Get a course ID and chapter ID**:
   - Go to your course dashboard: `http://localhost:3000/course/[courseId]`
   - Open browser DevTools → Network tab
   - Refresh the page
   - Look for API calls like `/api/course?courseId=...` or `/api/chapter-status?courseId=...`
   - Copy the `courseId` and `chapterId` from the URLs or response JSON

4. **Paste the IDs into the test form and click "Trigger Parallel Generation"**

5. **Watch the progress**:
   - Check your terminal/console for logs like:
     ```
     🚀 [Ch1||] SLIDES (PARALLEL): course-xxx — Chapter Title
     🗺️ [Ch1||] Generating chapter plan via GLM...
     ✅ [Ch1||] Plan ready: 9 slides, concepts de-duplicated
     🔍 [Ch1||] Prefetching Tavily research for 9 slides...
     ✅ [Ch1||] Research prefetched for 9 slides
     🎬 [Ch1||] Generating 9 slides in parallel...
     ✅ [Ch1||] All 9 slides generated in parallel
     ```
   - Or check your Inngest dashboard if you have one configured

### Option 2: Use the API Directly

```bash
curl -X POST http://localhost:3000/api/test-parallel-slides \
  -H "Content-Type: application/json" \
  -d '{
    "courseId": "your-course-id",
    "chapterId": "your-chapter-id"
  }'
```

## What to Compare

After the parallel generation completes:

### Speed ✅
- **Serial version**: ~7 minutes per chapter
- **Parallel version**: ~1 minute per chapter

### Quality (manual spot-check) ✅
1. **Component variety**: Do slides use different archetypes? (not all the same layout)
2. **Concept de-duplication**: Does each slide introduce unique concepts? (no repetition)
3. **Flow continuity**: Does narration flow smoothly from one slide to the next?
4. **Image alignment**: Do images match their slides correctly? (check slideIndex)
5. **Code budget**: Are there ~3 code slides max? (not too many code-heavy slides)

## Test Scenarios

### Scenario 1: Fresh Chapter (no existing slides)
- Use a chapter that hasn't been generated yet
- Full parallel generation from scratch
- **Expected time**: ~1 minute

### Scenario 2: Partial Chapter (some slides exist)
- Use a chapter with 2-3 slides already in DB
- Should skip existing slides, generate remaining ones in parallel
- **Expected time**: ~30-40 seconds (fewer slides)

### Scenario 3: Complete Chapter (all slides exist)
- Use a fully-generated chapter
- Should skip immediately
- **Expected time**: <5 seconds

## Rollback Plan

If anything goes wrong:

1. **Stop using the test endpoint** — just don't call `/api/test-parallel-slides`
2. **The serial version is still the default** — all existing workflows unchanged
3. **No database corruption risk** — both versions write to the same schema, fully compatible

## After Testing

Once you're satisfied with quality:

1. **Update your chapter generation handler** to use the parallel event:
   ```typescript
   // In your chapter orchestration code
   await inngest.send({
     name: "course/slides.generate.parallel",  // ← changed from "course/slides.generate"
     data: { chapter, courseId, courseName, chapterIndex }
   });
   ```

2. **Remove the test endpoint** (optional cleanup):
   - Delete `app/api/test-parallel-slides/route.ts`
   - Delete `app/test-parallel/page.tsx`

3. **Monitor production** for 1-2 days, then archive the serial function if all is well

## Troubleshooting

### "Module not found" errors
- Run `npm install` to ensure all dependencies are installed
- Restart your dev server

### "Plan returned invalid structure"
- Check OpenRouter API logs for the planning call
- GLM-5.2 should return a JSON array of slide plans
- If it's returning markdown, the prompt may need tweaking

### Rate limit errors
- GLM-5.2 can handle ~10 concurrent requests
- If you have a strict rate limit, add retry logic or reduce concurrency

### Quality issues (repetition/broken flow)
- Check the plan output in logs
- Verify concepts are actually de-duplicated
- May need to tune the planning prompt

---

**Ready to test!** Go to http://localhost:3000/test-parallel and trigger your first parallel generation.
