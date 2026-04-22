import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
    try {
        const { text, speaker, language, pace, temperature } = await req.json();

        if (!text || !speaker || !language) {
            return NextResponse.json({ error: 'Missing text, speaker, or language' }, { status: 400 });
        }

        const response = await fetch('https://api.sarvam.ai/text-to-speech', {
            method: 'POST',
            headers: {
                'api-subscription-key': process.env.SARVAM_API_KEY!,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                text,
                target_language_code: language,
                speaker,
                pace: pace ?? 1.05,
                speech_sample_rate: 22050,
                enable_preprocessing: true,
                model: "bulbul:v3",
                temperature: temperature ?? 0.7,
                output_audio_codec: "wav"
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Sarvam TTS preview failed: ${errorText}`);
            return NextResponse.json({ error: 'TTS generation failed' }, { status: 500 });
        }

        const result = await response.json();

        if (!result.audios || result.audios.length === 0) {
            return NextResponse.json({ error: 'No audio returned' }, { status: 500 });
        }

        return NextResponse.json({ audio: result.audios[0] });
    } catch (error: any) {
        console.error('TTS Preview error:', error.message);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
