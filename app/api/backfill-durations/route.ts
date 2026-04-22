import { db } from "@/config/db";
import { chapterContentSlides } from "@/config/schema";
import { eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";

/**
 * One-time backfill API: fetches audio files for slides that have no audioDuration,
 * reads the WAV header to compute duration, and updates the DB.
 *
 * Usage: GET /api/backfill-durations
 */
export async function GET() {
    try {
        // Find all slides missing audioDuration
        const slides = await db
            .select({
                id: chapterContentSlides.id,
                slideId: chapterContentSlides.slideId,
                audioUrl: chapterContentSlides.audioUrl,
            })
            .from(chapterContentSlides)
            .where(isNull(chapterContentSlides.audioDuration));

        console.log(`🔄 Backfilling ${slides.length} slides with audioDuration...`);

        let updated = 0;
        let errors = 0;

        for (const slide of slides) {
            if (!slide.audioUrl) {
                console.warn(`⚠️ Slide ${slide.slideId} has no audioUrl, skipping`);
                continue;
            }

            try {
                // Fetch just enough of the WAV to read the header + compute duration
                const response = await fetch(slide.audioUrl);
                if (!response.ok) {
                    console.error(`❌ Failed to fetch audio for ${slide.slideId}: ${response.status}`);
                    errors++;
                    continue;
                }

                const arrayBuffer = await response.arrayBuffer();
                const buffer = Buffer.from(arrayBuffer);

                if (buffer.length < 44) {
                    console.warn(`⚠️ Audio too small for ${slide.slideId}`);
                    errors++;
                    continue;
                }

                // Parse WAV header
                const sampleRate = buffer.readUInt32LE(24);
                const numChannels = buffer.readUInt16LE(22);
                const bitsPerSample = buffer.readUInt16LE(34);
                const dataSize = buffer.length - 44;
                const bytesPerSecond = sampleRate * numChannels * (bitsPerSample / 8);
                const duration = bytesPerSecond > 0 ? dataSize / bytesPerSecond : 0;

                // Update DB
                await db
                    .update(chapterContentSlides)
                    .set({ audioDuration: duration })
                    .where(eq(chapterContentSlides.id, slide.id));

                updated++;
                console.log(`✅ ${slide.slideId}: ${duration.toFixed(2)}s`);

            } catch (err: any) {
                console.error(`❌ Error processing ${slide.slideId}:`, err.message);
                errors++;
            }
        }

        console.log(`\n🎉 Backfill complete: ${updated} updated, ${errors} errors, ${slides.length} total`);

        return NextResponse.json({
            success: true,
            total: slides.length,
            updated,
            errors,
        });

    } catch (error: any) {
        console.error("❌ Backfill failed:", error.message);
        return NextResponse.json(
            { success: false, error: error.message },
            { status: 500 }
        );
    }
}
