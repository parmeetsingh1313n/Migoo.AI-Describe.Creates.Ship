import { SarvamAIClient } from "sarvamai";
import fetch from "node-fetch";

/**
 * Read all Sarvam API keys from process.env at call-time (never cached).
 * Supports: SARVAM_API_KEY, SARVAM_API_KEY_2, SARVAM_API_KEY_3, ...
 */
function getSarvamApiKeys(): string[] {
    const keys: string[] = [];
    if (process.env.SARVAM_API_KEY) keys.push(process.env.SARVAM_API_KEY);
    for (let i = 2; i <= 10; i++) {
        const k = process.env[`SARVAM_API_KEY_${i}`];
        if (k) keys.push(k);
    }
    return keys;
}

class SarvamClient {
    private currentKeyIndex = 0;

    constructor() {
        // No key caching here — always read fresh from process.env at call time
    }

    /** Get current active key or throw. Re-reads process.env on every call. */
    private getActiveKey(): string {
        const keys = getSarvamApiKeys();
        if (keys.length === 0) throw new Error('No SARVAM_API_KEY set in environment variables');
        // Ensure index is in bounds
        const idx = this.currentKeyIndex % keys.length;
        return keys[idx];
    }

    /** Get fresh SarvamAIClient using the current active key. */
    private getClient(): SarvamAIClient {
        return new SarvamAIClient({ apiSubscriptionKey: this.getActiveKey() });
    }


    /**
     * Transcribe audio using Sarvam AI Speech-to-Text
     * Returns word-level timestamps for precise caption generation
     */
    async transcribeAudio(audioUrl: string, languageCode: string = "en-IN"): Promise<{
        text: string;
        words: Array<{ text: string; start: number; end: number; }>;
        languageCode: string;
    }> {
        console.log('🎤 Starting Sarvam AI Speech-to-Text...');
        console.log('📍 Audio URL:', audioUrl);
        console.log('🌐 Language Code:', languageCode);

        const keys = getSarvamApiKeys();
        if (keys.length === 0) throw new Error('No SARVAM_API_KEY set in environment variables');

        let audioBuffer: Buffer;
        try {
            // Step 1: Download audio from URL (independent of Sarvam API Key)
            console.log('📥 Downloading audio file...');
            const audioResponse = await fetch(audioUrl);
            if (!audioResponse.ok) {
                throw new Error(`Failed to download audio: ${audioResponse.status}`);
            }
            // Use arrayBuffer() or buffer() with fallback to support both
            if (typeof audioResponse.arrayBuffer === 'function') {
                audioBuffer = Buffer.from(await audioResponse.arrayBuffer());
            } else {
                audioBuffer = await audioResponse.buffer();
            }
            console.log(`✅ Downloaded: ${audioBuffer.length} bytes`);
        } catch (downloadError: any) {
            console.error('❌ Failed to download audio:', downloadError.message);
            throw downloadError;
        }

        const tempFileName = `temp_${Date.now()}.wav`;
        let transcriptionResult: any = null;
        let lastError: any = null;

        for (let attempt = 0; attempt < keys.length; attempt++) {
            const ki = (this.currentKeyIndex + attempt) % keys.length;
            const apiKey = keys[ki];
            const keyLabel = ki === 0 ? "primary" : `key_${ki + 1}`;
            console.log(`🔑 Using Sarvam key for STT: [${keyLabel}] (${apiKey.substring(0, 10)}...)`);

            try {
                const client = new SarvamAIClient({ apiSubscriptionKey: apiKey });

                // Step 3: Create batch job for transcription
                console.log('🔄 Creating Sarvam AI batch job...');
                const job = await client.speechToTextJob.createJob({
                    model: "saaras:v3",
                    // @ts-ignore
                    mode: "transcribe", // transcribe mode (not translate)
                    languageCode: languageCode as any, // Use provided language code
                    withDiarization: false, // No speaker separation needed
                    numSpeakers: 1
                });

                console.log('✅ Batch job created');

                // Step 4: Upload audio buffer as file
                console.log('📤 Uploading audio to Sarvam AI...');

                // Create a temporary file from buffer
                const fs = require('fs');
                const path = require('path');
                const os = require('os');

                const tempDir = os.tmpdir();
                const tempFilePath = path.join(tempDir, tempFileName);

                // Write buffer to temp file
                fs.writeFileSync(tempFilePath, audioBuffer);
                console.log(`📝 Temp file created: ${tempFilePath}`);

                // Upload file to job
                await job.uploadFiles([tempFilePath]);
                console.log('✅ Audio uploaded');

                // Step 5: Start processing
                console.log('⚙️ Starting transcription job...');
                await job.start();
                console.log('✅ Job started');

                // Step 6: Wait for completion
                console.log('⏳ Waiting for transcription to complete...');
                await job.waitUntilComplete();
                console.log('✅ Transcription complete!');

                // Step 7: Get results
                console.log('📊 Fetching results...');
                const fileResults = await job.getFileResults();

                // Clean up temp file
                try {
                    fs.unlinkSync(tempFilePath);
                    console.log('🗑️ Temp file cleaned up');
                } catch (e) {
                    console.warn('⚠️ Could not delete temp file:', e);
                }

                // Check for failures
                if (fileResults.failed.length > 0) {
                    const error = fileResults.failed[0];
                    throw new Error(`Transcription failed: ${error.error_message}`);
                }

                if (fileResults.successful.length === 0) {
                    throw new Error('No successful transcription results');
                }

                // Step 8: Download and parse output
                console.log('📥 Downloading transcription output...');
                const outputDir = path.join(tempDir, `sarvam_output_${Date.now()}`);
                fs.mkdirSync(outputDir, { recursive: true });

                await job.downloadOutputs(outputDir);
                console.log(`✅ Output downloaded to: ${outputDir}`);

                // Step 9: Read the JSON output
                const outputFiles = fs.readdirSync(outputDir);
                const jsonFile = outputFiles.find((f: string) => f.endsWith('.json'));

                if (!jsonFile) {
                    throw new Error('No JSON output file found');
                }

                const outputPath = path.join(outputDir, jsonFile);
                const outputData = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));

                console.log('📄 Output structure:', Object.keys(outputData));

                // Step 10: Extract word-level timestamps
                const fullText = outputData.transcript || outputData.text || '';
                const words = this.extractWordsFromSarvamOutput(outputData);

                console.log(`✅ Transcription complete: ${words.length} words`);
                console.log(`📝 Full text length: ${fullText.length} chars`);

                // Clean up output directory
                try {
                    fs.rmSync(outputDir, { recursive: true, force: true });
                    console.log('🗑️ Output directory cleaned up');
                } catch (e) {
                    console.warn('⚠️ Could not delete output directory:', e);
                }

                transcriptionResult = {
                    text: fullText,
                    words: words,
                    languageCode: languageCode
                };

                // Success! Set our active working key index
                this.currentKeyIndex = ki;
                if (ki > 0) {
                    console.log(`✅ Sarvam STT succeeded with [${keyLabel}] after rotation.`);
                }

                break; // Job succeeded, exit rotation loop
            } catch (error: any) {
                console.warn(`⚠️ Sarvam STT [${keyLabel}] error: ${error.message} — rotating key...`);
                lastError = error;
                // Move working key index to next key
                this.currentKeyIndex = (ki + 1) % keys.length;
            }
        }

        if (!transcriptionResult) {
            throw lastError || new Error(`Sarvam STT failed: All ${keys.length} keys exhausted.`);
        }

        return transcriptionResult;
    }

    /**
     * Extract word-level timestamps from Sarvam AI output
     */
    private extractWordsFromSarvamOutput(outputData: any): Array<{ text: string; start: number; end: number; }> {
        const words: Array<{ text: string; start: number; end: number; }> = [];

        // Try different possible output formats
        if (outputData.words && Array.isArray(outputData.words)) {
            // Format 1: Direct words array
            for (const word of outputData.words) {
                words.push({
                    text: word.word || word.text || '',
                    start: word.start || word.start_time || 0,
                    end: word.end || word.end_time || 0
                });
            }
        } else if (outputData.segments && Array.isArray(outputData.segments)) {
            // Format 2: Segments with words
            for (const segment of outputData.segments) {
                if (segment.words && Array.isArray(segment.words)) {
                    for (const word of segment.words) {
                        words.push({
                            text: word.word || word.text || '',
                            start: word.start || word.start_time || 0,
                            end: word.end || word.end_time || 0
                        });
                    }
                }
            }
        } else if (outputData.results && Array.isArray(outputData.results)) {
            // Format 3: Results array
            for (const result of outputData.results) {
                if (result.alternatives && Array.isArray(result.alternatives)) {
                    const alt = result.alternatives[0];
                    if (alt.words && Array.isArray(alt.words)) {
                        for (const word of alt.words) {
                            words.push({
                                text: word.word || word.text || '',
                                start: word.start || word.start_time || 0,
                                end: word.end || word.end_time || 0
                            });
                        }
                    }
                }
            }
        }

        // If no words found, try to split text with estimated timestamps
        if (words.length === 0 && outputData.transcript) {
            console.warn('⚠️ No word-level timestamps found, using fallback');
            const text = outputData.transcript;
            const wordTexts = text.split(/\s+/);
            const avgDuration = 0.5; // 0.5 seconds per word average

            wordTexts.forEach((wordText: string, i: number) => {
                words.push({
                    text: wordText,
                    start: i * avgDuration,
                    end: (i + 1) * avgDuration
                });
            });
        }

        console.log(`📊 Extracted ${words.length} words with timestamps`);
        return words;
    }



    /**
     * Test connection
     */
    async test(): Promise<void> {
        console.log('🔗 Testing Sarvam AI...');
        const client = this.getClient();
        console.log('🔑 Testing with key:', this.getActiveKey().substring(0, 10) + '...');

        try {
            const response = await client.chat.completions({
                messages: [
                    { role: "user", content: "Reply with: OK" }
                ],
                //@ts-ignore
                model: "sarvam-m",
                max_tokens: 10,
                temperature: 0.1
            });

            const content = response.choices?.[0]?.message?.content;
            console.log('✅ Sarvam AI connected:', content);
        } catch (error: any) {
            console.error('❌ Sarvam AI test failed:', error.message);
            throw error;
        }
    }
}

export const sarvam = new SarvamClient();