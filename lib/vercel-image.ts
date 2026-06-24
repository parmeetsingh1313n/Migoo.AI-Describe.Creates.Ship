/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * Vercel AI Gateway — Image Generation Client
 * Model: google/imagen-4.0-generate-001 (Imagen 4 Standard, $0.04/image)
 * Key: AI_GATEWAY_API_KEY (single key — Vercel gateway handles billing)
 *
 * Drop-in replacement for lib/pollo.ts.
 * All exported function names and signatures are identical so callers only
 * need to change their import path.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const GATEWAY_BASE = "https://ai-gateway.vercel.sh";
const IMAGE_MODEL  = "google/imagen-4.0-generate-001";

// ─── Key helper ───────────────────────────────────────────────────────────────

function getGatewayKey(): string {
    const key = process.env.AI_GATEWAY_API_KEY;
    if (!key) throw new Error("[vercel-image] AI_GATEWAY_API_KEY is not set");
    return key;
}

// ─── Aspect ratio helper ──────────────────────────────────────────────────────

function getAspectRatio(width: number, height: number): "1:1" | "9:16" | "16:9" {
    const ratio = width / height;
    if (Math.abs(ratio - 1) < 0.1) return "1:1";
    if (ratio < 0.8)               return "9:16";
    return "16:9";
}

// ─── Re-exported style maps (kept for caller compatibility) ───────────────────

export const LEONARDO_STYLES: Record<string, string> = {
    "3D Render":          "debdf72a-91a4-467b-bf61-cc02bdeb69c6",
    "Acrylic":            "3cbb655a-7ca4-463f-b697-8a03ad67327c",
    "Anime General":      "b2a54a51-230b-4d4f-ad4e-8409bf58645f",
    "Creative":           "6fedbf1f-4a17-45ec-84fb-92fe524a29ef",
    "Dynamic":            "111dc692-d470-4eec-b791-3475abac4c46",
    "Fashion":            "594c4a08-a522-4e0e-b7ff-e4dac4b6b622",
    "Game Concept":       "09d2b5b5-d7c5-4c02-905d-9f84051640f4",
    "Graphic Design 3D":  "7d7c2bc5-4b12-4ac3-81a9-630057e9e89f",
    "Illustration":       "645e4195-f63d-4715-a3f2-3fb1e6eb8c70",
    "None":               "556c1ee5-ec38-42e8-955a-1e82dad0ffa1",
    "Portrait":           "8e2bc543-6ee2-45f9-bcd9-594b6ce84dcd",
    "Portrait Cinematic": "4edb03c9-8a26-4041-9d01-f85b5d4abd71",
    "Ray Traced":         "b504f83c-3326-4947-82e1-7fe9e839ec0f",
    "Stock Photo":        "5bdc3f2a-1be6-4d1c-8e77-992a30824a2c",
    "Watercolor":         "1db308ce-c7ad-4d10-96fd-592fa6b75cc4",
};

export const NANO_BANANA_STYLES: Record<string, string> = {
    ...LEONARDO_STYLES,
    "Graphic Design 2D":    "703d6fe5-7f1c-4a9e-8da0-5331f214d5cf",
    "Portrait Fashion":     "0d34f8e1-46d4-428f-8ddd-4b11811fa7c9",
    "Pro B&W Photography":  "22a9a7d2-2166-4d86-80ff-22e2643adbcf",
    "Pro Color Photography":"7c3f932b-a572-47cb-9b9b-f20211e63b5b",
    "Pro Film Photography": "581ba6d6-5aac-4492-bebe-54c424a0d46e",
};

// ─── Shared interfaces ────────────────────────────────────────────────────────

export interface NanoBananaSceneConfig {
    index: number;
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

export interface NanoBananaSubmissionResult {
    index: number;
    success: boolean;
    generationId?: string;
    apiKey?: string;
    model?: string;
    error?: string;
}

export interface NanoBananaStatusResult {
    index: number;
    status: "COMPLETE" | "FAILED" | "PENDING";
    imageUrl?: string;
    error?: string;
}

// ─── Core: call Vercel AI Gateway synchronously ───────────────────────────────

/**
 * Generate a single image via Vercel AI Gateway (Imagen 4 Standard).
 * Returns a PUBLIC image URL from Google's CDN (24-hour TTL).
 * This is SYNCHRONOUS from the caller's perspective — no polling needed.
 */
async function callGatewayImage(
    prompt: string,
    aspectRatio: "1:1" | "9:16" | "16:9",
    cancelSignal?: { cancelled: boolean }
): Promise<string> {
    if (cancelSignal?.cancelled) throw new Error("Job cancelled by force stop.");

    const key = getGatewayKey();

    const res = await fetch(`${GATEWAY_BASE}/v1/images/generations`, {
        method: "POST",
        headers: {
            "Content-Type":  "application/json",
            "Authorization": `Bearer ${key}`,
        },
        body: JSON.stringify({
            model:         IMAGE_MODEL,
            prompt,
            n:             1,
            aspect_ratio:  aspectRatio,
        }),
    });

    if (!res.ok) {
        const errText = await res.text().catch(() => res.statusText);
        throw new Error(`[vercel-image] Gateway error (${res.status}): ${errText.slice(0, 200)}`);
    }

    const data = await res.json() as any;

    // Vercel gateway returns OpenAI-compatible shape: { data: [{ url }] }
    const url = data?.data?.[0]?.url || data?.images?.[0]?.url || data?.url;
    if (!url) {
        throw new Error(`[vercel-image] No image URL in response: ${JSON.stringify(data).slice(0, 200)}`);
    }

    return url as string;
}

// ─── Public API (identical signatures to lib/pollo.ts exports) ────────────────

/**
 * Generate a single image — primary function used by most callers.
 * styleUUID parameter is accepted but ignored (Imagen 4 uses prompt-based styling).
 */
export async function generateNanoBananaImage(
    prompt: string,
    width:  number = 768,
    height: number = 1376,
    _styleUUID?: string,
    cancelSignal?: { cancelled: boolean }
): Promise<string> {
    const aspectRatio = getAspectRatio(width, height);
    console.log(`🎨 [vercel-image] Imagen 4 Standard | ${aspectRatio} | prompt: "${prompt.slice(0, 80)}..."`);
    const url = await callGatewayImage(prompt, aspectRatio, cancelSignal);
    console.log(`✅ [vercel-image] Image ready: ${url.slice(0, 80)}...`);
    return url;
}

/**
 * Nano Banana 2 / img2img compatibility shim.
 * Imagen 4 Standard does not support image-to-image, so imageUrl is ignored
 * and we fall back to text-to-image.
 */
export async function generateNanoBanana2Image(
    prompt: string,
    _imageUrl?: string,
    width:  number = 768,
    height: number = 1344,
    cancelSignal?: { cancelled: boolean }
): Promise<string> {
    console.log(`🎨 [vercel-image] Imagen 4 Standard (img2img → txt2img fallback)...`);
    return generateNanoBananaImage(prompt, width, height, undefined, cancelSignal);
}

/**
 * Convenience wrapper — single image URL, square format.
 */
export async function generateGptImage15SingleUrl(
    prompt: string,
    width:  number = 1024,
    height: number = 1024
): Promise<string> {
    return generateNanoBananaImage(prompt, width, height);
}

/**
 * Multi-image compatibility shim (used in notes pipeline).
 */
export async function generateGptImage15(
    prompt: string,
    _refImageUrl: string | null,
    _quantity:    number = 1,
    _quality:     "LOW" | "MEDIUM" | "HIGH" = "MEDIUM",
    width:        number = 1024,
    height:       number = 1024
): Promise<string[]> {
    const url = await generateNanoBananaImage(prompt, width, height);
    return [url];
}

/**
 * Generate multiple images in parallel (batched by concurrency).
 */
export async function generateNanoBananaImagesParallel(
    scenes:      NanoBananaSceneConfig[],
    cancelSignal?: { cancelled: boolean },
    concurrency: number = 4
): Promise<NanoBananaResult[]> {
    console.log(`🚀 [vercel-image] Generating ${scenes.length} images in parallel (concurrency=${concurrency})...`);
    const results: NanoBananaResult[] = [];

    for (let i = 0; i < scenes.length; i += concurrency) {
        if (cancelSignal?.cancelled) break;
        const batch = scenes.slice(i, i + concurrency);

        const batchResults = await Promise.allSettled(
            batch.map(async (scene) => {
                const url = await generateNanoBananaImage(
                    scene.prompt,
                    scene.width,
                    scene.height,
                    scene.styleUUID,
                    cancelSignal
                );
                return { index: scene.index, imageUrl: url };
            })
        );

        for (let j = 0; j < batchResults.length; j++) {
            const r     = batchResults[j];
            const scene = batch[j];
            if (r.status === "fulfilled") {
                results.push({ index: r.value.index, imageUrl: r.value.imageUrl, success: true });
            } else {
                results.push({
                    index:    scene.index,
                    imageUrl: "",
                    success:  false,
                    error:    r.reason?.message || "Generation failed",
                });
            }
        }
    }

    console.log(`✅ [vercel-image] ${results.filter(r => r.success).length}/${scenes.length} images ready`);
    return results;
}

// ─── Submit-only + Single-check helpers (Inngest step compatibility) ──────────
//
// Vercel AI Gateway is synchronous — there is no async task ID to poll.
// We simulate the submit/check pattern by:
//   submitNanoBananaJobsParallel  → runs the full generation, encodes the URL as a fake taskId
//   checkNanoBananaJobsStatus     → always returns COMPLETE (the URL is in the taskId)
//   submitNanoBananaImageTask     → runs generation, returns encoded URL as taskId
//   checkPolloTaskStatus          → decodes the URL from taskId, returns complete
//
// This keeps all Inngest step code unchanged.

const URL_PREFIX = "vercel_done_url::";

/**
 * Submit parallel image generation tasks.
 * Since Vercel is synchronous, this runs the full generation and encodes
 * the result URL into the "generationId" field.
 */
export async function submitNanoBananaJobsParallel(
    scenes:      NanoBananaSceneConfig[],
    cancelSignal?: { cancelled: boolean },
    concurrency: number = 4
): Promise<NanoBananaSubmissionResult[]> {
    console.log(`🚀 [vercel-image] Submitting (generating) ${scenes.length} image tasks...`);
    const results: NanoBananaSubmissionResult[] = [];

    for (let i = 0; i < scenes.length; i += concurrency) {
        if (cancelSignal?.cancelled) break;
        const batch = scenes.slice(i, i + concurrency);

        const batchResults = await Promise.allSettled(
            batch.map(async (scene) => {
                if (cancelSignal?.cancelled) throw new Error("cancelled");
                const url = await generateNanoBananaImage(
                    scene.prompt, scene.width, scene.height, scene.styleUUID, cancelSignal
                );
                return { index: scene.index, url };
            })
        );

        for (let j = 0; j < batchResults.length; j++) {
            const r     = batchResults[j];
            const scene = batch[j];
            if (r.status === "fulfilled") {
                results.push({
                    index:        r.value.index,
                    success:      true,
                    generationId: `${URL_PREFIX}${r.value.url}`,
                    apiKey:       "vercel",
                    model:        "imagen-4-standard",
                });
            } else {
                results.push({
                    index:   scene.index,
                    success: false,
                    error:   r.reason?.message || "Generation failed",
                });
            }
        }
    }
    return results;
}

/**
 * Check status of submitted tasks — always returns COMPLETE since generation
 * already ran during submit. Decodes the URL from the generationId.
 */
export async function checkNanoBananaJobsStatus(
    jobs: Array<{ index: number; generationId: string; apiKey: string; model: string }>
): Promise<NanoBananaStatusResult[]> {
    return jobs.map((job) => {
        if (job.generationId?.startsWith(URL_PREFIX)) {
            const imageUrl = job.generationId.slice(URL_PREFIX.length);
            return { index: job.index, status: "COMPLETE" as const, imageUrl };
        }
        // Unknown format — treat as failed
        return { index: job.index, status: "FAILED" as const, error: "Unknown generationId format" };
    });
}

/**
 * Submit a single image task without polling (Inngest thumbnail step).
 * Encodes the result URL into the taskId for later retrieval.
 */
export async function submitNanoBananaImageTask(
    prompt: string,
    width:  number = 1024,
    height: number = 1024,
    cancelSignal?: { cancelled: boolean }
): Promise<{ taskId: string; apiKey: string }> {
    console.log(`🎨 [vercel-image] Submitting thumbnail task...`);
    if (cancelSignal?.cancelled) throw new Error("Job cancelled by force stop.");
    const url = await generateNanoBananaImage(prompt, width, height, undefined, cancelSignal);
    return { taskId: `${URL_PREFIX}${url}`, apiKey: "vercel" };
}

/**
 * Check status of a single Vercel image task.
 * Since generation ran synchronously in submit, this always returns complete.
 */
export async function checkPolloTaskStatus(
    taskId: string,
    _apiKey: string
): Promise<{ status: "complete" | "failed" | "pending"; url?: string }> {
    if (taskId?.startsWith(URL_PREFIX)) {
        const url = taskId.slice(URL_PREFIX.length);
        return { status: "complete", url };
    }
    return { status: "failed" };
}

/**
 * No-op upload stub — Vercel returns a direct URL, no pre-upload needed.
 */
export async function uploadImageToLeonardo(imageUrl: string, _apiKey: string): Promise<string> {
    console.log(`☁️ [vercel-image] Skipping pre-upload (Vercel returns direct URLs)`);
    return imageUrl;
}
