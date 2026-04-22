import { putWithRotation } from "@/lib/blob";

/**
 * Generate an image using Clipdrop Text-to-Image API.
 * This is used for generating thumbnails for testing purposes.
 *
 * @param prompt  - The image generation prompt
 * @returns       - A permanent Vercel Blob URL to the generated image
 */
export async function generateClipdropImage(prompt: string): Promise<string> {
    const apiKey = process.env.JASPER_API_KEY;
    if (!apiKey) {
        throw new Error("JASPER_API_KEY is not set in environment variables");
    }

    console.log(`🖼️ Calling Clipdrop API for text-to-image...`);
    console.log(`   Prompt: "${prompt.substring(0, 100)}..."`);

    // Only max 1000 characters
    const safePrompt = prompt.substring(0, 1000);

    const form = new FormData();
    form.append('prompt', safePrompt);

    try {
        const response = await fetch('https://clipdrop-api.co/text-to-image/v1', {
            method: 'POST',
            headers: {
                'x-api-key': apiKey,
            },
            body: form,
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Clipdrop API error (${response.status}): ${errorText}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        const imageBuffer = Buffer.from(arrayBuffer);
        
        console.log(`✅ Clipdrop generated image: ${imageBuffer.length} bytes (image/png)`);

        // Upload to Vercel Blob for permanent storage
        const filename = `clipdrop/thumbnail_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.png`;
        const blob = await putWithRotation(filename, imageBuffer, {
            access: "public",
            contentType: "image/png",
        });

        console.log(`✅ Uploaded to Vercel Blob: ${blob.url}`);
        return blob.url;

    } catch (error: any) {
        console.error(`❌ Clipdrop image generation failed: ${error.message || String(error)}`);
        throw error;
    }
}
