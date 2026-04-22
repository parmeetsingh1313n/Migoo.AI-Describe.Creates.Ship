import { TextToSpeech } from '@capacitor-community/text-to-speech';
import { useCallback, useState } from 'react';

interface UseTTSOptions {
    lang?: string;
    rate?: number;
    pitch?: number;
    volume?: number;
    category?: 'ambient' | 'playback';
}

export const useTextToSpeech = (options: UseTTSOptions = {}) => {
    const [isSpeaking, setIsSpeaking] = useState(false);
    const [supportedLanguages, setSupportedLanguages] = useState<string[]>([]);
    const [supportedVoices, setSupportedVoices] = useState<any[]>([]);

    // Default options
    const defaultOptions = {
        lang: 'en-US',
        rate: 1.0,
        pitch: 1.0,
        volume: 1.0,
        category: 'ambient' as const,
        ...options
    };

    /**
     * Speak the given text
     */
    const speak = useCallback(async (text: string, customOptions?: UseTTSOptions) => {
        try {
            setIsSpeaking(true);

            await TextToSpeech.speak({
                text,
                lang: customOptions?.lang || defaultOptions.lang,
                rate: customOptions?.rate || defaultOptions.rate,
                pitch: customOptions?.pitch || defaultOptions.pitch,
                volume: customOptions?.volume || defaultOptions.volume,
                category: customOptions?.category || defaultOptions.category,
                queueStrategy: 1 // Add to queue
            });

            setIsSpeaking(false);
        } catch (error) {
            console.error('TTS Error:', error);
            setIsSpeaking(false);
            throw error;
        }
    }, [defaultOptions]);

    /**
     * Stop current speech
     */
    const stop = useCallback(async () => {
        try {
            await TextToSpeech.stop();
            setIsSpeaking(false);
        } catch (error) {
            console.error('TTS Stop Error:', error);
            throw error;
        }
    }, []);

    /**
     * Get list of supported languages
     */
    const getSupportedLanguages = useCallback(async () => {
        try {
            const { languages } = await TextToSpeech.getSupportedLanguages();
            setSupportedLanguages(languages);
            return languages;
        } catch (error) {
            console.error('Get Languages Error:', error);
            return [];
        }
    }, []);

    /**
     * Get list of supported voices
     */
    const getSupportedVoices = useCallback(async () => {
        try {
            const { voices } = await TextToSpeech.getSupportedVoices();
            setSupportedVoices(voices);
            return voices;
        } catch (error) {
            console.error('Get Voices Error:', error);
            return [];
        }
    }, []);

    /**
     * Check if a language is supported
     */
    const isLanguageSupported = useCallback(async (lang: string) => {
        try {
            const { supported } = await TextToSpeech.isLanguageSupported({ lang });
            return supported;
        } catch (error) {
            console.error('Language Support Check Error:', error);
            return false;
        }
    }, []);

    return {
        speak,
        stop,
        isSpeaking,
        getSupportedLanguages,
        getSupportedVoices,
        isLanguageSupported,
        supportedLanguages,
        supportedVoices
    };
};
