CREATE TABLE "chapter_content_slides" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "chapter_content_slides_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"courseId" varchar(255) NOT NULL,
	"chapterId" varchar(255) NOT NULL,
	"slideId" varchar(255) NOT NULL,
	"slideIndex" integer NOT NULL,
	"audioUrl" varchar(500),
	"imageUrl" varchar(500),
	"narration" json,
	"narrationUrl" varchar(500),
	"captions" json,
	"html" text,
	"htmlUrl" varchar(500),
	"revealData" json NOT NULL,
	"audio_duration" real,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "chapter_content_slides_slideId_unique" UNIQUE("slideId")
);
--> statement-breakpoint
CREATE TABLE "chapter_generation_status" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "chapter_generation_status_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"courseId" varchar(255) NOT NULL,
	"chapterId" varchar(255) NOT NULL,
	"status" varchar(50) DEFAULT 'idle' NOT NULL,
	"slides_complete" integer DEFAULT 0 NOT NULL,
	"slides_total" integer DEFAULT 0 NOT NULL,
	"audio_complete" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"started_at" timestamp,
	"completed_at" timestamp,
	"updated_at" timestamp DEFAULT now(),
	"render_status" varchar(50) DEFAULT 'idle',
	"video_url" text,
	"render_error" text,
	"render_progress" integer DEFAULT 0,
	CONSTRAINT "chapter_generation_status_chapterId_unique" UNIQUE("chapterId")
);
--> statement-breakpoint
CREATE TABLE "course_images" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "course_images_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"courseId" varchar(255) NOT NULL,
	"imageIndex" integer NOT NULL,
	"imagePrompt" varchar(500) NOT NULL,
	"imageUrl" varchar(1000) NOT NULL,
	"width" integer DEFAULT 1024,
	"height" integer DEFAULT 576,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "courses" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "courses_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"userId" varchar(255) NOT NULL,
	"courseId" varchar(255) NOT NULL,
	"courseName" varchar(255) NOT NULL,
	"userInput" varchar(255) NOT NULL,
	"type" varchar(255) NOT NULL,
	"voice" varchar(100) DEFAULT 'kabir',
	"courseLayout" json NOT NULL,
	"slide_topics" json,
	"created_at" timestamp DEFAULT now(),
	"courseThumbnail" text,
	CONSTRAINT "courses_courseId_unique" UNIQUE("courseId")
);
--> statement-breakpoint
CREATE TABLE "motion_graphic_messages" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "motion_graphic_messages_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"projectId" varchar(255) NOT NULL,
	"role" varchar(20) NOT NULL,
	"content" text NOT NULL,
	"metadata" json,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "motion_graphic_projects" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "motion_graphic_projects_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"projectId" varchar(255) NOT NULL,
	"userId" varchar(255) NOT NULL,
	"prompt" text NOT NULL,
	"duration" integer DEFAULT 30 NOT NULL,
	"aspect_ratio" varchar(20) DEFAULT '16:9' NOT NULL,
	"voiceover_enabled" integer DEFAULT 0,
	"voice" varchar(100) DEFAULT 'rahul',
	"language" varchar(20) DEFAULT 'en-IN',
	"music" varchar(100) DEFAULT 'cinematic',
	"theme" json,
	"theme_confirmed" integer DEFAULT 0,
	"scene_data" json,
	"voiceover_script" text,
	"audio_url" text,
	"audio_duration" real,
	"remotion_props" json,
	"video_url" text,
	"thumbnail_url" text,
	"render_history" json,
	"status" varchar(50) DEFAULT 'draft',
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "motion_graphic_projects_projectId_unique" UNIQUE("projectId")
);
--> statement-breakpoint
CREATE TABLE "notes_projects" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "notes_projects_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"noteId" varchar(255) NOT NULL,
	"userId" varchar(255) NOT NULL,
	"title" varchar(500) NOT NULL,
	"source_type" varchar(50) NOT NULL,
	"source_content" text,
	"extracted_content" text,
	"uploaded_assets" json,
	"note_style" varchar(50) DEFAULT 'cornell' NOT NULL,
	"page_design" varchar(50) DEFAULT 'botanical' NOT NULL,
	"generated_data" json,
	"generated_html" text,
	"export_url" text,
	"thumbnail_url" text,
	"status" varchar(50) DEFAULT 'draft',
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "notes_projects_noteId_unique" UNIQUE("noteId")
);
--> statement-breakpoint
CREATE TABLE "short_video_assets" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "short_video_assets_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"video_id" varchar(255) NOT NULL,
	"series_id" varchar(255) NOT NULL,
	"voice" varchar(100),
	"language" varchar(20),
	"video_title" varchar(500) NOT NULL,
	"script_data" json NOT NULL,
	"audio_url" text,
	"audio_duration" real,
	"caption_data" json,
	"image_urls" json,
	"scene_video_urls" json,
	"scene_video_durations" json,
	"scene_thumbnail_urls" json,
	"avatar_clip_urls" json,
	"scene_asset_types" json,
	"context_markdown" text,
	"video_url" text,
	"thumbnail_url" text,
	"status" varchar(50) DEFAULT 'completed',
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "short_video_assets_video_id_unique" UNIQUE("video_id")
);
--> statement-breakpoint
CREATE TABLE "short_video_progress" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "short_video_progress_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"seriesId" varchar(255) NOT NULL,
	"stepKey" varchar(100) NOT NULL,
	"taskId" varchar(255),
	"apiKey" varchar(500),
	"resultUrl" varchar(1000),
	"duration_sec" real,
	"status" varchar(30) DEFAULT 'submitted',
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "short_video_series" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "short_video_series_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"seriesId" varchar(255) NOT NULL,
	"userId" varchar(255) NOT NULL,
	"niche" varchar(500) NOT NULL,
	"language" varchar(20) NOT NULL,
	"voice" varchar(100) NOT NULL,
	"music" varchar(100) NOT NULL,
	"video_style" varchar(100) NOT NULL,
	"caption_style" varchar(100) NOT NULL,
	"title" varchar(500) NOT NULL,
	"duration" varchar(20) NOT NULL,
	"platform" varchar(50) NOT NULL,
	"publish_time" timestamp NOT NULL,
	"thumbnail_url" text,
	"status" varchar(50) DEFAULT 'pending',
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "short_video_series_seriesId_unique" UNIQUE("seriesId")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "users_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" varchar(255) NOT NULL,
	"email" varchar(255) NOT NULL,
	"credits" integer DEFAULT 2,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "chapter_content_slides" ADD CONSTRAINT "chapter_content_slides_courseId_courses_courseId_fk" FOREIGN KEY ("courseId") REFERENCES "public"."courses"("courseId") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapter_generation_status" ADD CONSTRAINT "chapter_generation_status_courseId_courses_courseId_fk" FOREIGN KEY ("courseId") REFERENCES "public"."courses"("courseId") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_images" ADD CONSTRAINT "course_images_courseId_courses_courseId_fk" FOREIGN KEY ("courseId") REFERENCES "public"."courses"("courseId") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_userId_users_email_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("email") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "motion_graphic_messages" ADD CONSTRAINT "motion_graphic_messages_projectId_motion_graphic_projects_projectId_fk" FOREIGN KEY ("projectId") REFERENCES "public"."motion_graphic_projects"("projectId") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "motion_graphic_projects" ADD CONSTRAINT "motion_graphic_projects_userId_users_email_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("email") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes_projects" ADD CONSTRAINT "notes_projects_userId_users_email_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("email") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "short_video_assets" ADD CONSTRAINT "short_video_assets_series_id_short_video_series_seriesId_fk" FOREIGN KEY ("series_id") REFERENCES "public"."short_video_series"("seriesId") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "short_video_progress" ADD CONSTRAINT "short_video_progress_seriesId_short_video_series_seriesId_fk" FOREIGN KEY ("seriesId") REFERENCES "public"."short_video_series"("seriesId") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "short_video_series" ADD CONSTRAINT "short_video_series_userId_users_email_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("email") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "progress_series_step_idx" ON "short_video_progress" USING btree ("seriesId","stepKey");