/**
 * Motion Graphics API — List & Create projects
 * POST: Create a new motion graphic project
 * GET:  List user's motion graphic projects
 */

import { db, dbRetry } from "@/config/db";
import { motionGraphicMessages, motionGraphicProjects } from "@/config/schema";
import { currentUser } from "@clerk/nextjs/server";
import { desc, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";


export async function POST(req: NextRequest) {
    try {
        const user = await currentUser();
        if (!user?.primaryEmailAddress?.emailAddress) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        const email = user.primaryEmailAddress.emailAddress;

        const body = await req.json();
        const {
            prompt,
            duration = 30,
            aspectRatio = "16:9",
            voiceoverEnabled = false,
            voice = "rahul",
            language = "en-IN",
            music = "cinematic",
            theme = null,
        } = body;

        if (!prompt || typeof prompt !== "string" || prompt.trim().length < 5) {
            return NextResponse.json(
                { error: "Prompt must be at least 5 characters" },
                { status: 400 }
            );
        }

        const projectId = `mg_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;

        const [project] = await dbRetry(() =>
            db
                .insert(motionGraphicProjects)
                .values({
                    projectId,
                    userId: email,
                    prompt: prompt.trim(),
                    duration,
                    aspectRatio,
                    voiceoverEnabled: voiceoverEnabled ? 1 : 0,
                    voice,
                    language,
                    music,
                    theme,
                    status: "draft",
                })
                .returning()
        );

        // Insert initial system message
        await dbRetry(() =>
            db.insert(motionGraphicMessages).values({
                projectId,
                role: "system",
                content: `Project created: "${prompt.trim().substring(0, 100)}" — ${duration}s, ${aspectRatio}`,
                metadata: { type: "project_created" },
            })
        );

        console.log(`✅ Motion graphic project created: ${projectId}`);

        return NextResponse.json({
            success: true,
            projectId,
            project,
        });
    } catch (error: any) {
        console.error("❌ Error creating motion graphic project:", error);
        return NextResponse.json(
            { error: error.message || "Failed to create project" },
            { status: 500 }
        );
    }
}

export async function GET() {
    try {
        const user = await currentUser();
        if (!user?.primaryEmailAddress?.emailAddress) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        const email = user.primaryEmailAddress.emailAddress;

        const projects = await db
            .select()
            .from(motionGraphicProjects)
            .where(eq(motionGraphicProjects.userId, email))
            .orderBy(desc(motionGraphicProjects.createdAt));

        return NextResponse.json({ success: true, projects });
    } catch (error: any) {
        console.error("❌ Error listing motion graphic projects:", error);
        return NextResponse.json(
            { error: error.message || "Failed to list projects" },
            { status: 500 }
        );
    }
}
