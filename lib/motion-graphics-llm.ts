/**
 * @module motion-graphics-llm
 * @description OpenRouter LLM client dedicated to the Motion Graphics pipeline.
 *
 * Primary:  openai/gpt-oss-120b:free  (117B MoE, strong reasoning)
 * Fallback: nvidia/nemotron-3-ultra-550b-a55b:free (550B MoE, 1M ctx, agentic)
 *
 * NOTE: This file is intentionally separate from:
 *   - config/openrouter.ts  → used by the Course Slide generator (heavy JSON + HTML repair)
 *   - lib/shorts-llm.ts     → used by the Shorts script + image enrichment pipeline
 *
 * The Motion Graphics chat requires large JSON scene arrays and a clean,
 * HTML-attribute-safe output format. The client here is purpose-built for that.
 */

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1/chat/completions';

// ── Model priority ────────────────────────────────────────────────────────────
const MG_PRIMARY_MODEL     = 'openai/gpt-oss-120b:free';
const MG_FALLBACK_MODEL    = 'nvidia/nemotron-3-super-120b-a12b:free';
const MG_LAST_RESORT_MODEL = 'nvidia/nemotron-3-ultra-550b-a55b:free';
// Premium 120B model dedicated to cinematic voiceover rewriting
const MG_VOICEOVER_MODEL   = 'openai/gpt-oss-120b:free';

// ── Key rotation (in-process, shared across requests in this server session) ──
let _mgKeyIdx = 0;

function getMgKeys(): string[] {
    const keys: string[] = [];
    const base = process.env.OPENROUTER_API_KEY;
    if (base) keys.push(base);
    for (let i = 1; i <= 9; i++) {
        const k = process.env[`OPENROUTER_API_KEY${i}`];
        if (k) keys.push(k);
    }
    return keys;
}

function getMgKey(): string {
    const keys = getMgKeys();
    if (!keys.length) throw new Error('No OPENROUTER_API_KEY found in environment');
    _mgKeyIdx = _mgKeyIdx % keys.length;
    return keys[_mgKeyIdx];
}

function rotateMgKey(): void {
    const keys = getMgKeys();
    if (keys.length <= 1) return;
    _mgKeyIdx = (_mgKeyIdx + 1) % keys.length;
    console.log(`🔄 [mg-llm] key rotated → key${_mgKeyIdx + 1}/${keys.length}`);
}

// ── Core HTTP call ────────────────────────────────────────────────────────────

async function callMgModel(
    model: string,
    systemPrompt: string,
    userMessage: string,
    temperature: number,
    maxTokens: number,
    apiKey: string,
): Promise<{ rawText: string; finishReason?: string }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5 * 60 * 1000);

    const res = await fetch(OPENROUTER_BASE, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://ai-video-course-generator.vercel.app',
            'X-Title': 'Migoo AI Motion Graphics',
        },
        body: JSON.stringify({
            model,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user',   content: userMessage  },
            ],
            temperature,
            max_tokens: maxTokens,
        }),
        signal: controller.signal,
    });

    clearTimeout(timeout);

    if (res.status === 429 || res.status === 402) {
        const body = await res.text();
        console.warn(`⚠️ [mg-llm] rate/credit (${res.status}) on [${model}]: ${body.slice(0, 200)}`);
        const err: any = new Error(`RATE_LIMIT: ${model} (${res.status})`);
        err.isRateLimit = true;
        throw err;
    }

    if (res.status === 403) {
        const body = await res.text();
        console.warn(`⚠️ [mg-llm] moderation block (403) on [${model}]: ${body.slice(0, 200)} — skipping model.`);
        const err: any = new Error(`MODERATION_BLOCK: ${model} (403)`);
        err.isRateLimit = true;
        throw err;
    }

    if (!res.ok) {
        const body = await res.text();
        throw new Error(`[mg-llm] API error ${res.status}: ${body.slice(0, 300)}`);
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
        const err: any = new Error(`[mg-llm] empty choices from [${model}]`);
        err.isRateLimit = true;
        throw err;
    }

    const finishReason = data?.choices?.[0]?.finish_reason;
    console.log(`✅ [mg-llm] [${model}] responded (${content.length} chars, finish=${finishReason})`);

    // Free-tier models cap output tokens (nex-n2-pro:free ≈ 1000 tokens).
    // finish=length means JSON was cut off mid-string — throw so fallback runs.
    if (finishReason === 'length') {
        console.warn(`⚠️ [mg-llm] [${model}] truncated at ${content.length} chars (finish=length) — trying fallback model`);
        const err: any = new Error(`TRUNCATED: ${model} hit free-tier output token cap`);
        err.isRateLimit = true; // flag as retriable so tryMgModels moves to next model
        throw err;
    }

    return { rawText: content, finishReason };
}

// ── JSON extraction + repair ──────────────────────────────────────────────────

function extractMgJSON(raw: string): any {
    let s = raw.trim()
        .replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '')
        .replace(/<json>\s*/gi, '').replace(/\s*<\/json>/gi, '')
        .trim();

    const start = Math.min(
        s.includes('{') ? s.indexOf('{') : Infinity,
        s.includes('[') ? s.indexOf('[') : Infinity,
    );
    if (start === Infinity) throw new Error('[mg-llm] No JSON object/array in response');
    s = s.slice(start);

    // Strategy 1: direct parse
    try { return JSON.parse(s); } catch { /* next */ }

    // Strategy 2: remove trailing commas
    try { return JSON.parse(s.replace(/,(\s*[}\]])/g, '$1')); } catch { /* next */ }

    // Strategy 3: close open brackets
    const openBraces  = (s.match(/\{/g) || []).length - (s.match(/\}/g) || []).length;
    const openBrackets = (s.match(/\[/g) || []).length - (s.match(/\]/g) || []).length;
    const closed = s + '}'.repeat(Math.max(0, openBraces)) + ']'.repeat(Math.max(0, openBrackets));
    try { return JSON.parse(closed); } catch { /* next */ }

    // Strategy 4: escape literal newlines inside strings
    let repaired = '';
    let inStr = false;
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (c === '\\' && i + 1 < s.length) { repaired += c + s[++i]; continue; }
        if (c === '"') { inStr = !inStr; repaired += c; continue; }
        if (inStr && c === '\n') { repaired += '\\n'; continue; }
        if (inStr && c === '\r') { repaired += '\\r'; continue; }
        repaired += c;
    }

    // Strategy 5: close an unterminated string, then close open brackets.
    // Triggered when finish=length cuts the JSON mid-string-value.
    // Find the last safely-closable position: walk backwards from the end
    // to find the last complete value boundary (}: or ,\n or ]: ), close there.
    try {
        // Attempt: close the open string, then close brackets
        const withClosedString = repaired + '"';
        const closedAll = withClosedString + '}'.repeat(Math.max(0, openBraces)) + ']'.repeat(Math.max(0, openBrackets));
        try { return JSON.parse(closedAll); } catch { /* next approach */ }

        // Attempt: find last complete key-value pair boundary and truncate there
        // Look for the last occurrence of a closing brace/bracket before the truncation
        const candidates = ['}', ']'];
        for (const marker of candidates) {
            const lastIdx = repaired.lastIndexOf(marker);
            if (lastIdx > 0) {
                const truncated = repaired.slice(0, lastIdx + 1);
                const ob = (truncated.match(/\{/g) || []).length - (truncated.match(/\}/g) || []).length;
                const obr = (truncated.match(/\[/g) || []).length - (truncated.match(/\]/g) || []).length;
                const finalStr = truncated + '}'.repeat(Math.max(0, ob)) + ']'.repeat(Math.max(0, obr));
                try { return JSON.parse(finalStr); } catch { /* try next */ }
            }
        }
    } catch { /* fall through to throw */ }

    // Strategy 4 + close brackets
    const repairedClosed = repaired + '}'.repeat(Math.max(0, openBraces)) + ']'.repeat(Math.max(0, openBrackets));
    return JSON.parse(repairedClosed);
}

// ── Try models with key rotation ──────────────────────────────────────────────

async function tryMgModels(
    models: string[],
    systemPrompt: string,
    userMessage: string,
    temperature: number,
    maxTokens: number,
): Promise<string> {
    const keys = getMgKeys();
    let lastErr: any;

    for (const model of models) {
        for (let ki = 0; ki < keys.length; ki++) {
            const apiKey = getMgKey();
            console.log(`🤖 [mg-llm] model=${model} key=${_mgKeyIdx + 1}/${keys.length} temp=${temperature}`);
            try {
                const { rawText } = await callMgModel(model, systemPrompt, userMessage, temperature, maxTokens, apiKey);
                return rawText;
            } catch (err: any) {
                lastErr = err;
                if (err.isRateLimit) { rotateMgKey(); continue; }
                console.error(`❌ [mg-llm] [${model}] non-rate error: ${err.message}`);
                break; // move to next model
            }
        }
    }

    throw lastErr ?? new Error('[mg-llm] all models exhausted');
}

// ── Public API ────────────────────────────────────────────────────────────────

export const motionGraphicsLLM = {
    /**
     * Generate and parse a JSON scene array for Motion Graphics.
     * Primary: openrouter/owl-alpha
     * Fallback: nex-agi/nex-n2-pro:free
     */
    async json(
        systemPrompt: string,
        userPrompt: string,
        options?: { temperature?: number; maxTokens?: number },
    ): Promise<any> {
        const temperature = options?.temperature ?? 0.8;
        const maxTokens   = options?.maxTokens   ?? 8192;

        const sysWithRule = systemPrompt +
            '\n\nCRITICAL: Output ONLY valid JSON. No markdown code fences, no XML tags, no explanations. Start with { or [ and close properly.';

        const userWithRule = userPrompt +
            '\n\nReturn ONLY valid JSON. No markdown. No extra text.';

        const raw = await tryMgModels(
            [MG_PRIMARY_MODEL, MG_FALLBACK_MODEL, MG_LAST_RESORT_MODEL],
            sysWithRule,
            userWithRule,
            temperature,
            maxTokens,
        );

        return extractMgJSON(raw);
    },

    /**
     * Targeted scene patch — returns ONLY the changed scene indices + field updates.
     * Used when the user says "change scene 5 voiceover" or "animate logo" or "put my logo in scene 2".
     * Other scenes are completely untouched. Much faster than full regeneration.
     *
     * The LLM can return animationRequested:true in updates to trigger Kling image-to-video
     * for that scene, even if it's a logo_reveal or other normally non-Kling scene type.
     *
     * Returns: { patches: [{index: number, updates: Partial<Scene>}], reply: string }
     */
    async patch(
        existingScenes: any[],
        userRequest: string,
        uploadedAssetsBlock: string,
        options?: { temperature?: number },
    ): Promise<{ patches: Array<{ index: number; updates: Record<string, any> }>; reply: string }> {
        const temperature = options?.temperature ?? 0.7;

        const PATCH_SYSTEM =
            'You are an expert motion graphics scene editor. The user wants to modify SPECIFIC scenes in an existing video. ' +
            'Your job is to identify WHICH scene(s) the user is referring to (by scene type, position, or content) and return minimal patches. ' +
            '\n\nOUTPUT FORMAT (strict JSON, no markdown):' +
            '\n{"reply":"<friendly 1-sentence confirmation>","patches":[{"index":<0-based scene index>,"updates":{<only changed fields>}}]}' +
            '\n\nFIELD REFERENCE (updates can contain):' +
            '\n- voiceoverLine: string — rewrite voiceover (min 12 words, vivid verbs, cinematic)' +
            '\n- headline: string — update the main headline text' +
            '\n- subtext: string — update subtitle/supporting text' +
            '\n- content: string — update body/description text' +
            '\n- colors: {bg?: string, text?: string, accent?: string} — change background, text, or accent colors (hex values)' +
            '\n  Example: {"colors": {"accent": "#f59e0b"}} to change only the accent color' +
            '\n- imageUrl: string — set a specific image URL (ONLY when user asks to swap image)' +
            '\n- durationSec: number — adjust scene duration' +
            '\n- animationRequested: true — TRIGGER KLING image-to-video for this scene' +
            '\n- animationType: string — one of: "logo_kinetic_reveal" | "product_float" | "cinematic_pan" | "particle_burst" | "hero_zoom" | "brand_pulse"' +
            '\n\nSCENE IDENTIFICATION RULES:' +
            '\n- "logo" → find the logo_reveal scene (usually index 0)' +
            '\n- "intro" / "opening" → first scene (index 0)' +
            '\n- "outro" / "closing" / "end" → last scene' +
            '\n- "title" → title_reveal scene' +
            '\n- "call to action" / "cta" → call_to_action scene' +
            '\n- "hero" → video_hero or split_hero scene' +
            '\n- "testimonial" → testimonial scene' +
            '\n- "browser" / "app preview" → browser_mockup scene' +
            '\n- "phone" → phone_mockup scene' +
            '\n\nANIMATION RULES:' +
            '\n- If user says "animate", "bring to life", "add motion", "make it move" \u2192 set animationRequested:true' +
            '\n- Choose animationType based on scene: logo\u2192"logo_kinetic_reveal", product image\u2192"product_float", hero\u2192"cinematic_pan"' +
            '\n- animationRequested only works when the scene already has an imageUrl \u2014 if no image, also update imageUrl' +
            '\n\nCUMULATIVE PRESERVATION (most important rule):' +
            '\n- NEVER output imageUrl in a patch unless user SPECIFICALLY asked to change, replace, or re-animate the image/video' +
            '\n- Scene with media "is_video (Kling animated)" \u2014 video stays; ONLY text/color/voiceover can change' +
            '\n- Scene with media "is_uploaded_image (user asset)" \u2014 uploaded image stays; only text/color/voiceover unless user says swap' +
            '\n- Each patch is ADDITIVE: only specified fields change, everything else stays exactly as is' +
            '\n\nCRITICAL: NEVER include fields that are not changing. NEVER output the full scenes array.';

        // Build full scene context so the LLM can see ALL current field values
        // AND the media state (video/uploaded/generated) — critical for cumulative edits.
        const sceneList = existingScenes.map((s: any, i: number) => {
            const colorsStr = s.colors
                ? `bg="${s.colors.bg || ''}" text="${s.colors.text || ''}" accent="${s.colors.accent || ''}"`
                : 'no colors set';
            const itemsSummary = Array.isArray(s.items) && s.items.length > 0
                ? `items=[${s.items.map((it: any) => `{icon:${it.icon || ''},label:"${(it.label || '').slice(0, 30)}",value:"${(it.value || '').slice(0, 30)}"}`).join(', ')}]`
                : '';

            // Determine media state so LLM knows what exists
            const imgUrl = s.imageUrl || '';
            let mediaState = 'no_media';
            if (imgUrl.endsWith('.mp4') || imgUrl.endsWith('.webm') || imgUrl.includes('video-files')) {
                mediaState = 'is_video (Kling animated)';
            } else if (imgUrl.includes('blob.vercel') || imgUrl.includes('blob:')) {
                mediaState = 'is_uploaded_image (user asset)';
            } else if (imgUrl.startsWith('http')) {
                mediaState = 'is_ai_generated_image';
            }

            return (
                `--- Scene ${i + 1} (index ${i}) ---\n` +
                `type: ${s.type}\n` +
                `headline: "${s.headline || ''}"\n` +
                `subtext: "${s.subtext || ''}"\n` +
                `content: "${(s.content || '').slice(0, 120)}"\n` +
                `voiceoverLine: "${s.voiceoverLine || ''}"\n` +
                `colors: ${colorsStr}\n` +
                `durationSec: ${s.durationSec || 4}\n` +
                `media: ${mediaState}\n` +
                (itemsSummary ? `${itemsSummary}\n` : '')
            );
        }).join('\n');

        const userMsg =
            `FULL CURRENT SCENE DATA (all fields you can edit):\n${sceneList}\n` +
            (uploadedAssetsBlock ? `UPLOADED ASSETS (available for injection):\n${uploadedAssetsBlock}\n\n` : '') +
            `USER REQUEST: ${userRequest}\n\n` +
            `CUMULATIVE RULES:\n` +
            `- ONLY change what the user explicitly asks for — all other fields STAY INTACT\n` +
            `- If a scene has media: "is_video (Kling animated)" — do NOT change its imageUrl unless user asks to re-animate or replace\n` +
            `- If a scene has media: "is_uploaded_image (user asset)" — preserve the imageUrl unless user wants a different image\n` +
            `- Text/color/voiceover changes do NOT affect existing images or videos\n\n` +
            `Read the scene data above carefully. Identify which scene(s) the user is referring to. ` +
            `Return JSON with "reply" and "patches". Include ONLY the specific field(s) that need to change.`;

        const raw = await tryMgModels(
            [MG_PRIMARY_MODEL, MG_FALLBACK_MODEL, MG_LAST_RESORT_MODEL],
            PATCH_SYSTEM,
            userMsg,
            temperature,
            1536,  // bumped: need room for rich patch output
        );

        const parsed = extractMgJSON(raw);
        const patches = Array.isArray(parsed.patches) ? parsed.patches : [];
        const reply   = parsed.reply || `Updated ${patches.length} scene(s) as requested.`;

        // Validate patch indices are in range
        const safePatch = patches.filter((p: any) =>
            typeof p.index === 'number' && p.index >= 0 && p.index < existingScenes.length && p.updates
        );

        return { patches: safePatch, reply };
    },

    /**
     * Chunked scene generation — splits large requests into sequential LLM calls.
     *
     * nex-agi/nex-n2-pro:free has a ~500 token free-tier output cap (≈ 1000-1500 chars).
     * Sending 24 scenes in one shot always hits finish=length.
     * This method detects how many scenes the prompt requests, then makes
     * ceil(total / scenesPerChunk) sequential calls, each generating a small batch.
     * Results are merged into a single { scenes, voiceoverLines } object.
     *
     * @param scenesPerChunk  How many scenes per LLM call (default 4 — safe for free tier)
     */
    async jsonChunked(
        systemPrompt: string,
        userPrompt: string,
        options?: { temperature?: number; scenesPerChunk?: number },
    ): Promise<any> {
        const CHUNK_SIZE  = options?.scenesPerChunk ?? 4;
        const temperature = options?.temperature   ?? 0.8;

        // ── Extract the raw user message from the concatenated prompt ─────────
        // userPrompt = projectContext + conversationHistory + "User: <msg>" + instructions
        // We only need the <msg> part for clean scene-line extraction.
        const userMsgMatch = userPrompt.match(/User:\s*([\s\S]+?)(?:\n\nRespond|\n\nGenerate|$)/);
        const rawUserMessage = (userMsgMatch ? userMsgMatch[1] : userPrompt).trim();

        // ── Find total scene count via highest scene number ───────────────────
        const allNumbers = [...rawUserMessage.matchAll(/^(\d+)\./gm)].map(m => parseInt(m[1], 10));
        const totalScenes = allNumbers.length > 0 ? Math.max(...allNumbers) : 12;
        const numChunks   = Math.ceil(totalScenes / CHUNK_SIZE);

        console.log(`[mg-llm] Chunked mode: ${totalScenes} scenes → ${numChunks} chunks × ${CHUNK_SIZE}`);

        // ── Scene-line extractor ──────────────────────────────────────────────
        // Extracts ONLY the lines belonging to scenes [start..end].
        // Tiny input per chunk → LLM has maximum output budget (avoids finish=length).
        function extractSceneLines(start: number, end: number): string {
            const lines = rawUserMessage.split('\n');
            const result: string[] = [];
            let inRange = false;
            for (const line of lines) {
                const m = line.match(/^(\d+)\./);
                if (m) {
                    const num = parseInt(m[1], 10);
                    inRange = num >= start && num <= end;
                }
                if (inRange) result.push(line);
            }
            return result.join('\n');
        }

        // ── Minimal chunk system prompt (~50 tokens vs 500+ for the full prompt) ─
        // We do NOT send MOTION_GRAPHIC_SYSTEM_PROMPT per chunk — it would consume
        // most of LLM's free-tier token budget before any output is generated.
        const CHUNK_SYSTEM =
            'You are a JSON generator for motion graphics video scenes. ' +
            'Convert each scene specification into a JSON object with these fields: ' +
            'type, headline, subtext, content, durationSec, voiceoverLine, colors, ' +
            'and any of: items, stat, query, animation (only when specified). ' +
            'For voiceoverLine: write a complete sentence narrating what appears on screen — ' +
            'cinematic, energetic, present tense. At least 10 words. ' +
            'Output ONLY a valid JSON array starting with [ and ending with ]. ' +
            'No markdown. No explanation. No wrapper object.';


        const allScenes: any[] = [];

        for (let i = 0; i < numChunks; i++) {
            const startScene = i * CHUNK_SIZE + 1;
            const endScene   = Math.min((i + 1) * CHUNK_SIZE, totalScenes);
            const count      = endScene - startScene + 1;
            const sceneLines = extractSceneLines(startScene, endScene);

            // Each chunk user message is ONLY the scene lines (~100-150 tokens input)
            const chunkUser =
                `Convert these ${count} scene specifications into a JSON array of exactly ${count} objects:\n\n` +
                sceneLines +
                `\n\nReturn ONLY a JSON array: [{...}, ...]. Exactly ${count} objects. Start with [.`;

            console.log(`[mg-llm] Chunk ${i + 1}/${numChunks}: scenes ${startScene}–${endScene} (${sceneLines.length} chars input)`);

            try {
                const raw = await tryMgModels(
                    [MG_PRIMARY_MODEL, MG_FALLBACK_MODEL, MG_LAST_RESORT_MODEL],
                    CHUNK_SYSTEM,
                    chunkUser,
                    temperature,
                    2048,
                );

                const parsed    = extractMgJSON(raw);
                const scenesArr = Array.isArray(parsed) ? parsed : (parsed.scenes || []);
                allScenes.push(...scenesArr);
                console.log(`[mg-llm] Chunk ${i + 1}: ✓ ${scenesArr.length} scenes (total: ${allScenes.length})`);
            } catch (chunkErr: any) {
                console.warn(`[mg-llm] Chunk ${i + 1} failed: ${chunkErr.message} — skipping batch`);
            }

            // 600ms gap between chunks — respects free-tier RPM window
            if (i < numChunks - 1) {
                await new Promise(r => setTimeout(r, 600));
            }
        }

        // ── Premium voiceover enhancement via openai/gpt-oss-120b:free ─────────
        // LLM produces the scene structure; GPT-oss-120b rewrites ALL voiceover
        // lines in one pass with Hollywood movie-trailer quality.
        try {
            const enhancedLines = await enhanceVoiceovers(allScenes, getMgKey());
            if (enhancedLines.length === allScenes.length) {
                for (let i = 0; i < allScenes.length; i++) {
                    if (enhancedLines[i]) allScenes[i].voiceoverLine = enhancedLines[i];
                }
                console.log(`[mg-llm] ✨ Voiceover enhancement applied (${enhancedLines.length} lines via ${MG_VOICEOVER_MODEL})`);
            } else {
                console.warn(`[mg-llm] ⚠️ Voiceover count mismatch (${enhancedLines.length} vs ${allScenes.length}) — keeping originals`);
            }
        } catch (voiceErr: any) {
            console.warn(`[mg-llm] ⚠️ Voiceover enhancement failed (non-fatal): ${voiceErr.message} — using original lines`);
        }

        const voiceoverLines = allScenes
            .map((s: any) => s.voiceoverLine)
            .filter(Boolean);

        console.log(`[mg-llm] Chunked complete: ${allScenes.length} total scenes`);
        return { scenes: allScenes, voiceoverLines };
    },

    /**
     * Generate a premium Kling image-to-video animation prompt using gpt-oss-120b.
     * Called when a user requests animation for a specific scene ("animate logo", etc.).
     *
     * The 120B model is used exclusively here because:
     * - It understands Kling's motion model semantics deeply
     * - It can craft physically-plausible motion descriptions
     * - It avoids Kling failure modes (too complex, conflicting directions, impossible physics)
     *
     * @returns A Kling-optimized prompt string ready to pass as `prompt` to Kling API
     */
    async generateKlingPrompt(
        scene: { type: string; headline?: string; subtext?: string; voiceoverLine?: string; animationType?: string },
        apiKey: string,
    ): Promise<string> {
        const animationType = scene.animationType || 'cinematic_pan';

        // Base motion guidance per animation type — seed for gpt-oss-120b to expand on
        const ANIMATION_SEEDS: Record<string, string> = {
            logo_kinetic_reveal:
                'The logo emerges from pure black with a golden particle burst, light rays sweep left to right, ' +
                'particles spiral inward then explode outward, depth-of-field rack from blur to sharp, slow motion at 120fps feel',
            product_float:
                'Product levitates weightlessly, gentle oscillating float up and down 8px, ' +
                'soft rim light rotates 360 degrees, microscopic dust particles orbit in slow motion, premium commercial mood',
            cinematic_pan:
                'Ultra-smooth lateral camera pan from left to right, parallax depth layers move at different speeds, ' +
                'anamorphic lens flare sweeps across frame at midpoint, filmic motion blur on edges',
            particle_burst:
                'Explosive burst of glowing particles from image center, particles trail outward with motion blur, ' +
                'secondary wave of smaller particles follows, all settle into a gentle float at edges',
            hero_zoom:
                'Slow cinematic push-in zoom 1.0x to 1.15x over 5 seconds, subtle camera shake like a RED Cinema rig, ' +
                'foreground elements parallax slightly faster, depth of field softens background gently',
            brand_pulse:
                'Rhythmic light pulse emanates from logo center every 1.5 seconds, ' +
                'concentric rings of neon light expand outward and fade, image breathes gently with scale 1.0 to 1.02',
        };

        const seed = ANIMATION_SEEDS[animationType] || ANIMATION_SEEDS.cinematic_pan;

        const SYSTEM =
            'You are the world\'s best Kling AI video prompt engineer. ' +
            'Your job is to write a single, highly optimized prompt for Kling\'s image-to-video model. ' +
            '\n\nKLING PROMPT RULES (critical for quality):' +
            '\n- Describe MOTION only — what moves, how fast, in what direction, with what physics' +
            '\n- Use camera language: "slow push-in", "lateral pan", "rack focus", "dolly zoom"' +
            '\n- Specify timing: "over 5 seconds", "at the 2-second mark", "smooth ease-in-out"' +
            '\n- Lighting motion: how does light change/move across the 5-second clip' +
            '\n- AVOID: impossible physics, too many conflicting motions, color changes, text appearing' +
            '\n- Keep prompt under 120 words — Kling performs best with focused, clear prompts' +
            '\n- End with: "Cinematic quality, ultra smooth motion, no cuts, seamless loop"' +
            '\n\nOutput ONLY the prompt string. No explanation. No quotes around it.';

        const USER =
            `Scene type: ${scene.type}\n` +
            `Headline: "${scene.headline || ''}"\n` +
            `Voiceover context: "${(scene.voiceoverLine || '').slice(0, 100)}"\n` +
            `Requested animation style: ${animationType}\n` +
            `Motion seed to expand on: ${seed}\n\n` +
            `Write the best possible Kling image-to-video prompt for this scene. ` +
            `Make it vivid, specific, physically plausible, and optimized for Kling's motion model.`;

        try {
            const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                    'HTTP-Referer': 'https://ai-video-course-generator.vercel.app',
                    'X-Title': 'Migoo AI Kling Prompt Generator',
                },
                body: JSON.stringify({
                    model: MG_VOICEOVER_MODEL, // gpt-oss-120b:free
                    messages: [
                        { role: 'system', content: SYSTEM },
                        { role: 'user',   content: USER },
                    ],
                    temperature: 0.75,
                    max_tokens: 200,
                }),
            });

            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            const prompt = (data?.choices?.[0]?.message?.content || '').trim();
            if (prompt && prompt.length > 20) {
                console.log(`✨ [kling-prompt] Generated for ${scene.type}/${animationType}: "${prompt.slice(0, 80)}..."`);
                return prompt;
            }
        } catch (err: any) {
            console.warn(`⚠️ [kling-prompt] GPT-120b failed (using seed fallback): ${err.message}`);
        }

        // Fallback: use the seed directly if GPT-120b fails
        return `${seed}. Cinematic quality, ultra smooth motion, no cuts, seamless loop.`;
    },
};

// ── Voiceover Enhancement ─────────────────────────────────────────────────────
// Takes all generated scenes and rewrites their voiceoverLine fields using a
// 120B premium model for cinematic, Hollywood-grade narration quality.
async function enhanceVoiceovers(
    scenes: any[],
    apiKey: string,
): Promise<string[]> {
    const VOICEOVER_SYSTEM =
        'You are an elite Hollywood movie trailer writer and voiceover director for a premium AI product video. ' +
        'Rewrite each voiceover line to be CINEMATIC, POWERFUL, and EMOTIONALLY RESONANT. ' +
        '\n\nNON-NEGOTIABLE RULES:' +
        '\n- Every line MUST be a COMPLETE sentence (subject + vivid verb + emotion/outcome)' +
        '\n- Minimum 12 words per line. Maximum 28 words.' +
        '\n- Use CONTRAST: "While others spend hours editing, you have already gone viral."' +
        '\n- Use ESCALATION: each line should feel bigger than the last' +
        '\n- Use VIVID VERBS: explodes, shatters, ignites, commands, transforms, obliterates, launches' +
        '\n- BANNED: fragments, "The future is here", "AI powers X", word lists, lines under 10 words' +
        '\n- Match the scene headline and type — the line narrates what the viewer SEES on screen' +
        '\n- Vary rhythm: mix short punchy sentences with longer flowing waves' +
        '\n\nOutput ONLY a valid JSON array of strings — one string per scene, same count as input.' +
        '\nExample: ["From the shadows, a revolution ignites — Migoo transforms any idea into a viral video in sixty seconds.", ...]' +
        '\nNo markdown. No explanation. Just the JSON array.';

    const sceneContext = scenes.map((s: any, i: number) =>
        `Scene ${i + 1} (${s.type}): headline="${s.headline || ''}" subtext="${s.subtext || ''}" current="${s.voiceoverLine || ''}"`
    ).join('\n');

    const userMsg =
        `Rewrite the voiceover line for each of these ${scenes.length} scenes.\n` +
        `Product: Migoo AI — an AI-powered video creation platform.\n\n` +
        sceneContext +
        `\n\nReturn ONLY a JSON array of ${scenes.length} rewritten strings. Start with [.`;

    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://ai-video-course-generator.vercel.app',
            'X-Title': 'Migoo AI Voiceover Enhancement',
        },
        body: JSON.stringify({
            model: MG_VOICEOVER_MODEL,
            messages: [
                { role: 'system', content: VOICEOVER_SYSTEM },
                { role: 'user',   content: userMsg },
            ],
            temperature: 0.85,
            max_tokens: 4096,
        }),
    });

    if (!res.ok) {
        const body = await res.text();
        throw new Error(`[voiceover] HTTP ${res.status}: ${body.slice(0, 200)}`);
    }

    const data = await res.json();
    const raw  = data?.choices?.[0]?.message?.content || '';
    if (!raw) throw new Error('[voiceover] Empty response from model');

    // Extract JSON array from response
    const start = raw.indexOf('[');
    const end   = raw.lastIndexOf(']');
    if (start === -1 || end === -1) throw new Error('[voiceover] No JSON array in response');
    return JSON.parse(raw.slice(start, end + 1)) as string[];
}
