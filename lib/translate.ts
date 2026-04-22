/**
 * Script Translation Utility
 * Generates scripts in English (where Llama excels) then translates
 * narrations + title to the target language via Groq/Llama.
 * 
 * Translates SCENE BY SCENE to stay within Groq's free-tier TPM limits.
 * Each scene is ~300 tokens — well under the 6,000 TPM limit.
 */

import { groq } from '@/config/groq';

interface TranslationInput {
    videoTitle: string;
    narrations: string[];
    targetLanguage: string; // e.g. 'hi-IN'
}

interface TranslationResult {
    videoTitle: string;
    narrations: string[];
}

const LANGUAGE_NAMES: Record<string, string> = {
    'hi-IN': 'Hindi (Devanagari script — हिन्दी)',
    'bn-IN': 'Bengali (বাংলা)',
    'ta-IN': 'Tamil (தமிழ்)',
    'te-IN': 'Telugu (తెలుగు)',
    'mr-IN': 'Marathi (मराठी)',
    'gu-IN': 'Gujarati (ગુજરાતી)',
    'kn-IN': 'Kannada (ಕನ್ನಡ)',
    'ml-IN': 'Malayalam (മലയാളം)',
    'pa-IN': 'Punjabi (ਪੰਜਾਬੀ)',
    'ur-IN': 'Urdu (اردو)',
};

/**
 * Translate a single text from English to the target language.
 * Uses groq.text() for minimal token usage (~300 tokens per call).
 */
async function translateSingleText(
    text: string,
    langName: string,
    context: string = 'narration'
): Promise<string> {
    const MAX_RETRIES = 2;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const result = await groq.text(
                `You are a professional ${langName} translator. Translate the given English text to natural, conversational ${langName}. Output ONLY the translated text, nothing else. No quotes, no labels, no explanations.`,
                `Translate this English ${context} to ${langName}. Keep proper nouns, dates, and numbers intact. Use respectful honorifics where culturally appropriate. Output ONLY the translation:\n\n${text}`,
                {
                    model: 'llama-3.1-8b-instant',
                    temperature: 0.3,
                    maxTokens: 1024,
                }
            );

            const translated = result?.trim();
            if (translated && translated.length > 0) {
                return translated;
            }
            return text; // fallback to original
        } catch (error: any) {
            const isRateLimit = error.message?.includes('429') || error.message?.includes('rate_limit');

            if (isRateLimit && attempt < MAX_RETRIES) {
                console.warn(`⏳ Rate limited translating ${context}, waiting 10s...`);
                await new Promise(resolve => setTimeout(resolve, 10000));
                continue;
            }

            console.error(`❌ Failed to translate ${context}: ${error.message}`);
            return text; // fallback to original
        }
    }

    return text;
}

/**
 * Translates script narrations and videoTitle from English to the target language.
 * Translates SCENE BY SCENE to stay within Groq free-tier TPM limits.
 * 
 * Image prompts, video prompts, and other fields are kept in English
 * (they are consumed by AI image/video generators that work best in English).
 * 
 * Skips translation if target is English.
 */
export async function translateScript(
    input: TranslationInput
): Promise<TranslationResult> {
    const { videoTitle, narrations, targetLanguage } = input;

    // No translation needed for English
    if (!targetLanguage || targetLanguage.startsWith('en')) {
        return { videoTitle, narrations };
    }

    const langName = LANGUAGE_NAMES[targetLanguage] || targetLanguage;

    console.log(`🌐 Translating script to ${langName} (${narrations.length} scenes, one by one)...`);

    // Translate title first
    const translatedTitle = await translateSingleText(videoTitle, langName, 'video title');
    console.log(`  ✅ Title: "${translatedTitle.slice(0, 50)}..."`);

    // Translate each scene narration individually (~300 tokens each, under 6K TPM)
    const translatedNarrations: string[] = [];

    for (let i = 0; i < narrations.length; i++) {
        // Small delay between scenes to avoid hitting RPM limits
        if (i > 0) {
            await new Promise(resolve => setTimeout(resolve, 1500)); // 1.5s gap
        }

        const translated = await translateSingleText(
            narrations[i],
            langName,
            `scene ${i + 1} narration`
        );
        translatedNarrations.push(translated);
        console.log(`  ✅ Scene ${i + 1}/${narrations.length} translated`);
    }

    console.log(`✅ All translations complete for ${langName}`);

    return {
        videoTitle: translatedTitle,
        narrations: translatedNarrations,
    };
}
