/**
 * @module shorts-llm
 * @description OpenRouter LLM client for Shorts script + web-search fact distillation.
 *
 * Primary:   openai/gpt-oss-120b:free  (117B MoE, free, no TPM limit like Groq)
 * Fallback1: qwen/qwen3-next-80b-a3b-instruct:free (262K ctx, free)
 * Fallback2: meta-llama/llama-3.3-70b-instruct:free
 *
 * Drop-in replacement for groq.text() / aiFallback.json().
 * Does NOT touch config/openrouter.ts (the Studio slide generator).
 */

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1/chat/completions';

const MODELS_TEXT: string[] = [
    'openai/gpt-oss-120b:free',
    'openrouter/owl-alpha',
    'nex-agi/nex-n2-pro:free',
    'meta-llama/llama-3.3-70b-instruct:free',
];

const MODELS_JSON: string[] = [
    'openai/gpt-oss-120b:free',
    'openrouter/owl-alpha',
    'nex-agi/nex-n2-pro:free',
    'meta-llama/llama-3.3-70b-instruct:free',
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
    'nex-agi/nex-n2-pro:free',                     // Last resort
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
    console.log(`🔄 [shorts-llm] key rotated → key${_keyIdx + 1}/${keys.length}`);
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
): Promise<CallResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5 * 60 * 1000);

    const res = await fetch(OPENROUTER_BASE, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://ai-video-course-generator.vercel.app',
            'X-Title': 'Migoo AI Shorts Generator',
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
        console.warn(`⚠️ [shorts-llm] rate/credit (${res.status}) on [${model}]: ${body.slice(0, 200)}`);
        const err: any = new Error(`RATE_LIMIT: ${model} (${res.status})`);
        err.isRateLimit = true;
        throw err;
    }

    if (res.status === 403) {
        // Content moderation rejection (e.g. openai/gpt-oss-120b:free flags religious/Hindi content).
        // Treat as a skip — rotate to the next model instead of crashing the whole pipeline.
        const body = await res.text();
        console.warn(`⚠️ [shorts-llm] moderation block (403) on [${model}]: ${body.slice(0, 200)} — skipping model.`);
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

    console.log(`✅ [shorts-llm] [${model}] responded (${content.length} chars, finish=${data?.choices?.[0]?.finish_reason})`);
    return { text: content, finishReason: data?.choices?.[0]?.finish_reason };
}

// ── Try models with key rotation ──────────────────────────────────────────────

async function tryModels(
    models: string[],
    systemPrompt: string,
    userMessage: string,
    temperature: number,
    maxTokens: number,
): Promise<string> {
    const keys = getAllKeys();
    let lastErr: any;

    for (const model of models) {
        for (let ki = 0; ki < keys.length; ki++) {
            const apiKey = getKey();
            console.log(`🤖 [shorts-llm] model=${model} key=${_keyIdx + 1}/${keys.length} temp=${temperature}`);
            try {
                const { text } = await callModel(model, systemPrompt, userMessage, temperature, maxTokens, apiKey);
                return text;
            } catch (err: any) {
                lastErr = err;
                if (err.isRateLimit) { rotateKey(); continue; }
                console.error(`❌ [shorts-llm] [${model}] non-rate error: ${err.message}`);
                break; // move to next model
            }
        }
    }

    throw lastErr ?? new Error('[shorts-llm] all models exhausted');
}

// ── JSON parser (simple + robust) ─────────────────────────────────────────────

function extractJSON(raw: string): any {
    let s = raw.trim()
        .replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '')
        .replace(/<json>\s*/gi, '').replace(/\s*<\/json>/gi, '')
        .trim();

    const start = Math.min(
        s.includes('{') ? s.indexOf('{') : Infinity,
        s.includes('[') ? s.indexOf('[') : Infinity,
    );
    if (start === Infinity) throw new Error('[shorts-llm] No JSON in response');
    s = s.slice(start);

    // 1. Direct parse
    try { return JSON.parse(s); } catch { /* try repairs */ }

    // 2. Remove trailing commas
    try { return JSON.parse(s.replace(/,(\s*[}\]])/g, '$1')); } catch { /* next */ }

    // 3. Balance brackets
    const opens  = (s.match(/\{/g) || []).length - (s.match(/\}/g) || []).length;
    const opena  = (s.match(/\[/g) || []).length - (s.match(/\]/g) || []).length;
    const fixed  = s + '}'.repeat(Math.max(0, opens)) + ']'.repeat(Math.max(0, opena));
    try { return JSON.parse(fixed); } catch { /* last */ }

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
    return JSON.parse(repaired);
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
        return tryModels(
            MODELS_TEXT,
            systemPrompt,
            userPrompt,
            options?.temperature ?? 0.7,
            options?.maxTokens ?? 4000,
        );
    },

    /**
     * Generate and parse JSON (replaces aiFallback.json() / groq.json()).
     * Injects a mandatory JSON-output instruction into the system prompt.
     */
    async json(
        systemPrompt: string,
        userPrompt: string,
        options?: { temperature?: number; maxTokens?: number },
    ): Promise<any> {
        const sysWithRule = systemPrompt +
            '\n\nCRITICAL: Output ONLY valid JSON. No markdown, no XML tags, no explanations. Start with { and end with }.';

        const userWithRule = userPrompt +
            '\n\nReturn ONLY valid JSON. No markdown code fences. No extra text.';

        const raw = await tryModels(
            MODELS_JSON,
            sysWithRule,
            userWithRule,
            options?.temperature ?? 0.7,
            options?.maxTokens ?? 8192,
        );

        return extractJSON(raw);
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
        return tryModels(
            ['openai/gpt-oss-120b:free'],
            systemPrompt,
            userPrompt,
            options?.temperature ?? 0.3,
            options?.maxTokens ?? 1024,
        );
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
        return tryModels(
            MODELS_ENRICH,
            systemPrompt,
            userPrompt,
            options?.temperature ?? 0.4,
            options?.maxTokens ?? 300,
        );
    },
};
