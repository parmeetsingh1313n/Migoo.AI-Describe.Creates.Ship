/**
 * @module shorts-llm
 * @description OpenRouter LLM client for Shorts script + web-search fact distillation.
 *
 * Primary:   openai/gpt-oss-120b:free  (117B MoE, free, strong reasoning)
 * Fallback1: nvidia/nemotron-3-super-120b-a12b:free
 * Fallback2: nvidia/nemotron-3-ultra-550b-a55b:free
 *
 * Drop-in replacement for groq.text() / aiFallback.json().
 * Does NOT touch config/openrouter.ts (the Studio slide generator).
 */

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1/chat/completions';

const MODELS_TEXT: string[] = [
    'openai/gpt-oss-120b:free',
    'nvidia/nemotron-3-ultra-550b-a55b:free',
    'meta-llama/llama-3.3-70b-instruct:free',
];

const MODELS_JSON: string[] = [
    'openai/gpt-oss-120b:free',
    'nvidia/nemotron-3-ultra-550b-a55b:free',
    'meta-llama/llama-3.3-70b-instruct:free',
];

// Translation model list — excludes openai/gpt-oss-120b:free which consistently
// gets 403 (moderation) on Hindi/Punjabi/Urdu religious & devotional content.
const MODELS_TRANSLATE: string[] = [
    'qwen/qwen3-next-80b-a3b-instruct:free',
    'meta-llama/llama-3.3-70b-instruct:free',
    'openai/gpt-oss-120b:free', // last resort only
];

// Image prompt enrichment model list.
const MODELS_ENRICH: string[] = [
    'nvidia/nemotron-3-ultra-550b-a55b:free',
    'meta-llama/llama-3.3-70b-instruct:free',
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

    const messages: any[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userMessage  },
    ];

    const body: Record<string, any> = {
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
    };

    if (requireJson) {
        // 1. Hint for models that natively support response_format
        body.response_format = { type: 'json_object' };
        // 2. Assistant prefill — force the first output token to be '{'
        //    This is the universal fix. Even models that IGNORE response_format
        //    (e.g. Nemotron) cannot output thinking/analysis text before '{' because
        //    they must CONTINUE an assistant turn that already began with '{'.
        //    The returned text is the model's continuation after '{',
        //    so the caller must prepend '{' when the response doesn't start with it.
        messages.push({ role: 'assistant', content: '{' });
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
        const errBody = await res.text();
        console.warn(`\u26A0\uFE0F [shorts-llm] rate/credit (${res.status}) on [${model}]: ${errBody.slice(0, 200)}`);
        const err: any = new Error(`RATE_LIMIT: ${model} (${res.status})`);
        err.isRateLimit = true;
        throw err;
    }

    if (res.status === 403) {
        const errBody = await res.text();
        console.warn(`\u26A0\uFE0F [shorts-llm] moderation block (403) on [${model}]: ${errBody.slice(0, 200)} \u2014 skipping model.`);
        const err: any = new Error(`MODERATION_BLOCK: ${model} (403)`);
        err.isRateLimit = true;
        throw err;
    }

    if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`[shorts-llm] API error ${res.status}: ${errBody.slice(0, 300)}`);
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
        const err: any = new Error(`[shorts-llm] empty choices from [${model}]`);
        err.isRateLimit = true;
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
                break;
            }
        }
    }

    throw lastErr ?? new Error('[shorts-llm] all models exhausted');
}

// ── Shared: strip thinking blocks from model output ───────────────────────────

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
    const withStr = s + '"';
    try { return JSON.parse(withStr + '}'.repeat(Math.max(0, opens)) + ']'.repeat(Math.max(0, opena))); } catch { /* next */ }

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

    if (wasTruncated) {
        console.warn('\u26A0\uFE0F [shorts-llm] Response truncated \u2014 attempting JSON repair...');
        try { return repairTruncated(s, opens, opena); } catch { /* fall through */ }
    }

    try { return JSON.parse(s); } catch { /* try repairs */ }
    try { return JSON.parse(s.replace(/,(\s*[}\]])/g, '$1')); } catch { /* next */ }

    const balanced = s + '}'.repeat(Math.max(0, opens)) + ']'.repeat(Math.max(0, opena));
    try { return JSON.parse(balanced); } catch { /* next */ }

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

    const repairedBalanced = repaired + '}'.repeat(Math.max(0, opens)) + ']'.repeat(Math.max(0, opena));
    try { return JSON.parse(repairedBalanced); } catch { /* next */ }

    return repairTruncated(repaired, opens, opena);
}

// ── Public API ────────────────────────────────────────────────────────────────

export const shortsLLM = {

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
     * Two-phase chain-of-thought JSON generation.
     *
     * PHASE 1 — Reasoning Pass (free-form, no JSON constraint):
     *   Model thinks deeply: analyzes topic, plans narrative arc, identifies key
     *   facts, visual descriptions, scene structure. No JSON yet.
     *   Budget: 10,000 tokens of pure reasoning.
     *   Stored and truncated to 6,000 chars before injecting into Phase 2.
     *
     * PHASE 2 — JSON Generation Pass (assistant prefill + response_format):
     *   Phase 1 reasoning injected as explicit context ("YOUR ANALYSIS & PLAN").
     *   Assistant prefill '{' forces the model's FIRST output token to be '{'.
     *   This is the universal fix — even models that ignore response_format
     *   (Nemotron etc.) CANNOT output thinking text before '{'.
     *   Budget: 32,768 tokens of pure JSON.
     *
     * Result: full thinking quality + complete, parseable JSON. No trade-off.
     */
    async json(
        systemPrompt: string,
        userPrompt: string,
        options?: { temperature?: number; maxTokens?: number },
    ): Promise<any> {

        // ── PHASE 1: Reasoning Pass ──────────────────────────────────────────
        const reasoningSystem =
            systemPrompt +
            '\n\n[ANALYSIS MODE] Think deeply and freely. Analyze the topic, plan the narrative arc, decide what facts to include in each scene, identify emotional beats and visual descriptions. DO NOT output JSON — output your analysis and plan as free-form text. Be thorough.';

        const reasoningUser =
            userPrompt +
            '\n\nAnalyze and plan step-by-step. Cover: narrative structure, scene flow, key facts, visual descriptions per scene, voiceover tone. Write your full reasoning. Do not produce JSON in this step.';

        let reasoning = '';
        try {
            console.log('\uD83E\uDDE0 [shorts-llm] Phase 1: full reasoning pass (no JSON constraint)...');
            const { text: r } = await tryModels(
                MODELS_JSON,
                reasoningSystem,
                reasoningUser,
                options?.temperature ?? 0.8,
                10_000,
            );
            reasoning = stripThinkingTags(r);
            console.log(`\uD83E\uDDE0 [shorts-llm] Phase 1 complete: ${reasoning.length} chars of reasoning stored`);
        } catch (err: any) {
            console.warn(`\u26A0\uFE0F [shorts-llm] Phase 1 reasoning failed (${err.message?.slice(0, 80)}) \u2014 Phase 2 will run without reasoning context`);
        }

        // ── PHASE 2: JSON Generation Pass ────────────────────────────────────
        // Truncate reasoning to 6000 chars to prevent prompt bloat in Phase 2.
        const MAX_REASONING_CHARS = 6000;
        const truncatedReasoning = reasoning.length > MAX_REASONING_CHARS
            ? reasoning.slice(0, MAX_REASONING_CHARS) + '\n... [analysis continues above]'
            : reasoning;

        const jsonSystem =
            systemPrompt +
            '\n\nCRITICAL: Output ONLY valid JSON. No markdown, no XML tags, no explanations. Start with { and end with }.';

        const reasoningBlock = truncatedReasoning.length > 0
            ? '\n\n=== YOUR ANALYSIS & PLAN ===\n' + truncatedReasoning + '\n=== END OF ANALYSIS ===\n\n'
            : '\n\n';

        const jsonUser =
            userPrompt +
            reasoningBlock +
            'Using the analysis above, produce the complete JSON now. The JSON starts on the next line:';

        console.log(`\uD83D\uDCCB [shorts-llm] Phase 2: JSON generation (reasoning: ${truncatedReasoning.length} chars used / ${reasoning.length} total)...`);

        const { text: raw, finishReason } = await tryModels(
            MODELS_JSON,
            jsonSystem,
            jsonUser,
            (options?.temperature ?? 0.7) * 0.6,
            options?.maxTokens ?? 32768,
            true, // requireJson = true: sends response_format + assistant prefill '{'
        );

        // The model's response is the CONTINUATION after the assistant prefill '{'.
        // Prepend '{' unless the model already returned a full JSON starting with '{'.
        const stripped = stripThinkingTags(raw).trim();
        const cleaned  = stripped.startsWith('{') ? stripped : ('{' + stripped);

        const explicitTrunc = finishReason === 'length';
        const wasTruncated  = explicitTrunc || (cleaned.trimEnd().slice(-1) !== '}' && cleaned.trimEnd().slice(-1) !== ']');
        if (wasTruncated) console.warn(`\u26A0\uFE0F [shorts-llm] Truncation in Phase 2 (finish=${finishReason}) \u2014 engaging repair...`);

        if (!cleaned.includes('{') && !cleaned.includes('[')) {
            throw new Error('[shorts-llm] No JSON in Phase 2 response \u2014 model produced text-only output despite assistant prefill');
        }

        return extractJSON(cleaned, wasTruncated);
    },

    /**
     * Translation-specific text generation.
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
     * Image prompt enrichment — moderation-safe model list (Nemotron primary).
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
