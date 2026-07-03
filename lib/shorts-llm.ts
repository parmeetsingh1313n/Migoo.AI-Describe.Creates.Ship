/**
 * @module shorts-llm
 * @description NVIDIA NIM LLM client for Shorts script + web-search fact distillation.
 *
 * Primary:   mistralai/mistral-large-3-675b-instruct-2512  (675B MoE, creative, multilingual)
 * Fallback1: openai/gpt-oss-120b                           (117B MoE, strong reasoning)
 * Fallback2: meta/llama-3.3-70b-instruct                   (70B, fast, clean JSON)
 *
 * Drop-in replacement for groq.text() / aiFallback.json()
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

function getKey(keyIndex?: number): string {
    const keys = getAllKeys();
    if (!keys.length) throw new Error('No NVIDIA_API_KEY found in environment');
    if (keyIndex !== undefined) {
        const k = keys[keyIndex % keys.length];
        if (!k) throw new Error(`NVIDIA key index ${keyIndex} not configured`);
        return k;
    }
    _keyIdx = _keyIdx % keys.length;
    return keys[_keyIdx];
}

function rotateKey(): void {
    const keys = getAllKeys();
    if (keys.length <= 1) return;
    _keyIdx = (_keyIdx + 1) % keys.length;
    console.log(`\uD83D\uDD04 [shorts-llm] key rotated → key${_keyIdx + 1}/${keys.length}`);
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
        // NVIDIA NIM API does NOT support assistant prefill (causes 400 BadRequestError).
        // Use response_format + a firm system instruction instead.
        body.response_format = { type: 'json_object' };
        // Force the model to output only JSON via a clear system suffix:
        // (already set in the jsonSystem prompt in shortsLLM.json — this is a belt-and-suspenders guard)
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
        // gpt-oss-120b (thinking model) puts output in reasoning_content when content is null.
        // Also check legacy keys: reasoning / thinking.
        const reasoning =
            data?.choices?.[0]?.message?.reasoning_content ||
            data?.choices?.[0]?.message?.reasoning ||
            data?.choices?.[0]?.message?.thinking;
        if (reasoning) {
            console.log(`✅ [shorts-llm] [${model}] content=null but reasoning_content found (${reasoning.length} chars) — using as text`);
            return { text: reasoning, finishReason: data?.choices?.[0]?.finish_reason };
        }
        console.warn(`⚠️ [shorts-llm] empty choices or null content returned from [${model}]. Full response: ${JSON.stringify(data).slice(0, 300)}`);
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

/**
 * Call a single specific model with a specific API key index.
 * Used for keyed retry steps in Inngest (fresh Vercel invocations with a different key).
 */
export async function callSpecificModelWithKey(
    model: string,
    systemPrompt: string,
    userMessage: string,
    temperature: number,
    maxTokens: number,
    keyIndex: number,
    requireJson = false,
): Promise<{ text: string; finishReason: string | null }> {
    const apiKey = getKey(keyIndex);
    const keys = getAllKeys();
    console.log(`🤖 [shorts-llm] callSpecificModelWithKey model=${model} key=${keyIndex + 1}/${keys.length} temp=${temperature}`);
    const { text, finishReason } = await callModel(model, systemPrompt, userMessage, temperature, maxTokens, apiKey, requireJson);
    return { text, finishReason: finishReason ?? null };
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

/**
 * Parse and validate a script JSON response. Normalizes both flat scene1/scene2 keys
 * AND scenes:[] array format into a unified {scenes: [...]} shape.
 * Returns null if the parsed object is missing scenes entirely.
 */
export function parseScriptJSON(raw: string, sceneCount: number): { result: any; missing: string } | null {
    let parsed: any;
    try {
        // strip <json> tags, markdown fences, thinking blocks
        const cleaned = raw
            .replace(/<\|thinking\|>[\s\S]*?<\/\|thinking\|>/gi, '')
            .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
            .replace(/<think>[\s\S]*?<\/think>/gi, '')
            .replace(/^```json\s*/im, '').replace(/```\s*$/m, '')
            .replace(/<json>\s*/gi, '').replace(/\s*<\/json>/gi, '')
            .trim();

        // find JSON start
        const jsonStart = cleaned.search(/[{[]/);
        if (jsonStart < 0) return null;
        const jsonStr = cleaned.slice(jsonStart);

        try {
            parsed = JSON.parse(jsonStr);
        } catch {
            parsed = repairTruncated(jsonStr);
        }
    } catch (e: any) {
        console.warn(`⚠️ [shorts-llm] parseScriptJSON parse error: ${e.message}`);
        return null;
    }

    if (!parsed || typeof parsed !== 'object') return null;

    // ── Normalize scenes ─────────────────────────────────────────────────────
    // Case 1: model returned flat scene1…sceneN keys
    if (!parsed.scenes || !Array.isArray(parsed.scenes) || parsed.scenes.length === 0) {
        const extracted: any[] = [];
        for (let i = 1; i <= sceneCount; i++) {
            const key = `scene${i}`;
            if (parsed[key] && typeof parsed[key] === 'object') {
                extracted.push({ ...parsed[key], sceneNumber: i });
                delete parsed[key];
            }
        }
        if (extracted.length > 0) {
            parsed.scenes = extracted;
        }
    }

    // Case 2: model returned scenes as array (already handled above if extracted.length > 0)
    // but make sure sceneNumber is set
    if (Array.isArray(parsed.scenes)) {
        parsed.scenes = parsed.scenes.map((s: any, idx: number) => ({
            ...s,
            sceneNumber: s.sceneNumber ?? (idx + 1),
        }));
    }

    // ── Validate completeness ─────────────────────────────────────────────────
    const missing: string[] = [];

    if (!parsed.scenes || parsed.scenes.length < sceneCount) {
        missing.push(`scenes: got ${parsed.scenes?.length ?? 0}/${sceneCount}`);
    }

    if (parsed.scenes?.length >= sceneCount) {
        for (const scene of parsed.scenes.slice(0, sceneCount)) {
            if (!scene.narration || scene.narration.trim().length < 10) {
                missing.push(`scene${scene.sceneNumber} missing narration`);
                break;
            }
        }
    }

    if (missing.length > 0) {
        return { result: parsed, missing: missing.join('; ') };
    }

    return { result: parsed, missing: '' };
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
     * PHASE 1: Reasoning Pass (free-form text, no JSON constraint)
     */
    async reason(
        systemPrompt: string,
        userPrompt: string,
        options?: { temperature?: number },
    ): Promise<string> {
        const reasoningSystem =
            systemPrompt +
            '\n\n[ANALYSIS MODE] Think deeply and freely. Analyze the topic, plan the narrative arc, decide what facts to include in each scene, identify emotional beats and visual descriptions. DO NOT output JSON — output your analysis and plan as free-form text. Be thorough.';

        const reasoningUser =
            userPrompt +
            '\n\nAnalyze and plan step-by-step. Cover: narrative structure, scene flow, key facts, visual descriptions per scene, voiceover tone. Write your full reasoning. Do not produce JSON in this step.';

        try {
            console.log('\uD83E\uDDE0 [shorts-llm] Phase 1: full reasoning pass (no JSON constraint)...');
            const { text: r } = await tryModels(
                MODELS_JSON,
                reasoningSystem,
                reasoningUser,
                options?.temperature ?? 0.8,
                10_000,
            );
            const reasoning = stripThinkingTags(r);
            console.log(`\uD83E\uDDE0 [shorts-llm] Phase 1 complete: ${reasoning.length} chars of reasoning stored`);
            return reasoning;
        } catch (err: any) {
            console.warn(`\u26A0\uFE0F [shorts-llm] Phase 1 reasoning failed (${err.message?.slice(0, 80)}) \u2014 returning empty reasoning`);
            return '';
        }
    },

    /**
     * PHASE 2: JSON Generation Pass (injects Phase 1 reasoning).
     * Tries Mistral-large first, then GPT-oss-120b — NO retry on the same model.
     * Each model gets ONE attempt. If both fail, throws.
     */
    async jsonFromReasoning(
        systemPrompt: string,
        userPrompt: string,
        reasoning: string,
        options?: { temperature?: number; maxTokens?: number; keyIndex?: number },
    ): Promise<{ text: string; finishReason: string | null }> {
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

        const temp = (options?.temperature ?? 0.7) * 0.6;
        const maxTok = Math.max(options?.maxTokens ?? 8192, 4096);
        const keyIndex = options?.keyIndex;

        // Try each model once — no intra-model retry
        let lastErr: any;
        for (const model of MODELS_JSON) {
            try {
                let result: { text: string; finishReason: string | null };
                if (keyIndex !== undefined) {
                    result = await callSpecificModelWithKey(model, jsonSystem, jsonUser, temp, maxTok, keyIndex, true);
                } else {
                    const keys = getAllKeys();
                    const apiKey = getKey();
                    console.log(`🤖 [shorts-llm] NvidiaAPI model=${model} key=${_keyIdx + 1}/${keys.length} temp=${temp}`);
                    const { text, finishReason } = await callModel(model, jsonSystem, jsonUser, temp, maxTok, apiKey, true);
                    result = { text, finishReason: finishReason ?? null };
                }
                console.log(`✅ [shorts-llm] [${model}] Phase 2 responded (${result.text.length} chars, finish=${result.finishReason})`);
                return result;
            } catch (err: any) {
                lastErr = err;
                console.error(`❌ [shorts-llm] [${model}] Phase 2 failed: ${err.message?.slice(0, 120)}`);
                // Move to next model
            }
        }

        throw lastErr ?? new Error('[shorts-llm] All Phase 2 models exhausted');
    },

    async json(
        systemPrompt: string,
        userPrompt: string,
        options?: { temperature?: number; maxTokens?: number },
    ): Promise<any> {
        const maxTokens = options?.maxTokens ?? 8192;

        // ── Skip Phase 1 reasoning for small/fast JSON calls ─────────────────
        // Phase 1 uses a 10k-token budget — wasteful for tiny calls like topic discovery.
        // Only run reasoning when the output is expected to be large (>512 tokens).
        if (maxTokens <= 512) {
            const jsonSystem = systemPrompt +
                '\n\nCRITICAL: Output ONLY valid JSON. No markdown, no XML tags, no explanations. Start with { and end with }.';
            const keys = getAllKeys();
            const apiKey = getKey();
            console.log(`🤖 [shorts-llm] json() direct (no reasoning, maxTokens=${maxTokens}) model=${MODELS_JSON[0]} key=${_keyIdx + 1}/${keys.length}`);
            const { text: raw } = await callModel(MODELS_JSON[0], jsonSystem, userPrompt, options?.temperature ?? 0.7, maxTokens, apiKey, true);
            const stripped = stripThinkingTags(raw).trim();
            const jsonStart = stripped.search(/[{[]/);
            const cleaned = jsonStart >= 0 ? stripped.slice(jsonStart) : stripped;
            if (!cleaned.includes('{') && !cleaned.includes('[')) {
                throw new Error('[shorts-llm] No JSON in direct response');
            }
            return extractJSON(cleaned, false);
        }

        // ── Full two-phase chain-of-thought for large JSON generation ─────────
        const reasoning = await this.reason(systemPrompt, userPrompt, options);
        const { text: raw, finishReason } = await this.jsonFromReasoning(systemPrompt, userPrompt, reasoning, options);

        const stripped = stripThinkingTags(raw).trim();
        const jsonStart = stripped.search(/[{[]/);
        const cleaned  = jsonStart >= 0 ? stripped.slice(jsonStart) : stripped;

        const explicitTrunc = finishReason === 'length';
        const wasTruncated  = explicitTrunc || (cleaned.trimEnd().slice(-1) !== '}' && cleaned.trimEnd().slice(-1) !== ']');
        if (wasTruncated) console.warn(`\u26A0\uFE0F [shorts-llm] Truncation in Phase 2 (finish=${finishReason}) \u2014 engaging repair...`);

        if (!cleaned.includes('{') && !cleaned.includes('[')) {
            throw new Error('[shorts-llm] No JSON in Phase 2 response');
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
