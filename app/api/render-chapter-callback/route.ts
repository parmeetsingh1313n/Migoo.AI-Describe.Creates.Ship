import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/config/db';
import { chapterGenerationStatus } from '@/config/schema';
import { eq } from 'drizzle-orm';

/**
 * POST /api/render-chapter-callback
 *
 * Called by GitHub Actions during and after rendering.
 *
 * Body variants:
 *   { chapterId, status: 'progress', progress: 0-100, slidesComplete, slidesTotal }
 *   { chapterId, status: 'completed', videoUrl }
 *   { chapterId, status: 'failed', error }
 */
export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { chapterId, videoUrl, status, error, progress } = body;

  if (!chapterId) {
    return NextResponse.json({ error: 'Missing chapterId' }, { status: 400 });
  }

  console.log(`📡 render-chapter-callback: chapterId=${chapterId} status=${status} progress=${progress ?? '-'}`);

  try {
    if (status === 'progress') {
      // Real-time slide-completion progress update from GitHub Actions
      const pct = Math.max(0, Math.min(99, Math.round(progress ?? 0)));
      await db
        .update(chapterGenerationStatus)
        .set({ renderProgress: pct, updatedAt: new Date() })
        .where(eq(chapterGenerationStatus.chapterId, chapterId));

      console.log(`📊 Chapter ${chapterId} render progress: ${pct}%`);
    } else if (status === 'completed' && videoUrl) {
      await db
        .update(chapterGenerationStatus)
        .set({
          renderStatus: 'video:completed',
          renderProgress: 100,
          videoUrl,
          renderError: null,
          updatedAt: new Date(),
        })
        .where(eq(chapterGenerationStatus.chapterId, chapterId));

      console.log(`✅ Chapter ${chapterId} video ready: ${videoUrl}`);
    } else {
      // failed
      await db
        .update(chapterGenerationStatus)
        .set({
          renderStatus: 'video:failed',
          renderProgress: 0,
          renderError: String(error ?? 'Unknown render error').slice(0, 500),
          updatedAt: new Date(),
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
