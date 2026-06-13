/**
 * Image Upload API for Motion Graphics Chat
 * POST: Upload a reference image, analyzes with Groq Vision, and saves to Appwrite Storage.
 * Assets are stored in a dedicated DB system message (not embedded in chat text).
 */

import { db } from "@/config/db";
import { motionGraphicMessages } from "@/config/schema";
import { currentUser } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
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

        // 1. Upload to Blob Storage
        const ext = file.name.split(".").pop() || "jpg";
        const filename = `motion-graphics/${projectId}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
        const blobResult = await putWithRotation(filename, buffer, {
            access: "public",
            contentType: file.type,
        });

        // 2. Analyze with Groq Vision — structured output for reliable injection
        const base64Image = buffer.toString("base64");
        const dataUrl = `data:${file.type};base64,${base64Image}`;

        let description = "Reference image uploaded by user.";
        let category: "logo" | "screenshot" | "product" | "person" | "other" = "other";
        try {
            const raw = await groq.captionImage(
                dataUrl,
                `You are analyzing an uploaded image for a motion graphics video editor. 
Respond in EXACTLY this format (two lines, no extra text):
CATEGORY: <one of: logo | screenshot | product | person | other>
DESCRIPTION: <1-2 sentences describing what you see and how it should be used in the video>

Examples:
CATEGORY: logo
DESCRIPTION: A purple gradient logo for Migoo AI. Place it in the opening logo reveal and the closing call-to-action scene.

CATEGORY: screenshot
DESCRIPTION: A dark-themed web app dashboard showing Migoo's video studio. Best used in browser mockup or app preview scenes.`
            );
            // Parse structured response
            const catMatch = raw.match(/CATEGORY:\s*(logo|screenshot|product|person|other)/i);
            const descMatch = raw.match(/DESCRIPTION:\s*(.+)/i);
            if (catMatch) category = catMatch[1].toLowerCase() as typeof category;
            if (descMatch) description = descMatch[1].trim();
            else description = raw.trim().slice(0, 300);
            console.log(`📐 Groq Vision: category=${category} | ${description.slice(0, 80)}...`);
        } catch (visionErr: any) {
            console.error("Groq Vision error:", visionErr.message);
        }

        // 3. Upsert a dedicated 'uploaded_assets' system message in the project.
        //    Assets are stored in DB metadata — NOT embedded in chat message text.
        const newAsset = { url: blobResult.url, name: file.name, description, category };

        const [existingMsg] = await db
            .select()
            .from(motionGraphicMessages)
            .where(
                and(
                    eq(motionGraphicMessages.projectId, projectId),
                    eq(motionGraphicMessages.role, "assets")
                )
            )
            .limit(1);

        if (existingMsg) {
            const currentAssets: any[] = (existingMsg.metadata as any)?.assets || [];
            await db
                .update(motionGraphicMessages)
                .set({ metadata: { type: "uploaded_assets", assets: [...currentAssets, newAsset] } })
                .where(eq(motionGraphicMessages.id, existingMsg.id));
        } else {
            await db.insert(motionGraphicMessages).values({
                projectId,
                role: "assets",
                content: `${file.name}`,
                metadata: { type: "uploaded_assets", assets: [newAsset] },
            });
        }

        console.log(`✅ Asset stored for project ${projectId}: ${blobResult.url.slice(0, 70)}...`);

        return NextResponse.json({
            success: true,
            url: blobResult.url,
            name: file.name,
            category,
            description,
        });
    } catch (err: any) {
        console.error("❌ Upload error:", err?.message || err);
        console.error("❌ Upload stack:", err?.stack?.slice(0, 500));
        return NextResponse.json({ error: err?.message || "Upload failed" }, { status: 500 });
    }
}
