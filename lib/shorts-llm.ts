/**
 * @module shorts-llm
 * @description OpenRouter LLM client for Shorts script + web-search fact distillation.
 *
 * Primary:   openai/gpt-oss-120b:free  (117B MoE, free, strong reasoning)
 * Fallback1: nvidia/nemotron-3-ultra-550b-a55b:free (550B MoE, 1M ctx, free)
 * Fallback2: meta-llama/llama-3.3-70b-instruct:free
 *
 * Drop-in replacement for groq.text() / aiFallback.json().
 * Does NOT touch config/openrouter.ts (the Studio slide generator).
 */

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1/chat/completions';

const MODELS_TEXT: string[] = [
    'openai/gpt-oss-120b:free',
    'nvidia/nemotron-3-super-120b-a12b:free',
    'nvidia/nemotron-3-ultra-550b-a55b:free',
];

const MODELS_JSON: string[] = [
    'openai/gpt-oss-120b:free',
    'nvidia/nemotron-3-super-120b-a12b:free',
    'nvidia/nemotron-3-ultra-550b-a55b:free',
];

// Translation model list — excludes openai/gpt-oss-120b:free which consistently
// gets 403 (moderation) on Hindi/Punjabi/Urdu religious & devotional content.
const MODELS_TRANSLATE: string[] = [
    'qwen/qwen3-next-80b-a3b-instruct:free',
    'meta-llama/llama-3.3-70b-instruct:free',
    'openai/gpt-oss-120b:free', // last resort only
];

// Image prompt enrichment model list — MUST use models NOT in MODELS_JSON.
// By the time enrichment runs, Owl / Qwen / Llama are all rate-limited from
// script generation. These models have fresh, untouched rate-limit windows.
// None of these have violence/graphic moderation filters.
const MODELS_ENRICH: string[] = [
    'nvidia/nemotron-3-ultra-550b-a55b:free',     // Primary: 550B MoE, best free model, zero moderation, fresh window
    'nvidia/nemotron-3-super-120b-a12b:free',     // Fallback
];

// ── Key rotation (in-process) ─────────────────────────────────────────────────

let _keyIdx = 0;

function getAllKeys(): string[] {
    const keys: string[] = [];
    const base = process.env.OPENROUTER_API_KEY;
    if (base) keys.push(base);
    for (let i = 1; i <= 9; i++) {
        const k = process.env[`OPENROUTER_API_KEY${i}`];
        if (k) keys.push(k);
    }
    return keys;
}

function getKey(): string {
    const keys = getAllKeys();
    if (!keys.length) throw new Error('No OPENROUTER_API_KEY found in environment');
    _keyIdx = _keyIdx % keys.length;
    return keys[_keyIdx];
}

function rotateKey(): void {
    const keys = getAllKeys();
    if (keys.length <= 1) return;
    _keyIdx = (_keyIdx + 1) % keys.length;
    console.log(`\uD83D\uDD04 [shorts-llm] key rotated \u2192 key${_keyIdx + 1}/${keys.length}`);
}

// ── Core HTTP call ────────────────────────────────────────────────────────────

interface CallResult { text: string; finishReason?: string }

async function callModel(
    model: string,
    systemPrompt: string,
    userMessage: string,
    temperature: number,
    maxTokens: number,
    apiKey: string,
    requireJson = false,
): Promise<CallResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5 * 60 * 1000);

    const body: Record<string, any> = {
        model,
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user',   content: userMessage  },
        ],
        temperature,
        max_tokens: maxTokens,
    };

    if (requireJson) {
        // Guide output format to JSON. We deliberately keep reasoning/thinking ON —
        // models that think (Nemotron, Qwen) produce higher quality JSON.
        // With maxTokens=32768 there is ample budget for thinking + JSON.
        // Any thinking tags that bleed into content are stripped by stripThinking().
        body.response_format = { type: 'json_object' };
    }

    const res = await fetch(OPENROUTER_BASE, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://ai-video-course-generator.vercel.app',
            'X-Title': 'Migoo AI Shorts Generator',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
    });

    clearTimeout(timeout);

    if (res.status === 429 || res.status === 402) {
        const body = await res.text();
        console.warn(`\u26A0\uFE0F [shorts-llm] rate/credit (${res.status}) on [${model}]: ${body.slice(0, 200)}`);
        const err: any = new Error(`RATE_LIMIT: ${model} (${res.status})`);
        err.isRateLimit = true;
        throw err;
    }

    if (res.status === 403) {
        // Content moderation rejection (e.g. openai/gpt-oss-120b:free flags religious/Hindi content).
        // Treat as a skip — rotate to the next model instead of crashing the whole pipeline.
        const body = await res.text();
        console.warn(`\u26A0\uFE0F [shorts-llm] moderation block (403) on [${model}]: ${body.slice(0, 200)} \u2014 skipping model.`);
        const err: any = new Error(`MODERATION_BLOCK: ${model} (403)`);
        err.isRateLimit = true; // reuse rotate logic
        throw err;
    }

    if (!res.ok) {
        const body = await res.text();
        throw new Error(`[shorts-llm] API error ${res.status}: ${body.slice(0, 300)}`);
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
        const err: any = new Error(`[shorts-llm] empty choices from [${model}]`);
        err.isRateLimit = true; // rotate on empty response
        throw err;
    }

    console.log(`\u2705 [shorts-llm] [${model}] responded (${content.length} chars, finish=${data?.choices?.[0]?.finish_reason})`);
    return { text: content, finishReason: data?.choices?.[0]?.finish_reason };
}

// ── Try models with key rotation ──────────────────────────────────────────────

async function tryModels(
    models: string[],
    systemPrompt: string,
    userMessage: string,
    temperature: number,
    maxTokens: number,
    requireJson = false,
): Promise<{ text: string; finishReason: string | null }> {
    const keys = getAllKeys();
    let lastErr: any;

    for (const model of models) {
        for (let ki = 0; ki < keys.length; ki++) {
            const apiKey = getKey();
            console.log(`\uD83E\uDD16 [shorts-llm] model=${model} key=${_keyIdx + 1}/${keys.length} temp=${temperature}`);
            try {
                const { text, finishReason } = await callModel(model, systemPrompt, userMessage, temperature, maxTokens, apiKey, requireJson);
                return { text, finishReason: (finishReason ?? null) as string | null };
            } catch (err: any) {
                lastErr = err;
                if (err.isRateLimit) { rotateKey(); continue; }
                console.error(`\u274C [shorts-llm] [${model}] non-rate error: ${err.message}`);
                break; // move to next model
            }
        }
    }

    throw lastErr ?? new Error('[shorts-llm] all models exhausted');
}

// ── Shared: strip thinking blocks from model output ───────────────────────────
// Models like Nemotron/Qwen/DeepSeek emit <thinking>...</thinking> or
// <think>...</think> before their actual answer. Strip all known formats.

function stripThinkingTags(s: string): string {
    return s
        .replace(/<\|thinking\|>[\s\S]*?<\/\|thinking\|>/gi, '')
        .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/\[THINKING\][\s\S]*?\[\/THINKING\]/gi, '')
        .trim();
}

// ── JSON parser with truncation repair ───────────────────────────────────────

function repairTruncated(s: string, opens: number, opena: number): any {
    // Strategy A: close open string then close brackets
    const withStr = s + '"';
    try { return JSON.parse(withStr + '}'.repeat(Math.max(0, opens)) + ']'.repeat(Math.max(0, opena))); } catch { /* next */ }

    // Strategy B: walk back to last clean boundary (} or ])
    for (const marker of ['}', ']']) {
        const idx = s.lastIndexOf(marker);
        if (idx > 0) {
            const t = s.slice(0, idx + 1);
            const ob  = (t.match(/\{/g) || []).length - (t.match(/\}/g) || []).length;
            const obr = (t.match(/\[/g) || []).length - (t.match(/\]/g) || []).length;
            try { return JSON.parse(t + '}'.repeat(Math.max(0, ob)) + ']'.repeat(Math.max(0, obr))); } catch { /* next */ }
        }
    }
    throw new Error('[shorts-llm] truncation repair failed');
}

function extractJSON(raw: string, wasTruncated = false): any {
    // Strip thinking blocks first, then markdown fences
    let s = stripThinkingTags(raw)
        .replace(/^(?:#{1,3}\s+)?(?:thinking|reasoning|analysis|scratchpad)[:\s][\s\S]*?(?=\{|\[)/i, '')
        .replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '')
        .replace(/<json>\s*/gi, '').replace(/\s*<\/json>/gi, '')
        .trim();

    const start = Math.min(
        s.includes('{') ? s.indexOf('{') : Infinity,
        s.includes('[') ? s.indexOf('[') : Infinity,
    );
    if (start === Infinity) throw new Error('[shorts-llm] No JSON in response');
    s = s.slice(start);

    const opens = (s.match(/\{/g) || []).length - (s.match(/\}/g) || []).length;
    const opena = (s.match(/\[/g) || []).length - (s.match(/\]/g) || []).length;

    // If truncated, try repair FIRST before regular parse attempts
    if (wasTruncated) {
        console.warn('\u26A0\uFE0F [shorts-llm] Response truncated (finish=length) \u2014 attempting JSON repair...');
        try { return repairTruncated(s, opens, opena); } catch { /* fall through to normal strategies */ }
    }

    // 1. Direct parse
    try { return JSON.parse(s); } catch { /* try repairs */ }

    // 2. Remove trailing commas
    try { return JSON.parse(s.replace(/,(\s*[}\]])/g, '$1')); } catch { /* next */ }

    // 3. Balance brackets
    const balanced = s + '}'.repeat(Math.max(0, opens)) + ']'.repeat(Math.max(0, opena));
    try { return JSON.parse(balanced); } catch { /* next */ }

    // 4. Escape literal newlines inside strings
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

    // 5. Balanced + newline-escaped + truncation repair
    const repairedBalanced = repaired + '}'.repeat(Math.max(0, opens)) + ']'.repeat(Math.max(0, opena));
    try { return JSON.parse(repairedBalanced); } catch { /* next */ }

    // 6. Last resort truncation repair on newline-escaped string
    return repairTruncated(repaired, opens, opena);
}

// ── Public API ────────────────────────────────────────────────────────────────

export const shortsLLM = {
    /**
     * Generate free-form text (replaces groq.text()).
     */
    async text(
        systemPrompt: string,
        userPrompt: string,
        options?: { temperature?: number; maxTokens?: number },
    ): Promise<string> {
        const { text } = await tryModels(
            MODELS_TEXT,
            systemPrompt,
            userPrompt,
            options?.temperature ?? 0.7,
            options?.maxTokens ?? 4000,
        );
        return text;
    },

    /**
     * Generate and parse JSON using a two-phase chain-of-thought pipeline.
     *
     * PHASE 1 — Reasoning Pass (free-form text, no JSON constraint):
     *   The model thinks deeply and freely. It analyzes the topic, plans the
     *   narrative arc, identifies key facts, and structures the content.
     *   This reasoning is stored and fed as context to Phase 2.
     *   Budget: 10,000 tokens purely for thinking.
     *
     * PHASE 2 — JSON Generation Pass (low temperature, JSON mode):
     *   The model receives its own Phase 1 reasoning as explicit context.
     *   It "knows the plan" and converts it cleanly into the required JSON.
     *   Budget: 32,768 tokens for complete, well-structured JSON output.
     *
     * Result: full thinking quality (not suppressed) + full JSON completeness.
     * No trade-off between reasoning depth and output correctness.
     */
    async json(
        systemPrompt: string,
        userPrompt: string,
        options?: { temperature?: number; maxTokens?: number },
    ): Promise<any> {

        // ── PHASE 1: Reasoning Pass ──────────────────────────────────────────
        // Explicitly tell the model NOT to output JSON yet.
        // It should think, plan, and analyze — stored for use in Phase 2.
        const reasoningSystem =
            systemPrompt +
            '\n\n[ANALYSIS MODE] You are in deep reasoning mode.' +
            ' Think thoroughly: analyze the topic, plan the narrative arc, decide what facts to include in each scene, identify emotional beats and visual descriptions.' +
            ' DO NOT output JSON yet. Output your analysis and structured plan as free-form text.' +
            ' Be thorough and specific — this thinking will directly guide the final JSON output.';

        const reasoningUser =
            userPrompt +
            '\n\nAnalyze and plan step-by-step. Think about: narrative structure, scene flow, key facts to highlight, visual descriptions for each scene, voiceover tone and pacing.' +
            ' Write your full reasoning. Do not produce JSON in this step.';

        let reasoning = '';
        try {
            console.log('\uD83E\uDDE0 [shorts-llm] Phase 1: reasoning pass (full thinking, no JSON constraint)...');
            const { text: r } = await tryModels(
                MODELS_JSON,
                reasoningSystem,
                reasoningUser,
                options?.temperature ?? 0.8,
                10_000, // generous budget — purely for thinking, no JSON yet
            );
            reasoning = stripThinkingTags(r); // strip any embedded thinking tags
            console.log(`\uD83E\uDDE0 [shorts-llm] Phase 1 complete: ${reasoning.length} chars of reasoning stored`);
        } catch (err: any) {
            // Non-fatal: Phase 2 still runs, just without reasoning context
            console.warn(`\u26A0\uFE0F [shorts-llm] Phase 1 reasoning failed (${err.message?.slice(0, 80)}) \u2014 Phase 2 will run without reasoning context`);
        }

        // ── PHASE 2: JSON Generation Pass ────────────────────────────────────
        // Feed Phase 1 reasoning as explicit context.
        // Lower temperature → higher precision for JSON output.
        const jsonSystem =
            systemPrompt +
            '\n\nCRITICAL: Output ONLY valid JSON. No markdown, no XML tags, no explanations. Start with { and end with }.';

        const reasoningBlock = reasoning.length > 0
            ? '\n\n=== YOUR ANALYSIS & PLAN (use this to produce the JSON) ===\n' +
              reasoning +
              '\n=== END OF ANALYSIS ===\n\n'
            : '\n\n';

        const jsonUser =
            userPrompt +
            reasoningBlock +
            'Using the analysis above, produce the complete JSON now. Start immediately with { — no preamble, no markdown, no explanation.';

        console.log(`\uD83D\uDCCB [shorts-llm] Phase 2: JSON generation (reasoning context: ${reasoning.length} chars)...`);

        const { text: raw, finishReason } = await tryModels(
            MODELS_JSON,
            jsonSystem,
            jsonUser,
            (options?.temperature ?? 0.7) * 0.6, // lower temp: precision matters for JSON
            options?.maxTokens ?? 32768,
            true, // response_format: json_object
        );

        // Strip any residual thinking tags from Phase 2 response
        const cleaned = stripThinkingTags(raw);

        // Detect truncation
        const explicitTrunc = finishReason === 'length';
        const wasTruncated  = explicitTrunc || (cleaned.trimEnd().slice(-1) !== '}' && cleaned.trimEnd().slice(-1) !== ']');
        if (wasTruncated) console.warn(`\u26A0\uFE0F [shorts-llm] Truncation in Phase 2 (finish=${finishReason}) \u2014 engaging repair...`);

        if (!cleaned.includes('{') && !cleaned.includes('[')) {
            throw new Error('[shorts-llm] No JSON in Phase 2 response \u2014 model produced text-only output');
        }

        return extractJSON(cleaned, wasTruncated);
    },

    /**
     * Translation-specific text generation.
     * Uses ONLY openai/gpt-oss-120b:free. If this fails, the translation utility
     * will immediately fall back to Groq Llama-3.3-70B.
     */
    async translate(
        systemPrompt: string,
        userPrompt: string,
        options?: { temperature?: number; maxTokens?: number },
    ): Promise<string> {
        const { text } = await tryModels(
            ['openai/gpt-oss-120b:free'],
            systemPrompt,
            userPrompt,
            options?.temperature ?? 0.3,
            options?.maxTokens ?? 1024,
        );
        return text;
    },

    /**
     * Image prompt enrichment — uses moderation-safe model list.
     * Avoids gpt-oss-120b:free which blocks historical battle/martyrdom content
     * (violence/graphic moderation). Nemotron is primary.
     */
    async enrich(
        systemPrompt: string,
        userPrompt: string,
        options?: { temperature?: number; maxTokens?: number },
    ): Promise<string> {
        const { text } = await tryModels(
            MODELS_ENRICH,
            systemPrompt,
            userPrompt,
            options?.temperature ?? 0.4,
            options?.maxTokens ?? 300,
        );
        return text;
    },
};
