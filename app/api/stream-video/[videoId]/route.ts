import { NextRequest } from 'next/server';
import { db } from '@/config/db';
import { shortVideoAssets } from '@/config/schema';
import { eq } from 'drizzle-orm';

// ─── Helpers ───────────────────────────────────────────────────────────────────

function parseRange(rangeHeader: string | null, totalSize: number): { start: number; end: number } | null {
  if (!rangeHeader) return null;
  const match = rangeHeader.match(/bytes=(\d*)-(\d*)/);
  if (!match) return null;

  const start = match[1] ? parseInt(match[1], 10) : 0;
  const end   = match[2] ? parseInt(match[2], 10) : totalSize - 1;

  if (isNaN(start) || isNaN(end) || start > end || end >= totalSize) return null;
  return { start, end };
}

/**
 * Fetch all chunks from Appwrite into one big Uint8Array so we can serve
 * arbitrary byte-ranges for proper video seeking.
 */
async function fetchChunkedBuffer(ids: string[], bucketId: string, endpoint: string, projectId: string, apiKey: string): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];

  for (const fileId of ids) {
    const url = `${endpoint}/storage/buckets/${bucketId}/files/${fileId}/download?project=${projectId}`;
    const res = await fetch(url, {
      headers: {
        'X-Appwrite-Project': projectId,
        'X-Appwrite-Key':     apiKey,
      },
    });

    if (!res.ok) throw new Error(`Failed to fetch chunk ${fileId}: HTTP ${res.status}`);

    const buf = await res.arrayBuffer();
    parts.push(new Uint8Array(buf));
  }

  // Concat all parts
  const totalLength = parts.reduce((n, p) => n + p.length, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    combined.set(part, offset);
    offset += part.length;
  }
  return combined;
}

// ─── Route Handler ─────────────────────────────────────────────────────────────

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
      .select({ videoUrl: shortVideoAssets.videoUrl })
      .from(shortVideoAssets)
      .where(eq(shortVideoAssets.videoId, videoId))
      .limit(1);

    if (!row) return new Response('Video asset not found', { status: 404 });

    const videoUrlStr = row.videoUrl;
    if (!videoUrlStr) return new Response('Video not rendered yet', { status: 404 });

    const rangeHeader = req.headers.get('range');

    // ── Case 1: Chunked Appwrite upload (JSON metadata) ──────────────────────
    if (videoUrlStr.startsWith('{')) {
      try {
        const metadata = JSON.parse(videoUrlStr);
        if (metadata.chunked && Array.isArray(metadata.ids)) {
          const { ids, bucketId, endpoint, projectId } = metadata;
          const apiKey = process.env.APPWRITE_VIDEO_API_KEY || process.env.APPWRITE_API_KEY || '';

          // We need to know total size to serve range requests properly.
          // Fetch everything into memory (short video, should be <100 MB).
          const buffer = await fetchChunkedBuffer(ids, bucketId, endpoint, projectId, apiKey);
          const totalSize = buffer.length;

          if (rangeHeader) {
            const range = parseRange(rangeHeader, totalSize);
            if (!range) {
              return new Response('Invalid Range', {
                status: 416,
                headers: { 'Content-Range': `bytes */${totalSize}` },
              });
            }

            const { start, end } = range;
            const chunkLen = end - start + 1;
            const slice = buffer.subarray(start, end + 1);

            return new Response(slice as any, {
              status: 206,
              headers: {
                'Content-Type':   'video/mp4',
                'Content-Length': String(chunkLen),
                'Content-Range':  `bytes ${start}-${end}/${totalSize}`,
                'Accept-Ranges':  'bytes',
                'Cache-Control':  'no-store',
              },
            });
          }

          // No Range — serve the full file
          return new Response(buffer as any, {
            status: 200,
            headers: {
              'Content-Type':   'video/mp4',
              'Content-Length': String(totalSize),
              'Accept-Ranges':  'bytes',
              'Cache-Control':  'no-store',
            },
          });
        }
      } catch (jsonErr: any) {
        console.error('stream-video: Failed to parse/stream chunked metadata:', jsonErr.message);
      }
    }

    // ── Case 2: Single direct Appwrite URL ────────────────────────────────────
    // Proxy the request, forwarding Range header so Appwrite can do byte-range serving.
    const upstreamHeaders: Record<string, string> = {};
    if (rangeHeader) upstreamHeaders['Range'] = rangeHeader;

    const upstream = await fetch(videoUrlStr, { headers: upstreamHeaders });

    const responseHeaders: Record<string, string> = {
      'Content-Type':  upstream.headers.get('Content-Type')  || 'video/mp4',
      'Accept-Ranges': upstream.headers.get('Accept-Ranges') || 'bytes',
      'Cache-Control': 'no-store',
    };
    if (upstream.headers.get('Content-Length'))  responseHeaders['Content-Length']  = upstream.headers.get('Content-Length')!;
    if (upstream.headers.get('Content-Range'))   responseHeaders['Content-Range']   = upstream.headers.get('Content-Range')!;

    return new Response(upstream.body, {
      status:  upstream.status,
      headers: responseHeaders,
    });

  } catch (err: any) {
    console.error('stream-video endpoint error:', err);
    return new Response(`Error streaming video: ${err.message}`, { status: 500 });
  }
}
