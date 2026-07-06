/**
 * GET /api/motion-graphics/[projectId]/stream
 *
 * Serves the rendered motion-graphic video for in-app playback / download.
 *
 * Large renders (≥44 MB) are uploaded to Appwrite as raw byte chunks, and the
 * project's `videoUrl` stores JSON metadata ({ chunked, ids, bucketId, ... })
 * rather than a directly-playable URL. A raw <video src={jsonString}> can't play
 * that, so this endpoint reassembles the chunks (with HTTP Range support for
 * seeking) and streams a proper video/mp4 response. Direct single-file URLs are
 * proxied through with Appwrite auth headers.
 *
 * Mirrors app/api/stream-video/[videoId]/route.ts (the courses/shorts pattern),
 * but keyed on motionGraphicProjects.projectId.
 */

import { NextRequest } from 'next/server';
import { db } from '@/config/db';
import { motionGraphicProjects } from '@/config/schema';
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

/** Resolve the Appwrite API key for the project id stored in the chunk metadata. */
function resolveApiKey(projectId: string): string {
  if (projectId === (process.env.APPWRITE_VIDEO_PROJECT_ID || process.env.APPWRITE_PROJECT_ID)) {
    return process.env.APPWRITE_VIDEO_API_KEY || process.env.APPWRITE_API_KEY || '';
  }
  for (let i = 1; i <= 5; i++) {
    if (projectId === process.env[`APPWRITE_PROJECT_ID${i}`]) {
      return process.env[`APPWRITE_API_KEY${i}`] || '';
    }
  }
  return process.env.APPWRITE_VIDEO_API_KEY || process.env.APPWRITE_API_KEY || '';
}

/** Fetch all chunks from Appwrite into one contiguous buffer for range serving. */
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
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;

  if (!projectId) {
    return new Response('Missing projectId', { status: 400 });
  }

  try {
    const [row] = await db
      .select({ videoUrl: motionGraphicProjects.videoUrl })
      .from(motionGraphicProjects)
      .where(eq(motionGraphicProjects.projectId, projectId))
      .limit(1);

    if (!row) return new Response('Project not found', { status: 404 });

    const videoUrlStr = row.videoUrl;
    if (!videoUrlStr) return new Response('Video not rendered yet', { status: 404 });

    const rangeHeader = req.headers.get('range');

    // ── Case 1: Chunked Appwrite upload (JSON metadata) ──────────────────────
    if (videoUrlStr.trim().startsWith('{')) {
      try {
        const metadata = JSON.parse(videoUrlStr);
        if (metadata.chunked && Array.isArray(metadata.ids)) {
          const { ids, bucketId, endpoint, projectId: appProjectId } = metadata;
          const apiKey = resolveApiKey(appProjectId);

          const buffer = await fetchChunkedBuffer(ids, bucketId, endpoint, appProjectId, apiKey);
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
            const slice = buffer.subarray(start, end + 1);
            return new Response(slice as any, {
              status: 206,
              headers: {
                'Content-Type':   'video/mp4',
                'Content-Length': String(end - start + 1),
                'Content-Range':  `bytes ${start}-${end}/${totalSize}`,
                'Accept-Ranges':  'bytes',
                'Cache-Control':  'no-store',
              },
            });
          }

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
        console.error('[mg/stream] Failed to parse/stream chunked metadata:', jsonErr.message);
        return new Response(`Error streaming chunked video: ${jsonErr.message}`, { status: 500 });
      }
      return new Response('Failed to parse chunked video metadata', { status: 500 });
    }

    // ── Case 2: Single direct Appwrite URL ────────────────────────────────────
    // Proxy the request, forwarding Range and injecting Appwrite auth headers.
    const upstreamHeaders: Record<string, string> = {};
    if (rangeHeader) upstreamHeaders['Range'] = rangeHeader;

    try {
      const urlObj = new URL(videoUrlStr);
      const projectParam = urlObj.searchParams.get('project');
      if (projectParam) {
        const matchedKey = resolveApiKey(projectParam);
        if (matchedKey) {
          upstreamHeaders['X-Appwrite-Project'] = projectParam;
          upstreamHeaders['X-Appwrite-Key']     = matchedKey;
        }
      }
    } catch { /* not a parseable URL — skip auth injection */ }

    const upstream = await fetch(videoUrlStr, { headers: upstreamHeaders });

    const responseHeaders: Record<string, string> = {
      'Content-Type':  upstream.headers.get('Content-Type')  || 'video/mp4',
      'Accept-Ranges': upstream.headers.get('Accept-Ranges') || 'bytes',
      'Cache-Control': 'no-store',
    };
    if (upstream.headers.get('Content-Length')) responseHeaders['Content-Length'] = upstream.headers.get('Content-Length')!;
    if (upstream.headers.get('Content-Range'))  responseHeaders['Content-Range']  = upstream.headers.get('Content-Range')!;

    return new Response(upstream.body, {
      status:  upstream.status,
      headers: responseHeaders,
    });

  } catch (err: any) {
    console.error('[mg/stream] endpoint error:', err);
    return new Response(`Error streaming video: ${err.message}`, { status: 500 });
  }
}
