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
