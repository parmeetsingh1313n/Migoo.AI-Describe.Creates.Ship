/**
 * Google Gemini API Configuration
 * Enhanced JSON parsing with HTML quote handling
 */

interface GeminiResponse {
    candidates: Array<{
        content: {
            parts: Array<{
                text: string;
            }>;
        };
    }>;
    usageMetadata?: {
        promptTokenCount: number;
        candidatesTokenCount: number;
        totalTokenCount: number;
    };
}

class GeminiClient {
    private apiKey: string;
    private baseUrl: string = 'https://generativelanguage.googleapis.com/v1beta';

    constructor() {
        this.apiKey = process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY_IMAGE || '';
        if (!this.apiKey) {
            throw new Error('Neither GEMINI_API_KEY nor GEMINI_API_KEY_IMAGE is set in environment variables');
        }
    }

    /**
     * Generate JSON response with robust HTML handling
     */
    async json(systemPrompt: string, userInput: string, options?: {
        model?: string;
        temperature?: number;
        maxOutputTokens?: number;
        /** Optional JSON Schema for structured output (guarantees valid JSON) */
        schema?: Record<string, any>;
    }): Promise<any> {
        const model = options?.model || 'gemini-2.5-flash';
        const temperature = options?.temperature ?? 0.7;
        const maxOutputTokens = options?.maxOutputTokens ?? 65536;
        const schema = options?.schema;

        console.log('🤖 Gemini API Request:', { model, temperature, maxOutputTokens, structured: !!schema });

        // When no schema is provided, remind the model to output pure JSON (object or array).
        // We intentionally do NOT force "array only" here — each caller dictates shape via its prompt.
        const combinedPrompt = schema
            ? `${systemPrompt}\n\nUSER REQUEST:\n${userInput}`
            : `${systemPrompt}\n\nUSER REQUEST:\n${userInput}\n\n---\nCRITICAL: output ONLY raw JSON (object or array). No markdown fences, no prose. Use single quotes for HTML attribute values to avoid escaping issues.`;

        // Build generation config — use structured output when schema provided
        const generationConfig: Record<string, any> = { temperature, maxOutputTokens };
        if (schema) {
            generationConfig.responseMimeType = 'application/json';
            generationConfig.responseSchema   = schema;
        }

        const requestBody = {
            contents: [{ parts: [{ text: combinedPrompt }] }],
            generationConfig,
        };

        try {
            const url = `${this.baseUrl}/models/${model}:generateContent?key=${this.apiKey}`;

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error('❌ Gemini API Error:', errorText);
                throw new Error(`Gemini API failed: ${response.status}`);
            }

            const data: GeminiResponse = await response.json();

            if (!data.candidates?.[0]?.content?.parts?.[0]?.text) {
                throw new Error('No content in Gemini response');
            }

            const rawText = data.candidates[0].content.parts[0].text;

            console.log('✅ Gemini response received:', {
                length: rawText.length,
                tokens: data.usageMetadata?.totalTokenCount
            });

            // Parse JSON from response
            return this.extractAndParseJSON(rawText);

        } catch (error: any) {
            console.error('❌ Gemini API Error:', error.message);
            throw error;
        }
    }

    /**
     * Extract and parse JSON — robust multi-strategy approach.
     * Handles: <json> XML wrappers, markdown fences, unescaped quotes,
     * literal newlines inside string values, and trailing commas.
     */
    private extractAndParseJSON(text: string): any {
        console.log('🔧 Extracting JSON from response...');

        let cleaned = text.trim();

        // ── Step 1: Strip XML wrapper tags (e.g. <json>…</json>) ──────────────
        cleaned = cleaned.replace(/<json>\s*/gi, '').replace(/\s*<\/json>/gi, '').trim();

        // ── Step 2: Strip markdown fences ─────────────────────────────────────
        cleaned = cleaned.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '').trim();

        // ── Step 3: Find the outermost JSON structure via bracket tracking ─────
        const arrayStart  = cleaned.indexOf('[');
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

        // Walk brackets to find exact end position
        const openChar  = cleaned[jsonStart];
        const closeChar = openChar === '[' ? ']' : '}';
        let depth  = 0;
        let inStr  = false;
        let esc    = false;
        let endIdx = -1;

        for (let i = jsonStart; i < cleaned.length; i++) {
            const c = cleaned[i];
            if (esc)        { esc = false; continue; }
            if (c === '\\') { esc = true;  continue; }
            if (c === '"')  { inStr = !inStr; continue; }
            if (!inStr) {
                if (c === openChar)  depth++;
                if (c === closeChar) { depth--; if (depth === 0) { endIdx = i; break; } }
            }
        }

        const jsonStr = endIdx !== -1
            ? cleaned.slice(jsonStart, endIdx + 1)
            : cleaned.slice(jsonStart);

        // ── Strategy 1: Direct JSON.parse ─────────────────────────────────────
        try {
            console.log('📝 Attempting parse strategy 1/3...');
            const result = JSON.parse(jsonStr);
            console.log('✅ Parse strategy 1 succeeded!');
            return result;
        } catch (e: any) {
            console.warn('⚠️ Strategy 1 failed:', e.message);
        }

        // ── Strategy 2: Flatten literal newlines then parse ──────────────────
        try {
            console.log('📝 Attempting parse strategy 2/4...');
            const flattened = jsonStr
                .replace(/\r?\n/g, ' ')          // real newlines → space
                .replace(/,(\s*[}\]])/g, '$1');  // trailing commas
            const result = JSON.parse(flattened);
            console.log('✅ Parse strategy 2 succeeded!');
            return result;
        } catch (e: any) {
            console.warn('⚠️ Strategy 2 failed:', e.message);
        }

        // ── Strategy 3: Smart string-value repair then parse ──────────────────
        // Fixes unescaped double-quotes inside JSON string values and
        // literal control characters that break JSON.parse.
        try {
            console.log('📝 Attempting parse strategy 3/4 (string repair)...');
            const repaired = this.repairJsonStrings(jsonStr);
            const result = JSON.parse(repaired);
            console.log('✅ Parse strategy 3 succeeded!');
            return result;
        } catch (e: any) {
            console.warn('⚠️ Strategy 3 failed:', e.message);
        }

        // ── Strategy 4: Regex field extraction (no JSON.parse) ───────────────
        try {
            console.log('📝 Attempting parse strategy 4/4 (regex extraction)...');
            const result = this.regexExtract(jsonStr);
            console.log('✅ Parse strategy 4 succeeded!');
            return result;
        } catch (e: any) {
            console.warn('⚠️ Strategy 4 failed:', e.message);
            throw new Error(`All parse strategies failed. Last error: ${e.message}`);
        }
    }

    /**
     * Repair unescaped double-quotes and control characters inside JSON string values.
     * Walks character-by-character and escapes any bare " found inside a value.
     */
    private repairJsonStrings(raw: string): string {
        let out    = '';
        let inStr  = false;
        let escape = false;
        // Replace literal tabs/newlines with spaces first
        const s = raw.replace(/\t/g, ' ').replace(/\r?\n/g, ' ');

        for (let i = 0; i < s.length; i++) {
            const c = s[i];
            if (escape) { out += c; escape = false; continue; }
            if (c === '\\') { out += c; escape = true; continue; }
            if (c === '"') {
                if (!inStr) {
                    // Opening quote of a JSON string
                    inStr = true;
                    out += c;
                } else {
                    // Could be closing quote or an unescaped inner quote
                    // Peek: if next non-space char is : , } ] then it's a real close
                    const rest = s.slice(i + 1).trimStart();
                    if (/^[:\,\}\]]/g.test(rest)) {
                        inStr = false;
                        out += c;
                    } else {
                        // Unescaped inner quote — escape it
                        out += '\\"';
                    }
                }
                continue;
            }
            out += c;
        }
        // Remove trailing commas before ] or }
        return out.replace(/,(\s*[}\]])/g, '$1');
    }

    /**
     * Regex-based field extractor — works without JSON.parse.
     * Handles: titles arrays, slides arrays, generic string arrays.
     */
    private regexExtract(jsonStr: string): any {
        // ── titles array (generate-angles) ────────────────────────────────────
        const titlesMatch = jsonStr.match(/"titles"\s*:\s*\[([\s\S]*?)\]/);
        if (titlesMatch) {
            const titles = [...titlesMatch[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)]
                .map(m => m[1].replace(/\\n/g, ' ').trim())
                .filter(Boolean);
            if (titles.length > 0) return { titles };
        }

        // ── generic string array at root level ────────────────────────────────
        if (jsonStr.trim().startsWith('[')) {
            const items = [...jsonStr.matchAll(/"((?:[^"\\]|\\.)*)"/g)]
                .map(m => m[1].replace(/\\n/g, ' ').trim())
                .filter(s => s.length > 5);
            if (items.length > 0) return items;
        }

        // ── slide objects ──────────────────────────────────────────────────────
        const slideRegex = /"slideId"\s*:\s*"([^"]+)"[\s\S]*?"slideIndex"\s*:\s*(\d+)[\s\S]*?"html"\s*:\s*"((?:[^"\\]|\\.)*?)"[\s\S]*?"narration"\s*:\s*\{[\s\S]*?"fullText"\s*:\s*"((?:[^"\\]|\\.)*?)"/g;
        const slides: any[] = [];
        let m;
        while ((m = slideRegex.exec(jsonStr)) !== null) {
            slides.push({
                slideId:    m[1],
                slideIndex: parseInt(m[2]),
                html:       m[3].replace(/\\n/g, '\n').replace(/\\"/g, '"'),
                narration:  { fullText: m[4].replace(/\\n/g, '\n').replace(/\\"/g, '"') },
            });
        }
        if (slides.length > 0) return slides;

        throw new Error('Could not extract any structured data from response');
    }

    /**
     * Test API connection
     */
    async test(): Promise<void> {
        console.log('🔗 Testing Gemini API...');

        const url = `${this.baseUrl}/models/gemini-2.5-flash:generateContent?key=${this.apiKey}`;

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                contents: [
                    {
                        parts: [
                            { text: 'Reply with: OK' }
                        ]
                    }
                ],
                generationConfig: {
                    maxOutputTokens: 10
                }
            })
        });

        if (!response.ok) {
            throw new Error(`Gemini test failed: ${response.status}`);
        }

        console.log('✅ Gemini API connected');
    }
}

export const gemini = new GeminiClient();