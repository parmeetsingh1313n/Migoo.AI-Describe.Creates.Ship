import { NextRequest, NextResponse } from 'next/server';

/** Read all Sarvam API keys from env: SARVAM_API_KEY, SARVAM_API_KEY_2 … _10 */
function getSarvamKeys(): string[] {
    const keys: string[] = [];
    if (process.env.SARVAM_API_KEY) keys.push(process.env.SARVAM_API_KEY);
    for (let i = 2; i <= 10; i++) {
        const k = process.env[`SARVAM_API_KEY_${i}`];
        if (k) keys.push(k);
    }
    return keys;
}

/** Credit/auth/rate-limit errors that warrant rotating to the next key. */
function isSarvamKeyError(status: number, body: string): boolean {
    return status === 401 || status === 402 || status === 403 || status === 429 ||
        body.includes('Insufficient credits') || body.includes('insufficient_credits') ||
        body.includes('add more credits');
}

export async function POST(req: NextRequest) {
    try {
        const { text, speaker, language, pace, temperature } = await req.json();

        if (!text || !speaker || !language) {
            return NextResponse.json({ error: 'Missing text, speaker, or language' }, { status: 400 });
        }

        const keys = getSarvamKeys();
        if (keys.length === 0) {
            return NextResponse.json({ error: 'No SARVAM_API_KEY configured' }, { status: 500 });
        }

        let lastErr = '';
        for (let ki = 0; ki < keys.length; ki++) {
            const keyLabel = ki === 0 ? 'primary' : `key_${ki + 1}`;
            const response = await fetch('https://api.sarvam.ai/text-to-speech', {
                method: 'POST',
                headers: {
                    'api-subscription-key': keys[ki],
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
                lastErr = `${response.status}: ${errorText.slice(0, 120)}`;
                if (isSarvamKeyError(response.status, errorText) && ki < keys.length - 1) {
                    console.warn(`⚠️ TTS preview [${keyLabel}] ${lastErr} — rotating key...`);
                    continue;
                }
                console.error(`Sarvam TTS preview failed: ${errorText}`);
                return NextResponse.json({ error: 'TTS generation failed' }, { status: 500 });
            }

            const result = await response.json();
            if (!result.audios || result.audios.length === 0) {
                return NextResponse.json({ error: 'No audio returned' }, { status: 500 });
            }
            return NextResponse.json({ audio: result.audios[0] });
        }

        return NextResponse.json({ error: `TTS failed — all keys exhausted (${lastErr})` }, { status: 500 });
    } catch (error: any) {
        console.error('TTS Preview error:', error.message);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
