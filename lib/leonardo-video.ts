// ═══════════════════════════════════════════════════════════════════════════════
// Leonardo AI — Kling 2.5 Turbo (Video Generation)
// Text-to-Video & Image-to-Video via Leonardo.AI REST v1 API
// ═══════════════════════════════════════════════════════════════════════════════
import { putWithRotation } from "@/lib/blob";
import os from "os";
import path from "path";
import fs from "fs";
import { exec } from "child_process";

// ── Kling 2.5 Turbo Configuration ──────────────────────────────────────────
// v1 API — separate endpoints for text-to-video and image-to-video
const TEXT_TO_VIDEO_ENDPOINT = "https://cloud.leonardo.ai/api/rest/v1/generations-text-to-video";
const IMAGE_TO_VIDEO_ENDPOINT = "https://cloud.leonardo.ai/api/rest/v1/generations-image-to-video";
const INIT_IMAGE_ENDPOINT = "https://cloud.leonardo.ai/api/rest/v1/init-image";
const POLL_ENDPOINT = "https://cloud.leonardo.ai/api/rest/v1/generations";

// Kling 2.5 model identifier (ALL CAPS required — API rejects mixed-case "Kling2_5")
const KLING_MODEL = "KLING2_5";

// Valid durations for Kling 2.5 Turbo (seconds)
const VALID_DURATIONS = [5, 10] as const;

// 9:16 portrait — matches Shorts/Reels format and Nano Banana 2 images (768×1376 → same ratio)
// Kling RESOLUTION_1080 refers to the SHORT side = 1080px, so 1080×1920 is valid.
const VIDEO_WIDTH  = 1080;
const VIDEO_HEIGHT = 1920;

// ── Anti-text + Motion constraints ────────────────────────────────────────────
// CRITICAL DISCOVERY (from Leonardo API docs):
// Kling 2.5 Turbo via Leonardo ONLY accepts these params:
//   prompt, imageId, imageType, resolution, height, width, duration, model, isPublic, endFrameImage
//
// negativePrompt, motionStrength, frameInterpolation → ALL SILENTLY IGNORED!
// The ONLY lever for controlling motion/quality is the PROMPT TEXT itself.
//
// Therefore we embed ALL constraints directly into the prompt:
//   1. Anti-text suffix (since negativePrompt is ignored)
//   2. Stationary camera trick (forces element animation instead of Ken Burns)
//   3. Scene-description stripping (prevents Kling from confirming the image instead of animating)
const ANTI_TEXT_SUFFIX = ". Absolutely no text, titles, words, writing, captions, labels, or overlays of any kind in any language.";
const STATIONARY_CAMERA_SUFFIX = " Stationary camera, locked tripod, zero camera movement.";

/**
 * Sanitize a prompt for Kling 2.5 Turbo:
 * - Strip scene-description phrases (causes Ken Burns instead of animation)
 * - Strip text-related words
 * - Append stationary camera trick (forces element-level animation)
 * - Append anti-text suffix (since negativePrompt param is ignored by API)
 */
function sanitizePrompt(raw: string, maxLen = 1200): string {
    let clean = raw
        .replace(/\b(text|title|caption|subtitle|label|watermark|logo|word|letter|overlay|heading|banner|sign|writing|inscription|credit|quote|annotation|typography|font)[\w]*\b/gi, '')
        .replace(/\b(the image shows?|in the image|we can see|there is|there are|the scene depicts?|the photo shows?|a photo of|an image of|a picture of)\b/gi, '')
        .replace(/\s+/g, ' ').trim()
        .substring(0, maxLen);
    
    // Add stationary camera if not already present
    if (!/(stationary|locked|tripod|zero camera|no camera|fixed camera)/i.test(clean)) {
        clean += STATIONARY_CAMERA_SUFFIX;
    }
    return clean + ANTI_TEXT_SUFFIX;
}

// ── Leonardo Key Rotation (up to 10 keys) ─────────────────────────────────────

const LEONARDO_KEY_NAMES = [
    "LEONARDO_API_KEY",
    "LEONARDO_API_KEY1",
    "LEONARDO_API_KEY2",
    "LEONARDO_API_KEY3",
    "LEONARDO_API_KEY4",
    "LEONARDO_API_KEY5",
    "LEONARDO_API_KEY6",
    "LEONARDO_API_KEY7",
    "LEONARDO_API_KEY8",
    "LEONARDO_API_KEY9",
];

/** Load all available Leonardo keys from env */
function getKeys(): string[] {
    return LEONARDO_KEY_NAMES
        .map(name => process.env[name])
        .filter((key): key is string => !!key && key.length > 0);
}

/** Get a shuffled copy of keys for round-robin with randomized start (legacy fallback) */
function getShuffledKeys(): { key: string; index: number }[] {
    const keys = getKeys();
    if (keys.length === 0) throw new Error("No LEONARDO_API_KEY found in environment variables");
    return keys
        .map((key, index) => ({ key, index, sort: Math.random() }))
        .sort((a, b) => a.sort - b.sort)
        .map(({ key, index }) => ({ key, index }));
}

// ── Smart Key Rotation — Equal credit distribution across all keys ─────────────
//
// PROBLEM WITH RANDOM SHUFFLE:
//   Random shuffling within each generation can assign the same key to multiple
//   scenes, leaving some keys completely unused. Over many generations, credit
//   consumption is uneven and some keys hit rate limits while others are idle.
//
// SOLUTION — GenerationKeyRotator:
//   1. A process-level global counter (`_globalKeyOffset`) advances by +1 after
//      each generation. This ensures consecutive videos start from DIFFERENT keys.
//   2. Within a single generation, keys are assigned sequentially:
//        Scene 0 → Key[offset+0], Scene 1 → Key[offset+1], Scene 2 → Key[offset+2]...
//      No scene ever reuses the same key as another scene in the same generation.
//   3. On failure, getFallbackKeys() returns the remaining keys in order, skipping
//      the failed primary key to maximize success chances without wasting credits.
//
// RESULT: Each key gets exactly 1 scene per 6-scene generation (when ≥6 keys exist).
// Over time, all keys consume equal credits with no randomness-based skew.

let _globalKeyOffset = 0;   // advances by 1 after each generation

class GenerationKeyRotator {
    private readonly keys: string[];
    private readonly startOffset: number;

    constructor() {
        this.keys = getKeys();
        if (this.keys.length === 0) throw new Error("No LEONARDO_API_KEY found in environment variables");

        // Claim offset for this generation and advance global for the next one
        this.startOffset = _globalKeyOffset % this.keys.length;
        _globalKeyOffset = (_globalKeyOffset + 1) % this.keys.length;

        console.log(`🔑 [KeyRotator] ${this.keys.length} key(s) available. Generation starts at Key #${this.startOffset + 1}. Next generation will start at Key #${(_globalKeyOffset % this.keys.length) + 1}`);
    }

    /**
     * Get the primary (assigned) key for a specific scene.
     * Every scene in this generation gets a UNIQUE key — no repeats.
     * Scene 0 → Key[start], Scene 1 → Key[start+1], Scene 2 → Key[start+2]...
     */
    getPrimaryKey(sceneIndex: number): { key: string; index: number } {
        const idx = (this.startOffset + sceneIndex) % this.keys.length;
        return { key: this.keys[idx], index: idx };
    }

    /**
     * Get fallback keys for retries — all remaining keys EXCEPT the failed primary.
     * Ordered so the next-best candidate (least recently used) is tried first.
     */
    getFallbackKeys(failedIndex: number): { key: string; index: number }[] {
        return Array.from({ length: this.keys.length - 1 }, (_, i) => {
            const idx = (failedIndex + 1 + i) % this.keys.length;
            return { key: this.keys[idx], index: idx };
        });
    }

    /**
     * Get all keys in rotation order starting from the scene's primary key.
     * Used as the full preferred-keys list: primary first, then fallbacks.
     */
    getOrderedKeysForScene(sceneIndex: number): { key: string; index: number }[] {
        const primary = this.getPrimaryKey(sceneIndex);
        return [primary, ...this.getFallbackKeys(primary.index)];
    }
}

// ── Upload Image to Leonardo (required for image-to-video) ───────────────────

/**
 * Upload an image URL to Leonardo AI and get an asset ID for use with Kling img2vid.
 * Uses the presigned URL upload flow:
 *   1. POST /api/rest/v1/init-image → get presigned URL + image ID
 *   2. Upload image bytes to presigned URL
 *   3. Return the image ID
 */
async function uploadImageToLeonardo(
    imageUrl: string,
    apiKey: string
): Promise<string> {
    // Download the image
    const imageRes = await fetch(imageUrl);
    if (!imageRes.ok) throw new Error(`Failed to download image for upload: ${imageRes.status}`);
    const imageBuffer = await imageRes.arrayBuffer();
    const contentType = imageRes.headers.get("content-type") || "image/png";
    const ext = contentType.includes("webp") ? "webp" : contentType.includes("jpeg") || contentType.includes("jpg") ? "jpg" : "png";

    // Step 1: Init image upload
    const initRes = await fetch(INIT_IMAGE_ENDPOINT, {
        method: "POST",
        headers: {
            "accept": "application/json",
            "authorization": `Bearer ${apiKey}`,
            "content-type": "application/json",
        },
        body: JSON.stringify({ extension: ext }),
    });

    if (!initRes.ok) {
        const errText = await initRes.text();
        throw new Error(`Leonardo init-image failed (${initRes.status}): ${errText}`);
    }

    const initData = await initRes.json();
    const uploadUrl = initData?.uploadInitImage?.url;
    const imageId = initData?.uploadInitImage?.id;
    const fields = initData?.uploadInitImage?.fields ? JSON.parse(initData.uploadInitImage.fields) : null;

    if (!uploadUrl || !imageId) {
        throw new Error(`Leonardo init-image response missing url/id: ${JSON.stringify(initData).substring(0, 300)}`);
    }

    // Step 2: Upload image bytes via presigned URL
    if (fields) {
        // Multipart form upload (S3 presigned POST)
        const form = new FormData();
        for (const [key, value] of Object.entries(fields)) {
            form.append(key, value as string);
        }
        form.append("file", new Blob([imageBuffer], { type: contentType }), `upload.${ext}`);

        const uploadRes = await fetch(uploadUrl, { method: "POST", body: form });
        if (!uploadRes.ok && uploadRes.status !== 204) {
            const errText = await uploadRes.text();
            throw new Error(`Leonardo image upload failed (${uploadRes.status}): ${errText}`);
        }
    } else {
        // Direct PUT upload
        const uploadRes = await fetch(uploadUrl, {
            method: "PUT",
            headers: { "Content-Type": contentType },
            body: imageBuffer,
        });
        if (!uploadRes.ok && uploadRes.status !== 200) {
            const errText = await uploadRes.text();
            throw new Error(`Leonardo image upload PUT failed (${uploadRes.status}): ${errText}`);
        }
    }

    console.log(`✅ Image uploaded to Leonardo: ${imageId}`);
    return imageId;
}

// ── Kling 2.5 Turbo Job Submission ─────────────────────────────────────────

/**
 * Clamp duration to nearest valid Kling 2.5 Turbo value (5 or 10 seconds).
 */
function clampDuration(durationSec: number): 5 | 10 {
    return durationSec >= 8 ? 10 : 5;
}

function getFFmpegPath(): string {
    const pkg = 'ffmpeg-static';
    let ffmpegBin = require(pkg) as string;
    if (!fs.existsSync(ffmpegBin)) {
        ffmpegBin = path.join(process.cwd(), 'node_modules', 'ffmpeg-static', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
    }
    return ffmpegBin;
}

async function stretchVideo(videoBuffer: Buffer, targetDuration: number, providedActualDuration: number): Promise<Buffer> {
    const tmpDir = os.tmpdir();
    const randStr = Math.random().toString(36).substring(7);
    const inPath  = path.join(tmpDir, `kling_in_${Date.now()}_${randStr}.mp4`);
    const outPath = path.join(tmpDir, `kling_out_${Date.now()}_${randStr}.mp4`);

    fs.writeFileSync(inPath, videoBuffer);
    const ffmpegBin = getFFmpegPath();

    // ── 1. Probe actual duration from the file ─────────────────────────────
    const probeOutput = await new Promise<string>((resolve) => {
        exec(`"${ffmpegBin}" -i "${inPath}"`, (_err: any, stdout: string, stderr: string) => {
            resolve((stdout || '') + '\n' + (stderr || ''));
        });
    });

    const durationMatch = probeOutput.match(/Duration: (\d{2}):(\d{2}):(\d{2}\.\d+)/);
    let exactActualDuration = providedActualDuration;
    if (durationMatch) {
        exactActualDuration =
            parseInt(durationMatch[1]) * 3600 +
            parseInt(durationMatch[2]) * 60 +
            parseFloat(durationMatch[3]);
        console.log(`📐 Probed video duration: ${exactActualDuration.toFixed(3)}s (Kling clamp was: ${providedActualDuration}s, target: ${targetDuration}s)`);
    }

    // ── 2. Build bulletproof filter chain ────────────────────────────────
    //
    // CRITICAL FIX — Windows-safe, Remotion-safe pipeline:
    //
    //  fps=30                → normalize to exactly 30 CFR BEFORE setpts.
    //                          Without this, VFR Kling clips cause setpts to
    //                          produce irregular PTS jumps that confuse the compositor.
    //
    //  setpts=R*PTS          → slow-motion or speed-up to fill targetDuration.
    //
    //  setpts=PTS-STARTPTS   → RESET PTS to start from 0. This is CRITICAL on Windows:
    //                          the Remotion compositor (Rust/FFmpeg) crashes with
    //                          "No frame found at position N" when the video's first PTS
    //                          is non-zero (common with Kling's output timestamps).
    //
    //  -t TRIM               → hard trim well SHORT of the target duration (0.5s margin).
    //                          This ensures the MP4 file is ALWAYS shorter than what
    //                          Remotion allocates, preventing frame-boundary overruns.
    //
    //  -r 30 -fps_mode cfr   → force constant frame rate. -vsync is deprecated in
    //                          newer FFmpeg; -fps_mode is the modern equivalent.
    //  -g 30                 → insert a keyframe every 30 frames (every 1s).
    //                          Dense keyframes allow reliable seeking to any frame.
    //  libx264 yuv420p       → widest Remotion / browser / FFmpeg compatibility.
    //  -crf 18               → near-lossless quality.
    //  -movflags +faststart  → MP4 index at front for reliable byte-range seeking.
    //  -avoid_negative_ts    → prevent negative timestamps from Kling quirks.
    //  -an                   → strip audio (Kling videos have no audio track).
    //
    //  WHY NO tpad:
    //  tpad with clone mode can produce frames with identical (non-monotonic) PTS
    //  which causes the compositor to fail. Instead, we use a generous 0.5s trim
    //  margin and report 0.5s less than target to Remotion, keeping pbRate ≈ 1.0
    //  and never requesting a frame past the file's last real frame.
    //
    const ratio = targetDuration / exactActualDuration;
    const needsStretch = Math.abs(exactActualDuration - targetDuration) > 0.1;

    // Trim to (targetDuration - 0.5s) — larger safety margin than before.
    // This keeps pbRate ≈ 1.0 once Remotion accounts for the reported duration.
    const TRIM_MARGIN = 0.5;
    const trimPoint = Math.max(1.0, targetDuration - TRIM_MARGIN).toFixed(3);

    let filterChain: string;
    if (needsStretch) {
        console.log(`⏩ Stretching: ${exactActualDuration.toFixed(3)}s → ${targetDuration}s (ratio=${ratio.toFixed(4)}, trim=${trimPoint}s)`);
        filterChain = `fps=30,setpts=${ratio.toFixed(6)}*PTS,setpts=PTS-STARTPTS`;
    } else {
        console.log(`⏩ Normalize only: ${exactActualDuration.toFixed(3)}s → ${targetDuration}s (delta<0.1s, trim=${trimPoint}s)`);
        filterChain = `fps=30,setpts=PTS-STARTPTS`;
    }

    // Try modern -fps_mode flag first; fall back to legacy -vsync if it fails
    // CRF 28: good quality for 9:16 social video at ~8-15 MB per 30s clip.
    // CRF 18 (old) produced 40-50 MB files that hit Appwrite's Varnish 503 backend write-buffer limit.
    const buildCmd = (fpsFlag: string, crf: number = 28) => [
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
    ].join(' ');

    let cmd = buildCmd(`-fps_mode cfr`, 28);
    console.log(`🔧 FFmpeg cmd: ...${cmd.substring(cmd.indexOf('-vf'), cmd.indexOf('-vf') + 120)}...`);

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
        // -fps_mode may not exist in older FFmpeg — fall back to -vsync
        if (e.stderr && e.stderr.includes('fps_mode')) {
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

    // ── 3. Verify output ──────────────────────────────────────────────────
    if (!fs.existsSync(outPath)) {
        throw new Error('FFmpeg produced no output file for stretch');
    }
    let outBuffer = fs.readFileSync(outPath);
    if (outBuffer.length < 5000) {
        throw new Error(`FFmpeg output too small (${outBuffer.length} bytes) — likely a failed encode`);
    }
    console.log(`✅ Stretch complete: ${videoBuffer.length} → ${outBuffer.length} bytes (trimmed to ${trimPoint}s)`);

    // ── 4. Size gate — re-encode at CRF 32 if output is still > 20 MB ────
    // Appwrite's Varnish cache backend throws 503 "backend write error" for files
    // larger than ~30-40 MB. Keep uploads well under that by re-encoding if needed.
    const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20 MB hard cap
    if (outBuffer.length > MAX_UPLOAD_BYTES) {
        console.warn(`⚠️ Output ${(outBuffer.length / 1024 / 1024).toFixed(1)} MB exceeds 20 MB cap — re-encoding at CRF 32 to reduce size...`);
        const reOutPath = outPath.replace('.mp4', '_small.mp4');
        const reCmd = [
            `"${ffmpegBin}"`,
            `-y`,
            `-i "${outPath}"`,
            `-c:v libx264 -pix_fmt yuv420p -preset medium -crf 32`,
            `-an -movflags +faststart`,
            `"${reOutPath}"`,
        ].join(' ');
        try {
            await runFFmpeg(reCmd);
            if (fs.existsSync(reOutPath) && fs.statSync(reOutPath).size > 5000) {
                const reBuffer = fs.readFileSync(reOutPath);
                console.log(`✅ Re-encode complete: ${(outBuffer.length / 1024 / 1024).toFixed(1)} MB → ${(reBuffer.length / 1024 / 1024).toFixed(1)} MB`);
                try { fs.unlinkSync(reOutPath); } catch {}
                outBuffer = reBuffer;
            }
        } catch (reErr: any) {
            console.warn(`⚠️ Size-gate re-encode failed (proceeding with larger file): ${reErr.message?.slice(0, 120)}`);
        }
    }

    try { fs.unlinkSync(inPath);  } catch {}
    try { fs.unlinkSync(outPath); } catch {}

    return outBuffer;
}

/**
 * Submit a Kling 2.5 Turbo image-to-video job via REST v1 API.
 * Uses the dedicated /generations-image-to-video endpoint.
 */
async function submitKlingImg2VidJob(
    prompt: string,
    duration: 5 | 10,
    imageId: string,
    forceApiKey?: string,
): Promise<{ generationId: string; apiKey: string }> {
    // If an image was uploaded with a specific key, we MUST use that same key
    // to submit the generation job, otherwise Leonardo throws a 400 error: 
    // "user <id> does not own START image <id>".
    const keysToTry = forceApiKey ? [{ key: forceApiKey, index: -1 }] : getShuffledKeys();
    const errors: string[] = [];

    for (const { key: apiKey, index: keyIndex } of keysToTry) {
        const keyLabel = keyIndex === -1 ? "Image Owner Key" : `Key #${keyIndex + 1}`;
        
        // When forced to use a specific key, we can't just move to the next key on 429.
        // We must retry a few times before giving up.
        const maxAttempts = forceApiKey ? 3 : 1;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                console.log(`⏳ Submitting Kling 2.5 Turbo img2vid (${keyLabel}, attempt ${attempt})...`);

                // Clean prompt: strip scene-description, add stationary camera + anti-text
                const cleanPrompt = sanitizePrompt(prompt);

                // Kling 2.5 Turbo v1 API — ONLY documented params
                // negativePrompt, motionStrength, frameInterpolation are IGNORED by API
                const requestBody = {
                    prompt: cleanPrompt,
                    imageId: imageId,
                    imageType: "UPLOADED",
                    resolution: "RESOLUTION_1080",
                    height: VIDEO_HEIGHT,
                    width: VIDEO_WIDTH,
                    duration: duration,
                    model: KLING_MODEL,
                    isPublic: false,
                };

                const response = await fetch(IMAGE_TO_VIDEO_ENDPOINT, {
                    method: "POST",
                    headers: {
                        "accept": "application/json",
                        "authorization": `Bearer ${apiKey}`,
                        "content-type": "application/json",
                    },
                    body: JSON.stringify(requestBody),
                });

                if (response.status === 429) {
                    console.warn(`⚠️ ${keyLabel} rate-limited (429).`);
                    if (attempt < maxAttempts) {
                        await new Promise(r => setTimeout(r, 2000 * attempt));
                        continue;
                    } else {
                        errors.push(`${keyLabel}: Rate limited (429)`);
                        break; // Try next key (if not forced)
                    }
                }

                if (!response.ok) {
                    const text = await response.text();
                    console.warn(`⚠️ ${keyLabel} failed (${response.status}): ${text}`);
                    errors.push(`${keyLabel}: ${response.status} - ${text}`);
                    break; // Try next key
                }

                const result = await response.json();
                
                const generationId =
                    result?.motionVideoGenerationJob?.generationId ||
                    result?.sdGenerationJob?.generationId ||
                    result?.generationId;

                if (!generationId) {
                    console.error(`❌ ${keyLabel} — Kling response missing generationId:`, JSON.stringify(result));
                    errors.push(`${keyLabel}: Response missing generationId`);
                    break; // Try next key
                }

                console.log(`✅ Kling img2vid job submitted! ${keyLabel}, id: ${generationId}, duration: ${duration}s`);
                return { generationId, apiKey };
            } catch (e: any) {
                console.warn(`🧨 Error with ${keyLabel}: ${e.message}`);
                errors.push(`${keyLabel}: ${e.message}`);
                break; // Try next key
            }
        }
    }

    throw new Error(`All Leonardo keys failed for Kling img2vid: ${errors.join(", ")}`);
}

/**
 * Fallback flow: Uploads image and submits Kling img2vid job across available keys.
 * Useful when the initial pre-uploaded image key gets a 402 or 429 during job submission.
 */
async function submitKlingImg2VidJobFullFlow(
    originalImageUrl: string,
    prompt: string,
    duration: 5 | 10
): Promise<{ generationId: string; apiKey: string }> {
    const keysToTry = getShuffledKeys();
    const errors: string[] = [];

    for (const { key: apiKey, index: keyIndex } of keysToTry) {
        try {
            console.log(`⏳ [Full Flow] Uploading & Submitting Kling img2vid (Key #${keyIndex + 1})...`);
            
            // Upload image using this specific key
            const imageId = await uploadImageToLeonardo(originalImageUrl, apiKey);

            // Since we just uploaded it with apiKey, we FORCE apiKey
            const { generationId, apiKey: finalKey } = await submitKlingImg2VidJob(prompt, duration, imageId, apiKey);
            return { generationId, apiKey: finalKey };
        } catch (e: any) {
            console.warn(`🧨 [Full Flow] Error with Key #${keyIndex + 1}: ${e.message}`);
            errors.push(`Key #${keyIndex + 1}: ${e.message}`);
            // Loop to the next key
        }
    }
    throw new Error(`All keys failed in full flow fallback: ${errors.join(", ")}`);
}

/**
 * Submit a Kling 2.5 Turbo text-to-video job via REST v1 API.
 * Accepts `preferredKeys` to try in order — primary (rotator-assigned) key first,
 * then fallbacks. Falls back to getShuffledKeys() if not provided.
 */
async function submitKlingTxt2VidJob(
    prompt: string,
    duration: 5 | 10,
    preferredKeys?: { key: string; index: number }[],
): Promise<{ generationId: string; apiKey: string }> {
    // Use rotator-assigned key order if provided, otherwise fall back to shuffle
    const keysToTry = (preferredKeys && preferredKeys.length > 0) ? preferredKeys : getShuffledKeys();
    const errors: string[] = [];

    for (const { key: apiKey, index: keyIndex } of keysToTry) {
        const keyLabel = `Key #${keyIndex + 1}`;
        try {
            console.log(`⏳ Submitting Kling 2.5 Turbo txt2vid (${keyLabel})...`);

            // Clean prompt: strip scene-description, add stationary camera + anti-text
            const cleanPrompt = sanitizePrompt(prompt);

            // Kling 2.5 Turbo v1 API — ONLY documented params
            // negativePrompt, motionStrength, frameInterpolation are IGNORED by API
            const requestBody = {
                prompt: cleanPrompt,
                duration: duration,
                model: KLING_MODEL,
                height: VIDEO_HEIGHT,
                width: VIDEO_WIDTH,
                resolution: "RESOLUTION_1080",
                isPublic: false,
            };

            console.log(`📤 Kling txt2vid request (${keyLabel}): ${JSON.stringify(requestBody).substring(0, 400)}`);

            const response = await fetch(TEXT_TO_VIDEO_ENDPOINT, {
                method: "POST",
                headers: {
                    "accept": "application/json",
                    "authorization": `Bearer ${apiKey}`,
                    "content-type": "application/json",
                },
                body: JSON.stringify(requestBody),
            });

            if (response.status === 429) {
                console.warn(`⚠️ ${keyLabel} rate-limited (429). Trying next key...`);
                errors.push(`${keyLabel}: Rate limited (429)`);
                await new Promise(r => setTimeout(r, 1000));
                continue;
            }

            if (!response.ok) {
                const text = await response.text();
                console.warn(`⚠️ ${keyLabel} failed (${response.status}): ${text}`);
                errors.push(`${keyLabel}: ${response.status} - ${text}`);
                await new Promise(r => setTimeout(r, 1000));
                continue;
            }

            const result = await response.json();
            console.log(`📦 Kling txt2vid raw response: ${JSON.stringify(result).substring(0, 400)}`);

            // Kling v1 API response shape
            const generationId =
                result?.motionVideoGenerationJob?.generationId ||
                result?.sdGenerationJob?.generationId ||
                result?.generationId;

            if (!generationId) {
                console.error(`❌ ${keyLabel} — Kling txt2vid response missing generationId:`, JSON.stringify(result));
                errors.push(`${keyLabel}: Response missing generationId`);
                continue;
            }

            console.log(`✅ Kling txt2vid job submitted! ${keyLabel}, id: ${generationId}, duration: ${duration}s`);
            return { generationId, apiKey };
        } catch (e: any) {
            console.warn(`🧨 Error with ${keyLabel}: ${e.message}`);
            errors.push(`${keyLabel}: ${e.message}`);
        }
    }

    throw new Error(`All Leonardo keys failed for Kling txt2vid: ${errors.join(", ")}`);
}

// ── Poll for Kling Result (Optimized Exponential Backoff) ──────────────────

/**
 * Poll Leonardo v1 status endpoint for a Kling 2.5 generation result.
 *
 * Kling takes significantly longer than LTX (2-10 minutes vs 30 seconds).
 * Uses exponential backoff polling to balance speed vs API load:
 *   - First 3 polls: 5s interval   (catch fast completions)
 *   - Next 5 polls:  8s interval   (normal generation time)
 *   - Next 10 polls: 12s interval  (longer generations)
 *   - Beyond: 15s interval          (very long generations)
 *
 * Max total wait: ~20 minutes
 */
async function pollKlingJob(
    generationId: string,
    apiKey: string,
    maxAttempts: number = 80
): Promise<{ url: string; type: "video" | "image" }> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        // Exponential backoff intervals
        let pollInterval: number;
        if (attempt < 3) pollInterval = 5000;       // First 15s: check every 5s
        else if (attempt < 8) pollInterval = 8000;   // Next 40s: check every 8s
        else if (attempt < 18) pollInterval = 12000;  // Next 2 min: check every 12s
        else pollInterval = 15000;                     // Beyond: check every 15s

        await new Promise(resolve => setTimeout(resolve, pollInterval));

        try {
            const statusResponse = await fetch(
                `${POLL_ENDPOINT}/${generationId}`,
                {
                    headers: {
                        "accept": "application/json",
                        "authorization": `Bearer ${apiKey}`,
                    },
                }
            );

            if (statusResponse.status === 429) {
                console.warn(`⚠️ Kling polling rate-limited, waiting 10s...`);
                await new Promise(resolve => setTimeout(resolve, 10000));
                continue;
            }

            if (!statusResponse.ok) {
                const errorText = await statusResponse.text();
                // 404 early on is normal for Kling jobs that take time to register
                if (statusResponse.status === 404 && attempt < 15) {
                    console.log(`  [Poll #${attempt + 1}] Kling job not registered yet (404)...`);
                    await new Promise(resolve => setTimeout(resolve, 5000));
                    continue;
                }
                throw new Error(`Kling status check failed (${statusResponse.status}): ${errorText}`);
            }

            const statusResult = await statusResponse.json();
            const generation = statusResult?.generations_by_pk;
            const status = generation?.status;

            // Log every 3rd poll to keep user informed about Kling's progress
            if (attempt % 3 === 0) {
                const elapsedSec = getElapsedSeconds(attempt);
                console.log(`  [Poll #${attempt + 1}] Kling: status = ${status} (~${elapsedSec}s elapsed)`);
            }

            if (status === "COMPLETE") {
                // Check for video output first (Kling always produces video)
                const videos = generation?.generated_images?.filter((i: any) => i.motionMP4URL);
                if (videos && videos.length > 0) {
                    return { url: videos[0].motionMP4URL, type: "video" };
                }

                // Fallback to regular image URL
                const images = generation?.generated_images;
                if (images && images.length > 0) {
                    const videoUrl = images[0].motionMP4URL || images[0].url;
                    return { url: videoUrl, type: images[0].motionMP4URL ? "video" : "image" };
                }

                throw new Error(`Kling job complete but no output found: ${JSON.stringify(statusResult).substring(0, 500)}`);
            }

            if (status === "FAILED") {
                throw new Error(`Kling job failed: ${JSON.stringify(statusResult).substring(0, 500)}`);
            }

        } catch (error: any) {
            if (error.message.includes("429")) {
                await new Promise(resolve => setTimeout(resolve, 10000));
                continue;
            }
            throw error;
        }
    }

    throw new Error(`Kling job ${generationId} timed out after ${maxAttempts} poll attempts`);
}

/** Helper: estimate elapsed seconds based on poll attempt number and backoff schedule */
function getElapsedSeconds(attempt: number): number {
    let elapsed = 0;
    for (let i = 0; i < attempt; i++) {
        if (i < 3) elapsed += 5;
        else if (i < 8) elapsed += 8;
        else if (i < 18) elapsed += 12;
        else elapsed += 15;
    }
    return elapsed;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PARALLEL SCENE GENERATION (dramatically reduces wall-clock time)
// ═══════════════════════════════════════════════════════════════════════════════

interface SceneJob {
    sceneIndex: number;
    generationId: string;
    apiKey: string;
    type: "img2vid" | "txt2vid";
}

/**
 * Submit multiple Kling jobs concurrently with controlled concurrency.
 * Accepts a `rotator` so each scene uses its pre-assigned key first.
 * Returns an array of submitted jobs ready for parallel polling.
 */
async function submitKlingJobsBatch(
    scenes: Array<{
        index: number;
        mode: "img2vid" | "txt2vid";
        prompt: string;
        imageId?: string;
        duration: 5 | 10;
        uploadKey?: string;
        originalImageUrl?: string;
    }>,
    concurrency: number = 3,
    rotator?: GenerationKeyRotator,
): Promise<SceneJob[]> {
    const jobs: SceneJob[] = [];
    const errors: string[] = [];

    // Process scenes in batches of `concurrency`
    for (let batchStart = 0; batchStart < scenes.length; batchStart += concurrency) {
        const batch = scenes.slice(batchStart, batchStart + concurrency);

        const batchResults = await Promise.allSettled(
            batch.map(async (scene) => {
                if (scene.mode === "img2vid" && scene.imageId) {
                    try {
                        const { generationId, apiKey } = await submitKlingImg2VidJob(
                            scene.prompt,
                            scene.duration,
                            scene.imageId,
                            scene.uploadKey, 
                        );
                        return { sceneIndex: scene.index, generationId, apiKey, type: "img2vid" as const };
                    } catch (e: any) {
                        // FALLBACK FOR 402 (token exhaustion)
                        if (scene.originalImageUrl) {
                            console.warn(`♻️ Scene ${scene.index + 1} initial submission failed, falling back to full flow across all keys...`);
                            const { generationId, apiKey } = await submitKlingImg2VidJobFullFlow(
                                scene.originalImageUrl, scene.prompt, scene.duration
                            );
                            return { sceneIndex: scene.index, generationId, apiKey, type: "img2vid" as const };
                        }
                        throw e;
                    }
                } else {
                    // txt2vid: use rotator-assigned key order if available
                    const preferredKeys = rotator
                        ? rotator.getOrderedKeysForScene(scene.index)
                        : undefined;
                    const { generationId, apiKey } = await submitKlingTxt2VidJob(
                        scene.prompt,
                        scene.duration,
                        preferredKeys,
                    );
                    return { sceneIndex: scene.index, generationId, apiKey, type: "txt2vid" as const };
                }
            })
        );

        for (let i = 0; i < batchResults.length; i++) {
            const result = batchResults[i];
            const scene = batch[i];
            if (result.status === "fulfilled") {
                jobs.push(result.value);
            } else {
                console.error(`❌ Scene ${scene.index + 1} job submission failed: ${result.reason?.message}`);
                errors.push(`Scene ${scene.index + 1}: ${result.reason?.message}`);
            }
        }

        // Brief pause between batches to avoid rate limits
        if (batchStart + concurrency < scenes.length) {
            await new Promise(r => setTimeout(r, 2000));
        }
    }

    if (jobs.length === 0 && errors.length > 0) {
        throw new Error(`All Kling scene submissions failed: ${errors.join("; ")}`);
    }

    console.log(`✅ Submitted ${jobs.length}/${scenes.length} Kling jobs for parallel processing`);
    return jobs;
}

/**
 * Poll all Kling jobs in parallel, returning results as they complete.
 * This dramatically reduces total wall-clock time compared to sequential polling.
 */
async function pollKlingJobsParallel(
    jobs: SceneJob[],
): Promise<Map<number, { url: string; type: "video" | "image" }>> {
    const results = new Map<number, { url: string; type: "video" | "image" }>();

    const pollResults = await Promise.allSettled(
        jobs.map(async (job) => {
            const result = await pollKlingJob(job.generationId, job.apiKey);
            console.log(`✅ Scene ${job.sceneIndex + 1} Kling ${job.type} complete: ${result.url.substring(0, 60)}...`);
            return { sceneIndex: job.sceneIndex, ...result };
        })
    );

    for (const result of pollResults) {
        if (result.status === "fulfilled") {
            results.set(result.value.sceneIndex, {
                url: result.value.url,
                type: result.value.type,
            });
        } else {
            console.error(`❌ A Kling poll failed: ${result.reason?.message}`);
        }
    }

    return results;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Generate a video from an image using Kling 2.5 Turbo (Image-to-Video).
 * Uploads the image to Leonardo → submits Kling job → polls → persists to Blob.
 *
 * @param imageUrl      - URL of the source image
 * @param videoPrompt   - Description of how the image should animate
 * @param durationSec   - Desired duration in seconds (will be clamped to 5 or 10)
 * @param seriesId      - Series ID for file organization
 * @param sceneIndex    - Scene index for file naming
 * @returns             - { videoUrl, thumbnailUrl, actualDurationSec }
 */
export async function generateLeonardoVideo(
    imageUrl: string,
    videoPrompt: string,
    durationSec: number,
    seriesId: string,
    sceneIndex: number
): Promise<{ videoUrl: string; thumbnailUrl: string; actualDurationSec: number }> {
    const duration = clampDuration(durationSec);

    console.log(`🎬 Kling 2.5 Turbo img2vid: Scene ${sceneIndex + 1} | ${VIDEO_WIDTH}x${VIDEO_HEIGHT} | ${duration}s`);
    console.log(`   Prompt: "${videoPrompt.substring(0, 100)}..."`);

    // Step 1 & 2: Upload image & Submit Kling job (with fallback across keys if one fails / 402s)
    const { generationId, apiKey } = await submitKlingImg2VidJobFullFlow(imageUrl, videoPrompt, duration);

    // Step 3: Poll for result (exponential backoff optimized for Kling)
    const result = await pollKlingJob(generationId, apiKey);
    console.log(`✅ Kling video ready: ${result.url.substring(0, 80)}...`);

    // Step 4: Download and upload to Vercel Blob for permanent storage
    const videoRes = await fetch(result.url);
    if (!videoRes.ok) throw new Error(`Failed to download Kling video: ${videoRes.status}`);

    let videoBuffer: any = Buffer.from(new Uint8Array(await videoRes.arrayBuffer()));
    
    // Stretch to target duration
    const TRIM_MARGIN = 0.5;
    let stretchSucceeded = false;
    try {
        videoBuffer = await stretchVideo(videoBuffer, durationSec, duration);
        stretchSucceeded = true;
    } catch (err: any) {
        console.warn(`⚠️ Failed to stretch video, using original:`, err.message);
    }
    
    const filename = `shorts/${seriesId}/scene_${sceneIndex}_kling_${Date.now()}.mp4`;

    const blob = await putWithRotation(filename, videoBuffer, {
        access: "public",
        contentType: "video/mp4",
    });

    // Report conservative duration: 0.5s less than target when stretch succeeded
    // so Remotion never requests frames past the trimmed file's end.
    const reportedDuration = stretchSucceeded
        ? Math.max(1.0, durationSec - TRIM_MARGIN)
        : duration; // raw Kling duration — Remotion slow-motions it

    console.log(`✅ Scene ${sceneIndex + 1} Kling video uploaded (reported=${reportedDuration.toFixed(2)}s): ${blob.url}`);

    return {
        videoUrl: blob.url,
        thumbnailUrl: imageUrl || "",
        actualDurationSec: reportedDuration,
    };
}

/**
 * Generate a video from text only (no source image) using Kling 2.5 Turbo.
 *
 * @param prompt        - Text description for the video
 * @param durationSec   - Desired duration in seconds (will be clamped to 5 or 10)
 * @param seriesId      - Series ID for file organization
 * @param sceneIndex    - Scene index for file naming
 * @returns             - { videoUrl, thumbnailUrl, actualDurationSec }
 */
export async function generateLeonardoTextVideo(
    prompt: string,
    durationSec: number,
    seriesId: string,
    sceneIndex: number
): Promise<{ videoUrl: string; thumbnailUrl: string; actualDurationSec: number }> {
    const duration = clampDuration(durationSec);

    console.log(`🎬 Kling 2.5 Turbo txt2vid: Scene ${sceneIndex + 1} | ${VIDEO_WIDTH}x${VIDEO_HEIGHT} | ${duration}s`);

    // Submit Kling text-to-video job
    const { generationId, apiKey } = await submitKlingTxt2VidJob(prompt, duration);

    // Poll for result (exponential backoff optimized for Kling)
    const result = await pollKlingJob(generationId, apiKey);
    console.log(`✅ Kling text video ready: ${result.url.substring(0, 80)}...`);

    // Download and upload to Vercel Blob
    const videoRes = await fetch(result.url);
    if (!videoRes.ok) throw new Error(`Failed to download Kling video: ${videoRes.status}`);

    let videoBuffer: any = Buffer.from(await videoRes.arrayBuffer() as ArrayBuffer);

    // Stretch to target duration
    const TRIM_MARGIN = 0.5;
    let stretchSucceeded = false;
    try {
        videoBuffer = await stretchVideo(videoBuffer, durationSec, duration);
        stretchSucceeded = true;
    } catch (err: any) {
        console.warn(`⚠️ Failed to stretch text video, using original:`, err.message);
    }

    const filename = `shorts/${seriesId}/scene_${sceneIndex}_kling_txt_${Date.now()}.mp4`;

    const blob = await putWithRotation(filename, videoBuffer, {
        access: "public",
        contentType: "video/mp4"
    });

    // Report conservative duration: 0.5s less than target when stretch succeeded
    const reportedDuration = stretchSucceeded
        ? Math.max(1.0, durationSec - TRIM_MARGIN)
        : duration; // raw Kling duration — Remotion slow-motions it

    console.log(`✅ Scene ${sceneIndex + 1} Kling text video uploaded (reported=${reportedDuration.toFixed(2)}s): ${blob.url}`);

    return {
        videoUrl: blob.url,
        thumbnailUrl: "",
        actualDurationSec: reportedDuration,
    };
}

/**
 * Generate multiple scene videos in parallel using Kling 2.5 Turbo.
 * Submits all jobs concurrently (with controlled concurrency), then polls in parallel.
 * This dramatically reduces total wall-clock time vs sequential generation.
 *
 * @param scenes  - Array of scene configs with prompt, imageUrl (optional), duration
 * @param seriesId - Series ID for file naming
 * @returns       - Map of sceneIndex → { videoUrl, thumbnailUrl, actualDurationSec }
 */
export async function generateKlingScenesParallel(
    scenes: Array<{
        index: number;
        prompt: string;
        imageUrl?: string;     // If provided, uses img2vid; otherwise txt2vid
        imageId?: string;      // Pre-uploaded Leonardo image ID (skip upload if provided)
        duration: number;
    }>,
    seriesId: string,
): Promise<Map<number, { videoUrl: string; thumbnailUrl: string; actualDurationSec: number }>> {
    console.log(`🚀 Starting parallel Kling 2.5 Turbo generation for ${scenes.length} scenes...`);

    // Create ONE rotator for this entire generation.
    // Each scene gets a UNIQUE, pre-assigned key — no key is used twice.
    // The global offset advances after this call so the NEXT video generation
    // starts from a different key, distributing credits equally over time.
    const rotator = new GenerationKeyRotator();

    // Step 1: Upload images for img2vid scenes — each scene uses its rotator-assigned key
    const preparedScenes: Array<{
        index: number;
        mode: "img2vid" | "txt2vid";
        prompt: string;
        imageId?: string;
        duration: 5 | 10;
        originalImageUrl?: string;
        uploadKey?: string; // Stored per scene to guarantee matching keys
    }> = [];

    const uploadPromises = scenes.map(async (scene, i) => {
        const duration = clampDuration(scene.duration);
        // Each scene uploads with its rotationally assigned key.
        // This guarantees: Scene 0 → Key[offset+0], Scene 1 → Key[offset+1]...
        // No two scenes in the same generation share the same primary key.
        const { key: uploadKey, index: uploadKeyIndex } = rotator.getPrimaryKey(i);
        console.log(`🔑 Scene ${scene.index + 1} assigned Key #${uploadKeyIndex + 1}`);

        if (scene.imageUrl && scene.imageUrl !== "SKIP_T2V" && scene.imageUrl !== "SKIP_VEO" && scene.imageUrl !== "") {
            // Need to upload image first
            let imageId = scene.imageId;
            if (!imageId) {
                try {
                    imageId = await uploadImageToLeonardo(scene.imageUrl, uploadKey);
                } catch (err: any) {
                    console.warn(`⚠️ Scene ${scene.index + 1}: Image upload failed, falling back to txt2vid: ${err.message}`);
                    return { index: scene.index, mode: "txt2vid" as const, prompt: scene.prompt, duration, originalImageUrl: scene.imageUrl };
                }
            }
            return { index: scene.index, mode: "img2vid" as const, prompt: scene.prompt, imageId, duration, originalImageUrl: scene.imageUrl, uploadKey };
        } else {
            return { index: scene.index, mode: "txt2vid" as const, prompt: scene.prompt, duration, uploadKey: undefined };
        }
    });

    const uploadResults = await Promise.allSettled(uploadPromises);
    for (const result of uploadResults) {
        if (result.status === "fulfilled") {
            preparedScenes.push(result.value);
        }
    }

    // Step 2: Submit all Kling jobs — rotator ensures txt2vid scenes also
    // use their pre-assigned key first, with ordered fallbacks on failure
    const jobs = await submitKlingJobsBatch(preparedScenes, 3, rotator);

    // Step 3: Poll all jobs in parallel
    const pollResults = await pollKlingJobsParallel(jobs);

    // Step 4: Download all completed videos and upload to Blob (sequentially to prevent overwhelming the local network stack)
    const finalResults = new Map<number, { videoUrl: string; thumbnailUrl: string; actualDurationSec: number }>();

    for (const [sceneIndex, result] of Array.from(pollResults.entries())) {
        try {
            const videoRes = await fetch(result.url);
            if (!videoRes.ok) throw new Error(`Failed to download Kling video: ${videoRes.status}`);

            let videoBuffer: Buffer = Buffer.from(new Uint8Array(await videoRes.arrayBuffer()));

            const scene = preparedScenes.find(s => s.index === sceneIndex);

            // ── BUG FIX: use the ORIGINAL (un-clamped) scene duration as the stretch target.
            // preparedScenes.duration is CLAMPED to 5 or 10 (Kling limits).
            // We need the original scene target (e.g. 15s) from the input `scenes` array.
            const originalScene       = scenes.find(s => s.index === sceneIndex);
            const targetDurationSec   = originalScene?.duration ?? scene?.duration ?? 5;  // original (e.g. 15s)
            const klingDurationSec    = scene?.duration ?? 5;                             // clamped (5 or 10s)

            console.log(`🎯 Scene ${sceneIndex + 1}: target=${targetDurationSec}s, Kling produced≈${klingDurationSec}s`);

            // Stretch Kling video to fill the full scene target duration
            let stretchSucceeded = false;
            try {
                videoBuffer = await stretchVideo(videoBuffer, targetDurationSec, klingDurationSec);
                stretchSucceeded = true;
            } catch (err: any) {
                console.warn(`⚠️ Stretch failed for scene ${sceneIndex + 1} — using original ${klingDurationSec}s clip. Remotion will slow-motion it. Error: ${err.message}`);
            }

            const mode = scene?.mode === 'img2vid' ? 'kling' : 'kling_txt';
            const filename = `shorts/${seriesId}/scene_${sceneIndex}_${mode}_${Date.now()}.mp4`;

            console.log(`⏳ Uploading scene ${sceneIndex + 1} to Appwrite...`);
            const blob = await putWithRotation(filename, videoBuffer, {
                access: 'public',
                contentType: 'video/mp4',
            });

            // ── Report a CONSERVATIVE duration (target - 0.5s) ──────────────────────
            // The stretchVideo now trims to exactly (targetDuration - 0.5s).
            // We tell Remotion the file is that length so pbRate = file/scene ≈ 1.0
            // which keeps us well within the actual video content.
            // If stretch FAILED (using raw Kling clip): report klingDurationSec so
            // Remotion's 0.96x pbRate correctly slow-motions the short clip.
            const REPORTED_TRIM_MARGIN = 0.5;
            const reportedDurationSec = stretchSucceeded
                ? Math.max(1.0, targetDurationSec - REPORTED_TRIM_MARGIN)  // matches FFmpeg -t trim
                : klingDurationSec;                                          // Remotion slow-motion handles it

            finalResults.set(sceneIndex, {
                videoUrl: blob.url,
                thumbnailUrl: scene?.originalImageUrl || '',
                actualDurationSec: reportedDurationSec,
            });

            console.log(`✅ Scene ${sceneIndex + 1} uploaded (reported=${reportedDurationSec.toFixed(2)}s, target=${targetDurationSec}s): ${blob.url.substring(0, 60)}...`);
            
            // Allow TCP sockets to cool down on Windows to prevent UND_ERR_CONNECT_TIMEOUT
            await new Promise(r => setTimeout(r, 1000));
        } catch (err: any) {
            console.error(`❌ Scene ${sceneIndex + 1} download/upload failed: ${err.message}`);
        }
    }

    console.log(`🏁 Parallel Kling generation complete: ${finalResults.size}/${scenes.length} scenes ready`);
    return finalResults;
}
