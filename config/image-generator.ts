/**
 * Image Generator - Uses OpenRouter FLUX Models
 * Simple wrapper around OpenRouter client for consistency
 */




interface ImageGenerationOptions {
    prompt: string;
    width?: number;
    height?: number;
    aspectRatio?: '1:1' | '16:9' | '4:3' | '9:16';
}

class ImageGenerator {
    /**
     * Generate image using OpenRouter FLUX models
     * Automatic fallback chain: FLUX.2 Pro → FLUX.2 Flex → Contextual Gradient
     */
    async generate(options: ImageGenerationOptions): Promise<string> {
        const { prompt, width, height, aspectRatio = '16:9' } = options;

        console.log(`🎨 Image Generation Request:`, {
            prompt: prompt.substring(0, 100) + '...',
            size: width && height ? `${width}x${height}` : aspectRatio
        });

        try {
            // NOTE: OpenRouterClient does not support image generation.
            // Image generation is handled via generateRunwayImage (Nano Banana / Gemini).
            throw new Error("Image generation via OpenRouter is not implemented. Use generateRunwayImage instead.");
        } catch (error: any) {
            console.error('❌ Image generation failed:', error.message);
            throw error;
        }
    }

    /**
     * Enhance prompt for better AI generation
     */
    enhancePrompt(basePrompt: string): string {
        const enhancements = [
            'high quality',
            'professional illustration',
            'clean modern design',
            'vibrant colors',
            'detailed',
            '4K quality'
        ];

        const lowerPrompt = basePrompt.toLowerCase();
        const relevantEnhancements = enhancements.filter(
            e => !lowerPrompt.includes(e.toLowerCase())
        );

        if (relevantEnhancements.length > 0) {
            return `${basePrompt}, ${relevantEnhancements.slice(0, 3).join(', ')}`;
        }

        return basePrompt;
    }
}

export const imageGenerator = new ImageGenerator();