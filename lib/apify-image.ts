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

  throw new Error(
    `[apify-image] All ${tokens.length} token(s) exhausted. Last error: ${lastErr.slice(0, 150)}`
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
 * Generate images for ALL scenes in parallel.
 * Each scene gets a different Apify token (prime-offset rotation).
 * On failure, the scene result has success=false (caller should handle gracefully).
 */
export async function generateApifyImagesParallel(
  scenes: ApifySceneConfig[]
): Promise<ApifyImageResult[]> {
  const tokens = getApifyTokens();
  console.log(
    `🚀 [apify-image] Parallel generation: ${scenes.length} scenes across ${tokens.length} tokens`
  );

  const tasks = scenes.map(async (scene): Promise<ApifyImageResult> => {
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
            lastErr = err.message;
            break; // next key
          }
          lastErr = err.message;
        }
      }
    }

    console.error(`❌ [apify-image] Scene ${scene.index + 1} failed: ${lastErr.slice(0, 80)}`);
    return { index: scene.index, success: false, error: lastErr };
  });

  const results = await Promise.allSettled(tasks);
  return results.map((r, i) =>
    r.status === "fulfilled"
      ? r.value
      : { index: scenes[i].index, success: false, error: String((r as any).reason) }
  );
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
  _concurrency?: number
): Promise<ApifyImageResult[]> {
  return generateApifyImagesParallel(
    scenes.map((s) => {
      let ar = "16:9";
      if (s.width && s.height) {
        if (s.width < s.height) ar = "9:16";
        else if (s.width === s.height) ar = "1:1";
      }
      return { index: s.index, prompt: s.prompt, aspectRatio: ar };
    })
  );
}

// Re-export a stub for NANO_BANANA_STYLES (used in notes-image-gen.ts)
export const NANO_BANANA_STYLES: Record<string, string> = {
  Illustration: "apify-illustration",
  Photography: "apify-photography",
  Cinematic: "apify-cinematic",
};
