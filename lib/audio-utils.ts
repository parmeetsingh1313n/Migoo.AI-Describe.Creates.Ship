/**
 * Audio utilities for handling WAV files and chunk merging
 */

/**
 * Simple WAV header structure
 */
interface WavHeader {
    riffHeader: string;      // "RIFF"
    fileSize: number;        // File size - 8
    waveHeader: string;      // "WAVE"
    fmtHeader: string;       // "fmt "
    fmtChunkSize: number;    // 16 for PCM
    audioFormat: number;     // 1 for PCM
    numChannels: number;     // 1 for mono, 2 for stereo
    sampleRate: number;      // 22050
    byteRate: number;        // sampleRate * numChannels * bitsPerSample/8
    blockAlign: number;      // numChannels * bitsPerSample/8
    bitsPerSample: number;   // 16
    dataHeader: string;      // "data"
    dataSize: number;        // Number of bytes in data
}

/**
 * Parse WAV header from buffer
 */
function parseWavHeader(buffer: Buffer): WavHeader | null {
    if (buffer.length < 44) {
        return null;
    }

    const riffHeader = buffer.toString('ascii', 0, 4);
    const fileSize = buffer.readUInt32LE(4);
    const waveHeader = buffer.toString('ascii', 8, 12);
    const fmtHeader = buffer.toString('ascii', 12, 16);
    const fmtChunkSize = buffer.readUInt32LE(16);
    const audioFormat = buffer.readUInt16LE(20);
    const numChannels = buffer.readUInt16LE(22);
    const sampleRate = buffer.readUInt32LE(24);
    const byteRate = buffer.readUInt32LE(28);
    const blockAlign = buffer.readUInt16LE(32);
    const bitsPerSample = buffer.readUInt16LE(34);
    const dataHeader = buffer.toString('ascii', 36, 40);
    const dataSize = buffer.readUInt32LE(40);

    return {
        riffHeader,
        fileSize,
        waveHeader,
        fmtHeader,
        fmtChunkSize,
        audioFormat,
        numChannels,
        sampleRate,
        byteRate,
        blockAlign,
        bitsPerSample,
        dataHeader,
        dataSize
    };
}

/**
 * Validate WAV file and extract audio data
 */
function extractAudioData(buffer: Buffer): { header: Buffer, data: Buffer } | null {
    const header = parseWavHeader(buffer);
    if (!header) {
        console.error('❌ Invalid WAV header');
        return null;
    }

    if (header.riffHeader !== 'RIFF' || header.waveHeader !== 'WAVE') {
        console.error('❌ Not a valid WAV file');
        return null;
    }

    // Extract header (first 44 bytes) and audio data (rest)
    const headerBuffer = buffer.slice(0, 44);
    const audioData = buffer.slice(44);

    console.log(`📊 WAV File Info:`, {
        channels: header.numChannels,
        sampleRate: header.sampleRate,
        bitsPerSample: header.bitsPerSample,
        dataSize: header.dataSize,
        audioDataLength: audioData.length
    });

    return { header: headerBuffer, data: audioData };
}

/**
 * Merge multiple WAV files into one
 */
export function mergeWavFiles(audioBuffers: Buffer[]): Buffer {
    console.log(`🔗 Merging ${audioBuffers.length} WAV files...`);

    if (audioBuffers.length === 0) {
        throw new Error('No audio buffers to merge');
    }

    if (audioBuffers.length === 1) {
        console.log('✅ Only one buffer, no merging needed');
        return audioBuffers[0];
    }

    // Extract headers and data from all files
    const audioSegments: { header: Buffer, data: Buffer, info: WavHeader | null }[] = [];
    let totalDataSize = 0;

    for (let i = 0; i < audioBuffers.length; i++) {
        const segment = extractAudioData(audioBuffers[i]);
        if (!segment) {
            throw new Error(`Invalid WAV file at position ${i}`);
        }

        const info = parseWavHeader(audioBuffers[i]);
        audioSegments.push({ ...segment, info });
        totalDataSize += segment.data.length;
    }

    // Validate all segments have same format
    const firstSegment = audioSegments[0];
    if (!firstSegment.info) {
        throw new Error('Could not parse first segment header');
    }

    for (let i = 1; i < audioSegments.length; i++) {
        const segment = audioSegments[i];
        if (!segment.info) continue;

        if (segment.info.sampleRate !== firstSegment.info.sampleRate ||
            segment.info.numChannels !== firstSegment.info.numChannels ||
            segment.info.bitsPerSample !== firstSegment.info.bitsPerSample) {
            console.warn(`⚠️ Segment ${i} has different audio format:`, {
                sampleRate: segment.info.sampleRate,
                channels: segment.info.numChannels,
                bitsPerSample: segment.info.bitsPerSample
            });
            // You can choose to throw an error or continue with a warning
        }
    }

    // Create merged audio data
    const mergedData = Buffer.concat(audioSegments.map(s => s.data));

    // Create new header for merged file
    const newHeader = Buffer.alloc(44);

    // Copy RIFF header
    newHeader.write('RIFF', 0);

    // File size: data size + 36 (44 - 8)
    const fileSize = mergedData.length + 36;
    newHeader.writeUInt32LE(fileSize, 4);

    // Copy WAVE header
    newHeader.write('WAVE', 8);
    newHeader.write('fmt ', 12);

    // Copy format chunk (16 for PCM)
    newHeader.writeUInt32LE(16, 16);
    newHeader.writeUInt16LE(firstSegment.info.audioFormat, 20);
    newHeader.writeUInt16LE(firstSegment.info.numChannels, 22);
    newHeader.writeUInt32LE(firstSegment.info.sampleRate, 24);
    newHeader.writeUInt32LE(firstSegment.info.byteRate, 28);
    newHeader.writeUInt16LE(firstSegment.info.blockAlign, 32);
    newHeader.writeUInt16LE(firstSegment.info.bitsPerSample, 34);

    // Data header
    newHeader.write('data', 36);
    newHeader.writeUInt32LE(mergedData.length, 40);

    // Combine header and data
    const mergedBuffer = Buffer.concat([newHeader, mergedData]);

    console.log(`✅ Merged successfully:`, {
        totalChunks: audioBuffers.length,
        mergedSize: mergedBuffer.length,
        audioDataSize: mergedData.length,
        sampleRate: firstSegment.info.sampleRate,
        channels: firstSegment.info.numChannels
    });

    return mergedBuffer;
}

/**
 * Simple merge for same-format audio chunks (fallback method)
 */
export function simpleAudioMerge(audioChunks: Buffer[]): Buffer {
    console.log(`🔗 Simple merge of ${audioChunks.length} audio chunks...`);

    // Just concatenate all buffers
    const mergedBuffer = Buffer.concat(audioChunks);

    console.log(`✅ Simple merge complete:`, {
        totalChunks: audioChunks.length,
        totalSize: mergedBuffer.length
    });

    return mergedBuffer;
}