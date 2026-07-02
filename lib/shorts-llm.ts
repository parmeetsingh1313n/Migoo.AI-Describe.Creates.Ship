/**
 * @module shorts-llm
 * @description NVIDIA NIM LLM client for Shorts script + web-search fact distillation.
 *
 * Primary:   mistralai/mistral-large-3-675b-instruct-2512  (675B MoE, creative, multilingual)
 * Fallback1: openai/gpt-oss-120b                           (117B MoE, strong reasoning)
 * Fallback2: meta/llama-3.3-70b-instruct                   (70B, fast, clean JSON)
 *
 * Drop-in replacement for groq.text() / aiFallback.json().
 * Does NOT touch config/openrouter.ts (the Studio slide generator).
 */

const NVIDIA_BASE = 'https://integrate.api.nvidia.com/v1/chat/completions';

const MODELS_TEXT: string[] = [
    'mistralai/mistral-large-3-675b-instruct-2512',
    'openai/gpt-oss-120b',
    'meta/llama-3.3-70b-instruct',
];

const MODELS_JSON: string[] = [
    'mistralai/mistral-large-3-675b-instruct-2512',
    'openai/gpt-oss-120b',
    'meta/llama-3.3-70b-instruct',
];

// Translation model list — Mistral primary (best multilingual)
const MODELS_TRANSLATE: string[] = [
    'mistralai/mistral-large-3-675b-instruct-2512',
    'meta/llama-3.3-70b-instruct',
    'openai/gpt-oss-120b', // last resort only
];

// Image prompt enrichment model list.
const MODELS_ENRICH: string[] = [
    'mistralai/mistral-large-3-675b-instruct-2512',
    'meta/llama-3.3-70b-instruct',
];

// ── Key rotation (in-process) ────────────────────────────────────────────────────────────────────

let _keyIdx = 0;

function getAllKeys(): string[] {
    const keys: string[] = [];
    const base = process.env.NVIDIA_API_KEY;
    if (base) keys.push(base);
    for (let i = 1; i <= 9; i++) {
        const k = process.env[`NVIDIA_API_KEY${i}`];
        if (k) keys.push(k);
    }
    return keys;
}

function getKey(): string {
    const keys = getAllKeys();
    if (!keys.length) throw new Error('No NVIDIA_API_KEY found in environment');
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

    const res = await fetch(NVIDIA_BASE, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
    });

    clearTimeout(timeout);

    if (res.status === 429 || res.status === 402) {
        const errBody = await res.text();
        console.warn(`⚠️ [shorts-llm] rate limit (${res.status}) on [${model}]: ${errBody.slice(0, 200)}`);
        const err: any = new Error(`RATE_LIMIT: ${model} (${res.status})`);
        err.isRateLimit = true;
        throw err;
    }

    if (res.status === 403) {
        const errBody = await res.text();
        console.warn(`⚠️ [shorts-llm] blocked (403) on [${model}]: ${errBody.slice(0, 200)} — skipping model.`);
        const err: any = new Error(`BLOCKED: ${model} (403)`);
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
        // If content is empty but reasoning is present, extract it as text fallback
        const reasoning = data?.choices?.[0]?.message?.reasoning || data?.choices?.[0]?.message?.thinking;
        if (reasoning) {
            console.log(`\u2705 [shorts-llm] [${model}] returned empty content but found reasoning block (${reasoning.length} chars)`);
            return { text: reasoning, finishReason: data?.choices?.[0]?.finish_reason };
        }
        console.warn(`\u26A0\uFE0F [shorts-llm] empty choices or null content returned from [${model}]. Full response: ${JSON.stringify(data).slice(0, 300)}`);
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
            console.log(`🤖 [shorts-llm] NvidiaAPI model=${model} key=${_keyIdx + 1}/${keys.length} temp=${temperature}`);
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

// ── JSON parser with stack-based truncation repair ────────────────────────────

function repairTruncated(s: string): any {
    let inString = false;
    let isEscaped = false;
    const stack: ('}' | ']')[] = [];

    for (let i = 0; i < s.length; i++) {
        const c = s[i];

        if (isEscaped) {
            isEscaped = false;
            continue;
        }

        if (c === '\\') {
            isEscaped = true;
            continue;
        }

        if (c === '"') {
            inString = !inString;
            continue;
        }

        if (inString) {
            continue; // ignore brackets inside string literals
        }

        if (c === '{') {
            stack.push('}');
        } else if (c === '[') {
            stack.push(']');
        } else if (c === '}') {
            if (stack[stack.length - 1] === '}') {
                stack.pop();
            }
        } else if (c === ']') {
            if (stack[stack.length - 1] === ']') {
                stack.pop();
            }
        }
    }

    // 1. Build suffix: close string if we were left inside one, then pop and append brackets in reverse order.
    let suffix = inString ? '"' : '';
    let t = s.trimEnd();

    if (!inString) {
        // Strip trailing commas, colons, or unclosed keys
        t = t.replace(/,\s*$/g, '');
        t = t.replace(/:\s*$/g, '');
        t = t.replace(/,\s*"[^"]*"\s*$/g, '');
        t = t.replace(/,\s*"[^"]*"\s*:\s*$/g, '');
    }

    const reversedStack = [...stack].reverse();
    suffix += reversedStack.join('');

    try {
        const repaired = t + suffix;
        return JSON.parse(repaired);
    } catch (e: any) {
        console.warn(`⚠️ [shorts-llm] Stack repair failed (${e.message}), trying slice-fallback...`);
        // 2. Slicing fallback: scan backwards for the last closed structural bracket
        for (let idx = t.length - 1; idx >= 0; idx--) {
            const char = t[idx];
            if (char === '}' || char === ']') {
                const sub = t.slice(0, idx + 1);
                const subStack: ('}' | ']')[] = [];
                let subInString = false;
                let subEsc = false;
                for (let j = 0; j < sub.length; j++) {
                    const c = sub[j];
                    if (subEsc) { subEsc = false; continue; }
                    if (c === '\\') { subEsc = true; continue; }
                    if (c === '"') { subInString = !subInString; continue; }
                    if (subInString) continue;
                    if (c === '{') subStack.push('}');
                    else if (c === '[') subStack.push(']');
                    else if (c === '}') { if (subStack[subStack.length - 1] === '}') subStack.pop(); }
                    else if (c === ']') { if (subStack[subStack.length - 1] === ']') subStack.pop(); }
                }
                const subSuffix = (subInString ? '"' : '') + [...subStack].reverse().join('');
                try {
                    return JSON.parse(sub.replace(/,\s*$/g, '') + subSuffix);
                } catch { /* continue scanning backward */ }
            }
        }
    }
    throw new Error('[shorts-llm] All truncation repairs failed');
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

    if (wasTruncated) {
        console.warn('⚠️ [shorts-llm] Response truncated — attempting stack-based JSON repair...');
        try {
            return repairTruncated(s);
        } catch (err: any) {
            console.error(`❌ [shorts-llm] Stack repair failed: ${err.message}`);
        }
    }

    // Try direct parse
    try {
        return JSON.parse(s);
    } catch {
        // Fall back to stack-based parser to clean up literal newlines or trailing commas
        try {
            return repairTruncated(s);
        } catch { /* try basic fallback regex */ }
    }

    // Regex fallback for trailing commas
    try {
        return JSON.parse(s.replace(/,(\s*[}\]])/g, '$1'));
    } catch { /* throw final error */ }

    throw new Error('[shorts-llm] JSON parsing and repair failed');
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
            Math.max(options?.maxTokens ?? 32768, 4096), // Enforce a safe minimum for JSON generation
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
            ['mistralai/mistral-large-3-675b-instruct-2512'],
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
