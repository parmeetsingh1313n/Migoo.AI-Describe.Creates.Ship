/**
 * POST /api/short-series/generate-thumbnail
 *
 * Directly calls Vercel AI Gateway (Imagen 4) synchronously.
 * Imagen 4 responds in ~5-10s — well within Vercel's 60s limit on Hobby plan.
 * No Inngest needed for this fast path.
 *
 * The frontend polls GET /api/short-series/[seriesId] (thumbnailUrl field)
 * every 5 s until the URL is populated in the DB.
 */

import { db } from "@/config/db";
import { shortVideoSeries } from "@/config/schema";
import { generateNanoBananaImage } from "@/lib/vercel-image";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60; // Imagen 4 is fast (~5-10s), 60s is plenty

export async function POST(req: NextRequest) {
    try {
        const { seriesId, title, niche } = await req.json();

        if (!seriesId || !title) {
            return NextResponse.json(
                { error: "seriesId and title are required" },
                { status: 400 }
            );
        }

        console.log(`🖼️  [generate-thumbnail] Starting for series: ${seriesId} — "${title}"`);
        console.log(`🔑 [generate-thumbnail] AI_GATEWAY_API_KEY present: ${!!process.env.AI_GATEWAY_API_KEY}`);

        // Build prompt from title keywords
        const stopWords = new Set(["a","an","the","and","or","but","in","on","at","for","with","about","to","from","of","is","are","how","what","why"]);
        const keywords = title.split(/\s+/)
            .filter((w: string) => w.length > 0 && !stopWords.has(w.toLowerCase()))
            .slice(0, 3)
            .join(" ");
        const nicheStr = niche || "general";

        const prompts = [
            `A stunning cinematic thumbnail for a "${keywords}" video series. Bold 3D neon text "${keywords}" floating over a vibrant ${nicheStr}-themed background. Dramatic lighting, 8k resolution.`,
            `Cinematic wide thumbnail: "${keywords}" in large glowing letters against a dark moody backdrop with ${nicheStr} visual elements. Electric blue and magenta tones, lens flare. 8k.`,
            `Hyper-modern thumbnail: "${keywords}" in bold metallic 3D typography. Floating geometric shapes, ${nicheStr} icons, deep purple to electric blue gradient background. 8k.`,
            `Premium cinematic thumbnail: "${keywords}" as holographic text above a stylish ${nicheStr}-themed scene. Glowing particles, soft bokeh, cinematic depth. 8k.`,
        ];
        const prompt = prompts[Math.floor(Math.random() * prompts.length)];
        console.log(`📝 [generate-thumbnail] Prompt: "${prompt.slice(0, 100)}..."`);

        // Generate image via Vercel AI Gateway (Imagen 4) — synchronous, ~5-10s
        const thumbnailUrl = await generateNanoBananaImage(prompt, 1024, 1024);
        console.log(`✅ [generate-thumbnail] Generated: ${thumbnailUrl.slice(0, 80)}`);

        // Save to DB
        await db
            .update(shortVideoSeries)
            .set({ thumbnailUrl })
            .where(eq(shortVideoSeries.seriesId, seriesId));
        console.log(`💾 [generate-thumbnail] Saved to DB for series ${seriesId}`);

        return NextResponse.json({ success: true, seriesId, thumbnailUrl });

    } catch (error: any) {
        console.error("🔥 [generate-thumbnail] Failed:", error.message);
        console.error("🔥 Stack:", error.stack?.slice(0, 500));
        return NextResponse.json(
            { success: false, error: error.message },
            { status: 500 }
        );
    }
}
