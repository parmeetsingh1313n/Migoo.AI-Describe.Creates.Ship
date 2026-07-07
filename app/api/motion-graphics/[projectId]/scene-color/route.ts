/**
 * Per-Scene Color Override API for Motion Graphics
 *
 * POST: Set a specific scene's colors, overriding the project's global theme
 *   for that scene only. Deterministic — no LLM call needed, this just writes
 *   sceneData[sceneIndex].colors + customColors:true directly (the render only
 *   honors scene.colors when customColors is set — see
 *   remotion/MotionGraphicComposition.tsx).
 * DELETE (?sceneIndex=N): clear the override so the scene falls back to
 *   following the global theme again.
 */

import { db } from "@/config/db";
import { motionGraphicProjects } from "@/config/schema";
import { currentUser } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import type { ResolvedPalette } from "@/lib/theme-palette";

async function ownProject(projectId: string, email: string) {
    const [project] = await db
        .select()
        .from(motionGraphicProjects)
        .where(and(eq(motionGraphicProjects.projectId, projectId), eq(motionGraphicProjects.userId, email)))
        .limit(1);
    return project;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
    try {
        const user = await currentUser();
        const email = user?.primaryEmailAddress?.emailAddress;
        if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const { projectId } = await params;
        const project = await ownProject(projectId, email);
        if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

        const body = await req.json();
        const sceneIndex = Number(body?.sceneIndex);
        const colors = body?.colors as Partial<ResolvedPalette> | undefined;

        const scenes = (project.sceneData as any[]) || [];
        if (!Number.isInteger(sceneIndex) || sceneIndex < 0 || sceneIndex >= scenes.length) {
            return NextResponse.json({ error: "Invalid sceneIndex" }, { status: 400 });
        }
        if (!colors || typeof colors !== "object") {
            return NextResponse.json({ error: "colors object is required" }, { status: 400 });
        }

        scenes[sceneIndex] = {
            ...scenes[sceneIndex],
            colors: { bg: colors.bg, text: colors.text, accent: colors.accent, secondary: colors.secondary },
            customColors: true,
        };

        await db
            .update(motionGraphicProjects)
            .set({ sceneData: scenes, status: "draft", videoUrl: null, remotionProps: null, updatedAt: new Date() })
            .where(eq(motionGraphicProjects.projectId, projectId));

        return NextResponse.json({ success: true, sceneIndex, scene: scenes[sceneIndex] });
    } catch (err: any) {
        console.error("[scene-color] POST error:", err?.message || err);
        return NextResponse.json({ error: err?.message || "Failed to set scene colors" }, { status: 500 });
    }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
    try {
        const user = await currentUser();
        const email = user?.primaryEmailAddress?.emailAddress;
        if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const { projectId } = await params;
        const project = await ownProject(projectId, email);
        if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

        const sceneIndex = Number(req.nextUrl.searchParams.get("sceneIndex"));
        const scenes = (project.sceneData as any[]) || [];
        if (!Number.isInteger(sceneIndex) || sceneIndex < 0 || sceneIndex >= scenes.length) {
            return NextResponse.json({ error: "Invalid sceneIndex" }, { status: 400 });
        }

        const scene = { ...scenes[sceneIndex] };
        delete scene.colors;
        delete scene.customColors;
        scenes[sceneIndex] = scene;

        await db
            .update(motionGraphicProjects)
            .set({ sceneData: scenes, status: "draft", videoUrl: null, remotionProps: null, updatedAt: new Date() })
            .where(eq(motionGraphicProjects.projectId, projectId));

        return NextResponse.json({ success: true, sceneIndex });
    } catch (err: any) {
        console.error("[scene-color] DELETE error:", err?.message || err);
        return NextResponse.json({ error: err?.message || "Failed to reset scene colors" }, { status: 500 });
    }
}
