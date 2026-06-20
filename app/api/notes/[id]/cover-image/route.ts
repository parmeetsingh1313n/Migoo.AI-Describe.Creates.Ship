/**
 * Cover Image Generation for Notes First Page
 * POST /api/notes/[id]/cover-image
 * Body: { title: string }
 *
 * Generates a Nano Banana 2 image suitable as a decorative cover image
 * (abstract, topic-related, NO text in the image).
 */

import { currentUser } from "@clerk/nextjs/server"
import { NextRequest, NextResponse } from "next/server"
import { generateNanoBananaImage, NANO_BANANA_STYLES } from "@/lib/pollo"
import { db } from "@/config/db"
import { notesProjects } from "@/config/schema"
import { eq } from "drizzle-orm"

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const user = await currentUser()
        if (!user?.primaryEmailAddress?.emailAddress) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
        }

        const { id: noteId } = await params
        const { title } = await req.json()
        if (!title) {
            return NextResponse.json({ error: "title is required" }, { status: 400 })
        }

        // 1. Check if cover image already exists in DB
        const [project] = await db.select().from(notesProjects).where(eq(notesProjects.noteId, noteId))
        if (project?.generatedData) {
            const data = project.generatedData as any
            if (data.coverImageUrl) {
                console.log(`✅ [CoverImageAPI] Found existing image in DB for ${noteId}: ${data.coverImageUrl.substring(0, 50)}...`)
                return NextResponse.json({ success: true, imageUrl: data.coverImageUrl, cached: true })
            }
        }

        console.log(`🚀 [CoverImageAPI] No cover image found for ${noteId}, generating...`)

        // 2. Build a visual-only prompt — explicitly no text/letters
        const prompt = `Abstract artistic illustration representing "${title}". 
            Colorful geometric shapes, soft gradients, decorative patterns, 
            minimal and elegant design. NO text, NO words, NO letters, 
            NO numbers, purely visual abstract art, flat design style, 
            vibrant colors, clean composition.`

        // 3. Generate new image (1024x1024 is safe for Nano Banana 2)
        const imageUrl = await generateNanoBananaImage(
            prompt,
            1024,
            1024,
            NANO_BANANA_STYLES["Illustration"]
        )

        // 4. Save to DB
        if (project) {
            const updatedData = {
                ...(project.generatedData as any || {}),
                coverImageUrl: imageUrl
            }
            await db.update(notesProjects)
                .set({ generatedData: updatedData, updatedAt: new Date() })
                .where(eq(notesProjects.noteId, noteId))
        }

        return NextResponse.json({ success: true, imageUrl, cached: false })
    } catch (error: any) {
        console.error("❌ Cover image generation failed:", error)
        return NextResponse.json(
            { error: error.message || "Image generation failed" },
            { status: 500 }
        )
    }
}
