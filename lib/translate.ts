/**
 * Script Translation Utility
 * Generates scripts in English then translates narrations + title
 * to the target language.
 *
 * PIPELINE ORDER:
 * 1. Try z-ai/glm-5.2 via NVIDIA (primary).
 * 2. If it fails (due to rate limit, etc.),
 *    immediately fall back to Groq Llama 3.3 70B (llama-3.3-70b-versatile)
 *    for a fast, high-quality, and robust translation.
 */

import { shortsLLM } from '@/lib/shorts-llm';
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

export const LANGUAGE_NAMES: Record<string, string> = {
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
 * First tries OpenAI, falls back directly to Groq Llama-3.3-70B on error.
 */
export async function translateSingleText(
    text: string,
    langName: string,
    context: string = 'narration'
): Promise<string> {
    const systemPrompt = `You are a professional ${langName} translator. Translate the given English text to natural, conversational ${langName}. Output ONLY the translated text, nothing else. No quotes, no labels, no explanations.`;
    const userPrompt = `Translate this English ${context} to ${langName}. Keep proper nouns, dates, and numbers intact. IMPORTANT: Always preserve respectful honorifics for spiritual/religious figures (e.g. "Ji", "Sahib", "PBUH", "AS") — never drop them. Output ONLY the translation:\n\n${text}`;

    // 1. Try GLM-5.2 via NVIDIA (primary — best multilingual)
    try {
        console.log(`🤖 [translate] Trying GLM-5.2 via NVIDIA for ${context}...`);
        const result = await shortsLLM.translate(
            systemPrompt,
            userPrompt,
            {
                temperature: 0.3,
                maxTokens: 1024,
            }
        );

        const translated = result?.trim();
        if (translated && translated.length > 0) {
            console.log(`✅ [translate] Success with GLM-5.2 via NVIDIA`);
            return translated;
        }
    } catch (error: any) {
        console.warn(`⚠️ [translate] NVIDIA GLM-5.2 failed: ${error.message}. Shifting to Groq...`);
    }

    // 2. Fallback: Shift directly to Groq Llama 3.3 70B!
    try {
        console.log(`⚡ [translate] Falling back to Groq llama-3.3-70b-versatile for ${context}...`);
        const result = await groq.text(
            systemPrompt,
            userPrompt,
            {
                model: 'llama-3.3-70b-versatile',
                temperature: 0.3,
                maxTokens: 1024,
            }
        );

        const translated = result?.trim();
        if (translated && translated.length > 0) {
            console.log(`✅ [translate] Success with Groq Llama 3.3 70B`);
            return translated;
        }
    } catch (groqError: any) {
        console.error(`❌ [translate] Groq fallback also failed: ${groqError.message}`);
    }

    // Ultimate safety fallback: return original English text
    return text;
}

/**
 * Translates script narrations and videoTitle from English to the target language.
 * Translates SCENE BY SCENE for best quality output.
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

    // Translate each scene narration individually
    const translatedNarrations: string[] = [];

    for (let i = 0; i < narrations.length; i++) {
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
