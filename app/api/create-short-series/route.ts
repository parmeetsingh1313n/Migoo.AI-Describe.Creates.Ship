/**
 * @module api/create-short-series
 * @description API route for creating a new short video series.
 *
 * POST /api/create-short-series
 * Creates a series configuration and stores it in the database.
 *
 * @requires Authentication via Clerk
 */

import { db } from '@/config/db';
import { shortVideoSeries } from '@/config/schema';
import { apiError, apiSuccess } from '@/lib/api-helpers';
import { validateInput, createShortSeriesSchema } from '@/lib/validations';
import { currentUser } from '@clerk/nextjs/server';
import { NextRequest } from 'next/server';
import { v4 as uuidv4 } from 'uuid';

export async function POST(req: NextRequest) {
    try {
        // Auth guard
        const user = await currentUser();
        if (!user?.primaryEmailAddress?.emailAddress) {
            return apiError('Authentication required', 401, 'UNAUTHORIZED');
        }

        const body = await req.json();
        const validation = validateInput(createShortSeriesSchema, body);

        if (!validation.success) {
            console.error('❌ Validation Error:', validation.errors);
            return apiError('Invalid request input', 400, 'VALIDATION_ERROR', validation.errors);
        }

        const { niche, language, voice, music, videoStyle, captionStyle, title, duration, platform, publishTime } = validation.data;

        const seriesId = uuidv4();

        const [result] = await db.insert(shortVideoSeries).values({
            seriesId,
            userId: user.primaryEmailAddress.emailAddress,
            niche,
            language,
            voice,
            music,
            videoStyle,
            captionStyle,
            title,
            duration,
            platform,
            publishTime: new Date(publishTime),
            status: 'active',
        }).returning();

        return apiSuccess({ seriesId: result.seriesId }, 201);
    } catch (error: any) {
        console.error('❌ Create Short Series Error:', error.message);
        return apiError(
            'Failed to create short series',
            500,
            'INTERNAL_ERROR',
            error.message
        );
    }
}
