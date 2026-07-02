import { aiFallback } from "@/config/ai-fallback";
import { db } from "@/config/db";
import { shortVideoAssets, shortVideoProgress, shortVideoSeries } from "@/config/schema";
import { putWithRotation } from "@/lib/blob";
import { generateNanoBananaImage, generateNanoBananaImagesParallel, generateApifyImage, generateApifyImagesParallel } from "@/lib/apify-image";
import { submitSeedanceVideoTask, checkPolloVideoTaskStatus, processSeedanceVideoResult } from "@/lib/apify-video";
import { getMusicUrl } from "@/lib/music-urls";
import { translateScript, translateSingleText, LANGUAGE_NAMES } from "@/lib/translate";
import { triggerRender } from "@/lib/video-render";
import { and, desc, eq, like, or } from "drizzle-orm";
import { inngest } from "./client";
import { groq } from "@/config/groq";
import { shortsLLM } from "@/lib/shorts-llm";
import { distillFactSheet, searchWeb } from "@/lib/web-search";

// ─── Lightweight MP4 duration prober (works on serverless, no ffprobe) ────────
// Fetches up to 2 MB of the file and walks MP4 box headers looking for
// the `mvhd` atom inside `moov`. Falls back to file-size estimation.

async function probeVideoDuration(url: string): Promise<number> {
    const DEFAULT_DURATION = 5; // seconds – safe fallback
    try {
        // Fetch first 2 MB (moov is usually at the start for web-optimized videos)
        const res = await fetch(url, {
            headers: { Range: "bytes=0-2097151" },
        });
        if (!res.ok && res.status !== 206) {
            // If range not supported, try full fetch with small timeout
            const fullRes = await fetch(url);
            if (!fullRes.ok) return DEFAULT_DURATION;
            const buf = Buffer.from(await fullRes.arrayBuffer());
            return parseMp4Duration(buf) || estimateFromSize(buf.length);
        }
        const buf = Buffer.from(await res.arrayBuffer());
        const parsed = parseMp4Duration(buf);
        if (parsed && parsed > 0) return parsed;

        // Fallback: estimate from Content-Length
        const cl = res.headers.get("content-range");
        const totalMatch = cl?.match(/\/(\d+)/);
        const totalBytes = totalMatch ? parseInt(totalMatch[1]) : buf.length;
        return estimateFromSize(totalBytes);
    } catch (err) {
        console.warn(`⚠️ probeVideoDuration failed for ${url.substring(0, 60)}: ${err}`);
        return DEFAULT_DURATION;
    }
}

function estimateFromSize(bytes: number): number {
    // Rough estimate: ~500 KB/s for a typical 720p short video
    return Math.max(3, Math.min(60, bytes / (500 * 1024)));
}

function parseMp4Duration(buf: Buffer): number | null {
    // Walk top-level MP4 boxes looking for 'moov'
    let offset = 0;
    while (offset + 8 <= buf.length) {
        const size = buf.readUInt32BE(offset);
        const type = buf.toString("ascii", offset + 4, offset + 8);
        if (size < 8) break; // invalid box
        if (offset + size > buf.length && type !== "moov") {
            offset += size;
            continue;
        }

        if (type === "moov") {
            // Search inside moov for mvhd
            return parseMvhdInBox(buf, offset + 8, Math.min(offset + size, buf.length));
        }
        offset += size;
    }
    return null;
}

function parseMvhdInBox(buf: Buffer, start: number, end: number): number | null {
    let offset = start;
    while (offset + 8 <= end) {
        const size = buf.readUInt32BE(offset);
        const type = buf.toString("ascii", offset + 4, offset + 8);
        if (size < 8) break;

        if (type === "mvhd") {
            // mvhd box: version(1) + flags(3) + created(4/8) + modified(4/8) + timescale(4) + duration(4/8)
            const version = buf.readUInt8(offset + 8);
            if (version === 0) {
                const timescale = buf.readUInt32BE(offset + 20);
                const duration = buf.readUInt32BE(offset + 24);
                if (timescale > 0) return duration / timescale;
            } else if (version === 1) {
                const timescale = buf.readUInt32BE(offset + 28);
                // 64-bit duration: read high + low 32 bits
                const durHigh = buf.readUInt32BE(offset + 32);
                const durLow = buf.readUInt32BE(offset + 36);
                const duration = durHigh * 0x100000000 + durLow;
                if (timescale > 0) return duration / timescale;
            }
            return null;
        }

        // Recurse into container boxes (trak, etc.)
        if (type === "trak" || type === "mdia" || type === "minf" || type === "stbl" || type === "udta" || type === "edts") {
            const inner = parseMvhdInBox(buf, offset + 8, Math.min(offset + size, end));
            if (inner !== null) return inner;
        }

        offset += size;
    }
    return null;
}

// ─── HeyGen Avatar Clip Configuration ────────────────────────────────────────

const AVATAR_CLIPS = {
    intro: {
        avatar1: {
            videoUrl: "avatars/avatar1-intro.mp4",
            videoDurationSec: 9.37,
            script: "Hey guys! How are you all doing? I hope you're having a great day. Today we're diving into something truly fascinating. Let's get right into it!",
        },
        avatar2: {
            videoUrl: "avatars/avatar2-intro.mp4",
            videoDurationSec: 7.97,
            script: "Hello everyone, welcome back. Today I have a story that will completely change how you see things. Are you ready? Let's begin.",
        },
        avatar3: {
            videoUrl: "avatars/avatar3-intro.mp4",
            videoDurationSec: 9.93,
            script: "Hey there! Hope you're doing amazing today. I've got some incredible facts lined up for you in this video, so stick around and let's explore this together.",
        },
    },
    outro: {
        avatar4: {
            videoUrl: "avatars/avatar4-outro.mp4",
            videoDurationSec: 10.40,
            script: "I hope you enjoyed the video and learned something new today. If you did, don't forget to like and subscribe for more content just like this. See you in the next one!",
        },
        avatar5: {
            videoUrl: "avatars/avatar5-outro.mp4",
            videoDurationSec: 8.47,
            script: "Let me know your thoughts in the comments below, and consider subscribing if you haven't already. Thanks for watching and don't forget to Like this Video!",
        },
        avatar6: {
            videoUrl: "avatars/avatar6-outro.mp4",
            videoDurationSec: 9.63,
            script: "Did you know that? I hope you found this video as fascinating as I did. Make sure to hit that subscribe button for more amazing Videos. Until next time, take care!",
        },
    },
} as const;

// Pairing rules:
// Avatar1 Intro → Avatar4 Outro or Avatar3 Outro (random)
// Avatar2 Intro → Avatar4 Outro or Avatar3 Outro (random)
// Avatar3 Intro → Avatar6 Outro (fixed)
type IntroKey = keyof typeof AVATAR_CLIPS.intro;
type OutroKey = keyof typeof AVATAR_CLIPS.outro;

const AVATAR_PAIRINGS: Record<IntroKey, OutroKey[]> = {
    avatar1: ["avatar4", "avatar5"],
    avatar2: ["avatar4", "avatar5"],
    avatar3: ["avatar6"],
};

function selectAvatarPair(): { intro: typeof AVATAR_CLIPS.intro[IntroKey]; outro: typeof AVATAR_CLIPS.outro[OutroKey] } {
    const introKeys: IntroKey[] = ["avatar1", "avatar1", "avatar2", "avatar2", "avatar3"]; // weighted: 40%/40%/20%
    const introKey = introKeys[Math.floor(Math.random() * introKeys.length)];
    const outroOptions = AVATAR_PAIRINGS[introKey];
    const outroKey = outroOptions[Math.floor(Math.random() * outroOptions.length)];
    console.log(`🎭 Selected intro: ${introKey}, outro: ${outroKey}`);
    return {
        intro: AVATAR_CLIPS.intro[introKey],
        outro: AVATAR_CLIPS.outro[outroKey],
    };
}

// ─── English TTS helper for intro/outro clips ─────────────────────────────────

// Build FFmpeg atempo filter chain for a given speed ratio.
// atempo supports 0.5–2.0 per stage; chain stages for extreme ratios.
function buildAtempoFilter(ratio: number): string {
    const clamp = (v: number) => Math.max(0.5, Math.min(2.0, v));
    if (ratio >= 0.5 && ratio <= 2.0) return `atempo=${ratio.toFixed(4)}`;
    if (ratio > 2.0) {
        const stage = Math.pow(ratio, 1 / 3);
        return `atempo=${clamp(stage).toFixed(4)},atempo=${clamp(stage).toFixed(4)},atempo=${clamp(stage).toFixed(4)}`;
    }
    // ratio < 0.5: need to slow down significantly
    const stage = Math.pow(ratio, 1 / 3);
    return `atempo=${clamp(stage).toFixed(4)},atempo=${clamp(stage).toFixed(4)},atempo=${clamp(stage).toFixed(4)}`;
}

async function generateEnglishTTS(
    text: string,
    seriesId: string,
    type: "intro" | "outro",
    speaker: string,
    targetDurationSec: number  // video clip duration → stretch TTS to match
): Promise<{ audioUrl: string; durationSec: number }> {
    const cleaned = sanitizeForTTS(text);
    let audioBuffer = await callSarvamTTS(cleaned, speaker, "en-IN");

    // ── Calculate raw TTS duration from WAV header ─────────────────────────
    const sampleRate = audioBuffer.readUInt32LE(24);
    const dataSize = audioBuffer.length - 44;
    const bytesPerSample = audioBuffer.readUInt16LE(34) / 8;
    const channels = audioBuffer.readUInt16LE(22);
    const ttsDurationSec = dataSize / (sampleRate * bytesPerSample * channels);
    console.log(`🎙️ ${type} TTS raw duration: ${ttsDurationSec.toFixed(2)}s, target: ${targetDurationSec}s`);

    // ── Time-stretch to match video clip duration (FFmpeg atempo) ──────────
    const ratio = ttsDurationSec / targetDurationSec; // > 1 = speed up, < 1 = slow down
    const STRETCH_THRESHOLD = 0.05; // skip if within 5%
    if (Math.abs(ratio - 1) > STRETCH_THRESHOLD) {
        try {
            const os = require('os');
            const path = require('path');
            const fs = require('fs');
            const { exec } = require('child_process');

            // Resolve ffmpeg binary with fallbacks
            // Must use a string literal (not a variable) so bundler can externalize properly
            let ffmpegBin: string = '';
            try {
                const bin = require('ffmpeg-static') as string | null;
                if (bin && fs.existsSync(bin)) ffmpegBin = bin;
            } catch { /* not bundled in this env */ }
            if (!ffmpegBin) {
                const localBin = path.join(process.cwd(), 'node_modules', 'ffmpeg-static',
                    process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
                if (fs.existsSync(localBin)) ffmpegBin = localBin;
            }
            if (!ffmpegBin) {
                for (const p of ['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg']) {
                    if (fs.existsSync(p)) { ffmpegBin = p; break; }
                }
            }
            if (!ffmpegBin) ffmpegBin = 'ffmpeg'; // rely on PATH

            const tmpDir = os.tmpdir();
            const inPath = path.join(tmpDir, `${type}_tts_raw_${Date.now()}.wav`);
            const outPath = path.join(tmpDir, `${type}_tts_stretched_${Date.now()}.wav`);
            fs.writeFileSync(inPath, audioBuffer);

            const atempoFilter = buildAtempoFilter(ratio);
            const cmd = `"${ffmpegBin}" -y -i "${inPath}" -filter:a "${atempoFilter}" "${outPath}"`;
            console.log(`⏩ Stretching ${type} audio: ratio=${ratio.toFixed(3)}, filter=${atempoFilter}`);

            await new Promise<void>((resolve, reject) =>
                exec(cmd, (err: any, _: string, stderr: string) => {
                    if (err) { console.warn(`⚠️ atempo failed: ${stderr?.slice(-200)}`); reject(err); }
                    else resolve();
                })
            );

            audioBuffer = fs.readFileSync(outPath);
            fs.unlinkSync(inPath);
            fs.unlinkSync(outPath);
            console.log(`✅ ${type} audio stretched to ~${targetDurationSec}s`);
        } catch (e: any) {
            console.warn(`⚠️ Audio time-stretch failed, using original TTS: ${e.message}`);
        }
    } else {
        console.log(`⏭️ ${type} TTS within 5% of target — no stretch needed`);
    }

    // Upload final audio
    const blobResult = await putWithRotation(
        `shorts/${seriesId}/${type}_audio_${Date.now()}.wav`,
        audioBuffer,
        { access: "public", contentType: "audio/wav" }
    );

    // Re-read duration from the (possibly stretched) buffer
    const finalSampleRate = audioBuffer.readUInt32LE(24);
    const finalDataSize = audioBuffer.length - 44;
    const finalBytesPerSample = audioBuffer.readUInt16LE(34) / 8;
    const finalChannels = audioBuffer.readUInt16LE(22);
    const finalDurationSec = finalDataSize / (finalSampleRate * finalBytesPerSample * finalChannels);

    console.log(`✅ ${type} audio uploaded: ${blobResult.url} (${finalDurationSec.toFixed(1)}s)`);
    return { audioUrl: blobResult.url, durationSec: Math.round(finalDurationSec * 10) / 10 };
}


// ─── Sarvam TTS helpers (reusing patterns from lib/enhanced-tts.ts) ──────────

function sanitizeForTTS(text: string): string {
    return text
        .replace(/<[^>]*>/g, ' ')
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/[\u201C\u201D]/g, '"')
        .replace(/[•◦▪▫]/g, '-')
        .replace(/[…]/g, '...')
        .replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '')
        .replace(/\.{4,}/g, '.')
        .replace(/\.{2,3}/g, '.')           // Collapse ellipses to single period — prevents TTS pausing/stretching
        .replace(/!{2,}/g, '!')
        .replace(/\?{2,}/g, '?')
        .replace(/-{2,}/g, '-')              // Collapse repeated dashes
        .replace(/,{2,}/g, ',')
        .replace(/([.!?])([A-Z])/g, '$1 $2')
        .replace(/[*_#~`]/g, '')             // Remove markdown formatting
        .replace(/\(.*?\)/g, '')             // Remove parenthetical asides — they confuse TTS pacing
        .replace(/\[.*?\]/g, '')             // Remove bracketed text
        .replace(/([a-zA-Z])\1{2,}/g, '$1$1') // Collapse repeated characters: "soooo" → "soo", "amaziiing" → "amaziing"
        .replace(/:\s/g, '. ')               // Replace colons with periods for cleaner TTS breaks
        .replace(/;\s/g, '. ')               // Replace semicolons with periods
        .replace(/—/g, ', ')                 // Replace em-dashes with comma
        .replace(/–/g, ', ')                 // Replace en-dashes with comma
        .replace(/\s+/g, ' ')
        .trim();
}

function chunkText(text: string, maxLen = 2200): string[] {
    if (text.length <= maxLen) return [text];
    const sentences = text.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g) || [text];
    const chunks: string[] = [];
    let cur = '';
    for (const s of sentences) {
        const t = s.trim();
        if (!t) continue;
        if (cur.length + t.length + 1 > maxLen && cur) {
            chunks.push(cur.trim());
            cur = t;
        } else {
            cur += (cur ? ' ' : '') + t;
        }
    }
    if (cur) chunks.push(cur.trim());
    return chunks;
}

/** Read all available Sarvam API keys from env (SARVAM_API_KEY, SARVAM_API_KEY_2, ...) */
function getSarvamKeys(): string[] {
    const keys: string[] = [];
    if (process.env.SARVAM_API_KEY) keys.push(process.env.SARVAM_API_KEY);
    for (let i = 2; i <= 10; i++) {
        const k = process.env[`SARVAM_API_KEY_${i}`];
        if (k) keys.push(k);
    }
    return keys;
}

/**
 * Call Sarvam TTS with full key rotation.
 * - 402 (quota exhausted): immediately rotates to next key.
 * - 502/503/504/timeout: retries same key up to `transientRetries` times.
 * - Other errors: rotates to next key.
 * Tries every available key before throwing.
 */
async function callSarvamTTS(
    text: string,
    speaker: string,
    language: string,
    pace: number = 1.05,
    temperature: number = 0.6,
    transientRetries = 2
): Promise<Buffer> {
    const keys = getSarvamKeys();
    if (keys.length === 0) throw new Error('No SARVAM_API_KEY found in environment variables');

    let lastErr: Error | null = null;

    for (let ki = 0; ki < keys.length; ki++) {
        const apiKey = keys[ki];
        const keyLabel = ki === 0 ? 'primary' : `key_${ki + 1}`;
        let delay = 2000;

        for (let attempt = 0; attempt <= transientRetries; attempt++) {
            try {
                if (attempt > 0) {
                    console.log(`🔄 TTS [${keyLabel}] retry ${attempt}/${transientRetries}, waiting ${delay}ms...`);
                    await new Promise(r => setTimeout(r, delay));
                    delay = Math.min(delay * 2, 10000);
                }

                const res = await fetch('https://api.sarvam.ai/text-to-speech', {
                    method: 'POST',
                    headers: {
                        'api-subscription-key': apiKey,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        text,
                        target_language_code: language,
                        speaker,
                        pace,
                        speech_sample_rate: 22050,
                        enable_preprocessing: true,
                        model: 'bulbul:v3',
                        temperature,
                        output_audio_codec: 'wav',
                    }),
                    signal: AbortSignal.timeout(30000),
                });

                if (!res.ok) {
                    const body = await res.text();
                    const err = new Error(`Sarvam TTS ${res.status}: ${body}`);
                    // 402 = quota exhausted → rotate to next key immediately
                    if (res.status === 402 || res.status === 429) {
                        console.warn(`⚠️ Sarvam TTS [${keyLabel}] quota exhausted (${res.status}) — rotating to next key...`);
                        lastErr = err;
                        break; // exit attempt loop → try next key
                    }
                    throw err;
                }

                const data = await res.json();
                if (!data.audios?.[0]) throw new Error('No audio in Sarvam response');

                if (ki > 0) console.log(`✅ Sarvam TTS succeeded with [${keyLabel}] after key rotation.`);
                return Buffer.from(data.audios[0], 'base64');

            } catch (e: any) {
                lastErr = e;
                const isQuota = /402|429|insufficient_quota|No credits/i.test(e.message);
                if (isQuota) {
                    console.warn(`⚠️ Sarvam TTS [${keyLabel}] quota error — rotating to next key...`);
                    break; // exit attempt loop → try next key
                }
                const isTransient = /502|503|504|timeout|ECONNRESET/i.test(e.message);
                if (!isTransient || attempt === transientRetries) {
                    console.warn(`⚠️ Sarvam TTS [${keyLabel}] non-retryable error — rotating key: ${e.message}`);
                    break; // rotate key
                }
                console.warn(`⚠️ Sarvam TTS [${keyLabel}] attempt ${attempt + 1} failed (transient): ${e.message}`);
            }
        }
    }

    throw lastErr ?? new Error('Sarvam TTS: all keys exhausted');
}

function mergeWavBuffers(buffers: Buffer[]): Buffer {
    if (buffers.length === 1) return buffers[0];
    const chunks = buffers.map(b => b.slice(44)); // strip headers
    const merged = Buffer.concat(chunks);
    const hdr = Buffer.alloc(44);
    const first = buffers[0];
    hdr.write('RIFF', 0);
    hdr.writeUInt32LE(merged.length + 36, 4);
    hdr.write('WAVE', 8);
    hdr.write('fmt ', 12);
    hdr.writeUInt32LE(16, 16);
    hdr.writeUInt16LE(1, 20);
    hdr.writeUInt16LE(first.readUInt16LE(22), 22); // channels
    hdr.writeUInt32LE(first.readUInt32LE(24), 24); // sample rate
    hdr.writeUInt32LE(first.readUInt32LE(28), 28); // byte rate
    hdr.writeUInt16LE(first.readUInt16LE(32), 32); // block align
    hdr.writeUInt16LE(first.readUInt16LE(34), 34); // bits per sample
    hdr.write('data', 36);
    hdr.writeUInt32LE(merged.length, 40);
    return Buffer.concat([hdr, merged]);
}

// ─── Inngest functions ───────────────────────────────────────────────────────

export const helloWorld = inngest.createFunction(
    { id: "hello-world", triggers: [{ event: "test/hello.world" }] },
    async ({ event, step }) => {
        await step.sleep("wait-a-moment", "1s");
        return { message: `Hello ${event.data.email}!` };
    }
);

// ─── Short Series Thumbnail Generator (Inngest — bypasses Vercel timeout) ─────
// gpt-image-2 via Flatkey takes 60–90 s. Running it inside step.run() means
// Inngest retries the step independently and Vercel never times out.

export const generateShortSeriesThumbnailFn = inngest.createFunction(
    {
        id: "generate-short-series-thumbnail",
        triggers: [{ event: "short-series/thumbnail.generate" }],
        retries: 3,
    },
    async ({ event, step }) => {
        const { seriesId, title, niche } = event.data as {
            seriesId: string;
            title: string;
            niche: string;
        };

        console.log(`🖼️  [Inngest] Short-series thumbnail start — seriesId=${seriesId}`);

        // ── Step 1: Check if thumbnail already exists ──────────────────────────
        const existing = await step.run("check-existing", async () => {
            const [row] = await db
                .select({ thumbnailUrl: shortVideoSeries.thumbnailUrl })
                .from(shortVideoSeries)
                .where(eq(shortVideoSeries.seriesId, seriesId));
            return row?.thumbnailUrl ?? null;
        });

        if (existing && (existing.startsWith("http") || existing.startsWith("data:"))) {
            console.log(`✅ [Inngest] Thumbnail already exists for ${seriesId} — skipping`);
            return { skipped: true, thumbnailUrl: existing };
        }

        // ── Step 2: Build prompt ───────────────────────────────────────────────
        function buildShortsThumbnailPrompt(title: string, niche: string): string {
            const stopWords = new Set(["a","an","the","and","or","but","in","on","at","for","with","about","to","from","of","is","are","how","what","why"]);
            const words = title.split(/\s+/).filter(w => w.length > 0);
            const keywords = words.filter(w => !stopWords.has(w.toLowerCase())).slice(0, 3).join(" ");

            const scenes = [
                `A stunning cinematic thumbnail for a "${keywords}" video series. Bold 3D neon text "${keywords}" floating over a vibrant ${niche}-themed background. Dramatic lighting, 8k resolution. STRICTLY ENSURE PERFECT SPELLING of "${keywords}".`,
                `Cinematic wide thumbnail: "${keywords}" in large glowing letters against a dark moody backdrop with ${niche} visual elements. Electric blue and magenta tones, lens flare. STRICTLY ENSURE PERFECT SPELLING of "${keywords}". 8k.`,
                `Hyper-modern thumbnail: "${keywords}" in bold metallic 3D typography. Floating geometric shapes, ${niche} icons, deep purple to electric blue gradient background. STRICTLY ENSURE PERFECT SPELLING of "${keywords}". 8k.`,
                `Premium cinematic thumbnail: "${keywords}" as holographic text above a stylish ${niche}-themed scene. Glowing particles, soft bokeh, cinematic depth. STRICTLY ENSURE PERFECT SPELLING of "${keywords}". 8k.`,
            ];
            return scenes[Math.floor(Math.random() * scenes.length)];
        }

        const prompt = buildShortsThumbnailPrompt(title, niche || "general");

        // ── Step 3: Generate image via Vercel AI Gateway (Imagen 4) ───────────
        const imageUrl = await step.run("generate-image", async () => {
            console.log(`🎨 [Inngest] Calling Vercel AI Gateway (Imagen 4) for "${title}" (${niche})...`);
            console.log(`🔑 [Inngest] AI_GATEWAY_API_KEY present: ${!!process.env.AI_GATEWAY_API_KEY}`);
            console.log(`📝 [Inngest] Prompt: "${prompt.slice(0, 120)}..."`);
            try {
                const url = await generateNanoBananaImage(prompt, 1024, 1024);
                if (!url) throw new Error("generateNanoBananaImage returned empty URL");
                console.log(`✅ [Inngest] Image generated: ${url.slice(0, 80)}`);
                return url;
            } catch (err: any) {
                // Log full error so it appears in Inngest dashboard + Vercel logs
                console.error(`❌ [Inngest] Thumbnail generation FAILED for series ${seriesId}:`);
                console.error(`   Error: ${err?.message}`);
                console.error(`   Stack: ${err?.stack?.slice(0, 500)}`);
                // Re-throw so Inngest marks step as failed and retries
                throw new Error(`[thumbnail] Vercel AI Gateway failed: ${err?.message}`);
            }
        });

        // ── Step 4: Save to DB ─────────────────────────────────────────────────
        await step.run("save-thumbnail-url", async () => {
            await db
                .update(shortVideoSeries)
                .set({ thumbnailUrl: imageUrl })
                .where(eq(shortVideoSeries.seriesId, seriesId));
            console.log(`💾 [Inngest] Thumbnail saved for series ${seriesId}`);
        });

        return { success: true, seriesId, thumbnailUrl: imageUrl };
    }
);

// Helper to update series status in DB
async function updateSeriesStatus(seriesId: string, status: string) {
    await db.update(shortVideoSeries)
        .set({ status, updatedAt: new Date() })
        .where(eq(shortVideoSeries.seriesId, seriesId));
}

export const generateShortVideo = inngest.createFunction(
    {
        id: "generate-short-video",
        triggers: [{ event: "shorts/generate.video" }],
        cancelOn: [
            {
                event: "shorts/generate.cancel",
                match: "data.seriesId"
            }
        ],
        onFailure: async ({ error, event, step }) => {
            const seriesId = event?.data?.event?.data?.seriesId;
            if (seriesId) {
                console.error(`❌ Generation job failed or cancelled for series: ${seriesId}`, error);
                await updateSeriesStatus(seriesId, "completed"); // Reset status to hide generating UI

                // Also clean up any video assets stuck in processing/rendering
                await db.update(shortVideoAssets)
                    .set({ status: "failed" })
                    .where(and(
                        eq(shortVideoAssets.seriesId, seriesId),
                        or(
                            eq(shortVideoAssets.status, "processing"),
                            eq(shortVideoAssets.status, "rendering")
                        )
                    ));
            }
        }
    },
    async ({ event, step }) => {
        const { seriesId, customTopic, studioPayload } = event.data;
        // Unique run ID scoped to this specific generation trigger.
        // event.id is stable across Inngest retries of the same event, so idempotency
        // still works on retry — but it's different for every NEW generation, preventing
        // stale shortVideoProgress rows from a previous short being reused.
        const runId = (event.id || `${seriesId}_${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
        // studioPayload = { scriptData, sceneAssets[], captionStyle, voice, music, contextMarkdown }
        // OR legacy:    { scriptData, sceneAssetTypes[], sceneCustomUrls[], ... }

        // ── Normalise payload to unified sceneAssets[] ─────────────────────────────
        function resolveSceneAsset(i: number) {
            // New format
            if (studioPayload?.sceneAssets?.[i]) return studioPayload.sceneAssets[i];
            // Legacy format fallback
            const legacyType = studioPayload?.sceneAssetTypes?.[i];
            const legacyUrl = studioPayload?.sceneCustomUrls?.[i];
            if (legacyType && legacyType !== 'ai') {
                return {
                    type: legacyType,
                    files: legacyUrl ? [{ url: legacyUrl, fileId: '', isVideo: /\.(mp4|mov|webm)/i.test(legacyUrl), mimeType: '' }] : [],
                    imgToVideoEnabled: false,
                    splitScreenEnabled: false,
                    splitPairs: [],
                    docImageUrl: legacyType === 'doc_image' ? legacyUrl : null,
                };
            }
            return null;
        }

        // Step 1: Fetch series from DB
        const seriesData = await step.run("fetch-series", async () => {
            const [series] = await db
                .select()
                .from(shortVideoSeries)
                .where(eq(shortVideoSeries.seriesId, seriesId));

            if (!series) {
                throw new Error(`Series not found: ${seriesId}`);
            }

            console.log(`✅ Fetched series: "${series.title}"`);
            return series;
        });

        // ── Step 1.5a: Fetch already-covered titles (DB only, very fast) ────────
        const coveredTitles = await step.run("fetch-covered-topics", async () => {
            if (customTopic || studioPayload?.scriptData?.videoTitle) return [];
            const existingVideos = await db
                .select({ title: shortVideoAssets.videoTitle })
                .from(shortVideoAssets)
                .where(eq(shortVideoAssets.seriesId, seriesId));
            return existingVideos.map(v => v.title).filter(Boolean).slice(0, 25);
        });

        // ── Step 1.5b: Fast snippet research for topic ideas (NO distillation LLM call) ──
        // skipDistillation:true means we only run Tavily + Wikipedia (< 15s total).
        // Full LLM fact-distillation is not needed here — raw snippets inspire topic selection.
        const topicResearchContext = await step.run("research-topic-ideas", async () => {
            if (customTopic || studioPayload?.scriptData?.videoTitle) return '';
            const searchQuery = `${seriesData.title} ${seriesData.niche} unique lesser known facts history mysteries`;
            console.log(`🔍 Fast snippet research for topic ideas: "${searchQuery.slice(0, 60)}"`);
            const research = await searchWeb(searchQuery, { deepCrawl: false, skipDistillation: true });
            return research.contextBlock || '';
        });

        // ── Step 1.5c: LLM call to pick the unique topic (isolated, fresh timeout window) ──
        const chosenTopic = await step.run("pick-unique-topic", async () => {
            if (customTopic) {
                console.log(`🎯 Custom topic provided by user: "${customTopic}"`);
                return customTopic;
            }
            if (studioPayload?.scriptData?.videoTitle) {
                console.log(`🎬 Studio mode: using pre-edited script title: "${studioPayload.scriptData.videoTitle}"`);
                return studioPayload.scriptData.videoTitle;
            }

            console.log(`🔍 AI discovering unique topic for series niche: "${seriesData.niche}", title: "${seriesData.title}"`);

            const alreadyCoveredText = coveredTitles.length > 0
                ? `\nHere are the video topics already covered in this series (NEVER repeat these or talk about these exact things):\n${coveredTitles.map((t: string) => `- ${t}`).join('\n')}`
                : '';

            const systemPrompt = `You are a viral content strategist for short-form videos. Your job is to choose ONE highly unique, engaging, and specific video topic/title.
Return a JSON object with a single key "topic":
{
  "topic": "The Chosen Title Here"
}`;
            const userPrompt = `Series Title/Theme: "${seriesData.title}"
Niche: "${seriesData.niche}"
${alreadyCoveredText}

${topicResearchContext ? `REAL-TIME WEB RESEARCH context:\n${topicResearchContext}\n` : ''}

Task:
Pick ONE highly specific, fascinating, and unique video topic or title that:
1. Directly fits the series theme "${seriesData.title}" and niche "${seriesData.niche}".
2. Has NOT been covered in the list of already covered topics above.
3. Offers unique/bizarre/surprising facts or stories grounded in the real-time web research provided.
4. Avoids generic overviews (like "overview of Golden Temple") and instead picks a highly specific aspect (e.g., "The mysterious foundation stone laid by a Muslim Sufi saint", "The legendary missing treasures of Amritsar").
5. Reads like an engaging, click-worthy YouTube Shorts title.
6. Max 12 words.

Return ONLY a valid JSON object matching the schema above.`;

            try {
                const result = await shortsLLM.json(systemPrompt, userPrompt, {
                    temperature: 0.9,
                    maxTokens: 150,
                });
                const picked = result?.topic?.trim().replace(/^[\"']|[\"']$/g, '') || '';
                console.log(`🎯 AI chose unique topic: "${picked}"`);
                return picked || seriesData.title;
            } catch (err: any) {
                console.warn('⚠️ Unique topic discovery failed, falling back to series title:', err.message);
                return seriesData.title;
            }
        });

        // Determine voice, language & caption style: use studioPayload if provided, otherwise series defaults
        const selectedVoice = studioPayload?.voice ?? seriesData.voice;
        const selectedLanguage = studioPayload?.language ?? seriesData.language;
        const selectedCaptionStyle = studioPayload?.captionStyle ?? seriesData.captionStyle;
        console.log(`🎤 Selected voice: ${selectedVoice}, language: ${selectedLanguage}, caption style: ${selectedCaptionStyle} (studioPayload: ${studioPayload?.voice ? 'yes' : 'no'})`);

        // Update status: generating script
        await step.run("update-status-script", () => updateSeriesStatus(seriesId, "generating:script"));

        // ── Step 1.8a: Deep-Crawl Web Research (Tavily + Wikipedia + page crawl, NO LLM distillation) ──
        // Crawling pages is I/O-bound (~15-20s). We separate it from the LLM distillation
        // so each slow operation gets its own fresh Vercel execution window.
        const rawResearchSources = await step.run("run-web-research", async () => {
            if (studioPayload?.scriptData) return null;
            console.log(`🌐 Deep-Crawl RAG research on: "${chosenTopic}"...`);
            // skipDistillation:true — crawl pages but defer the LLM fact-distillation to next step
            const webResearch = await searchWeb(chosenTopic, { deepCrawl: true, skipDistillation: true });
            console.log(`✅ Crawl complete: ${webResearch.sources.length} sources`);
            // Return only what we need — avoid serialising huge fullText between steps
            return webResearch.sources.map((s: any) => ({
                title:    s.title,
                url:      s.url,
                snippet:  s.snippet,
                fullText: s.fullText ? s.fullText.slice(0, 8000) : undefined,
                source:   s.source,
            }));
        });

        // ── Step 1.8b: LLM Fact-Sheet Distillation (isolated — its own 300s window) ──
        // The distillFactSheet LLM call takes 50-80s on free-tier models.
        // Keeping it in its own step prevents it from consuming other steps' time budgets.
        const webResearchData = await step.run("distill-fact-sheet", async () => {
            if (studioPayload?.scriptData || !rawResearchSources?.length) return null;
            console.log(`🧠 Distilling fact sheet from ${rawResearchSources.length} sources...`);
            const factSheet = await distillFactSheet(chosenTopic, rawResearchSources as any);
            const factCount = factSheet.split('\n').filter((l: string) => /^[•\-\*]/.test(l.trim())).length;
            console.log(`📋 Fact sheet: ${factCount} verified facts from ${rawResearchSources.length} sources`);

            // Rebuild context block from distilled fact sheet
            const wikiCount = (rawResearchSources as any[]).filter((s: any) => s.source === 'wikipedia').length;
            const webCount  = (rawResearchSources as any[]).filter((s: any) => s.source === 'tavily').length;
            const webContext = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📚 VERIFIED RESEARCH (Deep-Crawl RAG — ${wikiCount} Wikipedia + ${webCount} web sources)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Topic: ${chosenTopic}

${factSheet}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🚨 SCRIPT-WRITING RULES (MANDATORY):
1. Follow the CENTRAL NARRATIVE thread above — every scene must advance that story.
2. Use SPECIFIC facts (dates, names, numbers) from the research in EVERY scene.
3. Facts marked (confirmed ✓) are verified by multiple sources — use them FIRST.
4. Wikipedia data overrides your training knowledge when they conflict.
5. Each scene must END with a natural bridge to the NEXT scene topic.
6. Do NOT introduce any fact not present in this research block.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
            return { webContext, factCount, sourcesCount: rawResearchSources.length };
        });

        // Step 2: Generate Video Script — skip when Studio pre-edited script is provided
        const scriptData = await step.run("generate-video-script", async () => {
            // ── STUDIO MODE: Use pre-edited user script ─────────────────────
            if (studioPayload?.scriptData) {
                console.log(`🎬 Studio mode: using pre-edited script (${studioPayload.scriptData.scenes?.length} scenes)`);
                return studioPayload.scriptData;
            }
            console.log(`📝 Generating video script for: "${seriesData.title}"`);

            // ── Always target 80-120 seconds for engaging short videos ──
            const sceneCount = 6;
            const durationLabel = "80-120 seconds";

            // ── Word-count math ──────────────────────────────────────
            // Sarvam TTS at 1.05× pace ≈ 2.5 words/sec (150 WPM)
            const WORDS_PER_SEC = 2.5;
            const targetMinSec = 100;
            const targetMaxSec = 140;
            const totalWordsMin = Math.ceil(targetMinSec * WORDS_PER_SEC);   // 250
            const totalWordsMax = Math.ceil(targetMaxSec * WORDS_PER_SEC);   // 350
            const perSceneWordsMin = Math.ceil(totalWordsMin / sceneCount);   // ~42
            const perSceneWordsMax = Math.ceil(totalWordsMax / sceneCount);   // ~58
            // ─────────────────────────────────────────────────────────

            // ── Randomization seed for guaranteed uniqueness ─────────
            const seed = Date.now();
            const contentAngles = [
                "a mind-blowing fact nobody talks about",
                "a dark or hidden truth that will shock viewers",
                "a controversial take that challenges common beliefs",
                "an untold origin story or historical mystery",
                "a future prediction that sounds crazy but is backed by science",
                "a comparison that puts things into jaw-dropping perspective",
                "a secret technique or life hack most people don't know",
                "a story of an underdog or forgotten genius",
                "a bizarre connection between two unrelated things",
                "a countdown of the most insane facts about the topic",
                "a what-if scenario that changes everything",
                "a debunking of a popular myth with surprising evidence",
            ];
            const angle = contentAngles[seed % contentAngles.length];
            
            const webContext = webResearchData?.webContext || '';
            const randomTopicTwist = `SPECIFIC TOPIC: The video MUST be specifically about: "${chosenTopic}". Focus entirely on this topic. Make it engaging, viral, and packed with fascinating details. Angle: ${angle}. Seed: ${seed}`;
            // ─────────────────────────────────────────────────────────

            const systemPrompt = `You are a world-class documentary narrator and viral storyteller. Write a ${durationLabel} short-form video script.

🚨 SUPER CRITICAL RULES:
1. Output ONLY a valid JSON object.
2. Your JSON MUST be wrapped exactly in <json> and </json> tags.
3. NEVER output markdown code blocks (like \`\`\`json).
4. Write ONLY in ENGLISH. Clear, concise English that translates well to other languages.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📖 STEP 1 — IDENTIFY CENTRAL NARRATIVE THREAD (MANDATORY BEFORE WRITING)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Before writing ANY narration, read the VERIFIED RESEARCH FACTS block carefully. Find the CENTRAL NARRATIVE — a single overarching story arc (e.g. "rise, betrayal, and rebirth", "a city built on blood that became a symbol of peace", "the secret that changed everything"). EVERY scene must be a CHAPTER of this central story.

Plan 6 scenes as story chapters — each must DIRECTLY follow from the previous:
- scene1 (HOOK): A jaw-dropping fact, bold claim, or provocative question that OPENS the central story.
- scene2 (ORIGIN): How/when/why it all began — specific dates, founders, causes.
- scene3 (CONFLICT/TURNING POINT): The pivotal crisis, war, tragedy, or discovery that changed the story.
- scene4 (DEPTH): A specific person, secret, lesser-known detail, or hidden consequence that deepens the story.
- scene5 (CONSEQUENCE/MODERN): How the events of scenes 1-4 echo today — real data, current impact.
- scene6 (EMOTIONAL CLOSE): A resonant conclusion tying ALL scenes together. End with one unforgettable sentence.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔗 STEP 2 — NARRATIVE BRIDGING (NON-NEGOTIABLE)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Each scene narration MUST end with a 1-sentence BRIDGE that naturally leads into the NEXT scene topic. The viewer must feel a seamless flow — NOT a jarring topic switch.
Examples of good bridges:
  • scene1→2: "But to understand HOW this happened, we need to go back to [year]..."
  • scene2→3: "What started as [peaceful thing] was about to face its greatest test."
  • scene3→4: "And one man changed everything — but history almost forgot his name."
  • scene4→5: "That decision still echoes today in ways most people never realize."
  • scene5→6: "Which brings us to the question that defines this entire story:"
Do NOT begin the next scene by repeating the bridge topic — it already carries over.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔴 TOPIC ADHERENCE (CRITICAL)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Every scene MUST directly relate to the video TITLE AND the CENTRAL NARRATIVE.
- Never drift into generic tourism, food, or culture unless the title specifically demands it.
- Ask yourself before every sentence: "Does this advance the central story?"

SCRIPT REQUIREMENTS:
1. TOTAL LENGTH: 310-350 words. Each scene MUST have 50-60 words.
2. STRUCTURE: Use explicit keys ("scene1"..."scene6") — NOT an array.
3. NARRATION STYLE: No meta-commentary, no "Scene 1", no "Welcome". Start the HOOK directly with a fact or bold claim. Every sentence must contain a SPECIFIC fact, date, name, or number.
4. IMAGE PROMPTS (CRITICAL — this feeds directly into Nano Banana 2, a professional AI image model):
   - For 'real_entity' scenes ONLY. Write 60-80 word ULTRA-DETAILED prompts.
   - 🔴 SCENE-SPECIFIC RULE (NON-NEGOTIABLE): The imagePrompt MUST visually depict the SPECIFIC EVENT, MOMENT, or ACTION described in THAT scene's narration — NOT a generic establishing shot of the subject.
     ❌ WRONG: "The Golden Temple Harmandir Sahib Ji exterior view" (generic — shows nothing from the narration)
     ✅ CORRECT: "Maharaja Ranjit Singh Ji's craftsmen applying 750 kg of pure 24-karat gold leaf onto the upper walls of Harmandir Sahib Ji in 1830, workers on bamboo scaffolding in warm torch-lit dawn light, gleaming freshly gilded walls contrasting with white marble base, low-angle dramatic perspective, spiritual awe atmosphere" (scene-specific — shows the exact historical moment from the narration)
   - Ask yourself: "If someone sees this image with NO audio, will they understand what THIS SCENE is about?" If yes, the prompt is correct.
   - MANDATORY structure: [Exact subject + scene-specific action or moment from narration] + [architectural/physical textures relevant to THIS event] + [camera angle & lens] + [lighting] + [atmosphere & mood] + [color palette] + [style keywords].
   - ALWAYS name the specific subject explicitly (temple name, person name, monument). NEVER write generic descriptions.
   - Include: material textures (marble, gold, sandstone, brick), exact time of day lighting, weather/atmosphere, camera lens spec (24mm wide, 85mm portrait, etc.), and 3-5 style/quality tags at the end.
   - End every image prompt with: "ultra photorealistic, 8K resolution, professional photography, no text, no watermarks, no words."
   - For 'living_thing' or 'general' scenes: skip imagePrompt (set to empty string "").
5. VIDEO PROMPTS (for EVERY scene): 40-60 word cinematic camera descriptions.
   - Include: specific camera movement (slow dolly push-in, aerial crane shot, handheld follow, etc.), depth of field style, visual effects (light rays, particle dust, slow motion), and mood.
   - CRITICAL: NO text, NO titles, NO words, NO labels, NO overlays in the video.
6. THUMBNAIL PROMPT: 50-70 words, jaw-dropping, scroll-stopping visual. Must name the specific subject. NO TEXT, NO WORDS, NO WATERMARKS.
7. SCENE CATEGORIZATION:
   - "real_entity": real person, monument, artifact, historical site, landmark
   - "living_thing": fictional/generic people, animals
   - "general": abstract concepts, graphics, visual effects
8. TTS FORMATTING: No ellipses, em-dashes, en-dashes, colons, semicolons, ALL CAPS, or parenthetical asides. Short clean sentences only.
9. 🙏 RESPECTFUL HONORIFICS (MANDATORY FOR ALL SPIRITUAL / RELIGIOUS CONTENT):
   TRIGGER: If the video topic, title, or any scene involves — gods, deities, avatars, prophets, messengers, gurus, saints, sages, mystics, sufis, monks, pirs, fakirs, bhagats, devotional poets, revered kings with divine status, or ANY figure held sacred by any religion or culture — you MUST apply the correct honorific to their name EVERY SINGLE TIME it appears, in ALL JSON fields (narration, imagePrompt, videoPrompt, videoTitle, thumbnailPrompt).

   HONORIFIC GUIDE BY TRADITION:

   🔵 Sikhism:
   - All 10 Gurus → append "Ji" always → "Guru Nanak Dev Ji", "Guru Angad Dev Ji", "Guru Amar Das Ji", "Guru Ramdas Ji", "Guru Arjan Dev Ji", "Guru Hargobind Ji", "Guru Har Rai Ji", "Guru Harkrishan Ji", "Guru Tegh Bahadur Ji", "Guru Gobind Singh Ji"
   - Sikh saints / bhagats → "Bhagat Kabir Ji", "Bhagat Ravidas Ji", "Bhagat Namdev Ji"
   - Guru Granth Sahib → always "Guru Granth Sahib Ji" (never bare)

   🟠 Hinduism:
   - Major deities → "Shri Ram Ji", "Shri Krishna Ji", "Shri Ganesh Ji", "Maa Durga Ji", "Shri Shiva Ji", "Shri Vishnu Ji", "Maa Lakshmi Ji", "Maa Saraswati Ji"
   - Saints / sages → append "Ji" or "Maharaj" → "Sant Tukaram Ji", "Swami Vivekananda Ji", "Adi Shankaracharya Ji", "Ramakrishna Paramahansa Ji", "Sai Baba Ji", "Mirabai Ji", "Tulsidas Ji", "Kabir Das Ji"
   - Avatars → always with "Bhagwan" or "Shri" prefix + "Ji" suffix → "Bhagwan Shri Ram Ji"

   🟢 Islam & Sufism:
   - Prophet Muhammad → always "Prophet Muhammad (PBUH)" or "Hazrat Muhammad (PBUH)"
   - Islamic prophets → prefix "Hazrat" → "Hazrat Ibrahim (AS)", "Hazrat Musa (AS)", "Hazrat Isa (AS)"
   - Sufi saints → append "Sahib" or "Rh." (Rahimullah) → "Baba Farid Sahib", "Data Ganj Bakhsh Rh.", "Rumi Rh.", "Khwaja Moinuddin Chishti Rh."
   - Pirs / Fakirs → "Pir Sahib" prefix or "Ji" suffix as culturally appropriate

   🟡 Buddhism:
   - Gautam Buddha → "Bhagwan Gautam Buddha Ji" or "Lord Buddha"
   - Bodhisattvas / revered monks → append "Ji" or "Bhante" → "Nagarjuna Ji", "Milarepa Ji"
   - Dalai Lama → always "His Holiness the Dalai Lama"

   🔴 Jainism:
   - Tirthankaras → "Bhagwan Mahavir Ji", "Bhagwan Rishabdev Ji"
   - Jain saints → "Acharya [Name] Ji"

   🔵 Christianity:
   - Jesus Christ → "Lord Jesus Christ" or "Jesus Christ Our Lord"
   - Mary → "Virgin Mary" or "Mother Mary"
   - Saints → always prefix "Saint" → "Saint Francis of Assisi", "Saint Teresa of Calcutta"
   - Apostles → "Saint Peter", "Saint Paul"

   🟣 Judaism:
   - Moses → "Prophet Moses" or "Moshe Rabbeinu"
   - Revered rabbis → "Rabbi [Name]"

   🟤 Zoroastrianism:
   - Zoroaster → "Prophet Zarathustra" or "Zarathustra Ji"

   🌐 Universal Rule — ANY religion or tradition:
   - If a figure is considered divine, a messenger of God, a saint, or universally venerated by a community → NEVER write the name alone. ALWAYS use the appropriate title/honorific prefix or suffix.
   - When in doubt → append "Ji" as a universal respectful suffix (works across Hindi, Punjabi, Urdu contexts).
   - This rule applies even if the honorific was NOT in the research source. ADD IT regardless.

   ❌ NEVER DO THIS: "Guru Ramdas founded the city", "Kabir wrote poems", "Rumi was a poet"
   ✅ ALWAYS DO THIS: "Guru Ramdas Ji founded the city", "Kabir Das Ji wrote poems", "Rumi Rh. was a beloved mystic"

   This rule applies WITHOUT EXCEPTION to every single field in the JSON output.

JSON SCHEMA (wrap in <json> tags):
<json>
{
  "videoTitle": "compelling viral title",
  "thumbnailPrompt": "A stunning, click-worthy visual...",
  "totalScenes": ${sceneCount},
  "totalWordCount": 330,
  "scene1": {
    "narration": "Hook sentence with shocking fact... [4-5 sentences] ...Bridge to scene2.",
    "imagePrompt": "Ultra-detailed photorealistic description...",
    "videoPrompt": "Cinematic camera movement — NO TEXT...",
    "sceneCategory": "real_entity",
    "duration": 15,
    "wordCount": 55
  },
  "scene2": { "narration": "Origin story... [bridge to scene3].", ... },
  "scene3": { ... },
  "scene4": { ... },
  "scene5": { ... },
  "scene6": { "narration": "Emotional close that echoes scenes 1-5. One unforgettable final sentence.", ... }
}
</json>

🔴 ANTI-REPETITION (ABSOLUTELY CRITICAL):
- NEVER repeat the same idea, phrase, or sentence across scenes.
- BANNED phrases: "rich history", "attracts tourists", "unique and fascinating", "memorable experience", "let us explore", "in conclusion".
- Each scene MUST contain at least 3 SPECIFIC facts (dates, names, numbers) not used in any other scene.

🚨 CRITICAL: Finish all ${sceneCount} scenes. Output ONLY <json>{...}</json>.`;

            const userPrompt = `Topic: "${chosenTopic}"
Language: ENGLISH
${randomTopicTwist}

${webContext ? `\n${webContext}\n` : ''}

══════════════════════════════════════════════
SINGLE-TOPIC DEEP DIVE — THE CARDINAL RULE:
══════════════════════════════════════════════
ALL 6 scenes are about THE SAME topic: "${chosenTopic}"
Think of this as a 6-chapter mini-documentary. Do NOT jump to different subjects.
Instead, PEEL DEEPER into this ONE topic with each scene — like an onion:

  scene1 → HOOK: The single most shocking/surprising fact about this topic.
  scene2 → ORIGIN: When did this begin? Who started it? Why? (exact dates, names)
  scene3 → CRISIS: The darkest or most dramatic event this topic has ever faced.
  scene4 → HIDDEN LAYER: A secret, forgotten person, or little-known detail that changes everything.
  scene5 → MODERN ECHO: How this topic STILL shapes the world or people's lives today.
  scene6 → EMOTIONAL TRUTH: The human meaning behind it all. End with one unforgettable sentence.

BRIDGE RULE (MANDATORY):
Each scene must begin by directly referencing the previous scene's ending idea, creating a seamless narrative bridge. Scene 1 must end with a hook that Scene 2 resolves. Think of it as one continuous story, not 6 separate segments.
Every scene narration MUST end with a 1-sentence bridge leading naturally into the next layer.
  scene1→2: "But to understand how this happened, we must go back to [year/event]."
  scene2→3: "That foundation was about to face its most devastating test."
  scene3→4: "Buried in that chaos was a secret almost no one remembers."
  scene4→5: "And that forgotten truth still ripples through the world today."
  scene5→6: "Which brings us to the question this entire story has been building toward:"
Do NOT start the next scene by repeating the bridge — the listener already heard it.

WRITING RULES:
- 310-350 total words. Each scene: 50-60 words (including the bridge sentence).
- Every sentence must use a SPECIFIC fact, date, name, or number from the VERIFIED RESEARCH block above.
- Use explicit keys (scene1, scene2 … scene6). Do NOT use an array.
- No framing phrases ("Let's explore", "Scene 1", "Welcome"). Pure narration only.

OUTPUT: JSON object wrapped in <json> and </json> tags.`;

            // ── Generate with validation + retry ─────────────────────
            const MAX_ATTEMPTS = 3;
            let bestResult: any = null;
            let bestWordCount = 0;

            for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
                console.log(`🔄 Script generation attempt ${attempt}/${MAX_ATTEMPTS} (NVIDIA Mistral-large)...`);

                try {
                    const _sceneSchema = {
                        type: 'object',
                        properties: {
                            narration: { type: 'string' },
                            imagePrompt: { type: 'string' },
                            videoPrompt: { type: 'string' },
                            sceneCategory: { type: 'string', enum: ['real_entity', 'living_thing', 'general', 'doc_image'] },
                            asset_url: { type: 'string', nullable: true },
                            duration: { type: 'number' },
                            wordCount: { type: 'number' },
                        },
                        required: ['narration', 'imagePrompt', 'videoPrompt', 'sceneCategory'],
                    };
                    const result = await shortsLLM.json(systemPrompt, userPrompt, {
                        temperature: attempt === 1 ? 0.7 : (attempt === 2 ? 0.8 : 0.85),
                        maxTokens: 8192,
                    });

                    // ── Map explicit keys back to scenes array ────────────────
                    if (!result.scenes || !Array.isArray(result.scenes) || result.scenes.length === 0) {
                        const extractedScenes: any[] = [];
                        for (let i = 1; i <= sceneCount; i++) {
                            const sceneKey = `scene${i}`;
                            if (result[sceneKey]) {
                                extractedScenes.push({
                                    ...result[sceneKey],
                                    sceneNumber: i
                                });
                                delete result[sceneKey]; // cleanup
                            }
                        }
                        result.scenes = extractedScenes;
                    }

                    if (!result.scenes || result.scenes.length < sceneCount) {
                        throw new Error(`Generated only ${result.scenes?.length || 0} scenes, expected ${sceneCount}. Model likely truncated or ignored instructions.`);
                    }

                    // Count actual words across all scenes
                    const actualWordCount = result.scenes.reduce(
                        (sum: number, s: any) => sum + (s.narration?.split(/\s+/).length || 0),
                        0
                    );

                    console.log(`📊 Attempt ${attempt}: ${actualWordCount} words (target: ${totalWordsMin}-${totalWordsMax}), ${result.scenes.length} scenes`);

                    // Keep the best result
                    if (actualWordCount > bestWordCount) {
                        bestResult = result;
                        bestWordCount = actualWordCount;
                    }

                    // If word count is acceptable, use this result
                    if (actualWordCount >= totalWordsMin * 0.85) {
                        console.log(`✅ Word count OK (${actualWordCount} ≥ ${Math.floor(totalWordsMin * 0.85)})`);
                        break;
                    }

                    console.warn(`⚠️ Word count too low: ${actualWordCount} < ${totalWordsMin} (need 85%+)`);
                } catch (err: any) {
                    console.error(`❌ Attempt ${attempt} failed: ${err.message}`);
                    // Continue to next attempt
                }
            }

            if (!bestResult) {
                throw new Error('All script generation attempts failed. Please try again.');
            }

            // Recalculate accurate durations based on actual word counts
            if (bestResult?.scenes) {
                for (const scene of bestResult.scenes) {
                    const words = scene.narration?.split(/\s+/).length || 0;
                    scene.wordCount = words;
                    scene.duration = Math.round(words / WORDS_PER_SEC);
                }
                bestResult.totalWordCount = bestWordCount;
            }

            console.log(`✅ Script finalized (NVIDIA Mistral-large): "${bestResult.videoTitle}" | ${bestResult.scenes?.length} scenes | ${bestWordCount} words ≈ ${Math.round(bestWordCount / WORDS_PER_SEC)}s`);

            return bestResult;
        });

        // ── Step 2.5: Translate to target language if not English ────────────────
        // We run each translation as a separate Inngest step so that:
        // 1. Every scene gets its own fresh 5-minute Vercel execution window.
        // 2. Inngest checkpoints progress, avoiding starting from scratch if a timeout occurs.
        if (selectedLanguage && !selectedLanguage.startsWith('en') && scriptData.scenes?.length > 0) {
            console.log(`🌐 Translating script to ${selectedLanguage} step-by-step...`);
            const WORDS_PER_SEC = 2.5; // conversion factor for scene duration estimations

            // Translate title first
            const translatedTitle = await step.run("translate-title", async () => {
                const langName = LANGUAGE_NAMES[selectedLanguage] || selectedLanguage;
                return await translateSingleText(scriptData.videoTitle, langName, 'video title');
            });
            scriptData.videoTitle = translatedTitle;

            // Translate each scene's narration individually
            for (let i = 0; i < scriptData.scenes.length; i++) {
                const scene = scriptData.scenes[i];
                if (scene.narration) {
                    const translatedNarration = await step.run(`translate-scene-narration-${i}`, async () => {
                        const langName = LANGUAGE_NAMES[selectedLanguage] || selectedLanguage;
                        return await translateSingleText(scene.narration, langName, `scene ${i + 1} narration`);
                    });
                    scene.narration = translatedNarration;
                    scene.wordCount = translatedNarration.split(/\s+/).length;
                    scene.duration = Math.round(translatedNarration.split(/\s+/).length / WORDS_PER_SEC);
                }
            }

            // Recalculate total word count
            scriptData.totalWordCount = scriptData.scenes.reduce(
                (sum: number, s: any) => sum + (s.wordCount || 0), 0
            );
            console.log(`✅ Translation complete — ${scriptData.totalWordCount} words in ${selectedLanguage}`);
        }


        // Update status: generating voice
        await step.run("update-status-voice", () => updateSeriesStatus(seriesId, "generating:voice"));

        // Step 3: Generate Voice using TTS (Sarvam) — ONE STEP PER SCENE to avoid 60s timeouts.
        // Each scene audio is saved as an Inngest checkpoint; if Vercel times out mid-way,
        // Inngest resumes from the next unfinished scene instead of restarting all from scratch.
        const voiceConfigs = studioPayload?.sceneVoiceConfigs || [];
        const sceneAudioUrls: string[] = [];

        for (let i = 0; i < scriptData.scenes.length; i++) {
            const scene = scriptData.scenes[i];
            let sceneNarration = scene.narration || '';
            if (!sceneNarration.trim()) {
                sceneAudioUrls.push(''); // keep index aligned
                continue;
            }

            const sceneAudioUrl = await step.run(`generate-voice-scene-${i}`, async () => {
                // Ensure sentence ends with punctuation (adds natural pause)
                if (!/[.!?]$/.test(sceneNarration.trim())) sceneNarration += '.';

                const cleanedScene = sanitizeForTTS(sceneNarration);
                const scenePace = voiceConfigs[i]?.pace ?? 1.05;
                const sceneTemp  = voiceConfigs[i]?.temperature ?? 0.7;

                console.log(`🔊 Scene ${i + 1}/${scriptData.scenes.length}: ${cleanedScene.length} chars (pace: ${scenePace}, temp: ${sceneTemp})`);

                const chunks = chunkText(cleanedScene, 2200);
                const audioBuffers: Buffer[] = [];

                for (let j = 0; j < chunks.length; j++) {
                    const buf = await callSarvamTTS(
                        chunks[j],
                        selectedVoice,
                        selectedLanguage,
                        scenePace,
                        sceneTemp
                    );
                    audioBuffers.push(buf);
                    if (j < chunks.length - 1) await new Promise(r => setTimeout(r, 1000));
                }

                // Merge chunk buffers for this scene into a single WAV
                const sceneWav = mergeWavBuffers(audioBuffers);

                // Upload this scene's WAV temporarily so the merge step can fetch it
                const blob = await putWithRotation(
                    `shorts/${seriesData.seriesId}/scene_audio_${i}_${Date.now()}.wav`,
                    sceneWav,
                    { access: "public", contentType: "audio/wav" }
                );
                return blob.url;
            });

            sceneAudioUrls.push(sceneAudioUrl);

            // Small gap between scene steps to avoid Sarvam rate-limits on rapid retries
            if (i < scriptData.scenes.length - 1) {
                await new Promise(r => setTimeout(r, 300));
            }
        }

        // Merge all per-scene WAVs into one final audio file
        const voiceData = await step.run("merge-and-upload-audio", async () => {
            const validUrls = sceneAudioUrls.filter(Boolean);
            console.log(`🔗 Merging ${validUrls.length} scene audio files...`);

            const audioBuffers: Buffer[] = [];
            for (const url of validUrls) {
                const res = await fetch(url);
                if (!res.ok) throw new Error(`Failed to fetch scene audio: ${url}`);
                audioBuffers.push(Buffer.from(await res.arrayBuffer()));
            }

            const finalAudio = mergeWavBuffers(audioBuffers);
            console.log(`🔗 Merged audio: ${finalAudio.length} bytes`);

            // Estimate duration from WAV header
            const sampleRate    = finalAudio.readUInt32LE(24);
            const dataSize      = finalAudio.length - 44;
            const bytesPerSample = finalAudio.readUInt16LE(34) / 8;
            const channels      = finalAudio.readUInt16LE(22);
            const audioDuration = dataSize / (sampleRate * bytesPerSample * channels);
            console.log(`⏱️ Estimated duration: ${audioDuration.toFixed(1)}s`);

            const blobResult = await putWithRotation(
                `shorts/${seriesData.seriesId}/audio_${Date.now()}.wav`,
                finalAudio,
                { access: "public", contentType: "audio/wav" }
            );

            console.log(`✅ Audio uploaded: ${blobResult.url}`);
            return {
                audioUrl: blobResult.url,
                audioDuration: Math.round(audioDuration * 10) / 10,
            };
        });


        // Update status: generating captions
        await step.run("update-status-captions", () => updateSeriesStatus(seriesId, "generating:captions"));

        // Step 4: Generate Captions using Sarvam Batch STT (handles >30s audio)
        const captionData = await step.run("generate-captions", async () => {
            console.log(`📄 Generating captions for: "${seriesData.title}"`);

            const fs = require('fs');
            const path = require('path');
            const os = require('os');
            const { SarvamAIClient } = require('sarvamai');

            // Initialize Sarvam SDK client
            const sarvamClient = new SarvamAIClient({
                apiSubscriptionKey: process.env.SARVAM_API_KEY!,
            });

            // Step A: Download the audio from Vercel Blob
            console.log(`📥 Downloading audio from: ${voiceData.audioUrl}`);
            const audioRes = await fetch(voiceData.audioUrl);
            if (!audioRes.ok) {
                throw new Error(`Failed to download audio: ${audioRes.status}`);
            }
            const audioBuffer = Buffer.from(await audioRes.arrayBuffer());
            console.log(`✅ Downloaded audio: ${audioBuffer.length} bytes`);

            // Step B: Write audio to a temp file (SDK needs file path)
            const tempDir = os.tmpdir();
            const tempFileName = `shorts_audio_${Date.now()}.wav`;
            const tempFilePath = path.join(tempDir, tempFileName);
            fs.writeFileSync(tempFilePath, audioBuffer);
            console.log(`📝 Temp file created: ${tempFilePath}`);

            try {
                // Step C: Create batch STT job
                console.log(`🔄 Creating Sarvam batch STT job...`);
                const job = await sarvamClient.speechToTextJob.createJob({
                    model: "saaras:v3",
                    // @ts-ignore
                    mode: "transcribe",
                    languageCode: selectedLanguage || "en-IN",
                    withTimestamps: true,
                    withDiarization: false,
                    numSpeakers: 1,
                });
                console.log(`✅ Batch job created`);

                // Step D: Upload audio file to job
                console.log(`📤 Uploading audio to Sarvam AI...`);
                await job.uploadFiles([tempFilePath]);
                console.log(`✅ Audio uploaded`);

                // Step E: Start processing
                console.log(`⚙️ Starting transcription job...`);
                await job.start();
                console.log(`✅ Job started`);

                // Step F: Wait for completion
                console.log(`⏳ Waiting for transcription to complete...`);
                await job.waitUntilComplete();
                console.log(`✅ Transcription complete!`);

                // Step G: Get results
                console.log(`📊 Fetching results...`);
                const fileResults = await job.getFileResults();

                // Check for failures
                if (fileResults.failed && fileResults.failed.length > 0) {
                    throw new Error(`STT failed: ${fileResults.failed[0].error_message}`);
                }
                if (!fileResults.successful || fileResults.successful.length === 0) {
                    throw new Error('No successful transcription results');
                }

                // Step H: Download and parse output
                console.log(`📥 Downloading transcription output...`);
                const outputDir = path.join(tempDir, `sarvam_stt_${Date.now()}`);
                fs.mkdirSync(outputDir, { recursive: true });

                await job.downloadOutputs(outputDir);
                console.log(`✅ Output downloaded to: ${outputDir}`);

                // Step I: Read the JSON output file
                const outputFiles = fs.readdirSync(outputDir);
                const jsonFile = outputFiles.find((f: string) => f.endsWith('.json'));

                if (!jsonFile) {
                    throw new Error('No JSON output file found in STT results');
                }

                const outputPath = path.join(outputDir, jsonFile);
                const outputData = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
                console.log(`📄 STT output keys: ${Object.keys(outputData)}`);

                const fullText = outputData.transcript || outputData.text || '';
                console.log(`📝 Transcript: ${fullText.substring(0, 100)}...`);

                // Step J: Extract word-level timestamps
                const timestamps: Array<{ word: string; start: number; end: number }> = [];

                if (outputData.words && Array.isArray(outputData.words)) {
                    for (const w of outputData.words) {
                        timestamps.push({
                            word: w.word || w.text || '',
                            start: w.start || w.start_time || 0,
                            end: w.end || w.end_time || 0,
                        });
                    }
                } else if (outputData.segments && Array.isArray(outputData.segments)) {
                    for (const seg of outputData.segments) {
                        if (seg.words && Array.isArray(seg.words)) {
                            for (const w of seg.words) {
                                timestamps.push({
                                    word: w.word || w.text || '',
                                    start: w.start || w.start_time || 0,
                                    end: w.end || w.end_time || 0,
                                });
                            }
                        }
                    }
                } else if (outputData.timestamps && Array.isArray(outputData.timestamps)) {
                    for (const t of outputData.timestamps) {
                        timestamps.push({
                            word: t.word || t.text || '',
                            start: t.start ?? t.start_time ?? 0,
                            end: t.end ?? t.end_time ?? 0,
                        });
                    }
                }

                // Fallback: estimate timestamps from transcript
                if (timestamps.length === 0 && fullText) {
                    console.warn('⚠️ No word timestamps in output, using estimated timing');
                    const words = fullText.split(/\s+/);
                    const avgDuration = (voiceData.audioDuration || 60) / words.length;
                    words.forEach((w: string, i: number) => {
                        timestamps.push({
                            word: w,
                            start: +(i * avgDuration).toFixed(2),
                            end: +((i + 1) * avgDuration).toFixed(2),
                        });
                    });
                }

                console.log(`📊 Extracted ${timestamps.length} word timestamps`);

                // Clean up temp files
                try {
                    fs.unlinkSync(tempFilePath);
                    fs.rmSync(outputDir, { recursive: true, force: true });
                    console.log('🗑️ Temp files cleaned up');
                } catch (e) {
                    console.warn('⚠️ Cleanup failed:', e);
                }

                // Group words into caption segments (~6 words each for comfortable reading speed)
                const WORDS_PER_SEGMENT = 6;
                const segments: Array<{
                    text: string;
                    start: number;
                    end: number;
                    words: typeof timestamps;
                }> = [];

                for (let i = 0; i < timestamps.length; i += WORDS_PER_SEGMENT) {
                    const group = timestamps.slice(i, i + WORDS_PER_SEGMENT);
                    segments.push({
                        text: group.map(w => w.word).join(' '),
                        start: group[0].start,
                        end: group[group.length - 1].end,
                        words: group,
                    });
                }

                console.log(`✅ Created ${segments.length} caption segments`);

                return {
                    transcript: fullText,
                    language: selectedLanguage,
                    wordTimestamps: timestamps,
                    segments,
                };

            } catch (error: any) {
                // Clean up temp file on error
                try { fs.unlinkSync(tempFilePath); } catch { }
                console.error(`❌ Sarvam Batch STT Error: ${error.message}`);
                console.log(`⚠️ Falling back to estimated word timestamps from narration text...`);

                // Fallback: estimate timestamps from script narration
                const fullNarration = scriptData.scenes
                    .map((s: any) => s.narration)
                    .join(' ');
                const words = fullNarration.split(/\s+/);
                const totalDuration = voiceData.audioDuration || 60;
                const avgWordDuration = totalDuration / words.length;

                const timestamps: Array<{ word: string; start: number; end: number }> = [];
                words.forEach((w: string, i: number) => {
                    timestamps.push({
                        word: w,
                        start: +(i * avgWordDuration).toFixed(2),
                        end: +((i + 1) * avgWordDuration).toFixed(2),
                    });
                });

                // Group words into caption segments (~6 words each for comfortable reading speed)
                const WORDS_PER_SEGMENT = 6;
                const segments: Array<{
                    text: string;
                    start: number;
                    end: number;
                    words: typeof timestamps;
                }> = [];

                for (let i = 0; i < timestamps.length; i += WORDS_PER_SEGMENT) {
                    const group = timestamps.slice(i, i + WORDS_PER_SEGMENT);
                    segments.push({
                        text: group.map(w => w.word).join(' '),
                        start: group[0].start,
                        end: group[group.length - 1].end,
                        words: group,
                    });
                }

                console.log(`✅ Fallback: Created ${segments.length} estimated caption segments from ${words.length} words`);

                return {
                    transcript: fullNarration,
                    language: selectedLanguage,
                    wordTimestamps: timestamps,
                    segments,
                };
            }
        });

        // Update status: generating images
        await step.run("update-status-images", () => updateSeriesStatus(seriesId, "generating:images"));

        // Step 5: Generate Images — Nano Banana (Gemini 2.5 Flash Image) — SPLIT INTO STEPS TO PREVENT TIMEOUTS
        const resolvedAssets = await step.run("resolve-assets", async () => {
            console.log(`🖼️ Resolving assets for: "${seriesData.title}"`);
            console.log(`📸 Scenes: ${scriptData.scenes?.length}`);

            const totalScenes = scriptData.scenes.length;
            const imageUrls: string[] = new Array(totalScenes).fill("");
            const sceneOverrides: Record<number, string> = {};
            const sceneProbedDurations: Record<number, number> = {};

            for (let i = 0; i < totalScenes; i++) {
                const scene = scriptData.scenes[i];

                // ── STUDIO MODE: User provided their own asset(s) ─────────────────
                const sceneAsset = resolveSceneAsset(i);

                // type:"ai" (or null/undefined) = no user asset for this scene.
                // Fall through to the sceneCategory logic below — identical to the
                // normal short-generator pipeline:
                //   real_entity / monument → imageUrls[i] = "" → Flatkey image → WaveSpeed I2V
                //   living_thing / general → imageUrls[i] = "SKIP_T2V" → WaveSpeed T2V
                if (sceneAsset && (sceneAsset.type === "user_upload" || sceneAsset.type === "doc_image")) {
                    if (sceneAsset.type === "doc_image") {
                        const docUrl = sceneAsset.docImageUrl || sceneAsset.files?.[0]?.url || "";
                        console.log(`📸 Studio Scene ${i + 1}: doc_image → ${docUrl.substring(0, 60)}`);
                        imageUrls[i] = docUrl || "SKIP_T2V";
                        continue;
                    }

                    // ── user_upload: Build COMPOSITE payload preserving ALL assets in user order ──
                    const allFiles: any[] = sceneAsset.files || [];
                    const splitPairs: [string, string][] = sceneAsset.splitPairs || [];
                    const realVideos = allFiles.filter((f: any) => f.isVideo && !f.isImgToVideo);
                    const legacySplit = splitPairs.length === 0 && sceneAsset.splitScreenEnabled && realVideos.length >= 2;
                    if (legacySplit) {
                        splitPairs.push([realVideos[0].fileId, realVideos[1].fileId]);
                    }

                    const consumedByPair = new Set<string>();
                    for (const [a, b] of splitPairs) { consumedByPair.add(a); consumedByPair.add(b); }

                    type CompositeAsset =
                        | { kind: "image"; url: string }
                        | { kind: "video"; url: string; durationSec: number; isImgToVideo: boolean }
                        | { kind: "split"; urls: [string, string]; durationSec: number };

                    const compositeAssets: CompositeAsset[] = [];
                    const pairsEmitted = new Set<string>();

                    for (const file of allFiles) {
                        const fid = file.fileId;
                        if (consumedByPair.has(fid)) {
                            for (const [a, b] of splitPairs) {
                                if (a !== fid && b !== fid) continue;
                                const pairKey = `${a}-${b}`;
                                if (pairsEmitted.has(pairKey)) continue;
                                pairsEmitted.add(pairKey);

                                const fileA = allFiles.find((f: any) => f.fileId === a);
                                const fileB = allFiles.find((f: any) => f.fileId === b);
                                if (!fileA || !fileB) {
                                    console.warn(`⚠️ Scene ${i + 1}: split pair references missing file(s), skipping pair`);
                                    continue;
                                }
                                compositeAssets.push({
                                    kind: "split",
                                    urls: [fileA.url, fileB.url],
                                    durationSec: 0,
                                });
                            }
                            continue;
                        }

                        if (file.isVideo) {
                            compositeAssets.push({
                                kind: "video",
                                url: file.url,
                                durationSec: 0,
                                isImgToVideo: !!file.isImgToVideo,
                            });
                        } else {
                            compositeAssets.push({ kind: "image", url: file.url });
                        }
                    }

                    if (compositeAssets.length === 0) {
                        imageUrls[i] = "SKIP_T2V";
                        continue;
                    }

                    if (compositeAssets.length === 1) {
                        const single = compositeAssets[0];
                        if (single.kind === "image") {
                            console.log(`🖼️ Studio Scene ${i + 1}: single image → ${single.url.substring(0, 60)}`);
                            imageUrls[i] = single.url;
                            continue;
                        }
                        if (single.kind === "video") {
                            const probedDur = await probeVideoDuration(single.url);
                            sceneProbedDurations[i] = Math.round(probedDur * 10) / 10;
                            console.log(`🎬 Studio Scene ${i + 1}: single video → ${single.url.substring(0, 60)} (probed: ${sceneProbedDurations[i]}s)`);
                            imageUrls[i] = single.url;
                            continue;
                        }
                        if (single.kind === "split") {
                            const [d1, d2] = await Promise.all([
                                probeVideoDuration(single.urls[0]),
                                probeVideoDuration(single.urls[1]),
                            ]);
                            sceneProbedDurations[i] = Math.round(Math.max(d1, d2) * 10) / 10;
                            const splitPayload = JSON.stringify({
                                type: "split",
                                urls: single.urls,
                            });
                            console.log(`📺 Studio Scene ${i + 1}: split-screen → ${single.urls[0].substring(0, 40)} | ${single.urls[1].substring(0, 40)} (probed: ${sceneProbedDurations[i]}s)`);
                            imageUrls[i] = "SKIP_T2V";
                            sceneOverrides[i] = splitPayload;
                            continue;
                        }
                    }

                    const hasAnyVideo = compositeAssets.some(a => a.kind === "video" || a.kind === "split");
                    if (!hasAnyVideo) {
                        const slideshowPayload = JSON.stringify({
                            type: "slideshow",
                            urls: compositeAssets.map(a => (a as any).url),
                        });
                        console.log(`🖼️ Studio Scene ${i + 1}: slideshow × ${compositeAssets.length} images`);
                        imageUrls[i] = slideshowPayload;
                        continue;
                    }

                    console.log(`📦 Studio Scene ${i + 1}: composite (${compositeAssets.length} assets). Probing video durations...`);
                    const probePromises: Promise<void>[] = [];
                    for (const asset of compositeAssets) {
                        if (asset.kind === "video") {
                            probePromises.push(
                                probeVideoDuration(asset.url).then(d => {
                                    asset.durationSec = Math.round(d * 10) / 10;
                                    console.log(`  ⏱️ video ${asset.url.substring(0, 50)}: ${asset.durationSec}s`);
                                })
                            );
                        } else if (asset.kind === "split") {
                            probePromises.push(
                                Promise.all([
                                    probeVideoDuration(asset.urls[0]),
                                    probeVideoDuration(asset.urls[1]),
                                ]).then(([d1, d2]) => {
                                    asset.durationSec = Math.round(Math.max(d1, d2) * 10) / 10;
                                    console.log(`  ⏱️ split-screen: ${asset.durationSec}s`);
                                })
                            );
                        }
                    }
                    await Promise.all(probePromises);

                    const compositePayload = JSON.stringify({
                        type: "composite",
                        assets: compositeAssets,
                    });
                    console.log(`📦 Studio Scene ${i + 1}: composite payload ready (${compositeAssets.length} assets)`);
                    imageUrls[i] = "SKIP_T2V";
                    sceneOverrides[i] = compositePayload;
                    continue;
                }


            }

            return { imageUrls, sceneOverrides, sceneProbedDurations };
        });

        // ── SAME PATTERN AS NORMAL GENERATOR: Enrich ALL → Submit ALL → Sleep → Poll ──
        // This mirrors exactly what the normal short generator does and is why it
        // never hits timeouts. No single step runs a polling loop — instead we
        // submit all jobs fast, sleep, then check status in parallel.

        // Collect which scene indices need AI image generation (empty slots from resolve-assets)
        const scenesNeedingImages = scriptData.scenes
            .map((scene: any, i: number) => ({ scene, i }))
            .filter(({ i }: { i: number }) => resolvedAssets.imageUrls[i] === "");

        // ── Step A: Enrich prompts (Each scene in its own step.run to prevent Vercel 504 timeouts) ──
        const enrichedPrompts: Record<number, string> = {};
        for (const { scene, i } of scenesNeedingImages) {
            const originalPrompt = scene.imagePrompt || scene.narration || "Cinematic scene illustration";
            const wordCount = originalPrompt.split(/\s+/).length;
            const alreadyRich = wordCount >= 70 && /photorealistic|cinematic|8k|ultra detailed/i.test(originalPrompt);

            if (alreadyRich) {
                console.log(`  ✅ Scene ${i + 1}: prompt already rich (${wordCount} words), skipping enrichment`);
                enrichedPrompts[i] = originalPrompt;
                continue;
            }

            enrichedPrompts[i] = await step.run(`enrich-prompt-scene-${i}`, async () => {
                try {
                    const systemPrompt = `You are an expert AI image prompt engineer specialising in photorealistic image generation for Nano Banana 2 (Leonardo AI). Rewrite the scene description into a SINGLE rich image prompt.

MANDATORY: Subject identity + architectural/physical details + camera angle + lighting + atmosphere + colour palette + end with "ultra photorealistic, 8K UHD, RAW photo, sharp focus, intricate detail, award-winning photography, no text, no watermarks, no words"

OUTPUT: Return ONLY the enriched prompt (60-90 words). No explanation, no labels, no JSON.`;

                    const userPrompt = `SCENE NARRATION: "${scene.narration || ''}"
ORIGINAL PROMPT: "${originalPrompt}"

Rewrite so it VISUALLY DEPICTS the specific event in the narration. 65-90 words. No explanation.`;

                    console.log(`🤖 Enriching prompt for scene ${i + 1}...`);
                    const enriched = await shortsLLM.enrich(systemPrompt, userPrompt, { temperature: 0.4, maxTokens: 300 });
                    if (enriched && enriched.trim().split(/\s+/).length > wordCount) {
                        console.log(`  ✨ Scene ${i + 1}: prompt enriched ${wordCount}→${enriched.trim().split(/\s+/).length} words`);
                        return enriched.trim();
                    }
                    return originalPrompt;
                } catch (err: any) {
                    console.warn(`  ⚠️ Scene ${i + 1}: enrichment failed (${err?.message?.slice(0, 60)}), using original`);
                    return originalPrompt;
                }
            });
        }

        // ── Step B: Cancel check before submitting jobs ──
        const isCancelledBeforeSubmit = await step.run("check-cancel-before-image-submit", async () => {
            const [current] = await db.select({ status: shortVideoSeries.status })
                .from(shortVideoSeries)
                .where(eq(shortVideoSeries.seriesId, seriesId));
            return !current || current.status === "cancelled";
        });

        const finalImageUrls = [...resolvedAssets.imageUrls];

        if (isCancelledBeforeSubmit) {
            console.log("🛑 Series cancelled — skipping image generation");
            for (const { i } of scenesNeedingImages) finalImageUrls[i] = ""; // empty = skip video too
        } else if (scenesNeedingImages.length > 0) {
            // ── Step C: Generate all scene images in parallel (using rotating Apify tokens) ──
            console.log(`🚀 Generating ${scenesNeedingImages.length} images in parallel using Apify...`);
            const apifyResults = await step.run("generate-all-scene-images", async () => {
                const scenesInput = scenesNeedingImages.map(({ scene, i }: { scene: any; i: number }) => ({
                    index: i,
                    prompt: enrichedPrompts[i] || scene.imagePrompt || scene.narration || "Cinematic scene",
                    aspectRatio: "9:16"
                }));
                return await generateApifyImagesParallel(scenesInput);
            });

            // Map results back to finalImageUrls
            for (const res of apifyResults) {
                if (res.success && res.imageUrl) {
                    finalImageUrls[res.index] = res.imageUrl;
                } else {
                    console.warn(`⚠️ Scene ${res.index + 1} image generation failed: ${res.error}. Falling back to default placeholder.`);
                    finalImageUrls[res.index] = "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe"; // safe generic fallback
                }
            }
        }


        const imageData = {
            imageUrls: finalImageUrls,
            sceneOverrides: resolvedAssets.sceneOverrides,
            sceneProbedDurations: resolvedAssets.sceneProbedDurations
        };

        // ── Step 4.5: Generate Thumbnail with gpt-image-2 in its own step ─────────────
        const thumbnailUrl = await step.run("generate-thumbnail", async () => {
            let prompt = (scriptData as any).thumbnailPrompt ||
                `Cinematic masterpiece poster for: "${(scriptData as any).videoTitle || seriesData.title}". Epic composition, stunning lighting.`;
            prompt += " -- CRITICAL: NO TEXT, NO WORDS, NO LETTERS, NO NUMBERS. PURE IMAGE ONLY.";
            console.log(`🖼️ Generating thumbnail for: "${seriesData.title}"`);
            try {
                const url = await generateApifyImage(prompt, { aspectRatio: "9:16", sceneIndex: -1 });
                console.log(`✅ Thumbnail ready: ${url.substring(0, 60)}...`);
                return url;
            } catch (err: any) {
                console.warn(`⚠️ Thumbnail generation failed: ${err?.message}`);
                return "";
            }
        });

        const thumbnailData = { thumbnailUrl };



        // Update status: generating scene videos (image → video)
        await step.run("update-status-videos", () => updateSeriesStatus(seriesId, "generating:videos"));

        // ── Step 5a: Submit all Pollo Seedance scene video tasks (idempotent, fast) ──
        // Idempotency: checks shortVideoProgress DB for existing taskId before submitting.
        // On any Inngest retry, already-submitted tasks are reused — no duplicate Pollo jobs.
        const videoJobSubmissions = await step.run("submit-scene-video-jobs", async () => {
            const totalScenes = scriptData.scenes.length;
            const submitted: Array<{ index: number; taskId: string; apiKey: string }> = [];
            const sceneVideoUrls: string[] = new Array(totalScenes).fill("");
            const sceneVideoDurations: number[] = new Array(totalScenes).fill(5);

            // Cancel check
            try {
                const [cur] = await db.select({ status: shortVideoSeries.status })
                    .from(shortVideoSeries).where(eq(shortVideoSeries.seriesId, seriesId));
                if (cur?.status === "cancelled") {
                    console.log(`🛑 Cancellation detected — skipping video submission.`);
                    return { submitted, sceneVideoUrls, sceneVideoDurations };
                }
            } catch {}

            for (let i = 0; i < totalScenes; i++) {
                const scene = scriptData.scenes[i];
                const sceneImageUrl = imageData.imageUrls[i];
                const sceneDuration = scene.duration || 10;

                if (!sceneImageUrl || sceneImageUrl === "") continue;

                // SKIP_T2V / SKIP_VEO — no image available (cancelled, Studio doc_image, etc.)
                // With Apify Wan 2.2, we ONLY support image-to-video. Skip these scenes.
                if (sceneImageUrl === "SKIP_T2V" || sceneImageUrl === "SKIP_VEO") {
                    console.log(`⏭️ Scene ${i + 1} has no image (${sceneImageUrl}) — skipping video generation.`);
                    continue;
                }

                // Studio split/composite override — already a final video URL
                const splitOverride = imageData.sceneOverrides?.[i];
                if (splitOverride) {
                    sceneVideoUrls[i] = splitOverride;
                    sceneVideoDurations[i] = imageData.sceneProbedDurations?.[i] || sceneDuration;
                    continue;
                }

                // Slideshow JSON — handled at render time, not a video file
                try {
                    const parsed = JSON.parse(sceneImageUrl);
                    if (parsed?.type === "slideshow") { sceneVideoDurations[i] = sceneDuration; continue; }
                } catch {}

                // Direct user-uploaded video — use as-is
                if (/\.(mp4|mov|webm)/i.test(sceneImageUrl)) {
                    sceneVideoUrls[i] = sceneImageUrl;
                    sceneVideoDurations[i] = imageData.sceneProbedDurations?.[i] || sceneDuration;
                    continue;
                }

                // ── Idempotency check ────────────────────────────────────────────────
                // stepKey is prefixed with runId so each generation run has its own
                // isolated idempotency records — prevents stale rows from a previous
                // short in the same series being mistakenly reused.
                const stepKey = `${runId}_scene_video_${i}`;
                try {
                    const [existing] = await db.select().from(shortVideoProgress)
                        .where(and(eq(shortVideoProgress.seriesId, seriesId), eq(shortVideoProgress.stepKey, stepKey)));

                    if (existing?.status === "complete" && existing?.resultUrl) {
                        // Already processed on a previous run — load cached result
                        sceneVideoUrls[i] = existing.resultUrl;
                        if (existing.durationSec) sceneVideoDurations[i] = existing.durationSec;
                        console.log(`✅ Scene ${i + 1} already complete (cached), skipping submission`);
                        continue;
                    }
                    if (existing?.taskId && existing?.apiKey) {
                        // Already submitted but not yet processed — reuse taskId
                        submitted.push({ index: i, taskId: existing.taskId, apiKey: existing.apiKey });
                        console.log(`♻️ Scene ${i + 1} reusing existing taskId: ${existing.taskId.slice(0, 10)}...`);
                        continue;
                    }
                } catch {}

                // ── Build motion prompt ───────────────────────────────────────────────
                const pLower = (scene.videoPrompt || scene.imagePrompt || "").toLowerCase();
                let videoPrompt = scene.videoPrompt || scene.imagePrompt || scene.narration || "";
                const motionSuffix = /\b(person|woman|man|girl|boy|people|face)\b/.test(pLower)
                    ? " The person breathes naturally. Eyes blink softly. Hair drifts gently."
                    : /\b(water|ocean|sea|river|lake|rain|wave)\b/.test(pLower)
                    ? " Water ripples expand outward. Reflections shimmer. Light dances on surface."
                    : /\b(tree|plant|flower|grass|leaf|forest)\b/.test(pLower)
                    ? " Leaves rustle. Branches sway gently in breeze. Light filters through."
                    : " Ambient dust particles drift through light. Subtle atmospheric shimmer.";
                videoPrompt = videoPrompt.replace(/\b(text|title|caption|label|watermark|logo|word|letter|overlay)s?\b/gi, "")
                    .replace(/\s{2,}/g, " ").trim() + motionSuffix;
                if (!/(stationary|locked|tripod|zero camera)/i.test(videoPrompt))
                    videoPrompt += " Stationary camera, locked tripod, zero camera movement.";
                videoPrompt += " Absolutely no text, titles, words, writing, captions, labels, or overlays.";

                // ── Submit new Pollo Seedance task ───────────────────────────────────
                try {
                    const { taskId, apiKey } = await submitSeedanceVideoTask(
                        sceneImageUrl,
                        videoPrompt,
                        "9:16",
                        i
                    );
                    // Persist immediately so retries find it
                    try {
                        await db.insert(shortVideoProgress).values({ seriesId, stepKey, taskId, apiKey, status: "submitted" });
                    } catch { /* unique constraint = already inserted, that's fine */ }
                    submitted.push({ index: i, taskId, apiKey });
                    console.log(`🚀 Scene ${i + 1} video submitted: ${taskId}`);
                } catch (err: any) {
                    console.error(`❌ Scene ${i + 1} video submission failed: ${err.message}`);
                }
            }
            return { submitted, sceneVideoUrls, sceneVideoDurations };
        });

        // ── Steps 5b-z: Sleep → Check → Process rounds (max 20 × 30s = 10 min) ─────
        const MAX_VIDEO_ROUNDS = 20;
        let pendingVideoJobs = [...videoJobSubmissions.submitted];

        for (let vRound = 0; vRound < MAX_VIDEO_ROUNDS && pendingVideoJobs.length > 0; vRound++) {
            // First round: give Seedance 60s to start rendering before we check
            await step.sleep(`wait-scene-video-r${vRound}`, vRound === 0 ? "60s" : "30s");

            const videoCheckResult = await step.run(`check-scene-videos-r${vRound}`, async () => {
                const done: Array<{ index: number; rawUrl: string }> = [];
                const stillPending: typeof pendingVideoJobs = [];
                for (const job of pendingVideoJobs) {
                    const result = await checkPolloVideoTaskStatus(job.taskId, job.apiKey, job.index);
                    if (result.status === "complete" && result.url) {
                        done.push({ index: job.index, rawUrl: result.url });
                    } else if (result.status !== "failed") {
                        stillPending.push(job);
                    } else {
                        console.warn(`❌ Scene ${job.index + 1} Seedance task failed`);
                    }
                }
                console.log(`📊 Round ${vRound}: ${done.length} done, ${stillPending.length} pending`);
                return { done, stillPending };
            });

            // Each done scene gets its own isolated step (60s budget: download + FFmpeg + upload)
            for (const doneScene of videoCheckResult.done) {
                await step.run(`process-scene-video-${doneScene.index}`, async () => {
                    const stepKey = `${runId}_scene_video_${doneScene.index}`;
                    try {
                        // Idempotency: skip if already processed by a previous Inngest retry
                        const [existing] = await db.select().from(shortVideoProgress)
                            .where(and(eq(shortVideoProgress.seriesId, seriesId), eq(shortVideoProgress.stepKey, stepKey)));
                        if (existing?.status === "complete" && existing?.resultUrl) {
                            console.log(`✅ Scene ${doneScene.index + 1} already processed (cached), skipping`);
                            return;
                        }

                        const sceneImageUrl = imageData.imageUrls[doneScene.index];
                        const sceneDuration = scriptData.scenes[doneScene.index]?.duration || 10;
                        const result = await processSeedanceVideoResult(
                            doneScene.rawUrl,
                            (sceneImageUrl && sceneImageUrl !== "SKIP_T2V" && sceneImageUrl !== "SKIP_VEO") ? sceneImageUrl : undefined,
                            sceneDuration,
                            seriesId,
                            doneScene.index
                        );
                        await db.update(shortVideoProgress)
                            .set({ resultUrl: result.videoUrl, durationSec: result.actualDurationSec, status: "complete", updatedAt: new Date() })
                            .where(and(eq(shortVideoProgress.seriesId, seriesId), eq(shortVideoProgress.stepKey, stepKey)));
                    } catch (err: any) {
                        console.error(`❌ Scene ${doneScene.index + 1} processing failed: ${err.message}`);
                    }
                });
            }
            pendingVideoJobs = videoCheckResult.stillPending;
        }

        // ── Step 5z: Finalize — merge direct results + DB-processed results ─────────
        const sceneVideoData = await step.run("finalize-scene-videos", async () => {
            const totalScenes = scriptData.scenes.length;
            // Start with direct results (split/slideshow/direct-upload scenes)
            const sceneVideoUrls = [...videoJobSubmissions.sceneVideoUrls];
            const sceneThumbnailUrls: string[] = new Array(totalScenes).fill("");
            const sceneVideoDurations = [...videoJobSubmissions.sceneVideoDurations];

            // Overlay all successfully processed scenes from DB.
            // Filter by runId prefix so we only pick up rows from THIS generation run,
            // not stale completed rows from a previous short in the same series.
            const rows = await db.select().from(shortVideoProgress)
                .where(and(
                    eq(shortVideoProgress.seriesId, seriesId),
                    eq(shortVideoProgress.status, "complete"),
                    like(shortVideoProgress.stepKey, `${runId}_%`)
                ));
            for (const row of rows) {
                const m = row.stepKey.match(/scene_video_(\d+)$/);
                if (m && row.resultUrl) {
                    const idx = parseInt(m[1]);
                    if (idx < totalScenes) {
                        sceneVideoUrls[idx] = row.resultUrl;
                        if (row.durationSec) sceneVideoDurations[idx] = row.durationSec;
                    }
                }
            }

            const successCount = sceneVideoUrls.filter(u => u.length > 0).length;
            console.log(`✅ Scene video finalization: ${successCount}/${totalScenes} videos ready`);
            return { sceneVideoUrls, sceneThumbnailUrls, sceneVideoDurations };
        });
        // Update status: selecting avatar clips
        await step.run("update-status-avatar", () => updateSeriesStatus(seriesId, "generating:avatar"));

        // Step 5.5: Select pre-made HeyGen avatar clips and generate English TTS for intro/outro
        const avatarData = await step.run("select-avatar-clips", async () => {
            console.log(`🎭 Selecting HeyGen avatar clips and generating English TTS for: "${seriesData.title}"`);

            // Pick intro/outro pair based on pairing rules
            const pair = selectAvatarPair();

            // Generate English TTS audio for intro and outro (in parallel)
            const [introAudio, outroAudio] = await Promise.all([
                generateEnglishTTS(pair.intro.script, seriesId, "intro", seriesData.voice, pair.intro.videoDurationSec),
                generateEnglishTTS(pair.outro.script, seriesId, "outro", seriesData.voice, pair.outro.videoDurationSec),
            ]);

            const introClip = {
                videoUrl: pair.intro.videoUrl,
                audioUrl: introAudio.audioUrl,
                durationSec: introAudio.durationSec,
                videoDurationSec: pair.intro.videoDurationSec, // actual video file duration for playbackRate calc
            };
            const outroClip = {
                videoUrl: pair.outro.videoUrl,
                audioUrl: outroAudio.audioUrl,
                durationSec: outroAudio.durationSec,
                videoDurationSec: pair.outro.videoDurationSec, // actual video file duration for playbackRate calc
            };

            console.log(`✅ Intro clip ready: ${introClip.videoUrl} (${introClip.durationSec}s)`);
            console.log(`✅ Outro clip ready: ${outroClip.videoUrl} (${outroClip.durationSec}s)`);

            return { introClip, outroClip };
        });

        // Update status: video
        await step.run("update-status-video", () => updateSeriesStatus(seriesId, "generating:video"));

        // Step 5: (Implicitly handled by previous steps being done)
        const assetPreparation = await step.run("prepare-assets", async () => {
            console.log(`✅ Assets prepared for: "${seriesData.title}"`);
            return { ready: true };
        });

        // Update status: render
        await step.run("update-status-render", () => updateSeriesStatus(seriesId, "generating:render"));

        // Step 6: Trigger MP4 rendering & Save Initial Record
        const videoResult = await step.run("render-and-save", async () => {
            const videoId = `vid_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            const musicUrl = getMusicUrl(studioPayload?.music ?? seriesData.music);

            // Total duration = intro + narration + outro
            const introDuration = avatarData.introClip.durationSec;
            const outroDuration = avatarData.outroClip.durationSec;
            const totalDurationSec = introDuration + (voiceData.audioDuration || 60) + outroDuration;

            const props = {
                imageUrls: imageData.imageUrls,
                sceneVideoUrls: sceneVideoData.sceneVideoUrls,
                sceneVideoDurations: sceneVideoData.sceneVideoDurations,
                introClip: avatarData.introClip,
                outroClip: avatarData.outroClip,
                audioUrl: voiceData.audioUrl,
                audioDuration: voiceData.audioDuration,
                musicUrl,
                captionData: captionData,
                captionStyle: selectedCaptionStyle,
                language: selectedLanguage || 'en-IN',
                durationInFrames: Math.floor(totalDurationSec * 30),
            };

            // Avatar clip data for DB storage — store FULL objects (not just URLs)
            // so re-render API can reconstruct intro/outro without regenerating TTS
            const avatarClipUrls = [
                {
                    videoUrl: avatarData.introClip.videoUrl,
                    audioUrl: avatarData.introClip.audioUrl,
                    durationSec: avatarData.introClip.durationSec,
                    videoDurationSec: avatarData.introClip.videoDurationSec,
                },
                {
                    videoUrl: avatarData.outroClip.videoUrl,
                    audioUrl: avatarData.outroClip.audioUrl,
                    durationSec: avatarData.outroClip.durationSec,
                    videoDurationSec: avatarData.outroClip.videoDurationSec,
                },
            ];

            console.log(`💾 Saving initial video assets for: ${videoId}`);
            // Insert into shortVideoAssets table first
            await db.insert(shortVideoAssets).values({
                videoId,
                seriesId: seriesData.seriesId,
                voice: selectedVoice,
                language: selectedLanguage,
                videoTitle: scriptData.videoTitle || seriesData.title,
                scriptData: scriptData,
                audioUrl: voiceData.audioUrl,
                audioDuration: voiceData.audioDuration,
                captionData: captionData,
                imageUrls: imageData.imageUrls,
                sceneVideoUrls: sceneVideoData.sceneVideoUrls,
                sceneThumbnailUrls: sceneVideoData.sceneThumbnailUrls,
                avatarClipUrls, // Store intro/outro video URLs for reference
                thumbnailUrl: thumbnailData.thumbnailUrl || null, // AI Generated Thumbnail
                status: "processing",
            });

            // Trigger actual render
            const result = await triggerRender(videoId, props);
            console.log(`🎬 Render triggered (${result.mode} mode) for ${videoId}`);

            return { videoId, mode: result.mode };
        });

        // Update status: saving
        await step.run("update-status-saving", () => updateSeriesStatus(seriesId, "generating:saving"));

        // Step 7: Finalize Series Status
        const saveResult = await step.run("finalize-series", async () => {
            console.log(`🏁 Finalizing series: "${seriesData.title}"`);

            // Update series status to completed
            await db.update(shortVideoSeries)
                .set({ status: "completed", updatedAt: new Date() })
                .where(eq(shortVideoSeries.seriesId, seriesData.seriesId));

            console.log(`✅ Series status updated to completed`);

            return { saved: true, videoId: videoResult.videoId };
        });

        return {
            success: true,
            seriesId,
            scriptData,
            voiceData,
            captionData,
            imageData,
            saveResult,
        };
    }
);

// ─── Motion Graphic Video Generator ─────────────────────────────────────────

async function updateMotionGraphicStatus(projectId: string, status: string) {
    const { motionGraphicProjects } = require("@/config/schema");
    await db.update(motionGraphicProjects)
        .set({ status, updatedAt: new Date() })
        .where(eq(motionGraphicProjects.projectId, projectId));
}

export const generateMotionGraphic = inngest.createFunction(
    {
        id: "generate-motion-graphic",
        triggers: [{ event: "motion-graphics/generate.video" }],
        cancelOn: [
            {
                event: "motion-graphics/generate.cancel",
                match: "data.projectId"
            }
        ],
        onFailure: async ({ error, event }) => {
            const projectId = event?.data?.event?.data?.projectId;
            if (projectId) {
                console.error(`❌ Motion graphic generation failed: ${projectId}`, error);
                await updateMotionGraphicStatus(projectId, "failed");
            }
        }
    },
    async ({ event, step }) => {
        const { projectId } = event.data;
        const { motionGraphicProjects, motionGraphicMessages } = require("@/config/schema");

        // Step 1: Fetch project + latest changedSceneIndices from DB
        const project = await step.run("fetch-project", async () => {
            const [p] = await db
                .select()
                .from(motionGraphicProjects)
                .where(eq(motionGraphicProjects.projectId, projectId));

            if (!p) throw new Error(`Project not found: ${projectId}`);
            console.log(`✅ Fetched motion graphic project: "${p.prompt.substring(0, 50)}..."`);
            return p;
        });

        // Read changedSceneIndices from the latest assistant message.
        // If this is a partial patch, only those scene indices need AI processing.
        // Empty array = full regeneration (process all scenes).
        const { changedSceneIndices, animationRequestedIndices } = await step.run("fetch-changed-indices", async () => {
            const [latest] = await db
                .select({ metadata: motionGraphicMessages.metadata })
                .from(motionGraphicMessages)
                .where(
                    and(
                        eq(motionGraphicMessages.projectId, projectId),
                        eq(motionGraphicMessages.role, 'assistant')
                    )
                )
                .orderBy(desc(motionGraphicMessages.createdAt))
                .limit(1);

            const meta = latest?.metadata as any;
            if (meta?.type === 'scene_patch' && Array.isArray(meta?.changedSceneIndices)) {
                const changed   = meta.changedSceneIndices as number[];
                const animation = Array.isArray(meta.animationRequestedIndices) ? meta.animationRequestedIndices as number[] : [];
                console.log(`🎯 Partial update: scenes [${changed.join(', ')}]${animation.length ? ` | Animation requested: [${animation.join(', ')}]` : ''}`);
                return { changedSceneIndices: changed, animationRequestedIndices: animation };
            }
            console.log(`🔄 Full regeneration: processing all scenes`);
            return { changedSceneIndices: [] as number[], animationRequestedIndices: [] as number[] };
        });

        const isPartialRender = changedSceneIndices.length > 0;

        // Step 2: Generate scene images using Leonardo AI
        await step.run("update-status-assets", () => updateMotionGraphicStatus(projectId, "generating:assets"));

        const imageData = await step.run("generate-scene-images", async () => {
            const scenes = (project.sceneData as any[]) || [];
            console.log(`🖼️ Generating images for ${scenes.length} scenes...`);

            // ── Pre-flight: inject user-uploaded assets into relevant scenes ──────
            // Assets stored with Groq Vision 'category' field: logo|screenshot|product|person|other.
            // Use category directly — no keyword guessing on free-form descriptions.
            const uploadedSceneUrls: Record<number, string> = {};
            try {
                const [assetsMsg] = await db
                    .select({ metadata: motionGraphicMessages.metadata })
                    .from(motionGraphicMessages)
                    .where(
                        and(
                            eq(motionGraphicMessages.projectId, projectId),
                            eq(motionGraphicMessages.role, "assets")
                        )
                    )
                    .limit(1);

                const uploadedAssets: { url: string; name: string; description: string; category?: string }[] =
                    (assetsMsg?.metadata as any)?.assets || [];

                if (uploadedAssets.length > 0) {
                    console.log(`🖼️ Found ${uploadedAssets.length} uploaded asset(s) — injecting by Groq category`);

                    const LOGO_TYPES   = new Set(['logo_reveal', 'call_to_action']);
                    const SCREEN_TYPES = new Set(['browser_mockup', 'phone_mockup', 'bento_grid', 'image_showcase', 'split_hero', 'video_hero']);

                    for (const asset of uploadedAssets) {
                        // Category-based dispatch (Groq Vision structured output)
                        const cat = (asset.category || '').toLowerCase();
                        let targets: Set<string>;
                        if (cat === 'logo') {
                            targets = LOGO_TYPES;
                        } else if (cat === 'screenshot' || cat === 'product' || cat === 'person') {
                            targets = SCREEN_TYPES;
                        } else {
                            // 'other' or missing — fallback to description keywords
                            const desc = (asset.description || asset.name || '').toLowerCase();
                            const isLogo   = desc.includes('logo') || desc.includes('icon') || desc.includes('brand') || desc.includes('migoo');
                            const isScreen = desc.includes('screenshot') || desc.includes('ui') || desc.includes('mockup') || desc.includes('app') || desc.includes('dashboard') || desc.includes('website') || desc.includes('landing') || desc.includes('platform');
                            targets = isLogo ? LOGO_TYPES : isScreen ? SCREEN_TYPES : new Set([...LOGO_TYPES, ...SCREEN_TYPES]);
                        }

                        let injected = false;
                        for (let i = 0; i < scenes.length; i++) {
                            if (!targets.has(scenes[i].type)) continue;
                            if (uploadedSceneUrls[i]) continue; // already claimed by another asset

                            const currentUrl = scenes[i].imageUrl || '';
                            // Only treat as a preserved video if it's a REMOTE http URL ending in .mp4/.webm
                            // Stale local paths (tmp/assets_mg_...) are NOT valid preserved videos.
                            const isRemoteVideo = (currentUrl.startsWith('http://') || currentUrl.startsWith('https://'))
                                && (currentUrl.endsWith('.mp4') || currentUrl.endsWith('.webm') || currentUrl.includes('video-files'));
                            if (isRemoteVideo) {
                                uploadedSceneUrls[i] = currentUrl; // claim it with the video url
                                injected = true;
                                break;
                            }

                            uploadedSceneUrls[i] = asset.url;
                            scenes[i] = { ...scenes[i], imageUrl: asset.url };
                            console.log(`✅ Injected [${cat || '?'}] → Scene ${i + 1} (${scenes[i].type}): ${asset.url.slice(0, 60)}...`);
                            injected = true;
                            break;
                        }
                        if (!injected) {
                            // Last resort: widen to ALL visual scene types
                            const ALL_VISUAL = new Set([...LOGO_TYPES, ...SCREEN_TYPES]);
                            for (let i = 0; i < scenes.length; i++) {
                                if (!ALL_VISUAL.has(scenes[i].type)) continue;
                                if (uploadedSceneUrls[i]) continue;

                                const currentUrl = scenes[i].imageUrl || '';
                                const isRemoteVideo = (currentUrl.startsWith('http://') || currentUrl.startsWith('https://'))
                                    && (currentUrl.endsWith('.mp4') || currentUrl.endsWith('.webm') || currentUrl.includes('video-files'));
                                if (isRemoteVideo) {
                                    uploadedSceneUrls[i] = currentUrl;
                                    break;
                                }

                                uploadedSceneUrls[i] = asset.url;
                                scenes[i] = { ...scenes[i], imageUrl: asset.url };
                                console.log(`✅ Injected [fallback] → Scene ${i + 1} (${scenes[i].type}): ${asset.url.slice(0, 60)}...`);
                                break;
                            }
                        }
                    }
                }
            } catch (assetErr: any) {
                console.warn(`⚠️ Uploaded asset injection failed (non-fatal): ${assetErr.message}`);
            }

            // ── Tier 1: Scene types that ALWAYS need an image ──────────────────
            // These are visual component scenes that look broken/empty without one.
            const ALWAYS_IMAGE_TYPES = new Set([
                'image_showcase', 'split_hero', 'video_hero', 'phone_mockup',
                'browser_mockup', 'logo_reveal', 'comparison', 'testimonial',
                'glass_card', 'quote_reveal', 'search_reveal', 'floating_cards',
                'bento_grid', 'metric_dashboard',
            ]);

            // ── Tier 2: Self-contained scenes — image is optional background ──
            // These work fine without images (pure text/data). Generate for ~every
            // other one (even index) to add visual variety without 24 API calls.
            const OPTIONAL_IMAGE_TYPES = new Set([
                'title_reveal', 'kinetic_text', 'stat_counter', 'icon_grid',
                'call_to_action', 'neon_glow', 'gradient_burst', 'timeline_reveal',
                'timeline', 'process_steps', 'notification_stack', 'code_terminal',
                'feature_list',
            ]);

            // Scene-type → visual style hint for auto-generated prompts
            const sceneStyleHints: Record<string, string> = {
                title_reveal:       'cinematic title card background, dramatic dark atmosphere',
                kinetic_text:       'abstract motion blur background, neon light streaks, dark gradient',
                stat_counter:       'data dashboard, glowing chart elements, dark infographic background',
                icon_grid:          'minimal dark UI grid, subtle glowing icon placeholders',
                comparison:         'split-screen product comparison, professional studio showcase',
                image_showcase:     'hero product photograph, studio lighting, ultra high detail',
                call_to_action:     'vibrant gradient burst, energetic abstract composition',
                logo_reveal:        'dark premium background with soft radial glow, brand reveal',
                split_hero:         'editorial split layout, professional magazine photography',
                neon_glow:          'neon cyberpunk cityscape, glowing lines, dark atmosphere',
                gradient_burst:     'colorful fluid gradient explosion, abstract art',
                floating_cards:     'glassmorphism UI cards floating in dark space, bokeh',
                timeline_reveal:    'horizontal timeline infographic, clean minimal corporate',
                bento_grid:         'modern bento grid UI, dark frosted glass panels',
                video_hero:         'cinematic widescreen background, anamorphic lens flare',
                phone_mockup:       'realistic smartphone mockup on dark surface, studio lighting',
                browser_mockup:     'realistic browser window mockup on clean desk, soft light',
                timeline:           'professional timeline diagram, clean infographic style',
                testimonial:        'soft blurred modern office background, professional warm light',
                metric_dashboard:   'modern analytics dashboard dark theme, glowing KPI cards',
                process_steps:      'step-by-step process flow diagram, clean corporate infographic',
                notification_stack: 'stacked frosted-glass notification cards, dark bokeh background',
                code_terminal:      'dark terminal with glowing green code, hacker aesthetic',
                glass_card:         'glassmorphism hero card floating in dark space, bokeh',
                quote_reveal:       'elegant textured dark background, subtle moody lighting',
                search_reveal:      'minimal search interface mockup, clean white on dark',
                feature_list:       'clean dark UI feature comparison checklist, premium look',
            };

            const imagePrompts: string[] = [];
            const sceneIndices: number[] = [];

            // Only treat an imageUrl as valid if it's a remote HTTP/HTTPS URL.
            // Stale local temp paths (e.g. 'tmp/assets_mg_.../scene_0.mp4') saved by
            // old code are no longer valid after the assets dir is cleared and must
            // be treated as empty so the image is regenerated correctly.
            const isValidRemoteUrl = (url: string | undefined): boolean =>
                !!url && (url.startsWith('http://') || url.startsWith('https://'));

            for (let i = 0; i < scenes.length; i++) {
                const scene = scenes[i];

                // ── ANIMATION-ON-DEMAND: skip Nano Banana ONLY if scene already has a valid image
                // If no image exists, Nano Banana runs so Kling has something to animate.
                if (animationRequestedIndices.includes(i)) {
                    const hasExistingImage = isValidRemoteUrl(scene.imageUrl) || !!uploadedSceneUrls[i];
                    if (hasExistingImage) {
                        console.log(`Scene ${i + 1} (${scene.type}): has image — skip Nano Banana (animation-on-demand)`);
                        continue;
                    }
                    // No image yet — fall through, Nano Banana generates one for Kling
                }

                // ── Partial render: skip scenes that weren't changed ─────────────
                // Only generate a new image if the scene was patched OR has no valid image yet.
                if (isPartialRender && !changedSceneIndices.includes(i) && isValidRemoteUrl(scene.imageUrl)) {
                    console.log(`⏭️ Scene ${i + 1} (${scene.type}): unchanged — keeping existing image`);
                    continue;
                }

                // Full render: skip only if scene already has a valid remote URL.
                // Stale local paths (tmp/assets_mg_...) are NOT valid — they get cleared
                // when the assets dir is wiped at render start and must be regenerated.
                if (isValidRemoteUrl(scene.imageUrl)) continue;

                const mustGenerate      = ALWAYS_IMAGE_TYPES.has(scene.type);
                const optionalGenerate  = OPTIONAL_IMAGE_TYPES.has(scene.type) && (i % 2 === 0);
                const unknownTypeEvery3 = !ALWAYS_IMAGE_TYPES.has(scene.type) && !OPTIONAL_IMAGE_TYPES.has(scene.type) && (i % 3 === 0);

                if (mustGenerate || optionalGenerate || unknownTypeEvery3) {
                    const styleHint = sceneStyleHints[scene.type] || 'professional motion graphic background, dark cinematic lighting';
                    const subject   = scene.headline || scene.content || scene.subtext
                        || (scene.items?.map((it: any) => it.label).join(', '))
                        || scene.type.replace(/_/g, ' ');
                    const prompt = scene.imagePrompt?.trim()
                        || `Ultra high quality ${styleHint}. Visually representing "${subject}". Dark moody atmosphere, vibrant accent lighting, 4K detail. NO text, NO words, NO letters, NO labels — ONLY visual elements.`;
                    imagePrompts.push(prompt);
                    sceneIndices.push(i);
                    console.log(`📷 Scene ${i + 1} (${scene.type}): ${mustGenerate ? 'ALWAYS' : 'OPTIONAL'} → queued`);
                } else {
                    console.log(`⏭️ Scene ${i + 1} (${scene.type}): skipping (self-contained)`);
                }
            }


            if (imagePrompts.length === 0) {
                console.log(`⏭️ No image-requiring scenes, skipping image generation`);
                return { imageUrls: [], sceneIndices: [], uploadedSceneUrls };
            }

            // Generate ALL images in parallel with round-robin key rotation (same as short video generator)
            console.log(`🚀 Submitting ${imagePrompts.length} scenes for PARALLEL Nano Banana generation...`);

            // project.dimension can be "portrait" | "square" | "landscape" — default to portrait (9:16)
            const dimension = (project as any)?.dimension || "portrait";
            const isPortrait = dimension === "portrait";
            const isSquare   = dimension === "square";
            const imgWidth  = isPortrait ? 768 : (isSquare ? 1024 : 1344);
            const imgHeight = isPortrait ? 1344 : (isSquare ? 1024 : 768);

            const parallelConfigs = imagePrompts.map((prompt, idx) => ({
                index: sceneIndices[idx],
                prompt: `${prompt}. Professional motion graphic style, clean background, high contrast, vibrant colors`,
                width: imgWidth,
                height: imgHeight,
            }));

            const imageUrls: string[] = new Array(imagePrompts.length).fill('');

            try {
                const parallelResults = await generateNanoBananaImagesParallel(
                    parallelConfigs,
                    undefined, // no cancel signal
                    4,         // concurrency: up to 4 scenes at once
                );

                for (const result of parallelResults) {
                    // Find which index in our local array this maps to
                    const localIdx = sceneIndices.indexOf(result.index);
                    if (localIdx !== -1 && result.success && result.imageUrl) {
                        imageUrls[localIdx] = result.imageUrl;
                        console.log(`✅ Scene ${result.index + 1} image ready: ${result.imageUrl.substring(0, 60)}...`);
                    } else {
                        console.warn(`⚠️ Scene ${result.index + 1} image failed: ${result.error || 'unknown'}`);
                    }
                }
            } catch (err: any) {
                console.warn(`⚠️ Parallel image generation error: ${err.message}`);
            }

            console.log(`✅ Generated ${imageUrls.filter(u => u).length}/${imagePrompts.length} images (parallel)`);
            return { imageUrls, sceneIndices, uploadedSceneUrls };
        });
        // Step 2b: Kling video generation for key scenes (convert static images → animated clips)
        await step.run("update-status-kling", () => updateMotionGraphicStatus(projectId, "generating:video-clips"));

        const klingData = await step.run("generate-kling-videos", async () => {
            const scenes = (project.sceneData as any[]) || [];
            // Determine which scenes should get Kling video treatment
            // Prioritize: video_hero, image_showcase, split_hero, logo_reveal (if has image)
            const klingCandidates: { index: number; imageUrl: string; narration: string }[] = [];
            
            for (let i = 0; i < scenes.length; i++) {
                const scene = scenes[i];

                const imgIdx       = imageData.sceneIndices.indexOf(i);
                const generatedUrl = imgIdx >= 0 ? imageData.imageUrls[imgIdx] : null;
                const uploadedUrl  = imageData.uploadedSceneUrls?.[i] || null;
                const finalUrl     = uploadedUrl || generatedUrl || scene.imageUrl || '';

                // ── ANIMATION-ON-DEMAND: user explicitly requested Kling for this scene ────
                // Bypasses ALL exclusion guards (scene type, upload guard, partial render skip).
                // Source priority: uploadedBlob > generatedImage > existingSceneUrl
                // Nano Banana is NEVER called for this path (hard-guarded in image gen step).
                if (animationRequestedIndices.includes(i)) {
                    // uploadedUrl = pre-flight injected blob URL = user's real uploaded asset
                    const uploadedBlobUrl = imageData.uploadedSceneUrls?.[i] || null;
                    const animUrl = uploadedBlobUrl || generatedUrl || scene.imageUrl || '';

                    if (!animUrl || !animUrl.startsWith('http')) {
                        console.warn(`⚠️ Scene ${i + 1}: animation requested but no image found — upload a logo/image first`);
                        continue;
                    }
                    if (animUrl.endsWith('.mp4') || animUrl.endsWith('.webm') || animUrl.includes('video-files')) {
                        console.log(`⏭️ Scene ${i + 1}: already a video — skipping Kling`);
                        continue;
                    }

                    const urlSource = uploadedBlobUrl ? '📎 UPLOADED BLOB (user asset)' : generatedUrl ? '🖼 generated image' : '🔗 existing scene.imageUrl';
                    console.log(`🎬 [animation-on-demand] Scene ${i + 1} (${scene.type}) | source: ${urlSource} | → Kling`);
                    console.log(`   URL: ${animUrl.slice(0, 100)}`);

                    klingCandidates.push({
                        index: i,
                        imageUrl: animUrl,
                        narration: scene.voiceoverLine || scene.headline || '',
                        animationOnDemand: true,
                        animationType: scene.animationType || 'cinematic_pan',
                    } as any);
                    continue;
                }

                // \u2500\u2500 Partial render: skip Kling for unchanged scenes \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
                if (isPartialRender && !changedSceneIndices.includes(i)) {
                    console.log(`\u23ed\ufe0f Scene ${i + 1}: unchanged \u2014 skipping Kling`);
                    continue;
                }

                // \u2500\u2500 Standard Kling eligibility \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
                const finalImageUrl = uploadedUrl || generatedUrl || scene.imageUrl || '';

                // CUMULATIVE: skip if already a Kling video (previous render animated this)
                if (finalImageUrl.endsWith('.mp4') || finalImageUrl.endsWith('.webm') || finalImageUrl.includes('video-files')) {
                    console.log(`\u23ed\ufe0f Scene ${i + 1}: already a Kling video \u2014 preserving`);
                    continue;
                }

                // AUTO-ANIMATE: logo_reveal with uploaded blob gets Kling on EVERY fresh project.
                // The user's real logo is animated with a premium GPT-120b prompt.
                if (uploadedUrl && scene.type === 'logo_reveal') {
                    console.log(`\ud83c\udfac [auto-animate] Scene ${i + 1} (logo_reveal): uploaded logo \u2192 Kling`);
                    klingCandidates.push({
                        index: i,
                        imageUrl: uploadedUrl,
                        narration: scene.voiceoverLine || scene.headline || '',
                        animationOnDemand: true,
                        animationType: 'logo_kinetic_reveal',
                    } as any);
                    continue;
                }

                // All other uploaded assets stay static (screenshots, product photos)
                if (uploadedUrl) {
                    console.log(`\u23ed\ufe0f Scene ${i + 1} (${scene.type}): uploaded asset \u2014 keeping static`);
                    continue;
                }

                // Standard: AI-generated images on eligible scene types
                const klingEligible = ['video_hero', 'image_showcase', 'split_hero', 'browser_mockup', 'phone_mockup'];
                if (finalImageUrl && finalImageUrl.startsWith('http') && klingEligible.includes(scene.type)) {
                    klingCandidates.push({
                        index: i,
                        imageUrl: finalImageUrl,
                        narration: scene.voiceoverLine || scene.headline || scene.subtext || '',
                    });
                }
            }

            // Animation-on-demand candidates are processed FIRST and don't count toward the cap
            const animationCandidates = klingCandidates.filter((c: any) => c.animationOnDemand);
            const standardCandidates  = klingCandidates.filter((c: any) => !c.animationOnDemand).slice(0, 2);
            const toProcess = [...animationCandidates, ...standardCandidates];

            if (toProcess.length === 0) {
                console.log(`⏭️ No Kling-eligible scenes, skipping video generation`);
                return { videoUrls: {} as Record<number, string> };
            }

            console.log(`🎬 Generating ${toProcess.length} Kling video clips for scenes: ${toProcess.map((c: any) => c.index + 1).join(', ')}`);
            const videoUrls: Record<number, string> = {};

            // Get an API key for Mistral prompt generation
            const mgKeys = (process.env.NVIDIA_API_KEY || '').split(',').map((k: string) => k.trim()).filter(Boolean);
            const promptApiKey = mgKeys[0] || '';

            // Process Kling generations sequentially (they're long-running)
            for (const candidate of toProcess) {
                try {
                    const { processImgToVideo } = await import('@/app/api/studio/img-to-video/route');
                    console.log(`🎥 Kling: Scene ${(candidate as any).index + 1} → ${(candidate as any).imageUrl.substring(0, 60)}...`);

                    // For animation-on-demand: generate a premium GPT-120b Kling prompt first
                    let klingPrompt: string | undefined;
                    if ((candidate as any).animationOnDemand && promptApiKey) {
                        const { motionGraphicsLLM } = await import('@/lib/motion-graphics-llm');
                        const scene = scenes[(candidate as any).index];
                        klingPrompt = await motionGraphicsLLM.generateKlingPrompt(
                            {
                                type: scene.type,
                                headline:     scene.headline,
                                subtext:      scene.subtext,
                                voiceoverLine: scene.voiceoverLine,
                                animationType: (candidate as any).animationType,
                            },
                            promptApiKey,
                        );
                        console.log(`✨ GPT-120b Kling prompt: "${klingPrompt.slice(0, 80)}..."`);
                    }

                    const data = await processImgToVideo({
                        imageUrl: (candidate as any).imageUrl,
                        sceneNarration: klingPrompt || (candidate as any).narration, // premium prompt overrides narration
                        sceneIndex: (candidate as any).index,
                        duration: 5,
                        forceShorts: false,
                    });

                    if (data.ok && data.videoUrl) {
                        videoUrls[(candidate as any).index] = data.videoUrl;
                        console.log(`✅ Kling scene ${(candidate as any).index + 1} complete: ${data.videoUrl.substring(0, 80)}...`);
                    } else {
                        console.warn(`⚠️ Kling scene ${(candidate as any).index + 1} returned no video: ${JSON.stringify(data).substring(0, 100)}`);
                    }
                } catch (err: any) {
                    console.warn(`⚠️ Kling scene ${(candidate as any).index + 1} failed: ${err.message?.substring(0, 100)}`);
                }
            }

            console.log(`✅ Kling generation complete: ${Object.keys(videoUrls).length}/${toProcess.length} videos`);
            return { videoUrls };
        });
        let voiceData: { audioUrl: string; audioDuration: number } | null = null;

        if (project.voiceoverEnabled) {
            await step.run("update-status-voice", () => updateMotionGraphicStatus(projectId, "generating:voice"));

            voiceData = await step.run("generate-voiceover", async () => {
                const scenes = (project.sceneData as any[]) || [];
                let scriptText = project.voiceoverScript as string || '';

                // ── Synchronization Fix ──────────────────────────────────────────────
                // If scenes have individual voiceoverLine fields, prioritize those.
                // This ensures the spoken content is correctly timed to the scenes.
                const hasSceneVoiceover = scenes.some((s: any) => s.voiceoverLine?.trim());
                if (hasSceneVoiceover) {
                    console.log(`🎙️ Reconstructing script from ${scenes.length} individual scene voiceoverLines...`);

                    // Safety: fill any empty voiceoverLines with fallback text to prevent silence
                    const filledLines = scenes.map((s: any, i: number) => {
                        const vo = s.voiceoverLine?.trim();
                        if (vo) return vo;
                        // Fallback: use headline, subtext, or scene type as spoken content
                        const fallback = s.headline || s.subtext || s.content || s.type?.replace(/_/g, ' ') || '';
                        if (fallback) {
                            console.log(`  ⚠️ Scene ${i + 1} (${s.type}): empty voiceoverLine, using fallback: "${fallback.substring(0, 50)}..."`);
                        }
                        return fallback;
                    });

                    scriptText = filledLines.filter(Boolean).join('. ');
                    const wordCount = scriptText.split(/\s+/).length;
                    console.log(`📝 Total voiceover: ${wordCount} words (~${Math.round(wordCount / 2.5)}s of speech)`);
                }

                if (!scriptText || scriptText.trim().length === 0) {
                    console.log(`⏭️ No voiceover content available, skipping`);
                    return null;
                }

                const cleaned = sanitizeForTTS(scriptText);
                const chunks = chunkText(cleaned, 2200);
                const audioBuffers: Buffer[] = [];

                const selectedVoice = (project.voice as string) || 'rahul';
                const selectedLanguage = (project.language as string) || 'en-IN';

                console.log(`🎙️ Generating voiceover: ${cleaned.length} chars, voice: ${selectedVoice}`);

                for (let i = 0; i < chunks.length; i++) {
                    const buf = await callSarvamTTS(
                        chunks[i],
                        selectedVoice,
                        selectedLanguage,
                        1.0,  // Natural pace for voiceover
                        0.7   // Slightly warm temperature
                    );
                    audioBuffers.push(buf);

                    if (i < chunks.length - 1) {
                        await new Promise(r => setTimeout(r, 1000));
                    }
                }

                const finalAudio = mergeWavBuffers(audioBuffers);
                const sampleRate = finalAudio.readUInt32LE(24);
                const dataSize = finalAudio.length - 44;
                const bytesPerSample = finalAudio.readUInt16LE(34) / 8;
                const channels = finalAudio.readUInt16LE(22);
                const audioDuration = dataSize / (sampleRate * bytesPerSample * channels);

                const blobResult = await putWithRotation(
                    `motion-graphics/${projectId}/voiceover_${Date.now()}.wav`,
                    finalAudio,
                    { access: "public", contentType: "audio/wav" }
                );

                console.log(`✅ Voiceover uploaded: ${blobResult.url} (${audioDuration.toFixed(1)}s)`);
                return {
                    audioUrl: blobResult.url,
                    audioDuration: Math.round(audioDuration * 10) / 10,
                };
            });
        }

        // Step 4: Build Remotion composition props
        await step.run("update-status-video", () => updateMotionGraphicStatus(projectId, "generating:video"));

        const remotionProps = await step.run("build-composition-props", async () => {
            const scenes = (project.sceneData as any[]) || [];
            const theme = (project.theme as any) || {
                palette: 'midnight',
                font: 'Inter',
                animationStyle: 'smooth',
            };

            // Map images and Kling videos back to scenes
            // Priority: Kling video > generated image > original imageUrl
            
            // Sanitize imageUrl: the LLM sometimes outputs hallucinated values like
            // "[UPLOADED IMAGE: ... — URL: https://example.com/... — DESCRIPTION: ...]"
            // instead of real URLs. Detect and fix these before they crash Remotion.
            const sanitizeImageUrl = (url: string | undefined): string => {
                if (!url) return '';
                // If it contains [UPLOADED or example.com, it's hallucinated
                if (url.includes('[UPLOADED') || url.includes('example.com') || url.includes('uploaded-logo-url')) {
                    // Try to extract a real URL from inside the hallucinated text
                    const urlMatch = url.match(/https?:\/\/(?!example\.com)[^\s\]"]+/);
                    if (urlMatch) {
                        console.log(`🔧 Extracted real URL from hallucinated imageUrl: ${urlMatch[0].substring(0, 60)}...`);
                        return urlMatch[0];
                    }
                    console.warn(`⚠️ Cleared hallucinated imageUrl: "${url.substring(0, 80)}..."`);
                    return '';
                }
                // Must be a valid URL (http/https) or a valid local path
                if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('/')) {
                    console.warn(`⚠️ Cleared invalid imageUrl (not a URL): "${url.substring(0, 60)}..."`);
                    return '';
                }
                return url;
            };

            // In partial render mode, start from existing remotionProps.scenes as the base.
            // Unchanged scenes carry forward their imageUrl from the previous render.
            // IMPORTANT: Only carry forward scenes whose imageUrl is a valid remote HTTP URL.
            // Stale local paths (tmp/assets_mg_...) from old renders are invalid after asset
            // dir cleanup and must be dropped so the scene is re-generated from scratch.
            const existingRemotionScenes: any[] = isPartialRender
                ? ((project.remotionProps as any)?.scenes || [])
                : [];

            let enrichedScenes = scenes.map((scene: any, i: number) => {
                // Partial render: unchanged scene → carry forward existing remotionProps slot
                // but ONLY if its imageUrl is a valid remote URL (not a stale local temp path).
                const existingScene = existingRemotionScenes[i];
                const existingUrlIsValid = existingScene?.imageUrl?.startsWith('http://') || existingScene?.imageUrl?.startsWith('https://');
                if (isPartialRender && !changedSceneIndices.includes(i) && existingScene && (!existingScene.imageUrl || existingUrlIsValid)) {
                    return existingRemotionScenes[i];
                }

                const imgIdx        = imageData.sceneIndices.indexOf(i);
                const generatedImageUrl  = imgIdx >= 0 ? imageData.imageUrls[imgIdx] : null;
                const uploadedImageUrl   = imageData.uploadedSceneUrls?.[i] || null;  // ← user blob, highest priority
                const klingVideoUrl      = klingData.videoUrls[i] || null;
                // Priority: Kling video > uploaded blob > AI-generated > LLM-set URL
                // Kling wins because it IS the uploaded asset, just animated.
                // If Kling didn't run for this scene, uploaded blob is shown as-is.
                // IMPORTANT: Only accept scene.imageUrl as a fallback if it's a real remote HTTP URL.
                // Stale local paths (tmp/assets_mg_...) from old DB state are invalid and must be ignored.
                const sceneImageFallback = (scene.imageUrl?.startsWith('http://') || scene.imageUrl?.startsWith('https://'))
                    ? scene.imageUrl : '';
                const rawUrl = klingVideoUrl || uploadedImageUrl || generatedImageUrl || sceneImageFallback || '';
                const cleanUrl = sanitizeImageUrl(rawUrl);
                if (rawUrl && !cleanUrl) {
                    console.log(`🧹 Scene ${i + 1} (${scene.type}): imageUrl sanitized from hallucinated value`);
                }
                return {
                    ...scene,
                    imageUrl: cleanUrl,
                };
            });

            // Calculate total frames — lock video duration to audio duration for zero silence.
            // When voiceover is enabled: video duration = audio duration (scenes scale proportionally).
            // When voiceover is disabled: video duration = sum of scene durationSec values.
            const fps = 30;
            const sceneDurationSec = enrichedScenes.reduce((sum: number, s: any) => sum + (Number(s.durationSec) || 5), 0);
            const audioDurationSec = voiceData?.audioDuration || 0;

            let totalDurationSec: number;
            if (voiceData && audioDurationSec > 0) {
                // Audio-locked: video ends exactly when the voiceover ends
                totalDurationSec = Math.ceil(audioDurationSec);
                console.log(`🔒 Audio-locked duration: scenes=${sceneDurationSec}s, audio=${audioDurationSec}s → video=${totalDurationSec}s`);

                // ── Voice Sync: redistribute per-scene durations by word count ──────────
                // Each scene gets screen time proportional to how many words its voiceover
                // line contains. This prevents the voice saying scene 3's text while the
                // viewer is already watching scene 5.
                const wordCounts = enrichedScenes.map((s: any) => {
                    const text = (s.voiceoverLine || s.headline || s.subtext || s.content || '').trim();
                    return Math.max(3, text.split(/\s+/).filter(Boolean).length);
                });
                const totalWords = wordCounts.reduce((a: number, b: number) => a + b, 0);

                enrichedScenes = enrichedScenes.map((s: any, i: number) => {
                    const proportion  = wordCounts[i] / totalWords;
                    const rawDuration = audioDurationSec * proportion;
                    // Minimum 2s per scene; round to 1 decimal
                    const newDuration = Math.max(2, Math.round(rawDuration * 10) / 10);
                    return { ...s, durationSec: newDuration };
                });

                const newTotal = enrichedScenes.reduce((s: number, x: any) => s + x.durationSec, 0);
                console.log(`🎙️ Voice sync: redistributed ${enrichedScenes.length} scene durations (total=${newTotal.toFixed(1)}s, audio=${audioDurationSec}s)`);
            } else {
                // No voiceover: use scene durations
                totalDurationSec = sceneDurationSec || (project.duration as number) || 30;
                console.log(`📐 Scene-based duration: ${totalDurationSec}s`);
            }


            const totalFrames = totalDurationSec * fps;
            console.log(`⏱️ Final: ${totalDurationSec}s = ${totalFrames} frames`);

            // Determine aspect ratio dimensions
            let width = 1920, height = 1080;
            if (project.aspectRatio === '9:16') {
                width = 1080; height = 1920;
            } else if (project.aspectRatio === '1:1') {
                width = 1080; height = 1080;
            }

            const musicUrl = getMusicUrl((project.music as string) || 'cinematic');

            const props = {
                scenes: enrichedScenes,
                theme,
                durationInFrames: totalFrames,
                fps,
                width,
                height,
                musicUrl,
                audioUrl: voiceData?.audioUrl || '',
                audioDuration: voiceData?.audioDuration || 0,
                voiceoverEnabled: !!project.voiceoverEnabled,
            };

            console.log(`✅ Built Remotion props: ${enrichedScenes.length} scenes, ${totalFrames} frames, ${width}x${height}`);
            return props;
        });

        // Step 5: Save generated props and trigger GitHub Actions / Local render
        const saveAndRenderResult = await step.run("save-props-and-trigger-render", async () => {
            // Save props first so GitHub Actions can fetch them immediately via /props endpoint
            await db.update(motionGraphicProjects)
                .set({
                    sceneData:       remotionProps.scenes, // Preserve the generated remote image/video URLs permanently
                    remotionProps,
                    audioUrl: voiceData?.audioUrl || null,
                    audioDuration: voiceData?.audioDuration || null,
                    updatedAt: new Date(),
                })
                .where(eq(motionGraphicProjects.projectId, projectId));

            // Trigger the render (GitHub Actions cloud dispatch, or local background render fallback)
            const { triggerMotionGraphicRender } = await import("@/lib/video-render");
            const renderResult = await triggerMotionGraphicRender(projectId, remotionProps);
            console.log(`🎬 Motion graphic render triggered: mode=${renderResult.mode}`);
            return renderResult;
        });

        return {
            success: true,
            projectId,
            scenesCount: (project.sceneData as any[])?.length || 0,
            hasVoiceover: !!voiceData,
            renderResult: saveAndRenderResult,
        };
    }
);

// ─────────────────────────────────────────────────────────────────────────────
// 🔁 RENDER-ONLY: re-run just the Remotion render step using saved props
// Triggered by: motion-graphics/render.only
// Skips image generation, Kling, voiceover — uses remotionProps stored in DB.
// ─────────────────────────────────────────────────────────────────────────────
export const renderMotionGraphicOnly = inngest.createFunction(
    {
        id:          "render-motion-graphic-only",
        name:        "Render Motion Graphic (Render Step Only)",
        triggers:    [{ event: "motion-graphics/render.only" }],
        retries:     2,
        concurrency: { limit: 1 },
        onFailure:   async ({ event, error }) => {
            const { projectId } = event.data.event.data as { projectId: string; userId: string };
            console.error(`❌ Render-only failed for ${projectId}:`, error.message);
            await updateMotionGraphicStatus(projectId, "failed");
        },
    },
    async ({ event, step }) => {
        const { projectId, userId } = event.data as { projectId: string; userId: string };

        const { motionGraphicProjects, motionGraphicMessages } = require("@/config/schema");

        // ── 1. Fetch project + saved remotionProps ─────────────────────────
        const [project] = await db
            .select()
            .from(motionGraphicProjects)
            .where(eq(motionGraphicProjects.projectId, projectId));

        if (!project) throw new Error(`Project not found: ${projectId}`);

        const savedProps = project.remotionProps as any;
        if (!savedProps?.scenes?.length) {
            throw new Error("No saved remotionProps found. Run the full pipeline first.");
        }

        await updateMotionGraphicStatus(projectId, "generating:video");
        console.log(`🔁 Render-only for ${projectId}: ${savedProps.scenes.length} scenes`);

        // ── 2. Trigger render (GitHub Actions cloud dispatch or local background render fallback) ──
        const triggerResult = await step.run("trigger-render-only", async () => {
            const { triggerMotionGraphicRender } = await import("@/lib/video-render");
            return await triggerMotionGraphicRender(projectId, savedProps);
        });

        return { success: true, projectId, triggerResult };
    }
);
