/**
 * Notes Project — Delete endpoint
 */

import { db } from "@/config/db";
import { notesProjects } from "@/config/schema";
import { currentUser } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

export async function DELETE(
    _req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const user = await currentUser();
        if (!user?.primaryEmailAddress?.emailAddress) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        const { id: noteId } = await params;

        await db
            .delete(notesProjects)
            .where(
                and(
                    eq(notesProjects.noteId, noteId),
                    eq(notesProjects.userId, user.primaryEmailAddress.emailAddress)
                )
            );

        return NextResponse.json({ success: true });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function PATCH(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const user = await currentUser();
        if (!user?.primaryEmailAddress?.emailAddress) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        const { id: noteId } = await params;
        const body = await req.json();
        const { pageDesign, noteStyle } = body;

        const updateData: Record<string, any> = { updatedAt: new Date() };
        if (pageDesign) updateData.pageDesign = pageDesign;
        if (noteStyle) updateData.noteStyle = noteStyle;

        await db
            .update(notesProjects)
            .set(updateData)
            .where(eq(notesProjects.noteId, noteId));

        return NextResponse.json({ success: true });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function GET(
    _req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const user = await currentUser();
        if (!user?.primaryEmailAddress?.emailAddress) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        const { id: noteId } = await params;

        const [project] = await db
            .select()
            .from(notesProjects)
            .where(eq(notesProjects.noteId, noteId));

        if (!project) {
            return NextResponse.json({ error: "Not found" }, { status: 404 });
        }

        return NextResponse.json({ success: true, project });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
