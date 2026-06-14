import { inngest } from "@/inngest/client";
import { generateCourseImagesFn, generateCourseThumbnailFn, generateCourseVideoContentFn } from "@/inngest/course-functions";
import { generateMotionGraphic, generateShortVideo, helloWorld, renderMotionGraphicOnly } from "@/inngest/functions";
import { serve } from "inngest/next";

// Tell Vercel to keep this serverless function alive for up to 5 minutes.
// This reduces spurious FUNCTION_INVOCATION_TIMEOUT errors in the Inngest dashboard
// while Inngest waits for long-running steps (e.g. GitHub Actions renders).
// NOTE: Vercel Hobby is hard-capped at 10s regardless of this value;
//       Pro/Enterprise supports up to 300s.
export const maxDuration = 300;

export const { GET, POST, PUT } = serve({
    client: inngest,
    functions: [
        // ── Short Video & Motion Graphics ─────────────────────────────────
        helloWorld,
        generateShortVideo,
        generateMotionGraphic,
        renderMotionGraphicOnly,

        // ── Course Generation ─────────────────────────────────────────────
        generateCourseThumbnailFn,
        generateCourseImagesFn,
        generateCourseVideoContentFn,
    ],
});
