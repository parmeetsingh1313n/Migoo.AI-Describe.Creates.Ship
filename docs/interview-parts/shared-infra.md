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
