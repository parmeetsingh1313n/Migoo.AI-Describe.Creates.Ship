/**
 * Notes Upload API — Upload images, charts, screenshots, PDFs
 * POST: Upload asset file, store via Appwrite, return URL
 */

import { db, dbRetry } from "@/config/db";
import { notesProjects } from "@/config/schema";
import { currentUser } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { putWithRotation } from "@/lib/blob";

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

        // Verify project exists
        const [project] = await db
            .select()
            .from(notesProjects)
            .where(eq(notesProjects.noteId, noteId));

        if (!project) {
            return NextResponse.json({ error: "Project not found" }, { status: 404 });
        }

        const formData = await req.formData();
        const file = formData.get("file") as File;

        if (!file) {
            return NextResponse.json({ error: "No file provided" }, { status: 400 });
        }

        // Upload to Appwrite
        const buffer = Buffer.from(await file.arrayBuffer());
        const ext = file.name.split(".").pop() || "png";
        const filename = `notes/${noteId}/${Date.now()}.${ext}`;

        const result = await putWithRotation(filename, buffer, {
            contentType: file.type,
            access: "public",
        });
        const url = result.url;

        // Add to project's uploaded assets
        const existingAssets = (project.uploadedAssets as any[]) || [];
        const newAsset = {
            url,
            name: file.name,
            type: file.type,
            uploadedAt: new Date().toISOString(),
        };

        await dbRetry(() =>
            db.update(notesProjects)
                .set({
                    uploadedAssets: [...existingAssets, newAsset],
                    updatedAt: new Date(),
                })
                .where(eq(notesProjects.noteId, noteId))
        );

        console.log(`✅ Asset uploaded for notes project ${noteId}: ${file.name}`);

        return NextResponse.json({
            success: true,
            url,
            asset: newAsset,
        });
    } catch (error: any) {
        console.error("❌ Notes upload failed:", error);
        return NextResponse.json(
            { error: error.message || "Upload failed" },
            { status: 500 }
        );
    }
}
