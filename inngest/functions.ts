import { aiFallback } from "@/config/ai-fallback";
import { db } from "@/config/db";
import { shortVideoAssets, shortVideoSeries } from "@/config/schema";
import { putWithRotation } from "@/lib/blob";
import { generateNanoBananaImage, generateNanoBananaImagesParallel } from "@/lib/leonardo";
import { generateKlingScenesParallel } from "@/lib/leonardo-video";
import { getMusicUrl } from "@/lib/music-urls";
import { translateScript } from "@/lib/translate";
import { triggerRender } from "@/lib/video-render";
import { and, eq, or } from "drizzle-orm";
import { inngest } from "./client";

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
            let ffmpegBin = require('ffmpeg-static') as string;
            // Webpack/Next.js can bundle this to a non-existent \ROOT\... virtual path
            if (!fs.existsSync(ffmpegBin)) {
                ffmpegBin = path.join(process.cwd(), 'node_modules', 'ffmpeg-static', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
            }

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

async function callSarvamTTS(
    text: string,
    speaker: string,
    language: string,
    pace: number = 1.05,
    temperature: number = 0.6,
    retries = 3
): Promise<Buffer> {
    let lastErr: Error | null = null;
    let delay = 2000;

    for (let i = 0; i <= retries; i++) {
        try {
            if (i > 0) {
                console.log(`🔄 TTS retry ${i}/${retries}, waiting ${delay}ms...`);
                await new Promise(r => setTimeout(r, delay));
                delay = Math.min(delay * 2, 10000);
            }

            const res = await fetch('https://api.sarvam.ai/text-to-speech', {
                method: 'POST',
                headers: {
                    'api-subscription-key': process.env.SARVAM_API_KEY!,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    text,
                    target_language_code: language,
                    speaker,
                    pace: pace,
                    speech_sample_rate: 22050,
                    enable_preprocessing: true,
                    model: "bulbul:v3",
                    temperature: temperature,
                    output_audio_codec: "wav",
                }),
                signal: AbortSignal.timeout(30000),
            });

            if (!res.ok) {
                throw new Error(`Sarvam TTS ${res.status}: ${await res.text()}`);
            }

            const data = await res.json();
            if (!data.audios?.[0]) throw new Error('No audio in Sarvam response');

            return Buffer.from(data.audios[0], 'base64');
        } catch (e: any) {
            lastErr = e;
            const retryable = /502|503|504|timeout|ECONNRESET/i.test(e.message);
            if (!retryable || i === retries) throw e;
            console.warn(`⚠️ TTS attempt ${i + 1} failed: ${e.message}`);
        }
    }
    throw lastErr!;
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
    { id: "hello-world" },
    { event: "test/hello.world" },
    async ({ event, step }) => {
        await step.sleep("wait-a-moment", "1s");
        return { message: `Hello ${event.data.email}!` };
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
    { event: "shorts/generate.video" },
    async ({ event, step }) => {
        const { seriesId, customTopic, studioPayload } = event.data;
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

        // Determine voice, language & caption style: use studioPayload if provided, otherwise series defaults
        const selectedVoice = studioPayload?.voice ?? seriesData.voice;
        const selectedLanguage = studioPayload?.language ?? seriesData.language;
        const selectedCaptionStyle = studioPayload?.captionStyle ?? seriesData.captionStyle;
        console.log(`🎤 Selected voice: ${selectedVoice}, language: ${selectedLanguage}, caption style: ${selectedCaptionStyle} (studioPayload: ${studioPayload?.voice ? 'yes' : 'no'})`);

        // Update status: generating script
        await step.run("update-status-script", () => updateSeriesStatus(seriesId, "generating:script"));

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
            const randomTopicTwist = customTopic
                ? `SPECIFIC TOPIC (USER REQUEST): The user wants this video to be specifically about: "${customTopic}". Focus entirely on this topic. Make it engaging, viral, and packed with fascinating details. Seed: ${seed}`
                : `UNIQUE ANGLE: Frame this video as ${angle}. Seed: ${seed}`;
            // ─────────────────────────────────────────────────────────

            const systemPrompt = `You are a world-class viral storyteller. Write a ${durationLabel} script.

🚨 SUPER CRITICAL RULES:
1. Output ONLY a valid JSON object.
2. Your JSON MUST be wrapped exactly in <json> and </json> tags.
3. NEVER output markdown code blocks (like \`\`\`json).
4. Write ONLY in ENGLISH. Use clear, concise English that translates well to other languages.

🧠 SCENE PLANNING (DO THIS MENTALLY BEFORE WRITING):
Before writing ANY narration, plan 6 DISTINCT subtopics that directly relate to the video title. Each MUST cover a DIFFERENT aspect:
- scene1: A specific shocking event, fact, or question (the hook)
- scene2: Origin story, founding, or historical background with specific dates and names
- scene3: A specific conflict, battle, war, controversy, or dramatic turning point
- scene4: A specific person, innovation, discovery, or lesser-known fact with real details
- scene5: Modern impact, recent events, or current relevance with specific data
- scene6: Powerful emotional conclusion tying all scenes together
NEVER waste a scene on generic tourism, food, or culture UNLESS the title specifically asks about those topics.

🔴 TOPIC ADHERENCE (CRITICAL):
- Every scene MUST directly relate to the video TITLE. If the title says "turbulent history", do NOT write about food or tourism.
- Ask yourself: "Does this scene deliver on the PROMISE of the title?" If not, REWRITE it.

SCRIPT REQUIREMENTS:
1. TOTAL LENGTH: 310-350 words of narration. Each scene MUST have 50-60 words.
2. STRUCTURE: You MUST use explicit keys ("scene1", "scene2"..."scene6") instead of an array.
3. LANGUAGE & NATIVE FLOW: Write ENTIRELY in ENGLISH. Natural, native-sounding phrasing.
4. NARRATION STYLE: No meta-commentary, no "Scene 1", no "Welcome". Start directly with the hook. Each scene MUST have 50-60 words (4-5 rich sentences) packed with SPECIFIC facts, real dates, real names, real numbers.
   SCENE STRUCTURE (MANDATORY):
   - scene1 (HOOK): Jaw-dropping fact, bold claim, or provocative question. NO greetings.
   - scene2-scene5 (BODY): Escalating intensity. Each scene = COMPLETELY DIFFERENT subtopic. Never repeat or rephrase.
   - scene6 (CONCLUSION): Powerful, emotionally resonant. Ties key points from scenes 1-5. Memorable closing line. 50-60 words.
5. IMAGE PROMPTS: For 'real_entity' scenes — 30-50 word ultra-detailed photorealistic prompts (lighting, angle, texture, atmosphere, lens, DSLR style).
6. VIDEO PROMPTS: For EVERY scene — 30-50 word cinematic description (camera movements, effects). NO text/titles/words/labels in video.
7. THUMBNAIL PROMPT: 30-40 words, stunning, click-worthy. NO TEXT, NO WORDS, NO LETTERS.
8. SCENE CATEGORIZATION:
   - "real_entity": real person, monument, artifact, historical site, landmark
   - "living_thing": fictional/generic people, animals
   - "general": abstract concepts, graphics, visual effects
9. TTS FORMATTING: No ellipses, em-dashes, en-dashes, colons, semicolons, ALL CAPS, parenthetical asides, or elongated words. Clean short sentences only.

JSON SCHEMA:
Do NOT use a "scenes" array. Use exact keys (scene1, scene2, etc.). Return exactly this wrapped in <json> tags:

<json>
{
  "videoTitle": "compelling viral title",
  "thumbnailPrompt": "A stunning, click-worthy visual prompt...",
  "totalScenes": ${sceneCount},
  "totalWordCount": 250,
  "scene1": {
    "narration": "Gripping hook with a specific shocking fact...",
    "imagePrompt": "Ultra-detailed photorealistic description...",
    "videoPrompt": "Cinematic camera movement description — NO TEXT...",
    "sceneCategory": "real_entity",
    "duration": 15,
    "wordCount": 45
  },
  "scene2": { "narration": "DIFFERENT subtopic from scene1...", ... },
  "scene3": { ... },
  "scene4": { ... },
  "scene5": { ... },
  "scene6": { ... }
}
</json>

🔴 ANTI-REPETITION (ABSOLUTELY CRITICAL):
- NEVER repeat the same idea, phrase, or sentence across scenes.
- BANNED phrases (NEVER use): "this place is known for its rich history", "attracts tourists from around the world", "a unique and fascinating destination", "a memorable experience", "rich history and culture", "rich history, culture and traditional cuisine"
- Each scene MUST contain at least 3 SPECIFIC facts (dates, names, numbers) not in any other scene.
- Generic summarizing like "this place is beautiful and attracts tourists" is STRICTLY FORBIDDEN.

🚨 CRITICAL: Finish all ${sceneCount} scenes. Output ONLY <json>{...}</json>.`;

            const userPrompt = `Topic: "${seriesData.title}"
Language: ENGLISH
${randomTopicTwist}

IMPORTANT: Before writing, plan 6 DISTINCT subtopics for the 6 scenes. Each subtopic must cover a DIFFERENT angle directly related to the title. Do NOT repeat information across scenes. Every sentence must contain a SPECIFIC fact, date, name, or number.

You MUST provide 310-350 total words across all 6 scenes. Each scene MUST have 50-60 words. Concise but information-dense.
You MUST use explicit keys (scene1, scene2, etc.). Do NOT use an array for scenes.
Do NOT use "content framing" (like "Let's explore", "Scene 1"). Write pure narration only.

OUTPUT: JSON object wrapped in <json> and </json> tags.`;

            // ── Generate with validation + retry ─────────────────────
            const MAX_ATTEMPTS = 3;
            let bestResult: any = null;
            let bestWordCount = 0;

            for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
                console.log(`🔄 Script generation attempt ${attempt}/${MAX_ATTEMPTS} (Groq llama-3.3-70b-versatile)...`);

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
                    const result = await aiFallback.json(systemPrompt, userPrompt, {
                        temperature: attempt === 1 ? 0.7 : (attempt === 2 ? 0.8 : 0.85),
                        maxOutputTokens: 8192,
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

            console.log(`✅ Script finalized (Groq llama-3.3-70b-versatile): "${bestResult.videoTitle}" | ${bestResult.scenes?.length} scenes | ${bestWordCount} words ≈ ${Math.round(bestWordCount / WORDS_PER_SEC)}s`);

            // ── Translate to target language if not English ─────────────────
            if (selectedLanguage && !selectedLanguage.startsWith('en') && bestResult.scenes?.length > 0) {
                console.log(`🌐 Translating script to ${selectedLanguage}...`);
                const narrations = bestResult.scenes.map((s: any) => s.narration || '');
                const translated = await translateScript({
                    videoTitle: bestResult.videoTitle,
                    narrations,
                    targetLanguage: selectedLanguage,
                });
                bestResult.videoTitle = translated.videoTitle;
                bestResult.scenes = bestResult.scenes.map((s: any, i: number) => ({
                    ...s,
                    narration: translated.narrations[i] || s.narration,
                    wordCount: (translated.narrations[i] || s.narration).split(/\s+/).length,
                    duration: Math.round((translated.narrations[i] || s.narration).split(/\s+/).length / WORDS_PER_SEC),
                }));
                bestResult.totalWordCount = bestResult.scenes.reduce(
                    (sum: number, s: any) => sum + (s.wordCount || 0), 0
                );
                console.log(`✅ Translation complete — ${bestResult.totalWordCount} words in ${selectedLanguage}`);
            }

            return bestResult;
        });

        // Update status: generating voice
        await step.run("update-status-voice", () => updateSeriesStatus(seriesId, "generating:voice"));

        // Step 3: Generate Voice using TTS (Sarvam)
        const voiceData = await step.run("generate-voice", async () => {
            console.log(`🎙️ Generating voice for: "${seriesData.title}"`);

            // ── Generate audio PER SCENE to respect individual pace/temp settings ──
            const audioBuffers: Buffer[] = [];
            const voiceConfigs = studioPayload?.sceneVoiceConfigs || [];

            for (let i = 0; i < scriptData.scenes.length; i++) {
                const scene = scriptData.scenes[i];
                let sceneNarration = scene.narration || '';
                if (!sceneNarration.trim()) continue;

                // Add a small pause at the end of the scene using punctuation
                if (!/[.!?]$/.test(sceneNarration.trim())) {
                    sceneNarration += '.';
                }

                const cleanedScene = sanitizeForTTS(sceneNarration);
                const scenePace = voiceConfigs[i]?.pace ?? 1.05;
                const sceneTemp = voiceConfigs[i]?.temperature ?? 0.7;

                console.log(`🔊 Scene ${i + 1}/${scriptData.scenes.length}: ${cleanedScene.length} chars (pace: ${scenePace}, temp: ${sceneTemp})`);

                // A single scene is usually < 500 chars, well within Sarvam's limit.
                // But just in case, we chunk the scene itself if it's too long.
                const chunks = chunkText(cleanedScene, 2200);

                for (let j = 0; j < chunks.length; j++) {
                    const buf = await callSarvamTTS(
                        chunks[j],
                        selectedVoice,
                        selectedLanguage,
                        scenePace,
                        sceneTemp
                    );
                    audioBuffers.push(buf);

                    // Rate-limit between chunks
                    if (j < chunks.length - 1) {
                        await new Promise(r => setTimeout(r, 1000));
                    }
                }

                // Rate-limit between scenes
                if (i < scriptData.scenes.length - 1) {
                    await new Promise(r => setTimeout(r, 1000));
                }
            }

            // Merge chunks into single WAV
            const finalAudio = mergeWavBuffers(audioBuffers);
            console.log(`🔗 Merged audio: ${finalAudio.length} bytes`);

            // Estimate duration from WAV data (sample rate 22050, 16-bit mono)
            const sampleRate = finalAudio.readUInt32LE(24);
            const dataSize = finalAudio.length - 44;
            const bytesPerSample = finalAudio.readUInt16LE(34) / 8;
            const channels = finalAudio.readUInt16LE(22);
            const audioDuration = dataSize / (sampleRate * bytesPerSample * channels);
            console.log(`⏱️ Estimated duration: ${audioDuration.toFixed(1)}s`);

            // Upload to Vercel Blob with token rotation (unique path per generation)
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

        // Step 5: Generate Images — Nano Banana (Gemini 2.5 Flash Image)
        const imageData = await step.run("generate-images", async () => {
            console.log(`🖼️ Generating images for: "${seriesData.title}"`);
            console.log(`📸 Scenes to generate: ${scriptData.scenes?.length}`);

            const MAX_RETRIES_PER_SCENE = 3;
            const totalScenes = scriptData.scenes.length;
            const imageUrls: string[] = new Array(totalScenes).fill("");
            // sceneOverrides: pre-computed video payloads that bypass Kling
            // (split-screen JSON strings keyed by scene index)
            const sceneOverrides: Record<number, string> = {};
            // sceneProbedDurations: actual video file durations (seconds) probed from user uploads
            // Used later to set correct playbackRate — prevents "No frame found" crashes
            const sceneProbedDurations: Record<number, number> = {};

            // ── Shared cancellation token — passed INTO the poller so force-stop
            //    aborts mid-poll, not just between scenes. ──────────────────────
            const cancelSignal = { cancelled: false };

            // ── Force-stop check: query DB to see if series was cancelled ──────
            async function isForceStoppedCheck(): Promise<boolean> {
                const [current] = await db.select({ status: shortVideoSeries.status })
                    .from(shortVideoSeries)
                    .where(eq(shortVideoSeries.seriesId, seriesId));
                if (!current || current.status === "completed" || current.status === "cancelled") {
                    cancelSignal.cancelled = true; // ← signal the poller to stop NOW
                    console.log(`🛑 Force stop detected! Series status is "${current?.status}". Aborting all image generation.`);
                    return true;
                }
                return false;
            }

            // ── Generate all scenes ────────────────────────────────────────────
            // Real entity scenes are collected here for parallel batch generation
            const realEntityScenes: Array<{ sceneIndex: number; prompt: string; attemptMode: string }> = [];

            for (let i = 0; i < totalScenes; i++) {
                if (await isForceStoppedCheck()) break;

                const scene = scriptData.scenes[i];

                const prompt = scene.imagePrompt || scene.narration || "Cinematic scene illustration";
                console.log(`🖼️ Scene ${i + 1}/${totalScenes}: "${prompt.substring(0, 80)}..."`);

                let attemptMode = scene.sceneCategory || "general";

                // Map legacy 'monument' to 'real_entity' just in case the LLM messes up
                if (attemptMode === "monument") {
                    attemptMode = "real_entity";
                }

                // ── STUDIO MODE: User provided their own asset(s) ─────────────────
                const sceneAsset = resolveSceneAsset(i);
                if (sceneAsset && (sceneAsset.type === "user_upload" || sceneAsset.type === "doc_image")) {
                    if (sceneAsset.type === "doc_image") {
                        const docUrl = sceneAsset.docImageUrl || sceneAsset.files?.[0]?.url || "";
                        console.log(`📸 Studio Scene ${i + 1}: doc_image → ${docUrl.substring(0, 60)}`);
                        imageUrls[i] = docUrl || "SKIP_T2V";
                        continue;
                    }

                    // ── user_upload: Build COMPOSITE payload preserving ALL assets in user order ──
                    // PRINCIPLE: Never modify user-finalized assets. Only arrange + time them.
                    const allFiles: any[] = sceneAsset.files || [];
                    const splitPairs: [string, string][] = sceneAsset.splitPairs || [];
                    // Legacy split-screen support
                    const realVideos = allFiles.filter((f: any) => f.isVideo && !f.isImgToVideo);
                    const legacySplit = splitPairs.length === 0 && sceneAsset.splitScreenEnabled && realVideos.length >= 2;
                    if (legacySplit) {
                        // Convert legacy boolean into a proper pair
                        splitPairs.push([realVideos[0].fileId, realVideos[1].fileId]);
                    }

                    // Track which fileIds are consumed by split-screen pairs
                    const consumedByPair = new Set<string>();
                    for (const [a, b] of splitPairs) { consumedByPair.add(a); consumedByPair.add(b); }

                    // Build ordered asset entries from user's file order
                    // Split-screen pair is inserted at the position of the FIRST file in the pair;
                    // the second file is consumed (not shown separately).
                    type CompositeAsset =
                        | { kind: "image"; url: string }
                        | { kind: "video"; url: string; durationSec: number; isImgToVideo: boolean }
                        | { kind: "split"; urls: [string, string]; durationSec: number };

                    const compositeAssets: CompositeAsset[] = [];
                    const pairsEmitted = new Set<string>(); // "idA-idB" to avoid double-emit

                    for (const file of allFiles) {
                        const fid = file.fileId;

                        // Check if this file is part of a split-screen pair
                        if (consumedByPair.has(fid)) {
                            // Find which pair(s) include this file
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
                                    durationSec: 0, // will be probed below
                                });
                            }
                            continue;
                        }

                        // Regular file (not in any split pair)
                        if (file.isVideo) {
                            compositeAssets.push({
                                kind: "video",
                                url: file.url,
                                durationSec: 0, // will be probed below
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

                    // ── Special fast paths: single image or single video only ────────
                    if (compositeAssets.length === 1) {
                        const single = compositeAssets[0];
                        if (single.kind === "image") {
                            console.log(`🖼️ Studio Scene ${i + 1}: single image → ${single.url.substring(0, 60)}`);
                            imageUrls[i] = single.url;
                            continue;
                        }
                        if (single.kind === "video") {
                            // Probe ACTUAL video duration — critical to prevent "No frame found" crashes
                            const probedDur = await probeVideoDuration(single.url);
                            sceneProbedDurations[i] = Math.round(probedDur * 10) / 10;
                            console.log(`🎬 Studio Scene ${i + 1}: single video → ${single.url.substring(0, 60)} (probed: ${sceneProbedDurations[i]}s)`);
                            imageUrls[i] = single.url;
                            continue;
                        }
                        if (single.kind === "split") {
                            // Probe both videos in the pair — use the longer one
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

                    // ── Multiple images only → slideshow (backward compat) ───────────
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

                    // ── Mixed assets or multiple videos: probe video durations ───────
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
                            // Probe the longer of the two URLs
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

                    // Build composite payload
                    const compositePayload = JSON.stringify({
                        type: "composite",
                        assets: compositeAssets,
                    });
                    console.log(`📦 Studio Scene ${i + 1}: composite payload ready (${compositeAssets.length} assets)`);
                    imageUrls[i] = "SKIP_T2V";
                    sceneOverrides[i] = compositePayload;
                    continue;
                }

                // Only real_entity scenes get image generation (Nano Banana 2)
                // living_thing and general scenes skip to direct text-to-video via Kling 2.5 Turbo
                if (attemptMode === "living_thing" || attemptMode === "general") {
                    console.log(`🎬 Scene ${i + 1} features '${attemptMode}', skipping image generation for direct Text-to-Video.`);
                    imageUrls[i] = "SKIP_T2V";
                    continue;
                }

                // Collect real_entity scenes for parallel batch generation
                realEntityScenes.push({
                    sceneIndex: i,
                    prompt,
                    attemptMode,
                });
            }

            // ── PARALLEL BATCH: Generate all real_entity images at once ───────
            if (realEntityScenes.length > 0 && !cancelSignal.cancelled) {
                console.log(`🚀 Submitting ${realEntityScenes.length} real_entity scenes for PARALLEL Nano Banana generation...`);

                const parallelConfigs = realEntityScenes.map(s => ({
                    index: s.sceneIndex,
                    prompt: s.prompt,
                    // 768×1344 (9:16) is the default in the parallel function
                }));

                try {
                    const parallelResults = await generateNanoBananaImagesParallel(
                        parallelConfigs,
                        cancelSignal,
                        4, // concurrency: up to 4 scenes submitted simultaneously
                    );

                    // Map results back to imageUrls
                    for (const result of parallelResults) {
                        if (result.success && result.imageUrl) {
                            imageUrls[result.index] = result.imageUrl;
                            console.log(`✅ Scene ${result.index + 1} Nano Banana image: ${result.imageUrl.substring(0, 60)}...`);
                        } else {
                            console.warn(`⚠️ Scene ${result.index + 1} Nano Banana failed: ${result.error || 'unknown'}. Falling back to text-to-video.`);
                            imageUrls[result.index] = "SKIP_T2V";
                        }
                    }
                } catch (err: any) {
                    if (cancelSignal.cancelled || err?.message?.includes('cancelled')) {
                        console.log(`🛑 Parallel image generation cancelled by force stop.`);
                    } else {
                        console.error(`❌ Parallel Nano Banana batch failed: ${err?.message}`);
                    }
                    // Mark all unfinished real_entity scenes as SKIP_T2V
                    for (const s of realEntityScenes) {
                        if (!imageUrls[s.sceneIndex] || imageUrls[s.sceneIndex] === "") {
                            imageUrls[s.sceneIndex] = "SKIP_T2V";
                        }
                    }
                }
            }

            const successCount = imageUrls.filter(u => u.length > 0).length;
            console.log(`✅ Final result: ${successCount}/${totalScenes} images generated`);

            if (successCount < totalScenes) {
                console.warn(`⚠️ ${totalScenes - successCount} scene image(s) could not be generated after all attempts.`);
            }

            return { imageUrls, sceneOverrides, sceneProbedDurations };
        });

        // Step 4.5: Generate high-quality AI Thumbnail using Nano Banana 2 (Leonardo AI)
        const thumbnailData = await step.run("generate-thumbnail", async () => {
            console.log(`🖼️ Generating AI thumbnail via Nano Banana 2 for: "${seriesData.title}"`);
            let prompt = (scriptData as any).thumbnailPrompt || `Cinematic masterpiece poster for a video titled: "${(scriptData as any).videoTitle || seriesData.title}". Epic composition, stunning lighting.`;

            // Strictly enforce no text
            prompt += " -- CRITICAL: NO TEXT, NO WORDS, NO LETTERS, NO NUMBERS. PURE IMAGE ONLY.";

            try {
                const thumbnailUrl = await generateNanoBananaImage(prompt, 1024, 1024);
                console.log(`✅ AI Thumbnail (Nano Banana 2) ready: ${thumbnailUrl.substring(0, 60)}...`);
                return { thumbnailUrl };
            } catch (err: any) {
                console.warn(`⚠️ AI Thumbnail generation failed, will fallback to video frame later: ${err?.message || err}`);
                return { thumbnailUrl: "" };
            }
        });

        // Update status: generating scene videos (image → video)
        await step.run("update-status-videos", () => updateSeriesStatus(seriesId, "generating:videos"));

        // Step 5.25: Convert scenes to video clips using Kling 2.5 Turbo (PARALLEL)
        const sceneVideoData = await step.run("generate-scene-videos", async () => {
            console.log(`🎬 Generating scene video clips via Kling 2.5 Turbo (parallel) for: "${seriesData.title}"`);
            const totalScenes = scriptData.scenes.length;
            const sceneVideoUrls: string[] = new Array(totalScenes).fill("");
            const sceneThumbnailUrls: string[] = new Array(totalScenes).fill("");
            const sceneVideoDurations: number[] = new Array(totalScenes).fill(5);

            // Force-stop check before starting parallel generation
            const [currentStatus] = await db.select({ status: shortVideoSeries.status })
                .from(shortVideoSeries)
                .where(eq(shortVideoSeries.seriesId, seriesId));
            if (!currentStatus || currentStatus.status === "completed" || currentStatus.status === "cancelled") {
                console.log(`🛑 Force stop detected before video generation! Aborting.`);
                return { sceneVideoUrls, sceneThumbnailUrls, sceneVideoDurations };
            }

            // Build scene configs for parallel generation
            const sceneConfigs: Array<{
                index: number;
                prompt: string;
                imageUrl?: string;
                duration: number;
            }> = [];

            for (let i = 0; i < totalScenes; i++) {
                const scene = scriptData.scenes[i];
                const sceneImageUrl = imageData.imageUrls[i];
                // Build ACTION-DRIVEN video prompt (physics/forces, not scene description)
                // Kling already sees the image — describing the scene causes Ken Burns effect
                let videoPrompt = scene.videoPrompt || scene.imagePrompt || scene.narration || "";

                // Categorize what might be in the scene to apply the right motion type
                const pLower = videoPrompt.toLowerCase();
                let motionSuffix = "";
                if (/\b(person|woman|man|girl|boy|people|face)\b/.test(pLower)) {
                    motionSuffix = " The person breathes naturally with subtle chest rise and fall. Eyes blink softly. Head tilts slightly. Hair strands drift gently. Fingers twitch.";
                } else if (/\b(animal|dog|cat|bird|horse|fish|tiger)\b/.test(pLower)) {
                    motionSuffix = " The animal breathes with visible ribcage expansion. Ears flick. Fur ripples in breeze. Eyes track sideways.";
                } else if (/\b(water|ocean|sea|river|lake|rain|wave)\b/.test(pLower)) {
                    motionSuffix = " Water surface ripples expand outward. Reflections shimmer and distort. Foam edges creep forward. Light dances across the water.";
                } else if (/\b(tree|plant|flower|grass|leaf|forest)\b/.test(pLower)) {
                    motionSuffix = " Leaves rustle and turn. Branches bob gently up and down in breeze. Grass blades bend in rolling wave patterns.";
                } else {
                    motionSuffix = " Ambient dust particles drift through visible light beams. Subtle atmospheric shimmer across all surfaces. Light rays sweep slowly. Shadows crawl.";
                }

                // Strip scene-description & text-related phrases
                videoPrompt = videoPrompt
                    .replace(/\b(text|title|caption|subtitle|label|watermark|logo|word|letter|number|overlay|heading|banner|sign|writing|inscription|credit|quote|annotation|typography|font)s?\b/gi, '')
                    .replace(/\b(the image shows?|in the image|we can see|there is|there are|the scene depicts?|the photo shows?|a photo of|an image of)\b/gi, '')
                    .replace(/\s{2,}/g, ' ')
                    .trim();

                // Append physics-based motion + fixed camera trick + compact anti-text
                videoPrompt += motionSuffix;
                if (!/(stationary|locked|tripod|zero camera|no camera)/i.test(videoPrompt)) {
                    videoPrompt += ' Stationary camera, locked tripod, zero camera movement.';
                }
                videoPrompt += " Absolutely no text, titles, words, writing, captions, labels, or overlays of any kind in any language.";
                const sceneDuration = scene.duration || 10;

                // Skip if no image was generated and no skip marker
                if (!sceneImageUrl || sceneImageUrl === "") {
                    console.warn(`⚠️ Scene ${i + 1}: No image URL or skip marker, skipping video generation`);
                    continue;
                }

                // ── STUDIO: split-screen/composite override — inject directly, skip Kling ──
                const splitOverride = imageData.sceneOverrides?.[i];
                if (splitOverride) {
                    console.log(`🎬 Scene ${i + 1}: studio override (split/composite), bypassing Kling`);
                    sceneVideoUrls[i] = splitOverride; // JSON string → Remotion will parse it
                    // Use probed actual duration — narration-based sceneDuration causes "No frame found" crashes
                    sceneVideoDurations[i] = imageData.sceneProbedDurations?.[i] || sceneDuration;
                    console.log(`  ⏱️ Override duration: ${sceneVideoDurations[i]}s (probed: ${!!imageData.sceneProbedDurations?.[i]})`);
                    continue;
                }

                // ── STUDIO: slideshow JSON — Remotion handles it via imageUrls, skip Kling ──
                let isSlideshow = false;
                try {
                    const parsed = JSON.parse(sceneImageUrl);
                    if (parsed?.type === "slideshow") { isSlideshow = true; }
                } catch { }
                if (isSlideshow) {
                    console.log(`🖼️ Scene ${i + 1}: slideshow — skipping Kling, Remotion will cycle images`);
                    // imageUrls[i] already has the slideshow JSON — Remotion reads it directly
                    sceneVideoDurations[i] = sceneDuration;
                    continue;
                }

                // ── STUDIO: direct user-uploaded video URL — skip Kling ──────────
                const isDirectVideo = sceneImageUrl !== "SKIP_T2V" && sceneImageUrl !== "SKIP_VEO" &&
                    /\.(mp4|mov|webm)/i.test(sceneImageUrl);
                if (isDirectVideo) {
                    console.log(`🎬 Scene ${i + 1}: direct user video, bypassing Kling`);
                    sceneVideoUrls[i] = sceneImageUrl;
                    // Use probed actual duration — narration-based sceneDuration causes "No frame found" crashes
                    if (imageData.sceneProbedDurations?.[i]) {
                        sceneVideoDurations[i] = imageData.sceneProbedDurations[i];
                    } else {
                        // Safety: probe now if not probed in image step
                        const probedDur = await probeVideoDuration(sceneImageUrl);
                        sceneVideoDurations[i] = Math.round(probedDur * 10) / 10;
                    }
                    console.log(`  ⏱️ Direct video duration: ${sceneVideoDurations[i]}s`);
                    continue;
                }

                // Text-to-video for general/living_thing scenes, image-to-video for monument scenes
                const isTextToVideo = sceneImageUrl === "SKIP_T2V" || sceneImageUrl === "SKIP_VEO";
                sceneConfigs.push({
                    index: i,
                    prompt: videoPrompt || scene.imagePrompt,
                    imageUrl: isTextToVideo ? undefined : sceneImageUrl,
                    duration: sceneDuration,
                });

                const mode = isTextToVideo ? "txt2vid" : "img2vid (monument)";
                console.log(`📋 Scene ${i + 1}/${totalScenes}: Kling ${mode} | duration=${sceneDuration}s`);
            }

            // Submit all jobs and poll in parallel — dramatically reduces total time
            console.log(`🚀 Submitting ${sceneConfigs.length} Kling 2.5 Turbo jobs in parallel...`);
            try {
                const results = await generateKlingScenesParallel(sceneConfigs, seriesId);

                // Map results back to arrays
                for (const [sceneIndex, result] of results) {
                    sceneVideoUrls[sceneIndex] = result.videoUrl;
                    sceneThumbnailUrls[sceneIndex] = result.thumbnailUrl;
                    sceneVideoDurations[sceneIndex] = result.actualDurationSec;
                    console.log(`✅ Scene ${sceneIndex + 1} Kling video ready: ${result.videoUrl.substring(0, 60)}...`);
                }
            } catch (err: any) {
                console.error(`❌ Parallel Kling generation error: ${err?.message || err}`);
                // Individual scene failures are already handled inside generateKlingScenesParallel
                // Scenes that failed will have empty URLs and fall back to static images in Remotion
            }

            const videoSuccessCount = sceneVideoUrls.filter(u => u.length > 0).length;
            console.log(`✅ Scene video generation complete: ${videoSuccessCount}/${totalScenes} videos generated via Kling 2.5 Turbo`);
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
    { event: "motion-graphics/generate.video" },
    async ({ event, step }) => {
        const { projectId } = event.data;
        const { motionGraphicProjects, motionGraphicMessages } = require("@/config/schema");

        // Step 1: Fetch project from DB
        const project = await step.run("fetch-project", async () => {
            const [p] = await db
                .select()
                .from(motionGraphicProjects)
                .where(eq(motionGraphicProjects.projectId, projectId));

            if (!p) throw new Error(`Project not found: ${projectId}`);
            console.log(`✅ Fetched motion graphic project: "${p.prompt.substring(0, 50)}..."`);
            return p;
        });

        // Step 2: Generate scene images using Leonardo AI
        await step.run("update-status-assets", () => updateMotionGraphicStatus(projectId, "generating:assets"));

        const imageData = await step.run("generate-scene-images", async () => {
            const scenes = (project.sceneData as any[]) || [];
            console.log(`🖼️ Generating images for ${scenes.length} scenes...`);

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

            for (let i = 0; i < scenes.length; i++) {
                const scene = scenes[i];
                if (scene.imageUrl) continue; // Already has one

                const mustGenerate      = ALWAYS_IMAGE_TYPES.has(scene.type);
                const optionalGenerate  = OPTIONAL_IMAGE_TYPES.has(scene.type) && (i % 2 === 0); // every other optional scene
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
                return { imageUrls: [], sceneIndices: [] };
            }

            // Generate ALL images in parallel with round-robin key rotation (same as short video generator)
            console.log(`🚀 Submitting ${imagePrompts.length} scenes for PARALLEL Nano Banana generation...`);

            const parallelConfigs = imagePrompts.map((prompt, idx) => ({
                index: sceneIndices[idx],
                prompt: `${prompt}. Professional motion graphic style, clean background, high contrast, vibrant colors`,
                width: 1024,
                height: 1024,
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
            return { imageUrls, sceneIndices };
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
                // Get the image URL (either from AI-generated or from image generation step)
                const imgIdx = imageData.sceneIndices.indexOf(i);
                const generatedUrl = imgIdx >= 0 ? imageData.imageUrls[imgIdx] : null;
                const finalImageUrl = generatedUrl || scene.imageUrl || '';
                
                // Only send scenes with actual images to Kling
                const klingEligible = ['video_hero', 'image_showcase', 'split_hero', 'logo_reveal', 'browser_mockup', 'phone_mockup'];
                if (finalImageUrl && finalImageUrl.startsWith('http') && klingEligible.includes(scene.type)) {
                    // Skip if already a video URL
                    if (finalImageUrl.endsWith('.mp4') || finalImageUrl.endsWith('.webm') || finalImageUrl.includes('video-files')) continue;
                    klingCandidates.push({
                        index: i,
                        imageUrl: finalImageUrl,
                        narration: scene.voiceoverLine || scene.headline || scene.subtext || '',
                    });
                }
            }

            // Limit to max 2 Kling generations to keep render time reasonable
            const toProcess = klingCandidates.slice(0, 2);
            if (toProcess.length === 0) {
                console.log(`⏭️ No Kling-eligible scenes, skipping video generation`);
                return { videoUrls: {} as Record<number, string> };
            }

            console.log(`🎬 Generating ${toProcess.length} Kling video clips for scenes: ${toProcess.map(c => c.index + 1).join(', ')}`);
            const videoUrls: Record<number, string> = {};

            // Process Kling generations sequentially (they're long-running)
            for (const candidate of toProcess) {
                try {
                    const { processImgToVideo } = await import('@/app/api/studio/img-to-video/route');
                    console.log(`🎥 Kling: Scene ${candidate.index + 1} → ${candidate.imageUrl.substring(0, 60)}...`);
                    
                    const data = await processImgToVideo({
                        imageUrl: candidate.imageUrl,
                        sceneNarration: candidate.narration,
                        sceneIndex: candidate.index,
                        duration: 5,
                        forceShorts: false, // Use landscape 16:9 for motion graphics
                    });

                    if (data.ok && data.videoUrl) {
                        videoUrls[candidate.index] = data.videoUrl;
                        console.log(`✅ Kling scene ${candidate.index + 1} complete: ${data.videoUrl.substring(0, 80)}...`);
                    } else {
                        console.warn(`⚠️ Kling scene ${candidate.index + 1} returned no video: ${JSON.stringify(data).substring(0, 100)}`);
                    }
                } catch (err: any) {
                    console.warn(`⚠️ Kling scene ${candidate.index + 1} failed: ${err.message?.substring(0, 100)}`);
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

            const enrichedScenes = scenes.map((scene: any, i: number) => {
                const imgIdx = imageData.sceneIndices.indexOf(i);
                const generatedImageUrl = imgIdx >= 0 ? imageData.imageUrls[imgIdx] : null;
                const klingVideoUrl = klingData.videoUrls[i] || null;
                const rawUrl = klingVideoUrl || generatedImageUrl || scene.imageUrl || '';
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

        // Step 5: Render the video with Remotion
        const renderResult = await step.run("render-video", async () => {
            const fs = await import("fs");
            const path = await import("path");
            const { exec } = await import("child_process");

            const cwd = process.cwd();
            const tmpDir = path.join(cwd, 'public', 'tmp');
            const rendersDir = path.join(cwd, 'public', 'renders');
            if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
            if (!fs.existsSync(rendersDir)) fs.mkdirSync(rendersDir, { recursive: true });

            // ── Pre-render: clean up ALL stale assets_mg_* dirs from previous renders ──
            // This prevents the public/tmp folder from accumulating GBs of old scene images
            // across multiple failed/successful renders, which caused Remotion to copy 1.1 GB.
            try {
                const tmpEntries = fs.readdirSync(tmpDir);
                for (const entry of tmpEntries) {
                    if (entry.startsWith('assets_mg_') && entry !== `assets_mg_${projectId}`) {
                        const staleDir = path.join(tmpDir, entry);
                        try {
                            fs.rmSync(staleDir, { recursive: true, force: true });
                            console.log(`🧹 Cleaned up stale tmp dir: ${entry}`);
                        } catch {}
                    }
                }
            } catch {}

            // Download scene images locally to avoid remote URL issues during render
            const localProps = { ...remotionProps };
            const assetsDirRel = `tmp/assets_mg_${projectId}`;
            const assetsDirAbs = path.join(cwd, 'public', assetsDirRel);
            if (!fs.existsSync(assetsDirAbs)) fs.mkdirSync(assetsDirAbs, { recursive: true });

            const toRelativeUrl = (absPath: string) => {
                // Return relative path from public/ for Remotion's staticFile()
                return path.relative(path.join(cwd, 'public'), absPath).replace(/\\/g, '/');
            };

            // Download scene images/videos to local
            if (localProps.scenes && Array.isArray(localProps.scenes)) {
                for (let i = 0; i < localProps.scenes.length; i++) {
                    const scene = localProps.scenes[i];
                    if (scene.imageUrl && scene.imageUrl.startsWith('http')) {
                        try {
                            const isVideo = scene.imageUrl.endsWith('.mp4') || scene.imageUrl.endsWith('.webm') || scene.imageUrl.includes('video-files');
                            const response = await fetch(scene.imageUrl);
                            if (response.ok) {
                                const buffer = Buffer.from(await response.arrayBuffer());
                                const contentType = response.headers.get('content-type') || '';
                                // Detect actual format from Content-Type + magic bytes (never trust the URL extension)
                                // MP4 magic: bytes 4-7 are ASCII 'ftyp' (0x66 0x74 0x79 0x70)
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
                                // MP4 handling: Transcode ALL MP4s to H.264 using ffmpeg-static.
                                // Kling AI returns HEVC (H.265) which crashes Remotion's compositor.
                                // ffmpeg-static provides a bundled ffmpeg.exe — no system install needed.
                                if (ext === 'mp4') {
                                    const srcMp4 = path.join(assetsDirAbs, `scene_${i}_src.mp4`);
                                    const destMp4 = path.join(assetsDirAbs, `scene_${i}.mp4`);
                                    fs.writeFileSync(srcMp4, buffer);
                                    try {
                                        const { execSync } = await import('child_process');
                                        // require('ffmpeg-static') returns a wrong bundled path in Inngest context.
                                        // Build the real path directly from node_modules.
                                        const isWin = process.platform === 'win32';
                                        const ffmpegBin = path.join(cwd, 'node_modules', 'ffmpeg-static', isWin ? 'ffmpeg.exe' : 'ffmpeg');
                                        execSync(
                                            `"${ffmpegBin}" -y -i "${srcMp4}" -c:v libx264 -preset fast -crf 23 -profile:v baseline -level 3.1 -pix_fmt yuv420p -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" -an "${destMp4}"`,
                                            { timeout: 120000, stdio: 'pipe' }
                                        );
                                        if (fs.existsSync(destMp4) && fs.statSync(destMp4).size > 1000) {
                                            const APP_PORT = process.env.PORT || 3000;
                                            const relPath = path.relative(path.join(cwd, 'public'), destMp4).replace(/\\/g, '/');
                                            const httpUrl = `http://localhost:${APP_PORT}/${relPath}`;
                                            localProps.scenes[i] = { ...scene, imageUrl: httpUrl };
                                            console.log(`🎬 Scene ${i + 1} (${scene.type}): H.264 ready → ${httpUrl}`);
                                        } else {
                                            console.warn(`⚠️ Scene ${i + 1}: transcoding produced empty file — clearing imageUrl`);
                                            localProps.scenes[i] = { ...scene, imageUrl: '' };
                                        }
                                    } catch (transcodeErr: any) {
                                        console.warn(`⚠️ Scene ${i + 1}: transcode failed (${transcodeErr.message?.slice(0, 100)}) — clearing imageUrl`);
                                        localProps.scenes[i] = { ...scene, imageUrl: '' };
                                    } finally {
                                        try { fs.unlinkSync(srcMp4); } catch {}
                                    }
                                } else {
                                    // For images: serve via HTTP from Next.js (same as MP4s).
                                    // IMPORTANT: Absolute file:/// paths FAIL in Remotion's Chromium on Windows
                                    // when the path contains spaces or special characters.
                                    const destAbs = path.join(assetsDirAbs, `scene_${i}.${ext}`);
                                    fs.writeFileSync(destAbs, buffer);
                                    const APP_PORT = process.env.PORT || 3000;
                                    const relPath = path.relative(path.join(cwd, 'public'), destAbs).replace(/\\/g, '/');
                                    const httpUrl = `http://localhost:${APP_PORT}/${relPath}`;
                                    localProps.scenes[i] = { ...scene, imageUrl: httpUrl };
                                    console.log(`📥 Scene ${i + 1}: saved locally (${(buffer.length / 1024).toFixed(0)}KB, ${ext}) → ${httpUrl}`);
                                }
                            } else {
                                console.warn(`⚠️ Failed to download scene ${i + 1} asset: HTTP ${response.status}`);
                                localProps.scenes[i] = { ...scene, imageUrl: '' };
                            }
                        } catch (err: any) {
                            console.warn(`⚠️ Failed to download scene ${i + 1} asset: ${err.message}`);
                            localProps.scenes[i] = { ...scene, imageUrl: '' };
                        }
                    } else if (scene.imageUrl && !scene.imageUrl.startsWith('http')) {
                        // Stale relative path from a previous run — verify the file still exists on disk
                        const relPath = scene.imageUrl.replace(/^\//, '');
                        const absPath = path.join(cwd, 'public', relPath);
                        if (!fs.existsSync(absPath)) {
                            console.warn(`⚠️ Scene ${i + 1} has stale local path (${scene.imageUrl}), file missing — clearing`);
                            localProps.scenes[i] = { ...scene, imageUrl: '' };
                        } else {
                            const APP_PORT = process.env.PORT || 3000;
                            const httpUrl = `http://localhost:${APP_PORT}/${relPath}`;
                            localProps.scenes[i] = { ...scene, imageUrl: httpUrl };
                            console.log(`✅ Scene ${i + 1} converted to HTTP asset: ${httpUrl}`);
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
                        localProps.musicUrl = toRelativeUrl(destAbs);
                        console.log(`📥 Downloaded music locally`);
                    }
                } catch (err: any) {
                    console.warn(`⚠️ Failed to download music: ${err.message}`);
                }
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
                            localProps.audioUrl = toRelativeUrl(destAbs);
                            console.log(`📥 Downloaded voiceover locally (${fs.statSync(destAbs).size} bytes)`);
                        } else {
                            console.warn(`⚠️ Voiceover downloaded but file is empty or missing`);
                        }
                    } else {
                        console.warn(`⚠️ Voiceover download HTTP error: ${response.status}`);
                    }
                } catch (err: any) {
                    console.warn(`⚠️ Failed to download voiceover: ${err.message}`);
                }
            }

            // Delete any stale props file from previous failed runs so old file:/// paths
            // are never reused when Inngest retries the step.
            const propsPath = path.join(tmpDir, `props-mg-${projectId}.json`);
            try { if (fs.existsSync(propsPath)) fs.unlinkSync(propsPath); } catch {}

            // Write fresh props to JSON file
            fs.writeFileSync(propsPath, JSON.stringify(localProps));

            const outputPath = path.join(rendersDir, `mg_${projectId}.mp4`);
            const propsArg = propsPath.replace(/\\/g, '/');
            const outputArg = outputPath.replace(/\\/g, '/');

            // Build render command — uses MotionGraphic composition
            // CRITICAL: --bundle-cache=false forces Remotion to create a FRESH webpack bundle
            // that includes the newly downloaded assets (voiceover, music, images).
            // Without this, Remotion reuses a cached bundle that doesn't contain the
            // dynamically downloaded files.
            // MP4 assets are served by Next.js on port 3001 (http://localhost:3001/tmp/...),
            // NOT by Remotion's bundle server — so --port is intentionally omitted.
            const cmd = [
                'npx remotion render MotionGraphic',
                `"${outputArg}"`,
                `--props="${propsArg}"`,
                `--timeout=120000`,
                `--disable-web-security`,
                `--gl=angle`,
                `--concurrency=1`,
                `--jpeg-quality=75`,
                `--bundle-cache=false`,
            ].join(' ');

            console.log(`🎬 Rendering motion graphic: ${cmd.substring(0, 120)}...`);

            // Execute render
            await new Promise<void>((resolve, reject) => {
                const child = exec(cmd, { cwd }, (error) => {
                    if (error) return reject(error);
                    resolve();
                });
                child.stdout?.on('data', (data) => console.log(`[Remotion] ${data.toString().trim()}`));
                child.stderr?.on('data', (data) => console.log(`[Remotion] ${data.toString().trim()}`));
            });

            // Clean up temp files
            try { fs.unlinkSync(propsPath); } catch {}
            try { fs.rmSync(assetsDirAbs, { recursive: true, force: true }); } catch {}

            const localUrl = `/renders/mg_${projectId}.mp4`;
            console.log(`✅ Motion graphic render complete: ${localUrl}`);
            return { videoUrl: localUrl };
        });

        // Step 6: Save props + video URL to DB and add system message
        const saveResult = await step.run("save-and-finalize", async () => {
            // Update project with all generated data
            await db.update(motionGraphicProjects)
                .set({
                    remotionProps,
                    videoUrl: renderResult.videoUrl,
                    audioUrl: voiceData?.audioUrl || null,
                    audioDuration: voiceData?.audioDuration || null,
                    status: "completed",
                    updatedAt: new Date(),
                })
                .where(eq(motionGraphicProjects.projectId, projectId));

            // Add completion message
            await db.insert(motionGraphicMessages).values({
                projectId,
                role: "system",
                content: `✅ Motion graphic video generated! ${(project.sceneData as any[])?.length || 0} scenes, ${project.duration}s duration.${voiceData ? ` Voiceover: ${voiceData.audioDuration}s` : ' No voiceover.'}`,
                metadata: { type: "generation_complete", remotionProps },
            });

            console.log(`🏁 Motion graphic project finalized: ${projectId}`);
            return { success: true };
        });

        return {
            success: true,
            projectId,
            scenesCount: (project.sceneData as any[])?.length || 0,
            hasVoiceover: !!voiceData,
            videoUrl: renderResult.videoUrl,
            saveResult,
        };
    }
);
