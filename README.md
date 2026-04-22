<div align="center">

# 🎬 Migoo

### Describe It. AI Creates It. Ship It.

> A full-stack AI video creation platform with **4 production modules** — from educational courses and viral shorts to cinematic motion graphics and a full creative studio — powered by multi-provider AI orchestration.

[![Next.js 16](https://img.shields.io/badge/Next.js-16.1-black?style=for-the-badge&logo=next.js)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Clerk Auth](https://img.shields.io/badge/Auth-Clerk-6C47FF?style=for-the-badge&logo=clerk&logoColor=white)](https://clerk.dev/)
[![Drizzle ORM](https://img.shields.io/badge/ORM-Drizzle-C5F74F?style=for-the-badge)](https://orm.drizzle.team/)
[![Remotion](https://img.shields.io/badge/Video-Remotion-0B84F3?style=for-the-badge)](https://www.remotion.dev/)
[![Vitest](https://img.shields.io/badge/Tested_with-Vitest-6E9F18?style=for-the-badge&logo=vitest&logoColor=white)](https://vitest.dev/)
[![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)](LICENSE)

---

**[🚀 Getting Started](#-getting-started)** · **[📖 Documentation](#-api-reference)** · **[🧪 Testing](#-testing)** · **[🏗️ Architecture](#️-architecture)**

</div>

---

## 🌟 What is Migoo?

Migoo is a **full-stack AI platform** that automates the entire video creation pipeline — from a text prompt to a rendered, downloadable video. It combines multiple AI providers (Gemini, OpenRouter, Groq, Sarvam, Leonardo AI) with Remotion's programmatic video engine to deliver four distinct production workflows.

---

## 🎯 The Four Modules

<table>
<tr>
<td width="50%">

### 📚 Video Course Generator
Generate complete multi-chapter educational video courses from a single topic.

**Pipeline:** Topic → AI Layout → Slides → TTS Narration → Caption Sync → Image Generation → Video Render

- Multi-chapter course structuring via LLM
- Rich HTML presentation slides
- Multi-language TTS via Sarvam AI
- Word-level synchronized captions
- AI-generated cinematic visuals (Leonardo AI)
- Automated Remotion video compilation

</td>
<td width="50%">

### ⚡ Short Video Generator
Create viral short-form video series with a 1-click auto-pilot pipeline.

**Pipeline:** Niche → Script → Voice → Captions → Images → Video → Publish

- 7-step Inngest durable workflow
- Niche-based recurring series
- Multiple visual styles (Realistic, Cyberpunk, GTA, etc.)
- Platform-optimized (TikTok, Reels, Shorts)
- Automated asset sourcing & composition
- Batch generation for content scheduling

</td>
</tr>
<tr>
<td width="50%">

### ✨ Motion Graphics Generator
AI chat-driven animated promo videos with 25+ professional scene types.

**Pipeline:** Prompt → AI Chat → Scene Generation → Theme Selection → Asset Creation → Voiceover → Video Render

- Conversational AI scene builder
- 25+ animated scene types (title reveals, stat counters, comparisons, kinetic text, logo reveals, etc.)
- 6 cinematic color palettes
- Upload logos, product shots & screenshots
- Optional AI voiceover narration
- Background music selection
- Multiple aspect ratios (16:9, 9:16, 1:1)

</td>
<td width="50%">

### 🎬 Migoo Studio
Full creative control — you're the director, the platform is your crew.

**Features:**
- **Document Source** — Upload PDFs, ZIPs, or images as source material
- **Scene Asset Manager** — Inject your own photos & video clips
- **Human Touch Score** — Gamified script editor for authenticity
- **Voice & Captions** — Hormozi-style dynamic caption styling
- **Music & SFX** — Smart sound design per scene
- **Mixed Media** — Combine AI-generated content with your footage

</td>
</tr>
</table>

---

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                        🖥️  Frontend (Next.js 16 App Router)             │
│                                                                          │
│   ┌────────────┐  ┌─────────────┐  ┌───────────────┐  ┌────────────┐   │
│   │  Video     │  │  Short      │  │  Motion       │  │  Migoo     │   │
│   │  Courses   │  │  Generator  │  │  Graphics     │  │  Studio    │   │
│   └────────────┘  └─────────────┘  └───────────────┘  └────────────┘   │
├──────────────────────────────────────────────────────────────────────────┤
│                     🔒  Middleware Layer                                  │
│   Clerk Auth Guard · Rate Limiting (60 req/min) · CSRF Protection        │
├──────────────────────────────────────────────────────────────────────────┤
│                     🔌  API Layer (17 Route Handlers)                    │
│   Course CRUD · AI Orchestration · Motion Graphics Chat · Studio         │
│   Zod Validation · Typed Responses · Security Headers · CORS             │
├──────────────────────────────────────────────────────────────────────────┤
│                     ⚡  Background Jobs (Inngest)                        │
│   Short Video Pipeline · Motion Graphic Render Pipeline                  │
├──────────────────────────────────────────────────────────────────────────┤
│                     🗄️  Data & External Services                        │
│                                                                          │
│   ┌──────────┐  ┌───────────┐  ┌──────────┐  ┌─────────────────┐       │
│   │ Neon DB  │  │  Vercel   │  │  Sarvam  │  │   Gemini /      │       │
│   │ Postgres │  │  Blob     │  │  TTS/STT │  │   OpenRouter    │       │
│   └──────────┘  └───────────┘  └──────────┘  └─────────────────┘       │
│   ┌──────────────┐  ┌────────────────────────────────────────────┐      │
│   │  Leonardo AI │  │  Remotion (Server-Side Video Rendering)    │      │
│   └──────────────┘  └────────────────────────────────────────────┘      │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 🛡️ Security

| Layer | Implementation | Details |
|:------|:---------------|:--------|
| **Authentication** | Clerk (delegated) | OAuth + email auth; no passwords stored in DB |
| **Authorization** | Route-level guards | `clerkMiddleware` protects all non-public routes |
| **Rate Limiting** | IP-based sliding window | 60 req/min per IP on all API routes |
| **Input Validation** | Zod schemas | Every API endpoint validates request body/query params |
| **CSRF Protection** | Origin header validation | Blocks cross-origin mutations |
| **XSS Prevention** | HTML entity sanitization | `<script>` tag detection via Zod refinements |
| **Security Headers** | Middleware-injected | HSTS, X-Frame-Options, X-Content-Type-Options, etc. |
| **SQL Injection** | Drizzle ORM parameterized | All queries use type-safe query builder |

---

## 🛠️ Tech Stack

<table>
<tr><th>Category</th><th>Technology</th><th>Purpose</th></tr>
<tr><td><b>Framework</b></td><td>Next.js 16 (App Router)</td><td>Full-stack React with SSR/SSG</td></tr>
<tr><td><b>Language</b></td><td>TypeScript 5</td><td>End-to-end type safety</td></tr>
<tr><td><b>Auth</b></td><td>Clerk</td><td>Delegated auth (OAuth, email, sessions)</td></tr>
<tr><td><b>Database</b></td><td>Neon (Serverless PostgreSQL)</td><td>Scalable cloud-native Postgres</td></tr>
<tr><td><b>ORM</b></td><td>Drizzle ORM</td><td>Type-safe SQL with migrations</td></tr>
<tr><td><b>Styling</b></td><td>Tailwind CSS v4</td><td>Utility-first responsive design</td></tr>
<tr><td><b>UI Library</b></td><td>Radix UI + shadcn/ui</td><td>Accessible, composable components</td></tr>
<tr><td><b>AI / LLM</b></td><td>Gemini, OpenRouter, Groq, Cohere</td><td>Multi-provider LLM orchestration</td></tr>
<tr><td><b>Text-to-Speech</b></td><td>Sarvam AI, ElevenLabs</td><td>Multi-language narration</td></tr>
<tr><td><b>Image Generation</b></td><td>Leonardo AI</td><td>Cinematic AI visuals</td></tr>
<tr><td><b>Video Rendering</b></td><td>Remotion</td><td>Programmatic video composition</td></tr>
<tr><td><b>Storage</b></td><td>Vercel Blob</td><td>Audio/image/video asset storage</td></tr>
<tr><td><b>Background Jobs</b></td><td>Inngest</td><td>Durable, step-based async workflows</td></tr>
<tr><td><b>Validation</b></td><td>Zod</td><td>Runtime schema validation</td></tr>
<tr><td><b>Testing</b></td><td>Vitest</td><td>Fast unit & integration tests</td></tr>
<tr><td><b>CI/CD</b></td><td>GitHub Actions</td><td>Automated type-check, lint, and test</td></tr>
<tr><td><b>Animations</b></td><td>Framer Motion</td><td>Smooth UI transitions</td></tr>
</table>

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** 18+ (recommended: 20 LTS)
- **npm** (included with Node.js)
- Accounts: [Clerk](https://clerk.dev), [Neon](https://neon.tech), [Sarvam AI](https://sarvam.ai), [OpenRouter](https://openrouter.ai)

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/parmeetsingh1313n/Migoo-Describe-It.-AI-Creates-It.-Ship-It.git
cd Migoo-Describe-It.-AI-Creates-It.-Ship-It

# 2. Install dependencies
npm install --legacy-peer-deps

# 3. Configure environment variables
cp .env.example .env
# Edit .env with your API keys (see table below)

# 4. Push database schema to Neon
npx drizzle-kit push

# 5. Start the development server
npm run dev
```

The app will be available at `http://localhost:3000`.

### Environment Variables

| Variable | Required | Description |
|:---------|:--------:|:------------|
| `DATABASE_URL` | ✅ | Neon PostgreSQL connection string |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | ✅ | Clerk frontend publishable key |
| `CLERK_SECRET_KEY` | ✅ | Clerk backend secret key |
| `OPENROUTER_API_KEY` | ✅ | OpenRouter API key for LLM access |
| `GEMINI_API_KEY` | ✅ | Google Gemini API key |
| `SARVAM_API_KEY` | ✅ | Sarvam AI key for TTS/STT |
| `BLOB_READ_WRITE_TOKEN` | ✅ | Vercel Blob storage token |
| `LEONARDO_API_KEY` | ✅ | Leonardo AI image generation |
| `INNGEST_SIGNING_KEY` | ✅ | Inngest webhook signing key |

---

## 🗄️ Database Schema

```
┌──────────────┐       ┌──────────────────┐       ┌──────────────────────┐
│    users     │──1:N──│     courses       │──1:N──│ chapter_content_slides│
│  (profiles)  │       │  (AI layouts)    │       │ (slides+audio+captions)│
└──────────────┘       └──────────────────┘       └──────────────────────┘
       │                       │
       │                       └──────1:N──┌──────────────────┐
       │                                   │  course_images   │
       │                                   └──────────────────┘
       │
       └──────1:N──┌──────────────────┐       ┌──────────────────┐
                   │ short_video_series│──1:N──│ short_video_assets│
                   └──────────────────┘       └──────────────────┘
```

### Database Commands

```bash
npx drizzle-kit push       # Push schema directly (development)
npx drizzle-kit generate   # Generate versioned migration SQL (production)
npx drizzle-kit migrate    # Apply pending migrations
npx drizzle-kit studio     # Visual database browser
```

---

## 🧪 Testing

```bash
npm test              # Run all tests
npm run test:watch    # Watch mode
npm run test:coverage # Generate coverage report
```

### Test Suites

| Suite | Tests | Coverage Area |
|:------|:-----:|:--------------|
| **Validation Schemas** | 23 | Input validation for all API endpoints |
| **Rate Limiting** | 7 | Sliding window enforcement, expiry |
| **API Helpers** | 5 | Response shapes, security headers, CORS |
| **Environment Config** | 6 | Env variable schema validation |
| | **41** | **Total tests** |

---

## 📡 API Reference

All API routes are protected by **Clerk authentication**, **rate limiting** (60 req/min), **CSRF validation**, and **Zod input validation**.

See [docs/API.md](docs/API.md) for complete documentation.

### Quick Reference

| Endpoint | Method | Module | Description |
|:---------|:------:|:------:|:------------|
| `/api/user` | `POST` | Core | Create or fetch user profile |
| `/api/course` | `GET` | Courses | List/fetch courses |
| `/api/generate-course-layout` | `POST` | Courses | AI course structure generation |
| `/api/generate-video-content` | `POST` | Courses | Slides + TTS + captions |
| `/api/generate-images` | `POST` | Courses | AI image generation |
| `/api/generate-thumbnail` | `POST` | Courses | Course thumbnail |
| `/api/create-short-series` | `POST` | Shorts | Create short video series |
| `/api/short-series` | `GET` | Shorts | List short series |
| `/api/video` | `GET` | Shorts | Fetch video assets |
| `/api/motion-graphics` | `POST/GET` | Motion | Create/list motion graphic projects |
| `/api/motion-graphics/[id]/chat` | `POST` | Motion | AI conversational scene builder |
| `/api/motion-graphics/[id]/generate` | `POST` | Motion | Trigger render pipeline |
| `/api/motion-graphics/[id]/upload` | `POST` | Motion | Upload reference assets |
| `/api/studio` | `POST/GET` | Studio | Studio project management |
| `/api/tts-preview` | `POST` | Core | Preview text-to-speech |

---

## 📦 Project Structure

```
migoo/
├── app/                            # Next.js App Router
│   ├── api/                        # 17 API Route Handlers
│   │   ├── course/                 #   Course CRUD
│   │   ├── generate-*/             #   AI generation endpoints
│   │   ├── motion-graphics/        #   Motion graphic projects & chat
│   │   ├── studio/                 #   Studio project management
│   │   ├── create-short-series/    #   Short video creation
│   │   ├── short-series/           #   Short series listing
│   │   └── inngest/                #   Inngest webhook endpoint
│   ├── (auth)/                     # Auth pages (sign-in, sign-up)
│   ├── (routes)/                   # Course listing & detail pages
│   ├── short-generator/            # Short video generator UI
│   ├── motion-graphics/            # Motion graphics creator + project editor
│   ├── studio/                     # Migoo Studio (director's chair)
│   └── _components/                # Shared page components
│
├── config/                         # Service Configuration
│   ├── schema.tsx                  #   Drizzle database schema
│   ├── db.tsx                      #   Neon database connection
│   ├── gemini.ts                   #   Google Gemini AI client
│   ├── openrouter.ts               #   OpenRouter multi-model client
│   ├── groq.ts                     #   Groq LLM client
│   ├── ai-fallback.ts              #   Multi-provider fallback chain
│   └── image-generator.ts          #   Image generation orchestrator
│
├── lib/                            # Shared Utilities
│   ├── api-helpers.ts              #   Typed API responses + security headers
│   ├── validations.ts              #   Zod validation schemas
│   ├── rate-limit.ts               #   Sliding window rate limiter
│   ├── leonardo.ts                 #   Leonardo AI integration
│   ├── enhanced-tts.ts             #   Enhanced TTS pipeline
│   └── video-render.ts             #   Remotion video rendering
│
├── inngest/                        # Background Job Definitions
│   ├── client.ts                   #   Inngest client config
│   └── functions.ts                #   Short video + motion graphic pipelines
│
├── remotion/                       # Video Compositions
│   ├── Composition.tsx             #   Course video composition
│   ├── MotionGraphicComposition.tsx #   Motion graphic renderer (25+ scene types)
│   └── Root.tsx                    #   Remotion entry point
│
├── components/                     # React UI Components
├── hooks/                          # Custom React Hooks
├── context/                        # React Context Providers
├── __tests__/                      # Vitest Test Suites (41 tests)
├── .github/workflows/              # CI/CD (GitHub Actions)
├── docs/                           # API documentation
└── middleware.ts                   # Auth + Rate Limiting + CSRF
```

---

## 🚢 Deployment

### Vercel (Recommended)

1. Push to GitHub
2. Import project in [Vercel Dashboard](https://vercel.com/new)
3. Add all environment variables
4. Deploy — Vercel auto-detects Next.js

### Manual

```bash
npm run build    # Build for production
npm start        # Start production server
```

---

## 👥 Author

<table>
<tr>
<td align="center">
<b>Parmeet Singh</b><br/>
Full-Stack Developer<br/>
<a href="https://github.com/parmeetsingh1313n">@parmeetsingh1313n</a>
</td>
</tr>
</table>

## 🤝 Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## 📄 License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.

---

<div align="center">

**Built with ❤️ by Parmeet Singh**

*Describe It. AI Creates It. Ship It.*

[⬆ Back to Top](#-migoo)

</div>
