import { db } from "@/config/db";
import { courseImages } from "@/config/schema";
import { putWithRotation } from "@/lib/blob";
import { generateRunwayImage } from "@/lib/runway";
import { apiError, apiSuccess } from "@/lib/api-helpers";
import { currentUser } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

// ═══════════════════════════════════════════════════════════════════════════════
// Nano Banana 2 IMAGE GENERATION — Multiple Images Per Chapter
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Build a unique, tech-relevant image prompt for each subcontent topic.
 * Images feature tech symbols, icons, and visual metaphors — STRICTLY NO TEXT.
 */
function buildImagePrompt(
    courseName: string,
    chapterTitle: string,
    subContentTopic: string,
    globalIndex: number
): string {
    // Visual styles that rotate per image for variety
    const styles = [
        "cinematic 3D render of glowing tech icons and symbols floating in space",
        "isometric illustration of a developer workspace with holographic displays",
        "futuristic concept art with neon circuitry patterns and code editor screens",
        "minimalist flat design with abstract tech stack logos and geometric shapes",
        "photorealistic close-up of circuit boards, chips, and glowing data streams",
        "abstract digital art with interconnected nodes, neural network visualization",
        "sleek dark-themed illustration of programming tools and development environment",
        "dramatic low-angle 3D render of floating tech symbols and gear icons",
        "vibrant gradient art with abstract representations of algorithms and data flow",
        "modern glassmorphism UI concept with layered translucent tech panels"
    ];

    // Tech visual elements to reinforce relevancy
    const techElements = [
        "featuring relevant technology symbols, framework icons, and code brackets",
        "with floating gear icons, terminal windows, and abstract API connections",
        "showing symbolic representations of the tech stack like curly braces, angle brackets, and flow arrows",
        "with glowing hexagonal nodes, data pipelines, and abstract architecture diagrams",
        "featuring stylized keyboard keys, mouse cursor trails, and IDE-inspired color accents",
        "with abstract representations of servers, databases, and cloud infrastructure symbols",
        "showing interconnected puzzle pieces, modular blocks, and component hierarchy visuals",
        "with symbolic code syntax elements like semicolons, parentheses, and hash symbols floating artistically"
    ];

    const style = styles[globalIndex % styles.length];
    const techElement = techElements[globalIndex % techElements.length];

    return `${style}, visually representing the concept of "${subContentTopic}" related to "${chapterTitle}" in a "${courseName}" course. ${techElement}. Dark moody background with vibrant accent lighting, professional educational technology visual, ultra high quality, 4K detail. STRICTLY NO TEXT ANYWHERE — no words, no letters, no numbers, no labels, no typography, no watermarks, no readable characters — ONLY visual symbols, icons, shapes, and abstract tech imagery`;
}

// How many images to generate per chapter
const IMAGES_PER_CHAPTER = 1;

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

        const { courseName, courseId, chapters } = await req.json();

        console.log('\n' + '═'.repeat(80));
        console.log('🖼️  Nano Banana 2 IMAGE GENERATION (SEQUENTIAL MODE)');
        console.log('═'.repeat(80));
        console.log('Course:', courseName);
        console.log('Course ID:', courseId);
        console.log('Chapters:', chapters?.length);
        console.log('Images per chapter:', IMAGES_PER_CHAPTER);
        console.log('═'.repeat(80) + '\n');

        if (!courseName || !courseId || !chapters) {
            return apiError('courseName, courseId, and chapters are required', 400, 'VALIDATION_ERROR');
        }

        // ═════════════════════════════════════════════════════════════════
        // CHECK IF IMAGES ALREADY EXIST
        // ═════════════════════════════════════════════════════════════════
        const existingImages = await db
            .select()
            .from(courseImages)
            .where(eq(courseImages.courseId, courseId));

        if (existingImages.length > 0) {
            console.log(`✅ Images already exist for course ${courseId} (${existingImages.length} images) — SKIPPING`);
            return apiSuccess({
                images: existingImages,
                skipped: true,
                message: `Images already generated (${existingImages.length} images)`
            });
        }

        // ═════════════════════════════════════════════════════════════════
        // GENERATE IMAGES — One at a time (with auto key rotation)
        // ═════════════════════════════════════════════════════════════════
        const generatedImages = [];
        let globalIndex = 0;

        for (let chIdx = 0; chIdx < chapters.length; chIdx++) {
            const chapter = chapters[chIdx];
            const chapterTitle = chapter.chapterTitle || chapter.title || `Chapter ${chIdx + 1}`;
            const subContent: string[] = chapter.subContent || [];

            // Pick subcontent topics for image prompts
            const topicsForImages = subContent.slice(0, IMAGES_PER_CHAPTER);
            while (topicsForImages.length < IMAGES_PER_CHAPTER) {
                topicsForImages.push(`${chapterTitle} - concept ${topicsForImages.length + 1}`);
            }

            console.log(`\n📁 Chapter ${chIdx + 1}: "${chapterTitle}" — generating ${topicsForImages.length} images`);

            for (let imgIdx = 0; imgIdx < topicsForImages.length; imgIdx++) {
                const prompt = buildImagePrompt(courseName, chapterTitle, topicsForImages[imgIdx], globalIndex);

                try {
                    // 1:1 — square for course slides via Nano Banana (Gemini 2.5 Flash Image)
                    console.log(`  📸 [${globalIndex + 1}] Generating image with Nano Banana...`);
                    const leonardoUrl = await generateRunwayImage(prompt, "1:1");
                    console.log(`  ✅ Nano Banana URL: ${leonardoUrl.substring(0, 60)}...`);

                    // ⬇️ DOWNLOAD & UPLOAD TO VERCEL BLOB (PERSISTENCE FIX) ⬇️
                    console.log(`  CLOUD UPLOAD: Saving to Vercel Blob...`);
                    const imageRes = await fetch(leonardoUrl);
                    if (!imageRes.ok) throw new Error(`Failed to fetch Leonardo image: ${imageRes.statusText}`);

                    const imageBuffer = await imageRes.arrayBuffer();
                    const filename = `images/${courseId}/${globalIndex}_${Date.now()}.webp`;

                    const blob = await putWithRotation(filename, Buffer.from(imageBuffer), {
                        access: 'public',
                        contentType: 'image/webp',
                    });

                    console.log(`  ✅ Saved permanently: ${blob.url}`);

                    // Save to DB
                    const [inserted] = await db.insert(courseImages).values({
                        courseId: courseId,
                        imageIndex: globalIndex,
                        imagePrompt: prompt.substring(0, 500),
                        imageUrl: blob.url, // Use permanent Blob URL
                        width: 1024,
                        height: 1024
                    }).returning();

                    generatedImages.push(inserted);
                    console.log(`  💾 [${globalIndex + 1}] Saved to DB (Nano Banana 2)`);

                } catch (error: any) {
                    console.error(`  ❌ [${globalIndex + 1}] Failed: ${error.message}`);
                    // Continue with next image
                }

                globalIndex++;
            }
        }

        // Summary
        const totalExpected = chapters.length * IMAGES_PER_CHAPTER;
        console.log('\n' + '═'.repeat(80));
        console.log(`🎉 IMAGE GENERATION COMPLETE: ${generatedImages.length}/${totalExpected} images`);
        console.log(`📊 ${generatedImages.length} unique images across ${chapters.length} chapters`);
        console.log('═'.repeat(80) + '\n');

        return apiSuccess({
            images: generatedImages,
            metadata: {
                generatedAt: new Date().toISOString(),
                engine: 'nano-banana-gemini-2.5-flash-image',
                courseId,
                totalRequested: totalExpected,
                totalGenerated: generatedImages.length,
                imagesPerChapter: IMAGES_PER_CHAPTER,
                chapters: chapters.length
            }
        });

    } catch (error: any) {
        console.error('\n' + '═'.repeat(80));
        console.error('🔥 IMAGE GENERATION FAILED');
        console.error('═'.repeat(80));
        console.error('Error:', error.message);
        console.error('Stack:', error.stack);
        console.error('═'.repeat(80) + '\n');

        return apiError(
            error.message || 'Failed to generate images',
            500,
            'GENERATION_ERROR',
            error.stack
        );
    }
}
