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
- **Dedicated LLM client** — `lib/motion-graphics-llm.ts` (NVIDIA NIM: GLM-5.2 primary → GPT-oss-120b → Llama-3.3-70B; in-process key rotation; a premium model for cinematic voiceover rewriting). Separate from the course router and shorts LLM because it needs large, HTML-attribute-safe JSON scene arrays.
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
