/**
 * GET /api/motion-graphics/[projectId]/props
 *
 * Fetches the Remotion composition props for a motion graphic project.
 * Called by GitHub Actions before rendering — returns the saved remotionProps JSON.
 *
 * Auth: Authorization: Bearer WEBHOOK_SECRET
 */

import { db } from "@/config/db";
import { motionGraphicProjects } from "@/config/schema";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 10;

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ projectId: string }> }
) {
    try {
        // ── Auth guard (shared-secret, same pattern as /api/video/props) ──────
        const expectedSecret = process.env.WEBHOOK_SECRET;
        if (expectedSecret) {
            const authHeader = req.headers.get("authorization") ?? "";
            const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;
            if (token !== expectedSecret) {
                return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
            }
        }

        const { projectId } = await params;

        const [project] = await db
            .select({
                projectId:    motionGraphicProjects.projectId,
                remotionProps: motionGraphicProjects.remotionProps,
                aspectRatio:  motionGraphicProjects.aspectRatio,
                status:       motionGraphicProjects.status,
            })
            .from(motionGraphicProjects)
            .where(eq(motionGraphicProjects.projectId, projectId));

        if (!project) {
            return NextResponse.json({ success: false, error: "Project not found" }, { status: 404 });
        }

        if (!project.remotionProps) {
            return NextResponse.json(
                { success: false, error: "remotionProps not ready yet — pipeline still running" },
                { status: 404 }
            );
        }

        console.log(`📦 [props] Serving remotionProps for motion graphic: ${projectId}`);
        return NextResponse.json(project.remotionProps);

    } catch (err: any) {
        console.error("[motion-graphic/props] Error:", err.message);
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}
