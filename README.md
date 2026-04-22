<div align="center">

# 🎬 Migoo

### Describe It. AI Creates It. Ship It.

> The AI video creation platform that turns your ideas into studio-quality courses, shorts, and motion graphics — powered by multi-provider AI orchestration.

[![Next.js 16](https://img.shields.io/badge/Next.js-16.1-black?style=for-the-badge&logo=next.js)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Clerk Auth](https://img.shields.io/badge/Auth-Clerk-6C47FF?style=for-the-badge&logo=clerk&logoColor=white)](https://clerk.dev/)
[![Drizzle ORM](https://img.shields.io/badge/ORM-Drizzle-C5F74F?style=for-the-badge)](https://orm.drizzle.team/)
[![Vitest](https://img.shields.io/badge/Tested_with-Vitest-6E9F18?style=for-the-badge&logo=vitest&logoColor=white)](https://vitest.dev/)
[![CI](https://img.shields.io/badge/CI-GitHub_Actions-2088FF?style=for-the-badge&logo=github-actions&logoColor=white)](https://github.com/parmeetsingh1313n/Migoo-Describe-It.-AI-Creates-It.-Ship-It/actions)
[![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)](LICENSE)

---

**[🚀 Getting Started](#-getting-started)** · **[📖 Documentation](#-api-reference)** · **[🧪 Testing](#-testing)** · **[🏗️ Architecture](#️-architecture)**

</div>

---

## 🌟 What is Migoo?

Migoo is a **full-stack AI platform** that automates the entire educational video course creation pipeline — from topic input to rendered video output. It combines multiple AI providers (Gemini, OpenRouter, Sarvam, Leonardo AI) with a modern Next.js frontend to deliver a seamless course generation experience.

### The Pipeline

```
📝 Topic Input → 🧠 AI Course Layout → 📊 Slide Generation → 🎙️ TTS Narration
                                                                      ↓
                🎬 Video Render ← 🖼️ Image Generation ← 📝 Caption Sync
```

### Key Capabilities

| Capability | Description |
|:---|:---|
| 🧠 **AI Course Structuring** | Auto-generates multi-chapter layouts with subtopics via LLM providers |
| 📊 **Rich Slide Generation** | Creates HTML presentation slides with embedded visuals |
| 🎙️ **Multi-Language TTS** | Natural narration via Sarvam AI with multiple voice options |
| 📝 **Word-Level Captions** | Synchronized caption data for full accessibility |
| 🖼️ **AI Image Generation** | Cinematic visuals via Leonardo AI with intelligent prompt enrichment |
| 🎬 **Automated Video Rendering** | Compiles slides + audio + captions into final video via Remotion |
| 📱 **Short Video Generator** | 7-step Inngest pipeline for viral short-form content creation |

---

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                        🖥️  Frontend (Next.js 16 App Router)             │
│                                                                          │
│   ┌───────────┐   ┌────────────────┐   ┌──────────────────────────┐     │
│   │  Auth UI  │   │  Course Pages  │   │  Short Video Generator   │     │
│   │  (Clerk)  │   │  Create / View │   │  Niche → Script → Video  │     │
│   └───────────┘   └────────────────┘   └──────────────────────────┘     │
├──────────────────────────────────────────────────────────────────────────┤
│                     🔒  Middleware Layer                                  │
│   ┌──────────────────────────────────────────────────────────────────┐   │
│   │  Clerk Auth Guard · Rate Limiting (60 req/min) · CSRF Protection │   │
│   └──────────────────────────────────────────────────────────────────┘   │
├──────────────────────────────────────────────────────────────────────────┤
│                     🔌  API Layer (Route Handlers)                       │
│                                                                          │
│   ┌──────────────┐  ┌─────────────────────┐  ┌────────────────────┐     │
│   │  /api/course │  │  /api/generate-*    │  │  /api/user         │     │
│   │  CRUD + Auth │  │  AI Orchestration   │  │  Profile + Credits │     │
│   └──────────────┘  └─────────────────────┘  └────────────────────┘     │
│   ┌──────────────────────────────────────────────────────────────────┐   │
│   │  Zod Validation · Typed Responses · Security Headers · CORS     │   │
│   └──────────────────────────────────────────────────────────────────┘   │
├──────────────────────────────────────────────────────────────────────────┤
│                     ⚡  Background Jobs (Inngest)                        │
│   ┌──────────────────────────────────────────────────────────────────┐   │
│   │  Short Video Pipeline:                                           │   │
│   │  Script → Voice → Captions → Images → Video → Render → Publish  │   │
│   └──────────────────────────────────────────────────────────────────┘   │
├──────────────────────────────────────────────────────────────────────────┤
│                     🗄️  Data & External Services                        │
│                                                                          │
│   ┌──────────┐  ┌───────────┐  ┌──────────┐  ┌─────────────────┐       │
│   │ Neon DB  │  │  Vercel   │  │  Sarvam  │  │   OpenRouter /  │       │
│   │ Postgres │  │  Blob     │  │  TTS/STT │  │   Gemini LLM    │       │
│   └──────────┘  └───────────┘  └──────────┘  └─────────────────┘       │
│   ┌──────────────┐  ┌────────────────────────────────────────────┐      │
│   │  Leonardo AI │  │  Remotion (Server-Side Video Rendering)    │      │
│   └──────────────┘  └────────────────────────────────────────────┘      │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 🛡️ Security

Migoo implements **defense-in-depth** security across every layer:

| Layer | Implementation | Details |
|:------|:---------------|:--------|
| **Authentication** | Clerk (delegated) | OAuth + email auth; no passwords stored in DB |
| **Authorization** | Route-level guards | `clerkMiddleware` protects all non-public routes |
| **Rate Limiting** | IP-based sliding window | 60 req/min per IP on all API routes (middleware + per-route) |
| **Input Validation** | Zod schemas | Every API endpoint validates request body/query params |
| **CSRF Protection** | Origin header validation | Blocks cross-origin mutations (POST/PUT/PATCH/DELETE) |
| **XSS Prevention** | HTML entity sanitization | `<script>` tag detection in all user inputs via Zod refinements |
| **Security Headers** | Middleware-injected | `Strict-Transport-Security`, `X-Frame-Options`, `X-Content-Type-Options`, `X-XSS-Protection`, `Referrer-Policy`, `Permissions-Policy` |
| **SQL Injection** | Drizzle ORM parameterized | All queries use Drizzle's type-safe query builder — no raw SQL |
| **CORS** | Controlled access | `Access-Control-Allow-Methods/Headers` with configurable origins |

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

Create a `.env` file in the project root with the following variables:

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

> **Note**: Only `DATABASE_URL`, `CLERK_*` keys, and `GEMINI_API_KEY` are strictly required for the core course generation flow. Other keys enable additional features (TTS, image generation, short videos).

---

## 🗄️ Database Schema

Migoo uses **6 tables** managed by Drizzle ORM with full referential integrity:

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

| Table | Purpose | Key Fields |
|:------|:--------|:-----------|
| `users` | User profiles synced from Clerk | email, name, credits |
| `courses` | Course metadata + AI-generated layouts | courseId, courseLayout (JSON), thumbnail |
| `course_images` | Generated images for course slides | imageUrl, imagePrompt, dimensions |
| `chapter_content_slides` | Slide content with audio & captions | html, audioUrl, captions (JSON), revealData |
| `short_video_series` | Short video series configuration | niche, voice, style, platform, status |
| `short_video_assets` | Generated video assets per series | scriptData, audioUrl, imageUrls, videoUrl |

### Database Commands

```bash
npx drizzle-kit push       # Push schema directly (development)
npx drizzle-kit generate   # Generate versioned migration SQL (production)
npx drizzle-kit migrate    # Apply pending migrations
npx drizzle-kit studio     # Visual database browser
```

> 💡 **Authentication Note**: Migoo delegates all authentication to [Clerk](https://clerk.dev). No passwords are stored in the database — Clerk handles password hashing, session management, and OAuth flows externally. The `users` table only stores profile data (name, email, credits) synced from Clerk.

---

## 🧪 Testing

Migoo uses **Vitest** for fast, TypeScript-native unit and integration testing.

```bash
npm test              # Run all tests
npm run test:watch    # Watch mode (re-run on changes)
npm run test:coverage # Generate coverage report
```

### Test Suites

| Suite | File | Tests | Coverage Area |
|:------|:-----|:-----:|:--------------|
| **Validation Schemas** | `validations.test.ts` | 23 | Input validation for all API endpoints (XSS, types, bounds) |
| **Rate Limiting** | `rate-limit.test.ts` | 7 | Sliding window enforcement, expiry, independent IP tracking |
| **API Helpers** | `api-helpers.test.ts` | 5 | Response shapes, security headers, CORS, error formatting |
| **Environment Config** | `env.test.ts` | 6 | Env variable schema validation (required/optional/defaults) |
| | | **41** | **Total tests** |

### CI/CD Pipeline

Tests run automatically on every push via **GitHub Actions**:

```yaml
# .github/workflows/ci.yml
Triggers: push to main/develop, PRs to main
Steps:    Checkout → Node 20 → Install → TypeScript Check → Vitest → Coverage Upload
```

---

## 📡 API Reference

All API routes are protected by **Clerk authentication**, **rate limiting** (60 req/min), **CSRF validation**, and **Zod input validation**.

See [docs/API.md](docs/API.md) for complete documentation.

### Quick Reference

| Endpoint | Method | Description |
|:---------|:------:|:------------|
| `/api/user` | `POST` | Create or fetch user profile (Clerk-synced) |
| `/api/course` | `GET` | List all courses or fetch specific course by ID |
| `/api/generate-course-layout` | `POST` | Generate AI-powered course structure with chapters |
| `/api/generate-video-content` | `POST` | Generate slides + TTS audio + captions for a chapter |
| `/api/generate-images` | `POST` | Generate AI images for course slides |
| `/api/generate-thumbnail` | `POST` | Generate course thumbnail image |
| `/api/create-short-series` | `POST` | Create and configure a short video series |
| `/api/short-series` | `GET` | List user's short video series |
| `/api/video` | `GET` | Fetch generated video assets |
| `/api/tts-preview` | `POST` | Preview text-to-speech output |

### Response Format

All API responses follow a consistent typed structure:

```typescript
// Success
{ success: true, data: T, timestamp: string }

// Error
{ success: false, error: string, code: string, timestamp: string }
```

---

## 📦 Project Structure

```
migoo/
├── app/                            # Next.js App Router
│   ├── api/                        # API Route Handlers
│   │   ├── course/                 #   Course CRUD operations
│   │   ├── generate-course-layout/ #   AI course structure generation
│   │   ├── generate-video-content/ #   Slide + audio + caption generation
│   │   ├── generate-images/        #   AI image generation
│   │   ├── generate-thumbnail/     #   Course thumbnail generation
│   │   ├── create-short-series/    #   Short video series creation
│   │   ├── short-series/           #   Short series listing
│   │   ├── video/                  #   Video asset retrieval
│   │   ├── tts-preview/            #   TTS audio preview
│   │   ├── user/                   #   User management
│   │   └── inngest/                #   Inngest webhook endpoint
│   ├── (auth)/                     # Auth pages (sign-in, sign-up)
│   ├── (routes)/                   # Application pages
│   ├── short-generator/            # Short video generator UI
│   └── _components/                # Shared page components
│
├── config/                         # Service Configuration
│   ├── schema.tsx                  #   Drizzle database schema (6 tables)
│   ├── db.tsx                      #   Neon database connection
│   ├── gemini.ts                   #   Google Gemini AI client
│   ├── openrouter.ts               #   OpenRouter multi-model client
│   ├── groq.ts                     #   Groq LLM client
│   ├── cohere.ts                   #   Cohere AI client
│   ├── sarvam.ts                   #   Sarvam TTS/STT client
│   └── image-generator.ts          #   Image generation orchestrator
│
├── lib/                            # Shared Utilities
│   ├── api-helpers.ts              #   Typed API responses + security headers
│   ├── validations.ts              #   Zod validation schemas (all endpoints)
│   ├── rate-limit.ts               #   Sliding window rate limiter
│   ├── env.ts                      #   Environment variable validation
│   ├── leonardo.ts                 #   Leonardo AI image integration
│   ├── leonardo-video.ts           #   Leonardo AI video integration
│   ├── enhanced-tts.ts             #   Enhanced text-to-speech pipeline
│   ├── audio-utils.ts              #   Audio processing utilities
│   ├── caption-styles.ts           #   Caption styling configurations
│   ├── video-render.ts             #   Remotion video rendering
│   ├── content-cache.ts            #   Content caching layer
│   ├── blob.ts                     #   Vercel Blob storage utilities
│   └── image-utils.ts              #   Image processing helpers
│
├── inngest/                        # Background Job Definitions
│   ├── client.ts                   #   Inngest client configuration
│   └── functions.ts                #   Short video pipeline (7-step workflow)
│
├── components/                     # React UI Components (Radix + shadcn/ui)
├── remotion/                       # Remotion Video Composition Config
├── hooks/                          # Custom React Hooks
├── context/                        # React Context Providers
├── data/                           # Static Data & Constants
├── middleware.ts                   # Auth + Rate Limiting + CSRF Middleware
│
├── __tests__/                      # Test Suites
│   └── lib/                        #   Unit tests for lib/ modules
│       ├── api-helpers.test.ts     #     API response patterns (5 tests)
│       ├── env.test.ts             #     Env validation schemas (6 tests)
│       ├── rate-limit.test.ts      #     Rate limiter logic (7 tests)
│       └── validations.test.ts     #     Input validation (23 tests)
│
├── .github/workflows/              # CI/CD
│   ├── ci.yml                      #   TypeScript check + Vitest on push/PR
│   └── render-video.yml            #   Video rendering workflow
│
├── docs/                           # Documentation
│   └── API.md                      #   Complete API reference
├── CONTRIBUTING.md                 # Contribution guidelines
├── vitest.config.ts                # Vitest test configuration
├── drizzle.config.ts               # Drizzle ORM configuration
└── next.config.ts                  # Next.js configuration
```

---

## 🚢 Deployment

### Vercel (Recommended)

1. Push to GitHub
2. Import project in [Vercel Dashboard](https://vercel.com/new)
3. Add all environment variables from the table above
4. Deploy — Vercel auto-detects Next.js and configures optimally

### Manual Deployment

```bash
# Build for production
npm run build

# Start production server
npm start
```

### Database Migrations (Production)

```bash
# Generate migration files
npx drizzle-kit generate

# Apply migrations to production database
npx drizzle-kit migrate
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

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on:
- Setting up the development environment
- Code style and conventions
- Submitting pull requests
- Reporting issues

## 📄 License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.

---

<div align="center">

**Built with ❤️ by Parmeet Singh**

*Describe It. AI Creates It. Ship It.*

[⬆ Back to Top](#-migoo)

</div>

