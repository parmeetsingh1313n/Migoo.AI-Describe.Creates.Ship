import { db } from '@/config/db';
import { shortVideoSeries } from '@/config/schema';
import { eq } from 'drizzle-orm';
import fs from 'fs';
import { NextRequest, NextResponse } from 'next/server';
import path from 'path';

// PATCH — Update a series (edit fields, pause/resume)
export async function PATCH(
    req: NextRequest,
    { params }: { params: Promise<{ seriesId: string }> }
) {
    try {
        const { seriesId } = await params;
        const body = await req.json();

        // Only allow updating certain fields
        const allowedFields: Record<string, any> = {};
        if (body.title !== undefined) allowedFields.title = body.title;
        if (body.niche !== undefined) allowedFields.niche = body.niche;
        if (body.status !== undefined) allowedFields.status = body.status;
        if (body.language !== undefined) allowedFields.language = body.language;
        if (body.voice !== undefined) allowedFields.voice = body.voice;
        if (body.music !== undefined) allowedFields.music = body.music;
        if (body.videoStyle !== undefined) allowedFields.videoStyle = body.videoStyle;
        if (body.captionStyle !== undefined) allowedFields.captionStyle = body.captionStyle;
        if (body.duration !== undefined) allowedFields.duration = body.duration;
        if (body.platform !== undefined) allowedFields.platform = body.platform;

        if (Object.keys(allowedFields).length === 0) {
            return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
        }

        allowedFields.updatedAt = new Date();

        const [updated] = await db
            .update(shortVideoSeries)
            .set(allowedFields)
            .where(eq(shortVideoSeries.seriesId, seriesId))
            .returning();

        if (!updated) {
            return NextResponse.json({ error: 'Series not found' }, { status: 404 });
        }

        return NextResponse.json({ success: true, series: updated });
    } catch (error: any) {
        console.error('Error updating series:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

// DELETE — Delete a series and its thumbnail
export async function DELETE(
    req: NextRequest,
    { params }: { params: Promise<{ seriesId: string }> }
) {
    try {
        const { seriesId } = await params;

        // Get the series to find thumbnail path
        const [series] = await db
            .select({ thumbnailUrl: shortVideoSeries.thumbnailUrl })
            .from(shortVideoSeries)
            .where(eq(shortVideoSeries.seriesId, seriesId));

        if (!series) {
            return NextResponse.json({ error: 'Series not found' }, { status: 404 });
        }

        // Delete local thumbnail file if it exists
        if (series.thumbnailUrl && series.thumbnailUrl.startsWith('/thumbnails/')) {
            const localFile = path.join(process.cwd(), 'public', series.thumbnailUrl);
            if (fs.existsSync(localFile)) {
                fs.unlinkSync(localFile);
                console.log(`🗑️ Deleted thumbnail: ${localFile}`);
            }
        }

        // Delete from DB
        await db
            .delete(shortVideoSeries)
            .where(eq(shortVideoSeries.seriesId, seriesId));

        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error('Error deleting series:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
