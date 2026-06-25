/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * WaveSpeed AI — Video Generation Client
 * Model: bytedance/seedance-v1.5-pro (Image-to-Video, 480p, $0.06/5s)
 * Key rotation: WAVESPEED_API_KEY, WAVESPEED_API_KEY_2 … WAVESPEED_API_KEY_6
 *
 * Drop-in replacement for lib/pollo-video.ts.
 * All exported function names and signatures are identical.
 *
 * Pipeline per video:
 *   1. Upload image to Appwrite → public URL (WaveSpeed requires a URL, not base64)
 *   2. POST to WaveSpeed API → get prediction ID
 *   3. Poll prediction status until "completed"
 *   4. Download video → FFmpeg stretch to target duration → upload to Appwrite blob
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { putWithRotation } from "@/lib/blob";
import { Client, Storage, ID } from "node-appwrite";
import { InputFile } from "node-appwrite/file";
import os   from "os";
import path from "path";
import fs   from "fs";
import { exec } from "child_process";

const WAVESPEED_I2V_URL   = "https://api.wavespeed.ai/api/v3/bytedance/seedance-v1.5-pro/image-to-video";
const WAVESPEED_T2V_URL   = "https://api.wavespeed.ai/api/v3/bytedance/seedance-v1.5-pro/text-to-video";
const WAVESPEED_POLL_BASE = "https://api.wavespeed.ai/api/v3/predictions";
const VIDEO_RESOLUTION    = "480p";  // $0.06 per 5s clip (no audio)

// ─── Key helpers ─────────────────────────────────────────────────────────────

function getWaveSpeedKeys(): string[] {
    const keys: string[] = [];
    if (process.env.WAVESPEED_API_KEY) keys.push(process.env.WAVESPEED_API_KEY);
    for (let i = 2; i <= 6; i++) {
        const k = process.env[`WAVESPEED_API_KEY_${i}`];
        if (k) keys.push(k);
    }
    if (keys.length === 0) throw new Error("[wavespeed-video] No WAVESPEED_API_KEY configured");
    return keys;
}

function isWaveSpeedQuotaError(status: number, body: string): boolean {
    if ([401, 402, 429].includes(status)) return true;
    const b = body.toLowerCase();
    return b.includes("insufficient") || b.includes("credit") || b.includes("quota") ||
           b.includes("limit")        || b.includes("unauthorized");
}

// ─── Step 1: Upload image to Appwrite → public URL ────────────────────────────
//
// WaveSpeed requires a directly-viewable HTTP URL.
// We upload the image to Appwrite storage (same project as blob.ts) and return
// its public view URL. Uses the same env vars as lib/blob.ts.

async function uploadImageToAppwrite(imageUrl: string): Promise<string> {
    // If it's already an Appwrite URL, use it directly — no re-upload needed
    if (imageUrl.includes("appwrite.io") || imageUrl.includes("cloud.appwrite.io")) {
        return imageUrl;
    }

    // Resolve Appwrite config using the same env var priority as blob.ts
    const endpoint  = (process.env.APPWRITE_VIDEO_ENDPOINT  || process.env.APPWRITE_ENDPOINT  || "").replace(/\/$/, "");
    const projectId = process.env.APPWRITE_VIDEO_PROJECT_ID  || process.env.APPWRITE_PROJECT_ID  || "";
    const apiKey    = process.env.APPWRITE_VIDEO_API_KEY     || process.env.APPWRITE_API_KEY     || "";
    const bucketId  = process.env.APPWRITE_VIDEO_BUCKET_ID   || process.env.APPWRITE_BUCKET_ID   || "";

    if (!endpoint || !projectId || !apiKey || !bucketId) {
        // Appwrite not configured — pass the URL through and hope WaveSpeed can reach it
        console.warn("[wavespeed-video] Appwrite not fully configured — passing image URL directly to WaveSpeed");
        return imageUrl;
    }

    console.log(`☁️ [wavespeed-video] Pre-uploading image to Appwrite for public URL...`);

    // Download the source image
    // Use manual timeout — AbortSignal.timeout() breaks on older Node.js/Vercel runtimes
    const imgController = new AbortController();
    const imgTimer = setTimeout(() => imgController.abort(), 60_000);
    let imgRes: Response;
    try {
        imgRes = await fetch(imageUrl, { signal: imgController.signal });
    } finally {
        clearTimeout(imgTimer);
    }
    if (!imgRes.ok) throw new Error(`[wavespeed-video] Cannot download image for Appwrite upload: HTTP ${imgRes.status}`);

    const imgBuffer = Buffer.from(await imgRes.arrayBuffer());
    const mime      = imgRes.headers.get("content-type") || "image/jpeg";
    const ext       = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
    const fileId    = ID.unique();
    const filename  = `wavespeed-src-${fileId}.${ext}`;

    const client  = new Client().setEndpoint(endpoint).setProject(projectId).setKey(apiKey);
    const storage = new Storage(client);

    await storage.createFile({
        bucketId,
        fileId,
        file: InputFile.fromBuffer(imgBuffer, filename),
    } as any);

    const publicUrl = `${endpoint}/storage/buckets/${bucketId}/files/${fileId}/view?project=${projectId}`;
    console.log(`✅ [wavespeed-video] Image pre-uploaded → ${publicUrl.slice(0, 80)}...`);
    return publicUrl;
}

// ─── Step 2: Submit WaveSpeed video job ──────────────────────────────────────

interface WaveSpeedSubmitResult {
    predictionId: string;
    apiKey: string;
}

async function submitWaveSpeedJob(
    imageUrl: string | undefined,
    prompt:   string,
    aspectRatio: "9:16" | "16:9" | "1:1"
): Promise<WaveSpeedSubmitResult> {
    const keys = getWaveSpeedKeys();
    let lastErr = "";

    const isTextToVideo = !imageUrl;
    const submitUrl = isTextToVideo ? WAVESPEED_T2V_URL : WAVESPEED_I2V_URL;

    for (let ki = 0; ki < keys.length; ki++) {
        const apiKey   = keys[ki];
        const keyLabel = ki === 0 ? "primary" : `key_${ki + 1}`;
        try {
            const bodyParams: any = {
                prompt,
                duration:       5,
                resolution:     VIDEO_RESOLUTION,
                aspect_ratio:   aspectRatio,
                generate_audio: false,
                camera_fixed:   false,
                seed:           -1,
            };
            if (!isTextToVideo) {
                bodyParams.image = imageUrl;
            }

            const res = await fetch(submitUrl, {
                method:  "POST",
                headers: {
                    "Content-Type":  "application/json",
                    "Authorization": `Bearer ${apiKey}`,
                },
                body: JSON.stringify(bodyParams),
            });

            if (!res.ok) {
                const errText = await res.text().catch(() => res.statusText);
                if (isWaveSpeedQuotaError(res.status, errText) && ki < keys.length - 1) {
                    console.warn(`⚠️ [wavespeed-video] [${keyLabel}] quota/auth error (${res.status}) — rotating key...`);
                    lastErr = errText;
                    continue;
                }
                throw new Error(`[wavespeed-video] Submit failed (${res.status}): ${errText.slice(0, 200)}`);
            }

            const data = await res.json() as any;
            if (data.code !== 200) {
                const msg = data.message || JSON.stringify(data);
                if (isWaveSpeedQuotaError(res.status, msg) && ki < keys.length - 1) {
                    console.warn(`⚠️ [wavespeed-video] [${keyLabel}] quota in body — rotating...`);
                    lastErr = msg;
                    continue;
                }
                throw new Error(`[wavespeed-video] API error: ${msg}`);
            }

            const predictionId = data?.data?.id;
            if (!predictionId) throw new Error(`[wavespeed-video] No prediction ID in response: ${JSON.stringify(data)}`);

            if (ki > 0) console.log(`✅ [wavespeed-video] Succeeded with [${keyLabel}] after key rotation`);
            return { predictionId, apiKey };

        } catch (e: any) {
            const isQuota = /401|402|429|quota|credit|limit|unauthorized/i.test(e.message);
            if (isQuota && ki < keys.length - 1) {
                console.warn(`⚠️ [wavespeed-video] [${keyLabel}] error (rotating): ${e.message.slice(0, 80)}`);
                lastErr = e.message;
                continue;
            }
            throw e;
        }
    }
    throw new Error(`[wavespeed-video] All ${keys.length} key(s) exhausted. Last error: ${lastErr}`);
}

// ─── Step 3: Poll prediction until complete ───────────────────────────────────

async function pollWaveSpeedPrediction(
    predictionId: string,
    apiKey:       string,
    maxWaitMs:    number = 10 * 60 * 1000,
    intervalMs:   number = 5000
): Promise<string> {
    const pollUrl = `${WAVESPEED_POLL_BASE}/${predictionId}/result`;
    const headers = { "Authorization": `Bearer ${apiKey}` };
    const start   = Date.now();

    while (Date.now() - start < maxWaitMs) {
        await new Promise((r) => setTimeout(r, intervalMs));

        try {
            const res  = await fetch(pollUrl, { headers });
            if (!res.ok) { continue; }

            const data   = await res.json() as any;
            const status = data?.data?.status ?? "unknown";

            console.log(`⏳ [wavespeed-video] ${predictionId.slice(0, 10)}... status: ${status}`);

            if (status === "completed") {
                const videoUrl = data?.data?.outputs?.[0];
                if (!videoUrl) throw new Error(`[wavespeed-video] Completed but no output URL`);
                return videoUrl as string;
            }
            if (status === "failed") {
                throw new Error(`[wavespeed-video] Prediction failed: ${data?.data?.error || "unknown error"}`);
            }
            // status: "created" | "processing" → keep polling
        } catch (e: any) {
            if (e.message?.includes("failed") || e.message?.includes("no output")) throw e;
            console.warn(`⚠️ [wavespeed-video] Poll error: ${e.message}`);
        }
    }
    throw new Error(`[wavespeed-video] Timed out polling prediction ${predictionId}`);
}

// ─── FFmpeg helpers (identical to pollo-video.ts) ───────────────

function getFFmpegPath(): string {
    try {
        const bin = require("ffmpeg-static") as string | null;
        if (bin && fs.existsSync(bin)) return bin;
    } catch {}

    const localBin = path.join(
        process.cwd(), "node_modules", "ffmpeg-static",
        process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg"
    );
    if (fs.existsSync(localBin)) return localBin;

    for (const p of ["/usr/bin/ffmpeg", "/usr/local/bin/ffmpeg"]) {
        if (fs.existsSync(p)) return p;
    }
    return "ffmpeg";
}

async function stretchVideo(
    videoBuffer:            Buffer,
    targetDuration:         number,
    providedActualDuration: number
): Promise<Buffer> {
    const tmpDir  = os.tmpdir();
    const randStr = Math.random().toString(36).substring(7);
    const inPath  = path.join(tmpDir, `wavespeed_in_${Date.now()}_${randStr}.mp4`);
    const outPath = path.join(tmpDir, `wavespeed_out_${Date.now()}_${randStr}.mp4`);

    fs.writeFileSync(inPath, videoBuffer);
    const ffmpegBin = getFFmpegPath();

    const probeOutput = await new Promise<string>((resolve) => {
        exec(`"${ffmpegBin}" -i "${inPath}"`, (_err: any, stdout: string, stderr: string) => {
            resolve((stdout || "") + "\n" + (stderr || ""));
        });
    });

    const durationMatch = probeOutput.match(/Duration: (\d{2}):(\d{2}):(\d{2}\.\d+)/);
    let exactActualDuration = providedActualDuration;
    if (durationMatch) {
        exactActualDuration =
            parseInt(durationMatch[1]) * 3600 +
            parseInt(durationMatch[2]) * 60  +
            parseFloat(durationMatch[3]);
        console.log(`📐 [wavespeed-video] Probed duration: ${exactActualDuration.toFixed(3)}s → target: ${targetDuration}s`);
    }

    const ratio        = targetDuration / exactActualDuration;
    const needsStretch = Math.abs(exactActualDuration - targetDuration) > 0.1;
    const TRIM_MARGIN  = 0.5;
    const trimPoint    = Math.max(1.0, targetDuration - TRIM_MARGIN).toFixed(3);

    if (needsStretch) {
        console.log(`⏩ [wavespeed-video] Smooth-stretching: ${exactActualDuration.toFixed(3)}s → ${targetDuration}s (ratio=${ratio.toFixed(4)})`);
    }

    const runFFmpeg = (command: string): Promise<void> =>
        new Promise<void>((resolve, reject) => {
            exec(command, { maxBuffer: 50 * 1024 * 1024 }, (err: any, _stdout: string, stderr: string) => {
                if (err) reject({ err, stderr });
                else resolve();
            });
        });

    // ─── Build smooth filter chain ──────────────────────────────────────────
    //
    // 3-Tier frame interpolation strategy for smooth slow-motion:
    //
    // TIER 1 — minterpolate MCI + AOBMC (best quality)
    //   Generates true in-between frames using bidirectional optical-flow
    //   motion compensation. Upsample to 120fps first so the stretch ratio
    //   never exceeds 4x on any single frame pair, then downsample to 30fps.
    //   Result: cinema-quality smooth slow motion, zero jerking.
    //
    // TIER 2 — minterpolate blend (frame blending)
    //   When MCI fails (complex scene / motion too fast for optical-flow),
    //   blend adjacent frames together. Slightly softer/dreamlike but
    //   completely jerk-free.
    //
    // TIER 3 — setpts only (timestamp fallback)
    //   Last resort: pure timestamp stretching. No new frames created, but
    //   at least the output is correctly timed. Jerkiness may appear on
    //   very low source framerates, but is always stable.

    const outputFps   = 30;
    const interpFps   = 120;   // high-fps pool to sample smooth frames from
    const ratioStr    = ratio.toFixed(6);

    // ── tier filters ──────────────────────────────────────────────────────
    const tier1Filter = needsStretch
        // Step 1: interpolate up to 120fps using motion-compensated optical flow
        // Step 2: stretch timestamps across target duration
        // Step 3: downsample to 30fps CFR output
        ? `minterpolate=fps=${interpFps}:mi_mode=mci:me_mode=bidir:mc_mode=aobmc:scd=none,setpts=${ratioStr}*PTS,setpts=PTS-STARTPTS,fps=${outputFps}`
        : `fps=${outputFps},setpts=PTS-STARTPTS`;

    const tier2Filter = needsStretch
        // Frame blending: smooth but no optical flow (safer on complex motion)
        ? `minterpolate=fps=${interpFps}:mi_mode=blend:scd=none,setpts=${ratioStr}*PTS,setpts=PTS-STARTPTS,fps=${outputFps}`
        : `fps=${outputFps},setpts=PTS-STARTPTS`;

    const tier3Filter = needsStretch
        // Pure timestamp stretch — always works, may show judder on low-fps input
        ? `fps=${outputFps},setpts=${ratioStr}*PTS,setpts=PTS-STARTPTS`
        : `fps=${outputFps},setpts=PTS-STARTPTS`;

    // ── command builder ───────────────────────────────────────────────────
    const buildCmd = (filter: string, fpsFlag: string, crf = 23) =>
        [
            `"${ffmpegBin}"`, `-y`, `-i "${inPath}"`,
            `-vf "${filter}"`, `-t ${trimPoint}`,
            `-r ${outputFps}`, fpsFlag, `-g ${outputFps}`,
            `-c:v libx264`, `-pix_fmt yuv420p`, `-preset fast`, `-crf ${crf}`,
            `-an`, `-movflags +faststart`, `-avoid_negative_ts make_zero`,
            `"${outPath}"`,
        ].join(" ");

    // ── tier execution loop ───────────────────────────────────────────────
    const tiers = [
        { name: "MCI optical-flow (tier 1)",  filter: tier1Filter },
        { name: "frame-blend (tier 2)",        filter: tier2Filter },
        { name: "setpts timestamp (tier 3)",   filter: tier3Filter },
    ];

    let succeeded = false;

    for (const tier of tiers) {
        // Try both modern & legacy fps-mode flags per tier
        for (const fpsFlag of [`-fps_mode cfr`, `-vsync cfr`]) {
            const cmd = buildCmd(tier.filter, fpsFlag, 23);
            console.log(`🎞️  [wavespeed-video] ${tier.name} (${fpsFlag}): ${exactActualDuration.toFixed(2)}s → ${targetDuration}s`);
            try {
                await runFFmpeg(cmd);
                if (fs.existsSync(outPath) && fs.statSync(outPath).size > 5000) {
                    console.log(`✅ [wavespeed-video] Smooth stretch succeeded with ${tier.name}`);
                    succeeded = true;
                    break;
                }
            } catch (e: any) {
                const stderr: string = e.stderr || e.err?.message || "";
                if (stderr.includes("fps_mode") || stderr.includes("vsync")) {
                    // Flag not recognized in this FFmpeg build — try the other flag
                    continue;
                }
                // Real FFmpeg error for this tier — move to next tier
                console.warn(`⚠️  [wavespeed-video] ${tier.name} failed: ${stderr.slice(0, 150)}`);
                break;
            }
        }
        if (succeeded) break;
    }

    if (!succeeded) throw new Error("FFmpeg stretch failed with all filter strategies");

    let outBuffer = fs.readFileSync(outPath);
    const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
    if (outBuffer.length > MAX_UPLOAD_BYTES) {
        console.warn(`⚠️ Output ${(outBuffer.length / 1024 / 1024).toFixed(1)} MB > 20 MB — re-encoding at CRF 32...`);
        const reOutPath = outPath.replace(".mp4", "_small.mp4");
        try {
            await runFFmpeg(`"${ffmpegBin}" -y -i "${outPath}" -c:v libx264 -pix_fmt yuv420p -preset medium -crf 32 -an -movflags +faststart "${reOutPath}"`);
            if (fs.existsSync(reOutPath) && fs.statSync(reOutPath).size > 5000) {
                outBuffer = fs.readFileSync(reOutPath);
                try { fs.unlinkSync(reOutPath); } catch {}
            }
        } catch {}
    }

    try { fs.unlinkSync(inPath);  } catch {}
    try { fs.unlinkSync(outPath); } catch {}

    return outBuffer;
}

// ─── Public API (identical function names to lib/pollo-video.ts) ──────────────

/**
 * Full end-to-end: image URL → WaveSpeed video → Appwrite blob URL.
 * Used by Studio (img-to-video route) and parallel generation.
 */
export async function generateSeedanceVideo(
    imageUrl:    string | undefined,
    prompt:      string,
    durationSec: number,
    seriesId:    string,
    sceneIndex:  number,
    aspectRatio: "9:16" | "16:9" | "1:1" = "9:16"
): Promise<{ videoUrl: string; thumbnailUrl: string; actualDurationSec: number }> {
    const isT2V = !imageUrl || imageUrl === "SKIP_T2V" || imageUrl === "SKIP_VEO" || imageUrl === "";
    console.log(`🎬 [wavespeed-video] Seedance V1.5 Pro ${isT2V ? "T2V" : "I2V"}: Scene ${sceneIndex + 1} | ${aspectRatio} | ${durationSec}s`);

    let publicImageUrl: string | undefined;

    if (!isT2V) {
        publicImageUrl = await uploadImageToAppwrite(imageUrl!);
    }

    // Submit job with key rotation (publicImageUrl is undefined for T2V)
    const { predictionId, apiKey } = await submitWaveSpeedJob(publicImageUrl, prompt, aspectRatio);

    console.log(`✅ [wavespeed-video] Submitted prediction: ${predictionId}`);

    // Poll until complete
    const rawVideoUrl = await pollWaveSpeedPrediction(predictionId, apiKey);
    console.log(`✅ [wavespeed-video] Video ready: ${rawVideoUrl.slice(0, 80)}...`);

    // Download, FFmpeg-stretch, upload to Appwrite
    const videoRes = await fetch(rawVideoUrl);
    if (!videoRes.ok) throw new Error(`[wavespeed-video] Failed to download video: ${videoRes.status}`);
    let videoBuffer: Buffer = Buffer.from(new Uint8Array(await videoRes.arrayBuffer()));

    const TRIM_MARGIN = 0.5;
    let stretchSucceeded = false;
    try {
        videoBuffer = await stretchVideo(videoBuffer, durationSec, 5);
        stretchSucceeded = true;
    } catch (err: any) {
        console.warn(`⚠️ [wavespeed-video] Stretch failed, using original: ${err.message}`);
    }

    const filename = `shorts/${seriesId}/scene_${sceneIndex}_wavespeed_${Date.now()}.mp4`;
    const blob = await putWithRotation(filename, videoBuffer, {
        access: "public",
        contentType: "video/mp4",
    });

    const reportedDuration = stretchSucceeded ? Math.max(1.0, durationSec - TRIM_MARGIN) : 5;
    console.log(`✅ Scene ${sceneIndex + 1} uploaded (${reportedDuration.toFixed(2)}s): ${blob.url}`);

    return {
        videoUrl:        blob.url,
        thumbnailUrl:    imageUrl || "",
        actualDurationSec: reportedDuration,
    };
}

/**
 * Generate multiple scenes in parallel — used by Studio parallel mode.
 */
export async function generateKlingScenesParallel(
    scenes: Array<{
        index:     number;
        prompt:    string;
        imageUrl?: string;
        imageId?:  string;
        duration:  number;
    }>,
    seriesId: string
): Promise<Map<number, { videoUrl: string; thumbnailUrl: string; actualDurationSec: number }>> {
    console.log(`🚀 [wavespeed-video] Parallel Seedance I2V for ${scenes.length} scenes...`);
    const finalResults = new Map<number, { videoUrl: string; thumbnailUrl: string; actualDurationSec: number }>();

    const promises = scenes.map(async (scene) => {
        try {
            const result = await generateSeedanceVideo(
                scene.imageUrl || scene.imageId,
                scene.prompt,
                scene.duration,
                seriesId,
                scene.index,
                "9:16"
            );
            finalResults.set(scene.index, result);
        } catch (err: any) {
            console.error(`❌ Scene ${scene.index + 1} generation failed: ${err.message}`);
        }
    });

    await Promise.allSettled(promises);
    console.log(`🏁 [wavespeed-video] Parallel done: ${finalResults.size}/${scenes.length} scenes ready`);
    return finalResults;
}

// ─── Submit-only + Single-check + Process (Inngest step pattern) ──────────────
//
// The Inngest pipeline uses a 3-step async pattern:
//   1. submitSeedanceVideoTask()       → submit job, return {taskId, apiKey}
//   2. checkPolloVideoTaskStatus()     → poll once, return status
//   3. processSeedanceVideoResult()    → download + stretch + upload
//
// We map these to WaveSpeed's prediction ID / polling API.
// taskId = predictionId (WaveSpeed)
// apiKey = the WaveSpeed key used for submission (for polling auth)

/**
 * Submit a WaveSpeed video task WITHOUT polling.
 * Returns { taskId: predictionId, apiKey } for use in Inngest sleep-poll steps.
 */
export async function submitSeedanceVideoTask(
    imageUrl:    string | undefined,
    prompt:      string,
    aspectRatio: "9:16" | "16:9" | "1:1" = "9:16"
): Promise<{ taskId: string; apiKey: string }> {
    const isT2V = !imageUrl || imageUrl === "SKIP_T2V" || imageUrl === "SKIP_VEO" || imageUrl === "";

    let publicImageUrl: string | undefined;
    if (!isT2V) {
        // Upload image to Appwrite to get a public URL
        publicImageUrl = await uploadImageToAppwrite(imageUrl!);
    }

    // Submit to WaveSpeed with key rotation (no polling)
    const { predictionId, apiKey } = await submitWaveSpeedJob(publicImageUrl, prompt, aspectRatio);

    console.log(`🚀 [wavespeed-video] Submitted prediction: ${predictionId}`);

    return { taskId: predictionId, apiKey };
}

/**
 * Single lightweight status check for a WaveSpeed prediction — no polling loop.
 * Used inside Inngest check-round steps after sleeping.
 */
export async function checkPolloVideoTaskStatus(
    taskId:  string,
    apiKey:  string
): Promise<{ status: "complete" | "failed" | "pending"; url?: string }> {
    try {
        const pollUrl = `${WAVESPEED_POLL_BASE}/${taskId}/result`;
        const res     = await fetch(pollUrl, { headers: { "Authorization": `Bearer ${apiKey}` } });
        if (!res.ok) return { status: "pending" };

        const data   = await res.json() as any;
        const status = data?.data?.status ?? "unknown";

        if (status === "completed") {
            const url = data?.data?.outputs?.[0];
            if (url) return { status: "complete", url };
        }
        if (status === "failed") return { status: "failed" };
        return { status: "pending" };
    } catch {
        return { status: "pending" };
    }
}

/**
 * Process a finished WaveSpeed video: download raw URL → FFmpeg stretch → upload to Appwrite.
 * Run this in its own Inngest step.run so each scene gets a separate 60s execution window.
 */
export async function processSeedanceVideoResult(
    rawVideoUrl: string,
    imageUrl:    string | undefined,
    durationSec: number,
    seriesId:    string,
    sceneIndex:  number
): Promise<{ videoUrl: string; thumbnailUrl: string; actualDurationSec: number }> {
    console.log(`📥 [wavespeed-video] Processing scene ${sceneIndex + 1}: ${rawVideoUrl.slice(0, 60)}...`);

    const videoRes = await fetch(rawVideoUrl);
    if (!videoRes.ok) throw new Error(`[wavespeed-video] Failed to download video: ${videoRes.status}`);
    let videoBuffer: Buffer = Buffer.from(new Uint8Array(await videoRes.arrayBuffer()));

    const TRIM_MARGIN = 0.5;
    let stretchSucceeded = false;
    try {
        videoBuffer = await stretchVideo(videoBuffer, durationSec, 5);
        stretchSucceeded = true;
    } catch (err: any) {
        console.warn(`⚠️ [wavespeed-video] stretchVideo failed for scene ${sceneIndex + 1}: ${err.message}`);
    }

    const filename = `shorts/${seriesId}/scene_${sceneIndex}_wavespeed_${Date.now()}.mp4`;
    const blob = await putWithRotation(filename, videoBuffer, {
        access:      "public",
        contentType: "video/mp4",
    });

    const reportedDuration = stretchSucceeded ? Math.max(1.0, durationSec - TRIM_MARGIN) : 5;
    console.log(`✅ Scene ${sceneIndex + 1} processed & uploaded (${reportedDuration.toFixed(2)}s): ${blob.url}`);

    return {
        videoUrl:          blob.url,
        thumbnailUrl:      imageUrl || "",
        actualDurationSec: reportedDuration,
    };
}
