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
  sceneIndex: number,
): Promise<ApifyVideoTask> {
  const tokens = getApifyTokens();
  const { token, tokenIdx } = pickToken(sceneIndex, tokens);

  // Upload start image so Wan 2.2 can fetch it
  const publicImageUrl = await uploadImageForVideo(imageUrl);

  const runUrl = `https://api.apify.com/v2/actors/${VIDEO_ACTOR_ID}/runs?token=${token}`;
  const input: Record<string, any> = {
    imageUrl:       publicImageUrl,
    prompt:         videoPrompt,
    resolution:     "480p",
    aspectRatio:    "9:16",
    duration:       10,
    negativePrompt: "blur, distort, low quality, shaky camera, fast movement, rapid motion, jerky, abrupt motion, sudden jump, text, watermark, speed ramp",
    cfgScale:       1,
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
        scene.index,
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
  sceneIndex = 0,
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
 * Advanced cinematic video processor for Wan 2.2 output.
 *
 * ROOT FIX: Wan 2.2 Lightning generates ~16fps VFR video.
 * Without fps conversion even a TRIMMED video looks choppy when played at 30fps.
 *
 * PIPELINE:
 *
 * TRIM PATH (native >= sceneDuration):
 *   Tier A — MCI optical-flow to 30fps + tmix motion blur + trim  (cinema quality)
 *   Tier B — blend crossfade to 30fps + trim                      (smooth, fast)
 *   Tier C — simple fps=30 conversion + trim                      (safe fallback)
 *
 * STRETCH PATH (native < sceneDuration):
 *   Tier 1 — MCI to 30fps + tmix motion blur + setpts stretch     (cinema quality)
 *   Tier 2 — blend to 30fps + setpts stretch                      (smooth fallback)
 *   Tier 3 — setpts only                                          (safe fallback)
 *
 * tmix (frames=3, weights=1 2 1) simulates camera shutter motion blur:
 *   Each frame = 25% prev + 50% current + 25% next → masks interpolation artifacts
 *   and gives the "cinematic slow motion" look without obvious ghosting.
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

  // ── Shared helpers ───────────────────────────────────────────────────────────

  const cleanup = () => {
    try { fs.unlinkSync(inPath);  } catch {}
    try { fs.unlinkSync(outPath); } catch {}
  };

  /**
   * Run one FFmpeg command.
   * Tries modern -fps_mode cfr first, falls back to legacy -vsync cfr.
   * Returns true if the output file is valid and > 10 KB.
   */
  const tryCmd = async (vfFilter: string, outputDuration: number, timeoutMs: number, crf = 23): Promise<boolean> => {
    if (fs.existsSync(outPath)) { try { fs.unlinkSync(outPath); } catch {} }

    const base = [
      `"${ffmpegBin}" -y -i "${inPath}"`,
      `-vf "${vfFilter}"`,
      `-t ${outputDuration.toFixed(3)}`,
      `-r 30`,
      `-g 30 -bf 0`,
      `-c:v libx264 -pix_fmt yuv420p -preset fast -crf ${crf}`,
      `-an -movflags +faststart -avoid_negative_ts make_zero`,
    ];

    // Modern FFmpeg flag
    try {
      await runCmd([...base, `-fps_mode cfr`, `"${outPath}"`].join(' '), timeoutMs);
      if (fs.existsSync(outPath) && fs.statSync(outPath).size > 10_000) return true;
    } catch (err: any) {
      const isFpsModeError = err.stderr?.includes('fps_mode') || err.message?.includes('fps_mode');
      if (!isFpsModeError) {
        // Log the actual FFmpeg error for debugging
        const stderrSnippet = (err.stderr || err.message || '').slice(-300);
        console.warn(`⚠️ [apify-video] FFmpeg error (${vfFilter.slice(0, 40)}...): ${stderrSnippet}`);
        return false;
      }
      // Legacy flag fallback
      if (fs.existsSync(outPath)) { try { fs.unlinkSync(outPath); } catch {} }
      try {
        await runCmd([...base, `-vsync cfr`, `"${outPath}"`].join(' '), timeoutMs);
        if (fs.existsSync(outPath) && fs.statSync(outPath).size > 10_000) return true;
      } catch (err2: any) {
        const stderrSnippet2 = (err2.stderr || err2.message || '').slice(-300);
        console.warn(`⚠️ [apify-video] FFmpeg legacy fallback error: ${stderrSnippet2}`);
        return false;
      }
    }
    return false;
  };

  /** Re-encode at higher CRF if output is too large (> 20 MB). */
  const applySmallSizeGate = async (buf: Buffer): Promise<Buffer> => {
    if (buf.length <= 20 * 1024 * 1024) return buf;
    const smallPath = outPath.replace('.mp4', '_s.mp4');
    console.warn(`⚠️ [apify-video] Scene ${sceneIndex + 1}: ${(buf.length / 1024 / 1024).toFixed(1)} MB — re-encoding CRF 32...`);
    try {
      await runCmd(
        `"${ffmpegBin}" -y -i "${outPath}" -c:v libx264 -pix_fmt yuv420p -preset fast -crf 32 -an -movflags +faststart "${smallPath}"`,
        15_000
      );
      if (fs.existsSync(smallPath) && fs.statSync(smallPath).size > 5_000) {
        const small = fs.readFileSync(smallPath);
        try { fs.unlinkSync(smallPath); } catch {}
        return small;
      }
    } catch { /* use original */ }
    return buf;
  };

  const readOutput = (): Buffer | null => {
    if (!fs.existsSync(outPath) || fs.statSync(outPath).size < 10_000) return null;
    return fs.readFileSync(outPath);
  };

  // ── TRIM PATH: native video is already long enough ───────────────────────────
  if (actualDuration >= targetDuration - 0.1) {
    const trimDur = targetDuration;
    console.log(`✂️  [apify-video] Scene ${sceneIndex + 1}: trim path → ${trimDur.toFixed(2)}s (converting to 30fps CFR)`);

    // Tier A: OBMC motion-compensated interpolation → best quality, no timeout risk
    if (await tryCmd(
      `minterpolate=fps=30:mi_mode=obmc:scd=none`,
      trimDur, 25_000
    )) {
      const buf = await applySmallSizeGate(readOutput()!);
      cleanup();
      console.log(`✅ [apify-video] Scene ${sceneIndex + 1}: trim (OBMC) → ${(buf.length / 1024).toFixed(0)} KB`);
      return { buffer: buf, reportedDuration: trimDur };
    }

    // Tier B: blend crossfade → smooth, faster fallback
    if (await tryCmd(
      `minterpolate=fps=30:mi_mode=blend:scd=none`,
      trimDur, 18_000
    )) {
      const buf = await applySmallSizeGate(readOutput()!);
      cleanup();
      console.log(`✅ [apify-video] Scene ${sceneIndex + 1}: trim (blend) → ${(buf.length / 1024).toFixed(0)} KB`);
      return { buffer: buf, reportedDuration: trimDur };
    }

    // Tier C: simple fps=30 conversion → always works
    if (await tryCmd(
      `fps=30,setpts=PTS-STARTPTS`,
      trimDur, 10_000
    )) {
      const buf = await applySmallSizeGate(readOutput()!);
      cleanup();
      console.log(`✅ [apify-video] Scene ${sceneIndex + 1}: trim (fps=30) → ${(buf.length / 1024).toFixed(0)} KB`);
      return { buffer: buf, reportedDuration: trimDur };
    }

    console.warn(`⚠️ [apify-video] Scene ${sceneIndex + 1}: all trim tiers failed — falling through to stretch path`);
  }

  // ── STRETCH PATH: native video shorter than scene ─────────────────────────────
  const needed       = targetDuration + 0.6;
  const stretchRatio = needed / actualDuration;
  const ratio        = stretchRatio.toFixed(6);

  console.log(`📐 [apify-video] Scene ${sceneIndex + 1}: stretch → target=${needed.toFixed(2)}s (ratio=${stretchRatio.toFixed(2)}x)`);

  // Pre-built filters (no MCI anywhere)
  // OBMC = Overlapped Block Motion Compensation: real motion-compensated interpolation,
  // smoother than blend, far faster than MCI, no timeout risk even at 4x+ ratios.
  const obmbFilter  = `minterpolate=fps=30:mi_mode=obmc:scd=none,setpts=${ratio}*PTS,tpad=stop=6:stop_mode=clone`;
  const blendFilter = `minterpolate=fps=30:mi_mode=blend:scd=none,setpts=${ratio}*PTS,tpad=stop=6:stop_mode=clone`;
  const setptsFilter = `setpts=${ratio}*PTS,fps=30,tpad=stop=6:stop_mode=clone`;

  const stretchTiers: Array<{ name: string; filter: string; timeout: number }> = [
    // Tier 1: OBMC — motion-compensated, real smooth slow-motion look
    { name: 'OBMC stretch',    filter: obmbFilter,   timeout: 40_000 },
    // Tier 2: blend — smooth temporal average, fast
    { name: 'blend stretch',   filter: blendFilter,  timeout: 25_000 },
    // Tier 3: setpts only — instant, safe, always works
    { name: 'setpts fallback', filter: setptsFilter, timeout: 15_000 },
  ];

  for (const tier of stretchTiers) {
    console.log(`⏳ [apify-video] Scene ${sceneIndex + 1}: trying ${tier.name} (${stretchRatio.toFixed(2)}x)...`);
    if (await tryCmd(tier.filter, needed, tier.timeout)) {
      const buf = await applySmallSizeGate(readOutput()!);
      cleanup();
      console.log(`✅ [apify-video] Scene ${sceneIndex + 1}: ${tier.name} → ${(buf.length / 1024).toFixed(0)} KB`);
      return { buffer: buf, reportedDuration: needed };
    }
    console.warn(`⚠️ [apify-video] Scene ${sceneIndex + 1}: ${tier.name} failed — trying next tier`);
  }

  // All tiers failed — return original unprocessed buffer
  cleanup();
  console.warn(`⚠️ [apify-video] Scene ${sceneIndex + 1}: all FFmpeg tiers failed — returning raw video (native ${actualDuration.toFixed(2)}s)`);
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
