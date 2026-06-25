/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * Flatkey AI — Image Generation Client
 *
 * PRIMARY  : gemini-3.1-flash-image-preview  via /v1/chat/completions (base64)
 * FALLBACK : gemini-3-pro-image-preview      via /v1/chat/completions (base64)
 * Key rotation: FLATKEY_API_KEY, FLATKEY_API_KEY_2 … FLATKEY_API_KEY_10
 *
 * 524 = Cloudflare timeout between caller→Flatkey — treated as rotatable,
 *       next key is tried immediately.
 * Per-key timeout: 45s (Gemini is fast, timeout rotated quickly).
 *
 * Drop-in replacement for lib/vercel-image.ts.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { Client, Storage, ID } from "node-appwrite";
import { InputFile } from "node-appwrite/file";

const FLATKEY_BASE = "https://console.flatkey.ai";

// ─── Models ───────────────────────────────────────────────────────────────────

const GEMINI_31_FLASH_MODEL = "gemini-3.1-flash-image-preview";
const GEMINI_3_PRO_MODEL    = "gemini-3-pro-image-preview";

// ─── Key rotation ─────────────────────────────────────────────────────────────

/** Global round-robin counter — incremented per request so parallel calls spread across keys */
let _keyRoundRobin = 0;

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

/**
 * Rotate the keys array so this request starts at a different key.
 * Each parallel request gets its own offset, spreading load across all keys.
 */
function rotateKeys(keys: string[], startIndex: number): string[] {
    const offset = startIndex % keys.length;
    return [...keys.slice(offset), ...keys.slice(0, offset)];
}

function isQuotaError(status: number, body: string): boolean {
    // 524 = Cloudflare timeout (origin didn't respond in time) — rotate to next key
    if ([401, 402, 429, 503, 524].includes(status)) return true;
    const b = body.toLowerCase();
    return b.includes("quota") || b.includes("insufficient") || b.includes("limit") ||
           b.includes("model_not_found") || b.includes("no available channel") ||
           b.includes("unauthorized") || b.includes("credit") ||
           b.includes("timeout occurred") || b.includes("a timeout");
}

/**
 * Cross-runtime fetch with timeout — works on ALL Node.js versions (including
 * older Vercel serverless runtimes that don't support AbortSignal.timeout).
 */
async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
            controller.abort();
            reject(new Error(`[flatkey-image] Request timed out after ${timeoutMs / 1000}s`));
        }, timeoutMs);
    });
    try {
        const res = await Promise.race([
            fetch(url, { ...options, signal: controller.signal }),
            timeoutPromise,
        ]);
        return res;
    } finally {
        if (timer !== undefined) clearTimeout(timer);
    }
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

// ─── PRIMARY: Gemini Image via Chat Completions ──────────────────────────────

async function callGeminiChatImage(
    prompt:      string,
    aspectRatio: "1:1" | "9:16" | "16:9",
    modelName:   string,
    keys:        string[],
): Promise<{ b64: string, mime: string }> {
    let lastErr = "";
    
    // Add orientation hints to the prompt
    const orientationHint =
        aspectRatio === "9:16"
            ? " (aspect ratio 9:16, vertical portrait orientation, tall)"
            : aspectRatio === "16:9"
            ? " (aspect ratio 16:9, horizontal landscape orientation, wide)"
            : " (aspect ratio 1:1, square)";
            
    const fullPrompt = prompt + orientationHint;

    for (let ki = 0; ki < keys.length; ki++) {
        const apiKey   = keys[ki];
        const keyLabel = ki === 0 ? "primary" : `key_${ki + 1}`;

        try {
            console.log(`🎨 [flatkey-image] ${modelName} [${keyLabel}] | ${aspectRatio}`);

            const res = await fetchWithTimeout(
                `${FLATKEY_BASE}/v1/chat/completions`,
                {
                    method:  "POST",
                    headers: {
                        "Content-Type":  "application/json",
                        "Authorization": `Bearer ${apiKey}`,
                    },
                    body: JSON.stringify({
                        model: modelName,
                        messages: [
                            {
                                role: "user",
                                content: fullPrompt
                            }
                        ]
                    }),
                },
                45_000  // Gemini is fast, 45s is plenty
            );

            const rawText = await res.text();

            if (!res.ok) {
                const isRotatable = isQuotaError(res.status, rawText);
                if (isRotatable && ki < keys.length - 1) {
                    console.warn(`⚠️ [flatkey-image] [${keyLabel}] quota/error (${res.status}) — rotating to key_${ki + 2}...`);
                    lastErr = rawText;
                    continue;
                }
                throw new Error(`[flatkey-image] ${modelName} error (${res.status}): ${rawText.slice(0, 200)}`);
            }

            const data = JSON.parse(rawText);
            const content = data?.choices?.[0]?.message?.content || "";
            
            // Regex to match mime type and base64
            const match = content.match(/data:(image\/[a-zA-Z]+);base64,([a-zA-Z0-9+/=\s\r\n]+)/);
            if (!match) {
                const errMsg = data?.error?.message || data?.message || JSON.stringify(data);
                throw new Error(`[flatkey-image] No base64 image data found in response content. Detail: ${content.slice(0, 150)}`);
            }

            const mime = match[1];
            const b64  = match[2].replace(/\s/g, "");

            if (ki > 0) console.log(`✅ [flatkey-image] ${modelName} succeeded with [${keyLabel}]`);
            return { b64, mime };

        } catch (e: any) {
            const isRotatable = isQuotaError(0, e.message) || e.message?.includes("timed out");
            if (isRotatable && ki < keys.length - 1) {
                console.warn(`⚠️ [flatkey-image] [${keyLabel}] exception (rotating to key_${ki + 2}): ${e.message.slice(0, 80)}`);
                lastErr = e.message;
                continue;
            }
            throw e;
        }
    }

    throw new Error(`[flatkey-image] All ${keys.length} ${modelName} key(s) exhausted. Last: ${lastErr.slice(0, 150)}`);
}

// ─── Core: Primary & Fallback Gemini Images, returns Appwrite URL or data URL ─

async function generateImage(
    prompt:       string,
    aspectRatio:  "1:1" | "9:16" | "16:9",
    cancelSignal?: { cancelled: boolean },
    keyOffset:    number = 0
): Promise<string> {
    if (cancelSignal?.cancelled) throw new Error("Job cancelled by force stop.");

    // Round-robin: rotate key array so this request starts on a different key
    const allKeys = getFlatkeys();
    const keys    = rotateKeys(allKeys, keyOffset);
    const startKeyLabel = keyOffset % allKeys.length === 0 ? "primary" : `key_${(keyOffset % allKeys.length) + 1}`;
    console.log(`🔑 [flatkey-image] Using key slot [${startKeyLabel}] (offset ${keyOffset % allKeys.length} of ${allKeys.length})`);

    let b64 = "";
    let mime = "image/jpeg";

    try {
        const result = await callGeminiChatImage(prompt, aspectRatio, GEMINI_31_FLASH_MODEL, keys);
        b64 = result.b64;
        mime = result.mime;
        console.log(`✅ [flatkey-image] ${GEMINI_31_FLASH_MODEL} done`);
    } catch (primaryErr: any) {
        console.warn(`⚠️ [flatkey-image] ${GEMINI_31_FLASH_MODEL} failed, trying fallback ${GEMINI_3_PRO_MODEL}: ${primaryErr.message.slice(0, 120)}`);

        try {
            const result = await callGeminiChatImage(prompt, aspectRatio, GEMINI_3_PRO_MODEL, keys);
            b64 = result.b64;
            mime = result.mime;
            console.log(`✅ [flatkey-image] ${GEMINI_3_PRO_MODEL} fallback done`);
        } catch (fallbackErr: any) {
            throw new Error(
                `[flatkey-image] Both Gemini image models failed.\n` +
                `  Primary (${GEMINI_31_FLASH_MODEL}): ${primaryErr.message.slice(0, 100)}\n` +
                `  Fallback (${GEMINI_3_PRO_MODEL}): ${fallbackErr.message.slice(0, 100)}`
            );
        }
    }

    // Upload to Appwrite for a public HTTP URL (needed by WaveSpeed I2V etc.)
    try {
        const publicUrl = await uploadBase64ToAppwrite(b64, mime);
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
    prompt:     string,
    width:      number = 768,
    height:     number = 1344, // 9:16 portrait — consistent with scene configs in functions.ts
    _styleUUID?: string,
    cancelSignal?: { cancelled: boolean },
    keyOffset?: number  // internal: round-robin slot for parallel calls
): Promise<string> {
    const aspectRatio  = getAspectRatio(width, height);
    // Assign round-robin slot if not explicitly provided
    const slot = keyOffset !== undefined ? keyOffset : _keyRoundRobin++;
    console.log(`🎨 [flatkey-image] generateNanoBananaImage | ${aspectRatio} | "${prompt.slice(0, 80)}..."`);
    const url = await generateImage(prompt, aspectRatio, cancelSignal, slot);
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
    concurrency: number = 3
): Promise<NanoBananaResult[]> {
    console.log(`🚀 [flatkey-image] Generating ${scenes.length} images (concurrency=${concurrency})...`);
    const results: NanoBananaResult[] = [];
    // Base round-robin slot for this batch — each item in a batch gets a different slot
    const batchBaseSlot = _keyRoundRobin;
    _keyRoundRobin += scenes.length;

    for (let i = 0; i < scenes.length; i += concurrency) {
        if (cancelSignal?.cancelled) break;
        const batch = scenes.slice(i, i + concurrency);

        const batchResults = await Promise.allSettled(
            batch.map(async (scene, batchIdx) => {
                // Stagger start: each parallel request is offset by 150ms so they don't
                // all hit the API at exactly the same millisecond
                if (batchIdx > 0) await new Promise(r => setTimeout(r, batchIdx * 150));

                // Each request in the batch starts on a different key slot
                const slot = batchBaseSlot + i + batchIdx;
                const url = await generateNanoBananaImage(
                    scene.prompt, scene.width, scene.height, scene.styleUUID, cancelSignal, slot
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
    const batchBaseSlot = _keyRoundRobin;
    _keyRoundRobin += scenes.length;

    for (let i = 0; i < scenes.length; i += concurrency) {
        if (cancelSignal?.cancelled) break;
        const batch = scenes.slice(i, i + concurrency);

        const batchResults = await Promise.allSettled(
            batch.map(async (scene, batchIdx) => {
                if (cancelSignal?.cancelled) throw new Error("cancelled");
                // Stagger + round-robin: request N starts 150ms later and on key N
                if (batchIdx > 0) await new Promise(r => setTimeout(r, batchIdx * 150));
                const slot = batchBaseSlot + i + batchIdx;
                const url = await generateNanoBananaImage(
                    scene.prompt, scene.width, scene.height, scene.styleUUID, cancelSignal, slot
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
                    model:        "gemini-3.1-flash-image-preview",
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
