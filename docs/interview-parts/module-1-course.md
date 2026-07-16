## Module 1 — Course Generator

### 1. One-line purpose & end-to-end user journey

**Purpose:** Turn a single topic string into a complete, multi-chapter video course — AI writes the curriculum, designs animated reveal.js slides, narrates them with TTS, lets the user review/edit, then renders each chapter to a real cinematic MP4 on GitHub Actions and streams it back.

**End-to-end user journey:**
1. On the landing page (`app/_components/Hero.tsx`) the user types a topic, picks a `type` (course/video/tutorial/article) and a narrator **voice**, and hits send. A `courseId` is minted client-side with `crypto.randomUUID()`.
2. `POST /api/generate-course-layout` calls an LLM to produce the whole **course config** (8–15 chapters, each with 6–8 `subContent` learning objectives), saves it to `coursesTable`, fires thumbnail generation in the background, and redirects to `/course/{courseId}`.
3. The course page (`app/(routes)/course/[courseId]/`) shows chapters (`CourseChapters.tsx`). The user can edit each chapter's outline (`OutlineCockpit.tsx` → `PATCH /api/course-layout`), then trigger generation. This fires **images** (`/api/generate-images`) and **Phase 1 slides** (`/api/generate-video-content`) as background Inngest jobs.
4. Inngest generates per-slide **HTML + narration** and parks the chapter at status `review:slides` (a human-approval gate). The user reviews/edits slides and narration in the **Studio review cockpit** (`StudioReviewCockpit.tsx`) — regenerating single slides (`/api/regenerate-slide`) or polishing narration (`/api/enhance-narration`).
5. On approval, `/api/approve-slides` fires **Phase 2 audio**: Sarvam TTS synthesizes narration, generates instant captions + a fragment timeline, and marks the chapter `completed`.
6. The user previews the chapter in-browser (reveal.js live preview / Remotion player) and then hits **Download**: `/api/render-chapter` dispatches a **GitHub Actions** job that renders each slide with Puppeteer + FFmpeg into a cinematic MP4, uploads it (GitHub Release or Appwrite), and posts progress + completion back via `/api/render-chapter-callback`. The MP4 streams back through `/api/download-chapter/[chapterId]`.

---

### 2. Tech stack used in this module

| Concern | Technology |
|---|---|
| App framework | **Next.js 16** (App Router, route handlers, RSC) |
| Auth | **Clerk** (`currentUser()`, ownership guards on every mutating route) |
| Durable background jobs | **Inngest** (`step.run` orchestration, concurrency limits, event fan-out) |
| LLMs | **OpenRouter** — `mistralai/mistral-large-3-675b` (course layout), `z-ai/glm-5.2` (slides, topic expansion, regen) |
| RAG grounding | **Tavily** (`fetchSlideResearch`) — live web facts per slide |
| TTS | **Sarvam AI** (`bulbul:v3`, `en-IN`, MP3 output, multi-key rotation) |
| Slides engine | **reveal.js** (self-hosted `/public/reveal`) + KaTeX, Mermaid, Chart.js, mark.js, Typed.js |
| Rendering | **Puppeteer** (headless Chrome screenshots) + **FFmpeg** (`ffmpeg-static`, H.264/AAC) |
| Compute for render | **GitHub Actions** (`repository_dispatch`, ubuntu-latest, 120-min timeout) |
| Images | Nano-Banana / Apify image providers (`generateNanoBananaImagesParallel`) |
| Blob storage | **Appwrite** Storage (`putWithRotation`, multi-project key rotation) + GitHub Releases for large MP4s |
| DB | **Neon Postgres** via **Drizzle ORM** (+ a legacy Neon DB read-fallback) |
| In-browser preview | **Remotion** player wrapping the reveal.js deck (`ChapterVideo.tsx`) |

---

### 3. Pipeline, stage by stage (exact file + function)

**Stage 0 — Course config**
`app/api/generate-course-layout/route.ts` → `POST`. Validates input (Zod), calls `openrouter.json(COURSE_CONFIG_PROMPT, userInput, { model: "mistralai/mistral-large-3-675b-instruct-2512" })`, validates the chapter/subContent shape, inserts into `coursesTable`, and fires `/api/generate-thumbnail` fire-and-forget.

**Stage 1 — Images (per slide, in parallel)**
`inngest/course-functions.ts` → `generateCourseImagesFn` (event `course/images.generate`). Expands each chapter's `subContent` via `expandChapterTopics()`, computes a **global slide index** `chIdx * MAX_SLIDES_PER_CHAPTER + slideIdx` (25) so each slide maps 1:1 to its own image, generates in batches of 6, uploads webp to Appwrite, inserts into `courseImages`, then runs a **retroactive injection pass** to replace `{{IMAGE_PLACEHOLDER}}` tokens in any slides already written.

**Stage 2 — Slide generation (Phase 1, gated)**
`generateCourseSlidesFn` (events `course/slides.generate` + legacy `course/video-content.generate`; `concurrency: { limit: 2 }`). For each slide it:
- Expands topics (`expandChapterTopics`) — 1–3 slide topics per subContent point, each flagged `needsCode`.
- Picks the **archetype**: `pickArchetype(chapterIndex, si)` deterministic rotation, overridden by a **topic-aware code decision** bounded by `codeSlideBudget(totalSlides)` (~40%), swapping in `pickNonCodeArchetype` when over budget.
- Builds `usedComponents` (dedupe non-code layouts so no chapter repeats a component).
- Fetches Tavily research, calls `openrouter.json(GENERATE_SINGLE_SLIDE_PROMPT, …, { model: "z-ai/glm-5.2" })` with 3 retries.
- Injects images by global index, persists HTML + `narration` (with `fragments`) + `revealData` to `chapterContentSlides`, updates progress, and finally parks the chapter at `review:slides`. **No audio yet.**

**Stage 3 — Screening-room review**
`StudioReviewCockpit.tsx`. User edits narration, regenerates one slide (`/api/regenerate-slide` → same `GENERATE_SINGLE_SLIDE_PROMPT` + change request), or enhances narration (`/api/enhance-narration`). Approval calls `/api/approve-slides` (ownership-guarded) → emits `course/audio.generate`.

**Stage 4 — TTS + captions + fragment timeline (Phase 2)**
`generateCourseAudioFn` (event `course/audio.generate`). Loads the (possibly edited) slides, synthesizes MP3 via `generateTTSAudio()` (Sarvam, sticky key rotation), measures duration with `getMp3Duration()` (parses the MPEG frame header — no ffprobe), builds **instant captions** with `generateCaptionsFromNarration()` (narration text + duration → word timestamps, replacing the old slow STT batch job), and builds the **fragment timeline** with `buildFragmentTimeline()` (each fragment's `[start,end]` = its word-share of the audio). Uploads MP3 to Appwrite, persists `audioUrl/audioDuration/captions`, marks `completed`.

**Stage 5 — Cinematic render on GitHub Actions**
`app/api/render-chapter/route.ts` → `POST`. If `isGitHubActionsMode()` (GH_PAT/OWNER/REPO set), `dispatchToGitHub()` sends a `repository_dispatch` (`event_type: "render-chapter"`) with a `fetchUrl` + `webhookUrl`; DB set to `rendering:video`. The workflow `.github/workflows/render-chapter.yml` runs `scripts/render-chapter-gh.js`, which **fetches slide data** back from `GET /api/render-chapter?...&fetchData=true` (auth'd by the Appwrite key).

**Two render engines** live in `render-chapter-gh.js`:
- **Frozen-screenshot engine** — `captureRevealDeckStates()`: for each reveal interval, calls `window.__deck.slide(0,0,fragmentIndex)`, screenshots once, and FFmpeg loops each still with a cross-fade (`makeClip`). Fast; used for legacy `data-reveal` slides or when `CINEMATIC=0`.
- **Cinematic engine** — `captureRevealDeckCinematic()`: frame-steps `window.__seekTo(t)` at 30 fps, screenshots every frame, encodes the PNG sequence with audio (`encodeFrameSequence`). Deterministic and smooth regardless of runner speed.

The **cinematic director** (`CINEMATIC_DIRECTOR_SCRIPT` in `lib/reveal-doc.ts`, inlined into the CI script) is the "camera": at time `t` it reveals fragments up to `t` (marks the newest `.cine-active`, older ones dimmed `.cine-spoken`), and eases an **eyeball camera** transform on a `#cine-camera` wrapper so the currently-narrated fragment fills the frame — using `__cineTimeline` (the fragment timeline from Stage 4) to know what's spoken when. It also drives `__scrollCodeToProgress` for auto-scrolling code cards.

**Stage 6 — Appwrite upload / GitHub Release**
`scripts/upload-chapter-render.js`: prefers **GitHub Release** upload (up to 2GB); falls back to Appwrite. Large files are pre-split by the render script into **44MB raw-binary chunks** (byte-split, not FFmpeg segments — preserves the single correct MP4 header). Metadata JSON (chunk IDs) is stored as `videoUrl`, then posts `completed` to the callback.

**Stage 7 — Streaming download**
`/api/render-chapter-callback/route.ts` writes `renderStatus/renderProgress/videoUrl`. `/api/download-chapter/[chapterId]/route.ts` streams: local file, chunked Appwrite (concatenating raw chunks on the fly → browser gets exact original bytes → correct full duration), or a direct redirect. `/api/stream-video/[videoId]` adds HTTP **Range** support for seeking.

---

### 4. File-by-file table

| File | What it does | Why it exists |
|---|---|---|
| `app/_components/Hero.tsx` | Topic/type/voice input; `POST /api/generate-course-layout`; routes to course page | Course-creation entry point |
| `app/api/generate-course-layout/route.ts` | LLM course config (Mistral-large) → `coursesTable`; fires thumbnail | Stage 0 — curriculum |
| `app/api/course/route.ts` | Fetch course + its slides (with legacy-DB fallback) | Reads course/slide data for the viewer |
| `app/api/course-layout/route.ts` | `PATCH` a chapter's `subContent` in the layout JSON | Persists Outline Editor edits pre-generation |
| `app/api/generate-images/route.ts` | Thin dispatcher → `course/images.generate` | Non-blocking image kickoff |
| `app/api/generate-thumbnail/route.ts` | Dispatcher → `course/thumbnail.generate` | Course cover image |
| `app/api/generate-video-content/route.ts` | Dispatcher → `course/slides.generate` (Phase 1) | Non-blocking slide kickoff |
| `app/api/approve-slides/route.ts` | Ownership-guarded → `course/audio.generate` (Phase 2) | The human review→audio gate |
| `app/api/regenerate-slide/route.ts` | Regenerate ONE slide from a change request (same prompt + archetype logic) | Per-slide editing in review |
| `app/api/enhance-narration/route.ts` | LLM polish of narration text | ✨ Enhance button in cockpit |
| `app/api/chapter-status/route.ts` | Poll per-chapter status; mismatch + stale-render auto-reset | Drives live progress UI |
| `app/api/render-chapter/route.ts` | Dispatch render to GitHub Actions (or local FFmpeg); GET `fetchData` feeds slides to CI; GET poll; DELETE reset | Render orchestrator + both engines' Vercel-side twins |
| `app/api/render-chapter-callback/route.ts` | Receives progress/completed/failed from CI → DB | Webhook sink |
| `app/api/download-chapter/[chapterId]/route.ts` | Streams MP4 (local / raw-chunk concat / redirect) | Final delivery |
| `app/api/stream-video/[videoId]/route.ts` | Range-request video streaming (seeking) | In-app playback |
| `inngest/client.ts` | Inngest client (`id: ai-video-course-generator`) | Event bus config |
| `inngest/course-functions.ts` | **Core orchestrator** — thumbnail, images, slides (Phase 1), audio (Phase 2) functions + all TTS/caption/timeline helpers | The heart of the pipeline |
| `inngest/functions.ts` | Shorts/other Inngest fns + shared MP4 duration prober | Sibling module (shared TTS patterns) |
| `data/Prompt.ts` | `COURSE_CONFIG_PROMPT`, `EXPAND_CHAPTER_TOPICS_PROMPT`, `GENERATE_SINGLE_SLIDE_PROMPT` | All LLM instructions |
| `data/slide-design.ts` | `SLIDE_ARCHETYPES`, `pickArchetype`, `codeSlideBudget`, `isLikelyCodeTopic`, etc. | Single source of truth for slide variety |
| `lib/reveal-doc.ts` | Shared reveal.js wrapper, init script, `CINEMATIC_DIRECTOR_SCRIPT`, `COMPONENT_STYLESHEET` | One engine for preview + render |
| `scripts/render-chapter-gh.js` | Standalone Puppeteer+FFmpeg renderer (both engines), raw-chunk split | Runs inside GitHub Actions |
| `scripts/upload-chapter-render.js` | Upload MP4 to GitHub Release/Appwrite + webhook | CI upload step |
| `.github/workflows/render-chapter.yml` | `repository_dispatch` workflow: install, render, upload, notify | Off-Vercel render compute |
| `config/schema.tsx` | `coursesTable`, `courseImages`, `chapterContentSlides`, `chapterGenerationStatus` | DB tables |
| `app/(routes)/course/[courseId]/_components/*` | `CourseChapters` (orchestration/polling), `OutlineCockpit` (outline edit), `StudioReviewCockpit` (review), `ChapterVideo` (Remotion+reveal.js preview) | Course UI |

---

### 5. Interview-relevant code snippets

**a) `pickArchetype` — deterministic, non-repeating slide layouts** (`data/slide-design.ts`)
```ts
export function pickArchetype(chapterIndex: number, si: number): string {
    if (si === 0) return SLIDE_ARCHETYPES[0]; // INTRO is always a COVER
    const n = SLIDE_ARCHETYPES.length;
    const STRIDE = 8;                    // co-prime with the catalog length (35)
    const offset = 1 + chapterIndex * 3; // each chapter starts elsewhere
    let idx = (offset + si * STRIDE) % n;
    if (idx === 0) idx = 1;              // never reuse COVER mid-chapter
    return SLIDE_ARCHETYPES[idx];
}
```
*A co-prime stride visits every layout, so no two slides in a chapter repeat and different chapters never share a sequence — no ML, pure arithmetic.*

**b) `codeSlideBudget` — cap code cards per chapter** (`data/slide-design.ts`)
```ts
export function codeSlideBudget(totalSlides: number): number {
    return Math.max(1, Math.round(totalSlides * 0.4));
}
```
*Without a cap, a programming chapter collapsed into wall-to-wall code cards; this keeps ≤40% code so diagrams/charts/steppers still appear.*

**c) The code-budget override loop** (`inngest/course-functions.ts`, `generateCourseSlidesFn`)
```ts
const naturalArchetype = pickArchetype(chapterIndex, si);
const wantsCode = chapterTopics[si]?.needsCode ?? false;
const codeSlidesSoFar = slidesData.filter(s => isCodeArchetype(s.archetype ?? "")).length;
const codeBudgetLeft = codeSlidesSoFar < codeSlideBudget(totalSlides);
let archetype = naturalArchetype;
if (wantsCode && codeBudgetLeft && !isCodeArchetype(naturalArchetype)) {
    archetype = SLIDE_ARCHETYPES.filter(isCodeArchetype)[codeSlidesSoFar % /*…*/];
} else if (isCodeArchetype(naturalArchetype) && (!wantsCode || !codeBudgetLeft)) {
    archetype = pickNonCodeArchetype(chapterIndex, si); // swap code out
}
```
*Forces code when a topic needs it AND budget remains; otherwise swaps it out for visual variety.*

**d) `buildFragmentTimeline` — audio-synced camera signal** (`inngest/course-functions.ts`)
```ts
function buildFragmentTimeline(fragments, audioDurationSec) {
    const counts = fragments.map(f => Math.max(1, (f.text ?? "").split(/\s+/).filter(Boolean).length));
    const totalWords = counts.reduce((a, b) => a + b, 0);
    const secPerWord = audioDurationSec / totalWords;
    let cursor = 0;
    return fragments.map((f, i) => {
        const start = cursor; cursor += counts[i] * secPerWord;
        const end = i === fragments.length - 1 ? audioDurationSec : cursor;
        return { index: f.index ?? i, startSec: +start.toFixed(3), endSec: +end.toFixed(3) };
    });
}
```
*Each fragment's on-screen window = its share of the spoken words — this is what the render camera reads to know which fragment is being narrated at time `t`.*

**e) Instant captions from narration (no STT)** (`inngest/course-functions.ts`)
```ts
const secPerWord = audioDurationSec / wordTexts.length;
const words = wordTexts.map((text, i) => ({
    text, start: +(i*secPerWord).toFixed(3), end: +((i+1)*secPerWord).toFixed(3),
}));
const chunks = wordsToChunks(words); // group 2-5 words on pauses/punctuation
```
*We already have the exact narration text, so word-level timings are estimated from duration instantly — replacing a 30–60s-per-slide Sarvam batch STT job (the old #1 bottleneck).*

**f) Idempotent `step.run` structure** (`inngest/course-functions.ts`)
```ts
const existingSlides = await step.run("check-existing-slides", async () =>
    db.select().from(chapterContentSlides).where(eq(chapterContentSlides.chapterId, chapterId)));
// …
const slideResult = await step.run(`generate-slide-${si}`, async () => {
    const existing = existingSlides.find(s => s.slideIndex === si + 1);
    if (existing) return { /* reuse from DB */ };   // skip re-generation on retry
    /* …LLM call + db.insert(...).onConflictDoUpdate(...) … */
});
```
*Each expensive unit is its own named `step.run`. Inngest memoizes completed steps, so a retry re-runs only the failed step — and each step also DB-checks for existing work, giving two layers of dedup.*

**g) The cinematic `__seekTo` director** (`lib/reveal-doc.ts` / inlined in `render-chapter-gh.js`)
```ts
window.__seekTo = function (t) {
    ensureCamera();
    const activeOrd = applyReveals(t);          // reveal fragments up to time t
    if (window.__scrollCodeToProgress) window.__scrollCodeToProgress(t / duration());
    const cur = tl[activeOrd], prev = tl[activeOrd - 1] ?? cur;
    const into = (t - cur.startSec) / (cur.endSec - cur.startSec);
    const e = EASE(Math.min(1, into / DRAG));   // ease from prev framing → current
    const fCur = frameFor(fragmentRect(cur.index)), fPrev = frameFor(fragmentRect(prev.index));
    camera.style.transform = `translate(${lerp(fPrev.tx,fCur.tx,e)}px,${lerp(fPrev.ty,fCur.ty,e)}px) scale(${lerp(fPrev.s,fCur.s,e)})`;
};
```
*Animation is a pure function of time — the render frame-steps this, so output is deterministic and smooth at any fps (no dropped frames from real-time recording).*

**h) `frameFor` — how the eyeball decides zoom** (`lib/reveal-doc.ts`)
```ts
function frameFor(rect) {
    const w = rect.w + ZOOM_PAD*2, h = rect.h + ZOOM_PAD*2;
    let s = Math.min(VW/w, VH/h, MAX_ZOOM); if (s < 1) s = 1;  // fit rect, cap 1.9x
    const cx = rect.x + rect.w/2, cy = rect.y + rect.h/2;
    let tx = VW/2 - cx*s, ty = VH/2 - cy*s;                    // center on fragment
    tx = Math.min(0, Math.max(tx, VW - VW*s));                 // clamp to slide edges
    ty = Math.min(0, Math.max(ty, VH - VH*s));
    return { s, tx, ty };
}
```
*Zoom = the scale that makes the fragment (plus padding) fill 1440×720, capped at 1.9×; translate centers it and is clamped so the camera never shows empty space beyond the slide.*

**i) Sarvam TTS sticky key rotation** (`inngest/course-functions.ts`)
```ts
const startKeyIndex = activeSarvamKeyIndex;                 // module-level, sticky
for (let attempt = 0; attempt < keys.length; attempt++) {
    const ki = (startKeyIndex + attempt) % keys.length;
    // …fetch…
    if (isSarvamCreditError(res.status, body)) { activeSarvamKeyIndex = (ki+1)%keys.length; continue; }
    activeSarvamKeyIndex = ki; break;                       // lock the working key
}
```
*On 401/402/429/credit errors it rotates to the next `SARVAM_API_KEY_n` and remembers the winner so subsequent calls don't re-test exhausted keys.*

**j) Global slide index → 1:1 image mapping** (`inngest/course-functions.ts`)
```ts
const gIdx = chapterIndex * MAX_SLIDES_PER_CHAPTER + si;    // MAX = 25
slideContent.html = slideContent.html.replace(/\{\{IMAGE_PLACEHOLDER\}\}/g, () =>
    allImages.find(im => im.imageIndex === gIdx)?.imageUrl
        ?? allImages[(gIdx + extra++) % allImages.length].imageUrl); // round-robin fallback
```
*Images and slides are expanded independently; a stable global index gives each slide its own image, with round-robin cycling if the two expansions ever drift.*

**k) Raw-binary MP4 chunking** (`scripts/render-chapter-gh.js`)
```js
// Split raw bytes (like splitting a zip) — NOT the FFmpeg segment muxer, which
// would create independent MP4 containers each with their own duration header.
const CHUNK_SIZE_BYTES = 44 * 1024 * 1024;       // stay under Appwrite 50MB
// …read/write byte ranges into chunk-000.bin, chunk-001.bin…
```
*On download, chunks are streamed back-to-back so the browser reassembles the exact original bytes → the one correct 42-minute header → plays in full.*

**l) Foreign-script / TTS sanitizer guard** (`inngest/course-functions.ts`, `sanitizeForTTS`)
```ts
.replace(/\.{2,3}/g, '.')     // collapse ellipses — stop TTS from pausing/stretching
.replace(/\(.*?\)/g, '')      // drop parenthetical asides — they confuse pacing
.replace(/:\s/g, '. ')        // colons/semicolons → periods for clean breaks
.replace(/—/g, ', ')          // em/en-dash → comma
```
*Strips HTML, markdown, zero-width chars and problem punctuation before Sarvam TTS so the narrator doesn't mispace or choke on symbols.*

---

### 6. Likely interview Q&A

**Q1. Why Inngest instead of just doing the work in the API route?**
Slide+audio generation for a chapter is minutes of LLM/TTS calls — far past Vercel's serverless timeout. Inngest gives durable, retryable, **step-memoized** background execution: each `step.run` is checkpointed, so a crash resumes from the last completed step instead of redoing everything. It also provides `concurrency: { limit: 2 }` to cap parallel chapters, event fan-out (one course → many chapter events), and observability. The API routes are thin dispatchers that just `inngest.send(...)` and return `202`.

**Q2. Why render on GitHub Actions instead of Vercel?**
Rendering needs headless **Chrome (Puppeteer) + FFmpeg**, hundreds of PNG screenshots per slide, and 30–60 minutes of CPU for a long chapter — none of which fit Vercel's serverless model (no persistent Chrome, short timeouts, no large disk). GitHub Actions gives a full ubuntu runner with a 120-min budget, free compute, native FFmpeg, and 2GB Release uploads. Vercel just dispatches (`repository_dispatch`), serves slide data back, and receives webhook callbacks. There's also a local FFmpeg fallback path in `render-chapter/route.ts` for dev.

**Q3. How is audio synced to slides in the rendered video?**
Two-part. In Phase 2, `buildFragmentTimeline()` computes each on-screen fragment's `[startSec,endSec]` as its **word-share** of the measured audio duration and stores it in `captions.fragmentTimeline`. During render, the cinematic director reads that timeline via `window.__cineTimeline`; `__seekTo(t)` reveals exactly the fragments whose window has started and eases the camera to the active one — so what's on screen tracks what's spoken. FFmpeg then muxes the slide's MP3 against the frame sequence at the same duration.

**Q4. How do you prevent duplicate work on retries?**
Two layers. (1) Inngest memoizes completed `step.run` steps by name, so a retried run skips finished steps. (2) Every step also checks the DB first — `check-existing-slides` reuses rows, audio has a fast-path (`if (slide.audioUrl && slide.captions && slide.audioDuration) return slide`), images skip when count ≥ planned, and all inserts use `onConflictDoUpdate`/`onConflictDoNothing` keyed on `slideId`/`imageIndex`. Thumbnails/renders check for an existing Appwrite URL before regenerating.

**Q5. How does the eyeball camera decide how much to zoom?**
`frameFor(rect)` computes `scale = min(VW/paddedW, VH/paddedH, MAX_ZOOM=1.9)`, clamped to ≥1 (never zoom *out*). It translates to center the fragment's bounding rect, then clamps `tx/ty` so the view never spills past the slide edges. It eases from the previous fragment's framing to the current one over `DRAG=0.55` of the fragment window using a cubic in-out. (Note: the dense-slide font gate exists but is currently disabled — the eyeball runs on all slides.)

**Q6. Why the two-phase (slides → review gate → audio) split?**
TTS is the expensive, least-reversible step. Generating slides + narration first and parking at `review:slides` lets the user fix hallucinations, regenerate a bad slide, or edit narration **before** paying for audio. Only `/api/approve-slides` fires `course/audio.generate`, which loads the possibly-edited slides from the DB. It decouples cheap iteration from expensive synthesis.

**Q7. Why raw-binary chunking instead of FFmpeg's segment muxer for large videos?**
Appwrite caps files at 50MB. FFmpeg's `-f segment` would produce independent MP4 containers, each with its own duration header — concatenating them on download gives the browser a wrong (short) duration. Splitting the *raw bytes* into 44MB chunks and streaming them back-to-back reconstructs the exact original file, so the single correct header (full duration) is preserved and the whole video plays and seeks correctly.

**Q8. How do you keep 20+ slides in a chapter from all looking the same?**
`data/slide-design.ts` is the single source of truth shared by the bulk pipeline and the single-slide regen route. `pickArchetype` uses a co-prime stride so no layout repeats within a chapter and chapters don't share sequences; the prompt is fed `doNotReuseComponents` (used non-code layouts) as a hard "forbidden" list; and `SLIDE_TYPE_PAIRS`/`SLIDE_ACCENTS` rotate fonts and accent colors. Code slides are exempt (a chapter legitimately needs several) but bounded by `codeSlideBudget`.

**Q9. How is the live preview kept identical to the rendered video?**
Both go through the **same reveal.js engine** via `lib/reveal-doc.ts` (`revealAssetTags`, `wrapInRevealDeck`, `REVEAL_INIT_SCRIPT`, `COMPONENT_STYLESHEET`) using self-hosted assets in `/public/reveal` (so Puppeteer never races a CDN). The render script inlines the exact same `CINEMATIC_DIRECTOR_SCRIPT` and companion-lib bootstrap (Mermaid/KaTeX/Chart.js/mark.js) — the code comments explicitly say "KEEP IN SYNC with lib/reveal-doc.ts."

**Q10. What happens if TTS or image providers fail mid-course?**
They're treated as **non-fatal enhancements** where possible: thumbnail failure logs and continues (`skipped:true`); failed images leave `{{IMAGE_PLACEHOLDER}}` for a later retroactive injection pass; topic expansion falls back to 1:1 subContent mapping. TTS is the exception — if *all* Sarvam keys are exhausted for a chunk it throws (with a "add SARVAM_API_KEY_n" hint) so Inngest retries. Stale renders (`rendering:video` with no update >60min) are auto-reset to `idle` in both the status and render GET routes.
