import { inngest } from "@/inngest/client";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { seriesId, customTopic, studioPayload } = body;

        if (!seriesId) {
            return NextResponse.json(
                { error: "seriesId is required" },
                { status: 400 }
            );
        }

        // studioPayload = { scriptData, sceneAssetTypes, sceneCustomUrls, captionStyle, voice, music, contextMarkdown }
        // When present, Inngest will skip Gemini script generation and use the pre-edited data.
        await inngest.send({
            name: "shorts/generate.video",
            data: {
                seriesId,
                ...(customTopic    ? { customTopic }    : {}),
                ...(studioPayload  ? { studioPayload }  : {}),
            },
        });

        return NextResponse.json({
            success: true,
            message: studioPayload ? "Studio video production launched!" : "Video generation started",
        });
    } catch (error: any) {
        console.error("Error triggering video generation:", error);
        return NextResponse.json(
            { error: error.message },
            { status: 500 }
        );
    }
}
