/**
 * Motion Graphics Project API — GET / PATCH / DELETE individual project
 */

import { db } from "@/config/db";
import { motionGraphicMessages, motionGraphicProjects } from "@/config/schema";
import { currentUser } from "@clerk/nextjs/server";
import { and, asc, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

/** Retry a DB call up to `attempts` times with exponential backoff */
async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
    let delay = 500;
    for (let i = 0; i < attempts; i++) {
        try {
            return await fn();
        } catch (err: any) {
            const isRetryable = /ECONNRESET|fetch failed|timeout|connect/i.test(err?.message || '');
            if (!isRetryable || i === attempts - 1) throw err;
            console.warn(`⚠️ DB retry ${i + 1}/${attempts - 1} in ${delay}ms: ${err.message?.slice(0, 80)}`);
            await new Promise(r => setTimeout(r, delay));
            delay *= 2;
        }
    }
    throw new Error('unreachable');
}

export async function GET(
    _req: NextRequest,
    { params }: { params: Promise<{ projectId: string }> }
) {
    try {
        const user = await currentUser();
        if (!user?.primaryEmailAddress?.emailAddress) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { projectId } = await params;

        // Fetch project with retry — critical for status polling
        const [project] = await withRetry(() =>
            db.select()
              .from(motionGraphicProjects)
              .where(
                  and(
                      eq(motionGraphicProjects.projectId, projectId),
                      eq(motionGraphicProjects.userId, user.primaryEmailAddress!.emailAddress)
                  )
              )
        );

        if (!project) {
            return NextResponse.json({ error: "Project not found" }, { status: 404 });
        }

        // Fetch chat messages — non-critical, return empty array on failure
        // so the status polling response always comes back quickly
        let messages: any[] = [];
        try {
            messages = await withRetry(() =>
                db.select()
                  .from(motionGraphicMessages)
                  .where(eq(motionGraphicMessages.projectId, projectId))
                  .orderBy(asc(motionGraphicMessages.createdAt))
            );
        } catch (msgErr: any) {
            console.warn(`⚠️ Messages query failed (non-fatal): ${msgErr.message?.slice(0, 80)}`);
        }

        return NextResponse.json({ success: true, project, messages });
    } catch (error: any) {
        console.error("❌ Error fetching project:", error?.message);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function PATCH(
    req: NextRequest,
    { params }: { params: Promise<{ projectId: string }> }
) {
    try {
        const user = await currentUser();
        if (!user?.primaryEmailAddress?.emailAddress) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { projectId } = await params;
        const body = await req.json();

        // Only allow updating safe fields
        const allowedFields: Record<string, any> = {};
        if (body.theme !== undefined) allowedFields.theme = body.theme;
        if (body.music !== undefined) allowedFields.music = body.music;
        if (body.voiceoverEnabled !== undefined) allowedFields.voiceoverEnabled = body.voiceoverEnabled ? 1 : 0;
        if (body.voice !== undefined) allowedFields.voice = body.voice;
        if (body.language !== undefined) allowedFields.language = body.language;
        if (body.prompt !== undefined) allowedFields.prompt = body.prompt;
        if (body.status !== undefined) allowedFields.status = body.status;

        allowedFields.updatedAt = new Date();

        const [updated] = await db
            .update(motionGraphicProjects)
            .set(allowedFields)
            .where(
                and(
                    eq(motionGraphicProjects.projectId, projectId),
                    eq(motionGraphicProjects.userId, user.primaryEmailAddress.emailAddress)
                )
            )
            .returning();

        if (!updated) {
            return NextResponse.json({ error: "Project not found" }, { status: 404 });
        }

        return NextResponse.json({ success: true, project: updated });
    } catch (error: any) {
        console.error("❌ Error updating project:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function DELETE(
    _req: NextRequest,
    { params }: { params: Promise<{ projectId: string }> }
) {
    try {
        const user = await currentUser();
        if (!user?.primaryEmailAddress?.emailAddress) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { projectId } = await params;

        // Delete messages first (FK constraint)
        await db
            .delete(motionGraphicMessages)
            .where(eq(motionGraphicMessages.projectId, projectId));

        // Delete project
        const [deleted] = await db
            .delete(motionGraphicProjects)
            .where(
                and(
                    eq(motionGraphicProjects.projectId, projectId),
                    eq(motionGraphicProjects.userId, user.primaryEmailAddress.emailAddress)
                )
            )
            .returning();

        if (!deleted) {
            return NextResponse.json({ error: "Project not found" }, { status: 404 });
        }

        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error("❌ Error deleting project:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
