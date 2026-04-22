import { db } from '@/config/db';
import { shortVideoSeries } from '@/config/schema';
import { desc, eq } from 'drizzle-orm';
import fs from 'fs';
import { NextRequest, NextResponse } from 'next/server';
import path from 'path';

// GET — Fetch all series for a user
export async function GET(req: NextRequest) {
    try {
        const userId = req.nextUrl.searchParams.get('userId');

        if (!userId) {
            return NextResponse.json({ error: 'userId is required' }, { status: 400 });
        }

        const series = await db
            .select()
            .from(shortVideoSeries)
            .where(eq(shortVideoSeries.userId, userId))
            .orderBy(desc(shortVideoSeries.createdAt));

        // Self-healing: check for thumbnail files on disk that weren't saved to DB
        const thumbnailsDir = path.join(process.cwd(), 'public', 'thumbnails');
        const healed = series.map(s => {
            if (!s.thumbnailUrl) {
                // Check if a thumbnail file exists on disk (from a previous attempt that failed to update DB)
                for (const ext of ['jpg', 'png', 'webp']) {
                    const filePath = path.join(thumbnailsDir, `short-${s.seriesId}.${ext}`);
                    if (fs.existsSync(filePath)) {
                        const localUrl = `/thumbnails/short-${s.seriesId}.${ext}`;
                        // Fire-and-forget DB update
                        db.update(shortVideoSeries)
                            .set({ thumbnailUrl: localUrl })
                            .where(eq(shortVideoSeries.seriesId, s.seriesId))
                            .then(() => console.log(`🩹 Self-healed thumbnail for ${s.seriesId}`))
                            .catch(() => { });
                        return { ...s, thumbnailUrl: localUrl };
                    }
                }
            }
            return s;
        });

        return NextResponse.json({ success: true, series: healed });
    } catch (error: any) {
        console.error('Error fetching short series:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
