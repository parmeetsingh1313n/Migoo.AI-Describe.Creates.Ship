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
- **Script LLM** — NVIDIA NIM (`lib/shorts-llm.ts`): GLM-5.2 primary, GPT-oss-120b + Llama-3.3-70B fallbacks, with in-process API-key rotation and a CJK/Cyrillic "language leakage" guard (English-expected outputs are discarded and the next model tried; translation is exempt).
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
| 2b | `generate-video-script` | Phase-2 JSON pass with **key1** (GLM-5.2 then GPT-120b, one shot each). Returns `null` to signal retry. |
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
