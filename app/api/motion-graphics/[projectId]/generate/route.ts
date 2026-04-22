/**
 * Motion Graphics Generate API
 * POST: Trigger the Inngest background pipeline to generate the motion graphic video
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

        // Verify project ownership & has scenes
        const [project] = await db
            .select()
            .from(motionGraphicProjects)
            .where(
                and(
                    eq(motionGraphicProjects.projectId, projectId),
                    eq(motionGraphicProjects.userId, user.primaryEmailAddress.emailAddress)
                )
            );

        if (!project) {
            return NextResponse.json({ error: "Project not found" }, { status: 404 });
        }

        if (!project.sceneData) {
            return NextResponse.json(
                { error: "No scenes generated yet. Chat with the AI first to create scene breakdown." },
                { status: 400 }
            );
        }

        if (project.status?.startsWith("generating")) {
            return NextResponse.json(
                { error: "Generation already in progress" },
                { status: 409 }
            );
        }

        // Update status to generating
        await db
            .update(motionGraphicProjects)
            .set({ status: "generating:scenes", updatedAt: new Date() })
            .where(eq(motionGraphicProjects.projectId, projectId));

        // Send Inngest event
        await inngest.send({
            name: "motion-graphics/generate.video",
            data: {
                projectId,
                userId: user.primaryEmailAddress.emailAddress,
            },
        });

        console.log(`🚀 Motion graphic generation triggered for: ${projectId}`);

        return NextResponse.json({
            success: true,
            message: "Generation started",
            projectId,
        });
    } catch (error: any) {
        console.error("❌ Error triggering generation:", error);
        return NextResponse.json(
            { error: error.message || "Failed to start generation" },
            { status: 500 }
        );
    }
}
