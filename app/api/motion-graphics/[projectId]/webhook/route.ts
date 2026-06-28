/**
 * PATCH /api/motion-graphics/[projectId]/webhook
 *
 * Called by GitHub Actions after rendering and uploading to Appwrite.
 * Updates the motion graphic project's videoUrl and status.
 *
 * Auth: Authorization: Bearer WEBHOOK_SECRET
 * Body: { projectId, videoUrl, status }
 */

import { db } from "@/config/db";
import { motionGraphicMessages, motionGraphicProjects } from "@/config/schema";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 15;

export async function PATCH(
    req: NextRequest,
    { params }: { params: Promise<{ projectId: string }> }
) {
    try {
        // ── Auth guard ──────────────────────────────────────────────────────────
        const expectedSecret = process.env.WEBHOOK_SECRET;
        if (expectedSecret) {
            const authHeader = req.headers.get("authorization") ?? "";
            const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;
            if (token !== expectedSecret) {
                return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
            }
        }

        const { projectId } = await params;
        const body = await req.json();
        const { videoUrl, status } = body as { videoUrl?: string; status?: string };

        if (!projectId) {
            return NextResponse.json({ success: false, error: "Missing projectId" }, { status: 400 });
        }

        const finalStatus = status || "completed";
        console.log(`🔔 [motion-graphic/webhook] ${projectId}: status=${finalStatus}, url=${videoUrl?.slice(0, 60)}`);

        // Update project
        await db
            .update(motionGraphicProjects)
            .set({
                videoUrl: videoUrl || null,
                status: finalStatus,
                updatedAt: new Date(),
            })
            .where(eq(motionGraphicProjects.projectId, projectId));

        // Insert system message so the UI chat shows the result
        if (finalStatus === "completed" && videoUrl) {
            await db.insert(motionGraphicMessages).values({
                projectId,
                role: "system",
                content: `✅ Motion graphic video rendered successfully! Your video is ready to play.`,
                metadata: { type: "render_complete", videoUrl },
            });
        } else if (finalStatus === "failed") {
            await db.insert(motionGraphicMessages).values({
                projectId,
                role: "system",
                content: `❌ Video rendering failed. Please try again using the Re-render button.`,
                metadata: { type: "render_failed" },
            });
        }

        return NextResponse.json({ success: true, projectId, status: finalStatus });

    } catch (err: any) {
        console.error("[motion-graphic/webhook] Error:", err.message);
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}
