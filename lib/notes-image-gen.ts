/**
 * Notes Image Generation — Shared Logic
 *
 * Called directly from the generate route (fire-and-forget)
 * and also from the generate-images API route.
 *
 * Dual-model strategy:
 *  • User uploaded image → GPT Image-1.5 (with image reference guidance)
 *  • No user image       → Nano Banana 2  (Illustration style, fast & beautiful)
 */

import { db, dbRetry } from "@/config/db";
import { notesProjects } from "@/config/schema";
import { groq } from "@/config/groq";
import { eq } from "drizzle-orm";
import {
    uploadImageToLeonardo,
    generateGptImage15,
    generateNanoBananaImage,
    NANO_BANANA_STYLES,
} from "@/lib/leonardo";

const NOTES_STYLE_UUID = NANO_BANANA_STYLES["Illustration"];

// ─── Helpers ─────────────────────────────────────────────────
function getFirstLeonardoKey(): string {
    const keyNames = [
        "LEONARDO_API_KEY", "LEONARDO_API_KEY1", "LEONARDO_API_KEY2",
        "LEONARDO_API_KEY3", "LEONARDO_API_KEY4",
    ];
    for (const name of keyNames) {
        const v = process.env[name];
        if (v && v.length > 0) return v;
    }
    throw new Error("No LEONARDO_API_KEY found in environment");
}

/**
 * Use Groq to plan image placements across pages.
 * Uses llama-3.1-8b-instant (higher TPM) for this lightweight planning task
 * to avoid rate-limiting after the main note generation.
 */
async function planImagesWithGroq(
    title: string,
    sections: any[],
    totalPages: number,
    hasUserImage: boolean,
    userImageDescription: string
): Promise<Array<{ pageIndex: number; prompt: string }>> {
    const sectionsPerPage = Math.ceil(sections.length / totalPages);
    const pagesSummary = Array.from({ length: totalPages }, (_, pi) => {
        const pageSections = sections.slice(pi * sectionsPerPage, (pi + 1) * sectionsPerPage);
        return `Page ${pi + 1}: ${pageSections.map((s: any) => s.heading || s.title || "Section").join(", ")}`;
    }).join("\n");

    const systemPrompt = `You are a study notes visual planner. Given a multi-page note document, decide where AI-generated educational illustrations should appear and write a specific image prompt for each.

ILLUSTRATION STYLE: Clean flat-design educational illustration. Think textbook diagrams, infographics, labeled diagrams, concept maps, annotated charts. Style: modern minimal, soft colors, white/light background, vector-like quality.

Rules:
- Each page gets 1 image. Some pages may get 2 if the content is very data-heavy.
- Total images should be between ${totalPages} and ${Math.min(totalPages + 2, totalPages * 2)}.
- Each prompt must be a detailed, educational illustration description.
- Focus on: diagrams, flowcharts, labeled illustrations, concept maps, comparison charts.
- DO NOT request photos. Request clean flat illustrations, diagrams, or infographics.
${hasUserImage ? `- The user's image context: "${userImageDescription}". Reference this visual style in prompts.` : ""}

Return ONLY valid JSON: { "images": [ { "pageIndex": 0, "prompt": "..." }, ... ] }`;

    const userMsg = `Title: "${title}"
Total pages: ${totalPages}
Page breakdown:
${pagesSummary}`;

    // Retry up to 3 times with increasing backoff to handle TPM rate limits
    const MAX_RETRIES = 3;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            // Wait before calling — the main note generation just consumed most of the TPM budget
            const cooldownMs = attempt === 1 ? 3000 : attempt * 5000;
            console.log(`⏳ Groq planning: waiting ${cooldownMs / 1000}s cooldown (attempt ${attempt}/${MAX_RETRIES})...`);
            await new Promise((r) => setTimeout(r, cooldownMs));

            const parsed = await groq.json(systemPrompt, userMsg, {
                model: "llama-3.1-8b-instant", // Higher TPM (131K vs 12K) for this lightweight task
                temperature: 0.6,
                maxTokens: 1024,
            });

            const images: Array<{ pageIndex: number; prompt: string }> = parsed?.images || [];
            return images
                .filter((img) => typeof img.pageIndex === "number" && typeof img.prompt === "string" && img.prompt.length > 5)
                .slice(0, totalPages * 2);
        } catch (err: any) {
            const is429 = err?.message?.includes("429") || err?.message?.includes("rate_limit");
            if (is429 && attempt < MAX_RETRIES) {
                console.warn(`⚠️ Groq rate limited (attempt ${attempt}/${MAX_RETRIES}), retrying after backoff...`);
                continue;
            }
            console.warn("⚠️ Groq image planning failed, using default 1-per-page:", err);
            return Array.from({ length: totalPages }, (_, pi) => ({
                pageIndex: pi,
                prompt: `Clean flat educational illustration for study notes about "${title}". Page ${pi + 1} concept diagram with labeled elements, modern minimal style, white background, soft colors.`,
            }));
        }
    }

    // Fallback (shouldn't reach here, but just in case)
    return Array.from({ length: totalPages }, (_, pi) => ({
        pageIndex: pi,
        prompt: `Clean flat educational illustration for study notes about "${title}". Page ${pi + 1} concept diagram with labeled elements, modern minimal style, white background, soft colors.`,
    }));
}

// ─── Main Logic ──────────────────────────────────────────────
/**
 * Generate images for a notes project. Can be called from any context.
 * Returns the updated pageImages array.
 */
export async function generateNotesImages(noteId: string): Promise<{
    success: boolean;
    imagesGenerated: number;
    model: string;
    error?: string;
}> {
    try {
        // ── Load project ──────────────────────────────────────
        const [project] = await db
            .select()
            .from(notesProjects)
            .where(eq(notesProjects.noteId, noteId));

        if (!project) throw new Error("Project not found");
        if (!project.generatedData) throw new Error("Notes not generated yet");

        const generatedData = project.generatedData as any;
        const uploadedAssets = (project.uploadedAssets as any[]) || [];
        const imageAssets = uploadedAssets.filter((a) => a.type?.startsWith("image/"));

        // ── Step 1: Determine total pages ────────────────────
        const sections = generatedData?.mainNotes || generatedData?.sections || [];
        const SECTIONS_PER_PAGE = 4;
        const totalPages = Math.max(1, Math.ceil(sections.length / SECTIONS_PER_PAGE));

        const hasUserImage = imageAssets.length > 0;
        const modelChoice = hasUserImage ? "GPT Image-1.5" : "Nano Banana 2";

        console.log(`🖼️ Image pipeline: noteId=${noteId}, pages=${totalPages}, sections=${sections.length}, model=${modelChoice}`);

        // ── Step 2: Upload user image if present ─────────────
        let refImageId: string | null = null;
        let userImageDescription = "";

        if (hasUserImage) {
            const primaryAsset = imageAssets[0];
            const apiKey = getFirstLeonardoKey();
            try {
                console.log(`⬆️ Uploading user image to Leonardo: ${primaryAsset.name}`);
                refImageId = await uploadImageToLeonardo(primaryAsset.url, apiKey);
                userImageDescription = primaryAsset.name || "user uploaded reference image";
                console.log(`✅ User image uploaded, refId=${refImageId}`);
            } catch (uploadErr) {
                console.warn("⚠️ Failed to upload user image, falling back to Nano Banana 2:", uploadErr);
            }
        }

        // ── Step 3: Plan images with Groq ────────────────────
        console.log("🧠 Groq planning image placements...");
        const imagePlan = await planImagesWithGroq(
            project.title,
            sections,
            totalPages,
            hasUserImage,
            userImageDescription
        );

        console.log(`📋 Image plan: ${imagePlan.length} images across ${totalPages} pages`);

        // ── Step 4: Generate images ──────────────────────────
        const pageImages: Array<{
            pageIndex: number;
            imageUrl: string;
            prompt: string;
            model: string;
        }> = [];

        // Add user's uploaded image
        if (hasUserImage) {
            pageImages.push({
                pageIndex: generatedData.imagePosition ?? 0,
                imageUrl: imageAssets[0].url,
                prompt: "User uploaded reference image",
                model: "user-upload",
            });
        }

        for (const plan of imagePlan) {
            try {
                let imageUrl: string;
                let usedModel: string;

                if (refImageId) {
                    // Try GPT Image-1.5 first, fall back to Nano Banana if it fails
                    try {
                        console.log(`🎨 GPT Image-1.5 → page ${plan.pageIndex + 1}...`);
                        const urls = await generateGptImage15(
                            plan.prompt, refImageId, 1, "MEDIUM", 1024, 1024
                        );
                        imageUrl = urls[0];
                        usedModel = "gpt-image-1.5";
                    } catch (gptErr: any) {
                        console.warn(`⚠️ GPT Image-1.5 failed for page ${plan.pageIndex + 1}: ${gptErr?.message?.substring(0, 120)}`);
                        console.log(`🍌 Falling back to Nano Banana 2 → page ${plan.pageIndex + 1}...`);
                        imageUrl = await generateNanoBananaImage(
                            plan.prompt, 1024, 1024, NOTES_STYLE_UUID
                        );
                        usedModel = "nano-banana-2";
                    }
                } else {
                    console.log(`🍌 Nano Banana 2 → page ${plan.pageIndex + 1}...`);
                    imageUrl = await generateNanoBananaImage(
                        plan.prompt, 1024, 1024, NOTES_STYLE_UUID
                    );
                    usedModel = "nano-banana-2";
                }

                pageImages.push({
                    pageIndex: plan.pageIndex,
                    imageUrl,
                    prompt: plan.prompt,
                    model: usedModel,
                });
                console.log(`✅ Page ${plan.pageIndex + 1} image ready! (${usedModel})`);

            } catch (genErr) {
                console.warn(`⚠️ Failed to generate image for page ${plan.pageIndex + 1}:`, genErr);
            }
        }

        // ── Step 5: Save to DB ───────────────────────────────
        // Re-fetch project to avoid overwriting coverImageUrl if it was set while we were generating content images
        const [latestProject] = await db
            .select()
            .from(notesProjects)
            .where(eq(notesProjects.noteId, noteId));
            
        const latestGenData = latestProject?.generatedData as any || generatedData;

        const updatedData = {
            ...latestGenData,
            pageImages,
            imagesGeneratedAt: new Date().toISOString(),
            imageModel: refImageId ? "gpt-image-1.5" : "nano-banana-2",
        };

        await dbRetry(() =>
            db.update(notesProjects)
                .set({ generatedData: updatedData, updatedAt: new Date() })
                .where(eq(notesProjects.noteId, noteId))
        );

        console.log(`✅ ${pageImages.length} images saved to note ${noteId} (model: ${modelChoice})`);

        return { success: true, imagesGenerated: pageImages.length, model: modelChoice };
    } catch (error: any) {
        console.error(`❌ Notes image generation failed for ${noteId}:`, error);
        return { success: false, imagesGenerated: 0, model: "none", error: error.message };
    }
}
