# Migoo — Interview Study Guide

> A complete, code-accurate walkthrough of the Migoo codebase: architecture, all 5 product
> modules, and the shared foundation — with pipelines, file-by-file breakdowns, real code
> snippets, and likely interview Q&A. Everything here was written from a direct read of the
> source. Study the **How to drive the interview** and **Cross-cutting cheat-sheet** sections
> first; they let you answer almost any question by mapping it back to a few recurring ideas.

---

## 0. How to drive the interview

### 60-second elevator pitch
> "Migoo is a full-stack AI video-creation platform built on **Next.js 16**. It has **five
> product modules** — a Course Generator, a Short-Video Generator, a Motion-Graphics
> Generator, a Notes Generator, and a director's-chair Studio — sitting on one shared
> foundation: **Clerk** auth, **Neon Postgres + Drizzle**, and **Inngest** durable background
> jobs. The core engineering pattern is *thin API routes that validate and enqueue, and durable
> Inngest step-functions that do the minutes-long AI work with automatic retries and per-step
> memoization*. The heaviest render — turning slides or scenes into an MP4 with Puppeteer/FFmpeg
> or Remotion — is pushed off to **GitHub Actions**, because that work doesn't fit Vercel's
> serverless limits. Across all modules I built a **multi-provider LLM router** with model + key
> failover, JSON-repair, and a non-English-script guard, so flaky model output becomes reliable
> structured data."

### The map of the repo (say this to orient any question)
- `app/` — Next.js App Router: `api/**` route handlers (thin) + one folder per module UI.
- `inngest/` — the durable pipelines (`course-functions.ts`, `functions.ts`). **This is where the real work lives.**
- `config/` — `db`, `schema` (10 tables), and the LLM/TTS clients (`openrouter.ts` = the router).
- `lib/` — shared utilities: `api-helpers`, `validations`, `rate-limit`, `blob` (storage), `reveal-doc` (slides engine), provider libs.
- `data/` — `Prompt.ts` (all LLM prompts), `slide-design.ts` (slide archetypes).
- `remotion/` — programmatic video compositions (motion graphics + shorts).
- `scripts/` — the GitHub-Actions render scripts (`render-chapter-gh.js`, `upload-*.js`).

### If you only memorize five things
1. **Inngest durability** — `step.run()` is checkpointed + memoized; retries resume, they don't restart.
2. **The LLM router** (`config/openrouter.ts`) — 3-model × up-to-10-key failover, 6-strategy JSON repair, `findForeignScript` CJK/Cyrillic guard.
3. **Render off-Vercel** — Puppeteer/FFmpeg/Remotion on GitHub Actions via `repository_dispatch` + webhook callbacks.
4. **Idempotency** — a stable `runId` from `event.id` + the `shortVideoProgress` unique index means paid external tasks are never duplicated on retry.
5. **JSON columns** — deeply-nested, shape-volatile LLM output lives in `json()` columns; typed columns hold status/ids/urls.

---

## 1. System architecture

```
Browser  (Clerk session cookie)
  ▼
middleware.ts ── Clerk auth.protect() + IP rate-limit (60/min) + CSRF origin check
  ▼
app/api/**/route.ts ── zod validate → DB (Drizzle→Neon) → inngest.send({name,data}) → 202
  ▼
Inngest cloud ── POST /api/inngest ── runs durable step.run() functions
     ├─ config/openrouter.ts (LLM router → NVIDIA NIM / Groq / Gemini)
     ├─ config/sarvam.ts (TTS/STT)
     ├─ lib/apify-image.ts / apify-video.ts (image + image-to-video)
     ├─ lib/blob.ts (Appwrite Storage, key rotation)
     └─ lib/video-render.ts → GitHub Actions (Remotion / Puppeteer+FFmpeg) → webhook callback
  ▼
DB rows updated with status; client polls status endpoints; user downloads the MP4/PNG/PDF
```

**Request lifecycle in one sentence:** a request is authed + rate-limited + CSRF-checked in
`middleware.ts`, validated with Zod in a thin route handler, which either reads/writes the DB
directly (fast paths) or enqueues an Inngest event (slow AI work) and returns `202`; Inngest then
runs durable, retryable step-functions that call the AI providers and, for heavy renders, dispatch
a GitHub Actions job that uploads the result and calls a webhook back.

---

## 2. Cross-cutting "why" cheat-sheet

These decisions recur across modules — you can answer the same question in any module's context.

| Decision | Why (the answer) |
|---|---|
| **Inngest, not cron/queue** | Durable execution: each `step.run()` is checkpointed + memoized, so a retry resumes from the failed step instead of redoing minutes of work. Cron reruns everything; a raw queue lacks per-step memoization, concurrency limits, cancellation, observability. |
| **Render on GitHub Actions, not Vercel** | Puppeteer/Chromium + FFmpeg + Remotion need native binaries and 30–60 min CPU — impossible under Vercel's serverless limits. `next.config.ts` even excludes those packages from the bundle. Vercel dispatches + receives webhooks. |
| **Custom LLM router** | A single model+key call is ~70% reliable. The router adds 3-model × up-to-10-key failover, truncation-tolerant JSON repair, and a foreign-script guard → near-100%. Centralizes slide-quality prompt rules for every module. |
| **`findForeignScript` guard** | Multilingual models leak CJK/Cyrillic into English content; even valid JSON is then garbage. A recursive scan rejects it → next model. Defense-in-depth beyond the "English only" prompt. |
| **JSON columns** | LLM output is deeply nested and shape-volatile; normalizing means a migration per prompt change. Document-shaped payloads → `json()`; relational data (ids/status/urls/durations) → typed columns. |
| **Idempotency via `runId` + `shortVideoProgress`** | `runId` (from `event.id`) is stable across retries, unique per new run. Paid external tasks persist a row with a unique `(seriesId, stepKey)` index, so a retry reuses the task instead of re-charging. |
| **Neon serverless HTTP driver** | Ephemeral lambdas exhaust connection pools; Neon's connectionless HTTP driver fits serverless. `dbRetry()` absorbs cold-start timeouts. |
| **Key rotation everywhere** | Free-tier API keys hit rate/credit limits; rotating across `NVIDIA_API_KEY1..9` / `SARVAM_API_KEY_*` / `APIFY_TOKEN_1..10` keeps pipelines alive. Keys read fresh from `process.env` per call. |
| **Two-phase course gen (review gate)** | TTS is the expensive, least-reversible step. Generate slides + narration first, let the user fix them, and only synthesize audio on approval. |
| **Remotion vs reveal.js vs image-to-video** | Remotion = code-defined precise animations (motion graphics); reveal.js = document-style slides (courses); image-to-video = photoreal footage (shorts). Right engine per content type. |

### Highest-probability rapid-fire Q&A
- **"Walk me through what happens when a user creates a course."** → §Module 1, stages 0–7.
- **"How do you not pay twice for a video when a job retries?"** → `runId` + `shortVideoProgress` unique index (§Module 2 Q1).
- **"How is narration synced to what's on screen?"** → `buildFragmentTimeline` word-share → the `__seekTo` camera reads `__cineTimeline` (§Module 1 Q3).
- **"Your LLM returned broken JSON — what happens?"** → 6-strategy repair ladder + truncation salvage (§Shared Infra Q3).
- **"Why Inngest?"** → durable, memoized, retryable steps (§cheat-sheet).
- **"Why render on GitHub Actions?"** → native binaries + long CPU don't fit Vercel (§cheat-sheet).
- **"How do you keep 20 slides from looking identical?"** → `pickArchetype` co-prime stride + `doNotReuseComponents` (§Module 1 Q8).

---

## 3. The five modules + shared foundation

The full deep-dives follow. Each module section has: purpose & journey, tech stack, stage-by-stage
pipeline (exact files/functions), a file-by-file table, code snippets, and Q&A.


---

## Shared Infrastructure (Foundation for all 5 modules)

> This is the cross-cutting foundation layer that every product module — **Course Generator, Short Video Series, Motion Graphics, Notes Generator, and the Director's Chair Studio** — is built on top of. None of the code below belongs to a single feature; it's the plumbing (auth, DB, LLM routing, background jobs, storage, validation) that all five share.

### 1. The overall architecture

The app is a **Next.js 16 App Router** monolith deployed on Vercel, with heavy media rendering offloaded to GitHub Actions. Request lifecycle:

```
Browser
  │  (Clerk session cookie)
  ▼
middleware.ts ──► Clerk auth.protect() + IP rate-limit + CSRF origin check
  ▼
app/api/**/route.ts ──► zod validate (lib/validations) ──► DB read/write (Drizzle → Neon)
  │
  │  For anything slow (LLM generation, TTS, image gen, video render):
  ▼
inngest.send({ name, data }) ──► returns 202 immediately
  ▼
Inngest cloud ──► POST /api/inngest ──► runs durable step.run() functions
  │                                        ├─► config/openrouter.ts (LLM router) → NVIDIA/Groq/Gemini
  │                                        ├─► lib/blob.ts → Appwrite Storage (audio, images, MP4)
  │                                        └─► lib/video-render.ts → GitHub Actions (Remotion/Puppeteer/FFmpeg)
  ▼
DB rows updated with status; client polls status endpoints
```

| Concern | Technology | Where |
|---|---|---|
| Framework | Next.js 16 App Router, RSC + Client Components | `app/` |
| Auth | Clerk (`@clerk/nextjs`) | `middleware.ts`, `app/layout.tsx`, `app/api/user` |
| Database | Neon serverless Postgres + Drizzle ORM (HTTP driver) | `config/db.tsx`, `config/schema.tsx` |
| Background jobs | Inngest (durable, step-based) | `inngest/`, `app/api/inngest/route.ts` |
| LLM | Custom multi-provider router (NVIDIA NIM primary, Groq/Gemini fallbacks) | `config/openrouter.ts`, `config/groq.ts`, `config/gemini.ts`, `config/ai-fallback.ts` |
| TTS / STT | Sarvam AI | `config/sarvam.ts` |
| Storage | Appwrite Storage (kept Vercel-Blob interface) | `lib/blob.ts` |
| Web research (RAG) | Tavily + Wikipedia deep-crawl | `lib/tavily.ts`, `lib/web-search.ts` |
| Heavy video render | GitHub Actions + Remotion/Puppeteer/FFmpeg | `lib/video-render.ts` |
| Validation | Zod | `lib/validations.ts`, `lib/env.ts` |
| Testing | Vitest (node env) | `__tests__/`, `vitest.config.ts` |

**Why this shape:** Vercel serverless functions cap out (~300s), but generating a course/short takes many minutes across dozens of API calls. So the pattern is **thin fast API routes that validate + enqueue, and Inngest functions that do the long durable work** with retries. The ultra-heavy render (Remotion → MP4) is pushed to **GitHub Actions** because Remotion needs Puppeteer/Chromium + FFmpeg native binaries that don't fit Vercel (`next.config.ts` marks `@remotion/*`, `puppeteer`, `ffmpeg-static` as `serverExternalPackages`).

### 2. The LLM router — `config/openrouter.ts` (KEY interview topic)

The class is named `OpenRouterClient` and exported as `openrouter`, but it actually talks to **NVIDIA NIM's OpenAI-compatible endpoint** (`https://integrate.api.nvidia.com/v1`) — internally logs as "NvidiaAPI". It turns a flaky single-model/single-key call into a robust one.

**Model fallback chain (3 tiers):**
```ts
private model = 'z-ai/glm-5.2';                              // primary
private fallbackModel = 'nvidia/nemotron-3-ultra-550b-a55b'; // fallback 1
private lastFallbackModel = 'openai/gpt-oss-120b';           // fallback 2
```

**Key rotation** — keys read *fresh from `process.env` every call* (a restart with a new key is picked up immediately). Collects `NVIDIA_API_KEY` + `NVIDIA_API_KEY1..9`.

**Core fallback loop** — for each model, try *every* key; `429`/`402` (or empty `choices[]`) rotates key + retries same model; any other error breaks to next model:
```ts
for (const model of modelsToTry) {
  for (let keyAttempt = 0; keyAttempt < allKeys.length; keyAttempt++) {
    try {
      const { rawText, finishReason } = await this.callModel(/* ... */);
      const parsed = this.extractAndParseJSON(rawText, finishReason === 'length');
      if (this.findForeignScript(parsed)) throw new Error('Foreign-script leakage');
      return parsed;                       // ✅ success
    } catch (e) {
      if (e.isRateLimit) { this.rotateKey(); continue; } // same model, next key
      break;                                             // else next model
    }
  }
}
throw lastError;
```

**Truncation + JSON repair** — `extractAndParseJSON` runs a **6-strategy progressive ladder** (cheapest first): direct `JSON.parse` → deep char-level repair → HTML-quote fix → smart-quote escape → manual regex extraction → brute-force bracket matching. A pre-pass `fixLiteralNewlines` escapes literal newlines models emit inside HTML string values. If truncated (`finish_reason==='length'` or last char isn't `}`/`]`), `repairTruncatedJSON`/`extractCompleteSlides` salvages every *complete* object from a cut-off array.

**Foreign-script guard** — multilingual models (GLM-5.2) sometimes leak CJK/Cyrillic into an English course; even valid JSON is then garbage, so it's rejected and the next model tried:
```ts
private findForeignScript(parsed: any): string | null {
  const foreignScript = /[一-鿿぀-ヿ가-힯Ѐ-ӿ]/; // CJK, Kana, Hangul, Cyrillic
  const scan = (value, path) => {
    if (typeof value === 'string') return foreignScript.test(value) ? path : null;
    if (Array.isArray(value)) { for (let i=0;i<value.length;i++){ const h=scan(value[i],`${path}[${i}]`); if(h) return h; } return null; }
    if (value && typeof value === 'object') { for (const k of Object.keys(value)){ const h=scan(value[k], path?`${path}.${k}`:k); if(h) return h; } }
    return null;
  };
  return scan(parsed, '');
}
```
Defense-in-depth: the prompt says "ENGLISH ONLY", but the router *verifies the output* too.

**Sibling providers:** `config/groq.ts` (Groq Llama-3.3-70B, 8-strategy parser, `json_object` mode, `.text()`, vision `.captionImage()`), `config/gemini.ts` (Gemini 2.5 Flash structured-output + 4-strategy parser), `config/ai-fallback.ts` (thin wrapper, currently Groq-only), `config/sarvam.ts` (TTS/STT).

### 3. Data layer — Drizzle + Neon

```ts
// config/db.tsx
const sql = neon(env.DATABASE_URL);   // stateless HTTP — no pool
export const db = drizzle(sql);
```
**Why Neon HTTP driver:** serverless functions are ephemeral; a pool exhausts fast. Neon's connectionless HTTP driver is a perfect fit. A `dbRetry()` wrapper adds exponential backoff (1s→2s→4s) on retryable errors (timeout/ECONNRESET/fetch-failed). A read-only `dbLegacy` client points at an older Neon project for historical courses.

**Schema conventions** (`config/schema.tsx`): every table has `id: integer().primaryKey().generatedAlwaysAsIdentity()` plus an opaque public id (`courseId`/`seriesId`/`videoId`/`projectId`/`noteId`, `varchar.unique()`). `usersTable.email` is the tenancy root that other tables FK to. Heavy/variable-shape LLM output lives in `json()` columns (`courseLayout`, `narration`, `captions`, `scriptData`, `sceneData`, `remotionProps`, `theme`…) to avoid constant migrations. Status strings encode pipeline stages (`generating:slides | generating:audio | completed | failed`). `shortVideoProgress` has a unique index on `(seriesId, stepKey)` for idempotency.

### 4. Background jobs — Inngest

```ts
// inngest/client.ts
export const inngest = new Inngest({ id: "ai-video-course-generator",
  eventKey: process.env.INNGEST_EVENT_KEY || "local_dev_key" });
```
All functions registered at one serve endpoint (`app/api/inngest/route.ts`, `maxDuration = 300`): `generateShortVideo`, `generateShortSeriesThumbnailFn`, `generateMotionGraphic`, `renderMotionGraphicOnly`, `generateCourseThumbnailFn`, `generateCourseImagesFn`, `generateCourseSlidesFn`, `generateCourseAudioFn`, …

**Why Inngest over cron/queue:** durable execution — each `step.run("name", fn)` is checkpointed and memoized; on retry, completed steps are skipped and it resumes from the failure. A cron reruns everything; a raw queue gives delivery but no per-step memoization, retries, concurrency limits, cancellation, or observability. Inngest gives all of that declaratively (`concurrency`, `cancelOn`, `onFailure`, multiple `triggers`).

### 5. Auth + middleware + validation

Clerk. `app/layout.tsx` wraps in a provider; `app/provider.tsx` lazily upserts the signed-in user via `POST /api/user` (`currentUser()` server-side, upsert keyed on email). `middleware.ts` is the choke point — one `clerkMiddleware` doing three jobs: (1) **auth** via a `createRouteMatcher` public allowlist + `auth.protect()`, (2) **rate limit** 60 req/min per IP on `/api/*`, (3) **CSRF** origin-vs-host check on mutations (internal callbacks exempt, secured by `WEBHOOK_SECRET`).

**Validation is Zod, in two places:** `lib/env.ts` validates env vars at import (fail-fast in prod), `lib/validations.ts` holds per-endpoint request schemas from primitives (`safeString`, `idField`, `emailField`, `longText`). Responses are standardized via `lib/api-helpers.ts` (`apiSuccess`/`apiError`/`apiOptions`) with security headers + CORS.

### 6. File-by-file table (shared layer)

| File | Responsibility |
|---|---|
| `config/db.tsx` | Neon HTTP → Drizzle `db`; `dbRetry()`; read-only `dbLegacy` |
| `config/schema.tsx` | Entire Drizzle schema (all 10 tables) |
| `drizzle.config.ts` | Drizzle Kit config (schema path, `postgresql`, `DATABASE_URL`) |
| `config/openrouter.ts` | **The LLM router** — NVIDIA NIM, model+key fallback, JSON repair, foreign-script guard |
| `config/groq.ts` / `config/gemini.ts` / `config/ai-fallback.ts` | Sibling LLM clients / fallback wrapper |
| `config/sarvam.ts` | Sarvam TTS/STT with word timestamps + key rotation |
| `lib/env.ts` | Zod-validated env, evaluated at import |
| `lib/validations.ts` | Per-endpoint zod schemas + `validateInput` |
| `lib/api-helpers.ts` | `apiSuccess/apiError/apiOptions` + security & CORS headers |
| `lib/rate-limit.ts` | Sliding-window IP rate limiter |
| `lib/blob.ts` | Appwrite `putWithRotation` — multi-config rotation, backoff, outage retry |
| `lib/tavily.ts` / `lib/web-search.ts` | Per-slide research / deep-crawl RAG fact-sheet |
| `lib/video-render.ts` | Dispatches GitHub Actions Remotion renders |
| `inngest/client.ts` / `app/api/inngest/route.ts` | Inngest client + serve endpoint |
| `middleware.ts` | Clerk auth + rate-limit + CSRF |
| `app/layout.tsx` / `app/provider.tsx` / `app/api/user/route.ts` | Clerk wiring + lazy user upsert |
| `next.config.ts` | Security headers, `serverExternalPackages` (Remotion/Puppeteer/FFmpeg) |
| `vitest.config.ts`, `__tests__/lib/*` | Vitest tests for api-helpers, env, rate-limit, validations |

### 7. Likely interview Q&A

**Q1. Why Inngest over cron/queue?** Durable execution — each `step.run()` is checkpointed and memoized, so retries skip completed steps and resume from the failure. Cron reruns everything; a raw queue lacks per-step memoization, retries, concurrency limits, cancellation, observability.

**Q2. Why a custom LLM router?** A single model+key call isn't production-grade. We need failover across 3 models × up to 10 keys, tolerance for truncated/invalid JSON, and a non-English-leakage guard — none of which a vanilla SDK gives. ~100 lines that turn a ~70% reliable call into near-100%, and it centralizes slide-quality prompt rules for all modules.

**Q3. How do you handle LLM JSON that won't parse?** A 6-strategy ladder (direct parse → deep repair → HTML-quote fix → smart-quote fix → regex extraction → brute-force), a `fixLiteralNewlines` pre-pass, and truncation salvage that extracts every complete object from a cut-off array. Partial-but-valid beats hard failure.

**Q4. What's the foreign-script guard?** A recursive scan of every string in the parsed result against a CJK/Kana/Hangul/Cyrillic regex; a hit returns the field path and the response is discarded → next model.

**Q5. How do you keep costs down?** Cheapest model primary (escalate only on failure); idempotent Inngest steps never re-pay for completed work; RAG results cached; render caching (`renderHistory` fingerprints); heavy renders on free GitHub Actions minutes; `credits` column meters free usage.

**Q6. Why Neon + HTTP driver?** Ephemeral serverless lambdas exhaust a connection pool; Neon's connectionless HTTP driver matches the runtime. `dbRetry()` absorbs cold-start timeouts.

**Q7. Why so many JSON columns?** LLM output is deeply nested and shape-volatile; normalizing would mean a migration per prompt change. Document-shaped payloads go in `json()`; relational/queryable data (ids, status, urls, durations, counters) stays typed.

**Q8. How does auth work?** Clerk. `middleware.ts` protects non-public routes; `app/provider.tsx` upserts the user via `/api/user` keyed on email; routes call `currentUser()`/`auth()`.

**Q9. Multi-tenancy?** `usersTable.email` is the tenant key; every top-level entity has a `userId` FK to it; queries filter by the authed user's email (application-level row-scoped tenancy).

**Q10. Prevent duplicate work on retry?** (1) Inngest memoizes each `step.run()`; (2) for external side-effects it can't dedupe (paid tasks), a `shortVideoProgress` row with a unique `(seriesId, stepKey)` index makes resubmission a no-op; functions also DB-check before generating and derive a stable `runId` from `event.id`.

**Q11. Why render on GitHub Actions not Vercel?** Remotion/Puppeteer/Chromium + FFmpeg native binaries + long runtimes don't fit Vercel; `next.config.ts` even excludes them from the bundle. Render is dispatched to a GH Actions workflow that uploads the MP4 and calls back a webhook (secured by `WEBHOOK_SECRET`).

**Q12. Storage reliability?** `lib/blob.ts` keeps the old `putWithRotation` signature, rotates across up to 6 Appwrite configs, retries transient errors with backoff, rotates on auth errors, and does a second full pass on a regional 5xx outage.

**Q13. What's tested?** Vitest covers the deterministic, security-critical shared utils (`validations`, `env`, `rate-limit`, `api-helpers`) — a regression there is a security bug; the non-deterministic LLM/render pipelines are validated by integration/manual runs.

**Q14. Weaknesses?** In-memory rate-limiters and key-rotation indices are per-instance (don't coordinate across serverless instances); for scale I'd move that state to Redis and put a queue in front of external submitters. Bespoke JSON repair is a maintenance surface, increasingly replaced by native structured-output modes.

---

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

---

## Module 2 — Short Video Generator

### 1. One-line purpose & core concepts

**Purpose:** A faceless short-form video factory — the user configures a *series* once through a 6-step wizard, and the app then generates individual vertical (9:16) narrated videos (research → script → TTS → word-synced captions → AI images → image-to-video → avatar intro/outro → Remotion render) fully autonomously via a long-running Inngest pipeline.

**The 6-step creation wizard** (`app/short-generator/create/page.tsx`, `steps[]` array + `_components/`):

| Step | Component | Persisted column |
|---|---|---|
| 0 Niche | `SelectNiche` | `niche` (supports `custom:` prefix) |
| 1 Voice | `SelectVoice` | `language` + `voice` (Sarvam speaker id) |
| 2 Music | `SelectMusic` | `music` (style id → URL via `music-urls.ts`) |
| 3 Style | `SelectVideoStyle` | `videoStyle` |
| 4 Captions | `SelectCaptionStyle` | `captionStyle` (id from `caption-styles.ts`) |
| 5 Details | `SeriesDetails` | `title`, `duration`, `platform`, `publishTime` |

`canProceed()` gates each step; the final `handleSave()` POSTs to `/api/create-short-series` (or PATCHes in edit mode).

**Series vs. video/asset:**
- A **series** (`shortVideoSeries` table, keyed by `seriesId` UUID) is the *reusable config template* — niche, voice, music, caption style, publishing cadence. One row per series.
- A **video / asset** (`shortVideoAssets` table, keyed by `videoId`) is a *single generated short* belonging to a series (`seriesId` FK). One series → many videos. It stores the concrete `scriptData`, `audioUrl`, `captionData`, `imageUrls`, `sceneVideoUrls`, `avatarClipUrls`, and the final `videoUrl`.
- **`shortVideoProgress`** is a per-scene idempotency ledger (see §3).

### 2. Tech stack in THIS module

- **Sarvam AI** — the single vendor for both **TTS** (`bulbul:v3` model, `/text-to-speech`) and **STT/captions** (`saaras:v3` batch Speech-to-Text job with `withTimestamps: true`). Wrapped in `config/sarvam.ts` and re-implemented inline in `inngest/functions.ts` (`callSarvamTTS`).
- **Word-level caption alignment** — Sarvam batch STT returns per-word timestamps; the pipeline groups them into ~6-word segments. (Note: the prompt mentions AssemblyAI, but this codebase uses **Sarvam `saaras:v3`** for word timestamps.)
- **Script LLM** — NVIDIA NIM (`lib/shorts-llm.ts`): Mistral-Large-3-675B primary, GPT-oss-120b + Llama-3.3-70B fallbacks, with in-process API-key rotation.
- **Image generation** — Apify actor `fayoussef/bulk-ai-image-generator` running Gemini 2.5 Flash Image ("Nano Banana"), fallback Gemini 3.1 Flash preview, ultimate fallback WaveSpeed GPT-Image-2 (`lib/apify-image.ts`).
- **Image-to-video** — currently **Apify Wan 2.2 I2V-A14B-Lightning** (`lib/apify-video.ts`, actor `p215uhRBVXpONQfS8`). Legacy provider modules for **Pollo Seedance** (`pollo.ts`/`pollo-video.ts`), **Leonardo Kling 2.5 Turbo** (`leonardo-video.ts`), and **Runway** (`runway.ts`) remain in the repo. The Inngest code calls `submitSeedanceVideoTask`/`checkPolloVideoTaskStatus` names that are now **drop-in stubs exported from `apify-video.ts`** — the provider was swapped without renaming call sites.
- **Inngest** — multi-step durable pipeline (`generateShortVideo`) that survives Vercel's serverless timeout by checkpointing each step; **`shortVideoProgress`** DB table gives cross-retry idempotency for paid video tasks.
- **Remotion** — final MP4 assembly, triggered via `triggerRender` (local CLI or GitHub Actions cloud); props reconstructed from DB at `/api/video/props/[videoId]`.
- **Storage** — Appwrite blob via `putWithRotation`; music on ImageKit CDN. **Auth** — Clerk.

### 3. Pipeline stage by stage

Entry: `POST /api/short-series/generate/route.ts` → `inngest.send({ name: "shorts/generate.video", data: { seriesId, customTopic?, studioPayload? } })`.

Handler: **`generateShortVideo`** in `inngest/functions.ts` (id `generate-short-video`, `cancelOn` `shorts/generate.cancel`, `onFailure` resets series to `completed` and marks stuck assets `failed`). A `runId` is derived from `event.id` and prefixes all progress rows so a new generation never reuses a previous short's rows.

| # | Step key(s) | What happens |
|---|---|---|
| 0 | Config persist | `/api/create-short-series` inserted the `shortVideoSeries` row. |
| 1 | `fetch-series` | Load series config from DB. |
| 1.5 | `fetch-covered-topics`, `research-topic-ideas`, `pick-unique-topic` | Fetch already-covered titles, fast Tavily+Wikipedia snippet research, then an LLM picks a unique non-repeated topic (skipped if `customTopic`/studio title given). |
| 1.8 | `run-web-research`, `distill-fact-sheet` | Deep-crawl RAG (crawl separated from LLM distillation so each gets a fresh timeout window) → verified fact sheet. |
| 2a | `generate-video-script-reasoning` | Phase-1 free-form reasoning pass (6 scenes, narrative arc, bridging, honorifics rules). |
| 2b | `generate-video-script` | Phase-2 JSON pass with **key1** (Mistral then GPT-120b, one shot each). Returns `null` to signal retry. |
| 2c | `generate-video-script-retry` | Fires only if 2b returned null — retries with **key2** in a fresh Vercel invocation. |
| 2.5 | `translate-title`, `translate-scene-narration-{i}` | Per-scene translation steps if `language` isn't English. |
| 3 | `generate-voice-scene-{i}` → `merge-and-upload-audio` | **One Sarvam TTS step per scene** (checkpointed), chunked at 2200 chars, WAV buffers merged. |
| 4 | `generate-captions` | Sarvam **batch STT** (`saaras:v3`, `withTimestamps`), extracts word timestamps → groups into 6-word segments. Falls back to estimated timings from narration on failure. |
| 5 | `resolve-assets`, `enrich-prompt-scene-{i}`, `generate-all-scene-images` | Resolve studio/user assets, LLM-enrich weak image prompts, then **parallel** Apify Nano-Banana image gen (9:16). |
| 4.5 | `generate-thumbnail` | AI thumbnail via Apify. |
| 5a | `submit-scene-video-jobs` | **Idempotent** submission of Wan 2.2 I2V tasks (see guard below). |
| 5b-z | `check-scene-videos-r{n}`, `process-scene-video-{i}` | Up to 20 rounds of sleep→poll→process; each finished scene downloaded, FFmpeg optical-flow smooth-stretched to exact scene duration, uploaded, marked `complete` in progress table. |
| 5z | `finalize-scene-videos` | Merge direct results + DB-processed rows filtered by `runId` prefix. |
| 5.5 | `select-avatar-clips` | Pick pre-made HeyGen intro/outro pair (`AVATAR_PAIRINGS`), generate English Sarvam TTS, time-stretch with FFmpeg `atempo` to match clip length. |
| 6 | `render-and-save` | Insert `shortVideoAssets` row (status `processing`), build Remotion props, `triggerRender`. |
| 7 | `finalize-series` | Series status → `completed`. |

**Idempotency guard (why retries don't re-charge paid video APIs):** before submitting each scene, the code checks `shortVideoProgress` for `stepKey = ${runId}_scene_video_${i}`:

```ts
const stepKey = `${runId}_scene_video_${i}`;
const [existing] = await db.select().from(shortVideoProgress)
  .where(and(eq(shortVideoProgress.seriesId, seriesId), eq(shortVideoProgress.stepKey, stepKey)));

if (existing?.status === "complete" && existing?.resultUrl) {   // fully done → reuse URL
  sceneVideoUrls[i] = existing.resultUrl; continue;
}
if (existing?.taskId && existing?.apiKey) {                      // submitted but not done → reuse taskId
  submitted.push({ index: i, taskId: existing.taskId, apiKey: existing.apiKey }); continue;
}
// else: submit a NEW task, then persist immediately:
const { taskId, apiKey } = await submitSeedanceVideoTask(sceneImageUrl, videoPrompt, "9:16", i);
try { await db.insert(shortVideoProgress).values({ seriesId, stepKey, taskId, apiKey, status: "submitted" }); }
catch { /* unique constraint = already inserted */ }
```

The `uniqueIndex("progress_series_step_idx").on(seriesId, stepKey)` in `config/schema.tsx` makes the insert idempotent even on a race. Because a Wan/Pollo `taskId` is persisted the instant it's created, any Inngest retry of the step finds the existing `taskId` and polls it instead of submitting a duplicate (paid) job.

### 4. File-by-file table

| Path | What | Why it matters |
|---|---|---|
| `app/short-generator/create/page.tsx` | 6-step wizard state machine | Collects and POSTs series config |
| `app/short-generator/_components/Select*.tsx` | Niche/Voice/Music/VideoStyle/CaptionStyle/SeriesDetails pickers | One per wizard step |
| `app/short-generator/[seriesId]/page.tsx` | Series detail / video gallery | Views generated videos, triggers generation |
| `app/api/create-short-series/route.ts` | Clerk-auth POST, Zod-validated insert into `shortVideoSeries` | Series creation |
| `app/api/short-series/generate/route.ts` | Sends `shorts/generate.video` Inngest event | Kicks off the pipeline |
| `app/api/short-series/[seriesId]/reset-status/route.ts` | Sends `shorts/generate.cancel`, resets status, deletes stuck assets | Manual recovery/cancel |
| `app/api/short-series/generate-thumbnail/route.ts` | Synchronous Apify thumbnail (60s cap) | Fast thumbnail path |
| `app/api/tts-preview/route.ts` | Single Sarvam TTS call for voice preview in wizard | Lets user audition a voice |
| `app/api/video/render/route.ts` & `re-render/route.ts` | Rebuild props from DB, call `triggerRender` | Manual (re)render |
| `app/api/video/props/[videoId]/route.ts` | Returns full Remotion props to GitHub Actions runner | Avoids GitHub 10 KB payload limit |
| `app/api/download-video/[videoId]/route.ts` | Streams MP4 (chunked-Appwrite or proxy) with unicode-safe Content-Disposition | User download |
| `inngest/functions.ts` | `generateShortVideo` (+ `generateShortSeriesThumbnailFn`, TTS/STT/avatar helpers) | The whole pipeline |
| `inngest/client.ts` | Inngest client (`id: ai-video-course-generator`) | Event bus |
| `lib/shorts-llm.ts` | NVIDIA NIM LLM client, `parseScriptJSON`, truncation repair | Script generation + JSON hardening |
| `lib/apify-image.ts` | Nano-Banana image gen + WaveSpeed fallback | Scene images/thumbnails |
| `lib/apify-video.ts` | Wan 2.2 I2V + FFmpeg smooth-stretch; exports Pollo/Seedance stubs | Image-to-video |
| `lib/pollo-video.ts`, `lib/leonardo-video.ts`, `lib/runway.ts` | Alternative I2V providers | Legacy / swappable providers |
| `lib/caption-styles.ts` | 12+ caption presets (Hormozi, MrBeast, karaoke…) | Applied at Remotion render |
| `lib/music-urls.ts` | Music id → CDN URL | Background track |
| `config/sarvam.ts` | `SarvamClient` STT with key rotation | Reusable captions client |
| `config/schema.tsx` | `shortVideoSeries`, `shortVideoAssets`, `shortVideoProgress` | Data model |
| `data/voices.ts` | Sarvam Bulbul voice catalog | Voice picker |

### 5. Interview-relevant code snippets

**a. Scene script JSON schema (flat keys, not array):**
```jsonc
{ "videoTitle": "...", "thumbnailPrompt": "...", "totalScenes": 6,
  "scene1": { "narration": "...bridge to scene2", "imagePrompt": "...",
              "videoPrompt": "...", "sceneCategory": "real_entity",
              "duration": 15, "wordCount": 55 }, "scene2": { ... } }
```

**b. `parseScriptJSON` normalizes flat `scene1..N` into a `scenes[]` array** (`lib/shorts-llm.ts`):
```ts
for (let i = 1; i <= sceneCount; i++) {
  const key = `scene${i}`;
  if (parsed[key] && typeof parsed[key] === 'object') {
    extracted.push({ ...parsed[key], sceneNumber: i });
    delete parsed[key];
  }
}
if (extracted.length > 0) parsed.scenes = extracted;
```

**c. Per-scene idempotent Inngest step keys** — `${runId}_scene_video_${i}`, so retries reuse `taskId` (full snippet in §3).

**d. Word-timestamp → caption segment grouping** (`generate-captions` step):
```ts
const WORDS_PER_SEGMENT = 6;
for (let i = 0; i < timestamps.length; i += WORDS_PER_SEGMENT) {
  const group = timestamps.slice(i, i + WORDS_PER_SEGMENT);
  segments.push({ text: group.map(w => w.word).join(' '),
    start: group[0].start, end: group[group.length-1].end, words: group });
}
```

**e. Sarvam TTS key rotation** (402/429 → next key; 5xx/timeout → retry same key):
```ts
if (res.status === 402 || res.status === 429) { lastErr = err; break; } // rotate key
const isTransient = /502|503|504|timeout|ECONNRESET/i.test(e.message);
if (!isTransient || attempt === transientRetries) break;                // rotate key
```

**f. Batch STT job with word timestamps** (`config/sarvam.ts` / captions step):
```ts
const job = await sarvamClient.speechToTextJob.createJob({
  model: "saaras:v3", mode: "transcribe",
  languageCode: selectedLanguage || "en-IN",
  withTimestamps: true, withDiarization: false, numSpeakers: 1,
});
await job.uploadFiles([tempFilePath]); await job.start(); await job.waitUntilComplete();
```

**g. Provider key rotation on quota (Apify Wan 2.2)** (`lib/apify-video.ts`):
```ts
for (let ki = 0; ki < tokens.length; ki++) {
  const tokenIdx = (startIdx + ki) % tokens.length;
  ...
  if (submitRes.status === 403 || submitRes.status === 429) { continue; } // rotate token
}
```

**h. Provider swap without renaming call sites** — legacy names are now Wan stubs:
```ts
export async function submitSeedanceVideoTask(imageUrl, videoPrompt, aspectRatio, sceneIndex=0) {
  const task = await submitApifyVideoTask(imageUrl, videoPrompt, sceneIndex, normalizedAspect);
  return { taskId: task.runId, apiKey: String(task.tokenIdx) };
}
```

**i. Caption style application** — DB `captionStyle` id resolves against `captionStyles[]` (`animation: 'word-pop' | 'single-word' | 'karaoke' | ...`) at Remotion render:
```ts
{ id: 'hormozi', animation: 'word-pop', highlightColor: '#FACC15', textTransform: 'uppercase',
  activeWordStyle: { textShadow: '...0 0 12px rgba(250,204,21,0.5)' } }
```

**j. `finalize-scene-videos` overlays DB progress rows, filtered by `runId`:**
```ts
const rows = await db.select().from(shortVideoProgress).where(and(
  eq(shortVideoProgress.seriesId, seriesId),
  eq(shortVideoProgress.status, "complete"),
  like(shortVideoProgress.stepKey, `${runId}_%`)));
```

**k. FFmpeg smooth-stretch reports `actualDurationSec = sceneDuration`** so Remotion plays at `playbackRate=1.0` → zero judder (`processSeedanceVideoResult`, `lib/apify-video.ts`).

### 6. Likely interview Q&A

**Q1. How do you avoid re-charging paid video APIs when Inngest retries a step?**
Each scene's provider `taskId` is written to `shortVideoProgress` (`stepKey = ${runId}_scene_video_${i}`) the moment it's submitted. On retry, the step first SELECTs that row: if `status:complete` it reuses `resultUrl`; if a `taskId` exists it re-polls instead of resubmitting. A unique index on `(seriesId, stepKey)` makes the insert safe under races. So a paid job is created at most once per scene per run.

**Q2. How are captions word-synced to the audio?**
After TTS, the merged WAV is sent to Sarvam batch STT (`saaras:v3`, `withTimestamps:true`). It returns per-word `{word,start,end}`; those are grouped into ~6-word segments. Remotion highlights the active word by comparing the current frame's timestamp against each word's `start/end`. If STT yields no timestamps, we estimate evenly from `audioDuration / wordCount`.

**Q3. What happens when a video provider fails or is out of quota?**
Two layers. (1) Inside the provider lib, tokens rotate on 403/429 across `APIFY_TOKEN_1..10`. (2) In the pipeline, a failed scene is logged and simply left with an empty `sceneVideoUrl`; the round loop moves on, and `finalize-scene-videos` renders whatever succeeded. Images have a hard-coded Unsplash fallback; the whole function's `onFailure` resets series status so the UI never gets stuck. Provider itself is swappable — Pollo/Leonardo/Runway libs exist behind the same interface.

**Q4. Why store `scriptData` and `captionData` as JSON columns instead of normalized tables?**
They're deeply nested, variable-shape blobs (scenes with narration/prompts/durations; caption segments with nested word arrays) that are always read/written as a whole for a single video and never queried by inner field. JSON avoids dozens of joins, keeps the render props reconstructable in one row read (`/api/video/props`), and lets the schema evolve without migrations.

**Q5. Why is TTS done one Inngest step per scene rather than one call for the whole script?**
Vercel serverless functions time out (~60s). Each `generate-voice-scene-{i}` step is an independent Inngest checkpoint with its own execution window, so a mid-pipeline timeout resumes from the next unfinished scene instead of regenerating all audio. The same pattern applies to translations and image enrichment.

**Q6. Why split script generation into a reasoning phase and a JSON phase, across two keys?**
Phase 1 (`reason`) lets the model plan the narrative arc freely without JSON constraints (better quality); Phase 2 emits strict JSON seeded with that plan. Phase 2b tries key1, and if both models fail it returns `null`, triggering Phase 2c to retry on key2 in a *fresh* Vercel invocation — spreading rate limits and giving a clean timeout budget. `parseScriptJSON` + `repairTruncated` recover truncated/markdown-wrapped output.

**Q7. How does the pipeline stay idempotent across a brand-new generation vs. a retry of the same generation?**
`runId` is derived from `event.id`, which Inngest keeps stable across retries of the same event but unique per new trigger. Because every `stepKey` and every `finalize` query is prefixed/filtered by `runId`, a retry reuses that run's completed scenes, while a new short in the same series never picks up stale rows from a previous short.

**Q8. How does the final MP4 get assembled and why fetch props over HTTP?**
`render-and-save` writes all assets to `shortVideoAssets`, then `triggerRender` runs Remotion locally or dispatches a GitHub Actions job. The runner can't receive large props inline (GitHub caps `client_payload` at 10 KB), so it calls `GET /api/video/props/[videoId]`, which rebuilds imageUrls, sceneVideoUrls, captionData, captionStyle, music, and intro/outro clips from the DB row (optionally bearer-token protected).

**Q9. Why time-stretch avatar TTS and scene videos with FFmpeg?**
Pre-made HeyGen intro/outro clips have fixed lengths; Sarvam TTS won't match exactly, so `buildAtempoFilter` stretches audio to the clip duration. Wan 2.2 outputs ~16fps VFR of variable length, so `smoothStretchVideoBuffer` interpolates to 30fps CFR and trims/stretches to the exact scene duration — and reports that exact duration so Remotion seeks land on real frames (no judder).

**Q10. How is a stuck/cancelled generation recovered?**
`/api/short-series/[seriesId]/reset-status` sends `shorts/generate.cancel` (matched by `cancelOn` `data.seriesId`), sets the series back to `completed`, and deletes assets stuck in `processing`/`rendering`. The pipeline also checks the series `status === "cancelled"` before submitting images and videos to abort early.

---

## Module 3 — Motion Graphics Generator

### 1. One-line purpose & user journey

**Purpose:** A **chat-driven** animated promo/explainer video builder — the user describes a video, an LLM breaks it into structured scenes, the user refines them conversationally, and **Remotion** renders the scenes into a real MP4 (with optional AI voiceover, music, and a theme system). Unlike the course/shorts modules (raster capture via Puppeteer/image-to-video), this module renders **programmatically in React** via Remotion.

**User journey:**
1. `app/motion-graphics/create` — user enters a prompt, picks duration (15/30/60s) and aspect ratio (16:9 / 9:16 / 1:1). A `projectId` row is created in `motionGraphicProjects` (status `draft`).
2. **Theme gate** — before chatting, the user confirms a theme (preset palette or custom colors). `themeConfirmed` flips to `1`; the resolved `{bg,text,accent,secondary,gradient}` is stored in `theme` JSON.
3. **Scene generation** — the LLM (`lib/motion-graphics-llm.ts`) returns a `sceneData` array; each scene has a `type` (one of 35 scene types), text/props, an optional `icon`, and timing.
4. **Chat refinement** — the user sends messages ("make scene 3 a comparison", "change the CTA"); `app/api/motion-graphics/[projectId]/chat` produces a **scene patch** (`changedSceneIndices`) so only edited scenes are re-processed, not the whole video.
5. **Live preview** — `@remotion/player` renders the exact same `MotionGraphicComposition` in-browser, so what the user sees equals the final MP4.
6. **Generate/render** — `generate` triggers the Inngest `generateMotionGraphic` function → scene images + optional voiceover → `remotionProps` assembly → render (GitHub Actions/Remotion) → `videoUrl`. Completed renders are cached in `renderHistory` by a theme fingerprint.

### 2. Tech stack in THIS module

- **Remotion** (`remotion/MotionGraphicComposition.tsx`, `remotion/Root.tsx`, `remotion/lib/motion.tsx`) — programmatic video via React + `useCurrentFrame`, `interpolate`, `spring`, `Sequence`, `AbsoluteFill`, `OffthreadVideo`, `Audio`. **35 scene types** dispatched by a `SceneRenderer`.
- **@remotion/player** — client-side live preview identical to the render.
- **Dedicated LLM client** — `lib/motion-graphics-llm.ts` (NVIDIA NIM: Mistral-Large-3-675B primary → GPT-oss-120b → Llama-3.3-70B; in-process key rotation; a premium model for cinematic voiceover rewriting). Separate from the course router and shorts LLM because it needs large, HTML-attribute-safe JSON scene arrays.
- **Theme system** — `lib/theme-palette.ts` resolves preset/custom palettes into a concrete color set fed into every scene.
- **Groq Vision** — classifies user-uploaded assets (`logo | screenshot | product | person | other`) so an uploaded logo lands in `logo_reveal`/`call_to_action` scenes and a screenshot lands in mockup scenes.
- **Sarvam TTS** — optional voiceover (`voiceoverEnabled`, `voice`, `language`).
- **Inngest** — `generateMotionGraphic` (durable, `cancelOn` `motion-graphics/generate.cancel`, `onFailure` → status `failed`) + `renderMotionGraphicOnly` (re-render without regenerating scenes).
- **Storage** — Appwrite; **render cache** in `motionGraphicProjects.renderHistory`.

### 3. Pipeline stage by stage (exact files/functions)

| # | File / function | What happens |
|---|---|---|
| 0 | `app/api/motion-graphics/route.ts` (POST) | Create `motionGraphicProjects` row (status `draft`). |
| 1 | Theme gate UI + `[projectId]/route.ts` (PATCH) | Persist `theme` + `themeConfirmed=1`. |
| 2 | `[projectId]/chat/route.ts` → `lib/motion-graphics-llm.ts` | LLM produces/edits `sceneData`; stores an assistant message with `metadata.type='scene_patch'` + `changedSceneIndices`. |
| 3 | `[projectId]/upload/route.ts` + `scene-asset/route.ts` | Upload reference assets; Groq Vision tags each with a `category`; per-scene locks via `scene.userAsset`. |
| 4 | `[projectId]/generate/route.ts` → `inngest.send("motion-graphics/generate.video")` | Kick off the durable render. |
| 5 | `generateMotionGraphic` (`inngest/functions.ts`) — `fetch-project`, `fetch-changed-indices` | Load project; read `changedSceneIndices` (empty = full regen, non-empty = **partial render** of only those scenes). |
| 6 | step `generate-scene-images` | Generate per-scene images; **inject uploaded assets by Groq category** into matching scene types (logos → `logo_reveal`/`call_to_action`; screenshots/products → mockup/showcase types); preserve remote video assets. |
| 7 | step (voiceover) | If `voiceoverEnabled`, rewrite narration with the premium model and synthesize Sarvam TTS → `audioUrl`/`audioDuration`. |
| 8 | step (assemble `remotionProps`) + `[projectId]/props/route.ts` | Build the final Remotion input props from `sceneData` + theme + assets + audio; served to the renderer over HTTP. |
| 9 | render (`lib/video-render.ts` / GitHub Actions) → `[projectId]/webhook/route.ts` | Render MP4, upload, write `videoUrl`; webhook updates status. |
| 10 | `renderHistory` append | Store `{fingerprint, videoUrl, renderedAt}` so switching back to an already-rendered theme offers a download instead of re-rendering. |
| — | `renderMotionGraphicOnly` | Re-render from existing `sceneData` (e.g. after a theme swap) without regenerating scenes. |

### 4. File-by-file table

| Path | What | Why |
|---|---|---|
| `app/motion-graphics/create/page.tsx` | Prompt + duration + aspect wizard | Project creation |
| `app/motion-graphics/[projectId]/page.tsx` | Chat + live `@remotion/player` preview + theme UI | The editor |
| `app/api/motion-graphics/route.ts` | Create/list projects | CRUD |
| `app/api/motion-graphics/[projectId]/route.ts` | Get/PATCH (theme, status) | Project state |
| `app/api/motion-graphics/[projectId]/chat/route.ts` | Conversational scene edits → `sceneData` patch | Core UX |
| `app/api/motion-graphics/[projectId]/enhance-prompt/route.ts` | AI prompt-improver | Better first-shot scenes |
| `app/api/motion-graphics/[projectId]/generate/route.ts` | Fire `motion-graphics/generate.video` | Kick render |
| `app/api/motion-graphics/[projectId]/props/route.ts` | Build Remotion props from DB | Feeds the renderer |
| `app/api/motion-graphics/[projectId]/upload` + `scene-asset` + `scene-color` | Asset upload, per-scene asset/color overrides | Director control |
| `app/api/motion-graphics/[projectId]/retry-render` + `webhook` + `stream` | Re-render, render callback, video stream | Render lifecycle |
| `inngest/functions.ts` → `generateMotionGraphic`, `renderMotionGraphicOnly` | Durable render pipeline | The engine |
| `lib/motion-graphics-llm.ts` | Dedicated NVIDIA NIM client for scene JSON + voiceover | Scene generation |
| `lib/theme-palette.ts` | Preset/custom palette → resolved colors | Theming |
| `remotion/MotionGraphicComposition.tsx` | 35 scene types + `SceneRenderer` | Programmatic video |
| `remotion/lib/motion.tsx` | Shared animation vocabulary (entrances, particles, globes, Ken Burns…) | Reusable motion primitives |
| `remotion/Root.tsx` | Registers compositions | Remotion entry |
| `config/schema.tsx` | `motionGraphicProjects`, `motionGraphicMessages` | Data model |

### 5. Interview-relevant code snippets

**a. Scene data shape** (`sceneData` JSON):
```jsonc
[ { "type": "title_reveal", "title": "...", "subtitle": "...", "icon": "Sparkles",
    "durationInFrames": 90, "accent": "#6D5BD3" },
  { "type": "comparison", "left": {...}, "right": {...}, "durationInFrames": 120 } ]
```

**b. Partial-render patch (only re-process edited scenes)** (`generateMotionGraphic`):
```ts
const meta = latest?.metadata as any;
if (meta?.type === 'scene_patch' && Array.isArray(meta?.changedSceneIndices)) {
  return { changedSceneIndices: meta.changedSceneIndices, animationRequestedIndices: meta.animationRequestedIndices ?? [] };
}
return { changedSceneIndices: [], animationRequestedIndices: [] }; // empty = full regen
const isPartialRender = changedSceneIndices.length > 0;
```

**c. Category-based asset injection** (Groq Vision → scene type):
```ts
const LOGO_TYPES   = new Set(['logo_reveal', 'call_to_action']);
const SCREEN_TYPES = new Set(['browser_mockup','phone_mockup','bento_grid','image_showcase','split_hero','video_hero']);
if (cat === 'logo') targets = LOGO_TYPES;
else if (cat === 'screenshot' || cat === 'product' || cat === 'person') targets = SCREEN_TYPES;
else { /* fall back to description keyword matching */ }
```

**d. Remotion time-driven animation** (`MotionGraphicComposition.tsx`):
```tsx
const frame = useCurrentFrame();
const { fps } = useVideoConfig();
const enter = spring({ frame, fps, config: { damping: 200 } });
const opacity = interpolate(frame, [0, 15], [0, 1], { extrapolateRight: 'clamp' });
return <Sequence from={scene.startFrame} durationInFrames={scene.durationInFrames}>…</Sequence>;
```

**e. Dedicated LLM key rotation** (`lib/motion-graphics-llm.ts`): same `NVIDIA_API_KEY` + `NVIDIA_API_KEY1..9` pool, `rotateMgKey()` on rate-limit, 3-tier model fallback.

**f. Render cache fingerprint** — `renderHistory: [{fingerprint, videoUrl, renderedAt}]`; a theme/scene hash lets a repeat theme offer a direct download instead of a re-render.

### 6. Likely interview Q&A

**Q1. Why Remotion here instead of reveal.js/Puppeteer (course) or image-to-video (shorts)?** Motion graphics are precise, code-defined animations (springs, staggers, particle systems) — that's exactly Remotion's model: video as a deterministic function of `frame`. reveal.js is for document-style slides; image-to-video is for photoreal footage. Remotion gives frame-accurate control and a React authoring model.

**Q2. How does the live preview stay identical to the final render?** Both use the *same* `MotionGraphicComposition` component and the *same* props — `@remotion/player` in the browser and `@remotion/renderer` on the render machine. There's one source of truth, so preview == output by construction.

**Q3. How does the render cache avoid re-rendering?** Each completed render stores a fingerprint (of theme + scenes) in `renderHistory`. Switching to a theme that was already rendered matches an existing fingerprint and offers that `videoUrl` for download instead of paying to render again.

**Q4. How do chat messages mutate scene state?** The chat route returns a patch: an assistant message whose `metadata.changedSceneIndices` lists only the scenes that changed. The Inngest function reads that and does a **partial render** — regenerating images/props only for those scenes — which is far cheaper than a full regeneration on every tweak.

**Q5. How are user-uploaded assets placed correctly?** On upload, Groq Vision classifies each asset into `logo/screenshot/product/person/other`. At generation, assets are injected into scenes whose `type` matches the category (logos → `logo_reveal`, screenshots → mockups), and per-scene-locked assets (`scene.userAsset`) are never overwritten.

**Q6. Why a separate LLM client (`motion-graphics-llm.ts`)?** It emits large JSON scene arrays that must be HTML-attribute-safe and uses a different model priority + a premium voiceover model. Keeping it separate from the course router and shorts LLM avoids cross-contaminating prompt rules and token caps.

**Q7. What's the theme gate for?** It forces a color decision before content so every scene renders on a coherent palette. `themeConfirmed` (plus checks on `sceneData`/`videoUrl`) prevents the gate re-showing for projects that already have content.

**Q8. How is a stuck render recovered?** `cancelOn` cancels an in-flight run on a `generate.cancel` event; `onFailure` sets status `failed`; `renderMotionGraphicOnly` allows a clean re-render from saved `sceneData` without regenerating scenes.

---

## Module 4 — Notes Generator

### 1. One-line purpose & user journey

**Purpose:** Turn any source (typed text, an uploaded document, a topic, or a URL) into **beautifully styled AI study notes / infographics** that can be exported as PNG or PDF. Six visual styles (Cornell, mindmap, flashcard, infographic, cheatsheet, timeline) over decorative page designs.

**User journey:**
1. `app/notes` → create a note: choose a **source type** (`text | document | topic | url`), provide the content, pick a **note style** and a **page design**.
2. If a document is uploaded, `[id]/process-doc` extracts text (and images) from it; images can be analyzed via Groq Vision.
3. `[id]/generate` runs the **chunked notes generator** to produce structured JSON, then renders it to styled HTML.
4. Optional decorative images are generated (`[id]/generate-images`, `[id]/cover-image`).
5. The user views the note (`app/notes/[noteId]`) rendered with the chosen design (`NoteDesigns.tsx`, `PageDecorations.tsx`) and **exports** to PNG/PDF client-side.

### 2. Tech stack in THIS module

- **Chunked LLM generation** — `lib/chunked-notes-generator.ts`: a **tiered model strategy** (Mistral-Large-3-675B → GPT-oss-120b → Llama-3.3-70B) with a **smart content sampler** that fits long documents into the model's context (head + evenly-distributed section excerpts + tail).
- **Groq Vision** — `analyzeImageWithGroq` (llama-4-scout) extracts text/data/structure from uploaded images/charts so they can be referenced in notes; auto-converts AVIF/HEIC/TIFF → JPEG via `sharp`.
- **Sarvam Document Intelligence** — for document extraction (via the shared `sarvam-doc` job flow).
- **Client-side export** — `html-to-image` / `html2canvas-pro` → PNG, `jsPDF` / `pdf-lib` → PDF.
- **Storage** — Appwrite; **DB** — `notesProjects` (`sourceContent`, `extractedContent`, `generatedData`, `generatedHtml`, `exportUrl`).

### 3. Pipeline stage by stage (exact files/functions)

| # | File / function | What happens |
|---|---|---|
| 0 | `app/api/notes/route.ts` (POST) | Create `notesProjects` row (status `draft`) with `noteStyle` + `pageDesign`. |
| 1 | `[id]/upload/route.ts` + `[id]/process-doc/route.ts` | Store the file; extract text/images (Sarvam doc + Groq Vision). Fills `extractedContent` / `uploadedAssets`. |
| 2 | `[id]/generate/route.ts` → `lib/chunked-notes-generator.ts` (`generateNotesWithChunking`) | Sample the content to fit a tier, call the LLM, produce **structured JSON** (`generatedData`). |
| 3 | (render) | Convert structured JSON → `generatedHtml` for the chosen `noteStyle`. |
| 4 | `[id]/generate-images/route.ts` + `[id]/cover-image/route.ts` → `lib/notes-image-gen.ts` | Generate decorative/section images + a cover. |
| 5 | `app/notes/[noteId]/*` (`NoteDesigns.tsx`, `PageDecorations.tsx`) | Render the note in the selected design. |
| 6 | Client export | `html-to-image` → PNG, `jsPDF`/`pdf-lib` → PDF; store `exportUrl`. |
| — | `app/api/course-notes/generate/route.ts` | Sibling: generate notes directly from a course chapter. |
| — | `app/api/enhance-point/route.ts` | LLM "expand this point" helper inside a note. |

### 4. File-by-file table

| Path | What | Why |
|---|---|---|
| `app/notes/page.tsx` | Notes list + create entry | Module home |
| `app/notes/[noteId]/page.tsx` | Note viewer + export controls | Render + export |
| `app/notes/[noteId]/NoteDesigns.tsx` | The 6 note-style templates | Visual styles |
| `app/notes/[noteId]/PageDecorations.tsx` | Botanical/pastel/pebble/leaf page designs | Decoration layer |
| `app/api/notes/route.ts` | Create/list notes | CRUD |
| `app/api/notes/[id]/route.ts` | Get/update a note | State |
| `app/api/notes/[id]/process-doc/route.ts` | Extract text/images from an uploaded doc | Ingestion |
| `app/api/notes/[id]/generate/route.ts` | Structured-notes generation (Groq/aiFallback + Vision) | Core generation |
| `app/api/notes/[id]/generate-images/route.ts` + `cover-image/route.ts` | Decorative + cover images | Visuals |
| `lib/chunked-notes-generator.ts` | Tiered model + smart content sampler + structured JSON | The generation engine |
| `lib/notes-image-gen.ts` | Note decoration/image generation | Visuals |
| `app/api/course-notes/generate/route.ts` | Notes from a course chapter | Cross-module reuse |
| `config/schema.tsx` | `notesProjects` | Data model |

### 5. Interview-relevant code snippets

**a. Tiered model strategy** (`lib/chunked-notes-generator.ts`):
```ts
const TIERS = [
  { model: "mistralai/mistral-large-3-675b-instruct-2512", maxContentChars: 300_000, maxOutputTokens: 12_000, headChars: 10_000, tailChars: 5_000 },
  { model: "openai/gpt-oss-120b",     maxContentChars: 1_200_000, /* … */ },
  { model: "meta/llama-3.3-70b-instruct", maxContentChars: 1_200_000, /* … */ },
];
```
*If a tier hits a 413/429 (too big / rate-limited), it drops to a higher-capacity tier automatically.*

**b. Smart content sampler** — instead of naive truncation, it keeps the **head** (intro/objectives), **evenly-distributed section excerpts** (via `detectHeadings`), and the **tail** (conclusion/references), so long docs stay coherent within the token budget.

**c. Vision format guard** (`app/api/notes/[id]/generate/route.ts`):
```ts
const groqSupported = ["image/jpeg","image/png","image/gif","image/webp"];
if (!groqSupported.includes(mimeType)) {
  const sharp = (await import("sharp")).default;      // AVIF/HEIC/TIFF → JPEG
  finalBase64 = (await sharp(Buffer.from(imageBuffer)).jpeg({ quality: 90 }).toBuffer()).toString("base64");
}
```

**d. Structured note JSON** → the render layer maps `generatedData` (sections/cards/points) onto the selected `noteStyle` template in `NoteDesigns.tsx`.

**e. Client-side export** — the note DOM node is rasterized with `html-to-image` (PNG) or drawn into `jsPDF`/`pdf-lib` (PDF) entirely in the browser — no server render needed.

### 6. Likely interview Q&A

**Q1. Why chunk the generation instead of one call?** Source documents can be hundreds of thousands of characters — far past any model's context. The smart sampler fits the most informative slices (head + section excerpts + tail) into the tier's budget, and the tier ladder escalates to a higher-capacity model on 413/429. This keeps generation reliable regardless of input size.

**Q2. How do you keep long notes coherent across chunks?** The sampler is structure-aware: `detectHeadings` finds section boundaries and takes representative excerpts spread through the document (not a blind middle cut), plus the intro and conclusion verbatim — so the model always sees the document's arc, not a random fragment.

**Q3. How does client-side PNG/PDF export work?** The rendered note is a styled DOM subtree; `html-to-image`/`html2canvas-pro` rasterize it to a PNG data URL, and `jsPDF`/`pdf-lib` place that (or vector content) into a PDF — all in the browser, so exports are instant and don't consume server compute.

**Q4. How are the 6 note styles implemented?** As distinct templates in `NoteDesigns.tsx` that consume the same `generatedData` structured JSON; the chosen `noteStyle`/`pageDesign` (stored on the row) selects the template + `PageDecorations.tsx` background. One data model, many renderers.

**Q5. How are uploaded charts/screenshots used in notes?** They're analyzed by Groq Vision (`analyzeImageWithGroq`) into a detailed text description (data points, axes, UI elements), which is fed into the generation prompt so the note can reference the image's content accurately. Unsupported formats are converted to JPEG with `sharp` first.

**Q6. Why Groq here rather than the NVIDIA router?** Notes generation is text-structuring + vision, where Groq's Llama-3.3/llama-4-scout are fast and cheap on the free tier; the module explicitly uses `aiFallback`/`groq` (the header comment even says "Groq Only, NO Gemini"). The chunked generator additionally uses NVIDIA-hosted Mistral/GPT-oss/Llama tiers for the heavy structuring pass.

---

## Module 5 — Studio (Director's Chair)

### 1. One-line purpose & user journey

**Purpose:** A **power-user variant of the Short Video Generator** where the creator directs every scene: upload a source document, generate a script from it, and choose the **asset for each scene individually** — an AI-animated Kling video, a user-uploaded clip/image, an AI image, or an image extracted from the source document. It **reuses the entire Shorts render pipeline** (the same `shortVideoAssets` table and `generateShortVideo` Inngest function), adding per-scene asset control on top.

**User journey (a stepper, `app/studio/_components/StudioStepper.tsx`):**
1. **Source** (`StudioStageSource`, `DocumentUploadZone`) — upload a document or paste text. Documents are sent to **Sarvam Document Intelligence** (`/api/sarvam-doc`) which returns extracted **markdown** (`contextMarkdown`) + any embedded images.
2. **Script** (`StudioStageScript`, `SceneScriptRow`) — `/api/studio/generate-script` produces a 6-scene script grounded in the extracted markdown (+ Tavily research for topics). The user edits scene narration inline (with a "human-touch" editor).
3. **Assets** (`StudioStageAssets`, `SceneAssetBox`) — per scene, pick an asset type: `kling_video | user_upload | ai_image | doc_image`. Uploads go through `/api/studio/upload-scene-asset`; AI images/videos via `/api/studio/img-to-video` and `generate-angles`.
4. **Style / Voice** (`StudioStageStyle`, `StudioStageVoice`) — caption style, voice, music.
5. **Confirm** (`StudioStageConfirm`) — assembles a `studioPayload` and fires the shorts pipeline with per-scene asset instructions.

### 2. Tech stack in THIS module

- **Sarvam Document Intelligence** (`/api/sarvam-doc` — `create-job → upload → start → status`, with `unzip-helper.ts` to unpack the result) → `contextMarkdown` + doc images.
- **Shorts LLM** (`lib/shorts-llm.ts`) for script generation, grounded in the extracted markdown; **Tavily/Wikipedia** RAG via `lib/web-search.ts` (`skipDistillation:true` for speed).
- **Per-scene asset typing** — `sceneAssetTypes` union stored on `shortVideoAssets`; `contextMarkdown` stored alongside.
- **Image/video providers** — ClipDrop (`lib/clipdrop.ts`), Apify Kling/Wan via the shared shorts provider libs; `lib/scene-asset.ts` resolves the chosen asset per scene.
- **Reuses** the Shorts render pipeline entirely (Inngest `generateShortVideo` normalizes a `studioPayload` into its unified `sceneAssets[]`).

### 3. Pipeline stage by stage & overlap with Module 2

Studio is a **front-end + preparation layer** that feeds the **same** `generateShortVideo` Inngest function as the auto Short Generator. The overlap:

| Concern | Auto Shorts (Module 2) | Studio (Module 5) |
|---|---|---|
| Topic/script | LLM picks a unique topic + writes script | User's **document** → Sarvam markdown → script grounded in it |
| Scene assets | All AI (image → image-to-video) | **Per-scene choice**: `kling_video / user_upload / ai_image / doc_image` |
| Payload | series config | `studioPayload = { scriptData, sceneAssets[], captionStyle, voice, music, contextMarkdown }` |
| Render | `generateShortVideo` | **same** `generateShortVideo` |
| Storage | `shortVideoAssets` | **same** table, plus `sceneAssetTypes` + `contextMarkdown` columns |

The Inngest function normalizes both shapes up front:
```ts
// inngest/functions.ts — generateShortVideo
// studioPayload = { scriptData, sceneAssets[], captionStyle, voice, music, contextMarkdown }
// OR legacy:      { scriptData, sceneAssetTypes[], sceneCustomUrls[], ... }
const sceneAssets = scenes.map((_, i) => {
  if (studioPayload?.sceneAssets?.[i]) return studioPayload.sceneAssets[i];
  const legacyType = studioPayload?.sceneAssetTypes?.[i];
  const legacyUrl  = studioPayload?.sceneCustomUrls?.[i];
  return { type: legacyType ?? 'ai_image', url: legacyUrl ?? null };
});
```
So Studio doesn't reimplement TTS/captions/render — it only changes **how each scene's visual is sourced**, and the shared pipeline handles the rest (per-scene idempotency, avatar clips, Remotion render — see Module 2).

**Stages:**
| # | File / route | What |
|---|---|---|
| 1 | `app/api/sarvam-doc/route.ts` (+ `unzip-helper.ts`) | Doc → `contextMarkdown` + images (Sarvam job flow) |
| 2 | `app/api/studio/generate-script/route.ts` | Script grounded in `contextMarkdown` (+ Tavily), English-first then translate |
| 3 | `app/api/studio/generate-angles/route.ts` | Multiple AI image "angles" per scene to choose from |
| 4 | `app/api/studio/upload-scene-asset/route.ts` | Store a user upload for a specific scene |
| 5 | `app/api/studio/img-to-video/route.ts` | Convert a chosen image → Kling/Wan video for a scene |
| 6 | `app/api/studio/enhance-scene/route.ts` | LLM polish of one scene's narration |
| 7 | (confirm) → `inngest.send("shorts/generate.video", { studioPayload })` | Hand off to the shared render pipeline |

### 4. File-by-file table

| Path | What | Why |
|---|---|---|
| `app/studio/page.tsx` / `create/page.tsx` | Studio home + creation stepper host | Entry |
| `app/studio/_components/StudioStepper.tsx` | Stage machine (Source→Script→Assets→Style→Voice→Confirm) | Wizard |
| `StudioStageSource.tsx` + `DocumentUploadZone.tsx` | Upload/paste source; trigger Sarvam extraction | Ingestion |
| `StudioStageScript.tsx` + `SceneScriptRow.tsx` | Per-scene script editing | Human-touch editor |
| `StudioStageAssets.tsx` + `SceneAssetBox.tsx` | Per-scene asset-type picker | Director control |
| `StudioStageStyle/Voice/Confirm.tsx` | Caption/voice/music + final assembly | Config |
| `WaveformCanvas.tsx` | Audio waveform preview | UX polish |
| `app/api/sarvam-doc/route.ts` + `unzip-helper.ts` | Sarvam document intelligence job flow | Doc → markdown |
| `app/api/studio/generate-script/route.ts` | Grounded script generation | Script |
| `app/api/studio/generate-angles` / `img-to-video` / `upload-scene-asset` / `enhance-scene` | Per-scene asset ops | Asset control |
| `lib/scene-asset.ts` | Resolve the chosen asset per scene | Asset resolution |
| `lib/clipdrop.ts` | ClipDrop image ops | Image gen |
| `config/schema.tsx` | `shortVideoAssets.sceneAssetTypes`, `.contextMarkdown` | Studio fields on the shared table |

### 5. Interview-relevant code snippets

**a. Per-scene asset type union** (`sceneAssetTypes` on `shortVideoAssets`):
```ts
// 'kling_video' | 'user_upload' | 'ai_image' | 'doc_image'
sceneAssetTypes: json("scene_asset_types"),
contextMarkdown: text("context_markdown"), // Sarvam-extracted source fed to the LLM
```

**b. Sarvam document job flow** (`/api/sarvam-doc`): `create-job → upload(b64) → start → GET status → { markdown, images }`.

**c. Script grounded in the document** (`app/api/studio/generate-script/route.ts`):
```ts
if (contextMarkdown) contextBlock = `REFERENCE DOCUMENT (Sarvam):\n---\n${contextMarkdown.slice(0, 8000)}`;
const research = topic ? await searchWeb(topic, { skipDistillation: true }) : null; // fast RAG
// English-first generation, then translate if target language isn't en-*
```

**d. Handoff reuses the shorts pipeline** — the confirm step sends `shorts/generate.video` with a `studioPayload`; `generateShortVideo` normalizes it into `sceneAssets[]` (snippet in §3) and runs the identical TTS→captions→video→render stages.

### 6. Likely interview Q&A

**Q1. How does Studio differ from the auto Short Generator?** Same output and render pipeline, different *authoring*: Shorts auto-picks a topic and makes every visual AI; Studio starts from the user's **document** (Sarvam-extracted markdown) and lets the user choose each scene's asset (`kling_video / user_upload / ai_image / doc_image`). It's the "director's chair" over the same crew.

**Q2. How do you let users override individual scene assets?** Each scene carries an asset type + URL. The UI (`SceneAssetBox`) sets `sceneAssetTypes[i]`; uploads/AI-gen populate the per-scene URL. The render pipeline reads a unified `sceneAssets[]` so a scene can be a user clip, an AI image, a Kling video, or a doc image — mixed freely.

**Q3. How is an uploaded document turned into a script?** `/api/sarvam-doc` runs Sarvam Document Intelligence (create-job → upload → start → poll) returning `contextMarkdown` + images; `/api/studio/generate-script` feeds that markdown (plus optional Tavily research) to the shorts LLM to produce a grounded 6-scene script.

**Q4. How do you reuse the render pipeline instead of duplicating it?** Studio never renders on its own — it builds a `studioPayload` and fires the *same* `shorts/generate.video` event. `generateShortVideo` normalizes studio vs. legacy vs. auto payloads into one `sceneAssets[]` shape, so TTS, captions, avatar clips, idempotency (`shortVideoProgress`), and Remotion render are all shared. Less code, one battle-tested path.

**Q5. Why store `contextMarkdown` on the assets table rather than a new table?** A Studio video *is* a short-video asset with extra provenance; keeping `sceneAssetTypes` + `contextMarkdown` as nullable columns on `shortVideoAssets` means the render pipeline and download flow work unchanged, and normal series videos simply leave those columns null.

**Q6. Is Studio fully built or partial?** The core is real and wired: the Sarvam doc flow, grounded script generation, per-scene asset routes (`generate-angles`, `img-to-video`, `upload-scene-asset`, `enhance-scene`), the full stepper UI, and the shared render handoff all exist. It's best described as a **mature power-user layer over the Shorts pipeline** rather than a separate engine.
