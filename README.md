<div align="center">

# 🎬 Migoo

### Describe It. AI Creates It. Ship It.

> A full-stack AI video-creation platform with **5 production modules** — from multi-chapter educational courses and viral faceless shorts to chat-driven motion graphics, AI study notes, and a full director's-chair studio — powered by durable background pipelines and multi-provider AI orchestration.

[![Next.js 16](https://img.shields.io/badge/Next.js-16.1-black?style=for-the-badge&logo=next.js)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Clerk Auth](https://img.shields.io/badge/Auth-Clerk-6C47FF?style=for-the-badge&logo=clerk&logoColor=white)](https://clerk.dev/)
[![Drizzle ORM](https://img.shields.io/badge/ORM-Drizzle-C5F74F?style=for-the-badge)](https://orm.drizzle.team/)
[![Inngest](https://img.shields.io/badge/Jobs-Inngest-4636F5?style=for-the-badge)](https://www.inngest.com/)
[![Remotion](https://img.shields.io/badge/Video-Remotion-0B84F3?style=for-the-badge)](https://www.remotion.dev/)
[![Vitest](https://img.shields.io/badge/Tested_with-Vitest-6E9F18?style=for-the-badge&logo=vitest&logoColor=white)](https://vitest.dev/)
[![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)](LICENSE)

---

**[🚀 Getting Started](#-getting-started)** · **[🎯 Modules](#-the-five-modules)** · **[🏗️ Architecture](#️-architecture)** · **[🗄️ Schema](#️-database-schema)** · **[🧪 Testing](#-testing)**

</div>

---

## 🌟 What is Migoo?

Migoo is a **full-stack AI platform** that automates the entire video-creation pipeline — from a text prompt to a rendered, downloadable video or export. It combines multiple AI providers (NVIDIA NIM, Gemini, Groq, Sarvam, Apify image/video actors) with **reveal.js** and **Remotion** rendering engines, orchestrated by **Inngest** durable workflows, to deliver five distinct production workflows behind one Next.js app.

The defining engineering idea: **thin, fast API routes that validate and enqueue; durable Inngest step-functions that do the minutes-long work with automatic retries and per-step memoization; and the heaviest render pushed off to GitHub Actions** where Puppeteer + FFmpeg have a real machine.

---

## 🎯 The Five Modules

<table>
<tr>
<td width="50%" valign="top">

### 📚 Course Generator
Turn one topic into a complete multi-chapter **video course**.

**Pipeline:** Topic → AI curriculum → reveal.js slides (fragments + narration) → **human review gate** → Sarvam TTS + fragment timeline → **cinematic MP4 render on GitHub Actions** → streaming download

- LLM curriculum (8–15 chapters) + per-slide HTML
- 35-archetype slide catalog with anti-repeat rotation & code-density budget
- Screening-room review (regenerate a slide, polish narration) before paying for audio
- Word-share **fragment timeline** drives an "eyeball camera" that zooms/pans to the narrated fragment
- Puppeteer + FFmpeg deterministic frame-stepped render; 44 MB raw-chunk delivery

</td>
<td width="50%" valign="top">

### ⚡ Short Video Generator
Faceless vertical (9:16) **short-form series** on autopilot.

**Pipeline:** Niche → research → script → Sarvam TTS → word-synced captions → AI images → image-to-video → avatar intro/outro → Remotion render

- 6-step series wizard (niche · voice · music · style · captions · schedule)
- Durable multi-step Inngest pipeline; **`shortVideoProgress` idempotency ledger** so retries never re-charge paid video APIs
- Word-level caption sync via Sarvam batch STT (`saaras:v3`)
- Swappable image-to-video providers (Wan / Pollo / Leonardo Kling / Runway)
- Hormozi/MrBeast/karaoke caption presets applied at render

</td>
</tr>
<tr>
<td width="50%" valign="top">

### ✨ Motion Graphics Generator
**Chat-driven** animated promo videos rendered with Remotion.

**Pipeline:** Prompt → theme gate → AI scene breakdown → chat refinement → optional voiceover → live preview → render + cache

- Conversational scene builder (25+ animated scene types)
- Theme/palette system; **per-theme render cache** (fingerprint → skip re-render)
- `@remotion/player` live preview identical to the final MP4
- Optional Sarvam voiceover; background music; 16:9 / 9:16 / 1:1

</td>
<td width="50%" valign="top">

### 📝 Notes Generator
AI **study notes & infographics** with client-side export.

**Pipeline:** Source (text/doc/topic/url) → extraction → chunked generation → structured JSON → styled HTML → PNG/PDF export

- 6 note styles (Cornell, mindmap, flashcard, infographic, cheatsheet, timeline)
- Chunked LLM generation keeps long notes coherent
- Decorative page designs; client-side PNG/PDF via html-to-image / jsPDF / pdf-lib

</td>
</tr>
<tr>
<td width="50%" valign="top">

### 🎬 Migoo Studio (Director's Chair)
Power-user variant of Shorts — **you direct every scene**.

**Features:**
- **Document source** — upload docs; Sarvam extracts markdown context
- **Per-scene asset control** — `kling_video` · `user_upload` · `ai_image` · `doc_image`
- **Human-touch script editor** for authenticity
- Reuses the Short-Video render pipeline (`shortVideoAssets` + `sceneAssetTypes` / `contextMarkdown`)

</td>
<td width="50%" valign="top">

### 🧩 Shared Foundation
One backbone under all five modules.

- **Next.js 16 App Router** + **Clerk** auth + **Neon/Drizzle**
- **Custom LLM router** (NVIDIA NIM primary → Nemotron → GPT-oss) with key rotation, 6-strategy JSON repair, and a **CJK/Cyrillic foreign-script guard**
- **Inngest** durable jobs · **Appwrite** storage · **Tavily** RAG
- Zod validation · IP rate-limiting · CSRF · Vitest

</td>
</tr>
</table>

---

## 🏗️ Architecture

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│                     🖥️  FRONTEND (Next.js 16 App Router)                      │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────────┐ │
│  │  Course  │ │  Shorts  │ │  Motion  │ │  Notes   │ │  Studio (Director)   │ │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────────────────┘ │
├──────────────────────────────────────────────────────────────────────────────┤
│                    🔒  middleware.ts — Clerk · Rate-limit · CSRF               │
├──────────────────────────────────────────────────────────────────────────────┤
│              🔌  API ROUTE HANDLERS — Zod validate → enqueue → 202             │
├──────────────────────────────────────────────────────────────────────────────┤
│           ⚡  INNGEST DURABLE PIPELINES (step.run memoized + retried)          │
│     course slides/audio · shorts scenes/video · motion graphic · thumbnails    │
├──────────────────────────────────────────────────────────────────────────────┤
│                        🧠  AI ORCHESTRATION LAYER                              │
│   LLM router (NVIDIA NIM→Nemotron→GPT-oss) · Sarvam TTS/STT · Apify img/video  │
│   Tavily RAG · reveal.js · Remotion · Puppeteer+FFmpeg (on GitHub Actions)     │
├──────────────────────────────────────────────────────────────────────────────┤
│                        🗄️  DATA & STORAGE                                      │
│      Neon Postgres (Drizzle) · Appwrite Storage · GitHub Releases (large MP4)  │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Why heavy renders run on GitHub Actions, not Vercel:** reveal.js/Remotion rendering needs headless Chromium (Puppeteer) + FFmpeg native binaries and 30–60 min of CPU — impossible under Vercel's serverless limits. Vercel dispatches a `repository_dispatch`, serves the slide/scene data back over HTTP, and receives progress/`completed` webhook callbacks. `next.config.ts` deliberately excludes `@remotion/*`, `puppeteer`, and `ffmpeg-static` from the Vercel bundle.

---

## 🛠️ Tech Stack

<table>
<tr><th>Category</th><th>Technology</th><th>Purpose</th></tr>
<tr><td><b>Framework</b></td><td>Next.js 16 (App Router)</td><td>Full-stack React, route handlers, RSC</td></tr>
<tr><td><b>Language</b></td><td>TypeScript 5</td><td>End-to-end type safety</td></tr>
<tr><td><b>Auth</b></td><td>Clerk</td><td>Delegated auth (OAuth, email, sessions)</td></tr>
<tr><td><b>Database</b></td><td>Neon (Serverless Postgres, HTTP driver)</td><td>Connectionless queries for serverless</td></tr>
<tr><td><b>ORM</b></td><td>Drizzle ORM</td><td>Type-safe SQL + Drizzle Kit migrations</td></tr>
<tr><td><b>Background Jobs</b></td><td>Inngest</td><td>Durable, step-memoized async pipelines</td></tr>
<tr><td><b>LLM (primary)</b></td><td>NVIDIA NIM (GLM-5.2 → Nemotron → GPT-oss)</td><td>Custom router w/ key rotation + JSON repair</td></tr>
<tr><td><b>LLM (aux)</b></td><td>Groq (Llama-3.3-70B), Google Gemini</td><td>Fallback + vision + structured output</td></tr>
<tr><td><b>Text-to-Speech / STT</b></td><td>Sarvam AI (bulbul:v3 / saaras:v3)</td><td>Narration + word-level caption timestamps</td></tr>
<tr><td><b>Image Generation</b></td><td>Apify actors (Gemini "Nano-Banana"), WaveSpeed</td><td>Slide/scene images + thumbnails</td></tr>
<tr><td><b>Image-to-Video</b></td><td>Apify Wan 2.2 (Pollo / Leonardo Kling / Runway)</td><td>Animating short-video scenes</td></tr>
<tr><td><b>Slides Engine</b></td><td>reveal.js + Mermaid, KaTeX, Chart.js, mark.js</td><td>Animated course slides (preview + render)</td></tr>
<tr><td><b>Video Rendering</b></td><td>Remotion + Puppeteer + FFmpeg</td><td>Programmatic MP4 composition & capture</td></tr>
<tr><td><b>Render Compute</b></td><td>GitHub Actions (repository_dispatch)</td><td>Off-Vercel heavy render farm</td></tr>
<tr><td><b>RAG</b></td><td>Tavily + Wikipedia deep-crawl</td><td>Grounding facts into content</td></tr>
<tr><td><b>Storage</b></td><td>Appwrite Storage + GitHub Releases</td><td>Audio/image/video assets (multi-key rotation)</td></tr>
<tr><td><b>Validation</b></td><td>Zod</td><td>Env + request schema validation</td></tr>
<tr><td><b>Export</b></td><td>html-to-image, jsPDF, pdf-lib</td><td>Notes PNG/PDF export</td></tr>
<tr><td><b>Testing</b></td><td>Vitest</td><td>Unit tests for security-critical utils</td></tr>
<tr><td><b>Styling</b></td><td>Tailwind CSS v4 + Radix UI</td><td>Accessible, composable UI</td></tr>
</table>

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** 18+ (recommended: 20 LTS)
- Accounts/keys: [Clerk](https://clerk.dev), [Neon](https://neon.tech), [Sarvam AI](https://sarvam.ai), [NVIDIA NIM](https://build.nvidia.com), [Appwrite](https://appwrite.io), [Inngest](https://inngest.com), [Apify](https://apify.com), [Tavily](https://tavily.com)

### Installation

```bash
# 1. Clone
git clone https://github.com/parmeetsingh1313n/Migoo.AI-Describe.Creates.Ship.git
cd Migoo.AI-Describe.Creates.Ship

# 2. Install
npm install --legacy-peer-deps

# 3. Configure environment
cp .env.example .env      # then fill in the keys below

# 4. Push the database schema to Neon
npx drizzle-kit push

# 5. Run
npm run dev               # http://localhost:3000
```

### Environment Variables

| Variable | Required | Description |
|:---------|:--------:|:------------|
| `DATABASE_URL` | ✅ | Neon PostgreSQL connection string |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` | ✅ | Clerk auth keys |
| `NVIDIA_API_KEY` (+ `NVIDIA_API_KEY1..9`) | ✅ | LLM router keys (rotated) |
| `SARVAM_API_KEY` (+ `SARVAM_API_KEY_1..n`) | ✅ | TTS/STT keys (rotated) |
| `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY` | ✅ | Inngest durable-jobs keys |
| `APPWRITE_ENDPOINT` / `APPWRITE_PROJECT_ID` / `APPWRITE_API_KEY` / `APPWRITE_BUCKET_ID` | ✅ | Storage (supports `_1..5` rotation) |
| `APIFY_TOKEN` (+ `APIFY_TOKEN_1..10`) | ✅ | Image + image-to-video actors |
| `TAVILY_API_KEY` | ⬜ | RAG research grounding |
| `GROQ_API_KEYS` / `GEMINI_API_KEY` | ⬜ | Auxiliary LLM providers |
| `GH_PAT` / `GH_OWNER` / `GH_REPO` / `WEBHOOK_SECRET` | ⬜ | GitHub-Actions render dispatch + callback |

---

## 🗄️ Database Schema

Managed by **Drizzle ORM** (`config/schema.tsx`, `postgresql` dialect).

```text
users (email = tenant key)
 ├─1:N─ courses ──1:N── chapter_content_slides   (html · narration+fragments · captions · audio)
 │         └─1:N── course_images
 │         └───── chapter_generation_status       (status · slides/audio/render progress)
 │
 ├─1:N─ short_video_series ──1:N── short_video_assets   (scriptData · captionData · scene URLs)
 │                          └──1:N── short_video_progress (idempotency: unique(seriesId, stepKey))
 │
 ├─1:N─ motion_graphic_projects ──1:N── motion_graphic_messages  (AI chat history)
 │         (sceneData · theme · remotionProps · renderHistory)
 │
 └─1:N─ notes_projects   (sourceContent · generatedData · generatedHtml · exportUrl)
```

Studio reuses `short_video_assets` via its `sceneAssetTypes` and `contextMarkdown` columns.

### Database Commands

```bash
npx drizzle-kit push       # Push schema (development)
npx drizzle-kit generate   # Generate versioned migration SQL
npx drizzle-kit migrate    # Apply migrations
npx drizzle-kit studio     # Visual DB browser
```

---

## 🛡️ Security

| Layer | Implementation |
|:------|:---------------|
| **Authentication** | Clerk (OAuth + email); no passwords stored |
| **Authorization** | `clerkMiddleware` route guards + per-route ownership checks |
| **Rate Limiting** | In-memory sliding window, 60 req/min per IP on `/api/*` |
| **Input Validation** | Zod schemas on every endpoint (`lib/validations.ts`) |
| **CSRF** | Origin-vs-host check on all mutations |
| **Webhooks** | `WEBHOOK_SECRET`-guarded render callbacks |
| **SQL Injection** | Drizzle parameterized queries |
| **Env safety** | Zod-validated env at import (`lib/env.ts`), fail-fast in prod |

---

## 🧪 Testing

```bash
npm test              # Run all tests
npm run test:watch    # Watch mode
npm run test:coverage # Coverage report
```

Vitest (node env) covers the deterministic, security-critical shared utilities — `lib/validations`, `lib/env`, `lib/rate-limit`, `lib/api-helpers`. The non-deterministic LLM/render pipelines are validated by integration and manual runs.

---

## 📦 Project Structure

```text
migoo/
├── app/
│   ├── api/                         # Route handlers (thin: validate → enqueue)
│   │   ├── generate-course-layout/  #   Course curriculum
│   │   ├── generate-video-content/  #   Course slides (Phase 1)
│   │   ├── approve-slides/          #   Review gate → audio (Phase 2)
│   │   ├── render-chapter/          #   Dispatch cinematic render to GitHub Actions
│   │   ├── create-short-series/     #   Shorts series config
│   │   ├── short-series/ · video/   #   Shorts generation + render props
│   │   ├── motion-graphics/         #   Motion projects + chat
│   │   ├── notes/ · course-notes/   #   Notes generation
│   │   ├── studio/ · sarvam-doc/    #   Studio + document extraction
│   │   └── inngest/                 #   Inngest serve endpoint
│   ├── (auth)/ (routes)/            # Auth pages · course viewer
│   ├── course-generator/ short-generator/ motion-graphics/ notes/ studio/
│   └── _components/
├── config/                          # db · schema · openrouter (LLM router) · sarvam · gemini · groq
├── lib/                             # api-helpers · validations · rate-limit · blob · reveal-doc · providers
├── inngest/                         # client · course-functions · functions (durable pipelines)
├── remotion/                        # Root · MotionGraphicComposition · CourseComposition
├── scripts/                         # render-chapter-gh.js · upload-*.js (GitHub Actions render)
├── data/                            # Prompt.ts · slide-design.ts · voices.ts
├── docs/                            # API.md · INTERVIEW_GUIDE.md (architecture deep-dive)
├── __tests__/                       # Vitest suites
├── .github/workflows/               # render-chapter.yml (repository_dispatch render)
└── middleware.ts                    # Auth + Rate-limit + CSRF
```

---

## 🚢 Deployment

**Vercel (app):** import the repo, add env vars, deploy — Next.js is auto-detected.
**GitHub Actions (render farm):** set `GH_PAT`/`GH_OWNER`/`GH_REPO`/`WEBHOOK_SECRET`; heavy renders dispatch to `.github/workflows/render-chapter.yml`.
**Inngest:** register the serve endpoint (`/api/inngest`) in the Inngest dashboard.

---

## 📖 Deep-Dive Documentation

A full architecture + per-module engineering deep-dive (pipelines, file-by-file breakdowns, code snippets, and design rationale) lives in **[docs/INTERVIEW_GUIDE.md](docs/INTERVIEW_GUIDE.md)**. API reference: **[docs/API.md](docs/API.md)**.

---

## 👥 Author

<table><tr><td align="center">
<b>Parmeet Singh</b><br/>Full-Stack Developer<br/>
<a href="https://github.com/parmeetsingh1313n">@parmeetsingh1313n</a>
</td></tr></table>

## 🤝 Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## 📄 License

MIT — see [LICENSE](LICENSE).

---

<div align="center">

**Built with ❤️ by Parmeet Singh**

*Describe It. AI Creates It. Ship It.*

[⬆ Back to Top](#-migoo)

</div>
