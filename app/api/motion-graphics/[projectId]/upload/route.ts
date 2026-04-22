/**
 * Image Upload API for Motion Graphics Chat
 * POST: Upload a reference image, analyzes with Groq Vision, and saves to Appwrite Storage.
 */

import { currentUser } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { putWithRotation } from "@/lib/blob";
import { groq } from "@/config/groq";

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
        const formData = await req.formData();
        const file = formData.get("file") as File | null;

        if (!file) {
            return NextResponse.json({ error: "No file provided" }, { status: 400 });
        }

        if (!file.type.startsWith("image/")) {
            return NextResponse.json({ error: "Only images allowed" }, { status: 400 });
        }

        // Convert file to Buffer
        const buffer = Buffer.from(await file.arrayBuffer());

        // 1. Upload to Appwrite Storage
        const ext = file.name.split(".").pop() || "jpg";
        const filename = `motion-graphics/${projectId}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
        const blobResult = await putWithRotation(filename, buffer, {
            access: "public",
            contentType: file.type,
        });

        // 2. Analyze with Groq Vision
        const base64Image = buffer.toString("base64");
        const dataUrl = `data:${file.type};base64,${base64Image}`;

        let description = "Image uploaded successfully.";
        try {
            description = await groq.captionImage(
                dataUrl,
                "Analyze this uploaded image for a professional motion graphics video. What is it? (e.g. a logo, a product shot, a UI mockup, etc.). How should it best be featured in the video? Keep it brief (2-3 sentences)."
            );
        } catch (visionErr: any) {
            console.error("Groq Vision error:", visionErr.message);
            // Non-fatal, just fallback to default description
        }

        return NextResponse.json({ 
            success: true, 
            url: blobResult.url, 
            name: file.name,
            description: description.trim()
        });
    } catch (err: any) {
        console.error("❌ Upload error:", err?.message || err);
        console.error("❌ Upload stack:", err?.stack?.slice(0, 500));
        return NextResponse.json({ error: err?.message || "Upload failed" }, { status: 500 });
    }
}
