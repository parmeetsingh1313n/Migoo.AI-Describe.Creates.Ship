import { db } from "@/config/db";
import { shortVideoAssets } from "@/config/schema";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function GET(req: Request) {
    try {
        const { searchParams } = new URL(req.url);
        const videoId = searchParams.get("videoId");

        if (!videoId) {
            return NextResponse.json({ success: false, error: "Missing videoId" }, { status: 400 });
        }

        const [video] = await db.select().from(shortVideoAssets).where(eq(shortVideoAssets.videoId, videoId));
        
        if (!video) {
            return NextResponse.json({ success: false, error: "Video not found" }, { status: 404 });
        }

        return NextResponse.json({ success: true, video });
    } catch (error: any) {
        console.error("❌ Video status API error:", error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
