import { inngest } from "@/inngest/client";
import { generateCourseImagesFn, generateCourseThumbnailFn, generateCourseVideoContentFn } from "@/inngest/course-functions";
import { generateMotionGraphic, generateShortVideo, generateShortSeriesThumbnailFn, helloWorld, renderMotionGraphicOnly } from "@/inngest/functions";
import { serve } from "inngest/next";

// Inngest requires a long maxDuration so each step.run() gets enough time.
// Deep-crawl RAG + LLM distillation can take ~80s; script generation ~40s.
// 900s (15 min) is the maximum supported value for serverless functions on Vercel Enterprise/Pro custom configurations.
export const maxDuration = 900;

export const { GET, POST, PUT } = serve({
    client: inngest,
    functions: [
        // ── Short Video & Motion Graphics ─────────────────────────────────
        helloWorld,
        generateShortVideo,
        generateShortSeriesThumbnailFn,
        generateMotionGraphic,
        renderMotionGraphicOnly,

        // ── Course Generation ─────────────────────────────────────────────
        generateCourseThumbnailFn,
        generateCourseImagesFn,
        generateCourseVideoContentFn,
    ],
});
