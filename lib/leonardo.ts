// ═══════════════════════════════════════════════════════════════════════════════
// Leonardo AI Client — Nano Banana 2 (v2 API) with Automatic Key Rotation
// ═══════════════════════════════════════════════════════════════════════════════

const LEONARDO_KEY_NAMES = [
    "LEONARDO_API_KEY",
    "LEONARDO_API_KEY1",
    "LEONARDO_API_KEY2",
    "LEONARDO_API_KEY3",
    "LEONARDO_API_KEY4",
    "LEONARDO_API_KEY5",
    "LEONARDO_API_KEY6",
    "LEONARDO_API_KEY7",
    "LEONARDO_API_KEY8",
    "LEONARDO_API_KEY9",
];

const FLUX_SCHNELL_MODEL_ID = "1dd50843-d653-4516-a8e3-f0238ee453ff";

/** Legacy FLUX Schnell styles — kept for backward compat */
export const LEONARDO_STYLES = {
    "3D Render": "debdf72a-91a4-467b-bf61-cc02bdeb69c6",
    "Acrylic": "3cbb655a-7ca4-463f-b697-8a03ad67327c",
    "Anime General": "b2a54a51-230b-4d4f-ad4e-8409bf58645f",
    "Creative": "6fedbf1f-4a17-45ec-84fb-92fe524a29ef",
    "Dynamic": "111dc692-d470-4eec-b791-3475abac4c46",
    "Fashion": "594c4a08-a522-4e0e-b7ff-e4dac4b6b622",
    "Game Concept": "09d2b5b5-d7c5-4c02-905d-9f84051640f4",
    "Graphic Design 3D": "7d7c2bc5-4b12-4ac3-81a9-630057e9e89f",
    "Illustration": "645e4195-f63d-4715-a3f2-3fb1e6eb8c70",
    "None": "556c1ee5-ec38-42e8-955a-1e82dad0ffa1",
    "Portrait": "8e2bc543-6ee2-45f9-bcd9-594b6ce84dcd",
    "Portrait Cinematic": "4edb03c9-8a26-4041-9d01-f85b5d4abd71",
    "Ray Traced": "b504f83c-3326-4947-82e1-7fe9e839ec0f",
    "Stock Photo": "5bdc3f2a-1be6-4d1c-8e77-992a30824a2c",
    "Watercolor": "1db308ce-c7ad-4d10-96fd-592fa6b75cc4"
};

/**
 * Official Nano Banana 2 style UUIDs (v2 API).
 * Use these with generateNanoBananaImage.
 */
export const NANO_BANANA_STYLES: Record<string, string> = {
    "3D Render":           "debdf72a-91a4-467b-bf61-cc02bdeb69c6",
    "Acrylic":             "3cbb655a-7ca4-463f-b697-8a03ad67327c",
    "Creative":            "6fedbf1f-4a17-45ec-84fb-92fe524a29ef",
    "Dynamic":             "111dc692-d470-4eec-b791-3475abac4c46",
    "Fashion":             "594c4a08-a522-4e0e-b7ff-e4dac4b6b622",
    "Game Concept":        "09d2b5b5-d7c5-4c02-905d-9f84051640f4",
    "Graphic Design 2D":   "703d6fe5-7f1c-4a9e-8da0-5331f214d5cf",
    "Graphic Design 3D":   "7d7c2bc5-4b12-4ac3-81a9-630057e9e89f",
    "Illustration":        "645e4195-f63d-4715-a3f2-3fb1e6eb8c70",
    "None":                "556c1ee5-ec38-42e8-955a-1e82dad0ffa1",
    "Portrait":            "8e2bc543-6ee2-45f9-bcd9-594b6ce84dcd",
    "Portrait Cinematic":  "4edb03c9-8a26-4041-9d01-f85b5d4abd71",
    "Portrait Fashion":    "0d34f8e1-46d4-428f-8ddd-4b11811fa7c9",
    "Pro B&W Photography": "22a9a7d2-2166-4d86-80ff-22e2643adbcf",
    "Pro Color Photography":"7c3f932b-a572-47cb-9b9b-f20211e63b5b",
    "Pro Film Photography": "581ba6d6-5aac-4492-bebe-54c424a0d46e",
    "Ray Traced":          "b504f83c-3326-4947-82e1-7fe9e839ec0f",
    "Stock Photo":         "5bdc3f2a-1be6-4d1c-8e77-992a30824a2c",
    "Watercolor":          "1db308ce-c7ad-4d10-96fd-592fa6b75cc4",
};

const DEFAULT_STYLE_UUID = LEONARDO_STYLES["Dynamic"];
const DEFAULT_NANO_BANANA_STYLE = NANO_BANANA_STYLES["Dynamic"];

/** Load all available Leonardo keys from env */
function getKeys(): string[] {
    return LEONARDO_KEY_NAMES
        .map(name => process.env[name])
        .filter((key): key is string => !!key && key.length > 0);
}

/**
 * Submit a generation job to Leonardo AI with randomized key shuffling.
 * Returns the generationId AND the key used (so polling uses the same key).
 */
async function submitLeonardoJob(
    prompt: string,
    width: number,
    height: number,
    styleUUID?: string
): Promise<{ generationId: string; apiKey: string }> {
    const allKeys = getKeys();
    if (allKeys.length === 0) {
        throw new Error("No LEONARDO_API_KEY found in environment variables");
    }

    // Create a shuffled copy of the keys to try them in random order
    const shuffledKeys = [...allKeys]
        .map(value => ({ value, sort: Math.random() }))
        .sort((a, b) => a.sort - b.sort)
        .map(({ value }) => value);

    const errors: string[] = [];

    for (let i = 0; i < shuffledKeys.length; i++) {
        const apiKey = shuffledKeys[i];
        const keyIndex = allKeys.indexOf(apiKey); // Original index for logging

        try {
            console.log(`⏳ Submitting Leonardo job using shuffled key #${keyIndex + 1}/${allKeys.length}...`);
            const response = await fetch("https://cloud.leonardo.ai/api/rest/v1/generations", {
                method: "POST",
                headers: {
                    "accept": "application/json",
                    "authorization": `Bearer ${apiKey}`,
                    "content-type": "application/json"
                },
                body: JSON.stringify({
                    modelId: FLUX_SCHNELL_MODEL_ID,
                    prompt,
                    width,
                    height,
                    num_images: 1,
                    contrast: 1.0,
                    styleUUID: styleUUID || DEFAULT_STYLE_UUID,
                    enhancePrompt: false
                })
            });

            if (response.status === 429) {
                console.warn(`⚠️ Leonardo key #${keyIndex + 1} rate-limited (429). Trying another shuffled key...`);
                errors.push(`Key #${keyIndex + 1}: Rate limited (429)`);
                continue;
            }

            if (!response.ok) {
                const errorText = await response.text();
                console.warn(`⚠️ Leonardo key #${keyIndex + 1} failed (${response.status}): ${errorText}`);
                errors.push(`Key #${keyIndex + 1}: ${response.status} - ${errorText}`);
                continue;
            }

            const result = await response.json();
            const generationId = result?.sdGenerationJob?.generationId;

            if (!generationId) {
                throw new Error(`Leonardo returned no generationId. Response: ${JSON.stringify(result)}`);
            }

            console.log(`✅ Leonardo job submitted! key: #${keyIndex + 1}, id: ${generationId}`);
            return { generationId, apiKey };

        } catch (error: any) {
            console.warn(`🧨 Error with Leonardo key #${keyIndex + 1}: ${error.message}`);
            errors.push(`Key #${keyIndex + 1}: ${error.message}`);
            continue;
        }
    }

    throw new Error(`All ${allKeys.length} Leonardo keys failed:\n${errors.join("\n")}`);
}

/**
 * Poll for a Leonardo generation result until done.
 * Uses the SAME key that submitted the job.
 */
async function pollLeonardoJob(
    generationId: string,
    apiKey: string,
    maxAttempts: number = 150,  // 150 × 2s = 5 minutes (was 60 = 2 min, too short for Nano Banana 2)
    cancelSignal?: { cancelled: boolean }  // optional external cancellation token
): Promise<string> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        // ── Check cancellation before each sleep ──────────────────────────────
        if (cancelSignal?.cancelled) {
            throw new Error(`Leonardo job ${generationId} cancelled by force stop.`);
        }

        await new Promise(resolve => setTimeout(resolve, 2000));

        // ── Check cancellation again after sleep (catches mid-sleep stops) ───
        if (cancelSignal?.cancelled) {
            throw new Error(`Leonardo job ${generationId} cancelled by force stop.`);
        }

        try {
            const statusResponse = await fetch(
                `https://cloud.leonardo.ai/api/rest/v1/generations/${generationId}`,
                {
                    headers: {
                        "accept": "application/json",
                        "authorization": `Bearer ${apiKey}`
                    }
                }
            );

            if (statusResponse.status === 429) {
                console.warn(`⚠️ Leonardo polling rate-limited, waiting extra time...`);
                await new Promise(resolve => setTimeout(resolve, 5000));
                continue;
            }

            if (!statusResponse.ok) {
                const errorText = await statusResponse.text();
                throw new Error(`Leonardo status check failed (${statusResponse.status}): ${errorText}`);
            }

            const statusResult = await statusResponse.json();
            const generation = statusResult?.generations_by_pk;
            const status = generation?.status;

            if (attempt % 5 === 0) {
                const elapsedSec = (attempt * 2);
                console.log(`  Poll #${attempt + 1}: status = ${status} (~${elapsedSec}s elapsed)`);
            }

            if (status === "COMPLETE") {
                const images = generation?.generated_images;
                if (!images || images.length === 0) {
                    throw new Error(`Leonardo job complete but no images found. Response: ${JSON.stringify(statusResult).substring(0, 500)}`);
                }
                const imageUrl = images[0].url;
                if (!imageUrl) {
                    throw new Error(`Leonardo job complete but no URL in image. Keys: ${Object.keys(images[0])}`);
                }
                return imageUrl;
            }

            if (status === "FAILED") {
                throw new Error(`Leonardo job failed: ${JSON.stringify(statusResult)}`);
            }

        } catch (error: any) {
            if (error.message.includes("cancelled by force stop")) throw error; // Don't swallow cancellation
            if (error.message.includes("429")) {
                await new Promise(resolve => setTimeout(resolve, 5000));
                continue;
            }
            throw error;
        }
    }

    throw new Error(`Leonardo job ${generationId} timed out after ${maxAttempts} poll attempts`);
}

/**
 * Generate an image using Leonardo AI FLUX Schnell with full key rotation.
 * Submit job → poll for result → return image URL.
 */
export async function generateLeonardoImage(
    prompt: string,
    width: number = 768,
    height: number = 432,
    styleUUID?: string,
    cancelSignal?: { cancelled: boolean }
): Promise<string> {
    const { generationId, apiKey } = await submitLeonardoJob(prompt, width, height, styleUUID);
    const imageUrl = await pollLeonardoJob(generationId, apiKey, 150, cancelSignal);
    return imageUrl;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Lucid Origin — High-quality image generation for Short Videos
// ═══════════════════════════════════════════════════════════════════════════════

const LUCID_ORIGIN_MODEL_ID = "7b592283-e8a7-4c5a-9ba6-d18c31f258b9";
const LUCID_REALISM_MODEL_ID = "04066042-3e2b-42e8-958b-03000b5514f7"; // Replaced with official Lucid Realism ID if found, or using the one from search
// Note: 05ce0082-2d80-4a2d-8653-4d1c85e2418e was also mentioned as Lucid Realism in search, I will use this instead based on confidence.
const FINAL_LUCID_REALISM_ID = "05ce0082-2d80-4a2d-8653-4d1c85e2418e";

export const LUCID_ORIGIN_STYLES: Record<string, string> = {
    "Bokeh": "9fdc5e8c-4d13-49b4-9ce6-5a74cbb19177",
    "Cinematic": "a5632c7c-ddbb-4e2f-ba34-8456ab3ac436",
    "Cinematic Close-Up": "cc53f935-884c-40a0-b7eb-1f5c42821fb5",
    "Creative": "6fedbf1f-4a17-45ec-84fb-92fe524a29ef",
    "Dynamic": "111dc692-d470-4eec-b791-3475abac4c46",
    "Fashion": "594c4a08-a522-4e0e-b7ff-e4dac4b6b622",
    "Film": "85da2dcc-c373-464c-9a7a-5624359be859",
    "Food": "d574325d-1278-4fe2-974b-768525f253c3",
    "HDR": "97c20e5c-1af6-4d42-b227-54d03d8f0727",
    "Long Exposure": "335e6010-a75c-45d9-afc5-032c65e9180e",
    "Macro": "30c1d34f-e3a9-479a-b56f-c018bbc9c02a",
    "Minimalist": "cadc8cd6-7838-4c99-b645-df76be8ba8d8",
    "Monochrome": "a2f7ea66-959b-4bbe-b508-6133238b76b6",
    "Moody": "621e1c9a-6319-4bee-a12d-ae40659162fa",
    "Neutral": "0d914779-c822-430a-b976-30075033f1c4",
    "None": "556c1ee5-ec38-42e8-955a-1e82dad0ffa1",
    "Portrait": "8e2bc543-6ee2-45f9-bcd9-594b6ce84dcd",
    "Retro": "6105baa2-851b-446e-9db5-08a671a8c42f",
    "Stock Photo": "5bdc3f2a-1be6-4d1c-8e77-992a30824a2c",
    "Unprocessed": "62736842-6e4b-4028-b79a-4f1a1606e893",
    "Vibrant": "dee282d3-891f-4f73-ba02-7f8131e5541b",
};

/**
 * Submit a Lucid Origin generation job with key rotation.
 * Uses contrast parameter (required for Lucid Origin) and no alchemy.
 */
async function submitLucidOriginJob(
    prompt: string,
    width: number,
    height: number,
    styleUUID?: string,
    contrast: number = 3.5
): Promise<{ generationId: string; apiKey: string }> {
    const allKeys = getKeys();
    if (allKeys.length === 0) {
        throw new Error("No LEONARDO_API_KEY found in environment variables");
    }

    const shuffledKeys = [...allKeys]
        .map(value => ({ value, sort: Math.random() }))
        .sort((a, b) => a.sort - b.sort)
        .map(({ value }) => value);

    const errors: string[] = [];

    for (let i = 0; i < shuffledKeys.length; i++) {
        const apiKey = shuffledKeys[i];
        const keyIndex = allKeys.indexOf(apiKey);

        try {
            console.log(`⏳ Submitting Lucid Origin job using key #${keyIndex + 1}/${allKeys.length}...`);
            const response = await fetch("https://cloud.leonardo.ai/api/rest/v1/generations", {
                method: "POST",
                headers: {
                    "accept": "application/json",
                    "authorization": `Bearer ${apiKey}`,
                    "content-type": "application/json"
                },
                body: JSON.stringify({
                    modelId: LUCID_ORIGIN_MODEL_ID,
                    prompt,
                    width,
                    height,
                    num_images: 1,
                    contrast,
                    alchemy: false,
                    ultra: false,
                    styleUUID: styleUUID || LUCID_ORIGIN_STYLES["Dynamic"],
                    enhancePrompt: false,
                })
            });

            if (response.status === 429) {
                console.warn(`⚠️ Lucid Origin key #${keyIndex + 1} rate-limited (429). Trying next...`);
                errors.push(`Key #${keyIndex + 1}: Rate limited (429)`);
                continue;
            }

            if (!response.ok) {
                const errorText = await response.text();
                console.warn(`⚠️ Lucid Origin key #${keyIndex + 1} failed (${response.status}): ${errorText}`);
                errors.push(`Key #${keyIndex + 1}: ${response.status} - ${errorText}`);
                continue;
            }

            const result = await response.json();
            const generationId = result?.sdGenerationJob?.generationId;

            if (!generationId) {
                throw new Error(`Lucid Origin returned no generationId: ${JSON.stringify(result)}`);
            }

            console.log(`✅ Lucid Origin job submitted! key: #${keyIndex + 1}, id: ${generationId}`);
            return { generationId, apiKey };

        } catch (error: any) {
            console.warn(`🧨 Error with key #${keyIndex + 1}: ${error.message}`);
            errors.push(`Key #${keyIndex + 1}: ${error.message}`);
            continue;
        }
    }

    throw new Error(`All ${allKeys.length} Leonardo keys failed:\n${errors.join("\n")}`);
}

/**
 * Generate an image using Lucid Origin (HD, high-quality) with full key rotation.
 * Best for short video scene images with detailed prompts.
 *
 * Default: portrait 768×1376 for vertical shorts (9:16)
 * Cost: ~$0.012 per image at smallest size
 */
export async function generateLucidOriginImage(
    prompt: string,
    width: number = 768,
    height: number = 1344,
    styleUUID?: string,
    contrast: number = 3.5
): Promise<string> {
    const { generationId, apiKey } = await submitLeonardoJobWithModel(LUCID_ORIGIN_MODEL_ID, prompt, width, height, styleUUID, contrast);
    const imageUrl = await pollLeonardoJob(generationId, apiKey);
    return imageUrl;
}

/**
 * Generate an image using Lucid Realism (Cinema-grade, hyper-realistic)
 * Best for historical accuracy and cinematic visuals.
 */
export async function generateLucidRealismImage(
    prompt: string,
    width: number = 768,
    height: number = 1344,
    styleUUID?: string,
    contrast: number = 3.5
): Promise<string> {
    const { generationId, apiKey } = await submitLeonardoJobWithModel(FINAL_LUCID_REALISM_ID, prompt, width, height, styleUUID, contrast);
    const imageUrl = await pollLeonardoJob(generationId, apiKey);
    return imageUrl;
}

/** Generic model submission helper */
async function submitLeonardoJobWithModel(
    modelId: string,
    prompt: string,
    width: number,
    height: number,
    styleUUID?: string,
    contrast: number = 3.5
): Promise<{ generationId: string; apiKey: string }> {
    const allKeys = getKeys();
    if (allKeys.length === 0) throw new Error("No LEONARDO_API_KEY found");

    const shuffledKeys = [...allKeys].sort(() => Math.random() - 0.5);
    const errors: string[] = [];

    for (const apiKey of shuffledKeys) {
        try {
            const response = await fetch("https://cloud.leonardo.ai/api/rest/v1/generations", {
                method: "POST",
                headers: {
                    "accept": "application/json",
                    "authorization": `Bearer ${apiKey}`,
                    "content-type": "application/json"
                },
                body: JSON.stringify({
                    modelId,
                    prompt,
                    width,
                    height,
                    num_images: 1,
                    contrast,
                    alchemy: false,
                    styleUUID: styleUUID || LUCID_ORIGIN_STYLES["Dynamic"],
                    enhancePrompt: false,
                })
            });

            if (!response.ok) {
                const text = await response.text();
                errors.push(`${response.status}: ${text}`);
                continue;
            }

            const result = await response.json();
            return { generationId: result?.sdGenerationJob?.generationId, apiKey };
        } catch (e: any) {
            errors.push(e.message);
        }
    }
    throw new Error(`All keys failed: ${errors.join(", ")}`);
}
// ── Nano Banana 2 → Nano Banana fallback — 9:16 portrait dimensions ──────────
// Valid pair per Leonardo docs: 768 × 1344
const NB_9x16_WIDTH  = 768;
const NB_9x16_HEIGHT = 1344;

/**
 * Model priority list for Nano Banana image generation.
 * nano-banana-2 is tried first (priority), gemini-2.5-flash-image (Nano Banana v1) is the fallback.
 *
 * API model codes (per Leonardo.AI docs):
 *   Nano Banana 2  → "nano-banana-2"
 *   Nano Banana v1 → "gemini-2.5-flash-image"
 */
const NANO_BANANA_MODEL_PRIORITY = [
    "nano-banana-2",            // ← Primary: Nano Banana 2 (always try first)
    "gemini-2.5-flash-image",   // ← Fallback: Nano Banana v1 (if nb-2 fails)
];

/**
 * Generate an image using Nano Banana 2 (priority) with Nano Banana as fallback.
 * Tries nano-banana-2 across ALL available keys first.
 * If all keys fail with nano-banana-2, falls back to nano-banana across all keys.
 *
 * Default: 768×1344 (valid 9:16 portrait pair per Leonardo docs)
 * For thumbnails: pass 1024×1024 explicitly.
 */
export async function generateNanoBananaImage(
    prompt: string,
    width: number = NB_9x16_WIDTH,
    height: number = NB_9x16_HEIGHT,
    styleUUID?: string,
    cancelSignal?: { cancelled: boolean }
): Promise<string> {
    const enhancedPrompt = enhanceForRealism(prompt);

    const allErrors: string[] = [];

    for (const model of NANO_BANANA_MODEL_PRIORITY) {
        // Respect cancellation before each model attempt
        if (cancelSignal?.cancelled) {
            throw new Error(`Image generation cancelled by force stop.`);
        }

        console.log(`🍌 Generating image with ${model} (${width}×${height})...`);

        try {
            const { generationId, apiKey } = await submitLeonardoJobV2(
                model,
                enhancedPrompt,
                width,
                height,
                styleUUID
            );

            // Poll up to 5 minutes (150 × 2s)
            const imageUrl = await pollLeonardoJob(generationId, apiKey, 150, cancelSignal);
            console.log(`✅ ${model} image ready!`);
            return imageUrl;

        } catch (err: any) {
            // Propagate cancellation immediately — don't try fallback
            if (
                cancelSignal?.cancelled ||
                err?.message?.includes('cancelled by force stop')
            ) {
                throw err;
            }

            console.warn(`⚠️ ${model} failed (${err?.message?.substring(0, 120)}). Trying next model...`);
            allErrors.push(`[${model}]: ${err?.message}`);
        }
    }

    throw new Error(
        `All Nano Banana models failed:\n${allErrors.join('\n')}`
    );
}





/**
 * Enhance a user prompt with realism keywords for Nano Banana 2.
 * Skips enhancement if the prompt already contains quality descriptors.
 */
function enhanceForRealism(prompt: string): string {
    const alreadyEnhanced = /photorealistic|ultra realistic|8k|RAW photo|DSLR|cinematic|hyperrealistic/i.test(prompt);
    if (alreadyEnhanced) return prompt;
    return `${prompt}, photorealistic, ultra detailed, cinematic lighting, sharp focus, 8k resolution, professional photography`;
}
/**
 * submitLeonardoJobV2
 * Uses the REST v2 endpoint (Nano Banana 2 / Nano Banana).
 * Polls via the v1 status endpoint (same generation system under the hood).
 * Tries all available keys with the specified model.
 */
async function submitLeonardoJobV2(
    model: string,
    prompt: string,
    width: number,
    height: number,
    styleUUID?: string
): Promise<{ generationId: string; apiKey: string }> {
    const allKeys = getKeys();
    if (allKeys.length === 0) throw new Error("No LEONARDO_API_KEY found");

    const shuffledKeys = [...allKeys].sort(() => Math.random() - 0.5);
    const errors: string[] = [];

    for (const apiKey of shuffledKeys) {
        const keyLabel = `Key #${allKeys.indexOf(apiKey) + 1}`;
        try {
            console.log(`⏳ Submitting ${model} job (${keyLabel})...`);
            const response = await fetch("https://cloud.leonardo.ai/api/rest/v2/generations", {
                method: "POST",
                headers: {
                    "accept": "application/json",
                    "authorization": `Bearer ${apiKey}`,
                    "content-type": "application/json"
                },
                body: JSON.stringify({
                    model,
                    parameters: {
                        prompt,
                        width,
                        height,
                        quantity: 1,
                        style_ids: [styleUUID || DEFAULT_NANO_BANANA_STYLE],
                        prompt_enhance: "OFF"
                    },
                    public: false
                })
            });

            if (response.status === 429) {
                console.warn(`⚠️ ${keyLabel} rate-limited (429). Trying next key...`);
                errors.push(`${keyLabel}: Rate limited (429)`);
                continue;
            }

            if (!response.ok) {
                const text = await response.text();
                console.warn(`⚠️ ${keyLabel} failed (${response.status}): ${text}`);
                errors.push(`${keyLabel}: ${response.status} - ${text}`);
                continue;
            }

            const result = await response.json();
            console.log(`📦 ${model} raw response: ${JSON.stringify(result).substring(0, 200)}`);

            // v2 API response shape: { generate: { generationId: '...', cost: {...} } }
            const generationId =
                result?.generate?.generationId ||  // ← actual v2 shape
                result?.data?.generationId ||
                result?.data?.id ||
                result?.generationId ||
                result?.sdGenerationJob?.generationId ||
                result?.id;

            if (!generationId) {
                console.error(`❌ ${keyLabel} — v2 response missing generationId. Full response:`, JSON.stringify(result));
                errors.push(`${keyLabel}: v2 response missing generationId`);
                continue;
            }

            console.log(`✅ ${model} job submitted! ${keyLabel}, id: ${generationId}`);
            return { generationId, apiKey };
        } catch (e: any) {
            console.warn(`🧨 Error with ${keyLabel} (${model}): ${e.message}`);
            errors.push(`${keyLabel}: ${e.message}`);
        }
    }
    throw new Error(`All ${allKeys.length} Leonardo keys failed with model '${model}': ${errors.join(", ")}`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// PARALLEL NANO BANANA IMAGE GENERATION
// ═══════════════════════════════════════════════════════════════════════════════

interface NanoBananaSceneConfig {
    index: number;           // original scene index
    prompt: string;
    width?: number;
    height?: number;
    styleUUID?: string;
}

export interface NanoBananaResult {
    index: number;
    imageUrl: string;
    success: boolean;
    error?: string;
}

/**
 * Submit a Nano Banana job using a SPECIFIC key order (no shuffling).
 * Used by parallel generation to ensure each scene uses a different primary key.
 */
async function submitNanoBananaJobWithKeyOrder(
    model: string,
    prompt: string,
    width: number,
    height: number,
    keyOrder: string[],
    styleUUID?: string,
): Promise<{ generationId: string; apiKey: string }> {
    const allKeys = getKeys();
    const errors: string[] = [];

    for (const apiKey of keyOrder) {
        const keyLabel = `Key #${allKeys.indexOf(apiKey) + 1}`;
        try {
            const response = await fetch("https://cloud.leonardo.ai/api/rest/v2/generations", {
                method: "POST",
                headers: {
                    "accept": "application/json",
                    "authorization": `Bearer ${apiKey}`,
                    "content-type": "application/json"
                },
                body: JSON.stringify({
                    model,
                    parameters: {
                        prompt,
                        width,
                        height,
                        quantity: 1,
                        style_ids: [styleUUID || DEFAULT_NANO_BANANA_STYLE],
                        prompt_enhance: "OFF"
                    },
                    public: false
                })
            });

            if (response.status === 429) {
                errors.push(`${keyLabel}: Rate limited (429)`);
                continue;
            }

            if (!response.ok) {
                const text = await response.text();
                errors.push(`${keyLabel}: ${response.status} - ${text}`);
                continue;
            }

            const result = await response.json();
            const generationId =
                result?.generate?.generationId ||
                result?.data?.generationId ||
                result?.generationId ||
                result?.sdGenerationJob?.generationId;

            if (!generationId) {
                errors.push(`${keyLabel}: missing generationId`);
                continue;
            }

            console.log(`✅ ${model} job submitted! ${keyLabel}, id: ${generationId}`);
            return { generationId, apiKey };
        } catch (e: any) {
            errors.push(`${keyLabel}: ${e.message}`);
        }
    }
    throw new Error(`All keys failed for ${model}: ${errors.join(", ")}`);
}

/**
 * Generate multiple Nano Banana images in PARALLEL with round-robin key rotation.
 * Each scene gets a unique primary key (Scene 0 → Key[0], Scene 1 → Key[1], etc.)
 * with fallback to other keys if the primary fails.
 *
 * Submits all jobs concurrently → polls all in parallel → returns results.
 * Total wall-clock time ≈ time for ONE image (~2min) instead of N×2min.
 *
 * @param scenes       - Array of scene configs to generate images for
 * @param cancelSignal - Optional cancellation token (force-stop support)
 * @param concurrency  - Max concurrent submissions (default: 4)
 * @returns Array of results per scene (imageUrl empty on failure)
 */
export async function generateNanoBananaImagesParallel(
    scenes: NanoBananaSceneConfig[],
    cancelSignal?: { cancelled: boolean },
    concurrency: number = 4,
): Promise<NanoBananaResult[]> {
    const allKeys = getKeys();
    if (allKeys.length === 0) throw new Error("No LEONARDO_API_KEY found");

    console.log(`🚀 Parallel Nano Banana: ${scenes.length} scenes, ${allKeys.length} keys, concurrency=${concurrency}`);

    const results: NanoBananaResult[] = [];

    // ── Phase 1: Submit ALL jobs with round-robin key assignment ──────────
    const pendingJobs: Array<{
        sceneIndex: number;
        generationId: string;
        apiKey: string;
        model: string;
    }> = [];

    for (let batchStart = 0; batchStart < scenes.length; batchStart += concurrency) {
        if (cancelSignal?.cancelled) break;

        const batch = scenes.slice(batchStart, batchStart + concurrency);

        const batchResults = await Promise.allSettled(
            batch.map(async (scene, batchIdx) => {
                if (cancelSignal?.cancelled) throw new Error("cancelled by force stop");

                const globalIdx = batchStart + batchIdx;
                // Round-robin: each scene starts with a different key
                const primaryKeyIdx = globalIdx % allKeys.length;
                const keyOrder: string[] = [];
                for (let k = 0; k < allKeys.length; k++) {
                    keyOrder.push(allKeys[(primaryKeyIdx + k) % allKeys.length]);
                }

                const prompt = enhanceForRealism(scene.prompt);
                const width = scene.width || NB_9x16_WIDTH;
                const height = scene.height || NB_9x16_HEIGHT;

                console.log(`🍌 Scene ${scene.index + 1}: submitting with primary Key #${primaryKeyIdx + 1}`);

                // Try nano-banana-2 first, fall back to gemini-2.5-flash-image
                for (const model of NANO_BANANA_MODEL_PRIORITY) {
                    if (cancelSignal?.cancelled) throw new Error("cancelled by force stop");
                    try {
                        const { generationId, apiKey } = await submitNanoBananaJobWithKeyOrder(
                            model, prompt, width, height, keyOrder, scene.styleUUID
                        );
                        return { sceneIndex: scene.index, generationId, apiKey, model };
                    } catch (err: any) {
                        if (cancelSignal?.cancelled || err?.message?.includes('cancelled')) throw err;
                        console.warn(`⚠️ Scene ${scene.index + 1}: ${model} failed: ${err.message?.substring(0, 100)}`);
                    }
                }
                throw new Error(`Scene ${scene.index + 1}: all models failed`);
            })
        );

        for (let i = 0; i < batchResults.length; i++) {
            const result = batchResults[i];
            if (result.status === "fulfilled") {
                pendingJobs.push(result.value);
            } else {
                const scene = batch[i];
                console.error(`❌ Scene ${scene.index + 1} submission failed: ${result.reason?.message}`);
                results.push({
                    index: scene.index,
                    imageUrl: "",
                    success: false,
                    error: result.reason?.message,
                });
            }
        }

        // Brief pause between submission batches
        if (batchStart + concurrency < scenes.length) {
            await new Promise(r => setTimeout(r, 1000));
        }
    }

    console.log(`✅ Submitted ${pendingJobs.length}/${scenes.length} Nano Banana jobs. Polling in parallel...`);

    // ── Phase 2: Poll ALL jobs in parallel ────────────────────────────────
    const pollResults = await Promise.allSettled(
        pendingJobs.map(async (job) => {
            const imageUrl = await pollLeonardoJob(job.generationId, job.apiKey, 150, cancelSignal);
            console.log(`✅ Scene ${job.sceneIndex + 1} ${job.model} image ready!`);
            return { sceneIndex: job.sceneIndex, imageUrl };
        })
    );

    for (let i = 0; i < pollResults.length; i++) {
        const result = pollResults[i];
        if (result.status === "fulfilled") {
            results.push({
                index: result.value.sceneIndex,
                imageUrl: result.value.imageUrl,
                success: true,
            });
        } else {
            const sceneIdx = pendingJobs[i]?.sceneIndex ?? -1;
            console.error(`❌ Scene ${sceneIdx + 1} polling failed: ${result.reason?.message}`);
            results.push({
                index: sceneIdx,
                imageUrl: "",
                success: false,
                error: result.reason?.message,
            });
        }
    }

    const successCount = results.filter(r => r.success).length;
    console.log(`🏁 Parallel Nano Banana complete: ${successCount}/${scenes.length} images generated`);

    return results;
}


// ═══════════════════════════════════════════════════════════════════════════════
// GPT IMAGE-1.5 — with User Image Reference Support
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Upload an image (by URL or Buffer) to Leonardo's init-image endpoint.
 * Returns the Leonardo image ID to use in guidances.image_reference.
 *
 * Always converts to JPEG ≤1024px to stay within S3 pre-data limits.
 */
export async function uploadImageToLeonardo(
    imageUrl: string,
    apiKey: string
): Promise<string> {
    // Step 1: Get upload presigned URL from Leonardo
    const initRes = await fetch("https://cloud.leonardo.ai/api/rest/v1/init-image", {
        method: "POST",
        headers: {
            "accept": "application/json",
            "authorization": `Bearer ${apiKey}`,
            "content-type": "application/json",
        },
        body: JSON.stringify({ extension: "jpg" }),
    });
    if (!initRes.ok) {
        throw new Error(`Leonardo init-image failed (${initRes.status}): ${await initRes.text()}`);
    }
    const initData = await initRes.json();
    const uploadUrl: string = initData?.uploadInitImage?.url;
    const imageId: string = initData?.uploadInitImage?.id;

    // Fields can be a string (JSON) or object
    let fields: Record<string, string> = {};
    const rawFields = initData?.uploadInitImage?.fields;
    if (typeof rawFields === "string") {
        try { fields = JSON.parse(rawFields); } catch { fields = {}; }
    } else if (rawFields && typeof rawFields === "object") {
        fields = rawFields;
    }

    if (!uploadUrl || !imageId) {
        throw new Error(`Leonardo init-image missing url/id: ${JSON.stringify(initData)}`);
    }

    // Step 2: Fetch the image
    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) throw new Error(`Failed to fetch image for upload: ${imgRes.status}`);
    const imageBuffer = await imgRes.arrayBuffer();

    // Step 3: ALWAYS convert to small JPEG (≤1024px, 80% quality) via sharp
    // This ensures compatibility and keeps payload small
    const sharp = (await import("sharp")).default;
    const uploadBuffer = await sharp(Buffer.from(imageBuffer))
        .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer();

    console.log(`📦 Image prepared for Leonardo upload: ${(uploadBuffer.length / 1024).toFixed(0)}KB`);

    // Step 4: Upload to S3 presigned URL
    // Only include essential S3 fields to stay under MaxPostPreDataLength (20KB)
    const essentialFieldNames = [
        "key", "bucket", "X-Amz-Algorithm", "X-Amz-Credential",
        "X-Amz-Date", "X-Amz-Security-Token", "Policy", "X-Amz-Signature",
        "Content-Type", "Content-Disposition", "acl",
        "x-amz-meta-user_id", "x-amz-meta-team_id",
        "success_action_status", "success_action_redirect",
    ];

    const formData = new FormData();
    for (const [key, value] of Object.entries(fields)) {
        // Only include known essential fields + any short fields
        if (essentialFieldNames.some(n => n.toLowerCase() === key.toLowerCase()) || value.length < 200) {
            formData.append(key, value);
        }
    }
    formData.append("file", new Blob([uploadBuffer], { type: "image/jpeg" }), "image.jpg");

    const uploadRes = await fetch(uploadUrl, {
        method: "POST",
        body: formData,
    });
    if (!uploadRes.ok && uploadRes.status !== 204) {
        throw new Error(`S3 upload failed (${uploadRes.status}): ${await uploadRes.text().catch(() => "")}`);
    }

    console.log(`✅ Image uploaded to Leonardo: id=${imageId}`);
    return imageId;
}

/**
 * Generate images using GPT Image-1.5 with a user reference image.
 * The user's uploaded image is embedded as image_reference guidance (MID strength).
 *
 * @param prompt         - Text prompt describing the image
 * @param refImageId     - Leonardo image ID (from uploadImageToLeonardo) — pass null to generate without reference
 * @param quantity       - Number of images to generate (1–4)
 * @param quality        - "LOW" | "MEDIUM" | "HIGH"
 * @param width          - 1024 (square) or 1536 (landscape/portrait)
 * @param height         - 1024 (square) or 1536 (landscape/portrait)
 */
export async function generateGptImage15(
    prompt: string,
    refImageId: string | null,
    quantity: number = 1,
    quality: "LOW" | "MEDIUM" | "HIGH" = "MEDIUM",
    width: number = 1024,
    height: number = 1024,
): Promise<string[]> {
    const allKeys = getKeys();
    if (allKeys.length === 0) throw new Error("No LEONARDO_API_KEY found");

    const shuffledKeys = [...allKeys].sort(() => Math.random() - 0.5);
    const errors: string[] = [];

    const parameters: Record<string, any> = {
        prompt,
        quantity: Math.min(quantity, 4),
        width,
        height,
        quality,
        prompt_enhance: "OFF",
    };

    // Attach user image as reference if provided
    if (refImageId) {
        parameters.guidances = {
            image_reference: [{
                image: { id: refImageId, type: "UPLOADED" },
                strength: "MID",
            }],
        };
    }

    let generationId: string | null = null;
    let usedApiKey: string | null = null;

    for (const apiKey of shuffledKeys) {
        const keyLabel = `Key #${allKeys.indexOf(apiKey) + 1}`;
        try {
            console.log(`⏳ GPT Image-1.5: submitting (${keyLabel}, qty=${quantity}, quality=${quality})...`);
            const response = await fetch("https://cloud.leonardo.ai/api/rest/v2/generations", {
                method: "POST",
                headers: {
                    "accept": "application/json",
                    "authorization": `Bearer ${apiKey}`,
                    "content-type": "application/json",
                },
                body: JSON.stringify({
                    model: "gpt-image-1.5",
                    parameters,
                    public: false,
                }),
            });

            if (response.status === 429) {
                errors.push(`${keyLabel}: Rate limited`);
                continue;
            }
            if (!response.ok) {
                const text = await response.text();
                errors.push(`${keyLabel}: ${response.status} - ${text}`);
                continue;
            }

            const result = await response.json();
            console.log(`📦 GPT Image-1.5 raw response: ${JSON.stringify(result).substring(0, 300)}`);

            generationId =
                result?.generate?.generationId ||
                result?.data?.generationId ||
                result?.generationId ||
                result?.sdGenerationJob?.generationId ||
                result?.id;

            if (!generationId) {
                errors.push(`${keyLabel}: missing generationId`);
                continue;
            }

            usedApiKey = apiKey;
            console.log(`✅ GPT Image-1.5 job submitted! ${keyLabel}, id: ${generationId}`);
            break;
        } catch (e: any) {
            errors.push(`${keyLabel}: ${e.message}`);
        }
    }

    if (!generationId || !usedApiKey) {
        throw new Error(`GPT Image-1.5: all keys failed:\n${errors.join("\n")}`);
    }

    // Poll for result
    const firstImageUrl = await pollLeonardoJob(generationId, usedApiKey, 150);
    console.log(`✅ GPT Image-1.5 image ready!`);

    // Fetch all generated images (not just the first)
    // Poll gives us only the first URL — fetch full generation for all images
    const statusRes = await fetch(
        `https://cloud.leonardo.ai/api/rest/v1/generations/${generationId}`,
        { headers: { "accept": "application/json", "authorization": `Bearer ${usedApiKey}` } }
    );
    if (statusRes.ok) {
        const statusData = await statusRes.json();
        const allImages: string[] = (statusData?.generations_by_pk?.generated_images || [])
            .map((img: any) => img.url)
            .filter(Boolean);
        if (allImages.length > 0) return allImages;
    }

    return [firstImageUrl];
}
