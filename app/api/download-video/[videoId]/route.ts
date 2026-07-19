import { NextRequest } from 'next/server';
import { db } from '@/config/db';
import { shortVideoAssets } from '@/config/schema';
import { eq } from 'drizzle-orm';

// Streaming a full video can exceed the default serverless limit; allow up to
// 5 min (Vercel cap) so the browser download completes instead of being killed.
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: any }
) {
  const resolvedParams = await params;
  const videoId = resolvedParams?.videoId;

  if (!videoId) {
    return new Response('Missing videoId', { status: 400 });
  }

  try {
    const [row] = await db
      .select({
        videoUrl: shortVideoAssets.videoUrl,
        videoTitle: shortVideoAssets.videoTitle,
      })
      .from(shortVideoAssets)
      .where(eq(shortVideoAssets.videoId, videoId))
      .limit(1);

    if (!row) {
      return new Response('Video asset not found', { status: 404 });
    }

    const videoUrlStr = row.videoUrl;
    if (!videoUrlStr) {
      return new Response('Video not rendered yet', { status: 404 });
    }

    // Preserve unicode word characters (Hindi, Hinglish, etc.) for the RFC 5987 part.
    // Only strip truly unsafe filename chars: / \ : * ? " < > |
    const rawTitle = row.videoTitle || 'video';
    const safeTitle = rawTitle
      .replace(/[/\\:*?"<>|]/g, '')   // strip OS-illegal chars
      .replace(/\s+/g, '_')            // spaces → underscore
      .trim() || 'video';

    // HTTP headers are ByteStrings (ASCII only). The filename="" fallback must be ASCII.
    // Non-ASCII chars (e.g. Devanagari ਅ = 2309) cause a hard "cannot convert to ByteString" crash.
    const asciiFallback = safeTitle.replace(/[^\x00-\x7F]/g, '_').replace(/_+/g, '_').trim() || 'video';

    const filename = `${safeTitle}.mp4`;              // Full unicode — used in RFC 5987 part
    const asciiFilename = `${asciiFallback}.mp4`;     // ASCII-only  — used in filename="" fallback
    // RFC 5987: filename*= is percent-encoded UTF-8, safe for all characters
    const encodedFilename = encodeURIComponent(filename);
    const contentDisposition = `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodedFilename}`;

    // Case 1: Chunked Appwrite upload (JSON metadata)
    if (videoUrlStr.startsWith('{')) {
      let metadata: any;
      try {
        metadata = JSON.parse(videoUrlStr);
      } catch (jsonErr: any) {
        console.error('download-video: failed to parse chunked metadata JSON:', jsonErr.message);
        return new Response('Corrupted video metadata', { status: 500 });
      }

      if (!metadata.chunked || !Array.isArray(metadata.ids)) {
        return new Response('Unsupported video metadata format', { status: 500 });
      }

      const { ids, bucketId, endpoint, projectId } = metadata;
      const apiKey = process.env.APPWRITE_VIDEO_API_KEY || process.env.APPWRITE_API_KEY || '';

      const stream = new ReadableStream({
        async start(controller) {
          try {
            for (const fileId of ids) {
              const url = `${endpoint}/storage/buckets/${bucketId}/files/${fileId}/download?project=${projectId}`;
              const res = await fetch(url, {
                headers: {
                  'X-Appwrite-Project': projectId,
                  'X-Appwrite-Key': apiKey,
                },
              });

              if (!res.ok) {
                throw new Error(`Failed to fetch chunk ${fileId}: HTTP ${res.status}`);
              }

              const reader = res.body?.getReader();
              if (!reader) {
                throw new Error(`No body reader for chunk ${fileId}`);
              }

              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                controller.enqueue(value);
              }
            }
            controller.close();
          } catch (err: any) {
            console.error(`download-video: error streaming chunks for ${videoId}:`, err);
            controller.error(err);
          }
        },
      });

      return new Response(stream, {
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Disposition': contentDisposition,
        },
      });
    }

    // Case 2: Single Appwrite URL (plain string) — must be a real http(s) URL
    if (!videoUrlStr.startsWith('http')) {
      return new Response('Unrecognised videoUrl format', { status: 500 });
    }

    // Proxy through us so the browser gets the correct filename via Content-Disposition.
    const upstream = await fetch(videoUrlStr);
    if (!upstream.ok) {
      return new Response(`Failed to fetch remote video: HTTP ${upstream.status}`, { status: upstream.status });
    }
    return new Response(upstream.body, {
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Disposition': contentDisposition,
        'Content-Length': upstream.headers.get('content-length') || '',
      },
    });

  } catch (err: any) {
    console.error('Download video endpoint error:', err);
    return new Response(`Error preparing download: ${err.message}`, { status: 500 });
  }
}
