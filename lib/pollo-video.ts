/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * Pollo AI Client — Seedance 1.5 Pro Mapping
 * Key rotation: POLLO_API_KEY, POLLO_API_KEY_2, POLLO_API_KEY_3, ...
 * Appwrite upload: via putWithRotation (lib/blob)
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { putWithRotation } from "@/lib/blob";
import os from "os";
import path from "path";
import fs from "fs";
import { exec } from "child_process";

const BASE_URL = "https://pollo.ai/api/platform";

// ─── Key helpers ─────────────────────────────────────────────────────────────

/** Read all available Pollo API keys from env at call time. */
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
    return (
        b.includes("insufficient") ||
        b.includes("credit") ||
        b.includes("quota") ||
        b.includes("limit") ||
        b.includes("unauthorized") ||
        b.includes("invalid key")
    );
}

function makeHeaders(apiKey: string): Record<string, string> {
    return {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
    };
}

// ─── Status endpoint discovery ───────────────────────────────────────────────

// Global cached index for status endpoint discovery
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

// ─── Core submit + poll (with key rotation) ──────────────────────────────────

/**
 * Submit a Pollo video task with key rotation.
 * Returns { taskId, apiKey } — the key that succeeded is reused for polling.
 */
async function submitPolloVideoTask(
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
                    console.warn(`⚠️ [pollo-video] [${keyLabel}] quota/auth error (${res.status}) — rotating key...`);
                    lastErr = errText;
                    continue;
                }
                throw new Error(`Pollo video submit failed (${res.status}): ${errText}`);
            }

            const data = await res.json();
            const taskId = data?.data?.taskId || data?.taskId;
            if (!taskId) throw new Error(`Pollo video response missing taskId: ${JSON.stringify(data)}`);

            if (ki > 0) console.log(`✅ [pollo-video] Succeeded with [${keyLabel}] after key rotation.`);
            return { taskId, apiKey };
        } catch (e: any) {
            const isQuota = /401|402|429|quota|credit|limit|unauthorized/i.test(e.message);
            if (isQuota && ki < keys.length - 1) {
                console.warn(`⚠️ [pollo-video] [${keyLabel}] error (rotating): ${e.message.slice(0, 80)}`);
                lastErr = e.message;
                continue;
            }
            throw e;
        }
    }
    throw new Error(`Pollo video: all ${keys.length} key(s) exhausted. Last error: ${lastErr}`);
}

/**
 * Poll a Pollo video task until it completes. Returns the output video URL.
 */
async function pollPolloVideoTask(
    taskId: string,
    apiKey: string,
    maxWaitMs = 10 * 60 * 1000,
    interval = 5000
): Promise<string> {
    const workingUrl = await getStatusUrl(taskId, apiKey);
    const headers = makeHeaders(apiKey);
    const start = Date.now();

    while (Date.now() - start < maxWaitMs) {
        await new Promise((r) => setTimeout(r, interval));

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
            console.warn(`⚠️ [pollo-video] Polling error: ${e.message}`);
        }
    }
    throw new Error(`Pollo video timed out waiting for task ${taskId}`);
}

// ─── FFmpeg helpers ───────────────────────────────────────────────────────────

function getFFmpegPath(): string {
    try {
        const bin = require("ffmpeg-static") as string | null;
        if (bin && fs.existsSync(bin)) return bin;
    } catch {}

    const localBin = path.join(
        process.cwd(),
        "node_modules",
        "ffmpeg-static",
        process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg"
    );
    if (fs.existsSync(localBin)) return localBin;

    const systemPaths = ["/usr/bin/ffmpeg", "/usr/local/bin/ffmpeg"];
    for (const p of systemPaths) {
        if (fs.existsSync(p)) return p;
    }
    return "ffmpeg";
}

async function stretchVideo(
    videoBuffer: Buffer,
    targetDuration: number,
    providedActualDuration: number
): Promise<Buffer> {
    const tmpDir = os.tmpdir();
    const randStr = Math.random().toString(36).substring(7);
    const inPath  = path.join(tmpDir, `seedance_in_${Date.now()}_${randStr}.mp4`);
    const outPath = path.join(tmpDir, `seedance_out_${Date.now()}_${randStr}.mp4`);

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
            parseInt(durationMatch[2]) * 60 +
            parseFloat(durationMatch[3]);
        console.log(
            `📐 Probed video duration: ${exactActualDuration.toFixed(3)}s (Seedance target: ${targetDuration}s)`
        );
    }

    const ratio = targetDuration / exactActualDuration;
    const needsStretch = Math.abs(exactActualDuration - targetDuration) > 0.1;

    const TRIM_MARGIN = 0.5;
    const trimPoint = Math.max(1.0, targetDuration - TRIM_MARGIN).toFixed(3);

    let filterChain: string;
    if (needsStretch) {
        console.log(
            `⏩ Stretching: ${exactActualDuration.toFixed(3)}s → ${targetDuration}s (ratio=${ratio.toFixed(4)}, trim=${trimPoint}s)`
        );
        filterChain = `fps=30,setpts=${ratio.toFixed(6)}*PTS,setpts=PTS-STARTPTS`;
    } else {
        console.log(
            `⏩ Normalize only: ${exactActualDuration.toFixed(3)}s → ${targetDuration}s (delta<0.1s, trim=${trimPoint}s)`
        );
        filterChain = `fps=30,setpts=PTS-STARTPTS`;
    }

    const buildCmd = (fpsFlag: string, crf: number = 28) =>
        [
            `"${ffmpegBin}"`,
            `-y`,
            `-ss 0`,
            `-i "${inPath}"`,
            `-vf "${filterChain}"`,
            `-t ${trimPoint}`,
            `-r 30`,
            fpsFlag,
            `-g 30`,
            `-c:v libx264`,
            `-pix_fmt yuv420p`,
            `-preset medium`,
            `-crf ${crf}`,
            `-an`,
            `-movflags +faststart`,
            `-avoid_negative_ts make_zero`,
            `"${outPath}"`,
        ].join(" ");

    let cmd = buildCmd(`-fps_mode cfr`, 28);
    console.log(`🔧 FFmpeg cmd: ...${cmd.substring(cmd.indexOf("-vf"), cmd.indexOf("-vf") + 120)}...`);

    const runFFmpeg = (command: string): Promise<void> =>
        new Promise<void>((resolve, reject) => {
            exec(command, { maxBuffer: 50 * 1024 * 1024 }, (err: any, _stdout: string, stderr: string) => {
                if (err) reject({ err, stderr });
                else resolve();
            });
        });

    try {
        await runFFmpeg(cmd);
    } catch (e: any) {
        if (e.stderr && e.stderr.includes("fps_mode")) {
            console.warn(`⚠️ -fps_mode not supported, retrying with legacy -vsync cfr...`);
            cmd = buildCmd(`-vsync cfr`, 28);
            try {
                await runFFmpeg(cmd);
            } catch (e2: any) {
                console.error(`❌ FFmpeg stretch failed:\n${e2.stderr?.slice(-500)}`);
                throw new Error(`FFmpeg stretch failed: ${e2.stderr?.slice(-200)}`);
            }
        } else {
            console.error(`❌ FFmpeg stretch failed:\n${e.stderr?.slice(-500)}`);
            throw new Error(`FFmpeg stretch failed: ${e.stderr?.slice(-200)}`);
        }
    }

    if (!fs.existsSync(outPath)) throw new Error("FFmpeg produced no output file for stretch");

    let outBuffer = fs.readFileSync(outPath);
    const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
    if (outBuffer.length > MAX_UPLOAD_BYTES) {
        console.warn(
            `⚠️ Output ${(outBuffer.length / 1024 / 1024).toFixed(1)} MB exceeds 20 MB cap — re-encoding at CRF 32...`
        );
        const reOutPath = outPath.replace(".mp4", "_small.mp4");
        const reCmd = [
            `"${ffmpegBin}"`,
            `-y`,
            `-i "${outPath}"`,
            `-c:v libx264 -pix_fmt yuv420p -preset medium -crf 32`,
            `-an -movflags +faststart`,
            `"${reOutPath}"`,
        ].join(" ");
        try {
            await runFFmpeg(reCmd);
            if (fs.existsSync(reOutPath) && fs.statSync(reOutPath).size > 5000) {
                const reBuffer = fs.readFileSync(reOutPath);
                try { fs.unlinkSync(reOutPath); } catch {}
                outBuffer = reBuffer;
            }
        } catch (reErr: any) {
            console.warn(`⚠️ Size-gate re-encode failed: ${reErr.message}`);
        }
    }

    try { fs.unlinkSync(inPath);  } catch {}
    try { fs.unlinkSync(outPath); } catch {}

    return outBuffer;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Generate a video using Seedance 1.5 Pro (with key rotation).
 * Downloads, FFmpeg-stretches, then uploads to Appwrite via putWithRotation.
 */
export async function generateSeedanceVideo(
    imageUrl: string | undefined,
    prompt: string,
    durationSec: number,
    seriesId: string,
    sceneIndex: number,
    aspectRatio: "9:16" | "16:9" | "1:1" = "9:16"
): Promise<{ videoUrl: string; thumbnailUrl: string; actualDurationSec: number }> {
    console.log(
        `🎬 [pollo-video] Seedance 1.5 Pro img2vid/txt2vid: Scene ${sceneIndex + 1} | ${aspectRatio} | ${durationSec}s`
    );

    const input: Record<string, any> = {
        prompt,
        resolution: "480p", // 1 credit for 5 seconds duration
        length: 5,
        aspectRatio,
        cameraFixed: false,
        generateAudio: false,
    };

    if (imageUrl && imageUrl !== "SKIP_T2V" && imageUrl !== "SKIP_VEO" && imageUrl !== "") {
        input.image = imageUrl;
    }

    // Submit with key rotation
    const { taskId, apiKey } = await submitPolloVideoTask(
        { input },
        "/generation/bytedance/seedance-1-5-pro"
    );
    console.log(`✅ [pollo-video] Created task: ${taskId}. Polling...`);

    // Poll until complete
    const finalVideoUrl = await pollPolloVideoTask(taskId, apiKey);

    console.log(`✅ [pollo-video] Video ready: ${finalVideoUrl}. Downloading and processing...`);

    // Download video
    const videoRes = await fetch(finalVideoUrl);
    if (!videoRes.ok) throw new Error(`Failed to download Pollo video: ${videoRes.status}`);
    let videoBuffer: any = Buffer.from(new Uint8Array(await videoRes.arrayBuffer()));

    // Stretch to target duration via FFmpeg
    const TRIM_MARGIN = 0.5;
    let stretchSucceeded = false;
    try {
        videoBuffer = await stretchVideo(videoBuffer, durationSec, 5);
        stretchSucceeded = true;
    } catch (err: any) {
        console.warn(`⚠️ Failed to stretch video, using original:`, err.message);
    }

    // ── Upload to Appwrite via putWithRotation ────────────────────────────────
    const filename = `shorts/${seriesId}/scene_${sceneIndex}_pollo_${Date.now()}.mp4`;
    const blob = await putWithRotation(filename, videoBuffer, {
        access: "public",
        contentType: "video/mp4",
    });

    const reportedDuration = stretchSucceeded ? Math.max(1.0, durationSec - TRIM_MARGIN) : 5;

    console.log(
        `✅ Scene ${sceneIndex + 1} Pollo video uploaded to Appwrite (reported=${reportedDuration.toFixed(2)}s): ${blob.url}`
    );

    return {
        videoUrl: blob.url,
        thumbnailUrl: imageUrl || "",
        actualDurationSec: reportedDuration,
    };
}

/**
 * Generate multiple scene videos in parallel using Pollo Seedance 1.5 Pro.
 */
export async function generateKlingScenesParallel(
    scenes: Array<{
        index: number;
        prompt: string;
        imageUrl?: string;
        imageId?: string; // maps to imageUrl in Pollo
        duration: number;
    }>,
    seriesId: string
): Promise<Map<number, { videoUrl: string; thumbnailUrl: string; actualDurationSec: number }>> {
    console.log(`🚀 Starting parallel Pollo Seedance 1.5 Pro generation for ${scenes.length} scenes...`);
    const finalResults = new Map<
        number,
        { videoUrl: string; thumbnailUrl: string; actualDurationSec: number }
    >();

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
    console.log(
        `🏁 Parallel Seedance generation complete: ${finalResults.size}/${scenes.length} scenes ready`
    );
    return finalResults;
}
