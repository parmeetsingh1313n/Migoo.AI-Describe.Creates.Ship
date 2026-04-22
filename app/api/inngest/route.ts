import { inngest } from "@/inngest/client";
import { generateMotionGraphic, generateShortVideo, helloWorld } from "@/inngest/functions";
import { serve } from "inngest/next";

export const { GET, POST, PUT } = serve({
    client: inngest,
    functions: [
        helloWorld,
        generateShortVideo,
        generateMotionGraphic,
    ],
});
