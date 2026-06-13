import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/config/db';
import { chapterGenerationStatus } from '@/config/schema';
import { eq } from 'drizzle-orm';
import fs from 'fs';
import path from 'path';

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
          const { ids, bucketId, endpoint, projectId, rawBinary } = metadata;
          const apiKey = process.env.APPWRITE_VIDEO_API_KEY || process.env.APPWRITE_API_KEY;

          // Stream chunks sequentially on-the-fly to the browser.
          // If rawBinary=true: chunks are raw byte splits of the original MP4.
          // Streaming them sequentially gives the browser the exact original bytes
          // → original header with correct full duration is preserved!
          // If rawBinary=false (old FFmpeg segment mode): same stream but
          // duration will be wrong since chunks have independent headers.
          const stream = new ReadableStream({
            async start(controller) {
              try {
                for (const fileId of ids) {
                  // Always use /download (not /view) to get raw bytes from Appwrite
                  const url = `${endpoint}/storage/buckets/${bucketId}/files/${fileId}/download?project=${projectId}`;
                  const res = await fetch(url, {
                    headers: {
                      'X-Appwrite-Project': projectId,
                      'X-Appwrite-Key': apiKey || '',
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
                console.error(`Error streaming ${rawBinary ? 'raw-binary' : 'mp4'} chunks for ${chapterId}:`, err);
                controller.error(err);
              }
            },
          });

          return new Response(stream, {
            headers: {
              'Content-Type': 'video/mp4',
              'Content-Disposition': `attachment; filename="${filename}"`,
            },
          });
        }
      } catch (jsonErr: any) {
        console.error('Failed to parse/stream videoUrl metadata:', jsonErr.message);
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
