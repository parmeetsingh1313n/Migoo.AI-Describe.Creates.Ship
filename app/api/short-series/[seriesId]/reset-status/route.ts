import { db } from "@/config/db";
import { shortVideoSeries, shortVideoAssets } from "@/config/schema";
import { eq, and, or } from "drizzle-orm";
import { NextResponse } from "next/server";
import { inngest } from "@/inngest/client";

export async function POST(
    req: Request,
    { params }: { params: Promise<{ seriesId: string }> }
) {
    try {
        const { seriesId } = await params;

        console.log(`🧹 Manually resetting status for series: ${seriesId}`);

        // 0. Cancel any running Inngest jobs for this series immediately
        await inngest.send({
            name: "shorts/generate.cancel",
            data: { seriesId }
        });

        // 1. Reset series status to completed to hide generating UI
        await db.update(shortVideoSeries)
            .set({ status: "completed", updatedAt: new Date() })
            .where(eq(shortVideoSeries.seriesId, seriesId));

        // 2. completely DELETE any stuck/generating video assets so they don't show up in UI
        await db.delete(shortVideoAssets)
            .where(and(
                eq(shortVideoAssets.seriesId, seriesId),
                or(
                    eq(shortVideoAssets.status, "processing"),
                    eq(shortVideoAssets.status, "rendering")
                )
            ));

        return NextResponse.json({ success: true, message: "Status reset successfully" });
    } catch (error: any) {
        console.error("❌ Failed to reset status:", error);
        return NextResponse.json(
            { success: false, error: error.message },
            { status: 500 }
        );
    }
}
