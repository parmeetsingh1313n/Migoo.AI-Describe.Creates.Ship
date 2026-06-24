/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * Flatkey AI — Image Generation Client
 *
 * PRIMARY  : openai/gpt-image-2  via /v1/images/generations  (b64_json)
 * FALLBACK : gemini-3-pro-image-preview via /v1beta/models/:model:generateContent
 *
 * Key rotation: FLATKEY_API_KEY, FLATKEY_API_KEY_2 … FLATKEY_API_KEY_10
 *
 * Drop-in replacement for lib/vercel-image.ts.
 * All exported function names and signatures are identical so callers only
 * need to change their import path from "@/lib/vercel-image" → "@/lib/flatkey-image".
 *
 * Image delivery: returns a base64 data URL (data:image/png;base64,...).
 * This works everywhere the app uses imageUrl since Next.js and Appwrite
 * accept data URLs. For WaveSpeed I2V (needs HTTP URL), use uploadImageToAppwrite().
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { Client, Storage, ID } from "node-appwrite";
import { InputFile } from "node-appwrite/file";

const FLATKEY_BASE = "https://console.flatkey.ai";

// ─── Models ───────────────────────────────────────────────────────────────────

const GPT_IMAGE_2_MODEL  = "openai/gpt-image-2";
const GEMINI_FALLBACK    = "gemini-3-pro-image-preview"; // Flatkey model name

// ─── Key rotation ─────────────────────────────────────────────────────────────

function getFlatkeys(): string[] {
    const keys: string[] = [];
    const base = process.env.FLATKEY_API_KEY;
    if (base) keys.push(base);
    for (let i = 2; i <= 10; i++) {
        const k = process.env[`FLATKEY_API_KEY_${i}`];
        if (k) keys.push(k);
    }
    if (keys.length === 0) throw new Error("[flatkey-image] No FLATKEY_API_KEY configured");
    return keys;
}

function isQuotaError(status: number, body: string): boolean {
    if ([401, 402, 429, 503].includes(status)) return true;
    const b = body.toLowerCase();
    return b.includes("quota") || b.includes("insufficient") || b.includes("limit") ||
           b.includes("model_not_found") || b.includes("no available channel") ||
           b.includes("unauthorized") || b.includes("credit");
}

// ─── Aspect ratio helpers ─────────────────────────────────────────────────────

function getAspectRatio(width: number, height: number): "1:1" | "9:16" | "16:9" {
    const ratio = width / height;
    if (Math.abs(ratio - 1) < 0.1) return "1:1";
    if (ratio < 0.8)               return "9:16";
    return "16:9";
}

/** Map aspect ratio to gpt-image-2 size strings */
function getSizeForAspectRatio(aspectRatio: "1:1" | "9:16" | "16:9"): string {
    switch (aspectRatio) {
        case "9:16":  return "1024x1536";
        case "16:9":  return "1536x1024";
        default:      return "1024x1024";
    }
}

// ─── Appwrite upload (for cases needing a public HTTP URL e.g. WaveSpeed) ─────

export async function uploadBase64ToAppwrite(base64Data: string, mimeType: string = "image/png"): Promise<string> {
    const endpoint  = (process.env.APPWRITE_VIDEO_ENDPOINT  || process.env.APPWRITE_ENDPOINT  || "").replace(/\/$/, "");
    const projectId = process.env.APPWRITE_VIDEO_PROJECT_ID  || process.env.APPWRITE_PROJECT_ID  || "";
    const apiKey    = process.env.APPWRITE_VIDEO_API_KEY     || process.env.APPWRITE_API_KEY     || "";
    const bucketId  = process.env.APPWRITE_VIDEO_BUCKET_ID   || process.env.APPWRITE_BUCKET_ID   || "";

    if (!endpoint || !projectId || !apiKey || !bucketId) {
        // Return data URL as fallback if Appwrite not configured
        return `data:${mimeType};base64,${base64Data}`;
    }

    const buffer   = Buffer.from(base64Data, "base64");
    const ext      = mimeType.includes("png") ? "png" : mimeType.includes("webp") ? "webp" : "jpg";
    const fileId   = ID.unique();
    const filename = `flatkey-img-${fileId}.${ext}`;

    const client  = new Client().setEndpoint(endpoint).setProject(projectId).setKey(apiKey);
    const storage = new Storage(client);

    await storage.createFile({
        bucketId,
        fileId,
        file: InputFile.fromBuffer(buffer, filename),
    } as any);

    const publicUrl = `${endpoint}/storage/buckets/${bucketId}/files/${fileId}/view?project=${projectId}`;
    console.log(`☁️ [flatkey-image] Uploaded to Appwrite: ${publicUrl.slice(0, 80)}...`);
    return publicUrl;
}

// ─── PRIMARY: gpt-image-2 via /v1/images/generations ─────────────────────────

async function callGptImage2(
    prompt:      string,
    aspectRatio: "1:1" | "9:16" | "16:9",
    keys:        string[]
): Promise<string> {
    const size    = getSizeForAspectRatio(aspectRatio);
    let lastErr   = "";

    for (let ki = 0; ki < keys.length; ki++) {
        const apiKey   = keys[ki];
        const keyLabel = ki === 0 ? "primary" : `key_${ki + 1}`;

        try {
            console.log(`🎨 [flatkey-image] gpt-image-2 [${keyLabel}] | ${aspectRatio} | ${size}`);

            const res = await fetch(`${FLATKEY_BASE}/v1/images/generations`, {
                method:  "POST",
                headers: {
                    "Content-Type":  "application/json",
                    "Authorization": `Bearer ${apiKey}`,
                },
                body: JSON.stringify({
                    model:           GPT_IMAGE_2_MODEL,
                    prompt,
                    n:               1,
                    size,
                    response_format: "b64_json",
                }),
                signal: AbortSignal.timeout(120_000),
            });

            const rawText = await res.text();

            if (!res.ok) {
                if (isQuotaError(res.status, rawText) && ki < keys.length - 1) {
                    console.warn(`⚠️ [flatkey-image] [${keyLabel}] quota/error (${res.status}) — rotating...`);
                    lastErr = rawText;
                    continue;
                }
                throw new Error(`[flatkey-image] gpt-image-2 error (${res.status}): ${rawText.slice(0, 200)}`);
            }

            const data = JSON.parse(rawText);
            const b64  = data?.data?.[0]?.b64_json;
            if (!b64) throw new Error(`[flatkey-image] No b64_json in gpt-image-2 response`);

            if (ki > 0) console.log(`✅ [flatkey-image] gpt-image-2 succeeded with [${keyLabel}]`);
            return b64; // return raw base64

        } catch (e: any) {
            const isQuota = isQuotaError(0, e.message);
            if (isQuota && ki < keys.length - 1) {
                console.warn(`⚠️ [flatkey-image] [${keyLabel}] exception (rotating): ${e.message.slice(0, 80)}`);
                lastErr = e.message;
                continue;
            }
            throw e;
        }
    }

    throw new Error(`[flatkey-image] All ${keys.length} gpt-image-2 key(s) exhausted. Last: ${lastErr.slice(0, 150)}`);
}

// ─── FALLBACK: gemini-3-pro-image-preview via Gemini format ──────────────────

async function callGeminiImage(
    prompt:      string,
    _aspectRatio: "1:1" | "9:16" | "16:9",
    keys:         string[]
): Promise<string> {
    let lastErr = "";

    for (let ki = 0; ki < keys.length; ki++) {
        const apiKey   = keys[ki];
        const keyLabel = ki === 0 ? "primary" : `key_${ki + 1}`;

        try {
            console.log(`🎨 [flatkey-image] gemini-3-pro-image [${keyLabel}] fallback`);

            const endpoint = `${FLATKEY_BASE}/v1beta/models/${GEMINI_FALLBACK}:generateContent`;
            const res = await fetch(endpoint, {
                method:  "POST",
                headers: {
                    "Content-Type":  "application/json",
                    "Authorization": `Bearer ${apiKey}`,
                },
                body: JSON.stringify({
                    contents: [{ role: "user", parts: [{ text: prompt }] }],
                }),
                signal: AbortSignal.timeout(120_000),
            });

            const rawText = await res.text();

            if (!res.ok) {
                if (isQuotaError(res.status, rawText) && ki < keys.length - 1) {
                    console.warn(`⚠️ [flatkey-image] gemini [${keyLabel}] quota (${res.status}) — rotating...`);
                    lastErr = rawText;
                    continue;
                }
                throw new Error(`[flatkey-image] gemini error (${res.status}): ${rawText.slice(0, 200)}`);
            }

            const data   = JSON.parse(rawText);
            const part   = data?.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData);
            const b64    = part?.inlineData?.data;
            if (!b64) throw new Error(`[flatkey-image] No inlineData in Gemini response`);

            if (ki > 0) console.log(`✅ [flatkey-image] gemini succeeded with [${keyLabel}]`);
            return b64;

        } catch (e: any) {
            const isQuota = isQuotaError(0, e.message);
            if (isQuota && ki < keys.length - 1) {
                console.warn(`⚠️ [flatkey-image] gemini [${keyLabel}] exception (rotating): ${e.message.slice(0, 80)}`);
                lastErr = e.message;
                continue;
            }
            throw e;
        }
    }

    throw new Error(`[flatkey-image] All ${keys.length} Gemini fallback key(s) exhausted. Last: ${lastErr.slice(0, 150)}`);
}

// ─── Core: primary → fallback, returns Appwrite URL or data URL ───────────────

async function generateImage(
    prompt:      string,
    aspectRatio: "1:1" | "9:16" | "16:9",
    cancelSignal?: { cancelled: boolean }
): Promise<string> {
    if (cancelSignal?.cancelled) throw new Error("Job cancelled by force stop.");

    const keys = getFlatkeys();
    let b64:  string | undefined;
    let mime  = "image/png";

    // ── Try gpt-image-2 first ──────────────────────────────────────────────────
    try {
        b64  = await callGptImage2(prompt, aspectRatio, keys);
        mime = "image/png";
        console.log(`✅ [flatkey-image] gpt-image-2 done`);
    } catch (primaryErr: any) {
        console.warn(`⚠️ [flatkey-image] gpt-image-2 failed, trying Gemini fallback: ${primaryErr.message.slice(0, 120)}`);

        // ── Fallback: Gemini 3 Pro Image ──────────────────────────────────────
        try {
            b64  = await callGeminiImage(prompt, aspectRatio, keys);
            mime = "image/jpeg";
            console.log(`✅ [flatkey-image] Gemini fallback done`);
        } catch (fallbackErr: any) {
            throw new Error(
                `[flatkey-image] Both providers failed.\n` +
                `  Primary (gpt-image-2): ${primaryErr.message.slice(0, 100)}\n` +
                `  Fallback (gemini):     ${fallbackErr.message.slice(0, 100)}`
            );
        }
    }

    // Upload to Appwrite for a public HTTP URL (needed by WaveSpeed I2V etc.)
    try {
        const publicUrl = await uploadBase64ToAppwrite(b64!, mime);
        return publicUrl;
    } catch (uploadErr: any) {
        console.warn(`⚠️ [flatkey-image] Appwrite upload failed, returning data URL: ${uploadErr.message}`);
        return `data:${mime};base64,${b64}`;
    }
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

// ─── Shared interfaces (identical to vercel-image.ts) ─────────────────────────

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

// ─── Public API (identical signatures to vercel-image.ts) ─────────────────────

/**
 * Generate a single image — primary function used by most callers.
 * styleUUID is accepted for compatibility but ignored (prompt-based styling).
 */
export async function generateNanoBananaImage(
    prompt:  string,
    width:   number = 768,
    height:  number = 1376,
    _styleUUID?: string,
    cancelSignal?: { cancelled: boolean }
): Promise<string> {
    const aspectRatio = getAspectRatio(width, height);
    console.log(`🎨 [flatkey-image] generateNanoBananaImage | ${aspectRatio} | "${prompt.slice(0, 80)}..."`);
    const url = await generateImage(prompt, aspectRatio, cancelSignal);
    console.log(`✅ [flatkey-image] Image ready: ${url.slice(0, 80)}...`);
    return url;
}

/**
 * img2img shim — Flatkey gpt-image-2 is text-only, imageUrl is ignored.
 */
export async function generateNanoBanana2Image(
    prompt:  string,
    _imageUrl?: string,
    width:   number = 768,
    height:  number = 1344,
    cancelSignal?: { cancelled: boolean }
): Promise<string> {
    console.log(`🎨 [flatkey-image] Nano Banana 2 (img2img → txt2img fallback)...`);
    return generateNanoBananaImage(prompt, width, height, undefined, cancelSignal);
}

/**
 * Convenience wrapper — square format.
 */
export async function generateGptImage15SingleUrl(
    prompt:  string,
    width:   number = 1024,
    height:  number = 1024
): Promise<string> {
    return generateNanoBananaImage(prompt, width, height);
}

/**
 * Multi-image compatibility shim (used in notes pipeline).
 */
export async function generateGptImage15(
    prompt:       string,
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
    concurrency: number = 3   // slightly lower concurrency — each key handles more load
): Promise<NanoBananaResult[]> {
    console.log(`🚀 [flatkey-image] Generating ${scenes.length} images (concurrency=${concurrency})...`);
    const results: NanoBananaResult[] = [];

    for (let i = 0; i < scenes.length; i += concurrency) {
        if (cancelSignal?.cancelled) break;
        const batch = scenes.slice(i, i + concurrency);

        const batchResults = await Promise.allSettled(
            batch.map(async (scene) => {
                const url = await generateNanoBananaImage(
                    scene.prompt, scene.width, scene.height, scene.styleUUID, cancelSignal
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

    console.log(`✅ [flatkey-image] ${results.filter(r => r.success).length}/${scenes.length} images ready`);
    return results;
}

// ─── Submit/Check helpers (Inngest step compatibility) ────────────────────────
// Flatkey gpt-image-2 is synchronous — we simulate the submit/poll pattern
// by encoding the result URL as the "taskId".

const URL_PREFIX = "flatkey_done_url::";

export async function submitNanoBananaJobsParallel(
    scenes:      NanoBananaSceneConfig[],
    cancelSignal?: { cancelled: boolean },
    concurrency: number = 3
): Promise<NanoBananaSubmissionResult[]> {
    console.log(`🚀 [flatkey-image] Submitting ${scenes.length} image tasks...`);
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
                    apiKey:       "flatkey",
                    model:        "gpt-image-2",
                });
            } else {
                results.push({ index: scene.index, success: false, error: r.reason?.message || "Failed" });
            }
        }
    }
    return results;
}

export async function checkNanoBananaJobsStatus(
    jobs: Array<{ index: number; generationId: string; apiKey: string; model: string }>
): Promise<NanoBananaStatusResult[]> {
    return jobs.map((job) => {
        if (job.generationId?.startsWith(URL_PREFIX)) {
            const imageUrl = job.generationId.slice(URL_PREFIX.length);
            return { index: job.index, status: "COMPLETE" as const, imageUrl };
        }
        return { index: job.index, status: "FAILED" as const, error: "Unknown generationId" };
    });
}

export async function submitNanoBananaImageTask(
    prompt:  string,
    width:   number = 1024,
    height:  number = 1024,
    cancelSignal?: { cancelled: boolean }
): Promise<{ taskId: string; apiKey: string }> {
    console.log(`🎨 [flatkey-image] Submitting thumbnail task...`);
    if (cancelSignal?.cancelled) throw new Error("Job cancelled by force stop.");
    const url = await generateNanoBananaImage(prompt, width, height, undefined, cancelSignal);
    return { taskId: `${URL_PREFIX}${url}`, apiKey: "flatkey" };
}

export async function checkPolloTaskStatus(
    taskId:  string,
    _apiKey: string
): Promise<{ status: "complete" | "failed" | "pending"; url?: string }> {
    if (taskId?.startsWith(URL_PREFIX)) {
        const url = taskId.slice(URL_PREFIX.length);
        return { status: "complete", url };
    }
    return { status: "failed" };
}

/**
 * No-op upload stub — kept for caller compatibility.
 */
export async function uploadImageToLeonardo(imageUrl: string, _apiKey: string): Promise<string> {
    console.log(`☁️ [flatkey-image] Skipping pre-upload (already a public URL)`);
    return imageUrl;
}
