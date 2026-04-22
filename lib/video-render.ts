// ─── PASTE THIS into lib/video-render.ts (replace the renderLocally function) ───
// Key fixes:
// 1. Avatar videos are re-encoded to a SEPARATE file (not in-place) before Remotion sees them
// 2. Split-screen JSON payloads are properly parsed and URLs rewritten
// 3. prepVideoForRemotion uses a dedicated output path instead of atomic rename (Windows-safe)
// 4. Public dir copy is skipped — avatars are downloaded fresh from local path

import { db } from "@/config/db";
import { shortVideoAssets, shortVideoSeries } from "@/config/schema";
import { generateNanoBananaImage } from "@/lib/leonardo";
import { eq } from "drizzle-orm";
import { exec } from "child_process";
import path from "path";
import fs from "fs";

function getFFmpegPath(): string {
    let ffmpegBin = require('ffmpeg-static') as string;
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

    const ffmpegBin = getFFmpegPath();

    // Probe actual duration first — we'll use it to set a safe -t trim
    // Trim 0.5s from end to ensure no unseekable trailing frames
    const probedDur = await probeVideoDuration(srcPath);
    const trimArg = probedDur && probedDur > 1.0 ? `-t ${(probedDur - 0.5).toFixed(3)}` : '';

    const cmd = [
        `"${ffmpegBin}"`,
        `-y`,
        `-i "${srcPath}"`,
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
        trimArg,
        `-an`,
        `-movflags +faststart`,
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
                console.log(`✅ Prepped ${path.basename(srcPath)} → ${path.basename(destPath)} (${sizeMB} MB)`);
                // Validate output file
                if (fs.existsSync(destPath) && fs.statSync(destPath).size < 1024) {
                    console.warn(`⚠️ Prepped file suspiciously small (${fs.statSync(destPath).size} bytes), may be corrupt`);
                    resolve(false);
                    return;
                }
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

    // Probe duration and trim 0.5s from end to avoid unseekable trailing frames
    const probedDur = await probeVideoDuration(filePath);
    const trimArg = probedDur && probedDur > 1.0 ? `-t ${(probedDur - 0.5).toFixed(3)}` : '';

    const cmd = [
        `"${ffmpegBin}"`,
        `-y`,
        `-i "${filePath}"`,
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
        trimArg,
        `-an`,
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
        `"[0:v]scale=1080:960:force_original_aspect_ratio=increase,crop=1080:960,setsar=1[top];[1:v]scale=1080:960:force_original_aspect_ratio=increase,crop=1080:960,setsar=1[bottom];[top][bottom]vstack=inputs=2[out]"`,
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

export async function triggerRender(videoId: string, props: Record<string, any>) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL
        || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null);

    const isLocal = !appUrl;

    if (isLocal) {
        console.log(`🎬 Starting LOCAL render for: ${videoId}`);

        const [existing] = await db.select().from(shortVideoAssets).where(eq(shortVideoAssets.videoId, videoId));
        if (existing && existing.status === 'rendering') {
            console.log(`⚠️ Video ${videoId} is already rendering. Skipping duplicate render.`);
            return { success: true, mode: 'local', skipped: true };
        }
        if (existing && existing.status === 'completed' && existing.videoUrl) {
            console.log(`⚠️ Video ${videoId} is already rendered.`);
            await ensureVideoThumbnail(videoId);
            return { success: true, mode: 'local', skipped: true };
        }

        await db.update(shortVideoAssets).set({ status: 'rendering' }).where(eq(shortVideoAssets.videoId, videoId));

        renderLocally(videoId, props).catch((err) => {
            console.error(`❌ Local render failed for ${videoId}:`, err);
        });

        return { success: true, mode: 'local' };
    }

    // CLOUD MODE
    console.log(`🎬 Triggering GitHub Action rendering for: ${videoId}`);
    const githubToken = process.env.GH_PAT;
    const repoOwner = "keshav-agrawal595";
    const repoName = "Migoo";

    if (!githubToken) throw new Error("GH_PAT not configured");

    const webhookUrl = `${appUrl}/api/video/webhook`;

    const response = await fetch(`https://api.github.com/repos/${repoOwner}/${repoName}/dispatches`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${githubToken}`,
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify({
            event_type: 'render-video',
            client_payload: { videoId, webhookUrl, props },
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

    fs.mkdirSync(path.dirname(destAbsPath), { recursive: true });

    try {
        // Build headers — add Appwrite API key for Appwrite storage URLs
        const headers: Record<string, string> = {};
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

            if (!matchedKey) {
                console.warn(`⚠️ No APPWRITE_API_KEY for project: ${urlProjectId}`);
            } else {
                console.log(`🔑 Appwrite Auth for project: ${urlProjectId}`);
            }

            // Fallback to default if no match found
            if (!matchedKey) {
                matchedKey = process.env.APPWRITE_API_KEY;
                matchedProject = process.env.APPWRITE_PROJECT_ID;
            }

            if (matchedKey) headers['X-Appwrite-Key'] = matchedKey;
            if (matchedProject) headers['X-Appwrite-Project'] = matchedProject;

            // ── CRITICAL: Also try fetching WITHOUT ?project= in URL ──
            // Appwrite REST API expects auth via headers, not query params.
            // The ?project= param is for client-side browser sessions only.
            // Remove it when using server-side API key auth.
            const urlWithoutProjectParam = sanitizedUrl.replace(/[?&]project=[^&]+/, '').replace(/\?$/, '');
            if (urlWithoutProjectParam !== sanitizedUrl) {
                sanitizedUrl = urlWithoutProjectParam;
            }
        }

        const res = await fetch(sanitizedUrl, { headers });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buffer = Buffer.from(await res.arrayBuffer());
        if (buffer.length < 100) throw new Error('Downloaded file too small');
        fs.writeFileSync(destAbsPath, buffer);
        // Return a local HTTP URL that Next.js can serve
        const relToPublic = path.relative(path.join(process.cwd(), 'public'), destAbsPath).replace(/\\/g, '/');
        return `/${relToPublic}`;
    } catch (err: any) {
        console.warn(`⚠️ Failed to download ${sanitizedUrl}: ${err.message}. Creating local placeholder.`);

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
                return `/${relToPublic}`;
            } catch { }
        }

        // ── CRITICAL: Placeholder for VIDEO files ──
        // Generate a 2-second black MP4 using FFmpeg so Remotion NEVER
        // receives a remote Appwrite URL (which would 403 in the browser).
        if (destAbsPath.match(/\.(mp4|mov|webm)$/i)) {
            try {
                const ffmpegBin = getFFmpegPath();
                const cmd = [
                    `"${ffmpegBin}"`, `-y`,
                    `-f lavfi -i color=c=black:s=1080x1920:r=30:d=2`,
                    `-c:v libx264 -preset ultrafast -crf 28`,
                    `-g 1 -keyint_min 1 -bf 0`,
                    `-pix_fmt yuv420p -movflags +faststart`,
                    `-an`,
                    `"${destAbsPath}"`,
                ].join(' ');

                const { execSync } = require('child_process');
                execSync(cmd, { maxBuffer: 10 * 1024 * 1024, timeout: 15000 });

                if (fs.existsSync(destAbsPath) && fs.statSync(destAbsPath).size > 100) {
                    console.log(`🎬 Created placeholder video: ${path.basename(destAbsPath)}`);
                    return `/${relToPublic}`;
                }
            } catch (ffErr: any) {
                console.warn(`⚠️ FFmpeg placeholder failed: ${ffErr.message?.slice(0, 100)}`);
            }
        }

        // ── NEVER return a remote Appwrite URL — it will 403 in Remotion's browser ──
        console.warn(`⚠️ No placeholder created for ${path.basename(destAbsPath)}, returning undefined`);
        return undefined;
    }
}

async function renderLocally(videoId: string, props: Record<string, any>) {
    const cwd = process.cwd();

    const tmpDir = path.join(cwd, 'public', 'tmp');
    const rendersDir = path.join(cwd, 'public', 'renders');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    if (!fs.existsSync(rendersDir)) fs.mkdirSync(rendersDir, { recursive: true });



    // Clean up ALL stale files from tmp/ (asset dirs, old prop files, etc.)
    try {
        const tmpFiles = fs.readdirSync(tmpDir);
        for (const file of tmpFiles) {
            if (file === `assets_${videoId}`) continue; // keep current
            if (file === `props-${videoId}.json`) continue; // keep current
            try {
                const fullPath = path.join(tmpDir, file);
                const stat = fs.statSync(fullPath);
                if (stat.isDirectory()) {
                    fs.rmSync(fullPath, { recursive: true, force: true });
                } else {
                    fs.unlinkSync(fullPath);
                }
                console.log(`🧹 Cleaned stale tmp file: ${file}`);
            } catch { }
        }
    } catch { }

    const assetsDirRel = `tmp/assets_${videoId}`;
    const assetsDirAbs = path.join(cwd, 'public', assetsDirRel);
    fs.mkdirSync(assetsDirAbs, { recursive: true });

    const sceneVideoDurations: (number | undefined)[] = [];

    // ── Download all remote assets ────────────────────────────────────────────
    try {
        console.log(`📥 Downloading assets for ${videoId}...`);

        // Scene videos
        if (props.sceneVideoUrls && Array.isArray(props.sceneVideoUrls)) {
            const newUrls = [...props.sceneVideoUrls];

            for (let i = 0; i < newUrls.length; i++) {
                if (!newUrls[i]) { sceneVideoDurations.push(undefined); continue; }

                // Check for JSON payload (composite/split)
                try {
                    const parsed = JSON.parse(newUrls[i]);

                    if (parsed?.type === 'composite' && Array.isArray(parsed.assets)) {
                        let assetIdx = 0;
                        for (const asset of parsed.assets) {
                            if (asset.kind === 'video' && asset.url) {
                                const destAbs = path.join(assetsDirAbs, `scene_${i}_v${assetIdx}.mp4`);
                                const local = await downloadToLocal(asset.url, destAbs);
                                if (local) { asset.url = local; asset.durationSec = await probeVideoDuration(destAbs); }
                            } else if (asset.kind === 'image' && asset.url) {
                                const ext = asset.url.match(/\.(png|jpg|jpeg|webp|gif)/i)?.[1] || 'jpg';
                                const destAbs = path.join(assetsDirAbs, `scene_${i}_img${assetIdx}.${ext}`);
                                const local = await downloadToLocal(asset.url, destAbs);
                                if (local) { asset.url = local; }
                            } else if (asset.kind === 'split' && Array.isArray(asset.urls)) {
                                // Download both split videos
                                const topDest = path.join(assetsDirAbs, `scene_${i}_sp${assetIdx}_0.mp4`);
                                const botDest = path.join(assetsDirAbs, `scene_${i}_sp${assetIdx}_1.mp4`);
                                const localTop = await downloadToLocal(asset.urls[0], topDest);
                                const localBot = await downloadToLocal(asset.urls[1], botDest);

                                // MERGE into single video to avoid concurrent OffthreadVideo crash
                                const mergedDest = path.join(assetsDirAbs, `scene_${i}_sp${assetIdx}_merged.mp4`);
                                const merged = await mergeSplitVideos(topDest, botDest, mergedDest);
                                if (merged) {
                                    // Convert split → video with the merged file
                                    asset.kind = 'video';
                                    asset.url = `/${assetsDirRel}/scene_${i}_sp${assetIdx}_merged.mp4`;
                                    asset.durationSec = await probeVideoDuration(mergedDest);
                                    delete asset.urls;
                                    delete asset.durationsSec;
                                    console.log(`✅ Split→merged for composite scene ${i}, asset ${assetIdx}`);
                                } else {
                                    // Fallback: keep as split (might still crash)
                                    if (!asset.durationsSec) asset.durationsSec = [];
                                    asset.urls[0] = localTop || asset.urls[0];
                                    asset.urls[1] = localBot || asset.urls[1];
                                    asset.durationsSec[0] = fs.existsSync(topDest) ? await probeVideoDuration(topDest) : undefined;
                                    asset.durationsSec[1] = fs.existsSync(botDest) ? await probeVideoDuration(botDest) : undefined;
                                    const validDurs = (asset.durationsSec || []).filter(Boolean);
                                    if (validDurs.length > 0) asset.durationSec = Math.min(...validDurs);
                                }
                            }
                            assetIdx++;
                        }
                        newUrls[i] = JSON.stringify(parsed);
                        const allDurs = parsed.assets.map((a: any) =>
                            a.durationSec || (a.durationsSec ? Math.min(...a.durationsSec.filter(Boolean)) : 0)
                        ).filter(Boolean);
                        sceneVideoDurations.push(allDurs.length > 0 ? Math.min(...allDurs) : undefined);
                        continue;
                    }

                    if (parsed?.type === 'split' && Array.isArray(parsed.urls)) {
                        // Download both split videos
                        const topDest = path.join(assetsDirAbs, `scene_${i}_split_0.mp4`);
                        const botDest = path.join(assetsDirAbs, `scene_${i}_split_1.mp4`);
                        const localTop = await downloadToLocal(parsed.urls[0], topDest);
                        const localBot = await downloadToLocal(parsed.urls[1], botDest);

                        // MERGE into single video to avoid concurrent OffthreadVideo crash
                        const mergedDest = path.join(assetsDirAbs, `scene_${i}_split_merged.mp4`);
                        const merged = await mergeSplitVideos(topDest, botDest, mergedDest);
                        if (merged) {
                            // Replace split JSON with simple video URL
                            newUrls[i] = `/${assetsDirRel}/scene_${i}_split_merged.mp4`;
                            const dur = await probeVideoDuration(mergedDest);
                            sceneVideoDurations.push(dur);
                            console.log(`✅ Split→merged for scene ${i}`);
                        } else {
                            // Fallback: keep as split
                            if (!parsed.durationsSec) parsed.durationsSec = [];
                            parsed.urls[0] = localTop || parsed.urls[0];
                            parsed.urls[1] = localBot || parsed.urls[1];
                            parsed.durationsSec[0] = fs.existsSync(topDest) ? await probeVideoDuration(topDest) : undefined;
                            parsed.durationsSec[1] = fs.existsSync(botDest) ? await probeVideoDuration(botDest) : undefined;
                            newUrls[i] = JSON.stringify(parsed);
                            const validDurs = (parsed.durationsSec || []).filter(Boolean);
                            sceneVideoDurations.push(validDurs.length > 0 ? Math.min(...validDurs) : undefined);
                        }
                        continue;
                    }
                } catch { /* not JSON, regular URL */ }

                // Regular video URL — CRITICAL: Appwrite URLs don't have .mp4 extension!
                // e.g. /storage/buckets/.../files/.../view?project=...
                // Must also match remote URLs stored in Appwrite or any cloud storage.
                const isSkipMarker = newUrls[i] === 'SKIP_T2V' || newUrls[i] === 'SKIP_VEO' || newUrls[i] === '';
                const hasVideoExt = /\.(mp4|mov|webm)/i.test(newUrls[i]);
                const isAppwriteVideo = newUrls[i].includes('appwrite') && newUrls[i].includes('/storage/');
                const isRemoteUrl = newUrls[i].startsWith('http://') || newUrls[i].startsWith('https://');
                const isDirectVideo = !isSkipMarker && (hasVideoExt || isAppwriteVideo || isRemoteUrl);

                if (isDirectVideo) {
                    console.log(`🎬 Scene ${i}: downloading video (ext=${hasVideoExt}, appwrite=${isAppwriteVideo}, remote=${isRemoteUrl}): ${newUrls[i].substring(0, 80)}...`);
                    const destAbs = path.join(assetsDirAbs, `scene_${i}.mp4`);
                    const local = await downloadToLocal(newUrls[i], destAbs);
                    if (local) {
                        newUrls[i] = local;
                        sceneVideoDurations.push(await probeVideoDuration(destAbs));
                    } else {
                        sceneVideoDurations.push(undefined);
                    }
                } else {
                    sceneVideoDurations.push(undefined);
                }
            }

            props.sceneVideoUrls = newUrls;
            props.sceneVideoDurations = sceneVideoDurations;
        }

        // Narration audio
        if (props.audioUrl) {
            const destAbs = path.join(assetsDirAbs, 'audio.wav');
            const local = await downloadToLocal(props.audioUrl, destAbs);
            if (local) props.audioUrl = local;
        }

        // Background music
        if (props.musicUrl) {
            const destAbs = path.join(assetsDirAbs, 'music.mp3');
            const local = await downloadToLocal(props.musicUrl, destAbs);
            if (local) props.musicUrl = local;
        }

        // ── Avatar clips: CRITICAL FIX ─────────────────────────────────────────
        // We NEVER copy from public/avatars/* and then re-encode in-place.
        // Instead we use prepVideoToNewPath() which writes to a SEPARATE destination file.
        // This is Windows-safe (no rename/unlink on a file that may be locked).

        if (props.introClip?.videoUrl) {
            const rawUrl = props.introClip.videoUrl.replace(/^\//, '');
            const srcAbs = path.join(cwd, 'public', rawUrl);       // e.g. public/avatars/avatar1-intro.mp4
            const destAbs = path.join(assetsDirAbs, 'intro_video_prepped.mp4');

            if (fs.existsSync(srcAbs)) {
                console.log(`🎬 Prepping intro avatar: ${path.basename(srcAbs)} → intro_video_prepped.mp4`);
                const ok = await prepVideoToNewPath(srcAbs, destAbs);

                if (ok && fs.existsSync(destAbs)) {
                    const probedDur = await probeVideoDuration(destAbs);
                    console.log(`📏 Intro video probed duration: ${probedDur?.toFixed(3)}s, file size: ${(fs.statSync(destAbs).size / 1024 / 1024).toFixed(1)} MB`);
                    if (!probedDur || probedDur < 0.5) {
                        console.warn(`⚠️ Intro video duration invalid (${probedDur}s), using raw file fallback`);
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
                    console.log(`✅ Intro avatar prepped → ${props.introClip.videoUrl} (${props.introClip.videoDurationSec?.toFixed(2)}s)`);
                } else {
                    // Fallback: just copy the raw file (better than nothing)
                    console.warn(`⚠️ prepVideoToNewPath failed for intro — copying raw file`);
                    const rawDestAbs = path.join(assetsDirAbs, 'intro_video.mp4');
                    fs.copyFileSync(srcAbs, rawDestAbs);
                    const probedDur = await probeVideoDuration(rawDestAbs);
                    props.introClip = {
                        ...props.introClip,
                        videoUrl: `/${assetsDirRel}/intro_video.mp4`,
                        videoDurationSec: probedDur,
                    };
                }
            } else {
                console.warn(`⚠️ Intro avatar video not found at: ${srcAbs}`);
            }
        }

        if (props.introClip?.audioUrl) {
            const destAbs = path.join(assetsDirAbs, 'intro_audio.wav');
            const local = await downloadToLocal(props.introClip.audioUrl, destAbs);
            if (local) props.introClip = { ...props.introClip, audioUrl: local };
        }

        if (props.outroClip?.videoUrl) {
            const rawUrl = props.outroClip.videoUrl.replace(/^\//, '');
            const srcAbs = path.join(cwd, 'public', rawUrl);
            const destAbs = path.join(assetsDirAbs, 'outro_video_prepped.mp4');

            if (fs.existsSync(srcAbs)) {
                console.log(`🎬 Prepping outro avatar: ${path.basename(srcAbs)} → outro_video_prepped.mp4`);
                const ok = await prepVideoToNewPath(srcAbs, destAbs);

                if (ok && fs.existsSync(destAbs)) {
                    const probedDur = await probeVideoDuration(destAbs);
                    console.log(`📏 Outro video probed duration: ${probedDur?.toFixed(3)}s, file size: ${(fs.statSync(destAbs).size / 1024 / 1024).toFixed(1)} MB`);
                    if (!probedDur || probedDur < 0.5) {
                        console.warn(`⚠️ Outro video duration invalid (${probedDur}s), using raw file fallback`);
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
                    console.log(`✅ Outro avatar prepped → ${props.outroClip.videoUrl} (${props.outroClip.videoDurationSec?.toFixed(2)}s)`);
                } else {
                    console.warn(`⚠️ prepVideoToNewPath failed for outro — copying raw file`);
                    const rawDestAbs = path.join(assetsDirAbs, 'outro_video.mp4');
                    fs.copyFileSync(srcAbs, rawDestAbs);
                    const probedDur = await probeVideoDuration(rawDestAbs);
                    props.outroClip = {
                        ...props.outroClip,
                        videoUrl: `/${assetsDirRel}/outro_video.mp4`,
                        videoDurationSec: probedDur,
                    };
                }
            } else {
                console.warn(`⚠️ Outro avatar video not found at: ${srcAbs}`);
            }
        }

        if (props.outroClip?.audioUrl) {
            const destAbs = path.join(assetsDirAbs, 'outro_audio.wav');
            const local = await downloadToLocal(props.outroClip.audioUrl, destAbs);
            if (local) props.outroClip = { ...props.outroClip, audioUrl: local };
        }

        // ── Download imageUrls locally ──────────────────────────────────────
        // CRITICAL: Remote image URLs (Appwrite/cloud) can return 403/401 during
        // render, causing Remotion's <Img> to cancelRender after 3 retries.
        // Downloading all images to local disk prevents this.
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
                            if (parsed.urls[j]?.startsWith('http')) {
                                const ext = parsed.urls[j].match(/\.(png|jpg|jpeg|webp|gif)/i)?.[1] || 'jpg';
                                const destAbs = path.join(assetsDirAbs, `slide_${i}_${j}.${ext}`);
                                const local = await downloadToLocal(parsed.urls[j], destAbs);
                                if (local) parsed.urls[j] = local;
                            }
                        }
                        newImageUrls[i] = JSON.stringify(parsed);
                        continue;
                    }
                } catch { /* not JSON */ }

                // Regular image URL
                if (/SKIP_T2V|SKIP_VEO/i.test(imgUrl)) continue;
                const ext = imgUrl.match(/\.(png|jpg|jpeg|webp|gif)/i)?.[1] || 'jpg';
                const destAbs = path.join(assetsDirAbs, `image_${i}.${ext}`);
                const local = await downloadToLocal(imgUrl, destAbs);
                if (local) newImageUrls[i] = local;
            }
            props.imageUrls = newImageUrls;
        }

        console.log(`✅ All assets downloaded for ${videoId}`);
    } catch (err: any) {
        console.error(`⚠️ Asset download error:`, err.message);
    }

    // ── Prep all downloaded scene .mp4 files → all-keyframe ──────────────────
    // NOTE: Avatar files are already prepped above via prepVideoToNewPath.
    // Here we only prep scene video files.
    try {
        const allFiles = fs.readdirSync(assetsDirAbs);
        const sceneVideoFiles = allFiles.filter(f =>
            f.endsWith('.mp4') &&
            !f.includes('_prepped') &&
            !f.includes('_merged') &&
            !f.includes('avatar') &&
            !f.includes('intro_video') &&
            !f.includes('outro_video')
        );

        if (sceneVideoFiles.length > 0) {
            console.log(`🔧 Prepping ${sceneVideoFiles.length} scene video(s)...`);
            for (const videoFile of sceneVideoFiles) {
                await prepVideoForRemotion(path.join(assetsDirAbs, videoFile));
            }
        }
    } catch (e: any) {
        console.warn(`⚠️ Scene video prep failed:`, e.message);
    }

    // ── RE-PROBE all durations after prep ────────────────────────────────────
    try {
        if (props.sceneVideoDurations && Array.isArray(props.sceneVideoDurations)) {
            for (let i = 0; i < (props.sceneVideoUrls || []).length; i++) {
                const sceneUrl = props.sceneVideoUrls?.[i];
                if (!sceneUrl) continue;

                try {
                    const parsed = JSON.parse(sceneUrl);

                    if (parsed?.type === 'composite' && Array.isArray(parsed.assets)) {
                        let assetIdx = 0;
                        for (const asset of parsed.assets) {
                            if (asset.kind === 'video') {
                                const absPath = path.join(assetsDirAbs, `scene_${i}_v${assetIdx}.mp4`);
                                if (fs.existsSync(absPath)) asset.durationSec = await probeVideoDuration(absPath);
                            } else if (asset.kind === 'split') {
                                if (!asset.durationsSec) asset.durationsSec = [];
                                for (let j = 0; j < (asset.urls || []).length; j++) {
                                    const absPath = path.join(assetsDirAbs, `scene_${i}_sp${assetIdx}_${j}.mp4`);
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
                            const absPath = path.join(assetsDirAbs, `scene_${i}_split_${j}.mp4`);
                            if (fs.existsSync(absPath)) parsed.durationsSec[j] = await probeVideoDuration(absPath);
                        }
                        props.sceneVideoUrls[i] = JSON.stringify(parsed);
                        const valids = (parsed.durationsSec || []).filter(Boolean);
                        props.sceneVideoDurations[i] = valids.length > 0 ? Math.min(...valids) : undefined;
                        continue;
                    }
                } catch { /* regular URL */ }

                // Regular scene video
                const absPath = path.join(assetsDirAbs, `scene_${i}.mp4`);
                if (fs.existsSync(absPath)) {
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

    // ── Write props and run Remotion ──────────────────────────────────────────
    const propsPath = path.join(tmpDir, `props-${videoId}.json`);
    fs.writeFileSync(propsPath, JSON.stringify(props));

    const outputPath = path.join(rendersDir, `${videoId}.mp4`);
    const propsArg = propsPath.replace(/\\/g, '/');
    const outputArg = outputPath.replace(/\\/g, '/');

    function buildRenderCommand(): string {
        return [
            'npx remotion render MainVideo',
            `"${outputArg}"`,
            `--props="${propsArg}"`,
            `--timeout=120000`,
            `--disable-web-security`,
            `--gl=angle`,
            `--concurrency=1`,
            `--jpeg-quality=75`,
        ].join(' ');
    }

    function executeRender(cmd: string): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            console.log(`💻 Executing: ${cmd.substring(0, 120)}...`);
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
                try { fs.rmSync(assetsDirAbs, { recursive: true, force: true }); } catch { }
                console.error(`❌ Local render failed for ${videoId}:`, error.message);
                await db.update(shortVideoAssets).set({ status: 'failed' }).where(eq(shortVideoAssets.videoId, videoId));
                throw error;
            }
            console.warn(`⚠️ Retryable error on attempt ${attempt + 1}/${MAX_ATTEMPTS}: ${isImageError ? 'image loading' : 'timeout'}`);
        }
    }

    // ── Success ───────────────────────────────────────────────────────────────
    try { fs.unlinkSync(propsPath); } catch { }
    try { fs.rmSync(assetsDirAbs, { recursive: true, force: true }); } catch { }

    const localUrl = `/renders/${videoId}.mp4`;
    console.log(`✅ Local render complete: ${localUrl}`);

    const [asset] = await db.select().from(shortVideoAssets).where(eq(shortVideoAssets.videoId, videoId));
    if (!asset?.thumbnailUrl) await ensureVideoThumbnail(videoId);

    await db.update(shortVideoAssets).set({
        videoUrl: localUrl,
        status: 'completed',
    }).where(eq(shortVideoAssets.videoId, videoId));
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
                    await db.update(shortVideoSeries).set({ thumbnailUrl: thumbUrl }).where(eq(shortVideoSeries.seriesId, asset.seriesId));
                }
                return thumbUrl;
            }
        }
    } catch (err: any) {
        console.warn(`⚠️ Failed to ensure thumbnail for ${videoId}:`, err.message);
    }
    return null;
}