import { NextRequest } from 'next/server';
import { db } from '@/config/db';
import { shortVideoAssets } from '@/config/schema';
import { eq } from 'drizzle-orm';

/**
 * /api/stream-video/[videoId]
 *
 * Properly serves chunked-Appwrite videos with:
 *  - Content-Length  (so the browser knows total size)
 *  - Accept-Ranges: bytes  (so the browser can seek)
 *  - 206 Partial Content  (for mid-video seeks / range requests)
 *
 * Without these headers the native <video> element cannot seek and
 * will jerk/stutter — even though the downloaded file plays fine.
 */

const APPWRITE_API_KEY =
  process.env.APPWRITE_VIDEO_API_KEY || process.env.APPWRITE_API_KEY || '';

// ---------- helpers ---------------------------------------------------------

interface ChunkMeta {
  chunked: boolean;
  ids: string[];
  bucketId: string;
  endpoint: string;
  projectId: string;
  rawBinary?: boolean;
}

/** Fetch the raw bytes of a single Appwrite file */
async function fetchChunkBuffer(
  meta: ChunkMeta,
  fileId: string
): Promise<ArrayBuffer> {
  const url = `${meta.endpoint}/storage/buckets/${meta.bucketId}/files/${fileId}/download?project=${meta.projectId}`;
  const res = await fetch(url, {
    headers: {
      'X-Appwrite-Project': meta.projectId,
      'X-Appwrite-Key': APPWRITE_API_KEY,
    },
  });
  if (!res.ok) {
    throw new Error(`Appwrite chunk ${fileId}: HTTP ${res.status}`);
  }
  return res.arrayBuffer();
}

/** Return the total byte-size of all chunks by HEADing each file */
async function getTotalSize(meta: ChunkMeta): Promise<number> {
  let total = 0;
  for (const fileId of meta.ids) {
    const url = `${meta.endpoint}/storage/buckets/${meta.bucketId}/files/${fileId}/download?project=${meta.projectId}`;
    const res = await fetch(url, {
      method: 'HEAD',
      headers: {
        'X-Appwrite-Project': meta.projectId,
        'X-Appwrite-Key': APPWRITE_API_KEY,
      },
    });
    if (res.ok) {
      total += Number(res.headers.get('content-length') ?? 0);
    } else {
      // fallback: fetch the whole chunk just to measure
      const buf = await fetchChunkBuffer(meta, fileId);
      total += buf.byteLength;
    }
  }
  return total;
}

// ---------- route handler ---------------------------------------------------

export async function GET(
  req: NextRequest,
  { params }: { params: any }
) {
  const resolvedParams = await params;
  const videoId = resolvedParams?.videoId as string | undefined;

  if (!videoId) {
    return new Response('Missing videoId', { status: 400 });
  }

  // ── 1. Look up the DB record ──────────────────────────────────────────────
  const [row] = await db
    .select({ videoUrl: shortVideoAssets.videoUrl })
    .from(shortVideoAssets)
    .where(eq(shortVideoAssets.videoId, videoId))
    .limit(1);

  if (!row?.videoUrl) {
    return new Response('Video not found', { status: 404 });
  }

  const videoUrlStr = row.videoUrl.trim();

  // ── 2. Case: plain URL → redirect (Appwrite direct link already supports Range) ──
  if (!videoUrlStr.startsWith('{')) {
    return Response.redirect(videoUrlStr, 302);
  }

  // ── 3. Case: chunked JSON metadata ────────────────────────────────────────
  let meta: ChunkMeta;
  try {
    meta = JSON.parse(videoUrlStr) as ChunkMeta;
  } catch {
    return new Response('Invalid video metadata', { status: 500 });
  }

  if (!meta.chunked || !Array.isArray(meta.ids) || meta.ids.length === 0) {
    return new Response('Invalid chunk metadata', { status: 500 });
  }

  // ── 4. Determine total size ───────────────────────────────────────────────
  let totalSize: number;
  try {
    totalSize = await getTotalSize(meta);
  } catch (err: any) {
    console.error('[stream-video] size probe failed:', err.message);
    return new Response('Failed to probe video size', { status: 502 });
  }

  // ── 5. Parse Range header ─────────────────────────────────────────────────
  const rangeHeader = req.headers.get('range');
  let start = 0;
  let end = totalSize - 1;
  let isPartial = false;

  if (rangeHeader) {
    const match = /bytes=(\d+)-(\d*)/.exec(rangeHeader);
    if (match) {
      start = parseInt(match[1], 10);
      end = match[2] ? parseInt(match[2], 10) : totalSize - 1;
      end = Math.min(end, totalSize - 1);
      isPartial = true;
    }
  }

  const chunkLength = end - start + 1;

  // ── 6. Build a streaming response that skips to [start, end] ─────────────
  const stream = new ReadableStream({
    async start(controller) {
      let cursor = 0; // byte position across all chunks

      for (const fileId of meta.ids) {
        if (cursor > end) break; // already past our range

        let chunkBuf: ArrayBuffer;
        try {
          chunkBuf = await fetchChunkBuffer(meta, fileId);
        } catch (err: any) {
          console.error('[stream-video] chunk fetch error:', err.message);
          controller.error(err);
          return;
        }

        const chunkSize = chunkBuf.byteLength;
        const chunkStart = cursor;
        const chunkEnd = cursor + chunkSize - 1;

        // Does this chunk overlap [start, end]?
        if (chunkEnd < start) {
          cursor += chunkSize;
          continue;
        }

        // Slice out the portion we need
        const sliceFrom = Math.max(start - chunkStart, 0);
        const sliceTo = Math.min(end - chunkStart + 1, chunkSize);

        controller.enqueue(new Uint8Array(chunkBuf, sliceFrom, sliceTo - sliceFrom));
        cursor += chunkSize;
      }

      controller.close();
    },
  });

  const status = isPartial ? 206 : 200;
  const headers: Record<string, string> = {
    'Content-Type': 'video/mp4',
    'Accept-Ranges': 'bytes',
    'Content-Length': String(chunkLength),
    'Cache-Control': 'public, max-age=3600',
  };

  if (isPartial) {
    headers['Content-Range'] = `bytes ${start}-${end}/${totalSize}`;
  }

  return new Response(stream, { status, headers });
}
