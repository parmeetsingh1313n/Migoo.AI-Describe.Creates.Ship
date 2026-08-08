-- ─────────────────────────────────────────────────────────────────────────────
-- 0001_harden_schema
--
-- HAND-EDITED after `drizzle-kit generate`. Three corrections were required;
-- do not regenerate this file over the top of them:
--
--   1. integer -> boolean has NO automatic cast in Postgres. The generated
--      `SET DATA TYPE boolean` would abort with
--        ERROR: column "voiceover_enabled" cannot be cast automatically to type boolean
--      Fixed with an explicit USING (col <> 0), and by dropping the integer
--      DEFAULT 0 first — Postgres cannot cast a column default either.
--
--   2. timestamp -> timestamptz DOES have an automatic cast, but it interprets
--      the existing naive values using the SESSION's TimeZone setting. That makes
--      the result depend on connection config. Every conversion below is pinned
--      with `AT TIME ZONE 'UTC'` instead, which is correct because the app writes
--      JS `new Date()` (UTC) and Neon stores/returns UTC. Values are unchanged;
--      only the declared type does.
--
--   3. DROP CONSTRAINT gained IF EXISTS. These tables were built with
--      `drizzle-kit push`, so constraint names were never verified against a
--      migration history. IF EXISTS keeps a name mismatch from aborting the
--      whole transaction before the re-ADD.
--
-- json -> jsonb needs no USING: Postgres registers an assignment cast, and the
-- stored text is already valid JSON by construction.
--
-- Indexes use plain CREATE INDEX (brief write lock, negligible at this data
-- volume). CREATE INDEX CONCURRENTLY cannot be used here — it is illegal inside
-- a transaction block, and drizzle-kit wraps each migration in one.
-- ─────────────────────────────────────────────────────────────────────────────

--> Drop FKs so they can be re-added with ON DELETE CASCADE
ALTER TABLE "chapter_content_slides" DROP CONSTRAINT IF EXISTS "chapter_content_slides_courseId_courses_courseId_fk";
--> statement-breakpoint
ALTER TABLE "chapter_generation_status" DROP CONSTRAINT IF EXISTS "chapter_generation_status_courseId_courses_courseId_fk";
--> statement-breakpoint
ALTER TABLE "course_images" DROP CONSTRAINT IF EXISTS "course_images_courseId_courses_courseId_fk";
--> statement-breakpoint
ALTER TABLE "motion_graphic_messages" DROP CONSTRAINT IF EXISTS "motion_graphic_messages_projectId_motion_graphic_projects_projectId_fk";
--> statement-breakpoint
ALTER TABLE "short_video_assets" DROP CONSTRAINT IF EXISTS "short_video_assets_series_id_short_video_series_seriesId_fk";
--> statement-breakpoint
ALTER TABLE "short_video_progress" DROP CONSTRAINT IF EXISTS "short_video_progress_seriesId_short_video_series_seriesId_fk";
--> statement-breakpoint

--> json -> jsonb
ALTER TABLE "chapter_content_slides" ALTER COLUMN "narration" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "chapter_content_slides" ALTER COLUMN "captions" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "chapter_content_slides" ALTER COLUMN "revealData" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "courses" ALTER COLUMN "courseLayout" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "courses" ALTER COLUMN "slide_topics" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "motion_graphic_messages" ALTER COLUMN "metadata" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "motion_graphic_projects" ALTER COLUMN "theme" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "motion_graphic_projects" ALTER COLUMN "scene_data" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "motion_graphic_projects" ALTER COLUMN "remotion_props" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "motion_graphic_projects" ALTER COLUMN "render_history" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "notes_projects" ALTER COLUMN "uploaded_assets" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "notes_projects" ALTER COLUMN "generated_data" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "short_video_assets" ALTER COLUMN "script_data" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "short_video_assets" ALTER COLUMN "caption_data" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "short_video_assets" ALTER COLUMN "image_urls" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "short_video_assets" ALTER COLUMN "scene_video_urls" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "short_video_assets" ALTER COLUMN "scene_video_durations" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "short_video_assets" ALTER COLUMN "scene_thumbnail_urls" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "short_video_assets" ALTER COLUMN "avatar_clip_urls" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "short_video_assets" ALTER COLUMN "scene_asset_types" SET DATA TYPE jsonb;--> statement-breakpoint

--> integer 0/1 -> boolean (explicit USING; default dropped then restored)
ALTER TABLE "motion_graphic_projects" ALTER COLUMN "voiceover_enabled" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "motion_graphic_projects" ALTER COLUMN "voiceover_enabled" SET DATA TYPE boolean USING ("voiceover_enabled" <> 0);--> statement-breakpoint
ALTER TABLE "motion_graphic_projects" ALTER COLUMN "voiceover_enabled" SET DEFAULT false;--> statement-breakpoint
ALTER TABLE "motion_graphic_projects" ALTER COLUMN "theme_confirmed" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "motion_graphic_projects" ALTER COLUMN "theme_confirmed" SET DATA TYPE boolean USING ("theme_confirmed" <> 0);--> statement-breakpoint
ALTER TABLE "motion_graphic_projects" ALTER COLUMN "theme_confirmed" SET DEFAULT false;--> statement-breakpoint

--> timestamp -> timestamptz (existing naive values are already UTC)
ALTER TABLE "chapter_content_slides" ALTER COLUMN "created_at" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "chapter_content_slides" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "chapter_content_slides" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "chapter_generation_status" ALTER COLUMN "started_at" SET DATA TYPE timestamp with time zone USING "started_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "chapter_generation_status" ALTER COLUMN "completed_at" SET DATA TYPE timestamp with time zone USING "completed_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "chapter_generation_status" ALTER COLUMN "updated_at" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "chapter_generation_status" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone USING "updated_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "chapter_generation_status" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "course_images" ALTER COLUMN "created_at" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "course_images" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "course_images" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "courses" ALTER COLUMN "created_at" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "courses" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "courses" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "motion_graphic_messages" ALTER COLUMN "created_at" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "motion_graphic_messages" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "motion_graphic_messages" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "motion_graphic_projects" ALTER COLUMN "created_at" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "motion_graphic_projects" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "motion_graphic_projects" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "motion_graphic_projects" ALTER COLUMN "updated_at" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "motion_graphic_projects" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone USING "updated_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "motion_graphic_projects" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "notes_projects" ALTER COLUMN "created_at" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "notes_projects" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "notes_projects" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "notes_projects" ALTER COLUMN "updated_at" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "notes_projects" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone USING "updated_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "notes_projects" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "short_video_assets" ALTER COLUMN "created_at" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "short_video_assets" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "short_video_assets" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "short_video_progress" ALTER COLUMN "created_at" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "short_video_progress" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "short_video_progress" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "short_video_progress" ALTER COLUMN "updated_at" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "short_video_progress" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone USING "updated_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "short_video_progress" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "short_video_series" ALTER COLUMN "publish_time" SET DATA TYPE timestamp with time zone USING "publish_time" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "short_video_series" ALTER COLUMN "created_at" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "short_video_series" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "short_video_series" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "short_video_series" ALTER COLUMN "updated_at" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "short_video_series" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone USING "updated_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "short_video_series" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint

--> Re-add FKs with ON DELETE CASCADE
ALTER TABLE "chapter_content_slides" ADD CONSTRAINT "chapter_content_slides_courseId_courses_courseId_fk" FOREIGN KEY ("courseId") REFERENCES "public"."courses"("courseId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapter_generation_status" ADD CONSTRAINT "chapter_generation_status_courseId_courses_courseId_fk" FOREIGN KEY ("courseId") REFERENCES "public"."courses"("courseId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_images" ADD CONSTRAINT "course_images_courseId_courses_courseId_fk" FOREIGN KEY ("courseId") REFERENCES "public"."courses"("courseId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "motion_graphic_messages" ADD CONSTRAINT "motion_graphic_messages_projectId_motion_graphic_projects_projectId_fk" FOREIGN KEY ("projectId") REFERENCES "public"."motion_graphic_projects"("projectId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "short_video_assets" ADD CONSTRAINT "short_video_assets_series_id_short_video_series_seriesId_fk" FOREIGN KEY ("series_id") REFERENCES "public"."short_video_series"("seriesId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "short_video_progress" ADD CONSTRAINT "short_video_progress_seriesId_short_video_series_seriesId_fk" FOREIGN KEY ("seriesId") REFERENCES "public"."short_video_series"("seriesId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

--> Index every foreign-key SOURCE column. Postgres indexes the TARGET
--> automatically (via its PK/unique), but never the source.
CREATE INDEX IF NOT EXISTS "chapter_slides_course_chapter_idx" ON "chapter_content_slides" USING btree ("courseId","chapterId","slideIndex");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chapter_generation_status_course_id_idx" ON "chapter_generation_status" USING btree ("courseId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "course_images_course_id_idx" ON "course_images" USING btree ("courseId","imageIndex");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "courses_user_id_idx" ON "courses" USING btree ("userId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "motion_graphic_messages_project_id_idx" ON "motion_graphic_messages" USING btree ("projectId","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "motion_graphic_projects_user_id_idx" ON "motion_graphic_projects" USING btree ("userId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notes_projects_user_id_idx" ON "notes_projects" USING btree ("userId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "short_video_assets_series_id_idx" ON "short_video_assets" USING btree ("series_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "short_video_series_user_id_idx" ON "short_video_series" USING btree ("userId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "short_video_series_status_publish_idx" ON "short_video_series" USING btree ("status","publish_time");
