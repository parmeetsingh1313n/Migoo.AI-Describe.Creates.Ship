/**
 * Motion Graphics Prompt Enhancer API
 * POST: Rewrite a rough chat prompt into a structured, component-aware prompt
 *       using the NVIDIA model. Read-only — never mutates scenes.
 *
 * Body: { message: string, mode?: 'create'|'add'|'edit', targetSceneIndex?: number }
 * Returns: { success: true, enhanced: string }
 */

import { motionGraphicsLLM } from "@/lib/motion-graphics-llm";
import { db } from "@/config/db";
import { motionGraphicProjects } from "@/config/schema";
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
        const { message, mode, targetSceneIndex } = await req.json();

        if (typeof message !== "string") {
            return NextResponse.json({ error: "Message is required" }, { status: 400 });
        }

        // Verify project ownership + read current scenes for context
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

        const scenes = (project.sceneData as any[] | null) || [];
        const chatMode: 'create' | 'add' | 'edit' =
            mode === 'edit' || mode === 'add' || mode === 'create' ? mode : (scenes.length > 0 ? 'add' : 'create');

        const idx = Number.isInteger(targetSceneIndex) ? targetSceneIndex : null;
        const target =
            chatMode === 'edit' && idx !== null && idx >= 0 && idx < scenes.length
                ? { index: idx, type: scenes[idx]?.type, headline: scenes[idx]?.headline || scenes[idx]?.content }
                : null;

        const enhanced = await motionGraphicsLLM.enhancePrompt(message, {
            mode: chatMode,
            targetScene: target,
            sceneCount: scenes.length,
        });

        return NextResponse.json({ success: true, enhanced });
    } catch (error: any) {
        console.error("❌ Enhance-prompt error:", error);
        return NextResponse.json(
            { error: error.message || "Failed to enhance prompt" },
            { status: 500 }
        );
    }
}
