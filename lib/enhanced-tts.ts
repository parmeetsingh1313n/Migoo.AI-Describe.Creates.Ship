// ═══════════════════════════════════════════════════════════════════════════════
// ENHANCED TTS HANDLER - Robust Sarvam AI Integration
// Features: Retry logic, text sanitization, fallback, rate limiting
// ═══════════════════════════════════════════════════════════════════════════════

interface RetryConfig {
    maxRetries: number;
    initialDelay: number;
    maxDelay: number;
    backoffMultiplier: number;
}

interface TTSOptions {
    retryConfig?: RetryConfig;
    sanitize?: boolean;
    chunkSize?: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEXT SANITIZATION
// ═══════════════════════════════════════════════════════════════════════════════

function sanitizeTextForTTS(text: string): string {
    console.log(`🧹 Sanitizing text: ${text.length} chars`);

    let sanitized = text
        // Remove HTML tags completely
        .replace(/<[^>]*>/g, ' ')

        // Remove multiple spaces
        .replace(/\s+/g, ' ')

        // Remove special Unicode characters that might cause issues
        .replace(/[\u200B-\u200D\uFEFF]/g, '') // Zero-width spaces
        .replace(/[\u2018\u2019]/g, "'") // Smart quotes to regular
        .replace(/[\u201C\u201D]/g, '"')

        // Remove or replace problematic punctuation
        .replace(/[•◦▪▫]/g, '-') // Bullets to dashes
        .replace(/[…]/g, '...') // Ellipsis

        // Remove control characters except newlines
        .replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '')

        // Fix multiple punctuation
        .replace(/\.{4,}/g, '...')
        .replace(/!{2,}/g, '!')
        .replace(/\?{2,}/g, '?')

        // Ensure proper spacing after punctuation
        .replace(/([.!?])([A-Z])/g, '$1 $2')

        // Remove leading/trailing whitespace
        .trim();

    console.log(`✅ Sanitized: ${sanitized.length} chars (removed ${text.length - sanitized.length})`);
    return sanitized;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SMART CHUNKING - Improved sentence boundary detection
// ═══════════════════════════════════════════════════════════════════════════════

function smartChunkText(text: string, maxLength: number = 2400): string[] {
    console.log(`✂️ Smart chunking: ${text.length} characters`);

    if (text.length <= maxLength) {
        return [text];
    }

    const chunks: string[] = [];

    // Split by sentence boundaries (improved regex)
    const sentences = text.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g) || [text];

    let currentChunk = '';

    for (const sentence of sentences) {
        const trimmed = sentence.trim();
        if (!trimmed) continue;

        // Check if adding this sentence would exceed the limit
        const potentialLength = currentChunk.length + trimmed.length + 1;

        if (potentialLength > maxLength && currentChunk.length > 0) {
            // Current chunk is full, save it
            chunks.push(currentChunk.trim());
            currentChunk = trimmed;
        } else if (trimmed.length > maxLength) {
            // Single sentence too long, split by commas or semicolons
            if (currentChunk) {
                chunks.push(currentChunk.trim());
                currentChunk = '';
            }

            const subSentences = trimmed.split(/[,;]\s+/);
            let subChunk = '';

            for (const sub of subSentences) {
                if (subChunk.length + sub.length + 2 > maxLength) {
                    if (subChunk) chunks.push(subChunk.trim());
                    subChunk = sub;
                } else {
                    subChunk += (subChunk ? ', ' : '') + sub;
                }
            }

            if (subChunk) currentChunk = subChunk;
        } else {
            // Add to current chunk
            currentChunk += (currentChunk ? ' ' : '') + trimmed;
        }
    }

    // Add remaining chunk
    if (currentChunk) {
        chunks.push(currentChunk.trim());
    }

    console.log(`✅ Created ${chunks.length} chunks:`, chunks.map(c => c.length));
    return chunks;
}

// ═══════════════════════════════════════════════════════════════════════════════
// RETRY LOGIC WITH EXPONENTIAL BACKOFF
// ═══════════════════════════════════════════════════════════════════════════════

async function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function retryWithBackoff<T>(
    fn: () => Promise<T>,
    config: RetryConfig,
    context: string
): Promise<T> {
    let lastError: Error | null = null;
    let delay = config.initialDelay;

    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
        try {
            if (attempt > 0) {
                console.log(`🔄 Retry attempt ${attempt}/${config.maxRetries} for ${context}`);
                console.log(`⏳ Waiting ${delay}ms before retry...`);
                await sleep(delay);
            }

            return await fn();

        } catch (error: any) {
            lastError = error;

            // Check if error is retryable
            const isRetryable =
                error.message?.includes('502') ||
                error.message?.includes('503') ||
                error.message?.includes('504') ||
                error.message?.includes('Bad Gateway') ||
                error.message?.includes('timeout') ||
                error.message?.includes('ECONNRESET') ||
                error.message?.includes('ETIMEDOUT');

            if (!isRetryable || attempt === config.maxRetries) {
                throw error;
            }

            console.warn(`⚠️ Attempt ${attempt + 1} failed: ${error.message}`);

            // Exponential backoff
            delay = Math.min(delay * config.backoffMultiplier, config.maxDelay);
        }
    }

    throw lastError || new Error('Retry failed');
}

// ═══════════════════════════════════════════════════════════════════════════════
// SARVAM TTS WITH RETRY
// ═══════════════════════════════════════════════════════════════════════════════

async function generateAudioWithSarvamRetry(
    text: string,
    retryConfig: RetryConfig,
    languageCode: string = "en-IN"
): Promise<Buffer> {
    if (text.length > 2500) {
        throw new Error(`Text too long: ${text.length} chars (max 2500)`);
    }

    return await retryWithBackoff(
        async () => {
            console.log(`🎤 Calling Sarvam API: ${text.length} chars`);

            const response = await fetch('https://api.sarvam.ai/text-to-speech', {
                method: 'POST',
                headers: {
                    'api-subscription-key': process.env.SARVAM_API_KEY!,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    text: text,
                    target_language_code: languageCode,
                    speaker: "kabir",
                    pace: 1.05,
                    speech_sample_rate: 22050,
                    enable_preprocessing: true,
                    model: "bulbul:v3",
                    temperature: 0.6,
                    output_audio_codec: "wav"
                }),
                signal: AbortSignal.timeout(30000) // 30 second timeout
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Sarvam TTS failed (${response.status}): ${errorText}`);
            }

            const result = await response.json();

            if (!result.audios || result.audios.length === 0) {
                throw new Error('No audio data from Sarvam AI');
            }

            const audioBuffer = Buffer.from(result.audios[0], 'base64');
            console.log(`✅ Audio generated: ${audioBuffer.length} bytes`);

            return audioBuffer;
        },
        retryConfig,
        `Sarvam TTS (${text.substring(0, 50)}...)`
    );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN ENHANCED TTS FUNCTION
// ═══════════════════════════════════════════════════════════════════════════════

export async function generateAudioEnhanced(
    text: string,
    languageCode: string = "en-IN",
    options: TTSOptions = {}
): Promise<Buffer> {
    const retryConfig: RetryConfig = options.retryConfig || {
        maxRetries: 3,
        initialDelay: 2000,  // 2 seconds
        maxDelay: 10000,     // 10 seconds
        backoffMultiplier: 2
    };

    const chunkSize = options.chunkSize || 2200; // Slightly smaller for safety
    const shouldSanitize = options.sanitize !== false;

    console.log('\n' + '═'.repeat(80));
    console.log('🎵 ENHANCED TTS GENERATION');
    console.log('═'.repeat(80));
    console.log(`Input: ${text.length} chars`);
    console.log(`Sanitize: ${shouldSanitize}`);
    console.log(`Chunk size: ${chunkSize}`);
    console.log(`Retry config:`, retryConfig);
    console.log('═'.repeat(80));

    try {
        // Step 1: Sanitize
        let processedText = text;
        if (shouldSanitize) {
            processedText = sanitizeTextForTTS(text);
        }

        // Step 2: Chunk
        const chunks = smartChunkText(processedText, chunkSize);

        if (chunks.length === 1) {
            console.log('📝 Single chunk, processing...');
            return await generateAudioWithSarvamRetry(chunks[0], retryConfig, languageCode);
        }

        // Step 3: Process multiple chunks
        console.log(`📝 Processing ${chunks.length} chunks...`);
        const audioBuffers: Buffer[] = [];

        for (let i = 0; i < chunks.length; i++) {
            console.log(`\n${'─'.repeat(60)}`);
            console.log(`🔊 Chunk ${i + 1}/${chunks.length}`);
            console.log(`Length: ${chunks[i].length} chars`);
            console.log(`Preview: ${chunks[i].substring(0, 80)}...`);
            console.log('─'.repeat(60));

            try {
                const audioBuffer = await generateAudioWithSarvamRetry(
                    chunks[i],
                    retryConfig,
                    languageCode
                );

                audioBuffers.push(audioBuffer);
                console.log(`✅ Chunk ${i + 1} success: ${audioBuffer.length} bytes`);

                // Progressive delay to avoid rate limiting
                if (i < chunks.length - 1) {
                    const delay = 1000 + (i * 200); // Increase delay with each chunk
                    console.log(`⏳ Waiting ${delay}ms before next chunk...`);
                    await sleep(delay);
                }

            } catch (error: any) {
                console.error(`❌ Chunk ${i + 1} FAILED after retries:`, error.message);

                // Decision: Skip this chunk or fail entirely?
                // For now, we'll throw to maintain audio quality
                throw new Error(`Chunk ${i + 1} failed: ${error.message}`);
            }
        }

        // Step 4: Merge audio buffers
        if (audioBuffers.length === 0) {
            throw new Error('No audio chunks were generated');
        }

        if (audioBuffers.length === 1) {
            return audioBuffers[0];
        }

        console.log(`\n🔗 Merging ${audioBuffers.length} audio buffers...`);
        const merged = mergeWavFiles(audioBuffers);
        console.log(`✅ Final audio: ${merged.length} bytes`);

        console.log('\n' + '═'.repeat(80));
        console.log('🎉 ENHANCED TTS GENERATION COMPLETE');
        console.log('═'.repeat(80) + '\n');

        return merged;

    } catch (error: any) {
        console.error('\n' + '═'.repeat(80));
        console.error('❌ ENHANCED TTS GENERATION FAILED');
        console.error('═'.repeat(80));
        console.error('Error:', error.message);
        console.error('Stack:', error.stack);
        console.error('═'.repeat(80) + '\n');

        throw error;
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// WAV MERGING (from original code)
// ═══════════════════════════════════════════════════════════════════════════════

interface WavHeader {
    sampleRate: number;
    numChannels: number;
    bitsPerSample: number;
}

function parseWavHeader(buffer: Buffer): WavHeader | null {
    if (buffer.length < 44) return null;

    const sampleRate = buffer.readUInt32LE(24);
    const numChannels = buffer.readUInt16LE(22);
    const bitsPerSample = buffer.readUInt16LE(34);

    return { sampleRate, numChannels, bitsPerSample };
}

function mergeWavFiles(audioBuffers: Buffer[]): Buffer {
    if (audioBuffers.length === 0) throw new Error('No audio buffers to merge');
    if (audioBuffers.length === 1) return audioBuffers[0];

    const audioDataChunks: Buffer[] = [];
    const firstHeader = parseWavHeader(audioBuffers[0]);

    if (!firstHeader) throw new Error('Invalid WAV header');

    for (const buffer of audioBuffers) {
        const audioData = buffer.slice(44);
        audioDataChunks.push(audioData);
    }

    const mergedData = Buffer.concat(audioDataChunks);

    // Create new WAV header
    const newHeader = Buffer.alloc(44);
    newHeader.write('RIFF', 0);
    newHeader.writeUInt32LE(mergedData.length + 36, 4);
    newHeader.write('WAVE', 8);
    newHeader.write('fmt ', 12);
    newHeader.writeUInt32LE(16, 16);
    newHeader.writeUInt16LE(1, 20);
    newHeader.writeUInt16LE(firstHeader.numChannels, 22);
    newHeader.writeUInt32LE(firstHeader.sampleRate, 24);
    newHeader.writeUInt32LE(
        firstHeader.sampleRate * firstHeader.numChannels * (firstHeader.bitsPerSample / 8),
        28
    );
    newHeader.writeUInt16LE(firstHeader.numChannels * (firstHeader.bitsPerSample / 8), 32);
    newHeader.writeUInt16LE(firstHeader.bitsPerSample, 34);
    newHeader.write('data', 36);
    newHeader.writeUInt32LE(mergedData.length, 40);

    return Buffer.concat([newHeader, mergedData]);
}

// ═══════════════════════════════════════════════════════════════════════════════
// HEALTH CHECK
// ═══════════════════════════════════════════════════════════════════════════════

export async function testSarvamConnection(): Promise<boolean> {
    console.log('🔗 Testing Sarvam AI connection...');

    try {
        const testAudio = await generateAudioEnhanced('Hello, this is a test.', 'en-IN', {
            sanitize: true,
            retryConfig: {
                maxRetries: 2,
                initialDelay: 1000,
                maxDelay: 5000,
                backoffMultiplier: 2
            }
        });

        console.log('✅ Sarvam AI connection successful');
        return true;
    } catch (error: any) {
        console.error('❌ Sarvam AI connection failed:', error.message);
        return false;
    }
}