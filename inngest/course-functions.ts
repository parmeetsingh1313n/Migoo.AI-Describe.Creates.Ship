/**
 * Course Generation Inngest Functions
 * ────────────────────────────────────
 * Storage split:
 *   - Slide HTML, narration, revealData, captions → Drizzle DB (chapter_content_slides)
 *   - Audio (.mp3), images, thumbnails → Appwrite blob (putWithRotation)
 *
 * Events:
 *   course/thumbnail.generate     → generateCourseThumbnailFn
 *   course/images.generate        → generateCourseImagesFn
 *   course/slides.generate        → generateCourseSlidesFn   (Phase 1 → review gate)
 *   course/audio.generate         → generateCourseAudioFn    (Phase 2, after approval)
 */


import { db } from "@/config/db";
import { openrouter } from "@/config/openrouter";
import { chapterContentSlides, chapterGenerationStatus, courseImages, coursesTable } from "@/config/schema";
import { GENERATE_SINGLE_SLIDE_PROMPT, EXPAND_CHAPTER_TOPICS_PROMPT } from "@/data/Prompt";
import { putWithRotation } from "@/lib/blob";
import { generateNanoBananaImage, generateNanoBananaImagesParallel } from "@/lib/apify-image";
import { fetchSlideResearch } from "@/lib/tavily";
import { SLIDE_TYPE_PAIRS, SLIDE_ACCENTS, SLIDE_ARCHETYPES, pickArchetype, pickNonCodeArchetype, componentName, isCodeArchetype, isCodeCompanionArchetype, isLikelyCodeTopic, codeSlideBudget } from "@/data/slide-design";
import { eq } from "drizzle-orm";
import { inngest } from "./client";

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS — Dynamic per-chapter slide topic expansion
// ─────────────────────────────────────────────────────────────────────────────

export const MAX_SLIDES_PER_CHAPTER = 25;

export type ChapterTopic = { topic: string; needsCode: boolean };

/**
 * Expands a chapter's subContent points (broad learning objectives) into
 * granular, slide-sized topics — 1-3 per point depending on how much depth
 * that point actually needs, capped at MAX_SLIDES_PER_CHAPTER total, each
 * flagged with whether it needs a real code example. Replaces the old fixed
 * "1 subContent point = 1 slide" mapping so simple topics stay short and rich
 * topics get the multiple slides they need. Falls back to the raw subContent
 * list (1:1, needsCode via keyword heuristic) on any failure — expansion is
 * an enhancement, never a blocker for chapter generation.
 */
export async function expandChapterTopics(chapterTitle: string, subContent: string[]): Promise<ChapterTopic[]> {
    if (subContent.length === 0) return [{ topic: chapterTitle, needsCode: false }];
    try {
        const input = JSON.stringify({ chapterTitle, subContent });
        const result = await openrouter.json(EXPAND_CHAPTER_TOPICS_PROMPT, input, {
            model: "z-ai/glm-5.2",
            // Low temperature: this call runs independently from BOTH the images
            // function and the slides function for the same chapter — keeping it
            // as deterministic as possible minimizes drift between the two, so
            // the image-per-slide index alignment (see generateCourseImagesFn)
            // stays correct more often.
            temperature: 0.1,
            maxTokens: 4000,
        });
        const entries: Array<{ sourceIndex: number; topic: string; needsCode?: boolean }> = Array.isArray(result) ? result : [];
        const topics = entries
            .filter(e => e && typeof e.topic === "string" && e.topic.trim() && Number.isInteger(e.sourceIndex) && e.sourceIndex >= 0 && e.sourceIndex < subContent.length)
            .sort((a, b) => a.sourceIndex - b.sourceIndex)
            .map(e => ({
                topic: e.topic.trim(),
                needsCode: typeof e.needsCode === "boolean" ? e.needsCode : isLikelyCodeTopic(e.topic),
            }))
            .slice(0, MAX_SLIDES_PER_CHAPTER);
        if (topics.length > 0) {
            console.log(`📐 Expanded ${subContent.length} subContent points → ${topics.length} slide topics (${topics.filter(t => t.needsCode).length} code) for "${chapterTitle}"`);
            return topics;
        }
    } catch (e: any) {
        console.warn(`⚠️ Topic expansion failed for "${chapterTitle}": ${e.message?.substring(0, 120)} — falling back to 1:1 mapping`);
    }
    return subContent.slice(0, MAX_SLIDES_PER_CHAPTER).map(topic => ({ topic, needsCode: isLikelyCodeTopic(topic) }));
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS — Thumbnail prompts
// ─────────────────────────────────────────────────────────────────────────────

function extractMainKeywords(title: string): string {
    let t = title.includes(":") ? title.split(":")[0].trim() : title;
    const words = t.split(/\s+/).filter(Boolean);
    if (words.length <= 3) return t;
    const stop = new Set(["a", "an", "the", "and", "or", "but", "in", "on", "at", "for", "with", "about", "to", "from", "of"]);
    return words.filter(w => !stop.has(w.toLowerCase())).slice(0, 3).join(" ");
}

function buildThumbnailPrompt(courseName: string): string {
    const t = extractMainKeywords(courseName);
    const scenes = [
        `A futuristic holographic display in a dark lab, showing the text "${t}" in crisp cyan letters. STRICTLY ENSURE PERFECT SPELLING of "${t}". Ray traced lighting, 8k.`,
        `A glowing neon sign displaying the text "${t}". Vibrant electric blue and purple tubes on a dark brick wall. STRICTLY ENSURE PERFECT SPELLING of "${t}". Cinematic urban, 8k.`,
        `A vintage blackboard with the words "${t}" in beautiful chalk lettering. STRICTLY ENSURE PERFECT SPELLING of "${t}". Warm golden lighting, 8k.`,
        `A retro 80s arcade screen displaying the text "${t}" in bright 8-bit pixel art. Glowing scanlines, CRT curvature. STRICTLY ENSURE PERFECT SPELLING of "${t}". Vibrant colors.`,
        `A breathtaking nebula where the stars form the text "${t}" in a cosmic cloud of purple and gold light. STRICTLY ENSURE PERFECT SPELLING of "${t}". Astronomical photography.`,
    ];
    return scenes[Math.floor(Math.random() * scenes.length)];
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS — Image prompts
// ─────────────────────────────────────────────────────────────────────────────

function buildImagePrompt(courseName: string, chapterTitle: string, topic: string, idx: number): string {
    const styles = [
        "cinematic 3D render of glowing tech icons floating in space",
        "isometric illustration of a developer workspace with holographic displays",
        "futuristic concept art with neon circuitry patterns and code editor screens",
        "minimalist flat design with abstract tech stack logos and geometric shapes",
        "photorealistic close-up of circuit boards, chips, and glowing data streams",
        "abstract digital art with interconnected nodes, neural network visualization",
        "sleek dark-themed illustration of programming tools and development environment",
        "dramatic low-angle 3D render of floating tech symbols and gear icons",
        "vibrant gradient art with abstract representations of algorithms and data flow",
        "modern glassmorphism UI concept with layered translucent tech panels",
    ];
    const tech = [
        "featuring relevant technology symbols, framework icons, and code brackets",
        "with floating gear icons, terminal windows, and abstract API connections",
        "showing symbolic tech stack representations like curly braces and flow arrows",
        "with glowing hexagonal nodes, data pipelines, and abstract architecture diagrams",
        "featuring stylized keyboard keys, mouse cursor trails, and IDE-inspired accents",
    ];
    return `${styles[idx % styles.length]}, visually representing "${topic}" in "${chapterTitle}" for "${courseName}". ${tech[idx % tech.length]}. Dark moody background, vibrant accent lighting, 4K ultra quality. STRICTLY NO TEXT — only visual symbols and abstract tech imagery`;
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS — WAV / TTS
// ─────────────────────────────────────────────────────────────────────────────

// ─── MP3 helpers ─────────────────────────────────────────────────────────────

/**
 * Estimate MP3 duration by parsing the first MPEG sync frame header.
 * Falls back to assuming 64 kbps if no valid frame found.
 */
function getMp3Duration(buf: Buffer): number {
    // Skip ID3v2 tag if present
    let offset = 0;
    if (buf.length > 10 && buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) {
        const id3Size = ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f);
        offset = id3Size + 10;
    }
    // Scan for MPEG sync word
    for (let i = offset; i < Math.min(buf.length - 3, offset + 8192); i++) {
        if (buf[i] === 0xFF && (buf[i + 1] & 0xE0) === 0xE0) {
            const header = buf.readUInt32BE(i);
            const versionBits = (header >> 19) & 0x3;
            const bitrateIdx = (header >> 12) & 0xF;
            const sampleRateIdx = (header >> 10) & 0x3;
            // Bitrate table: MPEG1 Layer3
            const BITRATES = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
            const SAMPLE_V1 = [44100, 48000, 32000, 0];
            const SAMPLE_V2 = [22050, 24000, 16000, 0]; // MPEG2 / 2.5
            const bitrate = BITRATES[bitrateIdx] * 1000;
            const sampleRate = versionBits === 3 ? SAMPLE_V1[sampleRateIdx] : SAMPLE_V2[sampleRateIdx];
            if (bitrate > 0 && sampleRate > 0) return (buf.length * 8) / bitrate;
        }
    }
    return (buf.length * 8) / 64000; // fallback: assume 64 kbps
}

/**
 * Merge MP3 chunk buffers.
 * MP3 is a streaming format — simple byte concatenation works for sequential playback.
 */
function mergeMp3Buffers(bufs: Buffer[]): Buffer {
    return bufs.length === 1 ? bufs[0] : Buffer.concat(bufs);
}

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
        .replace(/([a-zA-Z])\1{2,}/g, '$1$1') // Collapse repeated characters: "soooo" → "soo"
        .replace(/:\s/g, '. ')               // Replace colons with periods for cleaner TTS breaks
        .replace(/;\s/g, '. ')               // Replace semicolons with periods
        .replace(/—/g, ', ')                 // Replace em-dashes with comma
        .replace(/–/g, ', ')                 // Replace en-dashes with comma
        .replace(/\s+/g, ' ')
        .trim();
}

function chunkTextForTTS(text: string, max = 2400): string[] {
    if (text.length <= max) return [text];
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
    const chunks: string[] = [];
    let cur = "";
    for (const s of sentences) {
        const t = s.trim();
        if (!t) continue;
        if (cur.length + t.length + 1 > max && cur) { chunks.push(cur.trim()); cur = t; }
        else cur += (cur ? " " : "") + t;
    }
    if (cur) chunks.push(cur.trim());
    return chunks;
}

/**
 * Collect all Sarvam API keys from environment variables.
 * Supports: SARVAM_API_KEY, SARVAM_API_KEY_2, SARVAM_API_KEY_3, ...
 * Re-reads process.env on every call so a server restart with a new key
 * is always picked up — no singleton caching issue.
 */
function getSarvamKeys(): string[] {
    const keys: string[] = [];
    // Primary key
    if (process.env.SARVAM_API_KEY) keys.push(process.env.SARVAM_API_KEY);
    // Numbered extras: SARVAM_API_KEY_2, SARVAM_API_KEY_3, ...
    for (let i = 2; i <= 10; i++) {
        const k = process.env[`SARVAM_API_KEY_${i}`];
        if (k) keys.push(k);
    }
    return keys;
}

/**
 * Determine whether a Sarvam HTTP error is credit/auth related.
 * These are the cases where rotating to a different key might succeed.
 */
function isSarvamCreditError(status: number, body: string): boolean {
    // 402 = Payment Required (credits exhausted)
    // 401 = Unauthorized (invalid/expired key)
    // 429 = Too Many Requests (rate limit — retry with different key)
    if ([401, 402, 429].includes(status)) return true;
    const b = body.toLowerCase();
    return b.includes("insufficient") || b.includes("credit") ||
        b.includes("quota") || b.includes("limit exceeded") ||
        b.includes("unauthorized") || b.includes("invalid key");
}

// In-memory state tracking the current working Sarvam key index to avoid re-testing failed ones.
let activeSarvamKeyIndex = 0;

/**
 * Generate TTS audio via Sarvam AI with automatic key rotation.
 *
 * - Tries keys starting from the last known working key index.
 * - On credit/auth/rate-limit/network/timeout errors, rotates to the next key.
 * - Uses output_audio_codec: "mp3" — ~57x smaller than WAV.
 * - Features a 30s abort timeout to prevent connections from hanging indefinitely.
 */
async function generateTTSAudio(text: string, lang = "en-IN", speaker = "kabir"): Promise<Buffer> {
    const keys = getSarvamKeys();
    if (keys.length === 0) throw new Error("No SARVAM_API_KEY found in environment variables");

    const cleaned = sanitizeForTTS(text);
    const chunks = chunkTextForTTS(cleaned, 2400);
    const bufs: Buffer[] = [];

    for (const chunk of chunks) {
        let chunkGenerated = false;
        const keyErrors: string[] = [];

        // Snapshot the starting index so mutations inside the loop don't corrupt iteration
        const startKeyIndex = activeSarvamKeyIndex;
        for (let attempt = 0; attempt < keys.length; attempt++) {
            const ki = (startKeyIndex + attempt) % keys.length;
            const apiKey = keys[ki];
            const keyLabel = ki === 0 ? "primary" : `key_${ki + 1}`;
            try {
                const res = await fetch("https://api.sarvam.ai/text-to-speech", {
                    method: "POST",
                    headers: {
                        "api-subscription-key": apiKey,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        text: chunk,
                        target_language_code: lang,
                        speaker: speaker,
                        pace: 1.05,
                        speech_sample_rate: 22050,
                        enable_preprocessing: true,
                        model: "bulbul:v3",
                        temperature: 0.6,
                        output_audio_codec: "mp3",
                    }),
                    signal: AbortSignal.timeout(30000), // 30-second timeout to prevent API hangs
                });

                if (!res.ok) {
                    const body = await res.text();
                    if (isSarvamCreditError(res.status, body)) {
                        console.warn(`⚠️ Sarvam TTS [${keyLabel}] credit/auth error (${res.status}): ${body.substring(0, 120)} — rotating key...`);
                        keyErrors.push(`[${keyLabel}] ${res.status}: ${body.substring(0, 80)}`);
                        // Set active index to next one to skip this one on future calls
                        activeSarvamKeyIndex = (ki + 1) % keys.length;
                        continue;
                    }
                    // Non-credit error — don't bother rotating
                    throw new Error(`Sarvam TTS failed (${res.status}): ${body}`);
                }

                const data = await res.json();
                if (!data.audios?.[0]) throw new Error("No audio in Sarvam response");
                bufs.push(Buffer.from(data.audios[0], "base64"));

                // Success! Lock this as our active working key index
                activeSarvamKeyIndex = ki;
                if (ki > 0) {
                    console.log(`✅ Sarvam TTS succeeded with [${keyLabel}] after rotation.`);
                }
                chunkGenerated = true;
                break; // chunk done — move to next chunk

            } catch (err: any) {
                // Network errors, timeouts, or parsing errors are treated as rotation candidates
                console.warn(`⚠️ Sarvam TTS [${keyLabel}] error: ${err.message} — rotating key...`);
                keyErrors.push(`[${keyLabel}] error: ${err.message}`);
                activeSarvamKeyIndex = (ki + 1) % keys.length;
            }
        }

        if (!chunkGenerated) {
            throw new Error(
                `Sarvam TTS: all ${keys.length} key(s) exhausted for this chunk.\n` +
                `Errors:\n${keyErrors.join("\n")}\n` +
                `Fix: add a new key as SARVAM_API_KEY_${keys.length + 1} in your .env and restart.`
            );
        }
    }

    return mergeMp3Buffers(bufs);
}

interface Word { text: string; start: number; end: number; }

function wordsToChunks(words: Word[]): { timestamp: [number, number]; text: string }[] {
    if (!words.length) return [];
    const chunks: { timestamp: [number, number]; text: string }[] = [];
    let cur: Word[] = [];
    let start = words[0].start;
    for (let i = 0; i < words.length; i++) {
        cur.push(words[i]);
        const next = words[i + 1];
        const pause = next ? next.start - words[i].end : 0;
        const isEnd = !next || cur.length >= 5 || (cur.length >= 2 && (pause > 0.3 || /[.!?]$/.test(words[i].text)));
        if (isEnd) {
            chunks.push({ timestamp: [start, words[i].end], text: cur.map(w => w.text).join(" ") });
            cur = [];
            if (next) start = next.start;
        }
    }
    return chunks;
}

/**
 * Build a per-fragment timeline from the model's narration.fragments + the known
 * audio duration. Each fragment's [start,end] is its share of the total spoken
 * words, so a fragment the narrator dwells on gets a proportionally longer window.
 *
 * This is the timing signal the render "camera director" uses to know which
 * on-screen fragment is being spoken at each moment. It replaces the old broken
 * mapping (fragment i → caption-chunk i), where ~20 fragments mapped to the first
 * ~20 of ~800 word-chunks and every fragment revealed in the opening seconds.
 *
 * Returns [{ index, startSec, endSec, text }]. Falls back to an even split when
 * fragment word counts are unavailable. Instant — no STT/batch job.
 */
function buildFragmentTimeline(
    fragments: Array<{ index: number; text?: string }> | undefined,
    audioDurationSec: number,
): Array<{ index: number; startSec: number; endSec: number }> {
    if (!Array.isArray(fragments) || fragments.length === 0 || audioDurationSec <= 0) return [];
    const counts = fragments.map(f => Math.max(1, (f.text ?? "").split(/\s+/).filter(Boolean).length));
    const totalWords = counts.reduce((a, b) => a + b, 0);
    const secPerWord = audioDurationSec / totalWords;
    let cursor = 0;
    return fragments.map((f, i) => {
        const start = cursor;
        cursor += counts[i] * secPerWord;
        // Clamp the last fragment's end exactly to the audio duration.
        const end = i === fragments.length - 1 ? audioDurationSec : cursor;
        return { index: f.index ?? i, startSec: +start.toFixed(3), endSec: +end.toFixed(3) };
    });
}

/**
 * Generate captions directly from narration text + known audio duration.
 * 
 * OLD approach: Upload audio → Sarvam batch STT job → poll → download → parse
 *   → 30-60 seconds PER SLIDE (the #1 pipeline bottleneck!)
 * 
 * NEW approach: Use the narration text we already have + audio duration to create
 *   word-level timestamp estimates instantly. The narration IS what was spoken,
 *   so we don't need STT to recover it.
 */
function generateCaptionsFromNarration(narrationText: string, audioDurationSec: number, lang = "en-IN"): any {
    if (!narrationText || audioDurationSec <= 0) {
        return { text: "", language_code: lang, chunks: [], metadata: { engine: "narration-sync" } };
    }

    // Split narration into words and estimate timestamps based on audio duration
    const wordTexts = narrationText.split(/\s+/).filter(Boolean);
    if (wordTexts.length === 0) {
        return { text: narrationText, language_code: lang, chunks: [], metadata: { engine: "narration-sync" } };
    }

    const secPerWord = audioDurationSec / wordTexts.length;
    const words: Word[] = wordTexts.map((text, i) => ({
        text,
        start: +(i * secPerWord).toFixed(3),
        end: +((i + 1) * secPerWord).toFixed(3),
    }));

    const chunks = wordsToChunks(words);
    console.log(`⚡ Instant captions: ${chunks.length} chunks from ${wordTexts.length} words (${audioDurationSec.toFixed(1)}s)`);

    return {
        text: narrationText,
        language_code: lang,
        chunks,
        metadata: { engine: "narration-sync", wordCount: wordTexts.length, durationSec: audioDurationSec },
    };
}

/**
 * Extract ~8 key concepts from a narration text for context chaining.
 * Used to tell subsequent slides what has already been explained.
 */
function extractKeyConcepts(text: string): string[] {
    if (!text) return [];
    // Extract capitalized terms, quoted terms, and terms after "called", "known as", "defined as"
    const patterns = [
        /(?:called|known as|defined as|termed|refers to)\s+["']?([A-Za-z][A-Za-z0-9\s\-]{2,30})["']?/gi,
        /["'`]([A-Za-z][A-Za-z0-9\s\-]{2,25})["'`]/g,
        /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})\b/g,
    ];
    const found = new Set<string>();
    for (const pattern of patterns) {
        let m: RegExpExecArray | null;
        while ((m = pattern.exec(text)) !== null && found.size < 12) {
            const term = m[1].trim();
            if (term.length > 3 && term.length < 40) found.add(term);
        }
    }
    return Array.from(found).slice(0, 8);
}



export const generateCourseThumbnailFn = inngest.createFunction(
    { id: "generate-course-thumbnail", triggers: [{ event: "course/thumbnail.generate" }] },
    async ({ event, step }) => {
        const { courseId, courseName } = event.data as { courseId: string; courseName: string };

        // Skip if Appwrite URL already in DB
        const existing = await step.run("check-existing-thumbnail", async () => {
            const [row] = await db.select({ courseThumbnail: coursesTable.courseThumbnail })
                .from(coursesTable).where(eq(coursesTable.courseId, courseId));
            return row?.courseThumbnail ?? null;
        });

        if (existing && existing.includes("/storage/buckets/")) {
            console.log(`✅ Appwrite thumbnail already exists for ${courseId} — skipping`);
            return { skipped: true, thumbnailUrl: existing };
        }

        // Generate thumbnail image — non-fatal: pipeline continues even if all providers fail
        const imageResult = await step.run("generate-thumbnail-image", async () => {
            const prompt = buildThumbnailPrompt(courseName);
            console.log(`🖼️  Generating thumbnail: ${prompt.substring(0, 80)}...`);
            try {
                const url = await generateNanoBananaImage(prompt, 1024, 1024);
                return { url, ok: true };
            } catch (err: any) {
                console.warn(`⚠️ All thumbnail providers failed — skipping thumbnail. Error: ${err?.message?.substring(0, 200)}`);
                return { url: null as string | null, ok: false };
            }
        });

        if (!imageResult.ok || !imageResult.url) {
            console.log(`⚠️ No thumbnail generated for course ${courseId} — continuing without it.`);
            return { thumbnailUrl: null, courseId, skipped: true };
        }

        // Download image → Upload to Appwrite
        // Handles both HTTP URLs (Leonardo/GPT) and base64 data URLs (Gemini fallback)
        const thumbnailUrl = await step.run("upload-thumbnail-appwrite", async () => {
            let buf: Buffer;
            let ct: string;

            if (imageResult.url!.startsWith('data:')) {
                // Gemini returns base64 data URL: data:<mimeType>;base64,<data>
                const [header, b64] = imageResult.url!.split(',');
                const mimeMatch = header.match(/data:([^;]+)/);
                ct = mimeMatch?.[1] || 'image/png';
                buf = Buffer.from(b64, 'base64');
                console.log(`📦 Decoded Gemini base64 image: ${(buf.length / 1024).toFixed(0)}KB, type=${ct}`);
            } else {
                const res = await fetch(imageResult.url!);
                if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
                buf = Buffer.from(await res.arrayBuffer());
                ct = res.headers.get("content-type") || "image/webp";
            }

            const ext = ct.includes("jpeg") ? "jpg" : ct.includes("png") ? "png" : "webp";
            const { url } = await putWithRotation(`thumbnails/${courseId}.${ext}`, buf, { access: "public", contentType: ct });
            await db.update(coursesTable).set({ courseThumbnail: url }).where(eq(coursesTable.courseId, courseId));
            console.log(`💾 Thumbnail saved to Appwrite: ${url}`);
            return url;
        });

        return { thumbnailUrl, courseId };
    }
);

// ─────────────────────────────────────────────────────────────────────────────
// FUNCTION 2 — Generate Course Chapter Images → Appwrite
// ─────────────────────────────────────────────────────────────────────────────

export const generateCourseImagesFn = inngest.createFunction(
    { id: "generate-course-images", triggers: [{ event: "course/images.generate" }] },
    async ({ event, step }) => {
        const { courseId, courseName, chapters } = event.data as {
            courseId: string; courseName: string; chapters: any[];
        };

        const existing = await step.run("check-existing-images", async () => {
            return await db.select().from(courseImages).where(eq(courseImages.courseId, courseId));
        });

        // We now generate ONE image per SLIDE (not per chapter). Images are keyed by a
        // GLOBAL slide index = chapterIndex * MAX_SLIDES_PER_CHAPTER + slideIdx, so each
        // slide maps 1:1 to its own image at injection time. The per-chapter slide list
        // here is expanded the SAME way generateCourseSlidesFn expands it (1-3 slides per
        // subContent point) so slide counts line up — if the two independent expansions
        // ever drift slightly, the injection lookup already falls back to round-robin
        // cycling through the course's image pool rather than failing.
        const imageJobs: { globalIdx: number; chIdx: number; slideIdx: number; chapterTitle: string; topic: string; prompt: string }[] = [];
        // Canonical per-chapter expansion we persist so generateCourseSlidesFn reuses
        // the EXACT same slide-topic list → identical globalIdx mapping (no drift).
        const slideTopicsByChapter: Record<string, ChapterTopic[]> = {};

        // Load any ALREADY-PERSISTED expansion first. expandChapterTopics calls GLM
        // which is NOT deterministic (8 points → 9 slides one run, 11 the next), so
        // re-running the image job with a fresh expansion shifts every globalIdx and
        // makes already-present images look "missing" → phantom regeneration. Reusing
        // the persisted expansion keeps the index mapping STABLE across re-runs.
        const persistedExpansion = await step.run("load-persisted-expansion", async () => {
            const [course] = await db.select({ slideTopics: coursesTable.slideTopics })
                .from(coursesTable).where(eq(coursesTable.courseId, courseId));
            return (course?.slideTopics as Record<string, ChapterTopic[]>) ?? {};
        });

        for (let chIdx = 0; chIdx < chapters.length; chIdx++) {
            const chapter = chapters[chIdx];
            const chapterTitle = chapter.chapterTitle || `Chapter ${chIdx + 1}`;
            const rawSubContent: string[] = chapter.subContent?.slice(0, MAX_SLIDES_PER_CHAPTER) || [chapterTitle];
            // Reuse the persisted expansion for this chapter if it exists; only call
            // GLM for chapters that have never been expanded yet.
            const already = chapter.chapterId ? persistedExpansion[chapter.chapterId] : null;
            const chapterTopics: ChapterTopic[] = (Array.isArray(already) && already.length > 0)
                ? already
                : await step.run(`expand-topics-for-images-${chIdx}`, () => expandChapterTopics(chapterTitle, rawSubContent));
            if (chapter.chapterId) slideTopicsByChapter[chapter.chapterId] = chapterTopics;
            chapterTopics.forEach(({ topic }, slideIdx) => {
                const globalIdx = chIdx * MAX_SLIDES_PER_CHAPTER + slideIdx;
                imageJobs.push({
                    globalIdx, chIdx, slideIdx, chapterTitle,
                    topic: topic || chapterTitle,
                    prompt: buildImagePrompt(courseName, chapterTitle, topic || chapterTitle, globalIdx),
                });
            });
        }

        // Persist the canonical expansion so the slides function reuses it verbatim.
        // Merge (don't clobber) so a re-run for one chapter never wipes others, and
        // never overwrite a chapter that already has a stored expansion (the slides
        // function may already be generating against it).
        await step.run("persist-slide-topics", async () => {
            const [course] = await db.select({ slideTopics: coursesTable.slideTopics })
                .from(coursesTable).where(eq(coursesTable.courseId, courseId));
            const existingMap = (course?.slideTopics as Record<string, ChapterTopic[]>) ?? {};
            const merged = { ...slideTopicsByChapter, ...existingMap }; // existing wins
            await db.update(coursesTable).set({ slideTopics: merged })
                .where(eq(coursesTable.courseId, courseId));
            return { chapters: Object.keys(merged).length };
        });

        // If we already have an image for every planned globalIdx, skip. Check by
        // INDEX COVERAGE (not just count) — a raw count can be misled by stale
        // indices from an old expansion. With the persisted-expansion reuse above,
        // the planned indices are now stable, so this reliably short-circuits
        // re-runs of an already-imaged course.
        const existingIdx = new Set(existing.map(e => e.imageIndex));
        const allPlannedPresent = imageJobs.length > 0 && imageJobs.every(j => existingIdx.has(j.globalIdx));
        if (allPlannedPresent) {
            console.log(`✅ All ${imageJobs.length} planned images already exist for ${courseId} — skipping`);
            return { skipped: true, count: existing.length };
        }
        const pending = imageJobs.filter(j => !existingIdx.has(j.globalIdx));
        console.log(`📸 Generating ${pending.length} slide images (${imageJobs.length} slides, ${existing.length} already present) for ${courseId}`);

        const generated: any[] = [];

        // Generate in parallel batches (bounded by the apify concurrency limiter + token pool).
        const BATCH = 6;
        for (let b = 0; b < pending.length; b += BATCH) {
            const batch = pending.slice(b, b + BATCH);
            const batchResult = await step.run(`generate-image-batch-${b / BATCH}`, async () => {
                const results = await generateNanoBananaImagesParallel(
                    batch.map(j => ({ index: j.globalIdx, prompt: j.prompt, width: 1024, height: 1024, styleUUID: "111dc692-d470-4eec-b791-3475abac4c46" })),
                    undefined,
                    Math.min(BATCH, batch.length),
                );

                const saved: any[] = [];
                for (const job of batch) {
                    const r = results.find(x => x.index === job.globalIdx);
                    const srcUrl = r?.success ? (r.imageUrl || r.signedUrl) : undefined;
                    if (!srcUrl) {
                        console.warn(`⚠️ Image for slide ${job.globalIdx} failed — leaving placeholder for a later pass`);
                        continue;
                    }
                    try {
                        const imgRes = await fetch(srcUrl);
                        if (!imgRes.ok) throw new Error(`Fetch failed: ${imgRes.statusText}`);
                        const buf = Buffer.from(await imgRes.arrayBuffer());
                        const { url } = await putWithRotation(
                            `course-images/${courseId}/${job.globalIdx}_${Date.now()}.webp`,
                            buf,
                            { access: "public", contentType: "image/webp" }
                        );
                        const [inserted] = await db.insert(courseImages).values({
                            courseId, imageIndex: job.globalIdx,
                            imagePrompt: job.prompt.substring(0, 500),
                            imageUrl: url, width: 1024, height: 1024,
                        }).onConflictDoNothing().returning();
                        if (inserted) { saved.push(inserted); console.log(`💾 Saved slide image ${job.globalIdx} → ${url}`); }
                    } catch (e: any) {
                        console.warn(`⚠️ Store image ${job.globalIdx} failed: ${e.message?.substring(0, 120)}`);
                    }
                }
                return saved;
            });
            if (batchResult) generated.push(...batchResult);
        }

        console.log(`🎉 Slide images complete: ${generated.length} new (${imageJobs.length} slides total)`);

        // ── RETROACTIVE INJECTION PASS ───────────────────────────────────────
        // Slides may have been generated BEFORE images were ready (race condition).
        // Now that images exist, find every slide with {{IMAGE_PLACEHOLDER}} still
        // in its HTML and replace them with real image URLs.
        await step.run("retroactive-image-injection", async () => {
            const savedImages = await db.select().from(courseImages)
                .where(eq(courseImages.courseId, courseId));
            if (savedImages.length === 0) return { injected: 0 };
            savedImages.sort((a, b) => a.imageIndex - b.imageIndex);
            // Map each image by its global slide index for exact 1:1 lookup.
            const byIndex = new Map(savedImages.map(img => [img.imageIndex, img.imageUrl]));
            // chapterId → chapter position, so a slide can compute its global image index.
            const chapterPos = new Map(chapters.map((c, i) => [c.chapterId, i]));

            // Load all slides for this course
            const allSlides = await db.select().from(chapterContentSlides)
                .where(eq(chapterContentSlides.courseId, courseId));

            let injected = 0;
            for (const slide of allSlides) {
                if (!slide.html || !slide.html.includes('{{IMAGE_PLACEHOLDER}}')) continue;

                const chPos = chapterPos.get(slide.chapterId) ?? 0;
                const slideNum = (slide.slideIndex ?? 1) - 1;
                const globalIdx = chPos * MAX_SLIDES_PER_CHAPTER + slideNum;
                let extra = 0;
                const newHtml = slide.html.replace(/\{\{IMAGE_PLACEHOLDER\}\}/g, () => {
                    // Exact per-slide image first; if missing, fall back to a nearby one.
                    const url = byIndex.get(globalIdx)
                        ?? savedImages[(globalIdx + extra++) % savedImages.length].imageUrl;
                    return url;
                });

                await db.update(chapterContentSlides)
                    .set({ html: newHtml })
                    .where(eq(chapterContentSlides.slideId, slide.slideId));
                injected++;
            }

            console.log(`🖼️  Retroactive image injection: ${injected}/${allSlides.length} slides updated`);
            return { injected, total: allSlides.length };
        });

        return { generated: generated.length, total: imageJobs.length, courseId };
    }
);

// ─────────────────────────────────────────────────────────────────────────────
// Per-slide component rotation now lives in @/data/slide-design (shared with the
// single-slide regeneration route so the two never drift apart).
// ─────────────────────────────────────────────────────────────────────────────
// SHARED — status upsert helper factory (both slides + audio functions use it)
// ─────────────────────────────────────────────────────────────────────────────
export function makeUpsertStatus(courseId: string, chapterId: string) {
    return async (patch: {
        status?: string;
        slidesComplete?: number;
        slidesTotal?: number;
        audioComplete?: number;
        errorMessage?: string | null;
        startedAt?: Date | null;
        completedAt?: Date | null;
    }) => {
        await db.insert(chapterGenerationStatus).values({
            courseId,
            chapterId,
            status: patch.status ?? "queued",
            slidesComplete: patch.slidesComplete ?? 0,
            slidesTotal: patch.slidesTotal ?? 0,
            audioComplete: patch.audioComplete ?? 0,
            errorMessage: patch.errorMessage ?? null,
            startedAt: patch.startedAt ?? new Date(),
            completedAt: patch.completedAt ?? null,
            updatedAt: new Date(),
        }).onConflictDoUpdate({
            target: chapterGenerationStatus.chapterId,
            set: {
                ...patch,
                updatedAt: new Date(),
            },
        });
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// FUNCTION 3 — Generate Course SLIDES (Phase 1: HTML + narration → DB)
// ─────────────────────────────────────────────────────────────────────────────
// Gated pipeline: this generates ONLY the slide visuals + narration and then
// parks the chapter at status `review:slides`, awaiting human approval in the
// Studio review cockpit. The expensive TTS/audio phase runs separately
// (generateCourseAudioFn) only after the user approves.
// ─────────────────────────────────────────────────────────────────────────────

export const generateCourseSlidesFn = inngest.createFunction(
    {
        id: "generate-course-slides",
        // Primary trigger is `course/slides.generate`. The legacy
        // `course/video-content.generate` is kept as a second trigger so any
        // client still emitting the old event name (or an in-flight event from
        // before the split) is never silently dropped.
        triggers: [
            { event: "course/slides.generate" },
            { event: "course/video-content.generate" },
        ],
        // Each chapter runs as its own isolated event — no concurrency conflicts between chapters
        concurrency: [
            { limit: 2 },  // max 2 chapters generating in parallel globally
        ],
    },
    async ({ event, step }) => {
        const { chapter, courseId, courseName, chapterIndex } = event.data as {
            chapter: any; courseId: string; courseName: string; chapterIndex: number;
        };

        const TAG = `[Ch${chapterIndex + 1}]`;
        const chapterId = chapter.chapterId;
        console.log(`\n🎬 ${TAG} SLIDES: ${courseId} — ${chapter.chapterTitle}`);

        // ── Helper: upsert status row ────────────────────────────────────────
        const upsertStatus = makeUpsertStatus(courseId, chapterId);

        // ── Step 0: Check if already complete ────────────────────────────────
        const existingSlides = await step.run("check-existing-slides", async () => {
            return await db.select().from(chapterContentSlides).where(eq(chapterContentSlides.chapterId, chapterId));
        });

        // Dynamic slide count: each subContent point becomes 1-3 slide-sized
        // topics depending on how much depth it needs (capped at
        // MAX_SLIDES_PER_CHAPTER total), instead of the old fixed 1:1 mapping.
        // Chapters that already have slides in the DB (partial/complete from a
        // prior run) keep their original 1:1 mapping so slideIndex continuity
        // with existing rows isn't broken — only fresh chapters get expansion.
        const rawSubContent: string[] = chapter.subContent?.slice(0, MAX_SLIDES_PER_CHAPTER) || [chapter.chapterTitle];
        // Reuse the CANONICAL expansion the images function persisted (coursesTable
        // .slideTopics[chapterId]) so the slide↔image globalIdx mapping is EXACT —
        // both functions must produce the identical slide-topic list. Order of
        // preference: (1) existing DB slides keep their 1:1 mapping; (2) the persisted
        // shared expansion; (3) a fresh expansion (older courses / images not run yet),
        // which we then persist so a later image pass can align to it.
        const persistedTopics = await step.run("load-persisted-slide-topics", async () => {
            const [course] = await db.select({ slideTopics: coursesTable.slideTopics })
                .from(coursesTable).where(eq(coursesTable.courseId, courseId));
            const map = (course?.slideTopics as Record<string, ChapterTopic[]>) ?? {};
            const t = map[chapterId];
            return Array.isArray(t) && t.length > 0 ? t : null;
        });
        let chapterTopics: ChapterTopic[];
        if (existingSlides.length > 0) {
            chapterTopics = rawSubContent.map(topic => ({ topic, needsCode: isLikelyCodeTopic(topic) }));
        } else if (persistedTopics) {
            console.log(`📎 ${TAG} Reusing persisted slide-topic expansion (${persistedTopics.length} topics) — image mapping will be exact`);
            chapterTopics = persistedTopics;
        } else {
            chapterTopics = await step.run("expand-chapter-topics", () => expandChapterTopics(chapter.chapterTitle, rawSubContent));
            // Persist so a subsequent image run aligns to the SAME expansion.
            await step.run("persist-slide-topics-from-slides", async () => {
                const [course] = await db.select({ slideTopics: coursesTable.slideTopics })
                    .from(coursesTable).where(eq(coursesTable.courseId, courseId));
                const map = (course?.slideTopics as Record<string, ChapterTopic[]>) ?? {};
                if (!map[chapterId]) {
                    map[chapterId] = chapterTopics;
                    await db.update(coursesTable).set({ slideTopics: map })
                        .where(eq(coursesTable.courseId, courseId));
                }
                return { persisted: true };
            });
        }
        const subTopics = chapterTopics.map(t => t.topic);
        const totalSlides = subTopics.length;

        // If audio already exists for every slide, the chapter is fully done.
        const isChapterComplete = existingSlides.length >= totalSlides && existingSlides.every(s => s.audioUrl);
        if (isChapterComplete) {
            console.log(`✅ ${TAG} Chapter already fully complete with ${existingSlides.length} slides — skipping`);
            await upsertStatus({
                status: "completed",
                slidesComplete: existingSlides.length,
                slidesTotal: totalSlides,
                audioComplete: existingSlides.length,
                completedAt: new Date(),
            });
            return { skipped: true, slides: existingSlides };
        }

        // ── Mark as generating:slides ─────────────────────────────────────────
        const existingSlideCount = existingSlides.filter(s => s.html).length;
        const existingAudioCount = existingSlides.filter(s => s.audioUrl).length;
        await step.run("mark-generating-slides", async () => {
            await upsertStatus({
                status: "generating:slides",
                slidesTotal: totalSlides,
                slidesComplete: existingSlideCount,
                audioComplete: existingAudioCount,
                startedAt: new Date(),
                completedAt: null,
                errorMessage: null,
            });
        });

        // Load all course images for placeholder injection
        const allImages = await step.run("load-course-images", async () => {
            const imgs = await db.select().from(courseImages).where(eq(courseImages.courseId, courseId));
            imgs.sort((a, b) => a.imageIndex - b.imageIndex);
            return imgs;
        });

        // ── Phase 1: Generate slide CONTENT (HTML + narration) ────────────────
        const slidesData: any[] = [];

        for (let si = 0; si < totalSlides; si++) {
            const slideResult = await step.run(`generate-slide-${si}`, async () => {
                // Check if database already has this slide
                // Check if database already has this slide
                const existing = existingSlides.find(s => s.slideIndex === si + 1);
                if (existing) {
                    // Re-inject image URLs in case this slide was saved BEFORE
                    // course images were generated (placeholder tokens remain).
                    let existingHtml = existing.html ?? null;
                    if (existingHtml && allImages.length > 0 && existingHtml.includes('{{IMAGE_PLACEHOLDER}}')) {
                        // Each slide maps to its own image by global index (chapterIndex*15 + si).
                        const gIdx = chapterIndex * MAX_SLIDES_PER_CHAPTER + si;
                        let extra = 0;
                        existingHtml = existingHtml.replace(/\{\{IMAGE_PLACEHOLDER\}\}/g, () => {
                            const url = allImages.find(im => im.imageIndex === gIdx)?.imageUrl
                                ?? allImages[(gIdx + extra++) % allImages.length].imageUrl;
                            return url;
                        });
                        await db.update(chapterContentSlides)
                            .set({ html: existingHtml })
                            .where(eq(chapterContentSlides.slideId, existing.slideId));
                        console.log(`Image injected into slide ${si + 1} HTML & saved`);
                    }
                    console.log(`Slide ${si + 1}/${totalSlides} - reusing from database`);
                    return {
                        slideId: existing.slideId,
                        slideIndex: existing.slideIndex,
                        narration: existing.narration,
                        html: existingHtml,
                        revealData: existing.revealData,
                        audioUrl: existing.audioUrl,
                        captions: existing.captions,
                        audioDuration: existing.audioDuration,
                        // Not persisted in the DB — best-effort approximation for
                        // usedComponents tracking on a resumed run (see below).
                        archetype: pickArchetype(chapterIndex, si),
                    };
                }

                // Generate slide content via OpenRouter
                console.log(`Slide ${si + 1}/${totalSlides} - generating via OpenRouter...`);
                const previousContext = slidesData.map((s, idx) => ({
                    slideIndex: idx + 1,
                    topic: subTopics[idx],
                    keyConceptsCovered: extractKeyConcepts(s.narration?.fullText ?? ""),
                    narrationSummary: (s.narration?.fullText ?? "").substring(0, 600) + "...",
                }));

                // ── Tavily RAG: crawl the live web for accurate, up-to-date facts on
                // this slide's topic, and feed a compact context into the prompt so the
                // narration + on-screen content is grounded, not hallucinated. Non-fatal.
                const researchContext = await fetchSlideResearch(
                    subTopics[si],
                    `${courseName} · ${chapter.chapterTitle}`,
                );

                // ── Assign the EXACT primary component for this slide + forbid repeats ──
                // Topic-aware override with a CHAPTER CODE BUDGET: if THIS slide's
                // topic actually needs a code example, force a code archetype — BUT
                // only while the chapter is still under its code budget (~40% of
                // slides). Once the budget is spent, we stop forcing code and swap in
                // a non-code archetype for variety, so a programming chapter no longer
                // collapses into wall-to-wall code cards. Conversely, if the natural
                // rotation lands on code while we're over budget, we swap it out too.
                const naturalArchetype = pickArchetype(chapterIndex, si);
                const wantsCode = chapterTopics[si]?.needsCode ?? false;
                // How many code slides THIS chapter has actually produced so far.
                const codeSlidesSoFar = slidesData.filter(s => isCodeArchetype(s.archetype ?? "")).length;
                const codeBudget = codeSlideBudget(totalSlides);
                const codeBudgetLeft = codeSlidesSoFar < codeBudget;

                let archetype = naturalArchetype;
                if (wantsCode && codeBudgetLeft && !isCodeArchetype(naturalArchetype)) {
                    // Force a code archetype — rotate across the code family (plain
                    // CODE SNIPPET + the mixed CODE+X variants) so consecutive code
                    // slides look distinct instead of identical.
                    const codeArchetypes = SLIDE_ARCHETYPES.filter(isCodeArchetype);
                    archetype = codeArchetypes[codeSlidesSoFar % codeArchetypes.length] ?? naturalArchetype;
                } else if (isCodeArchetype(naturalArchetype) && (!wantsCode || !codeBudgetLeft)) {
                    // Natural rotation landed on code but this topic doesn't need it,
                    // or the chapter is out of code budget → swap to a non-code layout.
                    archetype = pickNonCodeArchetype(chapterIndex, si);
                }
                const primaryComponent = componentName(archetype);           // e.g. "CODE SNIPPET"
                const isCodeSlide = isCodeArchetype(archetype);
                const isCodeCompanion = isCodeCompanionArchetype(archetype);  // code + a companion component
                // Components ACTUALLY used by earlier slides in THIS chapter (not the
                // natural rotation — a prior slide may itself have been code-overridden)
                // — the model must not fall back onto any of them again. Code archetypes
                // are exempt: a programming chapter legitimately needs several code
                // slides, and forcing visual variety there fights that goal.
                const usedComponents = Array.from(
                    new Set(
                        slidesData
                            .map(s => componentName(s.archetype ?? ""))
                            .filter(c => c && !isCodeArchetype(c))
                    )
                );

                const slideInput = JSON.stringify({
                    chapterTitle: chapter.chapterTitle,
                    chapterOverview: chapter.chapterDescription ?? `This chapter covers ${chapter.chapterTitle} comprehensively.`,
                    chapterIndex: chapterIndex + 1,
                    fullChapterOutline: subTopics.map((t: string, i: number) => `Slide ${i + 1}: ${t}`),
                    slideTopic: subTopics[si],
                    slideIndex: si + 1,
                    totalSlides,
                    slidePosition: si === 0 ? "INTRO" : si === totalSlides - 1 ? "CONCLUSION" : "MIDDLE",
                    previousSlidesContext: previousContext,
                    conceptsAlreadyCovered: previousContext.flatMap(p => p.keyConceptsCovered),
                    nextSlideTopic: si + 1 < totalSlides ? subTopics[si + 1] : null,
                    // 🎯 HARD COMMAND — the model MUST build exactly this component.
                    mandatoryComponent: primaryComponent,
                    mandatoryComponentSpec: archetype,
                    doNotReuseComponents: usedComponents,
                    // Code slides must be a real .code-card and MUST NOT contain an image.
                    isCodeSlide,
                    imageAllowed: !isCodeSlide,
                    researchContext: researchContext || null,
                    designHint: `🎯 BUILD THIS EXACT COMPONENT (non-negotiable): ${archetype}. `
                        + `Do NOT substitute a table/diff/tiles or any of these already-used layouts: [${usedComponents.join(", ") || "none yet"}]. `
                        + (isCodeCompanion
                            ? `This is a 2-COLUMN slide: a syntax-highlighted .code-card (header + <pre><code>, real line breaks, a REAL COMPLETE working snippet up to ~20 lines — it auto-scrolls, so never fake-truncate with "// rest omitted" or "...") on ONE side, and a COMPANION component on the OTHER side. Do NOT default to numbered callouts every time — choose the companion that BEST fits this code from the catalog (numbered stepper, definition/callout cards, a metric row, a mini comparison table, concept-vs-example, a feature list, a small chip cloud). The code and the companion are the ONLY two blocks. 🔴 The companion MUST BE DENSE: 3-4 items, and EACH item = a bold title + a real one-line detail (8-14 words) that teaches — NEVER lone 2-word labels. NEVER an image of code, NEVER code in a <table> cell. Do NOT output {{IMAGE_PLACEHOLDER}} or any <img> on this slide. `
                            : isCodeSlide
                            ? `This slide's topic genuinely needs a real code example. The ENTIRE body is ONE syntax-highlighted .code-card (header + <pre><code>, real line breaks preserved) — NEVER inline text, NEVER a <table> cell, NEVER an image of code. Write a REAL, COMPLETE, working snippet (up to ~50 lines) — it auto-scrolls in sync with narration, so never fake-truncate with "// rest omitted" or "...". Do NOT output {{IMAGE_PLACEHOLDER}} or any <img> on this slide. `
                            : `Include ONE {{IMAGE_PLACEHOLDER}} where it genuinely helps, kept SMALL (~28-30% side column, max-height 300px) so it never crowds out real content — or skip it entirely if this component doesn't need one. `)
                        + `🔴 DENSITY: every item in the component (row / card / step / callout / metric / node) MUST carry a bold title PLUS a real one-line detail (8-14 words) that teaches — bare 2-3 word labels are a FAILED slide. `
                        + `Type pairing: ${SLIDE_TYPE_PAIRS[(chapterIndex + si) % SLIDE_TYPE_PAIRS.length]}. Accent color: ${SLIDE_ACCENTS[(chapterIndex * 2 + si) % SLIDE_ACCENTS.length]}. Make this slide look clearly different from the previous one (except code slides, which may share a look with earlier code slides in this chapter).`,
                });

                let slideContent: any = null;
                let slideError: any = null;
                const MAX_RETRIES = 3;
                // Slide generation ONLY: use gpt-oss-120b as primary instead of
                // GLM-5.2. GLM's default "thinking" mode made a single slide take
                // ~5 min (Vercel 300s timeout); gpt-oss-120b returns the same-sized
                // slide much faster. openrouter.json still auto-falls back to the
                // configured fallback models on failure. (Topic expansion + all
                // other calls keep GLM-5.2 — this change is scoped to slides.)
                const MODEL = "openai/gpt-oss-120b";
                for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
                    try {
                        console.log(`🎬 ${TAG} Slide ${si + 1}/${totalSlides} via ${MODEL} (attempt ${attempt}/${MAX_RETRIES})...`);
                        slideContent = await openrouter.json(GENERATE_SINGLE_SLIDE_PROMPT, slideInput, { model: MODEL, temperature: 0.75, maxTokens: 12000 });
                        if (Array.isArray(slideContent)) slideContent = slideContent[0];
                        break;
                    } catch (e: any) {
                        console.warn(`⚠️ ${TAG} ${MODEL} slide ${si + 1} attempt ${attempt}: ${e.message?.substring(0, 120)}`);
                        slideError = e;
                        if (attempt < MAX_RETRIES) {
                            console.log(`🔄 ${TAG} Retrying slide ${si + 1} in 3s...`);
                            await new Promise(r => setTimeout(r, 3000));
                        }
                    }
                }

                if (!slideContent) {
                    throw new Error(`${TAG} Failed to generate slide ${si + 1}: ${slideError?.message}`);
                }

                slideContent.slideIndex = si + 1;
                slideContent.slideId = slideContent.slideId || `${chapterId}-slide-${si + 1}`;
                slideContent.archetype = archetype;

                // Inject image URLs into placeholders — each slide gets its OWN image (global index).
                if (slideContent.html && allImages.length > 0) {
                    const gIdx = chapterIndex * MAX_SLIDES_PER_CHAPTER + si;
                    let extra = 0;
                    slideContent.html = slideContent.html.replace(/\{\{IMAGE_PLACEHOLDER\}\}/g, () => {
                        const url = allImages.find(im => im.imageIndex === gIdx)?.imageUrl
                            ?? allImages[(gIdx + extra++) % allImages.length].imageUrl;
                        return url;
                    });
                }

                // Save slide content to DB immediately (audioUrl stays null until TTS runs)
                const revealData = slideContent.fragmentData ?? slideContent.revealData ?? [];
                await db.insert(chapterContentSlides).values({
                    courseId,
                    chapterId,
                    slideId: slideContent.slideId,
                    slideIndex: si + 1,
                    narration: slideContent.narration,
                    html: slideContent.html ?? null,
                    revealData,
                    audioUrl: null,
                    captions: null,
                    audioDuration: null,
                }).onConflictDoUpdate({
                    target: chapterContentSlides.slideId,
                    set: { narration: slideContent.narration, html: slideContent.html ?? null, revealData },
                });

                // Update slides progress counter
                await upsertStatus({
                    status: "generating:slides",
                    slidesTotal: totalSlides,
                    slidesComplete: si + 1,
                    audioComplete: existingAudioCount,
                });

                console.log(`💾 ${TAG} Slide ${si + 1}/${totalSlides} content saved to database ✅`);
                return slideContent;
            });

            slidesData.push(slideResult);
        }

        if (!slidesData?.length) {
            await upsertStatus({ status: "failed", errorMessage: `No slides generated for chapter ${chapterId}` });
            throw new Error(`${TAG} No slides generated`);
        }

        console.log(`✅ ${TAG} All ${slidesData.length} slide contents ready. Parking at review gate...`);

        // ── Final image injection pass (race condition guard) ─────────────────
        // Images may have become available AFTER slide generation started.
        // Re-load from DB and inject into any slides still holding placeholder tokens.
        await step.run("slides-image-injection", async () => {
            const finalImages = await db.select().from(courseImages)
                .where(eq(courseImages.courseId, courseId));
            if (finalImages.length === 0) {
                console.log(`⚠️ ${TAG} No course images found for injection — placeholders remain`);
                return { injected: 0 };
            }
            finalImages.sort((a, b) => a.imageIndex - b.imageIndex);

            const chapterSlides = await db.select().from(chapterContentSlides)
                .where(eq(chapterContentSlides.chapterId, chapterId));

            let injected = 0;
            for (const slide of chapterSlides) {
                if (!slide.html || !slide.html.includes('{{IMAGE_PLACEHOLDER}}')) continue;
                const slideNum = (slide.slideIndex ?? 1) - 1;
                const gIdx = chapterIndex * MAX_SLIDES_PER_CHAPTER + slideNum;
                let extra = 0;
                const newHtml = slide.html.replace(/\{\{IMAGE_PLACEHOLDER\}\}/g, () => {
                    const url = finalImages.find(im => im.imageIndex === gIdx)?.imageUrl
                        ?? finalImages[(gIdx + extra++) % finalImages.length].imageUrl;
                    return url;
                });
                await db.update(chapterContentSlides)
                    .set({ html: newHtml })
                    .where(eq(chapterContentSlides.slideId, slide.slideId));
                injected++;
            }

            console.log(`🖼️ ${TAG} Slide injection: ${injected} slides had placeholders replaced`);
            return { injected };
        });

        // ── Park at review gate ───────────────────────────────────────────────
        // Slides + narration are ready. Audio (TTS) is NOT generated yet — the
        // user reviews & approves in the Studio cockpit, which then fires
        // `course/audio.generate` to run generateCourseAudioFn.
        await step.run("mark-review-slides", async () => {
            await upsertStatus({
                status: "review:slides",
                slidesTotal: totalSlides,
                slidesComplete: totalSlides,
                audioComplete: existingAudioCount,
                completedAt: null,
                errorMessage: null,
            });
        });

        console.log(`🟣 ${TAG} Chapter ${chapterIndex + 1} SLIDES READY for review: ${slidesData.length} slides`);
        return { slides: slidesData, chapterId, courseId, chapterIndex, review: true };
    }
);

// ─────────────────────────────────────────────────────────────────────────────
// FUNCTION 4 — Generate Course AUDIO (Phase 2: TTS + captions → Appwrite)
// ─────────────────────────────────────────────────────────────────────────────
// Runs ONLY after the user approves the reviewed slides + narration. Loads the
// (possibly user-edited) slides from the DB, synthesises narration audio via
// Sarvam (sticky key rotation), and marks the chapter `completed`.
// ─────────────────────────────────────────────────────────────────────────────

export const generateCourseAudioFn = inngest.createFunction(
    {
        id: "generate-course-audio",
        triggers: [{ event: "course/audio.generate" }],
        concurrency: [
            { limit: 2 },
        ],
    },
    async ({ event, step }) => {
        const { chapter, courseId, courseName, chapterIndex } = event.data as {
            chapter: any; courseId: string; courseName: string; chapterIndex: number;
        };

        const TAG = `[Ch${chapterIndex + 1}]`;
        const chapterId = chapter.chapterId;
        console.log(`\n🔊 ${TAG} AUDIO: ${courseId} — ${chapter.chapterTitle}`);

        const upsertStatus = makeUpsertStatus(courseId, chapterId);

        // ── Load the reviewed slides from DB (Phase 1 already persisted them) ──
        const slidesData = await step.run("load-reviewed-slides", async () => {
            const rows = await db.select().from(chapterContentSlides)
                .where(eq(chapterContentSlides.chapterId, chapterId));
            rows.sort((a, b) => (a.slideIndex ?? 0) - (b.slideIndex ?? 0));
            return rows;
        });

        if (!slidesData?.length) {
            await upsertStatus({ status: "failed", errorMessage: `No slides to narrate for chapter ${chapterId}` });
            throw new Error(`${TAG} No slides found for audio generation`);
        }

        const totalSlides = slidesData.length;
        const existingAudioCount = slidesData.filter(s => s.audioUrl).length;

        // ── Mark as generating:audio ─────────────────────────────────────────
        await step.run("mark-generating-audio", async () => {
            await upsertStatus({
                status: "generating:audio",
                slidesTotal: totalSlides,
                slidesComplete: totalSlides,
                audioComplete: existingAudioCount,
                startedAt: new Date(),
                completedAt: null,
                errorMessage: null,
            });
        });

        // Narrator voice chosen at course creation (falls back to the default speaker).
        const courseVoice = await step.run("load-course-voice", async () => {
            const [row] = await db.select({ voice: coursesTable.voice })
                .from(coursesTable).where(eq(coursesTable.courseId, courseId));
            return row?.voice || "kabir";
        });

        const insertedSlides: any[] = [];
        let audioCompleteCount = Math.min(existingAudioCount, totalSlides);

        for (let i = 0; i < slidesData.length; i++) {
            const slide = slidesData[i];
            const narrationText = (slide.narration as any)?.fullText;
            if (!narrationText) {
                console.warn(`⚠️ ${TAG} Slide ${i + 1} no narration — skipping`);
                continue;
            }

            const result = await step.run(`process-slide-${i}`, async () => {
                // Fast-path: audio already generated (in a previous partial run)
                if (slide.audioUrl && slide.captions && slide.audioDuration) {
                    console.log(`✅ ${TAG} Slide ${i + 1}/${slidesData.length} audio already exists — reusing`);
                    return slide;
                }

                const narration = narrationText;
                console.log(`🎤 ${TAG} Slide ${i + 1}/${slidesData.length}: TTS for ${narration.length} chars`);

                // TTS → MP3 buffer
                const audioBuffer = await generateTTSAudio(narration, "en-IN", courseVoice);
                const audioDuration = getMp3Duration(audioBuffer);
                console.log(`✅ ${TAG} Slide ${i + 1} TTS: ${audioBuffer.length} bytes, ${audioDuration.toFixed(2)}s`);

                // Upload MP3 → Appwrite
                const slideKey = slide.slideId || `slide-${i}`;
                const { url: audioUrl } = await putWithRotation(
                    `course-audio/${courseId}/${chapterId}/${slideKey}.mp3`,
                    audioBuffer,
                    { access: "public", contentType: "audio/mpeg" }
                );
                console.log(`☁️  ${TAG} Slide ${i + 1} Audio → Appwrite: ${audioUrl}`);

                // ⚡ Instant captions from narration — replaces slow Sarvam batch STT job
                const captions = generateCaptionsFromNarration(narration, audioDuration, "en-IN");
                // Per-fragment timeline (which on-screen fragment is spoken when) —
                // drives the render camera director. Proportional to each fragment's
                // word share of the audio; instant, no STT.
                const fragmentTimeline = buildFragmentTimeline((slide.narration as any)?.fragments, audioDuration);
                if (fragmentTimeline.length) {
                    captions.fragmentTimeline = fragmentTimeline;
                    console.log(`🎥 ${TAG} Slide ${i + 1} fragment timeline: ${fragmentTimeline.length} windows`);
                }
                console.log(`🎬 ${TAG} Slide ${i + 1} Captions: ${captions.chunks?.length ?? 0} chunks`);

                // Persist to DB
                const revealData = slide.revealData ?? [];
                const [inserted] = await db.insert(chapterContentSlides).values({
                    courseId, chapterId,
                    slideId: slideKey,
                    slideIndex: slide.slideIndex ?? i,
                    audioUrl, audioDuration,
                    narration: slide.narration,
                    captions,
                    html: slide.html ?? null,
                    revealData,
                }).onConflictDoUpdate({
                    target: chapterContentSlides.slideId,
                    set: { audioUrl, audioDuration, captions, slideIndex: slide.slideIndex ?? i },
                }).returning();

                console.log(`💾 ${TAG} Slide ${i + 1}/${slidesData.length} fully saved with audio ✅`);
                return inserted;
            });

            if (result) {
                insertedSlides.push(result);
                const isNewlyProcessed = result.audioUrl && !slidesData[i]?.audioUrl;
                if (isNewlyProcessed) audioCompleteCount = Math.min(totalSlides, audioCompleteCount + 1);
            }

            // Consolidate status updates to keep progress tracking elegant
            await step.run(`update-audio-progress-${i}`, async () => {
                await upsertStatus({
                    status: "generating:audio",
                    slidesTotal: totalSlides,
                    slidesComplete: totalSlides,
                    audioComplete: audioCompleteCount,
                });
            });
        }

        // ── Mark as completed ────────────────────────────────────────────────────────
        await step.run("mark-completed", async () => {
            await upsertStatus({
                status: "completed",
                slidesTotal: totalSlides,
                slidesComplete: totalSlides,
                audioComplete: insertedSlides.length,
                completedAt: new Date(),
                errorMessage: null,
            });
        });

        console.log(`🎉 ${TAG} Chapter ${chapterIndex + 1} COMPLETE: ${insertedSlides.length}/${slidesData.length} slides done`);
        return { slides: insertedSlides, chapterId, courseId, chapterIndex };
    }
);