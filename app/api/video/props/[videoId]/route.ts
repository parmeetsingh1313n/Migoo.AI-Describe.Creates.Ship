import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/config/db';
import { shortVideoAssets, shortVideoSeries } from '@/config/schema';
import { eq } from 'drizzle-orm';
import { getMusicUrl } from '@/lib/music-urls';

/**
 * GET /api/video/props/[videoId]
 *
 * Called by the GitHub Actions render-video workflow to fetch full Remotion render props.
 * We deliberately do NOT embed props in the GitHub dispatch client_payload because GitHub
 * enforces a hard 10 KB limit on that field.  All the data is already persisted in the
 * shortVideoAssets table before the dispatch is sent, so the runner can retrieve it here.
 *
 * Optional: pass ?secret=WEBHOOK_SECRET in the query string (or Authorization: Bearer <secret>
 * header) to protect this route.  If WEBHOOK_SECRET is not configured, the route is open
 * (safe because videoId is a random UUID already stored in the DB).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: any }
) {
  const resolvedParams = await params;
  const videoId = resolvedParams?.videoId;

  if (!videoId) {
    return NextResponse.json({ error: 'Missing videoId' }, { status: 400 });
  }

  // Optional bearer-token auth so random users can't enumerate props
  const webhookSecret = process.env.WEBHOOK_SECRET;
  if (webhookSecret) {
    const authHeader = req.headers.get('authorization') || '';
    const querySecret = req.nextUrl.searchParams.get('secret') || '';
    const provided = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : querySecret;
    if (provided !== webhookSecret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  try {
    const [video] = await db
      .select()
      .from(shortVideoAssets)
      .where(eq(shortVideoAssets.videoId, videoId))
      .limit(1);

    if (!video) {
      return NextResponse.json({ error: 'Video not found' }, { status: 404 });
    }

    // Fetch series config for music + captionStyle + language
    const [series] = await db
      .select()
      .from(shortVideoSeries)
      .where(eq(shortVideoSeries.seriesId, video.seriesId))
      .limit(1);

    const musicUrl = series?.music ? getMusicUrl(series.music) : '';

    // Reconstruct the full Remotion props from the DB record
    const props: Record<string, any> = {
      imageUrls:           (video.imageUrls as string[])         || [],
      sceneVideoUrls:      (video.sceneVideoUrls as string[])    || [],
      sceneVideoDurations:  (video.sceneVideoDurations as number[]) || [],
      audioUrl:            video.audioUrl || '',
      audioDuration:       video.audioDuration || 60,
      musicUrl,
      captionData:         video.captionData  || { segments: [] },
      captionStyle:        series?.captionStyle || 'bold-pop',
      language:            series?.language    || 'en-IN',
      durationInFrames:    Math.floor((video.audioDuration || 60) * 30),
    };

    // Avatar clips: stored as [{videoUrl, audioUrl, durationSec, videoDurationSec}, ...]
    // Workflow expects introClip + outroClip at the top level
    const avatarClipUrls = (video.avatarClipUrls as any[]) || [];
    if (avatarClipUrls.length >= 2) {
      props.introClip = avatarClipUrls[0];
      props.outroClip = avatarClipUrls[1];

      // Recalculate total duration including intro + outro
      const introDuration = avatarClipUrls[0]?.durationSec || 0;
      const outroDuration = avatarClipUrls[1]?.durationSec || 0;
      const totalDurationSec = introDuration + (video.audioDuration || 60) + outroDuration;
      props.durationInFrames = Math.floor(totalDurationSec * 30);
    } else if (avatarClipUrls.length === 1) {
      props.introClip = avatarClipUrls[0];
    }

    return NextResponse.json(props, {
      headers: {
        // Tell runners not to cache — always get fresh data
        'Cache-Control': 'no-store',
      },
    });

  } catch (err: any) {
    console.error('video/props endpoint error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
