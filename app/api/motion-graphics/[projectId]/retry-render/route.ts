/**
 * POST /api/motion-graphics/[projectId]/retry-render
 * Triggers render-only Inngest function — skips image gen, Kling, voiceover.
 * Requires remotionProps to have been saved by a prior full-pipeline run.
 */

import { db } from "@/config/db";
import { motionGraphicProjects } from "@/config/schema";
import { inngest } from "@/inngest/client";
import { currentUser } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ projectId: string }> }
) {
    try {
        const user = await currentUser();
        if (!user?.primaryEmailAddress?.emailAddress) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { projectId } = await params;
        const userId = user.primaryEmailAddress.emailAddress;

        // Verify ownership and that remotionProps exist (i.e. pipeline ran at least once)
        const [project] = await db
            .select()
            .from(motionGraphicProjects)
            .where(
                and(
                    eq(motionGraphicProjects.projectId, projectId),
                    eq(motionGraphicProjects.userId, userId)
                )
            );

        if (!project) {
            return NextResponse.json({ error: "Project not found" }, { status: 404 });
        }

        if (!(project.remotionProps as any)?.scenes?.length) {
            return NextResponse.json(
                { error: "No saved props found. Run the full pipeline first before retrying render." },
                { status: 400 }
            );
        }

        if (project.status === "generating:video") {
            return NextResponse.json(
                { error: "Render already in progress" },
                { status: 409 }
            );
        }

        // Mark as rendering
        await db
            .update(motionGraphicProjects)
            .set({ status: "generating:video", updatedAt: new Date() })
            .where(eq(motionGraphicProjects.projectId, projectId));

        // Trigger render-only event
        await inngest.send({
            name: "motion-graphics/render.only",
            data: { projectId, userId },
        });

        console.log(`🔁 Render-only triggered for: ${projectId}`);

        return NextResponse.json({
            success: true,
            message: "Render started (skipping image gen, Kling, voiceover)",
            projectId,
        });
    } catch (error: any) {
        console.error("❌ retry-render error:", error);
        return NextResponse.json(
            { error: error.message || "Failed to start render" },
            { status: 500 }
        );
    }
}
