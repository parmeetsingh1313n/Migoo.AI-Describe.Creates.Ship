import { inngest } from "@/inngest/client";
import { generateCourseImagesFn, generateCourseThumbnailFn, generateCourseVideoContentFn } from "@/inngest/course-functions";
import { generateMotionGraphic, generateShortVideo, helloWorld, renderMotionGraphicOnly } from "@/inngest/functions";
import { serve } from "inngest/next";

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
