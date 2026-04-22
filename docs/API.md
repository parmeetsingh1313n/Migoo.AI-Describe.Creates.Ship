# Migoo API Documentation

All API endpoints require authentication via Clerk unless noted otherwise. Responses include security headers (HSTS, X-Frame-Options, CSP, XSS-Protection).

---

## Authentication

All protected endpoints require a valid Clerk session. The middleware in `middleware.ts` enforces auth on non-public routes. Public routes:
- `/` (home page)
- `/sign-in`, `/sign-up`
- `/api/webhooks`, `/api/inngest`, `/api/user`

### Rate Limiting

All `/api/*` routes are rate-limited to **60 requests per minute per IP**. Exceeding the limit returns:

```json
{
  "error": "Too many requests. Please try again later."
}
```

Status: `429 Too Many Requests`
Headers: `Retry-After: 60`, `X-RateLimit-Limit: 60`, `X-RateLimit-Remaining: 0`

---

## Response Format

### Success Response
```json
{
  "success": true,
  "data": { ... },
  "timestamp": "2026-03-19T10:00:00.000Z"
}
```

### Error Response
```json
{
  "success": false,
  "error": "Human-readable error message",
  "code": "MACHINE_READABLE_CODE",
  "timestamp": "2026-03-19T10:00:00.000Z"
}
```

Error codes: `UNAUTHORIZED`, `VALIDATION_ERROR`, `COURSE_NOT_FOUND`, `API_CONNECTION_ERROR`, `GENERATION_ERROR`, `INTERNAL_ERROR`

---

## Endpoints

### POST `/api/user`

Create or retrieve user profile from Clerk session.

**Auth:** Required (Clerk session)

**Response:**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "name": "John Doe",
    "email": "john@example.com",
    "credits": 2
  }
}
```

---

### GET `/api/course`

List all courses for the authenticated user.

**Auth:** Required

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "courseId": "course-abc-123",
      "courseName": "React Fundamentals",
      "type": "video",
      "createdAt": "2026-03-19T10:00:00.000Z"
    }
  ]
}
```

### GET `/api/course?courseId=xxx`

Get a specific course with all chapter slides.

**Query Parameters:**

| Param | Type | Required | Validation |
|-------|------|----------|------------|
| `courseId` | string | Yes | Alphanumeric + hyphens/underscores |

**Response:**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "courseId": "course-abc-123",
    "courseName": "React Fundamentals",
    "courseLayout": { ... },
    "chapterContentSlides": [ ... ]
  }
}
```

---

### POST `/api/generate-course-layout`

Generate an AI-powered course structure.

**Auth:** Required

**Request Body (validated with Zod):**

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `userInput` | string | Yes | 1-2000 chars, no `<script>` tags |
| `courseId` | string | Yes | Alphanumeric + hyphens/underscores |
| `type` | string | Yes | One of: `video`, `article`, `tutorial`, `course` |

```json
{
  "userInput": "Learn React fundamentals for beginners",
  "courseId": "course-abc-123",
  "type": "video"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "course": { ... },
    "metadata": {
      "generatedAt": "2026-03-19T10:00:00.000Z",
      "model": "z-ai/glm-4.5-air:free",
      "totalChapters": 10,
      "chaptersGenerated": 10
    }
  }
}
```

---

### POST `/api/generate-video-content`

Generate slides, audio, and captions for a course chapter.

**Auth:** Recommended

**Request Body (validated with Zod):**

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `chapter` | object | Yes | Must include `chapterId`, `chapterTitle` |
| `chapter.chapterId` | string | Yes | 1-255 chars |
| `chapter.chapterTitle` | string | Yes | 1-500 chars |
| `courseId` | string | Yes | Alphanumeric + hyphens/underscores |
| `courseName` | string | Yes | 1-500 chars |
| `chapterIndex` | number | Yes | Integer 0-100 |

```json
{
  "chapter": {
    "chapterId": "ch-001",
    "chapterTitle": "Introduction to React",
    "subContent": ["JSX", "Components", "Props"]
  },
  "courseId": "course-abc-123",
  "courseName": "React Fundamentals",
  "chapterIndex": 0
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "slides": [ ... ],
    "metadata": {
      "totalSlides": 8,
      "ttsEngine": "sarvam-bulbul-v3",
      "sttEngine": "sarvam-saaras-v3"
    }
  }
}
```

---

### POST `/api/create-short-series`

Create a new short video series configuration.

**Auth:** Required

**Request Body (validated with Zod):**

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `niche` | string | Yes | 1-500 chars |
| `language` | string | Yes | 2-20 chars (e.g. `en-IN`) |
| `voice` | string | Yes | 1-100 chars |
| `music` | string | Yes | 1-100 chars |
| `videoStyle` | string | Yes | 1-100 chars |
| `captionStyle` | string | Yes | 1-100 chars |
| `title` | string | Yes | 1-500 chars |
| `duration` | string | Yes | Format: `30-50` |
| `platform` | string | Yes | One of: `youtube`, `instagram`, `email` |
| `publishTime` | string | Yes | ISO 8601 datetime |

---

## Security

All responses include these security headers:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `X-XSS-Protection: 1; mode=block`
- `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`

### Input Validation

All request bodies are validated using Zod schemas defined in `lib/validations.ts`. Invalid inputs return:

```json
{
  "success": false,
  "error": "Invalid request input",
  "code": "VALIDATION_ERROR",
  "details": [
    { "path": ["userInput"], "message": "Field cannot be empty" }
  ]
}
```

Status: `400 Bad Request`
