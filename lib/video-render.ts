// ─── PASTE THIS into lib/video-render.ts (replace the renderLocally function) ───
// Key fixes:
// 1. Avatar videos are re-encoded to a SEPARATE file (not in-place) before Remotion sees them
// 2. Split-screen JSON payloads are properly parsed and URLs rewritten
// 3. prepVideoForRemotion uses a dedicated output path instead of atomic rename (Windows-safe)
// 4. Public dir copy is skipped — avatars are downloaded fresh from local path

import { db } from "@/config/db";
import { shortVideoAssets, shortVideoSeries, motionGraphicProjects, motionGraphicMessages } from "@/config/schema";
import { generateNanoBananaImage } from "@/lib/apify-image";
import { eq } from "drizzle-orm";
import { exec } from "child_process";
import path from "path";
import fs from "fs";

function getFFmpegPath(): string {
    const pkg = 'ffmpeg-static';
    let ffmpegBin = require(pkg) as string;
    if (!fs.existsSync(ffmpegBin)) {
        ffmpegBin = path.join(process.cwd(), 'node_modules', 'ffmpeg-static', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
    }
    return ffmpegBin;
}

/**
 * Re-encode a video file to all-keyframe CFR into a NEW output path.
 * Returns the path of the prepared file (different from input — Windows-safe).
 * Never modifies the source file.
 */
async function prepVideoToNewPath(srcPath: string, destPath: string): Promise<boolean> {
    if (!fs.existsSync(srcPath)) {
        console.warn(`⚠️ prepVideoToNewPath: source not found: ${srcPath}`);
        return false;
    }

    // ── Always re-encode from source — never skip based on mtime. ──────────────
    // A stale _prepped.mp4 (from a previous render without tpad, or from a
    // truncated download) must NEVER be reused. Re-encoding is the only way to
    // guarantee the 6-frame tpad safety buffer is always present.
    if (fs.existsSync(destPath)) {
        try { fs.unlinkSync(destPath); } catch { }
    }

    const ffmpegBin = getFFmpegPath();

    // Probe actual duration first — we'll use it to set a safe -t trim.
    // Trim 2.0s from end: the Remotion Rust compositor can fail seeking to
    // the very last decodable frame due to container/PTS rounding errors.
    // A 2.0s margin ensures the SAFETY_MARGIN_SEC in Composition.tsx (3.0s)
    // always keeps seek positions well within the physical video length.
    const probedDur = await probeVideoDuration(srcPath);
    // Adaptive end-trim: remove only min(0.5s, 5% of duration) to avoid
    // PTS rounding errors at the tail WITHOUT losing meaningful content on
    const cmd = [
        `"${ffmpegBin}"`,
        `-y`,
        `-i "${srcPath}"`,
        `-vf "tpad=stop=6:stop_mode=clone"`,  // 6 cloned boundary frames → any seek at EOF always valid
        `-c:v libx264`,
        `-preset fast`,
        `-crf 18`,
        `-g 1`,                       // every frame = keyframe
        `-keyint_min 1`,
        `-sc_threshold 0`,
        `-bf 0`,
        `-pix_fmt yuv420p`,
        `-r 30`,
        `-fps_mode cfr`,
        `-an`,
        `-video_track_timescale 30`,   // tbn=30 → PTS are integers 0,1,2,...
        `-movflags +faststart`,         // floor(time*30) always hits an exact PTS
        `-avoid_negative_ts make_zero`,
        `"${destPath}"`,
    ].filter(Boolean).join(' ');

    return new Promise<boolean>((resolve) => {
        exec(cmd, { maxBuffer: 50 * 1024 * 1024 }, (err, _stdout, stderr) => {
            if (err) {
                // Try legacy -vsync flag if -fps_mode not supported
                if (stderr?.includes('fps_mode')) {
                    const cmdLegacy = cmd.replace('-fps_mode cfr', '-vsync cfr');
                    exec(cmdLegacy, { maxBuffer: 50 * 1024 * 1024 }, (err2, _s2, stderr2) => {
                        if (err2) {
                            console.warn(`⚠️ prepVideoToNewPath failed for ${path.basename(srcPath)}: ${stderr2?.slice(-200)}`);
                            resolve(false);
                        } else {
                            const sizeMB = fs.existsSync(destPath)
                                ? (fs.statSync(destPath).size / 1024 / 1024).toFixed(1)
                                : '?';
                            console.log(`✅ Prepped (legacy) ${path.basename(srcPath)} → ${path.basename(destPath)} (${sizeMB} MB)`);
                            resolve(true);
                        }
                    });
                } else {
                    console.warn(`⚠️ prepVideoToNewPath failed for ${path.basename(srcPath)}: ${stderr?.slice(-200)}`);
                    resolve(false);
                }
            } else {
                const sizeMB = fs.existsSync(destPath)
                    ? (fs.statSync(destPath).size / 1024 / 1024).toFixed(1)
                    : '?';
                // Log any warnings from stderr even on success (helps detect silent tpad failures)
                if (stderr && stderr.length > 0) {
                    const warnings = stderr.split('\n').filter((l: string) => l.includes('Error') || l.includes('error') || l.includes('tpad') || l.includes('filter'));
                    if (warnings.length > 0) {
                        console.warn(`⚠️ prepVideoToNewPath stderr for ${path.basename(srcPath)}:\n${warnings.slice(0, 5).join('\n')}`);
                    }
                }
                // Validate output file is large enough (< 1KB → definitely corrupt/empty)
                if (fs.existsSync(destPath) && fs.statSync(destPath).size < 1024) {
                    console.warn(`⚠️ Prepped file suspiciously small (${fs.statSync(destPath).size} bytes), may be corrupt`);
                    resolve(false);
                    return;
                }
                console.log(`✅ Prepped ${path.basename(srcPath)} → ${path.basename(destPath)} (${sizeMB} MB)`);
                resolve(true);
            }
        });
    });
}

/**
 * In-place re-encode for downloaded scene videos.
 * Uses the SAME robust encoding as prepVideoToNewPath:
 * all-keyframe, CFR 30fps, trimmed end, no B-frames.
 * Writes to a _prepped temp file, then attempts atomic rename.
 */
async function prepVideoForRemotion(filePath: string): Promise<void> {
    if (!fs.existsSync(filePath)) return;

    const ffmpegBin = getFFmpegPath();
    const tmpOutput = filePath.replace('.mp4', '_prepped.mp4');

    const cmd = [
        `"${ffmpegBin}"`,
        `-y`,
        `-i "${filePath}"`,
        `-vf "tpad=stop=6:stop_mode=clone"`,  // 6 cloned boundary frames → any EOF seek always valid
        `-c:v libx264`,
        `-preset fast`,
        `-crf 23`,
        `-g 1`,                       // every frame = keyframe
        `-keyint_min 1`,
        `-sc_threshold 0`,
        `-bf 0`,                      // no B-frames
        `-pix_fmt yuv420p`,
        `-r 30`,                      // constant 30fps
        `-fps_mode cfr`,
        `-an`,
        `-video_track_timescale 30`,   // tbn=30 → PTS integers → no seek misses
        `-movflags +faststart`,
        `-avoid_negative_ts make_zero`,
    ].filter(Boolean).join(' ') + ` "${tmpOutput}"`;

    return new Promise<void>((resolve) => {
        exec(cmd, { maxBuffer: 50 * 1024 * 1024 }, async (err, _stdout, stderr) => {
            if (err) {
                // Try legacy -vsync flag if -fps_mode not supported
                if (stderr?.includes('fps_mode')) {
                    const cmdLegacy = cmd.replace('-fps_mode cfr', '-vsync cfr');
                    exec(cmdLegacy, { maxBuffer: 50 * 1024 * 1024 }, async (err2, _s2, stderr2) => {
                        if (err2) {
                            console.warn(`⚠️ Video prep failed for ${path.basename(filePath)}: ${stderr2?.slice(-200)}`);
                            try { if (fs.existsSync(tmpOutput)) fs.unlinkSync(tmpOutput); } catch { }
                            resolve();
                        } else {
                            await doRename(filePath, tmpOutput, resolve);
                        }
                    });
                    return;
                }
                console.warn(`⚠️ Video prep failed for ${path.basename(filePath)}: ${stderr?.slice(-200)}`);
                try { if (fs.existsSync(tmpOutput)) fs.unlinkSync(tmpOutput); } catch { }
                resolve();
                return;
            }

            await doRename(filePath, tmpOutput, resolve);
        });
    });
}

/**
 * Pre-composite two split-screen videos into ONE vertically-stacked video.
 * CRITICAL FIX: Using two concurrent <OffthreadVideo> tags causes cache eviction
 * in Remotion's Rust compositor, leading to "No frame found" errors. By merging
 * the split into a single file, Remotion only needs to decode ONE video at a time.
 */
async function mergeSplitVideos(topPath: string, bottomPath: string, outputPath: string): Promise<boolean> {
    if (!fs.existsSync(topPath) || !fs.existsSync(bottomPath)) {
        console.warn(`⚠️ mergeSplitVideos: missing input(s)`);
        return false;
    }

    const ffmpegBin = getFFmpegPath();
    const cmd = [
        `"${ffmpegBin}"`,
        `-y`,
        `-i "${topPath}"`,
        `-i "${bottomPath}"`,
        `-filter_complex`,
        `"[0:v]scale=1080:960:force_original_aspect_ratio=increase,crop=1080:960,setsar=1[top];[1:v]scale=1080:960:force_original_aspect_ratio=increase,crop=1080:960,setsar=1[bottom];[top][bottom]vstack=inputs=2,tpad=stop=6:stop_mode=clone[out]"`,
        `-map "[out]"`,
        `-c:v libx264`,
        `-preset fast`,
        `-crf 23`,
        `-g 1`,
        `-keyint_min 1`,
        `-sc_threshold 0`,
        `-bf 0`,
        `-pix_fmt yuv420p`,
        `-r 30`,
        `-fps_mode cfr`,
        `-an`,
        `-movflags +faststart`,
        `-avoid_negative_ts make_zero`,
        `"${outputPath}"`,
    ].join(' ');

    return new Promise<boolean>((resolve) => {
        exec(cmd, { maxBuffer: 50 * 1024 * 1024 }, (err, _stdout, stderr) => {
            if (err) {
                if (stderr?.includes('fps_mode')) {
                    const cmdLegacy = cmd.replace('-fps_mode cfr', '-vsync cfr');
                    exec(cmdLegacy, { maxBuffer: 50 * 1024 * 1024 }, (err2) => {
                        if (err2) {
                            console.warn(`⚠️ Split merge failed: ${stderr?.slice(-200)}`);
                            resolve(false);
                        } else {
                            console.log(`✅ Merged split-screen → ${path.basename(outputPath)}`);
                            resolve(true);
                        }
                    });
                } else {
                    console.warn(`⚠️ Split merge failed: ${stderr?.slice(-200)}`);
                    resolve(false);
                }
            } else {
                const sizeMB = fs.existsSync(outputPath)
                    ? (fs.statSync(outputPath).size / 1024 / 1024).toFixed(1)
                    : '?';
                console.log(`✅ Merged split-screen → ${path.basename(outputPath)} (${sizeMB} MB)`);
                resolve(true);
            }
        });
    });
}

/** Helper: rename _prepped temp file back to original path with Windows retry logic */
async function doRename(filePath: string, tmpOutput: string, resolve: () => void) {
    const MAX_RETRIES = 5;
    const RETRY_DELAY_MS = 500;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
            fs.renameSync(tmpOutput, filePath);
            const sizeMB = (fs.statSync(filePath).size / 1024 / 1024).toFixed(1);
            console.log(`✅ Prepped ${path.basename(filePath)} (${sizeMB} MB)`);
            resolve();
            return;
        } catch (e: any) {
            if (attempt < MAX_RETRIES && (e.code === 'EBUSY' || e.code === 'EPERM' || e.code === 'EACCES')) {
                await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
                continue;
            }
            try {
                fs.copyFileSync(tmpOutput, filePath);
                try { fs.unlinkSync(tmpOutput); } catch { }
                console.log(`✅ Prepped ${path.basename(filePath)} (copy fallback)`);
                resolve();
                return;
            } catch {
                try { if (fs.existsSync(tmpOutput)) fs.unlinkSync(tmpOutput); } catch { }
            }
        }
    }
    resolve();
}

async function probeVideoDuration(filePath: string): Promise<number | undefined> {
    if (!fs.existsSync(filePath)) return undefined;
    const ffmpegBin = getFFmpegPath();

    return new Promise((resolve) => {
        exec(`"${ffmpegBin}" -i "${filePath}"`, (_err, stdout, stderr) => {
            const output = (stdout || '') + '\n' + (stderr || '');
            const durationMatch = output.match(/Duration: (\d{2}):(\d{2}):(\d{2}\.\d+)/);
            if (durationMatch) {
                const durationSec =
                    parseInt(durationMatch[1]) * 3600 +
                    parseInt(durationMatch[2]) * 60 +
                    parseFloat(durationMatch[3]);
                resolve(durationSec);
            } else {
                resolve(undefined);
            }
        });
    });
}

/**
 * Stretch a video file in-place using FFmpeg's setpts filter so its duration
 * equals targetSec. Returns the final duration (seconds), or the original
 * duration if stretching was not needed / failed.
 * Uses timescale 90000 which Remotion's compositor handles correctly with
 * playbackRate=1.0 (frame PTS values are exact multiples of 3000).
 */
async function stretchSceneVideoToFit(
    srcPath: string,
    targetSec: number
): Promise<number | undefined> {
    const probedDur = await probeVideoDuration(srcPath);
    if (!probedDur || probedDur <= 0) return probedDur;

    // Only stretch when video is shorter than the target scene duration.
    // Add 0.6s buffer so safeLength (dur - 0.4s) always exceeds targetSec
    // → Remotion uses playbackRate=1.0 → no fractional PTS seeks.
    const needed = targetSec + 0.6;
    if (probedDur >= needed) return probedDur; // already long enough

    const ratio = (needed / probedDur).toFixed(6);
    const tmpPath = srcPath.replace(/\.mp4$/i, '_sx.mp4');
    const ffmpegBin = getFFmpegPath();

    console.log(`⏩ Stretching scene video: ${probedDur.toFixed(2)}s → ${needed.toFixed(2)}s (×${ratio})`);

    const baseArgs = [
        `"${ffmpegBin}" -y -i "${srcPath}"`,
        `-vf "setpts=${ratio}*PTS,minterpolate=fps=30:mi_mode=blend:scd=none,tpad=stop=6:stop_mode=clone"`,  // smooth blend stretch + 6 boundary clone frames
        `-c:v libx264 -preset fast -crf 23`,
        `-g 1 -bf 0 -pix_fmt yuv420p`,
        `-r 30 -fps_mode cfr`,
        `-video_track_timescale 30`,   // PTS = integers 0,1,2,... → no seek misses
        `-an -movflags +faststart -avoid_negative_ts make_zero`,
        `"${tmpPath}"`,
    ];

    return new Promise<number | undefined>((resolve) => {
        const cmd = baseArgs.join(' ');
        exec(cmd, { maxBuffer: 100 * 1024 * 1024 }, async (err, _out, stderr) => {
            const tryLegacy = !!err && stderr?.includes('fps_mode');
            const run = (c: string) => new Promise<boolean>(res => {
                exec(c, { maxBuffer: 100 * 1024 * 1024 }, async (e2) => {
                    if (e2 || !fs.existsSync(tmpPath) || fs.statSync(tmpPath).size < 10_000) {
                        try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch {}
                        res(false);
                    } else {
                        res(true);
                    }
                });
            });

            const ok = err
                ? (tryLegacy ? await run(cmd.replace('-fps_mode cfr', '-vsync cfr')) : false)
                : (fs.existsSync(tmpPath) && fs.statSync(tmpPath).size > 10_000);

            if (!ok) {
                console.warn(`⚠️ stretchSceneVideoToFit failed, using original duration ${probedDur.toFixed(2)}s`);
                resolve(probedDur);
                return;
            }

            // Swap files
            try { fs.unlinkSync(srcPath); } catch {}
            try { fs.renameSync(tmpPath, srcPath); }
            catch {
                fs.copyFileSync(tmpPath, srcPath);
                try { fs.unlinkSync(tmpPath); } catch {}
            }

            const newDur = await probeVideoDuration(srcPath);
            console.log(`✅ Scene video stretched → ${(newDur ?? 0).toFixed(2)}s`);
            resolve(newDur);
        });
    });
}

const activeRenders = new Set<string>();

export async function triggerRender(videoId: string, props: Record<string, any>) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL
        || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null);

    const githubToken = process.env.GH_PAT;
    const repoOwner = process.env.GH_OWNER || "keshav-agrawal595";
    const repoName = process.env.GH_REPO || "Migoo";

    // Detect if cloud rendering can be used
    const isCloud = !!(githubToken && process.env.GH_OWNER && process.env.GH_REPO && appUrl);

    if (!isCloud) {
        if (activeRenders.has(videoId)) {
            console.log(`⚠️ Video ${videoId} is already actively rendering in this process. Skipping duplicate trigger.`);
            return { success: true, mode: 'local', skipped: true };
        }

        console.log(`🎬 Starting LOCAL render for: ${videoId}`);

        const [existing] = await db.select().from(shortVideoAssets).where(eq(shortVideoAssets.videoId, videoId));
        if (existing && existing.status === 'rendering') {
            console.log(`⚠️ Video ${videoId} is already rendering in DB status. Skipping duplicate render.`);
            return { success: true, mode: 'local', skipped: true };
        }
        if (existing && existing.status === 'completed' && existing.videoUrl) {
            console.log(`⚠️ Video ${videoId} is already rendered.`);
            await ensureVideoThumbnail(videoId);
            return { success: true, mode: 'local', skipped: true };
        }

        activeRenders.add(videoId);
        await db.update(shortVideoAssets).set({ status: 'rendering' }).where(eq(shortVideoAssets.videoId, videoId));

        renderLocally(videoId, props).catch((err) => {
            console.error(`❌ Local render failed for ${videoId}:`, err);
        });

        return { success: true, mode: 'local' };
    }

    // CLOUD MODE
    console.log(`🎬 Triggering GitHub Action rendering for: ${videoId} via repo ${repoOwner}/${repoName}`);

    const webhookUrl = `${appUrl}/api/video/webhook`;

    // ⚠️ GitHub repository dispatch has a hard 10 KB client_payload limit.
    // All render props are already saved to shortVideoAssets in the DB before this is called.
    // The GitHub runner fetches them via /api/video/props/{videoId} instead of receiving them inline.
    const response = await fetch(`https://api.github.com/repos/${repoOwner}/${repoName}/dispatches`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${githubToken}`,
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify({
            event_type: 'render-video',
            // Only videoId + webhookUrl + propsUrl — keeps payload tiny (< 500 bytes)
            client_payload: {
                videoId,
                webhookUrl,
                propsUrl: `${appUrl}/api/video/props/${videoId}`,
            },
        }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`GitHub dispatch failed: ${response.status} ${errorText}`);
    }

    await db.update(shortVideoAssets).set({ status: 'rendering' }).where(eq(shortVideoAssets.videoId, videoId));
    return { success: true, mode: 'cloud' };
}

async function downloadToLocal(url: string | undefined, destAbsPath: string): Promise<string | undefined> {
    if (!url || !url.startsWith('http')) return url;

    let sanitizedUrl = url;
    if (sanitizedUrl.includes('/public/tmp/')) sanitizedUrl = sanitizedUrl.replace('/public/tmp/', '/tmp/');
    if (sanitizedUrl.includes('/public/avatars/')) sanitizedUrl = sanitizedUrl.replace('/public/avatars/', '/avatars/');

    // ── FIX: Sanitize double-slashes in Appwrite URLs (v1//storage → v1/storage) ──
    sanitizedUrl = sanitizedUrl.replace(/\/v1\/\/storage/g, '/v1/storage');

    // ── FIX: Convert /view to /download for faster, direct file downloads ──
    if (sanitizedUrl.includes('/view')) {
        sanitizedUrl = sanitizedUrl.replace('/view', '/download');
    }

    fs.mkdirSync(path.dirname(destAbsPath), { recursive: true });

    try {
        // Build headers — add Appwrite API key for Appwrite storage URLs
        const headers: Record<string, string> = {
            'Connection': 'keep-alive'
        };
        if (sanitizedUrl.includes('appwrite.io') && sanitizedUrl.includes('/storage')) {
            // Extract project ID from ?project= query param in the URL
            const projectMatch = sanitizedUrl.match(/[?&]project=([^&]+)/);
            const urlProjectId = projectMatch?.[1];

            // Look up the matching API key across all Appwrite project env vars
            const suffixes = ['', '1', '2', '3', '4', '5'];
            let matchedKey: string | undefined;
            let matchedProject: string | undefined;

            for (const suffix of suffixes) {
                const pid = process.env[`APPWRITE_PROJECT_ID${suffix}`];
                const key = process.env[`APPWRITE_API_KEY${suffix}`];
                if (pid && key && pid === urlProjectId) {
                    matchedKey = key;
                    matchedProject = pid;
                    break;
                }
            }

            // Fallback to default if no match found
            if (!matchedKey) {
                matchedKey = process.env.APPWRITE_VIDEO_API_KEY || process.env.APPWRITE_API_KEY;
                matchedProject = process.env.APPWRITE_VIDEO_PROJECT_ID || process.env.APPWRITE_PROJECT_ID;
                console.warn(`⚠️ No specific APPWRITE_API_KEY for project ${urlProjectId}, using default`);
            } else {
                console.log(`🔑 Appwrite Auth matched for project: ${urlProjectId}`);
            }

            if (matchedKey) headers['X-Appwrite-Key'] = matchedKey;
            if (matchedProject) headers['X-Appwrite-Project'] = matchedProject;

            // ── IMPORTANT: Keep ?project= in the URL for /download endpoint ──
            // Appwrite's /download endpoint validates project from BOTH the query
            // param AND the X-Appwrite-Project header. Removing it causes 401/abort.
            // Do NOT strip the ?project= param here.
        }

        const maxAttempts = 6;
        let lastError: any;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            const controller = new AbortController();
            // 150s timeout — covers full download of large Kling scene videos (up to 60MB)
            const timeoutId = setTimeout(() => controller.abort(), 150000);

            try {
                if (attempt > 1) {
                    console.log(`⏳ Retry attempt ${attempt}/${maxAttempts} for ${path.basename(destAbsPath)}...`);
                } else {
                    console.log(`📥 Downloading asset: ${path.basename(destAbsPath)}...`);
                }

                let res = await fetch(sanitizedUrl, { 
                    headers,
                    signal: controller.signal
                });

                if (!res.ok) {
                    clearTimeout(timeoutId);
                    throw new Error(`HTTP ${res.status} ${res.statusText}`);
                }

                let buffer: Buffer;
                try {
                    buffer = Buffer.from(await res.arrayBuffer());
                } finally {
                    clearTimeout(timeoutId); // always clear after body read
                }

                if (buffer.length < 100) throw new Error('Downloaded file too small');
                fs.writeFileSync(destAbsPath, buffer);
                
                console.log(`✅ Downloaded asset: ${path.basename(destAbsPath)} (${(buffer.length / 1024 / 1024).toFixed(2)} MB)`);

                // Return a local HTTP URL that Next.js can serve
                const relToPublic = path.relative(path.join(process.cwd(), 'public'), destAbsPath).replace(/\\/g, '/');
                return `/${relToPublic}`;

            } catch (err: any) {
                clearTimeout(timeoutId);
                lastError = err;
                console.warn(`⚠️ Attempt ${attempt}/${maxAttempts} failed for ${path.basename(destAbsPath)}: ${err.message}`);
                
                if (attempt < maxAttempts) {
                    const delay = Math.pow(2, attempt) * 1000;
                    console.log(`⏳ Waiting ${delay}ms before next attempt...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }

        // If we reach here, all attempts failed. Create local placeholder.
        console.warn(`❌ Failed to download ${sanitizedUrl} after ${maxAttempts} attempts: ${lastError?.message}. Creating local placeholder.`);

        const relToPublic = path.relative(path.join(process.cwd(), 'public'), destAbsPath).replace(/\\/g, '/');

        // ── Placeholder for IMAGE files ──
        if (destAbsPath.match(/\.(jpg|jpeg|png|webp|gif)$/i)) {
            try {
                const placeholderJpeg = Buffer.from(
                    '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRof' +
                    'Hh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwh' +
                    'MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAAR' +
                    'CAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgED' +
                    'AwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcY' +
                    'GRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJ' +
                    'ipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo' +
                    '6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgEC' +
                    'BAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl' +
                    '8RcYI4Q/RFhHRUYnJCk2NzgpOkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOE' +
                    'hYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk' +
                    '5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+gD/2Q==',
                    'base64'
                );
                fs.writeFileSync(destAbsPath, placeholderJpeg);
                console.log(`📷 Created placeholder image: ${path.basename(destAbsPath)}`);
                try { fs.writeFileSync(`${destAbsPath}.is_placeholder`, 'true'); } catch {}
                return `/${relToPublic}`;
            } catch { }
        }

        // ── CRITICAL: Placeholder for VIDEO files ──
        // Generate a 2-second black MP4 using FFmpeg so Remotion NEVER
        // receives a remote Appwrite URL (which would 403 in the browser).
        // Forces a clean standard timescale (30000) to match exact integer seeks.
        if (destAbsPath.match(/\.(mp4|mov|webm)$/i)) {
            try {
                const ffmpegBin = getFFmpegPath();
                const cmd = [
                    `"${ffmpegBin}"`, `-y`,
                    `-f lavfi -i color=c=black:s=1080x1920:r=30:d=2`,
                    `-c:v libx264 -preset ultrafast -crf 28`,
                    `-g 1 -keyint_min 1 -bf 0`,
                    `-pix_fmt yuv420p -movflags +faststart`,
                    `-video_track_timescale 30000`,
                    `-an`,
                    `"${destAbsPath}"`,
                ].join(' ');

                const { execSync } = require('child_process');
                execSync(cmd, { maxBuffer: 10 * 1024 * 1024, timeout: 15000 });

                if (fs.existsSync(destAbsPath) && fs.statSync(destAbsPath).size > 100) {
                    console.log(`🎬 Created placeholder video: ${path.basename(destAbsPath)}`);
                    try { fs.writeFileSync(`${destAbsPath}.is_placeholder`, 'true'); } catch {}
                    return `/${relToPublic}`;
                }
            } catch (ffErr: any) {
                console.warn(`⚠️ FFmpeg placeholder failed: ${ffErr.message?.slice(0, 100)}`);
            }
        }

        // ── CRITICAL: Placeholder for AUDIO files ──
        // Generate a 2-second silent audio file so Remotion NEVER
        // receives a remote Appwrite URL (which would desync / timeout in Chromium).
        if (destAbsPath.match(/\.(wav|mp3|m4a|aac)$/i)) {
            try {
                const ffmpegBin = getFFmpegPath();
                const cmd = [
                    `"${ffmpegBin}"`, `-y`,
                    `-f lavfi -i anullsrc=r=44100:cl=stereo -t 2`,
                    `-c:a pcm_s16le`,
                    `"${destAbsPath}"`,
                ].join(' ');

                const { execSync } = require('child_process');
                execSync(cmd, { maxBuffer: 10 * 1024 * 1024, timeout: 15000 });

                if (fs.existsSync(destAbsPath) && fs.statSync(destAbsPath).size > 100) {
                    console.log(`🎵 Created silent placeholder audio: ${path.basename(destAbsPath)}`);
                    try { fs.writeFileSync(`${destAbsPath}.is_placeholder`, 'true'); } catch {}
                    return `/${relToPublic}`;
                }
            } catch (ffErr: any) {
                console.warn(`⚠️ FFmpeg audio placeholder failed: ${ffErr.message?.slice(0, 100)}`);
            }
        }

        // ── NEVER return a remote Appwrite URL — it will 403 in Remotion's browser ──
        console.warn(`⚠️ No placeholder created for ${path.basename(destAbsPath)}, returning undefined`);
        return undefined;
    } catch (globalErr: any) {
        console.error(`❌ Global error in downloadToLocal for ${path.basename(destAbsPath)}: ${globalErr.message}`);
        return undefined;
    }
}

async function renderLocally(videoId: string, props: Record<string, any>) {
    try {
        await _renderLocallyInternal(videoId, props);
    } finally {
        activeRenders.delete(videoId);
        console.log(`🔓 Released render lock for video: ${videoId}`);
    }
}

async function _renderLocallyInternal(videoId: string, props: Record<string, any>) {
    const cwd = process.cwd();

    const tmpDir = path.join(cwd, 'public', 'tmp');
    const rendersDir = path.join(cwd, 'public', 'renders');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    if (!fs.existsSync(rendersDir)) fs.mkdirSync(rendersDir, { recursive: true });



    // Clean up ONLY stale files from tmp/ (older than 1 hour) to avoid deleting active parallel renders
    try {
        const tmpFiles = fs.readdirSync(tmpDir);
        const oneHourAgo = Date.now() - 60 * 60 * 1000;
        for (const file of tmpFiles) {
            if (file === `assets_${videoId}`) continue; // keep current
            if (file === `props-${videoId}.json`) continue; // keep current
            try {
                const fullPath = path.join(tmpDir, file);
                const stat = fs.statSync(fullPath);
                if (stat.mtimeMs < oneHourAgo) {
                    if (stat.isDirectory()) {
                        fs.rmSync(fullPath, { recursive: true, force: true });
                    } else {
                        fs.unlinkSync(fullPath);
                    }
                    console.log(`🧹 Cleaned stale tmp file: ${file}`);
                }
            } catch { }
        }
    } catch { }

    const assetsDirRel = `tmp/assets_${videoId}`;
    const assetsDirAbs = path.join(cwd, 'public', assetsDirRel);
    fs.mkdirSync(assetsDirAbs, { recursive: true });

    const newUrls = props.sceneVideoUrls ? [...props.sceneVideoUrls] : [];

    // ── Download all remote assets in parallel ────────────────────────────────
    try {
        console.log(`📥 Collecting all asset download tasks for ${videoId}...`);

        const downloadTasks: Array<{
            url: string;
            destAbs: string;
            onComplete: (localUrl: string) => void | Promise<void>;
        }> = [];

        const postProcessTasks: (() => Promise<void>)[] = [];

        // Pre-allocate array for scene durations
        const sceneVideoDurations: (number | undefined)[] = new Array(newUrls.length).fill(undefined);

        // Scene videos
        if (props.sceneVideoUrls && Array.isArray(props.sceneVideoUrls)) {
            for (let i = 0; i < newUrls.length; i++) {
                const urlOrJson = newUrls[i];
                if (!urlOrJson) continue;

                // Check for JSON payload (composite/split)
                try {
                    const parsed = JSON.parse(urlOrJson);

                    if (parsed?.type === 'composite' && Array.isArray(parsed.assets)) {
                        let assetIdx = 0;
                        for (const asset of parsed.assets) {
                            const currentAssetIdx = assetIdx;
                            if (asset.kind === 'video' && asset.url) {
                                const destAbs = path.join(assetsDirAbs, `scene_${i}_v${currentAssetIdx}.mp4`);
                                downloadTasks.push({
                                    url: asset.url,
                                    destAbs,
                                    onComplete: (local) => {
                                        asset.url = local;
                                    }
                                });
                            } else if (asset.kind === 'image' && asset.url) {
                                const ext = asset.url.match(/\.(png|jpg|jpeg|webp|gif)/i)?.[1] || 'jpg';
                                const destAbs = path.join(assetsDirAbs, `scene_${i}_img${currentAssetIdx}.${ext}`);
                                downloadTasks.push({
                                    url: asset.url,
                                    destAbs,
                                    onComplete: (local) => {
                                        asset.url = local;
                                    }
                                });
                            } else if (asset.kind === 'split' && Array.isArray(asset.urls)) {
                                const topDest = path.join(assetsDirAbs, `scene_${i}_sp${currentAssetIdx}_0.mp4`);
                                const botDest = path.join(assetsDirAbs, `scene_${i}_sp${currentAssetIdx}_1.mp4`);

                                downloadTasks.push({
                                    url: asset.urls[0],
                                    destAbs: topDest,
                                    onComplete: (local) => {
                                        asset.urls[0] = local;
                                    }
                                });
                                downloadTasks.push({
                                    url: asset.urls[1],
                                    destAbs: botDest,
                                    onComplete: (local) => {
                                        asset.urls[1] = local;
                                    }
                                });

                                // Merge split composite post-download
                                const sceneIndex = i;
                                postProcessTasks.push(async () => {
                                    const mergedDest = path.join(assetsDirAbs, `scene_${sceneIndex}_sp${currentAssetIdx}_merged.mp4`);
                                    const merged = await mergeSplitVideos(topDest, botDest, mergedDest);
                                    if (merged) {
                                        asset.kind = 'video';
                                        asset.url = `/${assetsDirRel}/scene_${sceneIndex}_sp${currentAssetIdx}_merged.mp4`;
                                        asset.durationSec = await probeVideoDuration(mergedDest);
                                        delete asset.urls;
                                        delete asset.durationsSec;
                                        console.log(`✅ Split→merged for composite scene ${sceneIndex}, asset ${currentAssetIdx}`);
                                    } else {
                                        if (!asset.durationsSec) asset.durationsSec = [];
                                        asset.durationsSec[0] = fs.existsSync(topDest) ? await probeVideoDuration(topDest) : undefined;
                                        asset.durationsSec[1] = fs.existsSync(botDest) ? await probeVideoDuration(botDest) : undefined;
                                        const validDurs = (asset.durationsSec || []).filter(Boolean);
                                        if (validDurs.length > 0) asset.durationSec = Math.min(...validDurs);
                                    }
                                });
                            }
                            assetIdx++;
                        }

                        const sceneIndex = i;
                        postProcessTasks.push(async () => {
                            newUrls[sceneIndex] = JSON.stringify(parsed);
                            const allDurs = parsed.assets.map((a: any) =>
                                a.durationSec || (a.durationsSec ? Math.min(...a.durationsSec.filter(Boolean)) : 0)
                            ).filter(Boolean);
                            sceneVideoDurations[sceneIndex] = allDurs.length > 0 ? Math.min(...allDurs) : undefined;
                        });
                        continue;
                    }

                    if (parsed?.type === 'split' && Array.isArray(parsed.urls)) {
                        const topDest = path.join(assetsDirAbs, `scene_${i}_split_0.mp4`);
                        const botDest = path.join(assetsDirAbs, `scene_${i}_split_1.mp4`);

                        downloadTasks.push({
                            url: parsed.urls[0],
                            destAbs: topDest,
                            onComplete: (local) => {
                                parsed.urls[0] = local;
                            }
                        });
                        downloadTasks.push({
                            url: parsed.urls[1],
                            destAbs: botDest,
                            onComplete: (local) => {
                                parsed.urls[1] = local;
                            }
                        });

                        const sceneIndex = i;
                        postProcessTasks.push(async () => {
                            const mergedDest = path.join(assetsDirAbs, `scene_${sceneIndex}_split_merged.mp4`);
                            const merged = await mergeSplitVideos(topDest, botDest, mergedDest);
                            if (merged) {
                                newUrls[sceneIndex] = `/${assetsDirRel}/scene_${sceneIndex}_split_merged.mp4`;
                                const dur = await probeVideoDuration(mergedDest);
                                sceneVideoDurations[sceneIndex] = dur;
                                console.log(`✅ Split→merged for scene ${sceneIndex}`);
                            } else {
                                if (!parsed.durationsSec) parsed.durationsSec = [];
                                parsed.durationsSec[0] = fs.existsSync(topDest) ? await probeVideoDuration(topDest) : undefined;
                                parsed.durationsSec[1] = fs.existsSync(botDest) ? await probeVideoDuration(botDest) : undefined;
                                newUrls[sceneIndex] = JSON.stringify(parsed);
                                const validDurs = (parsed.durationsSec || []).filter(Boolean);
                                sceneVideoDurations[sceneIndex] = validDurs.length > 0 ? Math.min(...validDurs) : undefined;
                            }
                        });
                        continue;
                    }
                } catch {
                    // not JSON, regular URL
                }

                const isSkipMarker = urlOrJson === 'SKIP_T2V' || urlOrJson === 'SKIP_VEO' || urlOrJson === '';
                const hasVideoExt = /\.(mp4|mov|webm)/i.test(urlOrJson);
                const isAppwriteVideo = urlOrJson.includes('appwrite') && urlOrJson.includes('/storage/');
                const isRemoteUrl = urlOrJson.startsWith('http://') || urlOrJson.startsWith('https://');
                const isDirectVideo = !isSkipMarker && (hasVideoExt || isAppwriteVideo || isRemoteUrl);

                if (isDirectVideo) {
                    const destAbs = path.join(assetsDirAbs, `scene_${i}.mp4`);
                    const sceneIndex = i;
                    downloadTasks.push({
                        url: urlOrJson,
                        destAbs,
                        onComplete: async (local) => {
                            newUrls[sceneIndex] = local;
                            const dur = await probeVideoDuration(destAbs);
                            sceneVideoDurations[sceneIndex] = dur;
                        }
                    });
                }
            }
        }

        // Narration audio
        if (props.audioUrl) {
            const destAbs = path.join(assetsDirAbs, 'audio.wav');
            downloadTasks.push({
                url: props.audioUrl,
                destAbs,
                onComplete: (local) => {
                    props.audioUrl = local;
                }
            });
        }

        // Background music
        if (props.musicUrl) {
            const destAbs = path.join(assetsDirAbs, 'music.mp3');
            downloadTasks.push({
                url: props.musicUrl,
                destAbs,
                onComplete: (local) => {
                    props.musicUrl = local;
                }
            });
        }

        // Intro/outro audio
        if (props.introClip?.audioUrl) {
            const destAbs = path.join(assetsDirAbs, 'intro_audio.wav');
            downloadTasks.push({
                url: props.introClip.audioUrl,
                destAbs,
                onComplete: (local) => {
                    props.introClip.audioUrl = local;
                }
            });
        }

        if (props.outroClip?.audioUrl) {
            const destAbs = path.join(assetsDirAbs, 'outro_audio.wav');
            downloadTasks.push({
                url: props.outroClip.audioUrl,
                destAbs,
                onComplete: (local) => {
                    props.outroClip.audioUrl = local;
                }
            });
        }

        // Image URLs
        if (props.imageUrls && Array.isArray(props.imageUrls)) {
            const newImageUrls = [...props.imageUrls];

            for (let i = 0; i < newImageUrls.length; i++) {
                const imgUrl = newImageUrls[i];
                if (!imgUrl || !imgUrl.startsWith('http')) continue;

                // Check for slideshow JSON
                try {
                    const parsed = JSON.parse(imgUrl);
                    if (parsed?.type === 'slideshow' && Array.isArray(parsed.urls)) {
                        for (let j = 0; j < parsed.urls.length; j++) {
                            const slideUrl = parsed.urls[j];
                            if (slideUrl?.startsWith('http')) {
                                const ext = slideUrl.match(/\.(png|jpg|jpeg|webp|gif)/i)?.[1] || 'jpg';
                                const destAbs = path.join(assetsDirAbs, `slide_${i}_${j}.${ext}`);
                                const slideIndex = j;
                                downloadTasks.push({
                                    url: slideUrl,
                                    destAbs,
                                    onComplete: (local) => {
                                        parsed.urls[slideIndex] = local;
                                    }
                                });
                            }
                        }
                        const imageIndex = i;
                        postProcessTasks.push(async () => {
                            newImageUrls[imageIndex] = JSON.stringify(parsed);
                        });
                        continue;
                    }
                } catch {
                    // not JSON
                }

                // Regular image URL
                if (/SKIP_T2V|SKIP_VEO/i.test(imgUrl)) continue;
                const ext = imgUrl.match(/\.(png|jpg|jpeg|webp|gif)/i)?.[1] || 'jpg';
                const destAbs = path.join(assetsDirAbs, `image_${i}.${ext}`);
                const imageIndex = i;
                downloadTasks.push({
                    url: imgUrl,
                    destAbs,
                    onComplete: (local) => {
                        newImageUrls[imageIndex] = local;
                    }
                });
            }

            postProcessTasks.push(async () => {
                props.imageUrls = newImageUrls;
            });
        }

        // Avatar Clip prepping in parallel
        const avatarPrepTasks: Promise<void>[] = [];

        if (props.introClip?.videoUrl) {
            const rawUrl = props.introClip.videoUrl.replace(/^\//, '');
            const srcAbs = path.join(cwd, 'public', rawUrl);
            const destAbs = path.join(assetsDirAbs, 'intro_video_prepped.mp4');

            if (fs.existsSync(srcAbs)) {
                avatarPrepTasks.push((async () => {
                    console.log(`🎬 Prepping intro avatar: ${path.basename(srcAbs)} → intro_video_prepped.mp4`);
                    const ok = await prepVideoToNewPath(srcAbs, destAbs);

                    if (ok && fs.existsSync(destAbs)) {
                        const probedDur = await probeVideoDuration(destAbs);
                        console.log(`📏 Intro video probed duration: ${probedDur?.toFixed(3)}s`);
                        if (!probedDur || probedDur < 0.5) {
                            const rawDestAbs = path.join(assetsDirAbs, 'intro_video.mp4');
                            fs.copyFileSync(srcAbs, rawDestAbs);
                            const rawDur = await probeVideoDuration(rawDestAbs);
                            props.introClip = { ...props.introClip, videoUrl: `/${assetsDirRel}/intro_video.mp4`, videoDurationSec: rawDur };
                        } else {
                            props.introClip = {
                                ...props.introClip,
                                videoUrl: `/${assetsDirRel}/intro_video_prepped.mp4`,
                                videoDurationSec: probedDur,
                            };
                        }
                    } else {
                        const rawDestAbs = path.join(assetsDirAbs, 'intro_video.mp4');
                        fs.copyFileSync(srcAbs, rawDestAbs);
                        const probedDur = await probeVideoDuration(rawDestAbs);
                        props.introClip = {
                            ...props.introClip,
                            videoUrl: `/${assetsDirRel}/intro_video.mp4`,
                            videoDurationSec: probedDur,
                        };
                    }
                })());
            }
        }

        if (props.outroClip?.videoUrl) {
            const rawUrl = props.outroClip.videoUrl.replace(/^\//, '');
            const srcAbs = path.join(cwd, 'public', rawUrl);
            const destAbs = path.join(assetsDirAbs, 'outro_video_prepped.mp4');

            if (fs.existsSync(srcAbs)) {
                avatarPrepTasks.push((async () => {
                    console.log(`🎬 Prepping outro avatar: ${path.basename(srcAbs)} → outro_video_prepped.mp4`);
                    const ok = await prepVideoToNewPath(srcAbs, destAbs);

                    if (ok && fs.existsSync(destAbs)) {
                        const probedDur = await probeVideoDuration(destAbs);
                        console.log(`📏 Outro video probed duration: ${probedDur?.toFixed(3)}s`);
                        if (!probedDur || probedDur < 0.5) {
                            const rawDestAbs = path.join(assetsDirAbs, 'outro_video.mp4');
                            fs.copyFileSync(srcAbs, rawDestAbs);
                            const rawDur = await probeVideoDuration(rawDestAbs);
                            props.outroClip = { ...props.outroClip, videoUrl: `/${assetsDirRel}/outro_video.mp4`, videoDurationSec: rawDur };
                        } else {
                            props.outroClip = {
                                ...props.outroClip,
                                videoUrl: `/${assetsDirRel}/outro_video_prepped.mp4`,
                                videoDurationSec: probedDur,
                            };
                        }
                    } else {
                        const rawDestAbs = path.join(assetsDirAbs, 'outro_video.mp4');
                        fs.copyFileSync(srcAbs, rawDestAbs);
                        const probedDur = await probeVideoDuration(rawDestAbs);
                        props.outroClip = {
                            ...props.outroClip,
                            videoUrl: `/${assetsDirRel}/outro_video.mp4`,
                            videoDurationSec: probedDur,
                        };
                    }
                })());
            }
        }

        // Run all downloads and avatar prepping concurrently
        // CACHE: skip assets that already exist locally (e.g. on force re-render)
        // PURGE STALE PLACEHOLDERS: delete any companion `.is_placeholder` assets from previous failed render runs
        console.log(`🚀 Downloading ${downloadTasks.length} assets and prepping avatars in parallel...`);
        await Promise.all([
            ...downloadTasks.map(async (task) => {
                try {
                    // Detect and delete stale placeholders from prior failures to force a fresh download
                    const placeholderFile = `${task.destAbs}.is_placeholder`;
                    if (fs.existsSync(placeholderFile)) {
                        console.log(`🗑️  Detected stale placeholder for ${path.basename(task.destAbs)} — deleting to force fresh download`);
                        try { fs.unlinkSync(task.destAbs); } catch {}
                        try { fs.unlinkSync(placeholderFile); } catch {}
                    }

                    // ── Download cache: skip if file already exists and is valid ──
                    if (fs.existsSync(task.destAbs)) {
                        const existingSize = fs.statSync(task.destAbs).size;
                        if (existingSize > 1000) {
                            console.log(`⏭️  Cache hit: ${path.basename(task.destAbs)} (${(existingSize / 1024 / 1024).toFixed(2)} MB) — skipping download`);
                            const relToPublic = path.relative(path.join(process.cwd(), 'public'), task.destAbs).replace(/\\/g, '/');
                            await task.onComplete(`/${relToPublic}`);
                            return;
                        }
                    }
                    const localUrl = await downloadToLocal(task.url, task.destAbs);
                    if (localUrl) {
                        await task.onComplete(localUrl);
                    }
                } catch (e: any) {
                    console.error(`❌ Download failed for ${task.url}: ${e.message}`);
                }
            }),
            ...avatarPrepTasks
        ]);

        console.log(`⚙️ Running post-download merging and serialization...`);
        for (const task of postProcessTasks) {
            await task();
        }

        props.sceneVideoUrls = newUrls;
        props.sceneVideoDurations = sceneVideoDurations;

        console.log(`✅ All assets successfully downloaded and prepared!`);
    } catch (err: any) {
        console.error(`❌ Parallel download or prep failed:`, err.message);
    }

    // ── Compute exact scene duration so we can pre-stretch videos ─────────────
    const fps30 = 30;
    const introF  = props.introClip  ? Math.round((props.introClip.durationSec  || 0) * fps30) : 0;
    const outroF  = props.outroClip  ? Math.round((props.outroClip.durationSec  || 0) * fps30) : 0;
    const contentF = (props.durationInFrames || 0) - introF - outroF;
    const numScenes = Math.max((props.imageUrls || []).length, 1);
    const sceneDurationSec = contentF / numScenes / fps30;
    console.log(`📐 sceneDurationSec = ${sceneDurationSec.toFixed(3)}s (${numScenes} scenes, ${contentF} content frames)`);

    // ── Prep all downloaded scene videos → CFR + pre-stretch if short ─────────
    try {
        console.log(`🔧 Prepping downloaded scene video(s) to H.264 CFR (with stretch if needed)...`);
        for (let i = 0; i < newUrls.length; i++) {
            const urlOrJson = newUrls[i];
            if (!urlOrJson) continue;

            // Check for JSON payload (composite/split)
            try {
                const parsed = JSON.parse(urlOrJson);

                if (parsed?.type === 'composite' && Array.isArray(parsed.assets)) {
                    for (let assetIdx = 0; assetIdx < parsed.assets.length; assetIdx++) {
                        const asset = parsed.assets[assetIdx];
                        if (asset.kind === 'video' && asset.url) {
                            const relPath = asset.url.replace(/^\//, '');
                            const srcAbs = path.join(cwd, 'public', relPath);
                            if (fs.existsSync(srcAbs) && !srcAbs.includes('_prepped')) {
                                const destAbs = srcAbs.replace('.mp4', '_prepped.mp4');
                                const ok = await prepVideoToNewPath(srcAbs, destAbs);
                                if (ok && fs.existsSync(destAbs)) {
                                    asset.url = `/${path.relative(path.join(cwd, 'public'), destAbs).replace(/\\/g, '/')}`;
                                    try { fs.unlinkSync(srcAbs); } catch {}
                                }
                            }
                        } else if (asset.kind === 'split' && Array.isArray(asset.urls)) {
                            for (let j = 0; j < asset.urls.length; j++) {
                                const relPath = asset.urls[j].replace(/^\//, '');
                                const srcAbs = path.join(cwd, 'public', relPath);
                                if (fs.existsSync(srcAbs) && !srcAbs.includes('_prepped')) {
                                    const destAbs = srcAbs.replace('.mp4', '_prepped.mp4');
                                    const ok = await prepVideoToNewPath(srcAbs, destAbs);
                                    if (ok && fs.existsSync(destAbs)) {
                                        asset.urls[j] = `/${path.relative(path.join(cwd, 'public'), destAbs).replace(/\\/g, '/')}`;
                                        try { fs.unlinkSync(srcAbs); } catch {}
                                    }
                                }
                            }
                        }
                    }
                    newUrls[i] = JSON.stringify(parsed);
                    continue;
                }

                if (parsed?.type === 'split' && Array.isArray(parsed.urls)) {
                    for (let j = 0; j < parsed.urls.length; j++) {
                        const relPath = parsed.urls[j].replace(/^\//, '');
                        const srcAbs = path.join(cwd, 'public', relPath);
                        if (fs.existsSync(srcAbs) && !srcAbs.includes('_prepped')) {
                            const destAbs = srcAbs.replace('.mp4', '_prepped.mp4');
                            const ok = await prepVideoToNewPath(srcAbs, destAbs);
                            if (ok && fs.existsSync(destAbs)) {
                                parsed.urls[j] = `/${path.relative(path.join(cwd, 'public'), destAbs).replace(/\\/g, '/')}`;
                                try { fs.unlinkSync(srcAbs); } catch {}
                            }
                        }
                    }
                    newUrls[i] = JSON.stringify(parsed);
                    continue;
                }
            } catch {
                // Regular scene video URL — prep regardless of whether it's already _prepped.
                // A stale _prepped.mp4 without tpad must be re-encoded.
                if (urlOrJson.endsWith('.mp4')) {
                    const relPath = urlOrJson.replace(/^\//, '');
                    const srcAbs = path.join(cwd, 'public', relPath);

                    // If the URL is already _prepped, treat it as the source for re-prepping.
                    // We'll write to _prepped2.mp4 then swap back to _prepped.mp4.
                    if (fs.existsSync(srcAbs)) {
                        const isAlreadyPrepped = srcAbs.includes('_prepped');
                        const destAbs = isAlreadyPrepped
                            ? srcAbs.replace('_prepped.mp4', '_prepped2.mp4')
                            : srcAbs.replace('.mp4', '_prepped.mp4');
                        const finalAbs = isAlreadyPrepped
                            ? srcAbs  // swap back to original _prepped.mp4 path
                            : destAbs;

                        const ok = await prepVideoToNewPath(srcAbs, destAbs);
                        if (ok && fs.existsSync(destAbs)) {
                            if (isAlreadyPrepped) {
                                // Swap _prepped2.mp4 → _prepped.mp4
                                try { fs.unlinkSync(srcAbs); } catch {}
                                try { fs.renameSync(destAbs, srcAbs); } catch {
                                    fs.copyFileSync(destAbs, srcAbs);
                                    try { fs.unlinkSync(destAbs); } catch {}
                                }
                                // URL stays the same (_prepped.mp4), just re-encoded
                            } else {
                                newUrls[i] = `/${path.relative(path.join(cwd, 'public'), finalAbs).replace(/\\/g, '/')}`;
                                try { fs.unlinkSync(srcAbs); } catch {}
                            }

                            // Validate: warn if video is dangerously short after prep
                            const checkDur = await probeVideoDuration(finalAbs);
                            if (checkDur && checkDur < 1.0) {
                                console.warn(`⚠️ Scene ${i} prepped video is only ${checkDur.toFixed(3)}s — likely a corrupt download. Rendering may crash.`);
                            }

                            // ── Pre-stretch: ensure video >= sceneDuration + 0.6s ──
                            if (sceneDurationSec > 0) {
                                const stretchedDur = await stretchSceneVideoToFit(finalAbs, sceneDurationSec);
                                if (stretchedDur) {
                                    props.sceneVideoDurations = props.sceneVideoDurations || [];
                                    props.sceneVideoDurations[i] = stretchedDur;
                                }
                            }
                        }
                    }
                }
            }
        }
        props.sceneVideoUrls = newUrls;
    } catch (e: any) {
        console.warn(`⚠️ Scene video prep failed:`, e.message);
    }

    // ── RE-PROBE all durations after prep ────────────────────────────────────
    try {
        if (!props.sceneVideoDurations || !Array.isArray(props.sceneVideoDurations)) {
            props.sceneVideoDurations = new Array((props.sceneVideoUrls || []).length).fill(undefined);
        }
        for (let i = 0; i < (props.sceneVideoUrls || []).length; i++) {
            const sceneUrl = props.sceneVideoUrls?.[i];
            if (!sceneUrl) continue;

            try {
                const parsed = JSON.parse(sceneUrl);

                if (parsed?.type === 'composite' && Array.isArray(parsed.assets)) {
                    let assetIdx = 0;
                    for (const asset of parsed.assets) {
                        if (asset.kind === 'video' && asset.url) {
                            const relPath = asset.url.replace(/^\//, '');
                            const absPath = path.join(cwd, 'public', relPath);
                            if (fs.existsSync(absPath)) asset.durationSec = await probeVideoDuration(absPath);
                        } else if (asset.kind === 'split' && Array.isArray(asset.urls)) {
                            if (!asset.durationsSec) asset.durationsSec = [];
                            for (let j = 0; j < asset.urls.length; j++) {
                                const relPath = asset.urls[j].replace(/^\//, '');
                                const absPath = path.join(cwd, 'public', relPath);
                                if (fs.existsSync(absPath)) asset.durationsSec[j] = await probeVideoDuration(absPath);
                            }
                            const valids = (asset.durationsSec || []).filter(Boolean);
                            if (valids.length > 0) asset.durationSec = Math.min(...valids);
                        }
                        assetIdx++;
                    }
                    props.sceneVideoUrls[i] = JSON.stringify(parsed);
                    const allDurs = parsed.assets.map((a: any) =>
                        a.durationSec || (a.durationsSec ? Math.min(...(a.durationsSec || []).filter(Boolean)) : 0)
                    ).filter(Boolean);
                    props.sceneVideoDurations[i] = allDurs.length > 0 ? Math.min(...allDurs) : undefined;
                    continue;
                }

                if (parsed?.type === 'split' && Array.isArray(parsed.urls)) {
                    if (!parsed.durationsSec) parsed.durationsSec = [];
                    for (let j = 0; j < parsed.urls.length; j++) {
                        const relPath = parsed.urls[j].replace(/^\//, '');
                        const absPath = path.join(cwd, 'public', relPath);
                        if (fs.existsSync(absPath)) parsed.durationsSec[j] = await probeVideoDuration(absPath);
                    }
                    props.sceneVideoUrls[i] = JSON.stringify(parsed);
                    const valids = (parsed.durationsSec || []).filter(Boolean);
                    props.sceneVideoDurations[i] = valids.length > 0 ? Math.min(...valids) : undefined;
                    continue;
                }
            } catch { /* regular URL */ }

            // Regular scene video — probe, then stretch if shorter than scene
            const relPath = sceneUrl.replace(/^\//, '');
            const absPath = path.join(cwd, 'public', relPath);
            if (fs.existsSync(absPath)) {
                // stretchSceneVideoToFit probes internally and only re-encodes if needed.
                // This handles both freshly downloaded files AND cached _prepped.mp4 hits.
                if (sceneDurationSec > 0) {
                    const stretchedDur = await stretchSceneVideoToFit(absPath, sceneDurationSec);
                    props.sceneVideoDurations[i] = stretchedDur ?? await probeVideoDuration(absPath);
                } else {
                    props.sceneVideoDurations[i] = await probeVideoDuration(absPath);
                }
            }
        }

        // Re-probe avatar clips after prep
        if (props.introClip?.videoUrl) {
            const rawUrl = props.introClip.videoUrl.replace(/^\//, '');
            const absPath = path.join(cwd, 'public', rawUrl);
            if (fs.existsSync(absPath)) {
                props.introClip.videoDurationSec = await probeVideoDuration(absPath);
                console.log(`⏱️ Re-probed intro avatar: ${props.introClip.videoDurationSec?.toFixed(3)}s`);
            }
        }

        if (props.outroClip?.videoUrl) {
            const rawUrl = props.outroClip.videoUrl.replace(/^\//, '');
            const absPath = path.join(cwd, 'public', rawUrl);
            if (fs.existsSync(absPath)) {
                props.outroClip.videoDurationSec = await probeVideoDuration(absPath);
                console.log(`⏱️ Re-probed outro avatar: ${props.outroClip.videoDurationSec?.toFixed(3)}s`);
            }
        }

        console.log(`✅ All durations re-probed.`);
    } catch (e: any) {
        console.warn(`⚠️ Re-probe step failed:`, e.message);
    }

    // ── Use public/ directly as Remotion public dir ───────────────────────────
    // IMPORTANT: Do NOT use a lean remotion-public/ dir.
    // Remotion hashes the public dir content to key its bundle cache.
    // If we copy assets into a fresh remotion-public/ every render, the hash
    // changes every time → Remotion deletes and re-bundles from scratch every
    // render (adds 60-90s). Using public/ directly keeps the cache warm.
    // The renders/ subdirectory does NOT affect bundling — it's served as-is.
    const effectivePublicDir = path.join(cwd, 'public');
    console.log(`📂 Remotion public dir: public/ (stable cache, no copy needed)`);


    // ── Verify critical assets exist in the EFFECTIVE public dir ──────────────
    const assetsToVerify = [
        { name: 'music', url: props.musicUrl },
        { name: 'intro', url: props.introClip?.videoUrl },
        { name: 'outro', url: props.outroClip?.videoUrl },
        { name: 'narration', url: props.audioUrl },
    ];

    console.log(`🔍 Verifying assets in ${effectivePublicDir}...`);
    for (const asset of assetsToVerify) {
        if (asset.url && asset.url.startsWith('/')) {
            const absPath = path.join(effectivePublicDir, asset.url.replace(/^\//, ''));
            if (fs.existsSync(absPath)) {
                const size = fs.statSync(absPath).size;
                console.log(`✅ Asset ${asset.name} found: ${asset.url} (${(size / 1024 / 1024).toFixed(2)} MB)`);
            } else {
                console.error(`❌ MISSING ASSET: ${asset.name} → expected at ${absPath}`);
                // If it's missing in remotion-public but exists in public, we have a sync issue
                const originalAbsPath = path.join(cwd, 'public', asset.url.replace(/^\//, ''));
                if (fs.existsSync(originalAbsPath)) {
                    console.log(`💡 Note: File exists in ORIGINAL public/ but was not copied to remotion-public/`);
                }
            }
        }
    }

    // ── Write props and run Remotion ──────────────────────────────────────────
    const propsPath = path.join(tmpDir, `props-${videoId}.json`);
    fs.writeFileSync(propsPath, JSON.stringify(props));

    const outputPath = path.join(rendersDir, `${videoId}.mp4`);
    const propsArg = propsPath.replace(/\\/g, '/');
    const outputArg = outputPath.replace(/\\/g, '/');
    const publicDirArg = effectivePublicDir.replace(/\\/g, '/');

    function buildRenderCommand(): string {
        return [
            'npx remotion render MainVideo',
            `"${outputArg}"`,
            `--props="${propsArg}"`,
            `--public-dir="${publicDirArg}"`,
            `--timeout=300000`,
            `--disable-web-security`,
            `--gl=angle`,
            `--concurrency=1`,
            `--jpeg-quality=75`,
        ].join(' ');
    }

    function executeRender(cmd: string): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            console.log(`💻 Executing: ${cmd.substring(0, 200)}...`);
            const child = exec(cmd, { cwd }, (error) => {
                if (error) return reject(error);
                resolve();
            });
            child.stdout?.on('data', (data) => console.log(`[Remotion] ${data.toString().trim()}`));
            child.stderr?.on('data', (data) => console.log(`[Remotion] ${data.toString().trim()}`));
        });
    }

    const MAX_ATTEMPTS = 3;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const cmd = buildRenderCommand();

        try {
            if (attempt > 0) {
                console.warn(`⚠️ Render error on attempt ${attempt}/${MAX_ATTEMPTS} for ${videoId}. Retrying...`);
                try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch { }
                fs.writeFileSync(propsPath, JSON.stringify(props));
            }
            await executeRender(cmd);
            break;
        } catch (error: any) {
            const errMsg = error?.message || error?.stderr || '';
            const isImageError = /error loading image|could not load image|EncodingError|source image cannot be decoded/i.test(errMsg);
            const isTimeout = /timeout|timed out/i.test(errMsg);
            const isRetryable = isImageError || isTimeout;
            const isLastAttempt = attempt === MAX_ATTEMPTS - 1;

            if (!isRetryable || isLastAttempt) {
                try { fs.unlinkSync(propsPath); } catch { }
                console.error(`❌ Local render failed for ${videoId}:`, error.message);
                // Best-effort DB update — don't let a DB timeout swallow the real render error
                try {
                    for (let dbAttempt = 0; dbAttempt < 3; dbAttempt++) {
                        try {
                            await db.update(shortVideoAssets).set({ status: 'failed' }).where(eq(shortVideoAssets.videoId, videoId));
                            break;
                        } catch { await new Promise(r => setTimeout(r, 3000)); }
                    }
                } catch { /* ignore secondary DB failure */ }
                throw error;
            }
            console.warn(`⚠️ Retryable error on attempt ${attempt + 1}/${MAX_ATTEMPTS}: ${isImageError ? 'image loading' : 'timeout'}`);
        }
    }

    // ── Success ───────────────────────────────────────────────────────────────
    try { fs.unlinkSync(propsPath); } catch { }

    const localUrl = `/renders/${videoId}.mp4`;
    console.log(`✅ Local render complete: ${localUrl}`);

    // ── Retry helper: exponential back-off for transient DB / network errors ──
    async function dbWithRetry<T>(label: string, fn: () => Promise<T>, maxAttempts = 5): Promise<T> {
        let lastErr: any;
        for (let i = 0; i < maxAttempts; i++) {
            try {
                return await fn();
            } catch (e: any) {
                lastErr = e;
                const isTransient =
                    /fetch failed|connect timeout|ECONNRESET|ETIMEDOUT|UND_ERR/i.test(e?.message || '') ||
                    /fetch failed|connect timeout|ECONNRESET|ETIMEDOUT|UND_ERR/i.test(e?.cause?.message || '');
                if (!isTransient || i === maxAttempts - 1) break;
                const delay = Math.pow(2, i + 1) * 1000; // 2s, 4s, 8s, 16s …
                console.warn(`⚠️ [${label}] DB transient error (attempt ${i + 1}/${maxAttempts}), retrying in ${delay / 1000}s: ${e?.cause?.message || e?.message}`);
                await new Promise(r => setTimeout(r, delay));
            }
        }
        throw lastErr;
    }

    try {
        const [asset] = await dbWithRetry('select-asset', () =>
            db.select().from(shortVideoAssets).where(eq(shortVideoAssets.videoId, videoId))
        );
        if (!asset?.thumbnailUrl) await ensureVideoThumbnail(videoId);
    } catch (e: any) {
        console.warn(`⚠️ Could not fetch asset for thumbnail check (non-fatal): ${e?.message}`);
    }

    await dbWithRetry('mark-completed', () =>
        db.update(shortVideoAssets).set({
            videoUrl: localUrl,
            status: 'completed',
        }).where(eq(shortVideoAssets.videoId, videoId))
    );
    console.log(`💾 DB updated → completed for ${videoId}`);
}

export async function ensureVideoThumbnail(videoId: string) {
    try {
        const [asset] = await db.select().from(shortVideoAssets).where(eq(shortVideoAssets.videoId, videoId));
        if (asset && asset.status === 'completed' && !asset.thumbnailUrl) {
            const script = asset.scriptData as any;
            const prompt = (script?.thumbnailPrompt ||
                `Cinematic masterpiece poster for: "${asset.videoTitle}". Stunning lighting.`)
                + " -- NO TEXT, NO WORDS. PURE IMAGE ONLY.";
            const thumbUrl = await generateNanoBananaImage(prompt, 1024, 1024);
            if (thumbUrl) {
                await db.update(shortVideoAssets).set({ thumbnailUrl: thumbUrl }).where(eq(shortVideoAssets.videoId, videoId));
                if (asset.seriesId) {
                    // ⚠️ IMPORTANT: Only set the series thumbnail if one doesn't already exist.
                    // A series has its own independently generated thumbnail that must never
                    // be overwritten by a per-video thumbnail. This prevents the bug where
                    // generating a new short inside a series replaces the series thumbnail.
                    const [seriesRow] = await db
                        .select({ thumbnailUrl: shortVideoSeries.thumbnailUrl })
                        .from(shortVideoSeries)
                        .where(eq(shortVideoSeries.seriesId, asset.seriesId));
                    if (!seriesRow?.thumbnailUrl) {
                        await db.update(shortVideoSeries).set({ thumbnailUrl: thumbUrl }).where(eq(shortVideoSeries.seriesId, asset.seriesId));
                    }
                }
                return thumbUrl;
            }
        }
    } catch (err: any) {
        console.warn(`⚠️ Failed to ensure thumbnail for ${videoId}:`, err.message);
    }
    return null;
}

export async function triggerMotionGraphicRender(projectId: string, props: Record<string, any>) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL
        || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null);

    const githubToken = process.env.GH_PAT;
    const repoOwner = process.env.GH_OWNER || "keshav-agrawal595";
    const repoName = process.env.GH_REPO || "Migoo";

    // Detect if cloud rendering can be used
    const isCloud = !!(githubToken && process.env.GH_OWNER && process.env.GH_REPO && appUrl);

    if (!isCloud) {
        console.log(`🎬 Starting LOCAL motion graphic render for: ${projectId}`);
        
        await db.update(motionGraphicProjects)
            .set({ status: 'generating:video', updatedAt: new Date() })
            .where(eq(motionGraphicProjects.projectId, projectId));

        renderMotionGraphicLocally(projectId, props).catch((err) => {
            console.error(`❌ Local motion graphic render failed for ${projectId}:`, err);
        });

        return { success: true, mode: 'local' };
    }

    // CLOUD MODE
    console.log(`🎬 Triggering GitHub Action motion graphic rendering for: ${projectId} via repo ${repoOwner}/${repoName}`);

    const webhookUrl = `${appUrl}/api/motion-graphics/${projectId}/webhook`;

    const response = await fetch(`https://api.github.com/repos/${repoOwner}/${repoName}/dispatches`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${githubToken}`,
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify({
            event_type: 'render-motion-graphic',
            client_payload: {
                projectId,
                webhookUrl,
                propsUrl: `${appUrl}/api/motion-graphics/${projectId}/props`,
            },
        }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`GitHub dispatch failed: ${response.status} ${errorText}`);
    }

    await db.update(motionGraphicProjects)
        .set({ status: 'generating:video', updatedAt: new Date() })
        .where(eq(motionGraphicProjects.projectId, projectId));
        
    return { success: true, mode: 'cloud' };
}

async function renderMotionGraphicLocally(projectId: string, props: Record<string, any>) {
    const cwd = process.cwd();
    const tmpDir = path.join(cwd, 'public', 'tmp');
    const rendersDir = path.join(cwd, 'public', 'renders');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    if (!fs.existsSync(rendersDir)) fs.mkdirSync(rendersDir, { recursive: true });

    const remotionPubDir = path.join(cwd, 'remotion-assets-mg');
    const assetsDirRel = `tmp/assets_mg_${projectId}`;
    const assetsDirAbs = path.join(cwd, 'public', assetsDirRel);
    const propsPath = path.join(tmpDir, `props-mg-${projectId}.json`);
    
    try {
        // Clean up stale tmp directories
        try {
            const tmpEntries = fs.readdirSync(tmpDir);
            for (const entry of tmpEntries) {
                if (entry.startsWith('assets_mg_') && entry !== `assets_mg_${projectId}`) {
                    const staleDir = path.join(tmpDir, entry);
                    try { fs.rmSync(staleDir, { recursive: true, force: true }); } catch {}
                }
            }
        } catch {}

        if (fs.existsSync(assetsDirAbs)) {
            try { fs.rmSync(assetsDirAbs, { recursive: true, force: true }); } catch {}
        }
        fs.mkdirSync(assetsDirAbs, { recursive: true });

        const toLocalUrl = (absPath: string): string => {
            const relPath = path.relative(path.join(cwd, 'public'), absPath).replace(/\\/g, '/');
            return `http://localhost:3000/${relPath}`;
        };

        const localProps = JSON.parse(JSON.stringify(props));

        // Download scenes assets
        if (localProps.scenes && Array.isArray(localProps.scenes)) {
            for (let i = 0; i < localProps.scenes.length; i++) {
                const scene = localProps.scenes[i];
                if (scene.imageUrl && scene.imageUrl.startsWith('http')) {
                    try {
                        const response = await fetch(scene.imageUrl);
                        if (response.ok) {
                            const buffer = Buffer.from(await response.arrayBuffer());
                            const contentType = response.headers.get('content-type') || '';
                            const isMp4Magic = buffer.length > 7 &&
                                buffer[4] === 0x66 && buffer[5] === 0x74 &&
                                buffer[6] === 0x79 && buffer[7] === 0x70;
                            let ext: string;
                            if (contentType.includes('video') || isMp4Magic) {
                                ext = 'mp4';
                            } else if (contentType.includes('png') || (buffer[0] === 0x89 && buffer[1] === 0x50)) {
                                ext = 'png';
                            } else if (contentType.includes('webp') || (buffer[0] === 0x52 && buffer[1] === 0x49)) {
                                ext = 'webp';
                            } else if (contentType.includes('gif') || (buffer[0] === 0x47 && buffer[1] === 0x49)) {
                                ext = 'gif';
                            } else {
                                ext = 'jpg';
                            }

                            if (ext === 'mp4') {
                                const srcMp4 = path.join(assetsDirAbs, `scene_${i}_src.mp4`);
                                const destMp4 = path.join(assetsDirAbs, `scene_${i}.mp4`);
                                fs.writeFileSync(srcMp4, buffer);
                                try {
                                    const ffmpegBin = getFFmpegPath();
                                    const { execSync } = require('child_process');
                                    execSync(
                                        `"${ffmpegBin}" -y -i "${srcMp4}" -c:v libx264 -preset fast -crf 23 -profile:v baseline -level 3.1 -pix_fmt yuv420p -r 30 -g 30 -movflags +faststart -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" -an "${destMp4}"`,
                                        { timeout: 120000, stdio: 'pipe' }
                                    );
                                    if (fs.existsSync(destMp4) && fs.statSync(destMp4).size > 1000) {
                                        const localUrl = toLocalUrl(destMp4);
                                        localProps.scenes[i] = { ...scene, imageUrl: localUrl };
                                    } else {
                                        localProps.scenes[i] = { ...scene, imageUrl: '' };
                                    }
                                } catch (transcodeErr) {
                                    localProps.scenes[i] = { ...scene, imageUrl: '' };
                                } finally {
                                    try { fs.unlinkSync(srcMp4); } catch {}
                                }
                            } else {
                                const destAbs = path.join(assetsDirAbs, `scene_${i}.${ext}`);
                                fs.writeFileSync(destAbs, buffer);
                                const localUrl = toLocalUrl(destAbs);
                                localProps.scenes[i] = { ...scene, imageUrl: localUrl };
                            }
                        } else {
                            localProps.scenes[i] = { ...scene, imageUrl: '' };
                        }
                    } catch (err) {
                        localProps.scenes[i] = { ...scene, imageUrl: '' };
                    }
                }
            }
        }

        // Download music locally
        if (localProps.musicUrl && localProps.musicUrl.startsWith('http')) {
            try {
                const destAbs = path.join(assetsDirAbs, 'music.mp3');
                const response = await fetch(localProps.musicUrl);
                if (response.ok) {
                    const buffer = Buffer.from(await response.arrayBuffer());
                    fs.writeFileSync(destAbs, buffer);
                    localProps.musicUrl = toLocalUrl(destAbs);
                }
            } catch (err) {}
        }

        // Download voiceover audio locally
        if (localProps.audioUrl && localProps.audioUrl.startsWith('http')) {
            try {
                const destAbs = path.join(assetsDirAbs, 'voiceover.wav');
                const response = await fetch(localProps.audioUrl);
                if (response.ok) {
                    const buffer = Buffer.from(await response.arrayBuffer());
                    fs.writeFileSync(destAbs, buffer);
                    if (fs.existsSync(destAbs) && fs.statSync(destAbs).size > 100) {
                        localProps.audioUrl = toLocalUrl(destAbs);
                    }
                }
            } catch (err) {}
        }

        try { if (fs.existsSync(propsPath)) fs.unlinkSync(propsPath); } catch {}
        try { fs.rmSync(remotionPubDir, { recursive: true, force: true }); } catch {}
        
        const remotionAssetsDest = path.join(remotionPubDir, 'tmp', `assets_mg_${projectId}`);
        fs.mkdirSync(remotionAssetsDest, { recursive: true });

        const assetFiles = fs.readdirSync(assetsDirAbs);
        for (const file of assetFiles) {
            fs.copyFileSync(
                path.join(assetsDirAbs, file),
                path.join(remotionAssetsDest, file)
            );
        }

        fs.writeFileSync(propsPath, JSON.stringify(localProps));

        const outputPath = path.join(rendersDir, `mg_${projectId}.mp4`);
        const propsArg = propsPath.replace(/\\/g, '/');
        const outputArg = outputPath.replace(/\\/g, '/');
        const publicDirArg = remotionPubDir.replace(/\\/g, '/');

        const cmd = [
            'npx remotion render MotionGraphic',
            `"${outputArg}"`,
            `--props="${propsArg}"`,
            `--public-dir="${publicDirArg}"`,
            `--timeout=120000`,
            `--disable-web-security`,
            `--gl=angle`,
            `--concurrency=1`,
            `--jpeg-quality=75`,
        ].join(' ');

        await new Promise<void>((resolve, reject) => {
            const child = exec(cmd, { cwd }, (error) => {
                if (error) return reject(error);
                resolve();
            });
        });

        // Clean up
        try { fs.rmSync(remotionPubDir, { recursive: true, force: true }); } catch {}
        try { fs.unlinkSync(propsPath); } catch {}
        try { fs.rmSync(assetsDirAbs, { recursive: true, force: true }); } catch {}

        const localUrl = `/renders/mg_${projectId}.mp4`;
        
        // Finalize DB
        await db.update(motionGraphicProjects)
            .set({
                videoUrl: localUrl,
                status: 'completed',
                updatedAt: new Date(),
            })
            .where(eq(motionGraphicProjects.projectId, projectId));

        await db.insert(motionGraphicMessages).values({
            projectId,
            role: "system",
            content: `✅ Motion graphic video rendered locally! Your video is ready to play.`,
            metadata: { type: "render_complete", videoUrl: localUrl },
        });

    } catch (err: any) {
        console.error(`❌ Local motion graphic render failed for ${projectId}:`, err);
        
        // Clean up on failure
        try { fs.rmSync(remotionPubDir, { recursive: true, force: true }); } catch {}
        try { if (fs.existsSync(propsPath)) fs.unlinkSync(propsPath); } catch {}
        try { fs.rmSync(assetsDirAbs, { recursive: true, force: true }); } catch {}

        await db.update(motionGraphicProjects)
            .set({ status: 'failed', updatedAt: new Date() })
            .where(eq(motionGraphicProjects.projectId, projectId));

        await db.insert(motionGraphicMessages).values({
            projectId,
            role: "system",
            content: `❌ Video rendering failed locally.`,
            metadata: { type: "render_failed" },
        });
    }
}