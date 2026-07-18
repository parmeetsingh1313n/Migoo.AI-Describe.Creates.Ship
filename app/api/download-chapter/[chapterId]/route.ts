import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/config/db';
import { chapterGenerationStatus } from '@/config/schema';
import { eq } from 'drizzle-orm';
import fs from 'fs';
import path from 'path';

// Streaming ~400 MB of chunks through this function takes well over the
// default 10s serverless limit. Allow up to 5 min (Vercel Pro cap) so the
// browser download completes instead of the function being killed mid-stream.
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: any }
) {
  // Await params to be safe and compatible with Next.js 14 & 15
  const resolvedParams = await params;
  const chapterId = resolvedParams?.chapterId;

  if (!chapterId) {
    return new Response('Missing chapterId', { status: 400 });
  }

  try {
    // 1. Fetch chapter render record from DB
    const [row] = await db
      .select({
        videoUrl: chapterGenerationStatus.videoUrl,
      })
      .from(chapterGenerationStatus)
      .where(eq(chapterGenerationStatus.chapterId, chapterId))
      .limit(1);

    if (!row) {
      return new Response('Chapter render not found', { status: 404 });
    }

    const videoUrlStr = row.videoUrl;
    if (!videoUrlStr) {
      return new Response('Video not rendered yet', { status: 404 });
    }

    const filename = `chapter-${chapterId}.mp4`;

    // Case 1: Local render file (starts with /renders/ or doesn't have http)
    if (!videoUrlStr.startsWith('http') && !videoUrlStr.startsWith('{')) {
      const localPath = path.join(process.cwd(), 'public', videoUrlStr);
      if (fs.existsSync(localPath)) {
        const fileStream = fs.createReadStream(localPath);
        
        // Convert Node.js Readable to Web ReadableStream
        const webStream = new ReadableStream({
          start(controller) {
            fileStream.on('data', (chunk) => controller.enqueue(chunk));
            fileStream.on('end', () => controller.close());
            fileStream.on('error', (err) => controller.error(err));
          },
          cancel() {
            fileStream.destroy();
          }
        });

        return new Response(webStream, {
          headers: {
            'Content-Type': 'video/mp4',
            'Content-Disposition': `attachment; filename="${filename}"`,
          },
        });
      }
    }

    // Case 2: Chunked Appwrite upload (JSON metadata)
    if (videoUrlStr.startsWith('{')) {
      try {
        const metadata = JSON.parse(videoUrlStr);
        if (metadata.chunked && Array.isArray(metadata.ids)) {
          const { ids, bucketId, endpoint, projectId, rawBinary, totalBytes } = metadata;
          const apiKey = process.env.APPWRITE_VIDEO_API_KEY || process.env.APPWRITE_API_KEY;

          if (!apiKey) {
            console.error(`No Appwrite API key available to stream chunks for ${chapterId}`);
            return new Response('Server missing Appwrite credentials for video download', { status: 500 });
          }

          // Pre-flight the first chunk so a broken upload / bad key fails with a
          // clear HTTP error BEFORE we start a 200 streaming response (which the
          // browser would otherwise render as a silent 0-byte download).
          const firstUrl = `${endpoint}/storage/buckets/${bucketId}/files/${ids[0]}/download?project=${projectId}`;
          const preflight = await fetch(firstUrl, {
            headers: { 'X-Appwrite-Project': projectId, 'X-Appwrite-Key': apiKey },
          });
          if (!preflight.ok) {
            const detail = await preflight.text().catch(() => '');
            console.error(`Preflight for chunk ${ids[0]} failed: HTTP ${preflight.status} ${detail.slice(0, 200)}`);
            return new Response(`Video chunk unavailable on Appwrite (HTTP ${preflight.status})`, { status: 502 });
          }

          // Stream chunks sequentially on-the-fly to the browser.
          // rawBinary=true: chunks are raw byte splits of the original MP4, so
          // concatenating them yields the exact original bytes (header + full
          // duration intact). We already hold the first chunk's response.
          const stream = new ReadableStream({
            async start(controller) {
              try {
                for (let i = 0; i < ids.length; i++) {
                  const fileId = ids[i];
                  const res = i === 0
                    ? preflight
                    : await fetch(`${endpoint}/storage/buckets/${bucketId}/files/${fileId}/download?project=${projectId}`, {
                        headers: { 'X-Appwrite-Project': projectId, 'X-Appwrite-Key': apiKey },
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
                console.error(`Error streaming ${rawBinary ? 'raw-binary' : 'mp4'} chunks for ${chapterId}:`, err);
                controller.error(err);
              }
            },
          });

          const headers: Record<string, string> = {
            'Content-Type': 'video/mp4',
            'Content-Disposition': `attachment; filename="${filename}"`,
            'Cache-Control': 'no-store',
          };
          // Advertise the full size so the browser shows real download progress.
          if (typeof totalBytes === 'number' && totalBytes > 0) {
            headers['Content-Length'] = String(totalBytes);
          }

          return new Response(stream, { headers });
        }
      } catch (jsonErr: any) {
        console.error('Failed to parse/stream videoUrl metadata:', jsonErr.message);
        return new Response(`Error preparing chunked download: ${jsonErr.message}`, { status: 500 });
      }
    }

    // Case 3: Single Appwrite URL (plain string)
    // Redirect browser to the raw direct file
    return NextResponse.redirect(videoUrlStr);

  } catch (err: any) {
    console.error('Download chapter endpoint error:', err);
    return new Response(`Error preparing download: ${err.message}`, { status: 500 });
  }
}
