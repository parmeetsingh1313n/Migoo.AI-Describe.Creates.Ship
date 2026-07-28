// ═══════════════════════════════════════════════════════════════════════════════
// ENHANCED GROQ API CLIENT
// Uses Groq Chat Completions API with Llama models
// ═══════════════════════════════════════════════════════════════════════════════

interface GroqChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

interface GroqChatCompletionResponse {
    id: string;
    object: string;
    created: number;
    model: string;
    choices: Array<{
        index: number;
        message: {
            role: string;
            content: string;
        };
        finish_reason: string;
    }>;
    usage: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
}

interface JSONParseStrategy {
    name: string;
    parser: (text: string) => any;
}

/**
 * Enhanced Groq Client for Video Course Generation
 */
class EnhancedGroqClient {
    private apiKeys: string[];
    private currentKeyIndex: number = 0;
    private baseURL: string = 'https://api.groq.com/openai/v1';

    // Best models for different tasks
    private models = {
        // Primary model — Llama 3.3 70B on Groq
        primary: 'llama-3.3-70b-versatile',
        // Fallback if primary fails
        fallback: 'llama-3.1-8b-instant',
        // For testing
        test: 'llama-3.3-70b-versatile'
    };

    constructor() {
        // Support multiple keys: GROQ_API_KEYS (comma-separated) or single GROQ_API_KEY
        const multiKeys = process.env.GROQ_API_KEYS || '';
        const singleKey = process.env.GROQ_API_KEY || '';

        if (multiKeys) {
            this.apiKeys = multiKeys.split(',').map(k => k.trim()).filter(Boolean);
        } else if (singleKey) {
            this.apiKeys = [singleKey];
        } else {
            throw new Error('GROQ_API_KEY or GROQ_API_KEYS is required');
        }

        console.log(`🔑 Groq: ${this.apiKeys.length} API key(s) loaded`);
    }

    /** Get the current active API key */
    private get apiKey(): string {
        return this.apiKeys[this.currentKeyIndex];
    }

    /** Rotate to the next API key (round-robin) */
    rotateKey(): void {
        if (this.apiKeys.length <= 1) return;
        const prev = this.currentKeyIndex;
        this.currentKeyIndex = (this.currentKeyIndex + 1) % this.apiKeys.length;
        console.log(`🔄 Groq key rotated: ${prev + 1} → ${this.currentKeyIndex + 1} of ${this.apiKeys.length}`);
    }

    /** Check if an error is a rate limit error */
    private isRateLimitError(status: number, body: string): boolean {
        return status === 429 || status === 413 ||
            body.includes('rate_limit') ||
            body.includes('tokens per minute');
    }

    /**
     * Generate slides with bulletproof JSON parsing
     */
    async generateSlides(
        systemPrompt: string,
        userInput: string,
        options?: {
            model?: string;
            temperature?: number;
            maxTokens?: number;
        }
    ): Promise<any> {
        const model = options?.model || this.models.primary;
        const temperature = options?.temperature ?? 0.9;
        const maxTokens = options?.maxTokens ?? 8000;

        console.log('\n' + '═'.repeat(80));
        console.log('🤖 GROQ API REQUEST');
        console.log('═'.repeat(80));
        console.log('Model:', model);
        console.log('Temperature:', temperature);
        console.log('Max Tokens:', maxTokens);
        console.log('System Prompt:', systemPrompt.length, 'chars');
        console.log('User Input:', userInput.length, 'chars');
        console.log('═'.repeat(80));

        const messages: GroqChatMessage[] = [
            {
                role: 'system',
                content: systemPrompt
            },
            {
                role: 'user',
                content: userInput
            }
        ];

        try {
            const startTime = Date.now();

            const response = await fetch(`${this.baseURL}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model: model,
                    messages: messages,
                    temperature: temperature,
                    max_tokens: maxTokens,
                    top_p: 0.88,
                    frequency_penalty: 1.2,
                    presence_penalty: 0.9,
                    stream: false
                }),
                signal: AbortSignal.timeout(180000) // 3 minute timeout
            });

            const endTime = Date.now();
            const responseTime = ((endTime - startTime) / 1000).toFixed(2);

            if (!response.ok) {
                const errorText = await response.text();
                console.error('❌ Groq API Error:', errorText);
                throw new Error(`Groq API failed (${response.status}): ${errorText}`);
            }

            const data: GroqChatCompletionResponse = await response.json();

            console.log('✅ Response received in', responseTime, 'seconds');
            console.log('📊 Tokens:', {
                prompt: data.usage.prompt_tokens,
                completion: data.usage.completion_tokens,
                total: data.usage.total_tokens
            });

            if (!data.choices?.[0]?.message?.content) {
                throw new Error('No content in Groq response');
            }

            const rawContent = data.choices[0].message.content;
            console.log('📝 Raw response length:', rawContent.length, 'chars');
            console.log('📝 Response preview:', rawContent.substring(0, 200).replace(/\n/g, ' ') + '...');

            // Parse JSON with advanced strategies
            const parsed = await this.advancedJSONParse(rawContent);

            console.log('✅ JSON parsed successfully');
            console.log('═'.repeat(80) + '\n');

            return parsed;

        } catch (error: any) {
            console.error('❌ Groq API Error:', error.message);
            throw error;
        }
    }

    /**
     * Advanced JSON parsing with 8 fallback strategies
     */
    private async advancedJSONParse(text: string): Promise<any> {
        console.log('🔧 Advanced JSON parsing...');

        let cleaned = text.trim();

        // Remove XML-style <json> tags
        cleaned = cleaned.replace(/<json>\s*/gi, '');
        cleaned = cleaned.replace(/\s*<\/json>/gi, '');

        // Remove markdown code blocks
        cleaned = cleaned.replace(/^```(?:json)?\s*/i, '');
        cleaned = cleaned.replace(/```\s*$/i, '');
        cleaned = cleaned.trim();

        // Define parsing strategies
        const strategies: JSONParseStrategy[] = [
            {
                name: 'Direct Parse',
                parser: (t: string) => JSON.parse(t)
            },
            {
                name: 'Extract Boundaries',
                parser: (t: string) => this.extractJSONBoundaries(t)
            },
            {
                name: 'Fix HTML Quotes',
                parser: (t: string) => this.fixHTMLQuotes(t)
            },
            {
                name: 'Fix Trailing Commas',
                parser: (t: string) => this.fixTrailingCommas(t)
            },
            {
                name: 'Fix Escaping',
                parser: (t: string) => this.fixEscaping(t)
            },
            {
                name: 'Aggressive Cleanup',
                parser: (t: string) => this.aggressiveCleanup(t)
            },
            {
                name: 'Balance Brackets',
                parser: (t: string) => this.balanceBrackets(t)
            },
            {
                name: 'Manual Extraction',
                parser: (t: string) => this.manualExtraction(t)
            }
        ];

        // Try each strategy
        for (let i = 0; i < strategies.length; i++) {
            const strategy = strategies[i];

            try {
                console.log(`📝 Strategy ${i + 1}/${strategies.length}: ${strategy.name}`);
                const result = strategy.parser(cleaned);

                if (this.isValidParsedJSON(result)) {
                    console.log(`✅ Success with ${strategy.name}`);
                    return result;
                } else {
                    console.warn(`⚠️ ${strategy.name} produced invalid structure`);
                }

            } catch (error: any) {
                console.warn(`⚠️ ${strategy.name} failed: ${error.message.substring(0, 80)}`);

                if (i === strategies.length - 1) {
                    console.error('❌ All strategies failed');
                    console.error('First 500 chars:', cleaned.substring(0, 500));
                    console.error('Last 200 chars:', cleaned.substring(Math.max(0, cleaned.length - 200)));
                    throw new Error(`All ${strategies.length} parsing strategies failed`);
                }
            }
        }

        throw new Error('JSON parsing failed');
    }

    /**
     * Strategy 1: Extract JSON boundaries
     */
    private extractJSONBoundaries(text: string): any {
        const arrayStart = text.indexOf('[');
        const objectStart = text.indexOf('{');

        let startIdx = -1;
        if (arrayStart !== -1 && (objectStart === -1 || arrayStart < objectStart)) {
            startIdx = arrayStart;
        } else if (objectStart !== -1) {
            startIdx = objectStart;
        }

        if (startIdx === -1) {
            throw new Error('No JSON start found');
        }

        const extracted = text.substring(startIdx);
        return JSON.parse(extracted);
    }

    /**
     * Strategy 2: Fix HTML quotes
     */
    private fixHTMLQuotes(text: string): any {
        let fixed = text;

        // Fix "html": "..." fields
        const htmlFieldRegex = /"html":\s*"((?:[^"\\]|\\.)*)"/g;

        fixed = fixed.replace(htmlFieldRegex, (match, htmlContent) => {
            let fixedHtml = htmlContent;
            // Convert double quotes in attributes to single quotes
            fixedHtml = fixedHtml.replace(/\s+([\w-]+)="([^"]*)"/g, ' $1=\'$2\'');
            return `"html": "${fixedHtml}"`;
        });

        return JSON.parse(fixed);
    }

    /**
     * Strategy 3: Fix trailing commas
     */
    private fixTrailingCommas(text: string): any {
        let fixed = text
            .replace(/,(\s*[\]}])/g, '$1')
            .replace(/,(\s*$)/g, '');

        return JSON.parse(fixed);
    }

    /**
     * Strategy 4: Fix escaping
     */
    private fixEscaping(text: string): any {
        let fixed = text
            .replace(/([^\\])\n/g, '$1\\n')
            .replace(/\t/g, '\\t');

        return JSON.parse(fixed);
    }

    /**
     * Strategy 5: Aggressive cleanup
     */
    private aggressiveCleanup(text: string): any {
        let fixed = text
            .split('\n')
            .map(line => line.trim())
            .join(' ')
            .replace(/\s+/g, ' ')
            .replace(/,(\s*[\]}])/g, '$1')
            .replace(/\/\/.*$/gm, '')
            .replace(/\/\*[\s\S]*?\*\//g, '');

        return JSON.parse(fixed);
    }

    /**
     * Strategy 6: Balance brackets
     */
    private balanceBrackets(text: string): any {
        let fixed = text.trim();

        const openBraces = (fixed.match(/\{/g) || []).length;
        const closeBraces = (fixed.match(/\}/g) || []).length;
        const openBrackets = (fixed.match(/\[/g) || []).length;
        const closeBrackets = (fixed.match(/\]/g) || []).length;

        for (let i = 0; i < (openBrackets - closeBrackets); i++) fixed += ']';
        for (let i = 0; i < (openBraces - closeBraces); i++) fixed += '}';

        console.log(`   Balanced: +${openBrackets - closeBrackets} ], +${openBraces - closeBraces} }`);

        return JSON.parse(fixed);
    }

    /**
     * Strategy 7: Manual extraction
     */
    private manualExtraction(text: string): any {
        console.log('🆘 Manual extraction...');

        const slides: any[] = [];
        const slidePattern = /\{[^{}]*"slideId"[^{}]*"slideIndex"[^{}]*"html"[^{}]*"narration"[^{}]*"revealData"[^{}]*\}/g;

        const matches = text.match(slidePattern);

        if (!matches || matches.length === 0) {
            throw new Error('Manual extraction found no slides');
        }

        for (const match of matches) {
            try {
                const slide = JSON.parse(match);
                slides.push(slide);
            } catch (e) {
                console.warn('   Failed to parse extracted slide');
            }
        }

        if (slides.length === 0) {
            throw new Error('Manual extraction parsed no valid slides');
        }

        console.log(`   Extracted ${slides.length} slides`);
        return slides;
    }

    /**
     * Validate parsed JSON
     */
    private isValidParsedJSON(result: any): boolean {
        if (!result) return false;

        const slides = Array.isArray(result) ? result : [result];

        if (slides.length === 0) return false;

        const firstSlide = slides[0];

        return Boolean(
            firstSlide.slideId &&
            firstSlide.slideIndex !== undefined &&
            firstSlide.html &&
            firstSlide.narration?.fullText &&
            Array.isArray(firstSlide.revealData)
        );
    }

    /**
     * Generate JSON response (general purpose, no slide validation)
     * Uses /chat/completions with response_format for reliable JSON output
     */
    async json(systemPrompt: string, userInput: string, options?: {
        model?: string;
        temperature?: number;
        maxTokens?: number;
        schema?: any;
    }): Promise<any> {
        const model = options?.model || this.models.primary;
        const temperature = options?.temperature ?? 0.9;
        const maxTokens = options?.maxTokens ?? 4096;
        const schema = options?.schema;

        console.log('\n' + '═'.repeat(80));
        console.log('🤖 GROQ CHAT COMPLETIONS REQUEST (JSON MODE)');
        console.log('═'.repeat(80));
        console.log('Model:', model);
        console.log('Temperature:', temperature);
        console.log('Max Tokens:', maxTokens);
        console.log('Schema:', schema ? 'provided (embedded in prompt)' : 'none');

        try {
            const startTime = Date.now();

            // Build system prompt with schema instructions embedded
            let enhancedSystemPrompt = systemPrompt;
            if (schema) {
                enhancedSystemPrompt += `\n\nYou MUST respond with a JSON object that conforms to this schema:\n${JSON.stringify(schema, null, 2)}\n\nOutput ONLY valid JSON. No markdown, no code fences, no explanation.`;
                console.log('📋 Schema embedded in system prompt for JSON mode');
            }

            const messages: GroqChatMessage[] = [
                {
                    role: 'system',
                    content: enhancedSystemPrompt
                },
                {
                    role: 'user',
                    content: userInput
                }
            ];

            const requestBody: any = {
                model: model,
                messages: messages,
                temperature: temperature,
                max_tokens: maxTokens,
                top_p: 0.88,
                frequency_penalty: 1.2,
                presence_penalty: 0.9,
                stream: false,
                response_format: { type: 'json_object' },
            };

            const response = await fetch(`${this.baseURL}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestBody),
                signal: AbortSignal.timeout(180000) // 3 minute timeout
            });

            const endTime = Date.now();
            const responseTime = ((endTime - startTime) / 1000).toFixed(2);

            if (!response.ok) {
                const errorText = await response.text();
                console.error('❌ Groq API Error:', errorText);

                // On rate limit, rotate key for next call
                if (this.isRateLimitError(response.status, errorText)) {
                    this.rotateKey();
                }

                throw new Error(`Groq API failed (${response.status}): ${errorText}`);
            }

            const data: GroqChatCompletionResponse = await response.json();

            console.log('✅ Response received in', responseTime, 'seconds');
            console.log('📊 Tokens:', {
                prompt: data.usage.prompt_tokens,
                completion: data.usage.completion_tokens,
                total: data.usage.total_tokens
            });

            if (!data.choices?.[0]?.message?.content) {
                throw new Error('No content in Groq response');
            }

            const rawContent = data.choices[0].message.content;
            console.log('📝 Raw response length:', rawContent.length, 'chars');

            // Simple JSON parsing
            let cleaned = rawContent.trim();

            // Remove XML-style <json> tags
            cleaned = cleaned.replace(/<json>\s*/gi, '');
            cleaned = cleaned.replace(/\s*<\/json>/gi, '');

            // Remove markdown code blocks
            cleaned = cleaned.replace(/^```(?:json)?\s*/i, '');
            cleaned = cleaned.replace(/```\s*$/i, '');
            cleaned = cleaned.trim();

            // Find JSON start
            const jsonStart = cleaned.search(/[{\[]/);
            if (jsonStart === -1) {
                throw new Error('No JSON found in response');
            }

            // Extract JSON
            const jsonStr = cleaned.substring(jsonStart);

            // Parse JSON
            try {
                const result = JSON.parse(jsonStr);
                console.log('✅ JSON parsed successfully');
                return result;
            } catch (parseError: any) {
                // Try to fix common JSON issues
                const fixedJson = jsonStr
                    .replace(/,(\s*[}\]])/g, '$1') // Remove trailing commas
                    .replace(/'/g, '"') // Replace single quotes with double quotes
                    .replace(/\\n/g, ' ') // Replace literal newlines with spaces
                    .replace(/\\"/g, '"') // Fix escaped quotes
                    .replace(/\\'/g, "'"); // Fix escaped single quotes

                try {
                    const result = JSON.parse(fixedJson);
                    console.log('✅ JSON parsed after fixing common issues');
                    return result;
                } catch (finalError: any) {
                    console.error('❌ Failed to parse JSON even after fixes:', finalError.message);
                    console.error('First 500 chars of response:', rawContent.substring(0, 500));
                    throw new Error(`Failed to parse Groq JSON response: ${finalError.message}`);
                }
            }

        } catch (error: any) {
            console.error('❌ Groq JSON generation failed:', error.message);
            throw error;
        }
    }

    /**
     * Convert a schema to strict mode: all fields required, additionalProperties: false
     */
    private makeStrictSchema(schema: any): any {
        if (!schema || typeof schema !== 'object') return schema;

        const result = { ...schema };

        if (result.type === 'object' && result.properties) {
            result.required = Object.keys(result.properties);
            result.additionalProperties = false;

            for (const key of Object.keys(result.properties)) {
                result.properties[key] = this.makeStrictSchema(result.properties[key]);
            }
        }

        if (result.type === 'array' && result.items) {
            result.items = this.makeStrictSchema(result.items);
        }

        // Handle nullable fields: convert { type: 'string', nullable: true } to { type: ['string', 'null'] }
        if (result.nullable) {
            delete result.nullable;
            result.type = [result.type, 'null'];
        }

        return result;
    }

    /**
     * Generate text response (non-JSON, free-form text)
     * Uses /chat/completions for reliable text output
     */
    async text(systemPrompt: string, userInput: string, options?: {
        model?: string;
        temperature?: number;
        maxTokens?: number;
    }): Promise<string> {
        const model = options?.model || this.models.primary;
        const temperature = options?.temperature ?? 0.85;
        const maxTokens = options?.maxTokens ?? 4096;

        console.log('🤖 Groq text request:', { model, temperature, maxTokens });

        const messages: GroqChatMessage[] = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userInput }
        ];

        const response = await fetch(`${this.baseURL}/chat/completions`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model,
                messages,
                temperature,
                max_tokens: maxTokens,
                top_p: 0.88,
                frequency_penalty: 1.2,
                presence_penalty: 0.9,
                stream: false,
            }),
            signal: AbortSignal.timeout(180000)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Groq text generation failed (${response.status}): ${errorText}`);
        }

        const data: GroqChatCompletionResponse = await response.json();
        const rawContent = data?.choices?.[0]?.message?.content?.trim() || '';

        if (!rawContent) throw new Error('No text content in Groq response');

        return rawContent;
    }

    /**
     * Caption an image using Groq vision (chat/completions with image_url)
     * Uses qwen/qwen3.6-27b for vision tasks (llama-4-scout was deprecated/removed by Groq)
     */
    async captionImage(imageUrl: string, prompt: string, options?: {
        model?: string;
        temperature?: number;
        maxTokens?: number;
    }): Promise<string> {
        const model = options?.model || 'qwen/qwen3.6-27b';
        const temperature = options?.temperature ?? 0.3;
        const maxTokens = options?.maxTokens ?? 600;

        console.log('🔍 Groq vision request:', { model, imageUrl: imageUrl.slice(0, 60) + '...' });

        const response = await fetch(`${this.baseURL}/chat/completions`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model,
                messages: [
                    {
                        role: 'user',
                        content: [
                            { type: 'text', text: prompt },
                            {
                                type: 'image_url',
                                image_url: { url: imageUrl }
                            },
                        ],
                    },
                ],
                temperature,
                max_completion_tokens: maxTokens,
                stream: false,
            }),
            signal: AbortSignal.timeout(60000)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Groq vision failed (${response.status}): ${errorText}`);
        }

        const data = await response.json();
        const rawContent = data?.choices?.[0]?.message?.content?.trim() || "";

        if (!rawContent) throw new Error('No content in Groq vision response');

        console.log(`✅ Groq vision caption: "${rawContent.slice(0, 100)}..."`);
        return rawContent;
    }

    /**
     * Test API connection
     */
    async test(): Promise<void> {
        console.log('🔗 Testing Groq API...');

        try {
            const response = await fetch(`${this.baseURL}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: this.models.test,
                    messages: [{ role: 'user', content: 'Reply with: OK' }],
                    max_tokens: 10,
                    stream: false
                }),
                signal: AbortSignal.timeout(30000)
            });

            if (!response.ok) {
                throw new Error(`Test failed: ${response.status}`);
            }

            console.log('✅ Groq API connected');

        } catch (error: any) {
            console.error('❌ Groq test failed:', error.message);
            throw error;
        }
    }
}

// Export singleton instance
let groqInstance: EnhancedGroqClient | null = null;

export function getGroqClient(): EnhancedGroqClient {
    if (!groqInstance) {
        groqInstance = new EnhancedGroqClient();
    }
    return groqInstance;
}

// Export convenient wrapper
export const groq = {
    /**
     * Generate slides (main method)
     */
    async generateSlides(
        systemPrompt: string,
        userInput: string,
        options?: {
            model?: string;
            temperature?: number;
            maxTokens?: number;
        }
    ) {
        const client = getGroqClient();
        return client.generateSlides(systemPrompt, userInput, options);
    },

    /**
     * Generate JSON response (general purpose)
     */
    async json(
        systemPrompt: string,
        userInput: string,
        options?: {
            model?: string;
            temperature?: number;
            maxTokens?: number;
            schema?: any;
        }
    ) {
        const client = getGroqClient();
        return client.json(systemPrompt, userInput, options);
    },

    /**
     * Generate text response (free-form text, non-JSON)
     */
    async text(
        systemPrompt: string,
        userInput: string,
        options?: {
            model?: string;
            temperature?: number;
            maxTokens?: number;
        }
    ) {
        const client = getGroqClient();
        return client.text(systemPrompt, userInput, options);
    },

    /**
     * Caption an image using Groq vision
     */
    async captionImage(
        imageUrl: string,
        prompt: string,
        options?: {
            model?: string;
            temperature?: number;
            maxTokens?: number;
        }
    ) {
        const client = getGroqClient();
        return client.captionImage(imageUrl, prompt, options);
    },

    /**
     * Test connection
     */
    async test() {
        const client = getGroqClient();
        return client.test();
    }
};