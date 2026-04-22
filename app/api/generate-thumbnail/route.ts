import { db } from "@/config/db";
import { coursesTable } from "@/config/schema";
import { generateNanoBananaImage } from "@/lib/leonardo";
import { apiError, apiSuccess } from "@/lib/api-helpers";
import { currentUser } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import fs from "fs";
import { NextRequest, NextResponse } from "next/server";
import path from "path";

// ═══════════════════════════════════════════════════════════════════════════════
// Nano Banana 2 THUMBNAIL GENERATION — One thumbnail per course
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Build a visually striking thumbnail prompt from the course name
 */
/**
 * Extract the most important words from the course name to ensure perfect spelling.
 * AI models perform much better with 1-3 crisp words than long sentences.
 */
function extractMainKeywords(title: string): string {
    // Priority: Take text up to the first colon
    let targetText = title;
    if (title.includes(":")) {
        targetText = title.split(":")[0].trim();
    }

    const words = targetText.split(/\s+/).filter(w => w.length > 0);

    // Stop words to filter out if text is still long
    const stopWords = new Set(["a", "an", "the", "and", "or", "but", "in", "on", "at", "for", "with", "about", "to", "from", "of"]);

    if (words.length <= 3) return targetText;

    // Filter out common words and take the first meaningful ones (limit to 3 for clarity)
    const meaningfulWords = words.filter(w => !stopWords.has(w.toLowerCase()));
    return meaningfulWords.slice(0, 3).join(" ");
}

/**
 * Build a visually striking thumbnail prompt from the course name
 */
function buildThumbnailPrompt(courseName: string): string {
    const mainTitle = extractMainKeywords(courseName);

    // FLUX-optimized scenes: Text-first, double quotes, and simple context
    const scenes = [
        `Title: "${mainTitle}". A hyper-realistic shot through a rainy coffee shop window at night. The text "${mainTitle}" is clearly written in the condensation on the glass. STRICTLY ENSURE PERFECT SPELLING of "${mainTitle}" — no typos, no extra letters. 8k resolution, cinematic lighting.`,
        `A glowing neon sign displaying the text "${mainTitle}". Vibrant electric blue and purple tubes on a dark brick wall. STRICTLY ENSURE PERFECT SPELLING of "${mainTitle}" — the typography must be flawless. Cinematic urban atmosphere, 8k resolution.`,
        `A futuristic holographic display floating in a dark lab, showing the text "${mainTitle}" in crisp cyan letters. STRICTLY ENSURE PERFECT SPELLING of "${mainTitle}" — clear, readable, and 100% accurate. Ray traced lighting, 8k.`,
        `A vintage blackboard in a cozy classroom with the words "${mainTitle}" written in beautiful, clear chalk lettering. STRICTLY ENSURE PERFECT SPELLING of "${mainTitle}" — every letter must be exact. Warm golden lighting, 8k.`,
        `A high-end LED billboard in a modern city at night with the text "${mainTitle}" in bold white letters. STRICTLY ENSURE PERFECT SPELLING of "${mainTitle}" — perfectly legible and accurate. Urban energy, cinematic wide-angle, 8k.`,
        `An elegant glass door with the text "${mainTitle}" etched in clean modern typography. STRICTLY ENSURE PERFECT SPELLING of "${mainTitle}" — no spelling mistakes. Professional office aesthetic, 8k resolution.`,
        `A beautiful papercraft diorama made of many layers of paper, featuring the text "${mainTitle}" cut out in the center. Intricate details, soft studio lighting, macro photography style. STRICTLY ENSURE PERFECT SPELLING of "${mainTitle}". 8k.`,
        `A retro 80s arcade screen displaying the text "${mainTitle}" in bright 8-bit pixel art letters. Glowing scanlines, CRT screen curvature, joystick and buttons in soft focus. STRICTLY ENSURE PERFECT SPELLING of "${mainTitle}". Nostalgic vibe, vibrant colors.`,
        `An ancient stone wall with the text "${mainTitle}" deeply engraved into the rock. Moss growing on the stone, dramatic sunlight filtering through trees. STRICTLY ENSURE PERFECT SPELLING of "${mainTitle}". Adventure and history aesthetic, 8k.`,
        `A breathtaking nebula in deep space where the stars form the text "${mainTitle}" in a cosmic cloud of purple and gold light. STRICTLY ENSURE PERFECT SPELLING of "${mainTitle}". Astronomical photography, ethereal and majestic.`,
        `A minimalist premium magazine cover with the text "${mainTitle}" in large, bold, elegant typography. Clean layout, white space, high-fashion aesthetic. STRICTLY ENSURE PERFECT SPELLING of "${mainTitle}". 8k, professional design.`,
        `A 3D isometric laboratory with tiny robots building a giant physical version of the text "${mainTitle}" using glowing tech blocks. STRICTLY ENSURE PERFECT SPELLING of "${mainTitle}". Playful, high-tech, vibrant colors, 8k.`,
        `Street art graffiti on a vibrant urban wall featuring the text "${mainTitle}" in a stylish, readable tag. Paint drips, colorful background, sunny day. STRICTLY ENSURE PERFECT SPELLING of "${mainTitle}". Urban edge, high energy.`,
        `A close-up of a high-tech robotic hand holding a glowing crystal shard that reflects the text "${mainTitle}" on its surface. STRICTLY ENSURE PERFECT SPELLING of "${mainTitle}". Cyberpunk tech, macro detail, 8k.`
    ];

    // Pick a random scene for variety
    const scene = scenes[Math.floor(Math.random() * scenes.length)];
    return scene;
}

/**
 * Download an image from a URL and save it locally to public/thumbnails/
 * Returns the local path (e.g. /thumbnails/{courseId}.png)
 */
async function downloadAndSaveThumbnail(imageUrl: string, courseId: string): Promise<string> {
    const thumbnailsDir = path.join(process.cwd(), "public", "thumbnails");

    // Ensure the thumbnails directory exists
    if (!fs.existsSync(thumbnailsDir)) {
        fs.mkdirSync(thumbnailsDir, { recursive: true });
        console.log(`📁 Created thumbnails directory: ${thumbnailsDir}`);
    }

    // Download the image from the S3 signed URL
    console.log(`⬇️  Downloading thumbnail from S3 signed URL...`);
    const response = await fetch(imageUrl);

    if (!response.ok) {
        throw new Error(`Failed to download thumbnail: HTTP ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Determine file extension from content-type or URL
    const contentType = response.headers.get("content-type") || "";
    let ext = "png";
    if (contentType.includes("jpeg") || contentType.includes("jpg")) {
        ext = "jpg";
    } else if (contentType.includes("webp")) {
        ext = "webp";
    }

    const fileName = `${courseId}.${ext}`;
    const filePath = path.join(thumbnailsDir, fileName);

    // Write the image to disk
    fs.writeFileSync(filePath, buffer);
    console.log(`💾 Thumbnail saved locally: ${filePath} (${buffer.length} bytes)`);

    // Return the public-relative path (served by Next.js static files)
    return `/thumbnails/${fileName}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN API ROUTE
// ═══════════════════════════════════════════════════════════════════════════════

export async function POST(req: NextRequest) {
    try {
        // Auth guard
        const user = await currentUser();
        if (!user?.primaryEmailAddress?.emailAddress) {
            return apiError('Authentication required', 401, 'UNAUTHORIZED');
        }

        const { courseId, courseName } = await req.json();

        console.log('\n' + '═'.repeat(80));
        console.log('🖼️  Nano Banana 2 THUMBNAIL GENERATION');
        console.log('═'.repeat(80));
        console.log('Course:', courseName);
        console.log('Course ID:', courseId);
        console.log('═'.repeat(80) + '\n');

        if (!courseId || !courseName) {
            return apiError('courseId and courseName are required', 400, 'VALIDATION_ERROR');
        }

        // ═════════════════════════════════════════════════════════════════
        // CHECK IF THUMBNAIL ALREADY EXISTS (local file)
        // ═════════════════════════════════════════════════════════════════
        const existingCourse = await db
            .select({ courseThumbnail: coursesTable.courseThumbnail })
            .from(coursesTable)
            .where(eq(coursesTable.courseId, courseId));

        const existingUrl = existingCourse[0]?.courseThumbnail;
        if (existingUrl) {
            // If it's already a local path, it's permanent — skip
            if (existingUrl.startsWith('/thumbnails/')) {
                // Verify the file actually exists on disk
                const localFile = path.join(process.cwd(), "public", existingUrl);
                if (fs.existsSync(localFile)) {
                    console.log(`✅ Local thumbnail already exists for course ${courseId} — SKIPPING`);
                    return apiSuccess({
                        thumbnailUrl: existingUrl,
                        skipped: true,
                        message: 'Thumbnail already generated (local file)'
                    });
                }
                console.log(`⚠️ DB has local path but file is missing, re-generating...`);
            } else {
                // Old S3 signed URL — try to download and persist it locally
                console.log(`🔄 Found expired S3 URL in DB, attempting to re-download and persist locally...`);
                try {
                    const localPath = await downloadAndSaveThumbnail(existingUrl, courseId);
                    await db.update(coursesTable)
                        .set({ courseThumbnail: localPath })
                        .where(eq(coursesTable.courseId, courseId));
                    console.log(`✅ Migrated S3 URL to local path: ${localPath}`);
                    return apiSuccess({
                        thumbnailUrl: localPath,
                        skipped: false,
                        message: 'Migrated S3 URL to local file'
                    });
                } catch (migrationError: any) {
                    console.log(`⚠️ Could not migrate old S3 URL (likely expired): ${migrationError.message}`);
                    console.log(`🔄 Will generate a fresh thumbnail...`);
                    // Fall through to generate a new one
                }
            }
        }

        // ═════════════════════════════════════════════════════════════════
        // GENERATE THUMBNAIL via Leonardo AI (with auto key rotation)
        // ═════════════════════════════════════════════════════════════════
        const prompt = buildThumbnailPrompt(courseName);
        console.log('📸 Thumbnail prompt:', prompt);

        // Generate via Leonardo Nano Banana 2 for thumbnails
        console.log(`📸 Calling Leonardo Nano Banana 2 for thumbnail generation...`);

        const signedUrl = await generateNanoBananaImage(prompt, 1024, 1024);
        console.log(`✅ Nano Banana 2 returned URL: ${signedUrl.substring(0, 80)}...`);

        // ═════════════════════════════════════════════════════════════════
        // DOWNLOAD & PERSIST LOCALLY
        // ═════════════════════════════════════════════════════════════════
        const localPath = await downloadAndSaveThumbnail(signedUrl, courseId);

        // Store the LOCAL path in DB (not the expiring S3 URL)
        await db.update(coursesTable)
            .set({ courseThumbnail: localPath })
            .where(eq(coursesTable.courseId, courseId));

        console.log(`💾 Local thumbnail path saved to database: ${localPath}`);

        console.log('\n' + '═'.repeat(80));
        console.log('🎉 THUMBNAIL GENERATION COMPLETE');
        console.log('═'.repeat(80) + '\n');

        return apiSuccess({
            thumbnailUrl: localPath,
            metadata: {
                generatedAt: new Date().toISOString(),
                engine: 'leonardo-nano-banana-2',
                courseId,
                prompt: prompt.substring(0, 200)
            }
        });

    } catch (error: any) {
        console.error('\n' + '═'.repeat(80));
        console.error('🔥 THUMBNAIL GENERATION FAILED');
        console.error('═'.repeat(80));
        console.error('Error:', error.message);
        console.error('Stack:', error.stack);
        console.error('═'.repeat(80) + '\n');

        return apiError(
            error.message || 'Failed to generate thumbnail',
            500,
            'GENERATION_ERROR',
            error.stack
        );
    }
}
