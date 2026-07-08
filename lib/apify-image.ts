/**
 * lib/apify-image.ts
 *
 * Apify-based image generation for ALL contexts:
 *  - Short video scenes (9:16 portrait)
 *  - Thumbnails (9:16 portrait)
 *  - Notes/course cover images (16:9 landscape)
 *
 * Models:
 *  Primary  → google/gemini-2.5-flash-image  (fast, cheap ~$0.40/image)
 *  Fallback → google/gemini-3.1-flash-image-preview (~$0.68/image)
 *
 * Key rotation:
 *  Reads APIFY_TOKEN_1 … APIFY_TOKEN_10 from env.
 *  Uses prime-offset shuffle so concurrent scenes never share a key.
 *  On 403/quota error, automatically tries the next key.
 *
 * Image Actor: fayoussef/bulk-ai-image-generator
 *  Actor ID: DX3hwU5XRNEJkpeC4
 *
 * Ultimate fallback (when ALL Apify tokens fail):
 *  WaveSpeed GPT Image 2 (openai/gpt-image-2/text-to-image)
 *  Rotates WAVESPEED_API_KEY … WAVESPEED_API_KEY_5 on quota errors.
 */

const IMAGE_ACTOR_ID = "DX3hwU5XRNEJkpeC4";
const PRIMARY_MODEL = "google/gemini-2.5-flash-image";
const FALLBACK_MODEL = "google/gemini-3.1-flash-image-preview";

// Prime used to spread scene indices across keys (no two adjacent scenes share a key)
const PRIME_OFFSET = 3;

// ─── Token Management ──────────────────────────────────────────────────────────

function getApifyTokens(): string[] {
  const tokens: string[] = [];
  for (let i = 1; i <= 10; i++) {
    const t = process.env[`APIFY_TOKEN_${i}`];
    if (t && t.length > 0 && !t.includes("PLACEHOLDER")) tokens.push(t);
  }
  if (tokens.length === 0) {
    throw new Error(
      "[apify-image] No APIFY_TOKEN_* found in env. Set APIFY_TOKEN_1 … APIFY_TOKEN_10."
    );
  }
  return tokens;
}

/**
 * Pick a token for a given scene using prime-offset rotation.
 * sceneIndex=-1 → thumbnail slot (uses last key)
 * videoOffset=true → offset by +5 to avoid collision with image jobs
 */
function pickToken(
  sceneIndex: number,
  tokens: string[],
  videoOffset = false
): { token: string; tokenIdx: number } {
  const offset = videoOffset ? 5 : 0;
  const idx =
    sceneIndex < 0
      ? tokens.length - 1
      : ((sceneIndex * PRIME_OFFSET + offset) % tokens.length);
  return { token: tokens[idx], tokenIdx: idx };
}

// ─── Core: Run actor and poll ──────────────────────────────────────────────────

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── WaveSpeed GPT Image 2 Fallback ───────────────────────────────────────────

/**
 * Collect all WAVESPEED_API_KEY, WAVESPEED_API_KEY_2 … WAVESPEED_API_KEY_5 from env.
 */
function getWaveSpeedKeys(): string[] {
  const keyNames = [
    "WAVESPEED_API_KEY",
    "WAVESPEED_API_KEY_2",
    "WAVESPEED_API_KEY_3",
    "WAVESPEED_API_KEY_4",
    "WAVESPEED_API_KEY_5",
  ];
  const keys: string[] = [];
  for (const name of keyNames) {
    const k = process.env[name];
    if (k && k.length > 0 && !k.includes("PLACEHOLDER")) keys.push(k);
  }
  return keys;
}

/**
 * Generate an image via WaveSpeed GPT Image 2 (openai/gpt-image-2/text-to-image).
 * Rotates through up to 5 API keys on 429/403 quota errors.
 * Returns the public output URL of the generated image.
 */
async function generateWaveSpeedImage(
  prompt: string,
  aspectRatio = "9:16"
): Promise<string> {
  const keys = getWaveSpeedKeys();
  if (keys.length === 0) {
    throw new Error(
      "[wavespeed] No WAVESPEED_API_KEY_* found in env. Set WAVESPEED_API_KEY … WAVESPEED_API_KEY_5."
    );
  }

  let lastErr = "";

  for (let ki = 0; ki < keys.length; ki++) {
    const key = keys[ki];
    const keyLabel = ki === 0 ? "WAVESPEED_API_KEY" : `WAVESPEED_API_KEY_${ki + 1}`;
    try {
      console.log(`🎨 [wavespeed] Submitting with ${keyLabel} | aspectRatio: ${aspectRatio}`);

      // ── Submit request ────────────────────────────────────────────────────────
      const submitRes = await fetch(
        "https://api.wavespeed.ai/api/v3/openai/gpt-image-2/text-to-image",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${key}`,
          },
          body: JSON.stringify({
            prompt,
            aspect_ratio: aspectRatio,
            quality: "medium",
            resolution: "1k",
            output_format: "png",
            enable_sync_mode: false,
            enable_base64_output: false,
          }),
        }
      );

      if (!submitRes.ok) {
        const errText = await submitRes.text();
        if (submitRes.status === 429 || submitRes.status === 403) {
          console.warn(
            `⚠️ [wavespeed] [${keyLabel}] quota exceeded (${submitRes.status}) — rotating key`
          );
          lastErr = `QUOTA:${submitRes.status}`;
          continue; // rotate to next key
        }
        throw new Error(
          `[wavespeed] HTTP ${submitRes.status}: ${errText.slice(0, 200)}`
        );
      }

      const submitData = await submitRes.json();
      const requestId: string = submitData.id;
      if (!requestId)
        throw new Error("[wavespeed] No request ID returned in submit response");

      console.log(`⏳ [wavespeed] [${keyLabel}] Submitted (id: ${requestId}), polling...`);

      // ── Poll until complete ────────────────────────────────────────────────────
      const startTime = Date.now();
      const MAX_WAIT_MS = 120_000;

      while (Date.now() - startTime < MAX_WAIT_MS) {
        await sleep(3000);

        const pollRes = await fetch(
          `https://api.wavespeed.ai/api/v3/predictions/${requestId}`,
          { headers: { Authorization: `Bearer ${key}` } }
        );
        if (!pollRes.ok) continue;

        const pollData = await pollRes.json();
        const status: string = pollData.status;

        if (status === "completed") {
          const outputs: string[] = pollData.outputs || [];
          const imageUrl = outputs[0];
          if (!imageUrl)
            throw new Error(
              "[wavespeed] completed but no output URL in response"
            );
          console.log(
            `✅ [wavespeed] [${keyLabel}] Image ready: ${imageUrl.slice(0, 80)}`
          );
          return imageUrl;
        }

        if (status === "failed") {
          throw new Error(
            `[wavespeed] Task failed: ${pollData.error || "unknown error"}`
          );
        }

        console.log(`⏳ [wavespeed] [${keyLabel}] Status: ${status}...`);
      }

      throw new Error("[wavespeed] Timed out waiting for image");
    } catch (err: any) {
      // If the key loop already handled a quota rotate via `continue`, we won't
      // reach here for that key. For all other errors try next key.
      lastErr = err.message ?? String(err);
      console.warn(
        `⚠️ [wavespeed] [${keyLabel}] failed: ${lastErr.slice(0, 120)}`
      );
    }
  }

  throw new Error(
    `[wavespeed] All ${keys.length} key(s) exhausted. Last error: ${lastErr.slice(0, 150)}`
  );
}

interface ApifyRunResult {
  imageUrl: string;
  signedUrl: string;
}

/**
 * Submit one image generation run to Apify and poll until done.
 * Returns the signed public URL of the generated image.
 */
async function runApifyImageActor(
  token: string,
  model: string,
  prompt: string,
  aspectRatio: string
): Promise<ApifyRunResult> {
  const runUrl = `https://api.apify.com/v2/actors/${IMAGE_ACTOR_ID}/runs?token=${token}`;
  const input = {
    model,
    prompts: [prompt],
    aspectRatio,
    imageSize: "1K",
    imagesPerPrompt: 1,
    concurrency: 1,
  };

  const submitRes = await fetch(runUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  if (!submitRes.ok) {
    const errText = await submitRes.text();
    if (submitRes.status === 403 || submitRes.status === 429) {
      throw new Error(`QUOTA_EXCEEDED:${submitRes.status}`);
    }
    throw new Error(
      `[apify-image] HTTP ${submitRes.status}: ${errText.slice(0, 200)}`
    );
  }

  const submitData = await submitRes.json();
  const runId: string = submitData.data?.id;
  if (!runId) throw new Error("[apify-image] No run ID returned");

  // Poll until complete
  const startTime = Date.now();
  const MAX_WAIT_MS = 120_000;

  while (Date.now() - startTime < MAX_WAIT_MS) {
    await sleep(4000);

    const detailsRes = await fetch(
      `https://api.apify.com/v2/actor-runs/${runId}?token=${token}`
    );
    if (!detailsRes.ok) continue;

    const details = (await detailsRes.json()).data;
    const status: string = details?.status;

    if (status === "SUCCEEDED") {
      // Fetch dataset items
      const dsRes = await fetch(
        `https://api.apify.com/v2/datasets/${details.defaultDatasetId}/items?token=${token}`
      );
      const items = await dsRes.json();
      const item = items?.[0];
      const imageUrl: string = item?.imageUrl || item?.url || "";

      if (!imageUrl) {
        console.warn(`⚠️ [apify-image] Run succeeded but no imageUrl/url found in dataset item. Item content:`, JSON.stringify(items).slice(0, 500));
        throw new Error("[apify-image] Run succeeded but no image URL in dataset");
      }

      return { imageUrl, signedUrl: imageUrl };
    }

    if (["FAILED", "ABORTED", "TIMED-OUT"].includes(status)) {
      throw new Error(`[apify-image] Actor run ${status} (runId: ${runId})`);
    }
  }

  throw new Error("[apify-image] Timed out waiting for image generation");
}

// ─── Single Image Generation ───────────────────────────────────────────────────

interface GenerateImageOpts {
  /** Aspect ratio, e.g. "9:16", "16:9", "1:1" */
  aspectRatio?: string;
  /** Scene index for key rotation (default 0) */
  sceneIndex?: number;
}

/**
 * Generate a single image with automatic key rotation and model fallback.
 * Returns the publicly accessible signed Apify URL.
 */
export async function generateApifyImage(
  prompt: string,
  opts: GenerateImageOpts = {}
): Promise<string> {
  const { aspectRatio = "9:16", sceneIndex = 0 } = opts;
  const tokens = getApifyTokens();

  // Try each token starting from the scene-assigned one
  const startIdx = sceneIndex < 0
    ? tokens.length - 1
    : ((sceneIndex * PRIME_OFFSET) % tokens.length);

  let lastErr = "";

  for (let ki = 0; ki < tokens.length; ki++) {
    const tokenIdx = (startIdx + ki) % tokens.length;
    const token = tokens[tokenIdx];
    const keyLabel = `token_${tokenIdx + 1}`;

    // Try primary model first, then fallback
    for (const model of [PRIMARY_MODEL, FALLBACK_MODEL]) {
      try {
        console.log(
          `🎨 [apify-image] ${model} [${keyLabel}] | ${aspectRatio} | "${prompt.slice(0, 60)}..."`
        );
        const result = await runApifyImageActor(token, model, prompt, aspectRatio);
        console.log(`✅ [apify-image] Done: ${result.imageUrl.slice(0, 80)}`);
        return result.imageUrl;
      } catch (err: any) {
        if (err.message?.startsWith("QUOTA_EXCEEDED")) {
          console.warn(`⚠️ [apify-image] [${keyLabel}] quota exceeded — rotating key`);
          lastErr = err.message;
          break; // try next key, not next model
        }
        console.warn(
          `⚠️ [apify-image] [${keyLabel}] ${model} failed: ${err.message?.slice(0, 80)}`
        );
        lastErr = err.message;
        // For non-quota errors, try fallback model next iteration
      }
    }
  }

  // ── All Apify tokens exhausted — try WaveSpeed GPT Image 2 as final fallback ──
  console.warn(
    `⚠️ [apify-image] All ${tokens.length} token(s) exhausted. Trying WaveSpeed GPT Image 2 fallback...`
  );
  try {
    const wsUrl = await generateWaveSpeedImage(prompt, aspectRatio);
    return wsUrl;
  } catch (wsErr: any) {
    console.error(
      `❌ [wavespeed] Fallback also failed: ${wsErr.message?.slice(0, 120)}`
    );
  }

  throw new Error(
    `[apify-image] All ${tokens.length} token(s) exhausted + WaveSpeed fallback failed. Last apify error: ${lastErr.slice(0, 150)}`
  );
}

// ─── Parallel Image Generation for Shorts ─────────────────────────────────────

export interface ApifySceneConfig {
  index: number;
  prompt: string;
  aspectRatio?: string;
}

export interface ApifyImageResult {
  index: number;
  success: boolean;
  imageUrl?: string;
  signedUrl?: string;
  error?: string;
}

/**
 * Generate a single scene's image with token rotation + primary/fallback model
 * retry, then WaveSpeed as the ultimate fallback. Extracted so it can run
 * behind a concurrency limiter (see generateApifyImagesParallel) instead of
 * every scene hammering the same small pool of tokens simultaneously.
 */
async function generateSceneWithFallback(
  scene: ApifySceneConfig,
  tokens: string[]
): Promise<ApifyImageResult> {
  const ar = scene.aspectRatio ?? "9:16";
  const startIdx = (scene.index * PRIME_OFFSET) % tokens.length;

  let lastErr = "";
  for (let ki = 0; ki < tokens.length; ki++) {
    const tokenIdx = (startIdx + ki) % tokens.length;
    const token = tokens[tokenIdx];
    const keyLabel = `token_${tokenIdx + 1}`;

    for (const model of [PRIMARY_MODEL, FALLBACK_MODEL]) {
      try {
        console.log(
          `🎨 [apify-image] Scene ${scene.index + 1} | ${model} [${keyLabel}] | ${ar}`
        );
        const result = await runApifyImageActor(token, model, scene.prompt, ar);
        console.log(`✅ [apify-image] Scene ${scene.index + 1} done`);
        return {
          index: scene.index,
          success: true,
          imageUrl: result.imageUrl,
          signedUrl: result.signedUrl,
        };
      } catch (err: any) {
        if (err.message?.startsWith("QUOTA_EXCEEDED")) {
          console.warn(`⚠️ [apify-image] Scene ${scene.index + 1} [${keyLabel}] quota exceeded — rotating key`);
          lastErr = err.message;
          break; // next key
        }
        // Log the FULL error (not truncated) — this is the only signal we get
        // for why the primary model failed before falling back, so truncating
        // it hides the actual root cause (bad model id, actor error, etc.)
        console.warn(
          `⚠️ [apify-image] Scene ${scene.index + 1} [${keyLabel}] ${model} failed: ${err.message}`
        );
        lastErr = err.message;
      }
    }
  }

  // ── All Apify tokens exhausted for this scene — try WaveSpeed GPT Image 2 ──
  console.warn(
    `⚠️ [apify-image] Scene ${scene.index + 1}: All Apify tokens exhausted. Trying WaveSpeed GPT Image 2 fallback...`
  );
  try {
    const wsUrl = await generateWaveSpeedImage(scene.prompt, ar);
    console.log(`✅ [wavespeed] Scene ${scene.index + 1} done via WaveSpeed GPT Image 2`);
    return {
      index: scene.index,
      success: true,
      imageUrl: wsUrl,
      signedUrl: wsUrl,
    };
  } catch (wsErr: any) {
    console.error(
      `❌ [wavespeed] Scene ${scene.index + 1} fallback failed: ${wsErr.message}`
    );
  }

  console.error(`❌ [apify-image] Scene ${scene.index + 1} failed (Apify + WaveSpeed): ${lastErr}`);
  return { index: scene.index, success: false, error: lastErr };
}

/**
 * Generate images for ALL scenes in parallel.
 * Each scene gets a different Apify token (prime-offset rotation).
 * On failure, the scene result has success=false (caller should handle gracefully).
 *
 * Runs behind a concurrency limiter (default 4) instead of firing every scene
 * at once — with only ~10 tokens and often 20-35+ scenes, unbounded
 * concurrency means multiple scenes hit the SAME token's actor run
 * simultaneously. Apify rejects/errors overlapping runs on one token, which
 * looks identical to the primary model "failing" and falling back to the
 * secondary model on every scene, when the real cause is token contention.
 */
export async function generateApifyImagesParallel(
  scenes: ApifySceneConfig[],
  concurrency = 4
): Promise<ApifyImageResult[]> {
  const tokens = getApifyTokens();
  const effectiveConcurrency = Math.max(1, Math.min(concurrency, tokens.length, scenes.length));
  console.log(
    `🚀 [apify-image] Parallel generation: ${scenes.length} scenes across ${tokens.length} tokens (max ${effectiveConcurrency} concurrent)`
  );

  const results: ApifyImageResult[] = new Array(scenes.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const myIndex = nextIndex++;
      if (myIndex >= scenes.length) return;
      try {
        results[myIndex] = await generateSceneWithFallback(scenes[myIndex], tokens);
      } catch (err: any) {
        results[myIndex] = { index: scenes[myIndex].index, success: false, error: String(err?.message ?? err) };
      }
    }
  }

  await Promise.all(Array.from({ length: effectiveConcurrency }, () => worker()));
  return results;
}

// ─── Convenience Wrappers ──────────────────────────────────────────────────────

/**
 * Generate a single scene image (9:16 portrait for Shorts).
 */
export async function generateApifyShortImage(
  prompt: string,
  sceneIndex = 0
): Promise<string> {
  return generateApifyImage(prompt, { aspectRatio: "9:16", sceneIndex });
}

/**
 * Generate a thumbnail image (9:16 portrait for Shorts).
 */
export async function generateApifyImageForThumbnail(prompt: string): Promise<string> {
  return generateApifyImage(prompt, { aspectRatio: "9:16", sceneIndex: -1 });
}

/**
 * Generate a notes/course cover image (16:9 landscape).
 */
export async function generateApifyImageForNotes(
  prompt: string,
  sceneIndex = 0
): Promise<string> {
  return generateApifyImage(prompt, { aspectRatio: "16:9", sceneIndex });
}

/**
 * Generate multiple notes images in parallel (16:9 landscape).
 */
export async function generateApifyNotesImagesParallel(
  scenes: Array<{ index: number; prompt: string }>
): Promise<ApifyImageResult[]> {
  return generateApifyImagesParallel(
    scenes.map((s) => ({ ...s, aspectRatio: "16:9" }))
  );
}

// ─── Legacy-compatible wrappers (drop-in for vercel-image / flatkey-image) ─────

/**
 * Drop-in replacement for generateNanoBananaImage().
 * width/height params are ignored — Apify uses aspectRatio instead.
 */
export async function generateNanoBananaImage(
  prompt: string,
  _width?: number,
  _height?: number,
  _styleUUID?: string
): Promise<string> {
  // Determine aspect ratio from width/height hint
  let ar = "9:16";
  if (_width && _height) {
    if (_width > _height) ar = "16:9";
    else if (_width === _height) ar = "1:1";
  }
  return generateApifyImage(prompt, { aspectRatio: ar, sceneIndex: 0 });
}

/**
 * Drop-in replacement for generateNanoBananaImagesParallel().
 */
export async function generateNanoBananaImagesParallel(
  scenes: Array<{
    index: number;
    prompt: string;
    width?: number;
    height?: number;
    styleUUID?: string;
  }>,
  _cancelSignal?: any,
  concurrency?: number
): Promise<ApifyImageResult[]> {
  return generateApifyImagesParallel(
    scenes.map((s) => {
      let ar = "16:9";
      if (s.width && s.height) {
        if (s.width < s.height) ar = "9:16";
        else if (s.width === s.height) ar = "1:1";
      }
      return { index: s.index, prompt: s.prompt, aspectRatio: ar };
    }),
    concurrency
  );
}

// Re-export a stub for NANO_BANANA_STYLES (used in notes-image-gen.ts)
export const NANO_BANANA_STYLES: Record<string, string> = {
  Illustration: "apify-illustration",
  Photography: "apify-photography",
  Cinematic: "apify-cinematic",
};
