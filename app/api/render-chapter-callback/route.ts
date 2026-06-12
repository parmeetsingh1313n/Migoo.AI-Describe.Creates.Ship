import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/config/db';
import { chapterGenerationStatus } from '@/config/schema';
import { eq } from 'drizzle-orm';

/**
 * POST /api/render-chapter-callback
 *
 * Called by GitHub Actions (scripts/upload-chapter-render.js) when a chapter
 * video has been rendered and uploaded to Appwrite.
 *
 * Body: { chapterId, videoUrl, status, error? }
 *   status: 'completed' | 'failed'
 */
export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { chapterId, videoUrl, status, error } = body;

  if (!chapterId) {
    return NextResponse.json({ error: 'Missing chapterId' }, { status: 400 });
  }

  console.log(`📡 render-chapter-callback: chapterId=${chapterId} status=${status}`);

  try {
    if (status === 'completed' && videoUrl) {
      await db
        .update(chapterGenerationStatus)
        .set({
          renderStatus: 'video:completed',
          videoUrl,
          renderError: null,
        })
        .where(eq(chapterGenerationStatus.chapterId, chapterId));

      console.log(`✅ Chapter ${chapterId} video ready: ${videoUrl}`);
    } else {
      // failed
      await db
        .update(chapterGenerationStatus)
        .set({
          renderStatus: 'video:failed',
          renderError: String(error ?? 'Unknown render error').slice(0, 500),
        })
        .where(eq(chapterGenerationStatus.chapterId, chapterId));

      console.log(`❌ Chapter ${chapterId} render failed: ${error}`);
    }

    return NextResponse.json({ ok: true });
  } catch (dbErr: any) {
    console.error('DB update error in render-chapter-callback:', dbErr.message);
    return NextResponse.json({ error: 'DB update failed' }, { status: 500 });
  }
}
