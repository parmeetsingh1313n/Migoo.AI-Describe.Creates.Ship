/**
 * @module shorts-llm
 * @description OpenRouter LLM client for Shorts script + web-search fact distillation.
 *
 * Primary:   openai/gpt-oss-120b:free            (117B MoE, free, strong JSON)
 * Fallback1: nvidia/nemotron-3-super-120b-a12b:free
 * Fallback2: meta-llama/llama-3.3-70b-instruct:free  (reliable, good output limit)
 * Fallback3: nvidia/nemotron-3-ultra-550b-a55b:free  (1M ctx, high quality)
 *
 * KEY FIX: Assistant prefill with '{' forces the model's first output token to be '{'
 * making it physically impossible to output thinking/analysis text before JSON —
 * even for models that ignore response_format (Nemotron, etc.).
 *
 * Drop-in replacement for groq.text() / aiFallback.json().
 */

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1/chat/completions';

const MODELS_TEXT: string[] = [
    'openai/gpt-oss-120b:free',
    'nvidia/nemotron-3-super-120b-a12b:free',
    'meta-llama/llama-3.3-70b-instruct:free',
    'nvidia/nemotron-3-ultra-550b-a55b:free',
];

const MODELS_JSON: string[] = [
    'openai/gpt-oss-120b:free',
    'nvidia/nemotron-3-super-120b-a12b:free',
    'meta-llama/llama-3.3-70b-instruct:free',
    'nvidia/nemotron-3-ultra-550b-a55b:free',
];

// Translation model list — excludes openai/gpt-oss-120b:free which consistently
// gets 403 (moderation) on Hindi/Punjabi/Urdu religious & devotional content.
const MODELS_TRANSLATE: string[] = [
    'qwen/qwen3-next-80b-a3b-instruct:free',
    'meta-llama/llama-3.3-70b-instruct:free',
    'openai/gpt-oss-120b:free', // last resort only
];

// Image prompt enrichment — moderation-safe models only.
const MODELS_ENRICH: string[] = [
    'nvidia/nemotron-3-ultra-550b-a55b:free',
    'nvidia/nemotron-3-super-120b-a12b:free',
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
        // 2. Assistant prefill — the universal JSON fix.
        //    Appending { role:'assistant', content:'{' } forces the model's FIRST
        //    output token to be '{'. Even models that ignore response_format
        //    (Nemotron, etc.) cannot output thinking/analysis text before '{' because
        //    they must CONTINUE an assistant turn already beginning with '{'.
        //    IMPORTANT: returned text is the model's continuation AFTER '{',
        //    so callers must prepend '{' when the response doesn't already start with it.
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
        console.warn(`\u26A0\uFE0F [shorts-llm] moderation block (403) on [${model}]: ${errBody.slice(0, 200)} \u2014 skipping.`);
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

// ── Shared: strip thinking-block tags ────────────────────────────────────────

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

    // Strategy B: walk back to last complete boundary (} or ])
    for (const marker of ['}', ']']) {
        const idx = s.lastIndexOf(marker);
        if (idx > 0) {
            const t = s.slice(0, idx + 1);
            const ob  = (t.match(/\{/g) || []).length - (t.match(/\}/g) || []).length;
            const obr = (t.match(/\[/g) || []).length - (t.match(/\]/g) || []).length;
            try { return JSON.parse(t + '}'.repeat(Math.max(0, ob)) + ']'.repeat(Math.max(0, obr))); } catch { /* next */ }
        }
    }

    // Strategy C: walk back to the second-to-last } and try closing from there
    // (handles case where truncation cut in the middle of the last array item)
    const lastClose = s.lastIndexOf('}');
    if (lastClose > 0) {
        const secondLast = s.lastIndexOf('}', lastClose - 1);
        if (secondLast > 0) {
            const t = s.slice(0, secondLast + 1);
            // Remove trailing comma if any
            const tClean = t.replace(/,\s*$/, '');
            const ob  = (tClean.match(/\{/g) || []).length - (tClean.match(/\}/g) || []).length;
            const obr = (tClean.match(/\[/g) || []).length - (tClean.match(/\]/g) || []).length;
            try { return JSON.parse(tClean + '}'.repeat(Math.max(0, ob)) + ']'.repeat(Math.max(0, obr))); } catch { /* next */ }
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

    // Try repair first when truncated
    if (wasTruncated) {
        console.warn('\u26A0\uFE0F [shorts-llm] Truncated \u2014 attempting JSON repair...');
        try { return repairTruncated(s, opens, opena); } catch { /* fall through */ }
    }

    // 1. Direct parse
    try { return JSON.parse(s); } catch { /* next */ }

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
     * Generate and parse JSON.
     *
     * DESIGN:  Single-phase with assistant prefill.
     *
     * WHY single-phase (not two-phase reasoning + JSON):
     *   The two-phase approach doubles API calls, halves available output tokens
     *   (reasoning context in Phase 2 eats input budget), and Nemotron's free
     *   tier only has ~6K output tokens per request. The JSON script alone needs
     *   ~8K tokens. Two phases = each phase gets even less room → truncation.
     *
     * THE FIX — assistant prefill '{':
     *   Adding { role:'assistant', content:'{' } to messages forces the model's
     *   first output token to be '{'. This is a universal constraint — even
     *   models that ignore response_format cannot emit thinking text before '{'
     *   because they must continue an assistant turn already starting with '{'.
     *   The model goes straight into JSON: "title":"...", "scenes":[...]}
     *
     * CONCISENESS RULE injected into system prompt:
     *   Free-tier models have limited output. Telling them to be concise prevents
     *   verbose JSON that exceeds token limits and triggers truncation.
     */
    async json(
        systemPrompt: string,
        userPrompt: string,
        options?: { temperature?: number; maxTokens?: number },
    ): Promise<any> {

        const sysWithRule =
            systemPrompt +
            '\n\nCRITICAL RULES:' +
            '\n1. Output ONLY valid JSON. No markdown, no XML tags, no explanations.' +
            '\n2. Keep all string field values concise — under 200 characters each.' +
            '\n3. Do not add extra commentary fields. Follow the schema exactly.' +
            '\n4. The JSON starts immediately — no preamble, no thinking.';

        const userWithRule =
            userPrompt +
            '\n\nReturn ONLY valid JSON. Be concise in all string values (under 200 chars each). No markdown fences. No extra text.';

        console.log(`\uD83D\uDCDD [shorts-llm] JSON generation (single-phase + assistant prefill)...`);

        const { text: raw, finishReason } = await tryModels(
            MODELS_JSON,
            sysWithRule,
            userWithRule,
            options?.temperature ?? 0.7,
            options?.maxTokens ?? 32768,
            true, // requireJson: sends response_format + assistant prefill '{'
        );

        // The model's response is the CONTINUATION after the assistant prefill '{'.
        // Prepend '{' if the model returned only the continuation (not the full JSON).
        const stripped = stripThinkingTags(raw).trim();
        const cleaned  = stripped.startsWith('{') ? stripped : ('{' + stripped);

        const explicitTrunc = finishReason === 'length';
        const wasTruncated  = explicitTrunc || (cleaned.trimEnd().slice(-1) !== '}' && cleaned.trimEnd().slice(-1) !== ']');
        if (wasTruncated) console.warn(`\u26A0\uFE0F [shorts-llm] Truncation detected (finish=${finishReason}) \u2014 engaging repair...`);

        if (!cleaned.includes('{') && !cleaned.includes('[')) {
            throw new Error('[shorts-llm] No JSON in response despite assistant prefill \u2014 rotating to next model');
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
     * Image prompt enrichment — moderation-safe model list.
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
