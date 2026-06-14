import { inngest } from "@/inngest/client";
import { generateCourseImagesFn, generateCourseThumbnailFn, generateCourseVideoContentFn } from "@/inngest/course-functions";
import { generateMotionGraphic, generateShortVideo, helloWorld, renderMotionGraphicOnly } from "@/inngest/functions";
import { serve } from "inngest/next";

// Tell Vercel to keep this serverless function alive for up to 60s.
// Inngest handles short timeouts gracefully via step-resumption, so
// a lower value is safer than a very high one (which can cause real blocking).
export const maxDuration = 60;

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
