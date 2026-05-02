/**
 * Notes Image Generation API Route
 * POST /api/notes/[id]/generate-images
 *
 * Thin wrapper around the shared generateNotesImages() function.
 * Can be called manually to regenerate images for a note.
 */

import { currentUser } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { generateNotesImages } from "@/lib/notes-image-gen";

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const user = await currentUser();
        if (!user?.primaryEmailAddress?.emailAddress) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { id: noteId } = await params;

        const result = await generateNotesImages(noteId);

        if (!result.success) {
            return NextResponse.json({ error: result.error }, { status: 500 });
        }

        return NextResponse.json({
            success: true,
            noteId,
            model: result.model,
            imagesGenerated: result.imagesGenerated,
        });
    } catch (error: any) {
        console.error("❌ Notes image generation failed:", error);
        return NextResponse.json(
            { error: error.message || "Image generation failed" },
            { status: 500 }
        );
    }
}
