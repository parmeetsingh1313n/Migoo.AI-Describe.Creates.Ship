import { boolean, index, integer, jsonb, pgTable, real, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";

// Conventions enforced across this file:
//  - jsonb (not json): parsed once on write, GIN-indexable, cheap to read.
//    Safe here because nothing re-hashes a stored payload — see the note on
//    webhook bodies at the bottom of this file.
//  - timestamp({ withTimezone: true }): the app writes JS `new Date()` (UTC) and
//    Neon runs in UTC, so naive columns were already holding UTC. timestamptz
//    makes that explicit and survives a server/region timezone change.
//  - Every foreign-key SOURCE column carries an explicit index. Postgres indexes
//    the target (via PK/unique) but NEVER the source, so child lookups and the
//    parent's own DELETE/UPDATE checks were sequential scans.
//  - updatedAt uses .$onUpdate() so it maintains itself instead of relying on
//    39 hand-written `updatedAt: new Date()` assignments staying correct forever.

export const usersTable = pgTable("users", {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    name: varchar({ length: 255 }).notNull(),
    email: varchar({ length: 255 }).notNull().unique(),
    credits: integer().default(2)
});

export const coursesTable = pgTable("courses", {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    // KNOWN DEBT: this is an email, not a Clerk user id, and the FK targets
    // users.email. Emails are mutable and absent from the Clerk JWT, so every
    // handler has to fetch the Clerk user just to resolve an owner. Migrating to
    // users.id / clerk_user_id is a separate, deliberate change — see MIGRATION-NOTES.md.
    userId: varchar({ length: 255 }).notNull().references(() => usersTable.email),
    courseId: varchar({ length: 255 }).notNull().unique(),
    courseName: varchar({ length: 255 }).notNull(),
    userInput: varchar({ length: 255 }).notNull(),
    type: varchar({ length: 255 }).notNull(),
    voice: varchar({ length: 100 }).default("kabir"),   // Sarvam voice ID for course narration
    courseLayout: jsonb().notNull(),
    // The ONE canonical per-chapter slide-topic expansion, shape:
    //   { [chapterId]: Array<{ topic: string; needsCode: boolean }> }
    // Written by generateCourseImagesFn and REUSED by generateCourseSlidesFn so the
    // image↔slide global-index mapping (chapterIndex*25 + slideIdx) is EXACT — both
    // functions must expand a chapter's subContent identically or images mismatch.
    slideTopics: jsonb("slide_topics"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    courseThumbnail: text(),
}, (t) => ([
    // Drives the dashboard's "list my courses" query on every page load.
    index("courses_user_id_idx").on(t.userId),
]))

export const courseImages = pgTable("course_images", {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    courseId: varchar({ length: 255 }).notNull().references(() => coursesTable.courseId, { onDelete: "cascade" }),
    imageIndex: integer().notNull(),
    imagePrompt: varchar({ length: 500 }).notNull(),
    imageUrl: varchar({ length: 1000 }).notNull(),
    width: integer().default(1024),
    height: integer().default(576),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (t) => ([
    // Every render/preview fetches a course's images by courseId, ordered by index.
    index("course_images_course_id_idx").on(t.courseId, t.imageIndex),
]))

export const chapterContentSlides = pgTable("chapter_content_slides", {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    courseId: varchar({ length: 255 }).notNull().references(() => coursesTable.courseId, { onDelete: "cascade" }),
    chapterId: varchar({ length: 255 }).notNull(),
    slideId: varchar({ length: 255 }).notNull().unique(),
    slideIndex: integer().notNull(),
    audioUrl: varchar({ length: 500 }),
    imageUrl: varchar({ length: 500 }),
    // narration is nullable for new rows — content lives in Appwrite (narrationUrl).
    // Legacy rows keep inline JSON. Resolve via resolveSlideNarration() in lib/slide-narration.
    narration: jsonb(),
    narrationUrl: varchar({ length: 500 }),
    captions: jsonb(),
    html: text(),
    // HTML now lives in Appwrite Storage; `html` above stays for legacy rows and
    // as a dual-read fallback. New/updated slides upload the markup and store its
    // URL here, leaving `html` null. Resolve via resolveSlideHtml() in lib/slide-html.
    htmlUrl: varchar({ length: 500 }),
    revealData: jsonb().notNull(),
    audioDuration: real("audio_duration"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (t) => ([
    // The hot path: load one chapter's slides in order. Covers the bare
    // courseId lookup (leftmost prefix) and the FK's own delete check.
    index("chapter_slides_course_chapter_idx").on(t.courseId, t.chapterId, t.slideIndex),
]))


// ── Short Video Series ──────────────────────────────────────
export const shortVideoSeries = pgTable("short_video_series", {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    seriesId: varchar({ length: 255 }).notNull().unique(),
    userId: varchar({ length: 255 }).notNull().references(() => usersTable.email),

    // Step 1: Niche
    niche: varchar({ length: 500 }).notNull(),

    // Step 2: Voice
    language: varchar({ length: 20 }).notNull(),
    voice: varchar({ length: 100 }).notNull(),

    // Step 3: Music
    music: varchar({ length: 100 }).notNull(),

    // Step 4: Video Style
    videoStyle: varchar("video_style", { length: 100 }).notNull(),

    // Step 5: Caption Style
    captionStyle: varchar("caption_style", { length: 100 }).notNull(),

    // Step 6: Series Details
    title: varchar({ length: 500 }).notNull(),
    duration: varchar({ length: 20 }).notNull(),       // '30-50' or '60-70'
    platform: varchar({ length: 50 }).notNull(),        // 'youtube' | 'instagram' | 'email'
    // timestamptz matters most here: this is compared against "now" by the
    // scheduler, so a naive timestamp would drift if the runtime's TZ ever changed.
    publishTime: timestamp("publish_time", { withTimezone: true }).notNull(),

    // Thumbnail
    thumbnailUrl: text("thumbnail_url"),

    // Status tracking
    status: varchar({ length: 50 }).default("pending"), // pending | generating | completed | failed
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().$onUpdate(() => new Date()),
}, (t) => ([
    index("short_video_series_user_id_idx").on(t.userId),
    // The scheduler scans for due, not-yet-published series.
    index("short_video_series_status_publish_idx").on(t.status, t.publishTime),
]))


// ── Short Video Generated Assets (one series → many videos) ─────
export const shortVideoAssets = pgTable("short_video_assets", {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    videoId: varchar("video_id", { length: 255 }).notNull().unique(),
    seriesId: varchar("series_id", { length: 255 }).notNull().references(() => shortVideoSeries.seriesId, { onDelete: "cascade" }),

    // Voice & language (can be overridden per video, defaults to series)
    voice: varchar({ length: 100 }),
    language: varchar({ length: 20 }),

    // Script data from step 2
    videoTitle: varchar("video_title", { length: 500 }).notNull(),
    scriptData: jsonb("script_data").notNull(),          // { totalScenes, scenes: [...] }

    // Audio data from step 3
    audioUrl: text("audio_url"),
    audioDuration: real("audio_duration"),               // seconds

    // Caption data from step 4
    captionData: jsonb("caption_data"),                  // { transcript, wordTimestamps, segments }

    // Image data from step 5
    imageUrls: jsonb("image_urls"),                      // ["url1", "url2", ...] per scene

    // Scene video data from step 5.25 (image-to-video conversion)
    sceneVideoUrls: jsonb("scene_video_urls"),           // ["videoUrl1", "videoUrl2", ...] per scene
    sceneVideoDurations: jsonb("scene_video_durations"), // [duration1, duration2, ...] per scene duration after processing
    sceneThumbnailUrls: jsonb("scene_thumbnail_urls"),   // ["thumbUrl1", "thumbUrl2", ...] per scene

    // Avatar clip data from step 5.5
    avatarClipUrls: jsonb("avatar_clip_urls"),           // ["", "", "url3", "", "", "url6"] per scene

    // Director's Chair Studio fields (nullable — normal series videos leave these unset)
    // Per-scene asset types: 'kling_video' | 'user_upload' | 'ai_image' | 'doc_image'
    sceneAssetTypes: jsonb("scene_asset_types"),
    // Source context (Sarvam-extracted markdown or user-typed text) fed to Gemini
    contextMarkdown: text("context_markdown"),

    // Final rendered video
    videoUrl: text("video_url"),
    thumbnailUrl: text("thumbnail_url"),

    // Status
    status: varchar({ length: 50 }).default("completed"), // generating | completed | failed
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (t) => ([
    // "all videos in this series" — the dashboard's per-series fetch, and the
    // lookup Postgres runs to enforce the FK when a series row is deleted.
    index("short_video_assets_series_id_idx").on(t.seriesId),
]))

// ── Short Video Pipeline Progress (idempotency guard) ────────────
// Stores per-scene task IDs so Inngest retries never create duplicate Pollo tasks.
export const shortVideoProgress = pgTable("short_video_progress", {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    seriesId: varchar({ length: 255 }).notNull().references(() => shortVideoSeries.seriesId, { onDelete: "cascade" }),
    stepKey: varchar({ length: 100 }).notNull(),   // e.g. "scene_video_2", "thumbnail"
    taskId: varchar({ length: 255 }),              // Pollo task ID
    apiKey: varchar({ length: 500 }),              // which key succeeded
    resultUrl: varchar({ length: 1000 }),          // final output URL
    durationSec: real("duration_sec"),             // video duration after processing
    status: varchar({ length: 30 }).default("submitted"), // submitted | complete | failed
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().$onUpdate(() => new Date()),
}, (t) => ([
    // The idempotency guard. A unique constraint (not a SELECT-then-INSERT) is
    // what closes the TOCTOU window: check and write are one atomic operation,
    // so two concurrent Inngest retries cannot both create the same Pollo task.
    // Also serves as the seriesId FK index via its leftmost column.
    uniqueIndex("progress_series_step_idx").on(t.seriesId, t.stepKey),
]))


// ── Motion Graphic Projects ─────────────────────────────────
export const motionGraphicProjects = pgTable("motion_graphic_projects", {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    projectId: varchar({ length: 255 }).notNull().unique(),
    userId: varchar({ length: 255 }).notNull().references(() => usersTable.email),

    // User input
    prompt: text().notNull(),
    duration: integer().notNull().default(30),                    // 15, 30, 60 seconds
    aspectRatio: varchar("aspect_ratio", { length: 20 }).notNull().default("16:9"), // 16:9, 9:16, 1:1

    // Voiceover toggle + settings
    // Real boolean, not integer 0/1 — the type now enforces the two-value domain
    // the column always meant, so `if (row.voiceoverEnabled)` can't be silently
    // fed a 2 or a 7.
    voiceoverEnabled: boolean("voiceover_enabled").default(false),
    voice: varchar({ length: 100 }).default("rahul"),             // Sarvam voice ID
    language: varchar({ length: 20 }).default("en-IN"),

    // Music
    music: varchar({ length: 100 }).default("cinematic"),

    // Theme
    // { mode: 'preset' | 'custom', palette?: string, customColors?: string[],
    //   resolved: { bg, text, accent, secondary, gradient } }
    theme: jsonb(),
    // false = user hasn't confirmed a theme yet (pre-chat gate shows).
    // Gate also checks sceneData/videoUrl so pre-existing rows (backfilled to
    // false when this column was added) don't re-show the gate for projects that
    // already have content.
    themeConfirmed: boolean("theme_confirmed").default(false),

    // Generated data
    sceneData: jsonb("scene_data"),          // AI-generated scene breakdown (array of scenes)
    voiceoverScript: text("voiceover_script"), // Separate energetic narration text (NOT on-screen text)
    audioUrl: text("audio_url"),            // TTS voiceover audio URL
    audioDuration: real("audio_duration"),   // voiceover duration in seconds
    remotionProps: jsonb("remotion_props"),  // Final Remotion composition props

    // Output
    videoUrl: text("video_url"),
    thumbnailUrl: text("thumbnail_url"),
    // Per-theme render cache: Array<{ fingerprint: string; videoUrl: string; renderedAt: string }>.
    // Appended to on every completed render (not just the latest one) so
    // switching back to a previously-rendered theme can offer a direct
    // download instead of forcing a wasteful re-render.
    renderHistory: jsonb("render_history"),

    // Status
    status: varchar({ length: 50 }).default("draft"),
    // draft | generating:scenes | generating:assets | generating:voice | generating:video | completed | failed

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().$onUpdate(() => new Date()),
}, (t) => ([
    index("motion_graphic_projects_user_id_idx").on(t.userId),
]))

// ── Motion Graphic Chat Messages ────────────────────────────
export const motionGraphicMessages = pgTable("motion_graphic_messages", {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    projectId: varchar({ length: 255 }).notNull().references(() => motionGraphicProjects.projectId, { onDelete: "cascade" }),

    role: varchar({ length: 20 }).notNull(),   // 'user' | 'assistant' | 'system'
    content: text().notNull(),
    metadata: jsonb(),  // { type: 'scene_update' | 'status' | 'error', sceneData?, ... }

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (t) => ([
    // The chat transcript load: every message for a project, oldest first.
    index("motion_graphic_messages_project_id_idx").on(t.projectId, t.createdAt),
]))


// ── Notes Generator Projects ────────────────────────────────
export const notesProjects = pgTable("notes_projects", {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    noteId: varchar({ length: 255 }).notNull().unique(),
    userId: varchar({ length: 255 }).notNull().references(() => usersTable.email),

    // User input
    title: varchar({ length: 500 }).notNull(),
    sourceType: varchar("source_type", { length: 50 }).notNull(),  // 'text' | 'document' | 'topic' | 'url'
    sourceContent: text("source_content"),          // Raw user input text
    extractedContent: text("extracted_content"),     // After vision/parsing

    // Uploaded assets (images, charts, stats) — stored as JSON array of { url, description, type }
    uploadedAssets: jsonb("uploaded_assets"),

    // Style & design
    noteStyle: varchar("note_style", { length: 50 }).notNull().default("cornell"),
    // 'cornell' | 'mindmap' | 'flashcard' | 'infographic' | 'cheatsheet' | 'timeline'
    pageDesign: varchar("page_design", { length: 50 }).notNull().default("botanical"),
    // 'botanical' | 'abstractPastel' | 'geoPebbles' | 'elegantLeaf'

    // Generated output
    generatedData: jsonb("generated_data"),          // Structured JSON (sections, cards, etc.)
    generatedHtml: text("generated_html"),           // Rendered HTML string

    // Export
    exportUrl: text("export_url"),                   // PNG/PDF URL after export
    thumbnailUrl: text("thumbnail_url"),

    // Status
    status: varchar({ length: 50 }).default("draft"),
    // draft | generating | completed | failed

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().$onUpdate(() => new Date()),
}, (t) => ([
    index("notes_projects_user_id_idx").on(t.userId),
]))

// ── Chapter Generation Status ────────────────────────────────
// Tracks per-chapter generation progress for the course video content pipeline.
// Status flow: idle → queued → generating:slides → generating:audio → completed | failed
export const chapterGenerationStatus = pgTable("chapter_generation_status", {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    courseId: varchar({ length: 255 }).notNull().references(() => coursesTable.courseId, { onDelete: "cascade" }),
    chapterId: varchar({ length: 255 }).notNull().unique(),

    // Status: idle | queued | generating:slides | generating:audio | completed | failed
    status: varchar({ length: 50 }).default("idle").notNull(),

    // Slide HTML generation progress
    slidesComplete: integer("slides_complete").default(0).notNull(),
    slidesTotal: integer("slides_total").default(0).notNull(),

    // TTS audio generation progress
    audioComplete: integer("audio_complete").default(0).notNull(),

    // Error info (when status = failed)
    errorMessage: text("error_message"),

    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().$onUpdate(() => new Date()),

    // ── Video render fields (populated by GitHub Actions) ──────────────────────
    // Status: idle | rendering:video | video:completed | video:failed
    renderStatus: varchar("render_status", { length: 50 }).default("idle"),
    // Appwrite Storage URL of the final rendered MP4
    videoUrl: text("video_url"),
    // Render error details (when renderStatus = video:failed)
    renderError: text("render_error"),
    // 0-100 progress updated as each slide completes during GitHub Actions render
    renderProgress: integer("render_progress").default(0),
}, (t) => ([
    // The status-polling endpoint reads every chapter's status for one course
    // on an interval, so this index is hit far more often than any other.
    index("chapter_generation_status_course_id_idx").on(t.courseId),
]))

// ── A note on jsonb ──────────────────────────────────────────────────────────
// jsonb normalises what it stores: keys are reordered, whitespace is stripped,
// duplicate keys are dropped and numbers are canonicalised. That is harmless for
// every column above, because nothing here is re-serialised and re-hashed.
// If a webhook body is ever persisted for signature verification, verify it from
// the raw `await req.text()` bytes BEFORE parsing — re-hashing a jsonb round-trip
// will never reproduce the sender's signature.
