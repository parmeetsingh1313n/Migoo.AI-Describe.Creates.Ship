/**
 * AI Fallback Client
 * Uses Groq (llama-3.3-70b-versatile) as the primary AI provider
 * Gemini removed — Groq is now the sole provider
 */

import { groq } from "./groq";

interface AIOptions {
    model?: string;
    temperature?: number;
    maxOutputTokens?: number;
    maxTokens?: number;
    schema?: Record<string, any>;
}

class AIFallbackClient {
    private providers = [
        {
            name: 'groq',
            client: groq,
            test: async () => {
                try {
                    await groq.test?.();
                    return true;
                } catch {
                    return false;
                }
            }
        }
    ];

    /**
     * Generate JSON response with fallback between providers
     */
    async json(systemPrompt: string, userInput: string, options?: AIOptions): Promise<any> {
        const errors: string[] = [];

        for (const provider of this.providers) {
            console.log(`🔄 Trying ${provider.name}...`);

            try {
                // Check if provider is available
                const isAvailable = await provider.test();
                if (!isAvailable) {
                    console.log(`⏭️ ${provider.name} not available, skipping`);
                    continue;
                }

                let result;

                // Groq Responses API with text format — clean prompt to remove <json> tag
                // instructions since the model must output raw JSON, not XML-wrapped JSON.
                let cleanedPrompt = systemPrompt
                    .replace(/wrapped in <json> and <\/json> tags\.?/gi, 'as a raw JSON object.')
                    .replace(/wrapped in <json> tags:\s*/gi, '')
                    .replace(/Output ONLY the <json> block\.?/gi, 'Output ONLY the JSON object.')
                    .replace(/<\/?json>/g, '');

                let cleanedInput = userInput
                    .replace(/OUTPUT ONLY:\s*<json>\{[^}]*\}<\/json>/g, 'OUTPUT ONLY the JSON object.')
                    .replace(/<\/?json>/g, '');

                const groqSystemPrompt = `${cleanedPrompt}\n\nCRITICAL: Output ONLY valid JSON. No markdown code fences, no XML tags, no explanatory text. Start your response with { and end with }.`;

                result = await groq.json(groqSystemPrompt, cleanedInput, {
                    model: options?.model || 'llama-3.3-70b-versatile',
                    temperature: options?.temperature ?? 0.9,
                    maxTokens: options?.maxOutputTokens ?? 4096,
                    schema: options?.schema,
                });

                // Groq Responses API returns structured string — parse if needed.
                if (result && typeof result === 'object') {
                    // Already parsed - good
                } else if (typeof result === 'string') {
                    // Try to extract and parse JSON
                    const jsonMatch = result.match(/<json>([\s\S]*?)<\/json>/);
                    const jsonStr = jsonMatch ? jsonMatch[1].trim() : result.trim();

                    // Remove any leading/trailing non-JSON characters
                    const jsonStart = jsonStr.search(/[{\[]/);
                    // Find the last } or ]
                    const lastBrace = Math.max(jsonStr.lastIndexOf('}'), jsonStr.lastIndexOf(']'));
                    const jsonEnd = lastBrace !== -1 ? lastBrace + 1 : jsonStr.length;

                    if (jsonStart !== -1 && jsonEnd > jsonStart) {
                        const extractedJson = jsonStr.substring(jsonStart, jsonEnd);
                        try {
                            result = JSON.parse(extractedJson);
                        } catch (parseError: any) {
                            // Try one more time with the whole string
                            try {
                                result = JSON.parse(jsonStr);
                            } catch (finalError: any) {
                                throw new Error(`Failed to parse Groq response as JSON: ${finalError.message}`);
                            }
                        }
                    } else {
                        throw new Error('No JSON found in Groq response');
                    }
                }

                console.log(`✅ Success with ${provider.name}`);
                return result;

            } catch (error: any) {
                const errorMsg = `${provider.name} failed: ${error.message}`;
                console.error(`❌ ${errorMsg}`);
                errors.push(errorMsg);
                continue;
            }
        }

        throw new Error(`All AI providers failed:\n${errors.join('\n')}`);
    }

    /**
     * Test all providers
     */
    async test(): Promise<{ [key: string]: boolean }> {
        const results: { [key: string]: boolean } = {};

        for (const provider of this.providers) {
            try {
                const isAvailable = await provider.test();
                results[provider.name] = isAvailable;
                console.log(`${provider.name}: ${isAvailable ? '✅' : '❌'}`);
            } catch {
                results[provider.name] = false;
                console.log(`${provider.name}: ❌`);
            }
        }

        return results;
    }
}

export const aiFallback = new AIFallbackClient();