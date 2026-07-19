/**
 * TEST ENDPOINT: Trigger parallel slide generation for a specific chapter
 * POST /api/test-parallel-slides
 * Body: { courseId, chapterId }
 *
 * This is a temporary test endpoint to validate parallel slide generation.
 * Remove after testing is complete.
 */

import { inngest } from "@/inngest/client";
import { db } from "@/config/db";
import { chaptersTable, coursesTable } from "@/config/schema";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

export async function POST(req: NextRequest) {
    try {
        // Auth check
        const { userId } = await auth();
        if (!userId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { courseId, chapterId } = await req.json();
        if (!courseId || !chapterId) {
            return NextResponse.json(
                { error: "courseId and chapterId are required" },
                { status: 400 }
            );
        }

        // Load course
        const [course] = await db
            .select()
            .from(coursesTable)
            .where(eq(coursesTable.courseId, courseId));

        if (!course) {
            return NextResponse.json({ error: "Course not found" }, { status: 404 });
        }

        if (course.createdBy !== userId) {
            return NextResponse.json({ error: "Not authorized for this course" }, { status: 403 });
        }

        // Load chapter
        const [chapter] = await db
            .select()
            .from(chaptersTable)
            .where(eq(chaptersTable.chapterId, chapterId));

        if (!chapter) {
            return NextResponse.json({ error: "Chapter not found" }, { status: 404 });
        }

        // Find chapter index
        const allChapters = await db
            .select()
            .from(chaptersTable)
            .where(eq(chaptersTable.courseId, courseId));

        const chapterIndex = allChapters.findIndex(ch => ch.chapterId === chapterId);
        if (chapterIndex === -1) {
            return NextResponse.json({ error: "Chapter index not found" }, { status: 404 });
        }

        console.log(`🧪 TEST: Triggering PARALLEL slide generation for ${course.courseName} - ${chapter.chapterTitle}`);

        // Trigger parallel generation
        await inngest.send({
            name: "course/slides.generate.parallel",
            data: {
                chapter,
                courseId,
                courseName: course.courseName,
                chapterIndex,
            },
        });

        return NextResponse.json({
            success: true,
            message: `Parallel slide generation triggered for chapter: ${chapter.chapterTitle}`,
            chapterId,
            chapterIndex,
            event: "course/slides.generate.parallel",
            note: "Check Inngest dashboard or console logs for progress",
        });
    } catch (error: any) {
        console.error("❌ Test parallel slides error:", error);
        return NextResponse.json(
            { error: error.message || "Internal server error" },
            { status: 500 }
        );
    }
}
