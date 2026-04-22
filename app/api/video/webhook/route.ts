import { db } from "@/config/db";
import { shortVideoAssets } from "@/config/schema";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function PATCH(req: Request) {
    try {
        const { videoId, videoUrl, status } = await req.json();

        if (!videoId) {
            return NextResponse.json({ success: false, error: "Missing videoId" }, { status: 400 });
        }

        console.log(`🔔 Webhook received for video ${videoId}: status=${status}, url=${videoUrl}`);

        // Update the database with the final video URL and status
        await db.update(shortVideoAssets)
            .set({
                videoUrl: videoUrl || null,
                status: status || "completed",
            })
            .where(eq(shortVideoAssets.videoId, videoId));

        return NextResponse.json({ success: true, message: "Video status updated" });
    } catch (error: any) {
        console.error("Webhook error:", error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
