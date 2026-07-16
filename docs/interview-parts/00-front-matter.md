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

