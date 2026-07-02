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
    generateNanoBananaImage,
    NANO_BANANA_STYLES,
} from "@/lib/apify-image";

const NOTES_STYLE_UUID = NANO_BANANA_STYLES["Illustration"];

/**
 * Use Groq to plan image placements across pages.
 * Uses llama-3.1-8b-instant (higher TPM) for this lightweight planning task
 * to avoid rate-limiting after the main note generation.
 */
function getOpenRouterKeys(): string[] {
    const keys: string[] = [];
    const base = process.env.NVIDIA_API_KEY;
    if (base) keys.push(base);
    for (let i = 1; i <= 9; i++) {
        const k = process.env[`NVIDIA_API_KEY${i}`];
        if (k) keys.push(k);
    }
    return keys;
}

async function callOpenRouterDirect(
    systemPrompt: string,
    userInput: string,
    model: string,
    maxTokens: number,
    retries = 3,
): Promise<any> {
    const apiKeys = getOpenRouterKeys();
    if (apiKeys.length === 0) throw new Error("No NVIDIA_API_KEY configured");

    let keyIndex = 0;
    let lastError: any = null;

    for (let attempt = 0; attempt < retries; attempt++) {
        const apiKey = apiKeys[keyIndex % apiKeys.length];
        const keyTag = apiKeys.length > 1 ? ` [key_${(keyIndex % apiKeys.length) + 1}/${apiKeys.length}]` : "";

        try {
            console.log(`🤖 Querying NvidiaAPI (${model})${keyTag} (attempt ${attempt + 1}/${retries})...`);
            const response = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${apiKey}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    model,
                    messages: [
                        { role: "system", content: systemPrompt },
                        { role: "user", content: userInput },
                    ],
                    temperature: 0.6,
                    max_tokens: maxTokens,
                    response_format: { type: "json_object" },
                }),
                signal: AbortSignal.timeout(180_000),
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`OpenRouter API error (${response.status}): ${errText}`);
            }

            const data = await response.json();
            const content = data.choices?.[0]?.message?.content?.trim() || "";
            if (!content) throw new Error("Empty response from OpenRouter");

            const jsonStart = content.search(/[{[]/);
            if (jsonStart === -1) throw new Error("No JSON in response");

            try {
                return JSON.parse(content.substring(jsonStart));
            } catch {
                const fixed = content.substring(jsonStart).replace(/,(\s*[}\]])/g, "$1");
                return JSON.parse(fixed);
            }

        } catch (err: any) {
            lastError = err;
            keyIndex++;
            await new Promise(r => setTimeout(r, 2000));
        }
    }

    throw lastError || new Error("All NvidiaAPI retries exhausted");
}

async function planImagesWithOpenRouter(
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

    const models = ["mistralai/mistral-large-3-675b-instruct-2512", "openai/gpt-oss-120b", "meta/llama-3.3-70b-instruct"];
    let lastError: any = null;

    for (const model of models) {
        try {
            console.log(`🧠 NvidiaAPI planning image placements using ${model}...`);
            const parsed = await callOpenRouterDirect(systemPrompt, userMsg, model, 1024, 3);
            const images: Array<{ pageIndex: number; prompt: string }> = parsed?.images || [];
            return images
                .filter((img) => typeof img.pageIndex === "number" && typeof img.prompt === "string" && img.prompt.length > 5)
                .slice(0, totalPages * 2);
        } catch (err: any) {
            console.warn(`⚠️ OpenRouter image planning failed on ${model}:`, err.message);
            lastError = err;
        }
    }

    console.warn("⚠️ All OpenRouter models failed for image planning, using default 1-per-page:", lastError);
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

        const modelChoice = "Apify Gemini";

        console.log(`🖼️ Image pipeline: noteId=${noteId}, pages=${totalPages}, sections=${sections.length}, model=${modelChoice}`);

        // ── Step 3: Plan images with OpenRouter ──────────────
        console.log("🧠 OpenRouter planning image placements...");
        const imagePlan = await planImagesWithOpenRouter(
            project.title,
            sections,
            totalPages,
            false,
            ""
        );

        console.log(`📋 Image plan: ${imagePlan.length} images across ${totalPages} pages`);

        // ── Step 4: Generate images ──────────────────────────
        const pageImages: Array<{
            pageIndex: number;
            imageUrl: string;
            prompt: string;
            model: string;
        }> = [];

        for (const plan of imagePlan) {
            try {
                let imageUrl: string;
                let usedModel = "apify-gemini";

                console.log(`🍌 Apify Gemini → page ${plan.pageIndex + 1}...`);
                imageUrl = await generateNanoBananaImage(
                    plan.prompt, 1376, 768, NOTES_STYLE_UUID
                );

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
            imageModel: "apify-gemini",
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
