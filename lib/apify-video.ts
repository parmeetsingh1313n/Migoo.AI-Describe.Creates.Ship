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
 *  4. processSeedanceVideoResult: download + FFmpeg optical-flow smooth-stretch + Appwrite upload
 *     → Returns actualDurationSec=sceneDuration so Remotion plays at playbackRate=1.0 (zero judder)
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { exec } from "child_process";
import { putWithRotation } from "@/lib/blob";

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
/**
 * Upload an image to Appwrite storage and return a publicly-accessible URL.
 * The Wan 2.2 actor requires a public HTTP URL — Appwrite view URLs work.
 */
async function uploadImageForVideo(
  imageUrl: string
): Promise<string> {
  // Fetch the image bytes
  const imgRes = await fetch(imageUrl, { signal: AbortSignal.timeout(30_000) });
  if (!imgRes.ok) {
    throw new Error(`[apify-video] Failed to fetch source image (${imgRes.status})`);
  }

  const contentType = imgRes.headers.get("content-type") || "image/jpeg";
  const imageBuffer = Buffer.from(await imgRes.arrayBuffer());

  // Upload to Appwrite storage (uses key rotation internally to balance/avoid limits)
  const rand = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const pathname = `temp/video_src_${rand}.jpg`;

  const uploadResult = await putWithRotation(pathname, imageBuffer, {
    contentType,
  });

  console.log(`📤 [apify-video] Image uploaded to Appwrite: ${uploadResult.url}`);
  return uploadResult.url;
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
  const publicImageUrl = await uploadImageForVideo(imageUrl);

  const runUrl = `https://api.apify.com/v2/actors/${VIDEO_ACTOR_ID}/runs?token=${token}`;
  const input = {
    imageUrl: publicImageUrl,
    prompt: videoPrompt,
    resolution: "480p",
    aspectRatio: "9:16",
    duration: 10, // 10s native → trim for short scenes, minimal stretch for long ones
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
  apiKey: string,
  sceneIndex = 0
): Promise<{ status: "complete" | "failed" | "pending"; url?: string }> {
  const tokenIdx = parseInt(apiKey, 10) || 0;
  const result = await checkApifyVideoTask({ runId: taskId, tokenIdx, sceneIndex });
  return {
    status: result.status,
    url: result.videoUrl,
  };
}

// ─── FFmpeg helpers ───────────────────────────────────────────────────────────

function getFFmpegBin(): string {
  try {
    const bin = require("ffmpeg-static") as string | null;
    if (bin && fs.existsSync(bin)) return bin;
  } catch {}
  for (const p of [
    path.join(process.cwd(), "node_modules", "ffmpeg-static", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg"),
    "/usr/bin/ffmpeg",
    "/usr/local/bin/ffmpeg",
  ]) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error("[apify-video] ffmpeg-static not found");
}

function runCmd(cmd: string, timeoutMs = 55_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = exec(cmd, { maxBuffer: 100 * 1024 * 1024 }, (err, _out, stderr) => {
      if (err) reject(Object.assign(err, { stderr }));
      else resolve();
    });
    // Hard timeout — Inngest step budget is 60s, leave 5s headroom
    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      reject(new Error(`[apify-video] FFmpeg timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);
    child.on("close", () => clearTimeout(timer));
  });
}

async function probeActualDuration(filePath: string): Promise<number> {
  const ffmpegBin = getFFmpegBin();
  return new Promise((resolve) => {
    exec(`"${ffmpegBin}" -i "${filePath}"`, (_err, stdout, stderr) => {
      const out = (stdout || "") + "\n" + (stderr || "");
      const m = out.match(/Duration:\s*(\d{2}):(\d{2}):(\d{2}\.\d+)/);
      if (m) {
        resolve(parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3]));
      } else {
        resolve(10); // safe default — Wan 2.2 now produces 10s
      }
    });
  });
}

/**
 * Pre-process a Wan 2.2 video for smooth playback:
 *
 * SMART TRIM vs STRETCH:
 *   If nativeVideo (10s) >= sceneDuration  →  TRIM only (zero interpolation, perfect quality)
 *   If nativeVideo (10s) < sceneDuration   →  STRETCH with much smaller ratio (~1.x vs old 2x)
 *
 * Stretch pipeline (3 tiers, only used when native is shorter than scene):
 *   TIER 1 — MCI optical-flow at 30fps → setpts stretch → CFR
 *   TIER 2 — blend crossfade at 30fps  → setpts stretch → CFR
 *   TIER 3 — setpts only (safe fallback)
 */
async function smoothStretchVideoBuffer(
  inputBuffer: Buffer,
  targetDuration: number,
  seriesId: string,
  sceneIndex: number
): Promise<{ buffer: Buffer; reportedDuration: number }> {
  const ffmpegBin = getFFmpegBin();
  const rand = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const tmpDir = os.tmpdir();
  const inPath  = path.join(tmpDir, `wan_in_${rand}.mp4`);
  const outPath = path.join(tmpDir, `wan_out_${rand}.mp4`);

  fs.writeFileSync(inPath, inputBuffer);

  const actualDuration = await probeActualDuration(inPath);

  console.log(
    `📐 [apify-video] Scene ${sceneIndex + 1}: native=${actualDuration.toFixed(2)}s target=${targetDuration.toFixed(2)}s`
  );

  // ── TRIM PATH: native video is already long enough ──────────────────────────
  if (actualDuration >= targetDuration - 0.1) {
    const trimPoint = targetDuration.toFixed(3);
    const trimCmd = [
      `"${ffmpegBin}" -y -i "${inPath}"`,
      `-t ${trimPoint}`,
      `-c:v libx264 -pix_fmt yuv420p -preset fast -crf 23`,
      `-an -movflags +faststart -avoid_negative_ts make_zero`,
      `"${outPath}"`,
    ].join(" ");

    try {
      console.log(`✂️  [apify-video] Scene ${sceneIndex + 1}: trimming ${actualDuration.toFixed(2)}s → ${trimPoint}s (zero interpolation)`);
      await runCmd(trimCmd, 20_000);

      if (fs.existsSync(outPath) && fs.statSync(outPath).size > 10_000) {
        const outBuffer = fs.readFileSync(outPath);
        try { fs.unlinkSync(inPath);  } catch {}
        try { fs.unlinkSync(outPath); } catch {}
        console.log(`✅ [apify-video] Scene ${sceneIndex + 1}: trim succeeded → ${(outBuffer.length / 1024).toFixed(0)} KB`);
        return { buffer: outBuffer, reportedDuration: targetDuration };
      }
    } catch (err: any) {
      console.warn(`⚠️ [apify-video] Scene ${sceneIndex + 1}: trim failed (${err.message}) — falling back to stretch`);
    }
  }

  // ── STRETCH PATH: native video is shorter than scene (minimal ratio now ~1.x) ─
  const needed = targetDuration + 0.6;
  const ratio = (needed / actualDuration).toFixed(6);
  const needsStretch = Math.abs(actualDuration - needed) > 0.1;
  const trimPoint = needed.toFixed(3);

  console.log(
    `📐 [apify-video] Scene ${sceneIndex + 1}: stretching → target=${needed.toFixed(2)}s (ratio=${ratio})`
  );

  const buildCmd = (vfFilter: string, fpsModeFlag: string, crf = 23) =>
    [
      `"${ffmpegBin}" -y -i "${inPath}"`,
      `-vf "${vfFilter}"`,
      `-t ${trimPoint}`,
      `-r 30`, fpsModeFlag,
      `-g 30 -bf 0`,
      `-c:v libx264 -pix_fmt yuv420p -preset fast -crf ${crf}`,
      `-an -movflags +faststart -avoid_negative_ts make_zero`,
      `"${outPath}"`,
    ].join(" ");

  const tier1Filter = needsStretch
    ? `minterpolate=fps=30:mi_mode=mci:scd=none,setpts=${ratio}*PTS,tpad=stop=6:stop_mode=clone`
    : `fps=30,setpts=PTS-STARTPTS,tpad=stop=6:stop_mode=clone`;

  const tier2Filter = needsStretch
    ? `minterpolate=fps=30:mi_mode=blend:scd=none,setpts=${ratio}*PTS,tpad=stop=6:stop_mode=clone`
    : `fps=30,setpts=PTS-STARTPTS,tpad=stop=6:stop_mode=clone`;

  const tier3Filter = needsStretch
    ? `setpts=${ratio}*PTS,tpad=stop=6:stop_mode=clone`
    : `fps=30,setpts=PTS-STARTPTS,tpad=stop=6:stop_mode=clone`;

  const tiers: Array<{ name: string; filter: string; timeout: number }> = [
    { name: "MCI optical-flow",  filter: tier1Filter, timeout: 50_000 },
    { name: "blend crossfade",   filter: tier2Filter, timeout: 35_000 },
    { name: "setpts fallback",   filter: tier3Filter, timeout: 20_000 },
  ];

  for (const tier of tiers) {
    try {
      if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
      const cmd = buildCmd(tier.filter, "-fps_mode cfr");
      console.log(`⏳ [apify-video] Scene ${sceneIndex + 1}: trying ${tier.name}...`);
      await runCmd(cmd, tier.timeout);

      if (!fs.existsSync(outPath) || fs.statSync(outPath).size < 10_000) {
        throw new Error(`Output file too small or missing`);
      }

      let outBuffer = fs.readFileSync(outPath);

      // Size gate: re-encode at higher CRF if > 20 MB
      if (outBuffer.length > 20 * 1024 * 1024) {
        console.warn(`⚠️ [apify-video] Output ${(outBuffer.length / 1024 / 1024).toFixed(1)} MB — re-encoding at CRF 32...`);
        const smallPath = outPath.replace(".mp4", "_s.mp4");
        try {
          await runCmd(
            `"${ffmpegBin}" -y -i "${outPath}" -c:v libx264 -pix_fmt yuv420p -preset fast -crf 32 -an -movflags +faststart "${smallPath}"`,
            15_000
          );
          if (fs.existsSync(smallPath) && fs.statSync(smallPath).size > 5_000) {
            outBuffer = fs.readFileSync(smallPath);
            try { fs.unlinkSync(smallPath); } catch {}
          }
        } catch { /* use original */ }
      }

      try { fs.unlinkSync(inPath);  } catch {}
      try { fs.unlinkSync(outPath); } catch {}

      console.log(`✅ [apify-video] Scene ${sceneIndex + 1}: ${tier.name} succeeded → ${(outBuffer.length / 1024).toFixed(0)} KB`);
      return { buffer: outBuffer, reportedDuration: needed };

    } catch (err: any) {
      // fps_mode fallback for older FFmpeg builds
      if (err.stderr?.includes("fps_mode") || err.message?.includes("fps_mode")) {
        try {
          if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
          const legacyCmd = buildCmd(tier.filter, "-vsync cfr");
          await runCmd(legacyCmd, tier.timeout);
          if (fs.existsSync(outPath) && fs.statSync(outPath).size > 10_000) {
            const outBuffer = fs.readFileSync(outPath);
            try { fs.unlinkSync(inPath);  } catch {}
            try { fs.unlinkSync(outPath); } catch {}
            console.log(`✅ [apify-video] Scene ${sceneIndex + 1}: ${tier.name} succeeded (legacy vsync)`);
            return { buffer: outBuffer, reportedDuration: needed };
          }
        } catch { /* fall through to next tier */ }
      }
      console.warn(`⚠️ [apify-video] Scene ${sceneIndex + 1}: ${tier.name} failed (${err.message?.slice(0, 80)}) — trying next tier`);
    }
  }

  // All tiers failed — return original unprocessed buffer
  try { fs.unlinkSync(inPath);  } catch {}
  try { fs.unlinkSync(outPath); } catch {}
  console.warn(`⚠️ [apify-video] Scene ${sceneIndex + 1}: all FFmpeg tiers failed, returning raw video (actualDuration=${actualDuration.toFixed(2)}s)`);
  return { buffer: inputBuffer, reportedDuration: actualDuration };
}

// ─── Public Processing API ────────────────────────────────────────────────────

/**
 * Process a completed Wan 2.2 video result:
 *  1. Download raw MP4 from Apify CDN
 *  2. Smooth-stretch with FFmpeg 3-tier optical-flow to exactly sceneDuration
 *  3. Upload to Appwrite blob storage
 *  4. Return the permanent Appwrite URL with actualDurationSec = sceneDuration
 *
 * Because actualDurationSec = sceneDuration, Remotion renders at playbackRate=1.0
 * → EVERY frame seek lands on an exact frame → zero judder, ultra smooth.
 */
export async function processSeedanceVideoResult(
  rawVideoUrl: string,
  _imageUrl: string | undefined,
  sceneDuration: number,
  seriesId: string,
  sceneIndex: number
): Promise<{ videoUrl: string; actualDurationSec: number }> {
  console.log(`📥 [apify-video] Processing scene ${sceneIndex + 1}: downloading from Apify CDN...`);

  // 1. Download raw video
  const videoRes = await fetch(rawVideoUrl, { signal: AbortSignal.timeout(60_000) });
  if (!videoRes.ok) throw new Error(`[apify-video] Failed to download video: ${videoRes.status}`);
  const rawBuffer = Buffer.from(await videoRes.arrayBuffer());
  console.log(`📥 [apify-video] Scene ${sceneIndex + 1}: downloaded ${(rawBuffer.length / 1024).toFixed(0)} KB`);

  // 2. Smooth-stretch with FFmpeg optical-flow interpolation
  let finalBuffer: Buffer;
  let reportedDuration: number;

  try {
    const result = await smoothStretchVideoBuffer(rawBuffer, sceneDuration, seriesId, sceneIndex);
    finalBuffer = result.buffer;
    reportedDuration = result.reportedDuration;
  } catch (err: any) {
    console.warn(`⚠️ [apify-video] Scene ${sceneIndex + 1}: smoothStretch threw (${err.message}), using raw video`);
    finalBuffer = rawBuffer;
    reportedDuration = 10; // Wan 2.2 native duration (now 10s)
  }

  // 3. Upload to Appwrite via rotating blob storage
  const filename = `shorts/${seriesId}/scene_${sceneIndex}_wan22_${Date.now()}.mp4`;
  const blob = await putWithRotation(filename, finalBuffer, {
    access: "public",
    contentType: "video/mp4",
  });

  console.log(`✅ [apify-video] Scene ${sceneIndex + 1}: uploaded to Appwrite → ${blob.url.slice(0, 80)} (reportedDuration=${reportedDuration.toFixed(2)}s)`);

  return {
    videoUrl: blob.url,
    actualDurationSec: reportedDuration,
  };
}
