/**
 * OpenRouter API Configuration
 * Primary: openai/gpt-oss-120b:free  |  Fallback: nvidia/nemotron-3-ultra-550b-a55b:free
 * Enhanced JSON parsing with HTML quote handling
 */

interface OpenRouterResponse {
    choices: Array<{
        message: {
            content: string;
            reasoning_details?: unknown;
        };
        finish_reason?: string;
    }>;
    usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
}

class OpenRouterClient {
    private baseUrl: string = 'https://openrouter.ai/api/v1';
    private model: string = 'openai/gpt-oss-120b:free';
    private fallbackModel: string = 'nvidia/nemotron-3-super-120b-a12b:free';
    private lastFallbackModel: string = 'nvidia/nemotron-3-ultra-550b-a55b:free';

    // Key rotation state (in-memory for this server session)
    private currentKeyIndex: number = 0;

    constructor() {
        // No key caching — keys are read fresh on every call from process.env
        // so a server restart with a new key is immediately picked up.
        const key = process.env.OPENROUTER_API_KEY || '';
        if (!key) {
            throw new Error('OPENROUTER_API_KEY is not set in environment variables');
        }
    }

    /**
     * Collect all available OpenRouter API keys from env (fresh on every call).
     * Supports OPENROUTER_API_KEY, OPENROUTER_API_KEY1 … OPENROUTER_API_KEY9
     */
    private getAllKeys(): string[] {
        const keys: string[] = [];
        const base = process.env.OPENROUTER_API_KEY;
        if (base) keys.push(base);
        for (let i = 1; i <= 9; i++) {
            const k = process.env[`OPENROUTER_API_KEY${i}`];
            if (k) keys.push(k);
        }
        return keys;
    }

    /** Returns the currently active key */
    private getActiveKey(): string {
        const keys = this.getAllKeys();
        if (keys.length === 0) throw new Error('No OPENROUTER_API_KEY found in environment');
        // Clamp index in case env keys were removed
        this.currentKeyIndex = this.currentKeyIndex % keys.length;
        return keys[this.currentKeyIndex];
    }

    /** Rotate to the next key and return it */
    private rotateKey(): string {
        const keys = this.getAllKeys();
        if (keys.length <= 1) {
            console.warn('⚠️  Only one OpenRouter API key available — cannot rotate');
            return keys[0] || '';
        }
        const prev = this.currentKeyIndex + 1;
        this.currentKeyIndex = (this.currentKeyIndex + 1) % keys.length;
        console.log(`🔄 OpenRouter key rotated: key${prev} → key${this.currentKeyIndex + 1} of ${keys.length}`);
        return this.getActiveKey();
    }

    /**
     * Core HTTP call for one (key, model) attempt.
     * Throws { isRateLimit: true } on 429 or empty-choices so caller rotates.
     */
    private async callModel(
        systemPrompt: string,
        userMessage: string,
        model: string,
        temperature: number,
        maxTokens: number,
        apiKey: string,
    ): Promise<{ rawText: string; finishReason: string | undefined }> {
        const url = `${this.baseUrl}/chat/completions`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5 * 60 * 1000);

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://ai-video-course-generator.vercel.app',
                'X-Title': 'AI Video Course Generator',
            },
            body: JSON.stringify({
                model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user',   content: userMessage },
                ],
                temperature,
                max_tokens: maxTokens,
            }),
            signal: controller.signal,
        });

        clearTimeout(timeout);

        if (response.status === 429 || response.status === 402) {
            const errorText = await response.text();
            console.warn(`⚠️ OpenRouter rate/credit limit (${response.status}) on [${model}]: ${errorText.substring(0, 200)}`);
            const err: any = new Error(`RATE_LIMIT: ${model} (${response.status})`);
            err.isRateLimit = true;
            throw err;
        }

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`OpenRouter API failed: ${response.status} - ${errorText}`);
        }

        const data: OpenRouterResponse = await response.json();

        // Treat empty choices as a soft rate-limit so we rotate keys
        if (!data.choices?.length) {
            console.warn(`⚠️ OpenRouter returned empty choices array on [${model}] — treating as rate limit, rotating key...`);
            const err: any = new Error(`Empty choices from OpenRouter on model ${model}`);
            err.isRateLimit = true;
            throw err;
        }
        if (!data.choices[0]?.message)        throw new Error('No message in OpenRouter response');
        if (!data.choices[0].message.content) throw new Error('No content in OpenRouter response');

        const rawText      = data.choices[0].message.content;
        const finishReason = data.choices[0].finish_reason;

        console.log(`✅ OpenRouter [${model}] response:`, {
            length: rawText.length,
            tokens: data.usage?.total_tokens,
            finishReason,
            wasTruncated: finishReason === 'length',
            preview: rawText.substring(0, 200) + '...',
        });

        return { rawText, finishReason };
    }

    /**
     * Generate JSON response.
     * Auto-falls back to fallbackModel if primary is rate-limited.
     */
    async json(systemPrompt: string, userInput: string, options?: {
        model?: string;
        temperature?: number;
        maxTokens?: number;
    }): Promise<any> {
        const primaryModel = options?.model || this.model;
        const temperature  = options?.temperature ?? 0.7;
        const maxTokens    = options?.maxTokens ?? 8000;

        const outputRules = `\n\n---\nCRITICAL OUTPUT RULES:\n1. Return ONLY valid JSON. No markdown. No explanations.\n2. HTML fields MUST use ONLY single quotes for ALL attributes.\n3. CSS font stacks: font-family: 'Inter', sans-serif\n4. All JSON strings must be properly escaped.\n5. Single quotes in HTML never need escaping.`;

        const userMessage = userInput + outputRules;
        // Filter out empty strings so a blank fallbackModel never reaches the API
        const modelsToTry = [primaryModel, this.fallbackModel, this.lastFallbackModel].filter(m => m && m.trim() !== '');
        if (modelsToTry.length === 0) throw new Error('No OpenRouter model configured');
        const allKeys = this.getAllKeys();

        // Extra design mandate injected universally to guarantee colorful, high-contrast, perfectly sized 16:9 widescreen slides
        const designBooster = `

CRITICAL STRUCTURAL & DESIGN MANDATES (override defaults):
1. NO HARDCODED IMAGE URLS: You MUST use the literal string '{{IMAGE_PLACEHOLDER}}' in the src attribute of EVERY <img> tag. NEVER hallucinate or use any Appwrite URLs or HTTP/HTTPS URLs.
2. PREMIUM FONT SELECTION & INNER QUOTES:
   - We support a rich collection of premium modern Google Fonts in the slide template. You MUST select and mix different font families for different slides based on the slide's vibe to give the course an extremely high-end, diverse, and polished aesthetic!
   - Select ONLY from the following supported fonts:
     * Outfit (Highly geometric, modern, premium sans-serif - perfect for titles/intro slides)
     * Space Grotesk (Tech-forward, futuristic, high-contrast sans-serif - excellent for technical concept slides)
     * Poppins (Round, clean, playful geometric sans-serif - excellent for layout cards and details)
     * Inter (Sleek, neutral, highly readable professional sans-serif - great for code explanations/descriptions)
     * Playfair Display (Elegant, high-contrast serif - beautiful for philosophical, key definitions, or theoretical slide headers)
     * Instrument Serif (Graceful, high-fashion editorial serif - gives titles a premium magazine cover look)
     * DM Sans (Clean, elegant, versatile geometric sans-serif)
   - IMPORTANT: Because HTML style attributes are wrapped in single quotes (e.g. style='...'), NEVER use single quotes inside style values (like font-family: 'Outfit'). Instead, write it without quotes: e.g. font-family: Outfit, sans-serif; or font-family: Space Grotesk, sans-serif; or font-family: Playfair Display, serif; to avoid HTML syntax parsing crashes!
3. FRAGMENT DATA ALIGNMENT: The "fragmentData" JSON array must contain EXACTLY the sequence of indices present in the HTML data-fragment-index attributes (e.g. if you have indices 0 to 9, output [0,1,2,3,4,5,6,7,8,9]. Do NOT pad with unused indices like 10-19).
4. LAYOUT & 16:9 CANVAS OVERFLOW PREVENTION:
   - The slide is rendered in a fixed 1280x720px 16:9 landscape video container.
   - DO NOT stack multiple massive items vertically. Stacking too many items vertically overflows the canvas height, causing the slides to squeeze into a 1:1 ratio or look extremely zoomed-in/cropped.
   - Limit slide content: Max 3-4 items/cards per slide. If there is a code block, limit it to 1 simple code block with NO other major text/cards on the slide!
   - Columns & Horizontal layout: Use side-by-side split layouts. Use flexbox row ('display: flex; flex-direction: row; justify-content: space-between; align-items: center; gap: 20px;') or grid ('display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px;') to arrange content horizontally.
   - If there is an image ({{IMAGE_PLACEHOLDER}}), ALWAYS place it in a two-column split layout side-by-side with the text (e.g., Left Column: Text/Cards, Right Column: Image). NEVER stack a large image below or above a list of 4+ bullet cards.
5. VIBRANT, HIGH-CONTRAST AESTHETICS:
   - Use colorful background gradients (linear-gradient).
   - Use white, bright yellow, cyan, or lime for text on dark backgrounds.
   - Apply glowing glassmorphism or colored borders (e.g., border: 1px solid rgba(139,92,246,0.3)).
   - Make headings and keywords pop with contrasting accent colors.
`;

        let lastError: any;
        for (const model of modelsToTry) {
            const isFallback = model !== primaryModel;
            let activeSystemPrompt = systemPrompt + designBooster;

            if (isFallback) {
                console.log(`🔀 Falling back from [${primaryModel}] to [${model}]...`);
                
                // Add extremely direct, simple, and high-impact rules to help the fallback model avoid common formatting and overcrowding mistakes
                const fallbackBooster = `
\n\n⚠️ IMPORTANT FALLBACK ENGINE SYNTAX & DESIGN RULES:
1. PERFECT ATTRIBUTE QUOTING: Every HTML attribute MUST be explicitly and perfectly closed with a single quote. 
   - CORRECT: style='font-size: 14px; opacity: 0;' class='fragment fade-in'
   - INCORRECT: style='font-size: 14px; opacity: 0; class='fragment fade-in' (MISSING the closing single quote for the style attribute before class!)
   Double-check every tag: ensure style='...' and class='...' are completely separate and each is enclosed in its own single quotes!
2. HEIGHT BUDGET & NO OVERCROWDING: The 16:9 landscape canvas is fixed (720px height). You MUST keep the height extremely small:
   - Maximum 2 to 3 compact cards per slide.
   - If there is a code block (<pre>), that code block MUST be the ONLY content element on the entire slide. Stacking cards and a code block together causes vertical overflow!
3. VALID ESCAPED JSON: Every double quote (") inside the HTML string value MUST be escaped as \\" or removed. Never write a raw unescaped double quote (") inside any JSON string field.
4. Keep paragraphs short (maximum 1-2 lines per paragraph).
`;
                activeSystemPrompt += fallbackBooster;
            }

            // Try every available key for this model before giving up on it
            for (let keyAttempt = 0; keyAttempt < allKeys.length; keyAttempt++) {
                const apiKey = this.getActiveKey();
                // Model-specific token caps — use max supported to avoid ANY truncation
                const modelMaxTokens = model.includes('gpt-oss-120b') || model.includes('nemotron-3-super') || model.includes('nemotron-3-ultra') || model.includes('nex-n2-pro') || model.includes('cobuddy') || model.includes('owl-alpha') || model.includes('north-mini-code') || model.includes('llama-3.3')
                    ? 65536
                    : model.includes('gpt-oss-20b')
                        ? 32768
                        : maxTokens;
                console.log(`🔑 OpenRouter: model=${model}, key=${keyAttempt + 1}/${allKeys.length}, maxTokens=${modelMaxTokens}`);

                try {
                    const { rawText, finishReason } = await this.callModel(
                        activeSystemPrompt, userMessage, model, temperature, modelMaxTokens, apiKey,
                    );
                    // Some models (e.g. owl-alpha) return finishReason=null even
                    // when the output was silently truncated mid-string.
                    // Detect this by checking if the JSON actually closes properly.
                    const explicitTruncation = finishReason === 'length';
                    const silentTruncation   = !explicitTruncation && this.looksLikeTruncatedJSON(rawText);
                    const wasTruncated       = explicitTruncation || silentTruncation;
                    if (explicitTruncation) {
                        console.warn('⚠️ Response TRUNCATED (finish_reason=length) — will attempt JSON repair...');
                    } else if (silentTruncation) {
                        console.warn('⚠️ Response SILENTLY TRUNCATED (finishReason=' + finishReason + ' but JSON unclosed) — will attempt repair...');
                    }
                    return this.extractAndParseJSON(rawText, wasTruncated);
                } catch (error: any) {
                    lastError = error;
                    if (error.isRateLimit) {
                        // Rotate to next key and retry same model
                        this.rotateKey();
                        continue;
                    }
                    // Non-rate-limit error (network, parse, etc.) — move to next model
                    console.error(`❌ OpenRouter error [${model}]:`, error.message);
                    break;
                }
            }
        }

        console.error('❌ All OpenRouter keys and models exhausted.');
        throw lastError;
    }


    /**
     * Extract and parse JSON with smart HTML handling
     */
    private extractAndParseJSON(text: string, wasTruncated: boolean = false): any {
        console.log('🔧 Extracting JSON from response...');

        let cleaned = text.trim();

        // Remove markdown code blocks
        cleaned = cleaned.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '');

        // Find JSON boundaries
        const arrayStart = cleaned.indexOf('[');
        const objectStart = cleaned.indexOf('{');

        let jsonStart = -1;
        if (arrayStart !== -1 && (objectStart === -1 || arrayStart < objectStart)) {
            jsonStart = arrayStart;
        } else if (objectStart !== -1) {
            jsonStart = objectStart;
        }

        if (jsonStart === -1) {
            throw new Error('No JSON found in response');
        }

        let jsonStr = cleaned.substring(jsonStart).trim();

        // If truncated, try repair FIRST before other strategies
        if (wasTruncated) {
            console.log('🔧 Response truncated — trying truncation repair first...');
            try {
                const repaired = this.repairTruncatedJSON(jsonStr);
                if (repaired) {
                    console.log(`✅ Truncation repair succeeded!`);
                    return repaired;
                }
            } catch (e: any) {
                console.warn('⚠️ Truncation repair failed:', e.message);
            }
        }

        // Pre-process: escape literal control characters (\n, \r, \t) inside JSON strings.
        // Trinity outputs multiline HTML directly inside JSON string values which is invalid JSON.
        // This must run BEFORE any parse strategy so all strategies operate on clean JSON.
        try {
            const withFixedNewlines = this.fixLiteralNewlines(jsonStr);
            if (withFixedNewlines !== jsonStr) {
                console.log('🔧 Pre-processed: escaped literal newlines/tabs inside JSON strings');
                jsonStr = withFixedNewlines;
            }
        } catch (_) { /* ignore pre-processing errors, strategies will handle */ }

        // Try progressive parsing strategies
        const strategies = [
            { name: 'direct JSON.parse',         fn: () => JSON.parse(jsonStr) },
            { name: 'deep character repair',      fn: () => this.parseWithDeepRepair(jsonStr) },
            { name: 'HTML quote fix',             fn: () => this.parseWithHtmlFix(jsonStr) },
            { name: 'smart quote escape',         fn: () => this.parseWithSmartQuoteEscape(jsonStr) },
            { name: 'ultra-robust manual regex',  fn: () => this.parseWithManualRegex(jsonStr) },
            { name: 'brute force',                fn: () => this.parseWithBruteForce(jsonStr, wasTruncated) },
        ];

        let lastError: any;
        for (let i = 0; i < strategies.length; i++) {
            try {
                console.log(`📝 Attempting parse strategy ${i + 1}/${strategies.length}: ${strategies[i].name}...`);
                const result = strategies[i].fn();
                console.log(`✅ Parse strategy ${i + 1} (${strategies[i].name}) succeeded!`);
                return result;
            } catch (e: any) {
                console.warn(`⚠️ Strategy ${i + 1} (${strategies[i].name}) failed:`, e.message?.substring(0, 120));
                lastError = e;
            }
        }

        // ── Last-resort: force truncation repair even if wasTruncated was false ──
        // All 6 strategies failed — the response is almost certainly truncated
        // (e.g. owl-alpha returns finishReason=null on silent truncation).
        if (!wasTruncated) {
            console.warn('⚠️ All strategies failed — forcing truncation repair as last resort...');
            try {
                const repaired = this.repairTruncatedJSON(jsonStr);
                if (repaired) {
                    console.log('✅ Last-resort truncation repair succeeded!');
                    return repaired;
                }
            } catch (e: any) {
                console.warn('⚠️ Last-resort truncation repair also failed:', e.message);
            }
        }

        throw new Error(`All parse strategies failed. Last error: ${lastError?.message}`);
    }

    /**
     * Pre-processor: walk char-by-char and escape any literal \n, \r, \t
     * found INSIDE a JSON string value. Trinity outputs multiline HTML inside
     * JSON strings which is technically invalid JSON and breaks every parser.
     */
    private fixLiteralNewlines(jsonStr: string): string {
        let out = '';
        let inString = false;
        let escape   = false;

        for (let i = 0; i < jsonStr.length; i++) {
            const c = jsonStr[i];

            // Handle already-escaped character
            if (escape) {
                out   += c;
                escape = false;
                continue;
            }

            // Backslash — next char is escaped
            if (c === '\\') {
                out   += c;
                escape = true;
                continue;
            }

            // Toggle string mode on unescaped double-quote
            if (c === '"') {
                inString = !inString;
                out += c;
                continue;
            }

            // Inside a string: replace literal control chars
            if (inString) {
                if (c === '\n') { out += '\\n';  continue; }
                if (c === '\r') { out += '\\r';  continue; }
                if (c === '\t') { out += '\\t';  continue; }
            }

            out += c;
        }

        return out;
    }

    /**
     * Parse JSON using ultra-robust manual regex/character scanning.
     * Extracts fields directly and rebuilds a valid object, bypassing all quote escaping issues.
     */
    private parseWithManualRegex(jsonStr: string): any {
        console.log('🆘 Attempting ultra-robust manual regex/scanner extraction...');

        // 1. Helper to extract double-quoted string content for a specific key.
        //    If allowTruncated=true and the string is never properly closed,
        //    return whatever content exists from the opening quote to end-of-input.
        const extractField = (key: string, allowTruncated = false): string | null => {
            const keyToken = `"${key}"`;
            const keyIdx = jsonStr.indexOf(keyToken);
            if (keyIdx === -1) return null;

            const colonIdx = jsonStr.indexOf(':', keyIdx + keyToken.length);
            if (colonIdx === -1) return null;

            const startQuoteIdx = jsonStr.indexOf('"', colonIdx + 1);
            if (startQuoteIdx === -1) return null;

            // Scan forward to find the closing quote by checking lookahead for JSON delimiters
            let i = startQuoteIdx + 1;
            while (i < jsonStr.length) {
                // If it's an escaped quote, skip it
                if (jsonStr[i] === '\\' && i + 1 < jsonStr.length && jsonStr[i + 1] === '"') {
                    i += 2;
                    continue;
                }
                if (jsonStr[i] === '"') {
                    // Check if next non-whitespace is a JSON structural token
                    let j = i + 1;
                    while (j < jsonStr.length && ' \t\r\n'.includes(jsonStr[j])) j++;
                    if (j < jsonStr.length) {
                        const nextChar = jsonStr[j];
                        if (nextChar === ',' || nextChar === '}' || nextChar === ']' || nextChar === '"') {
                            return jsonStr.substring(startQuoteIdx + 1, i);
                        }
                    } else {
                        return jsonStr.substring(startQuoteIdx + 1, i);
                    }
                }
                i++;
            }

            // Reached end-of-input without finding a closing quote.
            // If allowTruncated, return the partial content — better than nothing.
            if (allowTruncated) {
                const partial = jsonStr.substring(startQuoteIdx + 1).trimEnd();
                if (partial.length > 20) {
                    console.warn(`⚠️ Field "${key}" was truncated — returning ${partial.length} chars of partial content`);
                    return partial;
                }
            }
            return null;
        };

        // 2. Extract Slide ID
        const slideId = extractField('slideId') || 'slide-' + Date.now();

        // 3. Extract Slide Index
        const indexMatch = jsonStr.match(/"slideIndex"\s*:\s*(\d+)/);
        const slideIndex = indexMatch ? parseInt(indexMatch[1]) : 1;

        // 4. Extract HTML (allow truncated — a partial slide is better than no slide)
        const htmlRaw = extractField('html', true);
        if (!htmlRaw) throw new Error('Could not manually extract html field');

        // Unescape escaped quotes and newlines if any
        const html = htmlRaw.replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t');

        // 5. Extract Narration fullText — allow truncated narration
        const fullTextRaw = extractField('fullText', true) || extractField('narration', true);
        if (!fullTextRaw) throw new Error('Could not manually extract narration text');
        const fullText = fullTextRaw.replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t');

        // 6. Extract revealData or fragmentData array
        const dataMatch = jsonStr.match(/"(?:revealData|fragmentData)"\s*:\s*\[([\s\S]*?)\]/);
        const revealData = dataMatch
            ? dataMatch[1].split(',').map(n => parseInt(n.trim())).filter(n => !isNaN(n))
            : [];

        console.log(`✅ Ultra-robust manual regex successfully extracted slide index=${slideIndex}, htmlLength=${html.length}`);

        return {
            slideId,
            slideIndex,
            html,
            narration: {
                fullText
            },
            revealData
        };
    }

    /**
     * Deep character-level repair:
     *   1. Converts HTML attribute `="..."` patterns to `='...'`
     *   2. Escapes any remaining unescaped `"` inside JSON string values
     *      by looking ahead to detect whether it's a real closing delimiter
     *      (followed by `:`, `,`, `}`, `]`) or an embedded quote that needs escaping.
     */
    private parseWithDeepRepair(jsonStr: string): any {
        console.log('🔧 Deep repair: walking char-by-char to fix embedded HTML quotes...');

        let out = '';
        let i = 0;
        let inString = false;
        let isValue = false; // current string is a JSON value (not a key)
        let attrOpen = false; // inside an HTML attr value opened with ="
        let prevSig = ''; // last significant structural character
        let escape = false;

        while (i < jsonStr.length) {
            const c = jsonStr[i];

            // Handle already-escaped characters
            if (escape) { out += c; escape = false; i++; continue; }
            if (c === '\\') { out += c; escape = true; i++; continue; }

            if (!inString) {
                if (c === '"') {
                    inString = true;
                    // A value string follows `:` ; a key string follows `{`, `[`, `,`
                    isValue = prevSig === ':';
                    attrOpen = false;
                    out += c;
                } else {
                    if (!' \t\r\n'.includes(c)) prevSig = c;
                    out += c;
                }
                i++;
                continue;
            }

            // ── Inside a JSON string ─────────────────────────────────────────

            if (c === '"') {
                // If we're inside an HTML attr value (opened via ="), this closes it
                if (attrOpen) {
                    out += "'";
                    attrOpen = false;
                    i++;
                    continue;
                }

                // Look ahead past whitespace to find the next meaningful char
                let j = i + 1;
                while (j < jsonStr.length && ' \t\r\n'.includes(jsonStr[j])) j++;
                const next = j < jsonStr.length ? jsonStr[j] : '';

                // If next meaningful char is a JSON structural token → real closing quote
                if (next === ':' || next === ',' || next === '}' || next === ']' || next === '"' || next === '') {
                    out += '"';
                    inString = false;
                    isValue = false;
                    prevSig = '"';
                } else {
                    // Embedded unescaped quote inside a JSON string — escape it
                    out += '\\"';
                }
                i++;
                continue;
            }

            // Detect HTML attribute opener: attr=" → convert to attr='
            if (isValue && c === '=' && i + 1 < jsonStr.length && jsonStr[i + 1] === '"') {
                out += "='";
                attrOpen = true;
                i += 2; // skip = and "
                continue;
            }

            out += c;
            i++;
        }

        return JSON.parse(out);
    }

    /**
     * Parse JSON with HTML quote fixing
     */
    private parseWithHtmlFix(jsonStr: string): any {
        console.log('🔧 Attempting HTML quote fix...');

        let fixed = jsonStr;

        // Find all "html" fields and fix quotes inside them
        const htmlFieldRegex = /"html":\s*"((?:[^"\\]|\\.)*)"/g;

        fixed = fixed.replace(htmlFieldRegex, (match, htmlContent) => {
            let fixedHtml = htmlContent;
            // Fix common HTML attribute patterns: style="..." -> style='...'
            fixedHtml = fixedHtml.replace(/(<[^>]+\s+\w+)="([^"]*?)"/g, "$1='$2'");
            return `"html": "${fixedHtml}"`;
        });

        return JSON.parse(fixed);
    }

    /**
     * Parse with smart quote escaping
     */
    private parseWithSmartQuoteEscape(jsonStr: string): any {
        console.log('🔧 Attempting smart quote escape...');

        let fixed = jsonStr;

        // Remove trailing commas
        fixed = fixed.replace(/,(\s*[}\]])/g, '$1');

        // Fix common JSON issues
        fixed = fixed.replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3');

        return JSON.parse(fixed);
    }

    /**
     * Brute force: Extract valid JSON by finding matching brackets
     */
    private parseWithBruteForce(jsonStr: string, wasTruncated: boolean = false): any {
        console.log('🔨 Attempting brute force JSON extraction...');

        // For truncated responses, try to extract complete slide objects
        if (wasTruncated) {
            return this.extractCompleteSlides(jsonStr);
        }

        let depth = 0;
        let inString = false;
        let escape = false;
        let jsonContent = '';

        for (let i = 0; i < jsonStr.length; i++) {
            const char = jsonStr[i];

            if (escape) {
                jsonContent += char;
                escape = false;
                continue;
            }

            if (char === '\\') {
                escape = true;
                jsonContent += char;
                continue;
            }

            if (char === '"' && !escape) {
                inString = !inString;
                jsonContent += char;
                continue;
            }

            if (!inString) {
                if (char === '[' || char === '{') {
                    depth++;
                } else if (char === ']' || char === '}') {
                    depth--;
                }
            }

            jsonContent += char;

            if (depth === 0 && jsonContent.trim().length > 0) {
                break;
            }
        }

        // If depth != 0 at end-of-input, brackets never closed — response IS truncated
        // regardless of what finishReason said. Try slide extraction.
        if (depth !== 0) {
            console.warn(`⚠️ Brute force: bracket depth=${depth} at end — response is silently truncated`);
            return this.extractCompleteSlides(jsonStr);
        }

        try {
            return JSON.parse(jsonContent);
        } catch (e) {
            return this.manualExtraction(jsonStr);
        }
    }

    /**
     * Manual extraction as absolute last resort
     */
    private manualExtraction(jsonStr: string): any {
        console.log('🆘 Attempting manual data extraction...');

        const slides: any[] = [];

        // Extract slide objects manually
        const slideRegex = /"slideId":\s*"([^"]+)"[\s\S]*?"slideIndex":\s*(\d+)[\s\S]*?"html":\s*"((?:[^"\\]|\\.)*?)"[\s\S]*?"narration":\s*\{[\s\S]*?"fullText":\s*"((?:[^"\\]|\\.)*?)"[\s\S]*?"revealData":\s*\[(.*?)\]/g;

        let match;
        while ((match = slideRegex.exec(jsonStr)) !== null) {
            const [, slideId, slideIndex, html, narration, revealDataStr] = match;

            const revealData = revealDataStr
                .split(',')
                .map(s => s.trim().replace(/"/g, ''))
                .filter(Boolean);

            slides.push({
                slideId,
                slideIndex: parseInt(slideIndex),
                html: html.replace(/\\n/g, '\n').replace(/\\"/g, '"'),
                narration: {
                    fullText: narration.replace(/\\n/g, '\n').replace(/\\"/g, '"')
                },
                revealData
            });
        }

        if (slides.length === 0) {
            throw new Error('Could not extract any slides from response');
        }

        console.log(`✅ Manually extracted ${slides.length} slides`);
        return slides;
    }

    /**
     * Detect if a raw response looks like silently truncated JSON.
     * Returns true when the cleaned text doesn't end with valid JSON closure.
     */
    private looksLikeTruncatedJSON(rawText: string): boolean {
        let cleaned = rawText.trim();
        // Strip markdown fences
        cleaned = cleaned.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '').trim();
        if (!cleaned) return false;
        const lastChar = cleaned[cleaned.length - 1];
        // Valid JSON ends with }, ], or a closing quote — if none of those, it's truncated
        if (lastChar === '}' || lastChar === ']') return false;
        // Also check if it's a very short response (unlikely to be truncated)
        if (cleaned.length < 200) return false;
        return true;
    }

    /**
     * Repair truncated JSON by closing open strings, objects, and arrays.
     * Extracts as many complete slide objects as possible.
     */
    private repairTruncatedJSON(jsonStr: string): any {
        console.log('🔧 Repairing truncated JSON...');
        console.log(`📏 Input length: ${jsonStr.length} chars`);

        // Strategy 1: Find complete top-level objects in the array
        try {
            const slides = this.extractCompleteSlides(jsonStr);
            if (slides && slides.length > 0) {
                return slides;
            }
        } catch { /* fall through to strategy 2 */ }

        // Strategy 2: If extractCompleteSlides failed (single truncated object),
        // try the manual regex extractor with truncation tolerance.
        console.log('🔧 Truncation repair: trying manual regex with truncation tolerance...');
        return this.parseWithManualRegex(jsonStr);
    }

    /**
     * Extract complete slide objects from a potentially truncated JSON array OR single object.
     * Handles both:
     *   - Array format:  [{...}, {...}]  (Owl)
     *   - Object format: {...}           (Trinity — returns single slide object)
     */
    private extractCompleteSlides(jsonStr: string): any[] {
        console.log('🔍 Extracting complete slide objects from truncated response...');

        const slides: any[] = [];

        // Find first { and first [
        const firstBrace   = jsonStr.indexOf('{');
        const firstBracket = jsonStr.indexOf('[');

        // ── Case 1: Single top-level object (Trinity returns {"slideId":...}) ──────
        const isSingleObject =
            firstBrace !== -1 &&
            (firstBracket === -1 || firstBrace < firstBracket);

        if (isSingleObject) {
            console.log('📌 Single-object format detected (Trinity) — extracting top-level object...');
            const objStart = firstBrace;
            let depth = 0, inStr = false, esc = false, complete = false;

            for (let j = objStart; j < jsonStr.length; j++) {
                const c = jsonStr[j];
                if (esc)          { esc = false; continue; }
                if (c === '\\' && inStr) { esc = true; continue; }
                if (c === '"' && !esc)   { inStr = !inStr; continue; }
                if (!inStr) {
                    if (c === '{' || c === '[') depth++;
                    else if (c === '}' || c === ']') {
                        depth--;
                        if (depth === 0) {
                            const objStr = jsonStr.substring(objStart, j + 1);
                            try {
                                const parsed = JSON.parse(objStr);
                                if (parsed && (parsed.slideId || parsed.html || parsed.narration)) {
                                    slides.push(parsed);
                                    console.log(`✅ Extracted single slide object: ${parsed.slideId || 'unknown'}`);
                                }
                            } catch { /* truncated object, fall through */ }
                            complete = true;
                            break;
                        }
                    }
                }
            }

            if (!complete) {
                console.warn('⚠️ Single object was truncated mid-way — cannot repair');
            }

            if (slides.length > 0) return slides;
            throw new Error('Could not extract any complete slides from truncated response');
        }

        // ── Case 2: Array format [{...}, {...}] (Owl) ────────────────────────────
        const arrayStart = firstBracket!;
        let i = arrayStart + 1;

        while (i < jsonStr.length) {
            // Skip whitespace and commas between objects
            while (i < jsonStr.length && /[\s,]/.test(jsonStr[i])) {
                i++;
            }

            if (i >= jsonStr.length || jsonStr[i] === ']') break;

            // We should be at '{' — start of a slide object
            if (jsonStr[i] !== '{') {
                i++;
                continue;
            }

            const objStart = i;
            let depth = 0;
            let inString = false;
            let escape = false;
            let complete = false;

            for (let j = objStart; j < jsonStr.length; j++) {
                const char = jsonStr[j];

                if (escape) {
                    escape = false;
                    continue;
                }

                if (char === '\\' && inString) {
                    escape = true;
                    continue;
                }

                if (char === '"' && !escape) {
                    inString = !inString;
                    continue;
                }

                if (!inString) {
                    if (char === '{' || char === '[') {
                        depth++;
                    } else if (char === '}' || char === ']') {
                        depth--;
                        if (depth === 0) {
                            // Found complete object
                            const objStr = jsonStr.substring(objStart, j + 1);
                            try {
                                const parsed = JSON.parse(objStr);
                                // Validate it looks like a slide
                                if (parsed && (parsed.slideId || parsed.html || parsed.narration)) {
                                    slides.push(parsed);
                                    console.log(`✅ Extracted complete slide ${slides.length}: ${parsed.slideId || 'unknown'}`);
                                }
                            } catch (parseErr) {
                                console.warn(`⚠️ Found complete brackets but JSON invalid at position ${objStart}`);
                            }
                            i = j + 1;
                            complete = true;
                            break;
                        }
                    }
                }
            }

            if (!complete) {
                // Object was truncated — we've extracted all complete slides
                console.log(`⚠️ Hit truncated object at position ${objStart} — stopping extraction`);
                break;
            }
        }

        if (slides.length === 0) {
            throw new Error('Could not extract any complete slides from truncated response');
        }

        console.log(`✅ Successfully extracted ${slides.length} complete slides from truncated response`);
        return slides;
    }

    /**
     * Test API connection
     */
    async test(): Promise<void> {
        console.log(`🔗 Testing OpenRouter API with ${this.model}...`);

        const url = `${this.baseUrl}/chat/completions`;

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.getActiveKey()}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://ai-video-course-generator.vercel.app',
                'X-Title': 'AI Video Course Generator'
            },
            body: JSON.stringify({
                model: this.model,
                messages: [
                    {
                        role: 'user',
                        content: 'Reply with: OK'
                    }
                ],
                max_tokens: 10
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`OpenRouter test failed: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        if (!data || !data.choices || !data.choices[0] || !data.choices[0].message) {
            throw new Error(`OpenRouter returned invalid response structure: ${JSON.stringify(data)}`);
        }
        console.log('✅ OpenRouter API connected:', data.choices[0].message.content);
    }
}

export const openrouter = new OpenRouterClient();