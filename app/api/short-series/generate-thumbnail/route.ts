import { db } from "@/config/db";
import { shortVideoSeries } from "@/config/schema";
import { generateNanoBananaImage } from "@/lib/leonardo";
import { eq } from "drizzle-orm";
import fs from "fs";
import { NextRequest, NextResponse } from "next/server";
import path from "path";

// ═══════════════════════════════════════════════════════════════════════════════
// Nano Banana 2 THUMBNAIL GENERATION — Short Video Series
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Build a thumbnail prompt optimized for short-form video series.
 * Uses the series title and niche to create a visually compelling image.
 */
function buildShortsThumbnailPrompt(title: string, niche: string): string {
    // Extract 2-3 key words from the title
    const stopWords = new Set(["a", "an", "the", "and", "or", "but", "in", "on", "at", "for", "with", "about", "to", "from", "of", "is", "are", "how", "what", "why"]);
    const words = title.split(/\s+/).filter(w => w.length > 0);
    const keywords = words.filter(w => !stopWords.has(w.toLowerCase())).slice(0, 3).join(" ");

    const scenes = [
        `A stunning landscape cinematic social media thumbnail for a "${keywords}" video series. Bold, eye-catching 3D text "${keywords}" floating over a vibrant ${niche}-themed background in 16:9 ratio. Dramatic lighting, neon accents, ultra-modern design. STRICTLY ENSURE PERFECT SPELLING of "${keywords}". 8k resolution.`,
        `A cinematic wide thumbnail showing "${keywords}" in large glowing neon letters against a dark moody backdrop with ${niche}-related visual elements. Electric blue and magenta tones, lens flare, professional high-quality aesthetic. STRICTLY ENSURE PERFECT SPELLING of "${keywords}". 8k.`,
        `A hyper-modern landscape thumbnail design with the text "${keywords}" in bold metallic 3D typography. Floating geometric shapes and ${niche}-themed icons surround the text. Gradient background from deep purple to electric blue. STRICTLY ENSURE PERFECT SPELLING of "${keywords}". 8k.`,
        `A premium cinematic thumbnail: the words "${keywords}" rendered as holographic text floating above a stylish ${niche}-themed wide scene. Glowing particles, soft bokeh, cinematic depth of field. STRICTLY ENSURE PERFECT SPELLING of "${keywords}". 8k.`,
        `A viral-worthy landscape thumbnail with "${keywords}" in bold graffiti-style text on a vibrant wide wall. ${niche}-themed stickers and elements surround it. Street art aesthetic, bright colors, energetic composition. STRICTLY ENSURE PERFECT SPELLING of "${keywords}". 8k.`,
        `A futuristic cinematic thumbnail showing "${keywords}" displayed on a floating wide glass screen in a high-tech environment. ${niche}-themed holographic elements in the background. Cyan and purple lighting, ray traced reflections. STRICTLY ENSURE PERFECT SPELLING of "${keywords}". 8k.`,
    ];

    return scenes[Math.floor(Math.random() * scenes.length)];
}

/**
 * Download image and save locally to public/thumbnails/
 */
async function downloadAndSaveThumbnail(imageUrl: string, seriesId: string): Promise<string> {
    const thumbnailsDir = path.join(process.cwd(), "public", "thumbnails");

    if (!fs.existsSync(thumbnailsDir)) {
        fs.mkdirSync(thumbnailsDir, { recursive: true });
    }

    const response = await fetch(imageUrl);
    if (!response.ok) {
        throw new Error(`Failed to download thumbnail: HTTP ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const contentType = response.headers.get("content-type") || "";
    let ext = "png";
    if (contentType.includes("jpeg") || contentType.includes("jpg")) ext = "jpg";
    else if (contentType.includes("webp")) ext = "webp";

    const fileName = `short-${seriesId}.${ext}`;
    const filePath = path.join(thumbnailsDir, fileName);

    fs.writeFileSync(filePath, buffer);
    console.log(`💾 Short series thumbnail saved: ${filePath} (${buffer.length} bytes)`);

    return `/thumbnails/${fileName}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN API ROUTE
// ═══════════════════════════════════════════════════════════════════════════════

export async function POST(req: NextRequest) {
    try {
        const { seriesId, title, niche } = await req.json();

        console.log('\n' + '═'.repeat(80));
        console.log('🖼️  Nano Banana 2 — SHORT SERIES THUMBNAIL');
        console.log('═'.repeat(80));
        console.log('Series:', title);
        console.log('Niche:', niche);
        console.log('Series ID:', seriesId);
        console.log('═'.repeat(80) + '\n');

        if (!seriesId || !title) {
            return NextResponse.json(
                { error: 'seriesId and title are required' },
                { status: 400 }
            );
        }

        // Check if thumbnail already exists
        const existing = await db
            .select({ thumbnailUrl: shortVideoSeries.thumbnailUrl })
            .from(shortVideoSeries)
            .where(eq(shortVideoSeries.seriesId, seriesId));

        const existingUrl = existing[0]?.thumbnailUrl;
        if (existingUrl && existingUrl.startsWith('/thumbnails/')) {
            const localFile = path.join(process.cwd(), "public", existingUrl);
            if (fs.existsSync(localFile)) {
                console.log(`✅ Thumbnail already exists for series ${seriesId} — SKIPPING`);
                return NextResponse.json({
                    success: true,
                    thumbnailUrl: existingUrl,
                    skipped: true,
                });
            }
        }

        const prompt = buildShortsThumbnailPrompt(title, niche || 'general');
        console.log('📸 Thumbnail prompt:', prompt.substring(0, 100));

        const signedUrl = await generateNanoBananaImage(prompt, 1024, 1024);
        const localPath = await downloadAndSaveThumbnail(signedUrl, seriesId);

        // Update DB
        await db.update(shortVideoSeries)
            .set({ thumbnailUrl: localPath })
            .where(eq(shortVideoSeries.seriesId, seriesId));

        console.log('🎉 SHORT SERIES THUMBNAIL COMPLETE:', localPath);

        return NextResponse.json({
            success: true,
            thumbnailUrl: localPath,
        });

    } catch (error: any) {
        console.error('🔥 SHORT SERIES THUMBNAIL FAILED:', error.message);
        return NextResponse.json(
            { success: false, error: error.message },
            { status: 500 }
        );
    }
}
