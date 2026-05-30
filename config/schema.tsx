import { boolean, integer, json, pgTable, real, text, timestamp, varchar } from "drizzle-orm/pg-core";

export const usersTable = pgTable("users", {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    name: varchar({ length: 255 }).notNull(),
    email: varchar({ length: 255 }).notNull().unique(),
    credits: integer().default(2)
});

export const coursesTable = pgTable("courses", {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    userId: varchar({ length: 255 }).notNull().references(() => usersTable.email),
    courseId: varchar({ length: 255 }).notNull().unique(),
    courseName: varchar({ length: 255 }).notNull(),
    userInput: varchar({ length: 255 }).notNull(),
    type: varchar({ length: 255 }).notNull(),
    courseLayout: json().notNull(),
    createdAt: timestamp("created_at").defaultNow(),
    courseThumbnail: text(),
})

export const courseImages = pgTable("course_images", {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    courseId: varchar({ length: 255 }).notNull().references(() => coursesTable.courseId),
    imageIndex: integer().notNull(),
    imagePrompt: varchar({ length: 500 }).notNull(),
    imageUrl: varchar({ length: 1000 }).notNull(),
    width: integer().default(1024),
    height: integer().default(576),
    createdAt: timestamp("created_at").defaultNow(),
})

export const chapterContentSlides = pgTable("chapter_content_slides", {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    courseId: varchar({ length: 255 }).notNull().references(() => coursesTable.courseId),
    chapterId: varchar({ length: 255 }).notNull(),
    slideId: varchar({ length: 255 }).notNull().unique(),
    slideIndex: integer().notNull(),
    audioUrl: varchar({ length: 500 }),
    imageUrl: varchar({ length: 500 }),
    narration: json().notNull(),
    captions: json(),
    html: text(),
    revealData: json().notNull(),
    audioDuration: real("audio_duration"),
    createdAt: timestamp("created_at").defaultNow(),
})

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
    publishTime: timestamp("publish_time").notNull(),

    // Thumbnail
    thumbnailUrl: text("thumbnail_url"),

    // Status tracking
    status: varchar({ length: 50 }).default("pending"), // pending | generating | completed | failed
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
})

// ── Short Video Generated Assets (one series → many videos) ─────
export const shortVideoAssets = pgTable("short_video_assets", {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    videoId: varchar("video_id", { length: 255 }).notNull().unique(),
    seriesId: varchar("series_id", { length: 255 }).notNull().references(() => shortVideoSeries.seriesId),

    // Voice & language (can be overridden per video, defaults to series)
    voice: varchar({ length: 100 }),
    language: varchar({ length: 20 }),

    // Script data from step 2
    videoTitle: varchar("video_title", { length: 500 }).notNull(),
    scriptData: json("script_data").notNull(),          // { totalScenes, scenes: [...] }

    // Audio data from step 3
    audioUrl: text("audio_url"),
    audioDuration: real("audio_duration"),               // seconds

    // Caption data from step 4
    captionData: json("caption_data"),                   // { transcript, wordTimestamps, segments }

    // Image data from step 5
    imageUrls: json("image_urls"),                       // ["url1", "url2", ...] per scene

    // Scene video data from step 5.25 (image-to-video conversion)
    sceneVideoUrls: json("scene_video_urls"),            // ["videoUrl1", "videoUrl2", ...] per scene
    sceneThumbnailUrls: json("scene_thumbnail_urls"),    // ["thumbUrl1", "thumbUrl2", ...] per scene

    // Avatar clip data from step 5.5
    avatarClipUrls: json("avatar_clip_urls"),            // ["", "", "url3", "", "", "url6"] per scene

    // Director's Chair Studio fields (nullable — normal series videos leave these unset)
    // Per-scene asset types: 'kling_video' | 'user_upload' | 'ai_image' | 'doc_image'
    sceneAssetTypes: json("scene_asset_types"),
    // Source context (Sarvam-extracted markdown or user-typed text) fed to Gemini
    contextMarkdown: text("context_markdown"),

    // Final rendered video
    videoUrl: text("video_url"),
    thumbnailUrl: text("thumbnail_url"),

    // Status
    status: varchar({ length: 50 }).default("completed"), // generating | completed | failed
    createdAt: timestamp("created_at").defaultNow(),
})

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
    voiceoverEnabled: integer("voiceover_enabled").default(0),    // 0 = off, 1 = on
    voice: varchar({ length: 100 }).default("rahul"),             // Sarvam voice ID
    language: varchar({ length: 20 }).default("en-IN"),

    // Music
    music: varchar({ length: 100 }).default("cinematic"),

    // Theme
    theme: json(),  // { palette: string, font: string, animationStyle: string }

    // Generated data
    sceneData: json("scene_data"),          // AI-generated scene breakdown (array of scenes)
    voiceoverScript: text("voiceover_script"), // Separate energetic narration text (NOT on-screen text)
    audioUrl: text("audio_url"),            // TTS voiceover audio URL
    audioDuration: real("audio_duration"),   // voiceover duration in seconds
    remotionProps: json("remotion_props"),   // Final Remotion composition props

    // Output
    videoUrl: text("video_url"),
    thumbnailUrl: text("thumbnail_url"),

    // Status
    status: varchar({ length: 50 }).default("draft"),
    // draft | generating:scenes | generating:assets | generating:voice | generating:video | completed | failed

    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
})

// ── Motion Graphic Chat Messages ────────────────────────────
export const motionGraphicMessages = pgTable("motion_graphic_messages", {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    projectId: varchar({ length: 255 }).notNull().references(() => motionGraphicProjects.projectId),

    role: varchar({ length: 20 }).notNull(),   // 'user' | 'assistant' | 'system'
    content: text().notNull(),
    metadata: json(),  // { type: 'scene_update' | 'status' | 'error', sceneData?, ... }

    createdAt: timestamp("created_at").defaultNow(),
})

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
    uploadedAssets: json("uploaded_assets"),

    // Style & design
    noteStyle: varchar("note_style", { length: 50 }).notNull().default("cornell"),
    // 'cornell' | 'mindmap' | 'flashcard' | 'infographic' | 'cheatsheet' | 'timeline'
    pageDesign: varchar("page_design", { length: 50 }).notNull().default("botanical"),
    // 'botanical' | 'abstractPastel' | 'geoPebbles' | 'elegantLeaf'

    // Generated output
    generatedData: json("generated_data"),          // Structured JSON (sections, cards, etc.)
    generatedHtml: text("generated_html"),           // Rendered HTML string

    // Export
    exportUrl: text("export_url"),                   // PNG/PDF URL after export
    thumbnailUrl: text("thumbnail_url"),

    // Status
    status: varchar({ length: 50 }).default("draft"),
    // draft | generating | completed | failed

    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
})

// ── Chapter Generation Status ────────────────────────────────
// Tracks per-chapter generation progress for the course video content pipeline.
// Status flow: idle → queued → generating:slides → generating:audio → completed | failed
export const chapterGenerationStatus = pgTable("chapter_generation_status", {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    courseId: varchar({ length: 255 }).notNull().references(() => coursesTable.courseId),
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

    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
    updatedAt: timestamp("updated_at").defaultNow(),
})
