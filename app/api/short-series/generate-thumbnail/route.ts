/**
 * POST /api/short-series/generate-thumbnail
 *
 * Fire-and-return dispatcher — sends a `short-series/thumbnail.generate` Inngest
 * event and responds with 202 immediately.
 *
 * Why: gpt-image-2 via Flatkey takes 60–90 s which exceeds Vercel's function
 * timeout. The actual generation runs inside `generateShortSeriesThumbnailFn`
 * (inngest/functions.ts) where each `step.run()` gets unlimited wall-clock time.
 *
 * The frontend polls GET /api/short-series/[seriesId] (thumbnailUrl field)
 * every 5 s until the URL is populated in the DB by the Inngest function.
 */

import { inngest } from "@/inngest/client";
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 10; // Only needs to fire the event — very fast

export async function POST(req: NextRequest) {
    try {
        const { seriesId, title, niche } = await req.json();

        if (!seriesId || !title) {
            return NextResponse.json(
                { error: "seriesId and title are required" },
                { status: 400 }
            );
        }

        await inngest.send({
            name: "short-series/thumbnail.generate",
            data: { seriesId, title, niche: niche || "general" },
        });

        console.log(`📤 [generate-thumbnail] Queued Inngest job for series: ${seriesId}`);

        return NextResponse.json({ queued: true, seriesId }, { status: 202 });

    } catch (error: any) {
        console.error("🔥 [generate-thumbnail] Failed to queue:", error.message);
        return NextResponse.json(
            { success: false, error: error.message },
            { status: 500 }
        );
    }
}
