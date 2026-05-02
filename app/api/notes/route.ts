/**
 * Notes Generator API — List & Create note projects
 * POST: Create a new note project
 * GET:  List user's note projects
 */

import { db, dbRetry } from "@/config/db";
import { notesProjects } from "@/config/schema";
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
            title,
            sourceType = "topic",
            sourceContent = "",
            noteStyle = "cornell",
            pageDesign = "botanical",
        } = body;

        if (!title || typeof title !== "string" || title.trim().length < 2) {
            return NextResponse.json(
                { error: "Title must be at least 2 characters" },
                { status: 400 }
            );
        }

        const noteId = `note_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;

        const [project] = await dbRetry(() =>
            db
                .insert(notesProjects)
                .values({
                    noteId,
                    userId: email,
                    title: title.trim(),
                    sourceType,
                    sourceContent: sourceContent || null,
                    noteStyle,
                    pageDesign,
                    status: "draft",
                })
                .returning()
        );

        console.log(`✅ Notes project created: ${noteId}`);

        return NextResponse.json({
            success: true,
            noteId,
            project,
        });
    } catch (error: any) {
        console.error("❌ Error creating notes project:", error);
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
            .from(notesProjects)
            .where(eq(notesProjects.userId, email))
            .orderBy(desc(notesProjects.createdAt));

        return NextResponse.json({ success: true, projects });
    } catch (error: any) {
        console.error("❌ Error listing notes projects:", error);
        return NextResponse.json(
            { error: error.message || "Failed to list projects" },
            { status: 500 }
        );
    }
}
