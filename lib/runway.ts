// ═══════════════════════════════════════════════════════════════════════════════
// Nano Banana — Gemini 2.5 Flash Image Generation
// Uses @google/genai SDK for native image generation (text-to-image)
// ═══════════════════════════════════════════════════════════════════════════════

import { GoogleGenAI } from "@google/genai";
import { putWithRotation } from "@/lib/blob";

const MODEL = "gemini-2.5-flash-image";

/** Map RunwayML-style ratio strings to Gemini aspect ratios */
const RATIO_MAP: Record<string, string> = {
    "1024:1024": "1:1",
    "768:1344":  "9:16",
    "1344:768":  "16:9",
    "1024:768":  "4:3",
    "768:1024":  "3:4",
    // Direct aspect ratio passthrough
    "1:1":   "1:1",
    "9:16":  "9:16",
    "16:9":  "16:9",
    "4:3":   "4:3",
    "3:4":   "3:4",
    "3:2":   "3:2",
    "2:3":   "2:3",
};

/** Custom error class for content moderation failures */
export class ContentModerationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ContentModerationError";
    }
}

/**
 * Generate an image using Nano Banana (Gemini 2.5 Flash Image).
 *
 * @param prompt  - The image generation prompt
 * @param ratio   - Aspect ratio string, e.g. "1024:1024", "768:1344", "1344:768"
 *                  or direct Gemini ratios like "1:1", "9:16", "16:9"
 * @returns       - A permanent Vercel Blob URL to the generated image
 */
export async function generateRunwayImage(
    prompt: string,
    ratio: string = "1024:1024"
): Promise<string> {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY_IMAGE;
    if (!apiKey) {
        throw new Error("Neither GEMINI_API_KEY_IMAGE nor GEMINI_API_KEY is set in environment variables");
    }

    const aspectRatio = RATIO_MAP[ratio] || "1:1";

    console.log(`🍌 Nano Banana generating image (${MODEL}, ${aspectRatio})...`);
    console.log(`   Prompt: "${prompt.substring(0, 100)}..."`);

    const ai = new GoogleGenAI({ apiKey });

    try {
        const response = await ai.models.generateContent({
            model: MODEL,
            contents: prompt,
            config: {
                responseModalities: ["IMAGE"],
                imageConfig: {
                    aspectRatio,
                },
            },
        });

        // Extract image data from response
        const parts = response.candidates?.[0]?.content?.parts;
        if (!parts || parts.length === 0) {
            throw new Error("Nano Banana returned no content parts");
        }

        const imagePart = parts.find((p: any) => p.inlineData);
        if (!imagePart || !imagePart.inlineData) {
            // Check if it was blocked by safety filters
            const textPart = parts.find((p: any) => p.text);
            if (textPart?.text) {
                console.warn(`⚠️ Nano Banana returned text instead of image: ${textPart.text.substring(0, 200)}`);
            }
            throw new ContentModerationError(
                "Nano Banana did not return an image — likely blocked by content moderation"
            );
        }

        const { data: base64Data, mimeType } = imagePart.inlineData;
        if (!base64Data) {
            throw new Error("Nano Banana returned image part but no data");
        }

        // Convert base64 to buffer
        const imageBuffer = Buffer.from(base64Data, "base64");
        const ext = mimeType?.includes("png") ? "png" : mimeType?.includes("webp") ? "webp" : "png";
        const contentType = mimeType || "image/png";

        console.log(`✅ Nano Banana generated image: ${imageBuffer.length} bytes (${contentType})`);

        // Upload to Vercel Blob for permanent storage
        const filename = `nano-banana/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const blob = await putWithRotation(filename, imageBuffer, {
            access: "public",
            contentType,
        });

        console.log(`✅ Uploaded to Vercel Blob: ${blob.url}`);
        return blob.url;

    } catch (error: any) {
        // Handle specific Gemini error types
        const msg = error?.message || String(error);

        if (
            msg.includes("SAFETY") ||
            msg.includes("blocked") ||
            msg.includes("content") ||
            msg.includes("policy") ||
            msg.includes("RECITATION") ||
            error instanceof ContentModerationError
        ) {
            throw new ContentModerationError(`Nano Banana content moderation: ${msg}`);
        }

        console.error(`❌ Nano Banana image generation failed: ${msg}`);
        throw error;
    }
}
