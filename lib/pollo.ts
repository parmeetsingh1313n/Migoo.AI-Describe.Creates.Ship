/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * Pollo AI Client — GPT Image 2.0 Mapping
 * Key rotation: POLLO_API_KEY, POLLO_API_KEY_2, POLLO_API_KEY_3, ...
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const BASE_URL = "https://pollo.ai/api/platform";

// ─── Key helpers ─────────────────────────────────────────────────────────────

/** Read all available Pollo API keys from env at call time (no singleton cache). */
function getPolloKeys(): string[] {
    const keys: string[] = [];
    if (process.env.POLLO_API_KEY) keys.push(process.env.POLLO_API_KEY);
    for (let i = 2; i <= 10; i++) {
        const k = process.env[`POLLO_API_KEY_${i}`];
        if (k) keys.push(k);
    }
    // Hardcoded fallback so the app never crashes with zero keys
    if (keys.length === 0) keys.push("pollo_61Jnpf5RrGVwfMmrmznmApL0hsX0gWgsEhBrE66KPSwA");
    return keys;
}

/** True when the error is a quota/auth error that warrants key rotation. */
function isPolloQuotaError(status: number, body: string): boolean {
    if ([401, 402, 429].includes(status)) return true;
    const b = body.toLowerCase();
    return b.includes("insufficient") || b.includes("credit") ||
        b.includes("quota") || b.includes("limit") ||
        b.includes("unauthorized") || b.includes("invalid key");
}

function makeHeaders(apiKey: string): Record<string, string> {
    return {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
    };
}

// Re-export style maps so client files do not break
export const LEONARDO_STYLES: Record<string, string> = {
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
    "Watercolor": "1db308ce-c7ad-4d10-96fd-592fa6b75cc4",
};

export const NANO_BANANA_STYLES: Record<string, string> = {
    ...LEONARDO_STYLES,
    "Graphic Design 2D":    "703d6fe5-7f1c-4a9e-8da0-5331f214d5cf",
    "Portrait Fashion":     "0d34f8e1-46d4-428f-8ddd-4b11811fa7c9",
    "Pro B&W Photography":  "22a9a7d2-2166-4d86-80ff-22e2643adbcf",
    "Pro Color Photography":"7c3f932b-a572-47cb-9b9b-f20211e63b5b",
    "Pro Film Photography": "581ba6d6-5aac-4492-bebe-54c424a0d46e",
};

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

// ─── Status endpoint discovery ───────────────────────────────────────────────

// Global cached index for status endpoint discovery (per API key)
let cachedStatusPatternIndex = 0;

async function getStatusUrl(taskId: string, apiKey: string): Promise<string> {
    const headers = makeHeaders(apiKey);
    const urls = [
        `${BASE_URL}/generation/${taskId}/status`,
        `${BASE_URL}/generation/${taskId}`,
        `${BASE_URL}/generations/${taskId}`,
        `${BASE_URL}/task/${taskId}`,
        `${BASE_URL}/generation/task/${taskId}`,
    ];
    // Check cached index first
    const cachedUrl = urls[cachedStatusPatternIndex];
    try {
        const r = await fetch(cachedUrl, { headers });
        if (r.status === 200 || r.status === 404) return cachedUrl;
    } catch {}

    // Find working one
    for (let i = 0; i < urls.length; i++) {
        if (i === cachedStatusPatternIndex) continue;
        try {
            const r = await fetch(urls[i], { headers });
            if (r.status === 200) {
                cachedStatusPatternIndex = i;
                return urls[i];
            }
        } catch {}
    }
    return urls[0];
}

/**
 * Maps width and height to aspect ratio string
 */
function getAspectRatio(width: number, height: number): string {
    const ratio = width / height;
    if (Math.abs(ratio - 1) < 0.1) return "1:1";
    if (ratio < 0.8) return "9:16";
    return "16:9";
}

// ─── Core submit + poll (with key rotation) ──────────────────────────────────

/**
 * Submit an image generation task to Pollo GPT Image 2.0 with key rotation.
 * Returns { taskId, apiKey } — the apiKey that succeeded is passed to polling.
 */
async function submitPolloImageTask(
    body: Record<string, any>,
    endpoint: string
): Promise<{ taskId: string; apiKey: string }> {
    const keys = getPolloKeys();
    let lastErr = "";

    for (let ki = 0; ki < keys.length; ki++) {
        const apiKey = keys[ki];
        const keyLabel = ki === 0 ? "primary" : `key_${ki + 1}`;
        try {
            const res = await fetch(`${BASE_URL}${endpoint}`, {
                method: "POST",
                headers: makeHeaders(apiKey),
                body: JSON.stringify(body),
            });

            if (!res.ok) {
                const errText = await res.text();
                if (isPolloQuotaError(res.status, errText) && ki < keys.length - 1) {
                    console.warn(`⚠️ [pollo] [${keyLabel}] quota/auth error (${res.status}) — rotating key...`);
                    lastErr = errText;
                    continue;
                }
                throw new Error(`Pollo submit failed (${res.status}): ${errText}`);
            }

            const data = await res.json();
            const taskId = data?.data?.taskId || data?.taskId;
            if (!taskId) throw new Error(`Pollo response missing taskId: ${JSON.stringify(data)}`);

            if (ki > 0) console.log(`✅ [pollo] Succeeded with [${keyLabel}] after key rotation.`);
            return { taskId, apiKey };
        } catch (e: any) {
            const isQuota = /401|402|429|quota|credit|limit|unauthorized/i.test(e.message);
            if (isQuota && ki < keys.length - 1) {
                console.warn(`⚠️ [pollo] [${keyLabel}] error (rotating): ${e.message.slice(0, 80)}`);
                lastErr = e.message;
                continue;
            }
            throw e;
        }
    }
    throw new Error(`Pollo: all ${keys.length} key(s) exhausted. Last error: ${lastErr}`);
}

/**
 * Poll a Pollo task until it completes. Returns the output URL.
 */
async function pollPolloTask(
    taskId: string,
    apiKey: string,
    maxWaitMs = 10 * 60 * 1000,
    interval = 5000,
    cancelSignal?: { cancelled: boolean }
): Promise<string> {
    const workingUrl = await getStatusUrl(taskId, apiKey);
    const headers = makeHeaders(apiKey);
    const start = Date.now();

    while (Date.now() - start < maxWaitMs) {
        if (cancelSignal?.cancelled) throw new Error("Job cancelled by force stop.");
        await new Promise((r) => setTimeout(r, interval));
        if (cancelSignal?.cancelled) throw new Error("Job cancelled by force stop.");

        try {
            const checkRes = await fetch(workingUrl, { headers });
            if (!checkRes.ok) continue;

            const checkData = await checkRes.json();
            const gen = checkData?.data?.generations?.[0];
            const status = gen?.status || checkData?.data?.status || checkData?.status || "unknown";

            if (status === "succeed" || status === "success" || status === "completed") {
                const outputUrl =
                    gen?.url ||
                    checkData?.data?.output ||
                    checkData?.output ||
                    checkData?.data?.url ||
                    checkData?.url;
                if (outputUrl) return outputUrl;
            }

            if (status === "failed" || status === "error") {
                throw new Error(
                    gen?.failMsg || checkData?.data?.error || checkData?.error || "Task failed on server"
                );
            }
        } catch (e: any) {
            if (e.message?.includes("cancelled")) throw e;
            console.warn(`⚠️ [pollo] Polling error: ${e.message}`);
        }
    }
    throw new Error(`Pollo timed out waiting for task ${taskId}`);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Generate an image using Pollo GPT Image 2.0 (with key rotation).
 */
export async function generateNanoBananaImage(
    prompt: string,
    width: number = 768,
    height: number = 1376,
    styleUUID?: string,
    cancelSignal?: { cancelled: boolean }
): Promise<string> {
    console.log(`🎨 [pollo] Generating image via GPT Image 2.0...`);
    const body = {
        input: {
            prompt,
            resolution: "1K",
            quality: "medium",
            aspectRatio: getAspectRatio(width, height),
        },
    };

    if (cancelSignal?.cancelled) throw new Error("Job cancelled by force stop.");
    const { taskId, apiKey } = await submitPolloImageTask(body, "/generation/openai/gpt-image-2-0/image");
    console.log(`✅ [pollo] Created task: ${taskId}. Polling...`);
    return pollPolloTask(taskId, apiKey, 10 * 60 * 1000, 5000, cancelSignal);
}

/**
 * Generate an image using Pollo Nano Banana 2 (with key rotation).
 *
 * The API requires:
 *  - Text-to-Image:        { prompt, aspectRatio, resolution }
 *  - Image-to-Image:       { prompt, aspectRatio, resolution, imageUrl, images: [imageUrl] }
 *
 * @param prompt      - Image generation prompt
 * @param imageUrl    - Optional source image URL for img2img mode
 * @param width       - Width hint used to derive aspectRatio (default 768 = 9:16)
 * @param height      - Height hint used to derive aspectRatio (default 1344 = 9:16)
 * @param cancelSignal - Optional cancellation token
 */
export async function generateNanoBanana2Image(
    prompt: string,
    imageUrl?: string,
    width: number = 768,
    height: number = 1344,
    cancelSignal?: { cancelled: boolean }
): Promise<string> {
    // Resolve aspectRatio from width/height — Nano Banana 2 requires this field
    const aspectRatio = getAspectRatio(width, height);
    const mode = imageUrl ? "img2img" : "txt2img";
    console.log(`🎨 [pollo] Nano Banana 2 ${mode} | aspectRatio=${aspectRatio}...`);

    const body: Record<string, any> = {
        input: {
            prompt,
            resolution: "1K",
            aspectRatio,   // ← REQUIRED by Nano Banana 2 API
        },
    };

    // Image-to-Image: both imageUrl and images[] are required
    if (imageUrl) {
        body.input.imageUrl = imageUrl;
        body.input.images = [imageUrl];
    }

    if (cancelSignal?.cancelled) throw new Error("Job cancelled by force stop.");
    const { taskId, apiKey } = await submitPolloImageTask(body, "/generation/google/nano-banana-2/image");
    console.log(`✅ [pollo] Nano Banana 2 task created: ${taskId}. Polling...`);
    return pollPolloTask(taskId, apiKey, 10 * 60 * 1000, 5000, cancelSignal);
}


/**
 * Generate multiple images in parallel using Pollo GPT Image 2.0.
 */
export async function generateNanoBananaImagesParallel(
    scenes: NanoBananaSceneConfig[],
    cancelSignal?: { cancelled: boolean },
    concurrency: number = 4
): Promise<NanoBananaResult[]> {
    console.log(`🚀 [pollo] Generating ${scenes.length} images in parallel...`);
    const results: NanoBananaResult[] = [];

    for (let i = 0; i < scenes.length; i += concurrency) {
        if (cancelSignal?.cancelled) break;
        const batch = scenes.slice(i, i + concurrency);

        const batchResults = await Promise.allSettled(
            batch.map(async (scene) => {
                const imageUrl = await generateNanoBananaImage(
                    scene.prompt,
                    scene.width,
                    scene.height,
                    scene.styleUUID,
                    cancelSignal
                );
                return { index: scene.index, imageUrl };
            })
        );

        for (let j = 0; j < batchResults.length; j++) {
            const r = batchResults[j];
            const scene = batch[j];
            if (r.status === "fulfilled") {
                results.push({ index: r.value.index, imageUrl: r.value.imageUrl, success: true });
            } else {
                results.push({
                    index: scene.index,
                    imageUrl: "",
                    success: false,
                    error: r.reason?.message || "Generation failed",
                });
            }
        }
    }
    return results;
}

/**
 * Submit parallel image generation tasks to Pollo GPT Image 2.0.
 */
export async function submitNanoBananaJobsParallel(
    scenes: NanoBananaSceneConfig[],
    cancelSignal?: { cancelled: boolean },
    concurrency: number = 4
): Promise<NanoBananaSubmissionResult[]> {
    console.log(`🚀 [pollo] Submitting ${scenes.length} image tasks in parallel...`);
    const results: NanoBananaSubmissionResult[] = [];

    for (let i = 0; i < scenes.length; i += concurrency) {
        if (cancelSignal?.cancelled) break;
        const batch = scenes.slice(i, i + concurrency);

        const batchResults = await Promise.allSettled(
            batch.map(async (scene) => {
                if (cancelSignal?.cancelled) throw new Error("cancelled");
                const body = {
                    input: {
                        prompt: scene.prompt,
                        resolution: "1K",
                        quality: "medium",
                        aspectRatio: getAspectRatio(scene.width || 768, scene.height || 1376),
                    },
                };
                const { taskId, apiKey } = await submitPolloImageTask(body, "/generation/openai/gpt-image-2-0/image");
                return { index: scene.index, generationId: taskId, apiKey };
            })
        );

        for (let j = 0; j < batchResults.length; j++) {
            const r = batchResults[j];
            const scene = batch[j];
            if (r.status === "fulfilled") {
                results.push({
                    index: r.value.index,
                    success: true,
                    generationId: r.value.generationId,
                    apiKey: r.value.apiKey,
                    model: "gpt-image-2-0",
                });
            } else {
                results.push({
                    index: scene.index,
                    success: false,
                    error: r.reason?.message || "Submission failed",
                });
            }
        }
    }
    return results;
}

/**
 * Check status of Pollo GPT Image 2.0 image generation tasks in parallel.
 */
export async function checkNanoBananaJobsStatus(
    jobs: Array<{ index: number; generationId: string; apiKey: string; model: string }>
): Promise<NanoBananaStatusResult[]> {
    console.log(`🔍 [pollo] Checking status for ${jobs.length} tasks...`);

    const results = await Promise.allSettled(
        jobs.map(async (job) => {
            const workingUrl = await getStatusUrl(job.generationId, job.apiKey);
            const res = await fetch(workingUrl, { headers: makeHeaders(job.apiKey) });
            if (!res.ok) {
                return { index: job.index, status: "FAILED" as const, error: `HTTP error ${res.status}` };
            }

            const checkData = await res.json();
            const gen = checkData?.data?.generations?.[0];
            const status = gen?.status || checkData?.data?.status || checkData?.status || "unknown";

            if (status === "succeed" || status === "success" || status === "completed") {
                const outputUrl =
                    gen?.url ||
                    checkData?.data?.output ||
                    checkData?.output ||
                    checkData?.data?.url ||
                    checkData?.url;
                if (outputUrl) return { index: job.index, status: "COMPLETE" as const, imageUrl: outputUrl };
            }

            if (status === "failed" || status === "error") {
                return {
                    index: job.index,
                    status: "FAILED" as const,
                    error: gen?.failMsg || checkData?.data?.error || checkData?.error || "Task failed",
                };
            }

            return { index: job.index, status: "PENDING" as const };
        })
    );

    return results.map((r, i) => {
        const job = jobs[i];
        if (r.status === "fulfilled") return r.value;
        return { index: job.index, status: "FAILED" as const, error: r.reason?.message || "Check status failed" };
    });
}

/**
 * Convenience wrapper — single image URL.
 */
export async function generateGptImage15SingleUrl(
    prompt: string,
    width: number = 1024,
    height: number = 1024
): Promise<string> {
    return generateNanoBananaImage(prompt, width, height);
}

/**
 * Generate images using Pollo GPT Image 2.0 with optional reference image.
 */
export async function generateGptImage15(
    prompt: string,
    refImageUrl: string | null,
    quantity: number = 1,
    quality: "LOW" | "MEDIUM" | "HIGH" = "MEDIUM",
    width: number = 1024,
    height: number = 1024
): Promise<string[]> {
    console.log(`🎨 [pollo] generateGptImage15 | ref=${!!refImageUrl}`);
    const input: Record<string, any> = {
        prompt,
        resolution: "1K",
        quality: "medium",
        aspectRatio: getAspectRatio(width, height),
    };

    if (refImageUrl) {
        input.image    = refImageUrl;
        input.imageUrl = refImageUrl;
    }

    const { taskId, apiKey } = await submitPolloImageTask({ input }, "/generation/openai/gpt-image-2-0/image");
    const url = await pollPolloTask(taskId, apiKey);
    return [url];
}

/**
 * Stub — Pollo accepts direct URLs, no pre-upload needed.
 */
export async function uploadImageToLeonardo(imageUrl: string, _apiKey: string): Promise<string> {
    console.log(`☁️ [pollo] Skipping pre-upload step (Pollo accepts direct URLs)`);
    return imageUrl;
}

// ─── Submit-only + Single-check helpers (for submit-sleep-poll pattern) ────────

/**
 * Submit a Nano Banana 2 / GPT Image 2.0 thumbnail task without polling.
 * Returns { taskId, apiKey } for use in later polling steps.
 */
export async function submitNanoBananaImageTask(
    prompt: string,
    width: number = 1024,
    height: number = 1024,
    cancelSignal?: { cancelled: boolean }
): Promise<{ taskId: string; apiKey: string }> {
    const body = {
        input: {
            prompt,
            resolution: "1K",
            quality: "medium",
            aspectRatio: getAspectRatio(width, height),
        },
    };
    if (cancelSignal?.cancelled) throw new Error("Job cancelled by force stop.");
    console.log(`🎨 [pollo] Submitting thumbnail task (no poll)...`);
    return submitPolloImageTask(body, "/generation/openai/gpt-image-2-0/image");
}

/**
 * Single lightweight status check for any Pollo task — no polling loop.
 * Returns 'complete' | 'failed' | 'pending' so callers can implement their own sleep-poll.
 */
export async function checkPolloTaskStatus(
    taskId: string,
    apiKey: string
): Promise<{ status: 'complete' | 'failed' | 'pending'; url?: string }> {
    try {
        const workingUrl = await getStatusUrl(taskId, apiKey);
        const res = await fetch(workingUrl, { headers: makeHeaders(apiKey) });
        if (!res.ok) return { status: 'pending' };

        const data = await res.json();
        const gen = data?.data?.generations?.[0];
        const st = gen?.status || data?.data?.status || data?.status || "unknown";

        if (st === "succeed" || st === "success" || st === "completed") {
            const url = gen?.url || data?.data?.output || data?.output || data?.data?.url || data?.url;
            if (url) return { status: 'complete', url };
        }
        if (st === "failed" || st === "error") return { status: 'failed' };
        return { status: 'pending' };
    } catch {
        return { status: 'pending' };
    }
}
