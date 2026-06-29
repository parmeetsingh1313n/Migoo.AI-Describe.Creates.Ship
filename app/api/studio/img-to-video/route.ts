import { groq } from "@/config/groq";
import { generateApifyVideoSync } from "@/lib/apify-video";
import { NextRequest, NextResponse } from "next/server";
import * as zlib from "node:zlib";

// ─── Constants ────────────────────────────────────────────────────────────────
const SARVAM_BASE = "https://api.sarvam.ai";

// ─── Key helpers ──────────────────────────────────────────────────────────────
function getSarvamKeys(): string[] {
    const keys: string[] = [];
    const primary = process.env.SARVAM_API_KEY;
    if (primary) keys.push(primary);
    for (let i = 2; i <= 10; i++) {
        const k = process.env[`SARVAM_API_KEY_${i}`];
        if (k) keys.push(k);
        else break;
    }
    return keys;
}

function isSarvamCreditExhausted(errMsg: string): boolean {
    return errMsg.includes("Insufficient credits") ||
           errMsg.includes("insufficient_credits") ||
           errMsg.includes("add more credits") ||
           errMsg.includes("400") ||
           errMsg.includes("402");
}

// ─── Minimal ZIP creator (single file, no compression) ────────────────────────
function crc32(buf: Buffer): number {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        table[i] = c;
    }
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xFF];
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

function createSingleFileZip(filename: string, data: Buffer): Buffer {
    const name    = Buffer.from(filename, "utf8");
    const crc     = crc32(data);
    const size    = data.length;
    const now     = new Date();
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

    // Local file header (30 + name)
    const lh = Buffer.alloc(30 + name.length);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6); lh.writeUInt16LE(0, 8);
    lh.writeUInt16LE(dosTime, 10); lh.writeUInt16LE(dosDate, 12);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(size, 18); lh.writeUInt32LE(size, 22);
    lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    name.copy(lh, 30);

    // Central directory (46 + name)
    const cd = Buffer.alloc(46 + name.length);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(0, 10); cd.writeUInt16LE(dosTime, 12); cd.writeUInt16LE(dosDate, 14);
    cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(size, 20); cd.writeUInt32LE(size, 24);
    cd.writeUInt16LE(name.length, 28); cd.writeUInt16LE(0, 30); cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34); cd.writeUInt16LE(0, 36); cd.writeUInt32LE(0, 38); cd.writeUInt32LE(0, 42);
    name.copy(cd, 46);

    // End of central directory (22)
    const ecd = Buffer.alloc(22);
    ecd.writeUInt32LE(0x06054b50, 0);
    ecd.writeUInt16LE(0, 4); ecd.writeUInt16LE(0, 6);
    ecd.writeUInt16LE(1, 8); ecd.writeUInt16LE(1, 10);
    ecd.writeUInt32LE(cd.length, 12);
    ecd.writeUInt32LE(lh.length + data.length, 16);
    ecd.writeUInt16LE(0, 20);

    return Buffer.concat([lh, data, cd, ecd]);
}

/** Extract first file from a ZIP buffer (handles stored + deflate) */
function extractFirstFileFromZip(zipBuf: Buffer): string {
    let offset = 0;
    while (offset < zipBuf.length - 4 && zipBuf.readUInt32LE(offset) !== 0x04034b50) offset++;
    if (offset >= zipBuf.length - 30) return "";
    const compression    = zipBuf.readUInt16LE(offset + 8);
    const compressedSize = zipBuf.readUInt32LE(offset + 18);
    const filenameLen    = zipBuf.readUInt16LE(offset + 26);
    const extraLen       = zipBuf.readUInt16LE(offset + 28);
    const dataStart      = offset + 30 + filenameLen + extraLen;
    const fileData       = zipBuf.slice(dataStart, dataStart + compressedSize);
    try {
        return compression === 8
            ? zlib.inflateRawSync(fileData).toString("utf-8")
            : fileData.toString("utf-8");
    } catch { return fileData.toString("utf-8"); }
}

// ─── Step 1a: Sarvam Vision (image caption) ───────────────────────────────────
async function captionWithSarvam(imgBuf: Buffer, contentType: string): Promise<string> {
    const keys = getSarvamKeys();
    if (keys.length === 0) throw new Error("No SARVAM_API_KEY configured");

    const ext         = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
    const imgFilename = `image.${ext}`;
    const zipFilename = "image.zip";
    const zipBuf      = createSingleFileZip(imgFilename, imgBuf);

    for (let ki = 0; ki < keys.length; ki++) {
        const key = keys[ki];
        const keyTag = keys.length > 1 ? ` [key_${ki + 1}/${keys.length}]` : "";
        const headers = { "api-subscription-key": key, "Content-Type": "application/json" };

        try {
            // 1. Create job
            const createRes = await fetch(`${SARVAM_BASE}/doc-digitization/job/v1`, {
                method: "POST", headers,
                body: JSON.stringify({ job_parameters: { language: "en-IN", output_format: "md" } }),
            });
            if (!createRes.ok) throw new Error(`Sarvam create job failed (${createRes.status}): ${await createRes.text()}`);
            const { job_id } = await createRes.json();
            console.log(`📄 [img-to-video]${keyTag} Sarvam job created: ${job_id}`);

            // 2. Get presigned upload URL
            const uploadUrlRes = await fetch(`${SARVAM_BASE}/doc-digitization/job/v1/upload-files`, {
                method: "POST", headers,
                body: JSON.stringify({ job_id, files: [zipFilename] }),
            });
            if (!uploadUrlRes.ok) throw new Error(`Sarvam upload-files failed (${uploadUrlRes.status}): ${await uploadUrlRes.text()}`);
            const uploadData = await uploadUrlRes.json();
            const fileUrlDetails = uploadData?.upload_urls?.[zipFilename];
            const fileUrl        = fileUrlDetails?.file_url;
            if (!fileUrl) throw new Error("No upload URL from Sarvam");

            // 3. PUT ZIP to the presigned URL
            const storageType: string = (uploadData?.storage_container_type ||"").toLowerCase();
            const isAzure = storageType.startsWith("azure") || fileUrl.includes(".blob.core.windows.net");

            const extraHeaders: Record<string, string> = {};
            const fileMeta = fileUrlDetails?.file_metadata;
            if (fileMeta && typeof fileMeta === "object") {
                for (const [k, v] of Object.entries(fileMeta)) {
                    if (typeof v === "string") extraHeaders[k] = v;
                }
            }

            const putHeaders: Record<string, string> = {
                "Content-Type": "application/zip",
                ...extraHeaders,
                ...(isAzure ? { "x-ms-blob-type": "BlockBlob" } : {}),
            };

            console.log(`☁️ [img-to-video]${keyTag} Storage: ${storageType || "unknown"}, Azure: ${isAzure}`);

            const putRes = await fetch(fileUrl, { method: "PUT", headers: putHeaders, body: zipBuf as unknown as BodyInit });
            if (!putRes.ok && putRes.status !== 201 && putRes.status !== 200) {
                const errBody = await putRes.text().catch(() => "");
                throw new Error(`Sarvam ZIP upload failed (${putRes.status}): ${errBody.slice(0, 200)}`);
            }

            // 4. Start job
            const startRes = await fetch(`${SARVAM_BASE}/doc-digitization/job/v1/${job_id}/start`, {
                method: "POST", headers, body: "{}",
            });
            if (!startRes.ok) throw new Error(`Sarvam start failed (${startRes.status}): ${await startRes.text()}`);
            console.log(`🚀 [img-to-video]${keyTag} Sarvam job started`);

            // 5. Poll status (max 15 × 3s = 45s)
            let jobState = "Pending";
            for (let i = 0; i < 15; i++) {
                await new Promise(r => setTimeout(r, 3000));
                const statusRes = await fetch(`${SARVAM_BASE}/doc-digitization/job/v1/${job_id}/status`, {
                    headers: { "api-subscription-key": key },
                });
                if (!statusRes.ok) continue;
                const sd = await statusRes.json();
                jobState = sd.job_state;
                console.log(`⏳ [img-to-video]${keyTag} Sarvam poll ${i + 1}/15: ${jobState}`);
                if (jobState === "Completed" || jobState === "PartiallyCompleted") break;
                if (jobState === "Failed") throw new Error(`Sarvam job failed: ${sd.error_message}`);
            }
            if (jobState !== "Completed" && jobState !== "PartiallyCompleted") {
                throw new Error(`Sarvam timed out (state: ${jobState})`);
            }

            // 6. Get download URLs
            const dlRes = await fetch(`${SARVAM_BASE}/doc-digitization/job/v1/${job_id}/download-files`, {
                method: "POST", headers, body: "{}",
            });
            if (!dlRes.ok) throw new Error(`Sarvam download-files failed (${dlRes.status}): ${await dlRes.text()}`);
            const dlData        = await dlRes.json();
            const downloadUrls  = dlData?.download_urls || {};
            const firstKey      = Object.keys(downloadUrls)[0];
            if (!firstKey) throw new Error("No download URLs from Sarvam");

            // 7. Download output
            const dlFileUrl  = downloadUrls[firstKey]?.file_url || firstKey;
            const contentRes = await fetch(dlFileUrl);
            if (!contentRes.ok) throw new Error(`Sarvam output download failed: ${contentRes.status}`);
            const contentBuf = Buffer.from(await contentRes.arrayBuffer());

            let markdown = "";
            if (contentBuf[0] === 0x50 && contentBuf[1] === 0x4B) {
                markdown = extractFirstFileFromZip(contentBuf);
            } else {
                markdown = contentBuf.toString("utf-8");
            }

            const result = markdown.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 2000);
            console.log(`✅ [img-to-video]${keyTag} Sarvam caption: "${result.slice(0, 100)}..."`);
            return result;

        } catch (err: any) {
            if (isSarvamCreditExhausted(err.message) && ki < keys.length - 1) {
                console.warn(`⚠️ [img-to-video] key_${ki + 1} credit exhausted — rotating to key_${ki + 2}...`);
                continue;
            }
            throw err;
        }
    }

    throw new Error(`All ${keys.length} Sarvam key(s) exhausted for image captioning`);
}

// ─── Step 1b: Groq Vision (fallback caption) ──────────────────────────────────
async function captionWithGroq(imageUrl: string): Promise<string> {
    const prompt = `Analyze this image for VIDEO ANIMATION. Your goal is to identify every element that CAN MOVE.

For each element, output EXACTLY this format:
- [ELEMENT TYPE]: [what it is] → [how it could physically move]

Element types: PERSON, ANIMAL, PLANT, WATER, SKY, FABRIC, HAIR, OBJECT, LIGHT, PARTICLE

Examples:
- PERSON: woman in red dress → chest breathing, eyes blinking, head tilting slightly
- HAIR: long dark hair → strands drifting in breeze, catching light
- FABRIC: flowing silk dress → billowing gently, rippling at hem
- PLANT: palm trees in background → fronds swaying, leaves rustling
- WATER: ocean waves → rolling forward, foam spreading, reflections dancing
- LIGHT: golden sunset rays → beams shifting slowly, shadows lengthening
- PARTICLE: dust in sunlight → motes drifting lazily upward

IMPORTANT:
- Do NOT describe text, signs, labels, writing, watermarks — skip them entirely
- Focus ONLY on PHYSICAL elements that can exhibit motion
- Be specific about body parts, materials, and textures
- List at least 5-8 movable elements`;

    const caption = await groq.captionImage(imageUrl, prompt);
    console.log(`✅ [img-to-video] Groq vision caption: "${caption.slice(0, 100)}..."`);
    return caption;
}

// ─── Step 2: Groq → KINETIC Kling animation prompt ──────────────────────────
//
// CRITICAL DISCOVERY (from Leonardo API docs):
// The Kling 2.5 Turbo API via Leonardo ONLY supports these params:
//   prompt, imageId, imageType, resolution, height, width, duration, model, isPublic, endFrameImage
//
// negativePrompt, motionStrength, frameInterpolation → ALL SILENTLY IGNORED!
// The ONLY lever for controlling motion is the PROMPT TEXT itself.
//
// Therefore, the prompt must do ALL the heavy lifting:
//   1. NEVER describe what's IN the image (causes Ken Burns confirmation)
//   2. Use SPECIFIC KINETIC VERBS for each detected element
//   3. Describe SMALL, REALISTIC physical actions (not epic wind storms)
//   4. Use the "stationary camera" trick to force element-level animation
//   5. Embed anti-text instructions directly in the prompt
//

// ── Compact anti-text suffix (embedded in prompt since negativePrompt is ignored) ──
const ANTI_TEXT_SUFFIX = ". Absolutely no text, titles, words, writing, captions, labels, or overlays of any kind in any language.";

/** Detect what element categories exist in the caption for targeted motion */
function detectCategories(caption: string): string[] {
    const lower = caption.toLowerCase();
    const cats: string[] = [];
    
    // Person detection
    if (/\b(person|woman|man|girl|boy|child|people|face|eyes|hair|hand|body|chest|head|smile|expression|portrait|figure|human)\b/.test(lower)) cats.push('person');
    // Animal detection
    if (/\b(animal|dog|cat|bird|horse|fish|lion|tiger|elephant|deer|rabbit|insect|butterfly|eagle|whale|dolphin|creature|pet)\b/.test(lower)) cats.push('animal');
    // Water detection
    if (/\b(water|ocean|sea|river|lake|rain|wave|waterfall|pool|fountain|stream|pond|drops|splash|ripple|tide|surf)\b/.test(lower)) cats.push('water');
    // Plant/nature detection
    if (/\b(tree|plant|flower|grass|leaf|leaves|branch|forest|garden|bush|vine|petal|bloom|fern|palm|field|meadow)\b/.test(lower)) cats.push('plant');
    // Sky/weather detection
    if (/\b(sky|cloud|sun|moon|star|sunset|sunrise|storm|lightning|fog|mist|haze|aurora|rainbow)\b/.test(lower)) cats.push('sky');
    // Fabric/cloth detection
    if (/\b(fabric|cloth|dress|shirt|scarf|curtain|flag|banner|veil|silk|cotton|linen|sari|cape|cloak|robe|blanket|ribbon)\b/.test(lower)) cats.push('fabric');
    // Fire/smoke detection
    if (/\b(fire|flame|candle|smoke|steam|torch|bonfire|ember|spark|incense|lantern)\b/.test(lower)) cats.push('fire');
    // Architecture/building detection
    if (/\b(building|temple|tower|castle|bridge|monument|arch|column|dome|wall|gate|door|window|staircase|structure)\b/.test(lower)) cats.push('architecture');
    
    if (cats.length === 0) cats.push('general');
    return cats;
}

/** Build category-specific motion instructions */
function getCategoryMotions(categories: string[]): string {
    const motions: string[] = [];
    
    for (const cat of categories) {
        switch (cat) {
            case 'person':
                motions.push(
                    'The person breathes naturally with subtle chest rise and fall. ' +
                    'Eyes blink softly every few seconds with a wet gleam on the iris. ' +
                    'Head tilts slightly to one side. ' +
                    'Hair strands drift and sway gently with a light breeze. ' +
                    'Fingers make a tiny involuntary twitch.'
                );
                break;
            case 'animal':
                motions.push(
                    'The animal breathes with visible ribcage expansion. ' +
                    'Ears flick and rotate attentively. ' +
                    'Fur ripples in passing breeze. ' +
                    'Tail sways with slow pendulum motion. ' +
                    'Eyes track sideways with alert focus.'
                );
                break;
            case 'water':
                motions.push(
                    'Water surface ripples expand outward in concentric circles. ' +
                    'Reflections shimmer and distort with each wavelet. ' +
                    'Foam edges creep forward and recede rhythmically. ' +
                    'Light dances across the water surface in moving sparkles.'
                );
                break;
            case 'plant':
                motions.push(
                    'Leaves rustle and turn showing lighter undersides. ' +
                    'Branches bob gently up and down in breeze. ' +
                    'Flower petals tremble with microscopic vibrations. ' +
                    'Grass blades bend in rolling wave patterns across the field.'
                );
                break;
            case 'sky':
                motions.push(
                    'Clouds drift slowly across the sky, edges morphing and dissolving. ' +
                    'Light rays shift angle gradually, shadows rotate on the ground. ' +
                    'Atmospheric haze pulses subtly with warm air thermals.'
                );
                break;
            case 'fabric':
                motions.push(
                    'Fabric billows outward in a gentle gust then settles back. ' +
                    'Hem ripples propagate from left to right like a slow wave. ' +
                    'Folds shift and crease patterns change with the movement. ' +
                    'Loose threads and edges flutter continuously.'
                );
                break;
            case 'fire':
                motions.push(
                    'Flames dance and flicker with chaotic organic motion. ' +
                    'Embers drift upward in spiraling paths. ' +
                    'Smoke curls and billows, thinning as it rises. ' +
                    'Warm light pulses and casts shifting shadows on all surfaces.'
                );
                break;
            case 'architecture':
                motions.push(
                    'Light rays sweep slowly across stone surfaces. ' +
                    'Shadows crawl and lengthen as time passes. ' +
                    'Dust particles drift through shafts of light. ' +
                    'Atmospheric haze swirls gently around the structure.'
                );
                break;
            default:
                motions.push(
                    'All elements exhibit subtle natural motion. ' +
                    'Light shifts across surfaces, shadows rotate slowly. ' +
                    'Dust motes drift through visible light beams. ' +
                    'Ambient atmospheric particles swirl gently.'
                );
        }
    }
    return motions.join(' ');
}

async function buildKlingPrompt(caption: string, narration: string): Promise<string> {
    if (!caption) return buildFallbackPrompt(caption, narration);

    // Detect element categories from the caption for targeted motion instructions
    const categories = detectCategories(caption);
    const categoryList = categories.join(', ');
    
    const prompt = `You are a Kling 2.5 Turbo motion prompt engineer. An image is being converted to a 5-second video clip. The AI model ALREADY SEES the image perfectly — you must describe ONLY what MOVES and HOW.

## ABSOLUTE RULES (violating these produces Ken Burns pan/zoom instead of real animation)
1. NEVER describe what is in the image. The model sees it. Describing it causes static output.
2. EVERY sentence must start with a KINETIC VERB: breathes, blinks, sways, ripples, drifts, flickers, trembles, billows, pulses, twitches, rustles, crackles, flows, bounces, shimmers, curls
3. Describe SMALL, REALISTIC motions — not epic events. A slight head turn, not an earthquake.
4. Camera is COMPLETELY STATIONARY on a locked tripod. Zero camera movement.
5. NEVER mention: text, words, writing, titles, captions, labels, overlays

## MOTION INTENSITY GUIDE
- People: subtle breathing, slow eye blinks, micro-expressions, hair drifting
- Animals: ear flicks, fur rippling, tail sway, breathing
- Water: ripples expanding, reflections shimmering, foam advancing
- Plants: leaves turning, branches bobbing, petals trembling, grass waving  
- Sky: clouds drifting, light rays shifting angle, haze pulsing
- Fabric: billowing in breeze, hem rippling, folds shifting
- Fire: flames dancing, embers rising, smoke curling
- Architecture: shadows crawling, light sweeping across stone, dust drifting

## DETECTED CATEGORIES: ${categoryList}

## OUTPUT FORMAT
Write 60-90 words of PURE MOTION COMMANDS. Present tense, active voice.
Start with the most prominent moving element.
End with: "Stationary camera, locked tripod, zero camera movement."

IMAGE ANALYSIS:
${caption.slice(0, 800)}

Write kinetic motion commands NOW — ACTIONS ONLY, absolutely no scene description:`;

    try {
        let refined = await groq.text(
            'You are a Kling 2.5 Turbo motion prompt engineer. Output ONLY motion commands, no explanation.',
            prompt,
            { temperature: 0.6, maxTokens: 300 }
        );
        if (!refined || refined.length < 30) return buildFallbackPrompt(caption, narration);

        // Strip any scene-description phrases the model might have included
        refined = refined
            .replace(/\b(text|title|caption|subtitle|label|watermark|logo|word|letter|overlay|heading|banner|sign|writing|inscription|credit|quote|annotation|typography|font)[\w]*\b/gi, '')
            .replace(/\b(the image shows?|in the image|we can see|there is|there are|the scene depicts?|the photo shows?|this is a?|it shows?)\b/gi, '')
            .replace(/\b(a (photo|picture|image|painting|illustration|render) of)\b/gi, '')
            .replace(/\s+/g, ' ').trim();

        // Ensure stationary camera instruction is present
        if (!/(stationary|locked|fixed|tripod|zero camera|no camera)/i.test(refined)) {
            refined = refined.replace(/\.?\s*$/, '. Stationary camera, locked tripod, zero camera movement.');
        }

        const result = (refined + ANTI_TEXT_SUFFIX).slice(0, 800);
        console.log(`\u2705 [img-to-video] Kling prompt (${categories.join('+')}, ${result.length} chars): "${result.slice(0, 150)}..."`);
        return result;
    } catch {
        return buildFallbackPrompt(caption, narration);
    }
}

function buildFallbackPrompt(caption: string, _narration: string): string {
    // Detect categories from whatever caption we have for targeted motion
    const categories = caption ? detectCategories(caption) : ['general'];
    const categoryMotions = getCategoryMotions(categories);

    // Build a prompt using detected-category-specific motions, not generic wind storms.
    // The key insight: small realistic motions >> dramatic epic motions for Kling img2vid.
    const result = (
        categoryMotions + ' ' +
        'Ambient dust particles drift through visible light beams. ' +
        'Subtle atmospheric shimmer across all surfaces. ' +
        'Stationary camera, locked tripod, zero camera movement' +
        ANTI_TEXT_SUFFIX
    ).trim().slice(0, 800);
    
    console.log(`\u2705 [img-to-video] Fallback prompt (${categories.join('+')}, ${result.length} chars)`);
    return result;
}

// ─── Pollo Seedance 1.5 Pro — img-to-video ───────────────────────────────────
// generateSeedanceVideo (from lib/pollo-video.ts) handles:
//   1. Submitting the task to Pollo Seedance 1.5 Pro
//   2. Polling for completion
//   3. Downloading, FFmpeg-stretching, and uploading to Blob storage
// No local image upload or API key rotation needed — Seedance accepts direct URLs.

export async function processImgToVideo({ 
    imageUrl, 
    sceneNarration = "", 
    sceneIndex = 0, 
    duration = 5, 
    forceShorts = true 
}: { 
    imageUrl: string; 
    sceneNarration?: string; 
    sceneIndex?: number; 
    duration?: number; 
    forceShorts?: boolean 
}) {
    if (!imageUrl) throw new Error("imageUrl is required");

    const aspectRatio: "9:16" | "16:9" = forceShorts ? "9:16" : "16:9";
    console.log(`📱 [img-to-video] Pollo Seedance 1.5 Pro | Format: ${aspectRatio} | ${duration}s`);

    // ── Step 1: Download the image for captioning ──────────────────────────
    let imgBuf: Buffer | null = null;
    let contentType = "image/jpeg";
    try {
        const imgRes = await fetch(imageUrl, { signal: AbortSignal.timeout(60000) });
        if (imgRes.ok) {
            imgBuf      = Buffer.from(await imgRes.arrayBuffer());
            contentType = imgRes.headers.get("content-type") || "image/jpeg";
            if (!contentType.startsWith("image/")) contentType = "image/jpeg";
        }
    } catch (e) {
        console.warn("[img-to-video] Could not download image for captioning:", e);
    }

    // ── Step 2: Caption the image — Groq Vision first (fast), fallback Sarvam ──
    let caption = "";
    try {
        console.log("🔍 [img-to-video] Step 1: Groq Vision captioning...");
        caption = await captionWithGroq(imageUrl);
    } catch (groqErr: any) {
        console.warn(`⚠️ [img-to-video] Groq vision failed (${groqErr.message?.slice(0, 80)}), trying Sarvam...`);
        if (imgBuf) {
            try {
                caption = await captionWithSarvam(imgBuf, contentType);
            } catch (sarvamErr: any) {
                console.warn(`⚠️ [img-to-video] Sarvam also failed: ${sarvamErr.message?.slice(0, 80)}`);
            }
        }
    }

    // ── Step 3: Build Seedance motion prompt (reuse Groq prompt builder) ───
    console.log("✍️ [img-to-video] Step 2: Building Seedance motion prompt...");
    const motionPrompt = await buildKlingPrompt(caption, sceneNarration);
    console.log(`📝 [img-to-video] Final Seedance prompt: "${motionPrompt.slice(0, 120)}..."`);

    // ── Step 4: Apify Wan 2.2 Image-to-Video ──────────────────────────
    console.log(`🎬 [img-to-video] Step 3: Submitting to Apify Wan 2.2 actor...`);
    const videoUrl = await generateApifyVideoSync(
        imageUrl,
        motionPrompt,
        sceneIndex
    );

    console.log(`🎉 [img-to-video] Apify Wan 2.2 complete: ${videoUrl.slice(0, 80)}`);

    return {
        ok: true,
        videoUrl: videoUrl,
        durationSec: 5,
        isKlingFallback: false,
        isShorts: forceShorts,
    };
}

// ─── POST /api/studio/img-to-video ───────────────────────────────────────────
export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const result = await processImgToVideo(body);
        return NextResponse.json(result);
    } catch (err: any) {
        console.error("studio/img-to-video error:", err);
        return NextResponse.json({ error: err.message }, { status: err.message.includes('required') ? 400 : 500 });
    }
}
