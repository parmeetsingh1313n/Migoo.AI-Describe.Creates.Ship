/**
 * lib/apify-video.ts
 *
 * Apify Wan 2.2 Image-to-Video generation for Short video scenes.
 *
 * Actor: p215uhRBVXpONQfS8  (Wan-AI/Wan2.2-I2V-A14B-Lightning)
 *
 * Key rotation:
 *  Uses the same APIFY_TOKEN_1 … APIFY_TOKEN_10 as apify-image.ts.
 *  Video jobs are offset by +5 to avoid colliding with simultaneous image jobs.
 *
 * Flow per scene:
 *  1. Upload source image to a temp Apify KV store → get public signed URL
 *  2. Submit async actor run with that image URL
 *  3. Poll until SUCCEEDED → return MP4 URL
 */

const VIDEO_ACTOR_ID = "p215uhRBVXpONQfS8";
const PRIME_OFFSET = 3;
const VIDEO_KEY_OFFSET = 5; // shift to avoid collision with image key slots

// ─── Token Management ──────────────────────────────────────────────────────────

function getApifyTokens(): string[] {
  const tokens: string[] = [];
  for (let i = 1; i <= 10; i++) {
    const t = process.env[`APIFY_TOKEN_${i}`];
    if (t && t.length > 0 && !t.includes("PLACEHOLDER")) tokens.push(t);
  }
  if (tokens.length === 0) {
    throw new Error(
      "[apify-video] No APIFY_TOKEN_* found in env. Set APIFY_TOKEN_1 … APIFY_TOKEN_10."
    );
  }
  return tokens;
}

function pickToken(sceneIndex: number, tokens: string[]): { token: string; tokenIdx: number } {
  const idx = ((sceneIndex * PRIME_OFFSET) + VIDEO_KEY_OFFSET) % tokens.length;
  return { token: tokens[idx], tokenIdx: idx };
}

// ─── Image Upload to Apify KV Store (for public URL) ─────────────────────────

/**
 * Upload an image to a temporary Apify KV store and return a publicly-accessible
 * signed URL. The Wan 2.2 actor requires a public HTTP URL — Apify signed URLs work.
 */
async function uploadImageForVideo(
  imageUrl: string,
  token: string
): Promise<string> {
  // Create temp KV store (no name = auto-generated, avoids parallel collision)
  const createRes = await fetch(`https://api.apify.com/v2/key-value-stores?token=${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });

  if (!createRes.ok) {
    throw new Error(`[apify-video] KV store create failed (${createRes.status})`);
  }
  const storeId: string = (await createRes.json()).data?.id;
  if (!storeId) throw new Error("[apify-video] No KV store ID returned");

  // Fetch the image bytes
  const imgRes = await fetch(imageUrl, { signal: AbortSignal.timeout(30_000) });
  if (!imgRes.ok) throw new Error(`[apify-video] Failed to fetch source image (${imgRes.status})`);

  const contentType = imgRes.headers.get("content-type") || "image/png";
  const imageBuffer = Buffer.from(await imgRes.arrayBuffer());

  // Upload to KV store
  const uploadRes = await fetch(
    `https://api.apify.com/v2/key-value-stores/${storeId}/records/scene-image?token=${token}`,
    {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body: imageBuffer,
    }
  );

  if (!uploadRes.ok) {
    throw new Error(`[apify-video] KV upload failed (${uploadRes.status})`);
  }

  // Return the signed public URL (accessible without auth)
  // Apify KV records with token appended ARE publicly accessible
  const publicUrl = `https://api.apify.com/v2/key-value-stores/${storeId}/records/scene-image?token=${token}`;
  console.log(`📤 [apify-video] Image uploaded to KV: ${storeId}`);
  return publicUrl;
}

// ─── Video Task Submission ────────────────────────────────────────────────────

export interface ApifyVideoTask {
  runId: string;
  tokenIdx: number;
  sceneIndex: number;
}

/**
 * Submit one image-to-video job to Apify (async, does not wait).
 * Returns a task handle for polling.
 */
export async function submitApifyVideoTask(
  imageUrl: string,
  videoPrompt: string,
  sceneIndex: number
): Promise<ApifyVideoTask> {
  const tokens = getApifyTokens();
  const { token, tokenIdx } = pickToken(sceneIndex, tokens);

  // Upload image so Wan 2.2 can fetch it
  const publicImageUrl = await uploadImageForVideo(imageUrl, token);

  const runUrl = `https://api.apify.com/v2/actors/${VIDEO_ACTOR_ID}/runs?token=${token}`;
  const input = {
    imageUrl: publicImageUrl,
    prompt: videoPrompt,
    resolution: "480p",
    aspectRatio: "9:16",
    duration: 5,
    negativePrompt: "blur, distort, low quality, shaky camera, fast movement, text, watermark",
    cfgScale: 1,
  };

  const submitRes = await fetch(runUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  if (!submitRes.ok) {
    const err = await submitRes.text();
    throw new Error(`[apify-video] Submit failed (${submitRes.status}): ${err.slice(0, 200)}`);
  }

  const runId: string = (await submitRes.json()).data?.id;
  if (!runId) throw new Error("[apify-video] No run ID returned");

  console.log(`🎬 [apify-video] Scene ${sceneIndex + 1} submitted | runId=${runId} | token_${tokenIdx + 1}`);
  return { runId, tokenIdx, sceneIndex };
}

// ─── Video Task Status Check ──────────────────────────────────────────────────

export interface ApifyVideoStatus {
  status: "pending" | "complete" | "failed";
  videoUrl?: string;
  apifyVideoUrl?: string;
}

/**
 * Check the status of a video generation run.
 * Returns { status: "complete", videoUrl } when done.
 */
export async function checkApifyVideoTask(
  task: ApifyVideoTask
): Promise<ApifyVideoStatus> {
  const tokens = getApifyTokens();
  const token = tokens[task.tokenIdx % tokens.length];

  const detailsRes = await fetch(
    `https://api.apify.com/v2/actor-runs/${task.runId}?token=${token}`
  );
  if (!detailsRes.ok) {
    return { status: "pending" };
  }

  const details = (await detailsRes.json()).data;
  const status: string = details?.status;

  if (status === "SUCCEEDED") {
    // Fetch dataset items
    const dsRes = await fetch(
      `https://api.apify.com/v2/datasets/${details.defaultDatasetId}/items?token=${token}`
    );
    const items = await dsRes.json();
    const item = items?.[0];
    const videoUrl: string = item?.videoUrl || item?.url || "";
    const apifyVideoUrl: string = item?.apifyVideoUrl || "";

    if (videoUrl) {
      console.log(`✅ [apify-video] Scene ${task.sceneIndex + 1} complete: ${videoUrl.slice(0, 80)}`);
      return { status: "complete", videoUrl, apifyVideoUrl };
    }
    return { status: "failed" };
  }

  if (["FAILED", "ABORTED", "TIMED-OUT"].includes(status)) {
    console.error(`❌ [apify-video] Scene ${task.sceneIndex + 1} run ${status}`);
    return { status: "failed" };
  }

  return { status: "pending" };
}

// ─── Parallel Video Submission ────────────────────────────────────────────────

export interface ApifyVideoSceneInput {
  index: number;
  imageUrl: string;
  videoPrompt: string;
}

export interface ApifyVideoSubmitResult {
  index: number;
  task?: ApifyVideoTask;
  success: boolean;
  error?: string;
}

/**
 * Submit ALL scene video jobs in parallel — each scene uses a different token.
 * Returns task handles for polling.
 */
export async function submitApifyVideoTasksParallel(
  scenes: ApifyVideoSceneInput[]
): Promise<ApifyVideoSubmitResult[]> {
  console.log(`🚀 [apify-video] Submitting ${scenes.length} video tasks in parallel`);

  const tasks = scenes.map(async (scene): Promise<ApifyVideoSubmitResult> => {
    try {
      const task = await submitApifyVideoTask(
        scene.imageUrl,
        scene.videoPrompt,
        scene.index
      );
      return { index: scene.index, task, success: true };
    } catch (err: any) {
      console.error(`❌ [apify-video] Scene ${scene.index + 1} submit failed: ${err.message}`);
      return { index: scene.index, success: false, error: err.message };
    }
  });

  const results = await Promise.allSettled(tasks);
  return results.map((r, i) =>
    r.status === "fulfilled"
      ? r.value
      : { index: scenes[i].index, success: false, error: String((r as any).reason) }
  );
}

// ─── Synchronous (blocking) single video generation ───────────────────────────

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Generate one video synchronously — submits and polls until complete.
 * Use in contexts where you can't do async step-based polling.
 */
export async function generateApifyVideoSync(
  imageUrl: string,
  videoPrompt: string,
  sceneIndex = 0,
  maxWaitMs = 300_000
): Promise<string> {
  const task = await submitApifyVideoTask(imageUrl, videoPrompt, sceneIndex);

  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    await sleep(8000);
    const result = await checkApifyVideoTask(task);
    if (result.status === "complete" && result.videoUrl) return result.videoUrl;
    if (result.status === "failed") throw new Error("[apify-video] Video generation failed");
  }

  throw new Error("[apify-video] Timed out waiting for video");
}

// ─── Legacy compatibility stubs ───────────────────────────────────────────────

/**
 * Drop-in stub for submitSeedanceVideoTask (wavespeed-video.ts).
 * Returns { taskId: runId, apiKey: tokenIdx } to match old interface.
 */
export async function submitSeedanceVideoTask(
  imageUrl: string | undefined,
  videoPrompt: string,
  _aspectRatio: string,
  sceneIndex = 0
): Promise<{ taskId: string; apiKey: string }> {
  if (!imageUrl) {
    throw new Error("[apify-video] imageUrl is required for Wan 2.2 I2V — SKIP_T2V is no longer supported");
  }
  const task = await submitApifyVideoTask(imageUrl, videoPrompt, sceneIndex);
  return { taskId: task.runId, apiKey: String(task.tokenIdx) };
}

/**
 * Drop-in stub for checkPolloVideoTaskStatus (wavespeed-video.ts).
 * taskId = runId, apiKey = tokenIdx as string.
 */
export async function checkPolloVideoTaskStatus(
  taskId: string,
  apiKey: string
): Promise<{ status: "complete" | "failed" | "pending"; url?: string }> {
  const tokenIdx = parseInt(apiKey, 10) || 0;
  const result = await checkApifyVideoTask({ runId: taskId, tokenIdx, sceneIndex: 0 });
  return {
    status: result.status,
    url: result.videoUrl,
  };
}

/**
 * Drop-in stub for processSeedanceVideoResult (wavespeed-video.ts).
 * In wavespeed, this processed the video with FFmpeg. 
 * With Apify Wan 2.2, the video is already rendered at 480p — just return it.
 */
export async function processSeedanceVideoResult(
  rawVideoUrl: string,
  _imageUrl: string | undefined,
  sceneDuration: number,
  _seriesId: string,
  _sceneIndex: number
): Promise<{ videoUrl: string; actualDurationSec: number }> {
  // Wan 2.2 outputs a ready-to-use MP4 at 480p, 5 seconds.
  // No FFmpeg processing needed. The stretching mechanism handles duration.
  return {
    videoUrl: rawVideoUrl,
    actualDurationSec: 5,
  };
}
