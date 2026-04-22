import { db } from '@/config/db';
import { shortVideoAssets, shortVideoSeries } from '@/config/schema';
import { eq, desc } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

// GET — Fetch series metadata + all videos for a specific series
export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ seriesId: string }> }
) {
    try {
        const { seriesId } = await params;

        // Fetch series info
        const [series] = await db
            .select()
            .from(shortVideoSeries)
            .where(eq(shortVideoSeries.seriesId, seriesId));

        if (!series) {
            return NextResponse.json({ error: 'Series not found' }, { status: 404 });
        }

        // Fetch all videos for this series
        let videos = await db
            .select()
            .from(shortVideoAssets)
            .where(eq(shortVideoAssets.seriesId, seriesId))
            .orderBy(desc(shortVideoAssets.createdAt));

        // Self-healing: Ensure thumbnails exist for all completed videos
        // We do this in parallel and update the 'videos' array if thumbnails were generated
        const { ensureVideoThumbnail } = require('@/lib/video-render');
        await Promise.all(videos.map(async (v) => {
            if (v.status === 'completed' && !v.thumbnailUrl) {
                const newThumb = await ensureVideoThumbnail(v.videoId);
                if (newThumb) v.thumbnailUrl = newThumb;
            }
        }));

        return NextResponse.json({
            success: true,
            series,
            videos,
        });
    } catch (error: any) {
        console.error('Error fetching series videos:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
