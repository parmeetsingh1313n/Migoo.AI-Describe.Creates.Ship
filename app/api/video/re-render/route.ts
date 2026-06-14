import { db } from "@/config/db";
import { shortVideoAssets, shortVideoSeries } from "@/config/schema";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { triggerRender } from "@/lib/video-render";
import { getMusicUrl } from "@/lib/music-urls";

/**
 * API to RE-RENDER a video that previously failed or needs a fresh render.
 * 
 * Unlike /api/video/render, this endpoint:
 *  1. Resets the video status to allow re-rendering (bypasses "already rendered" guard)
 *  2. Reconstructs ALL props from DB data (scene videos, music, etc.)
 *  3. Clears the old videoUrl so the render starts fresh
 * 
 * This conserves AI credits because only the Remotion render is re-done —
 * no script, audio, images, or video clips are regenerated.
 */
export async function POST(req: Request) {
    try {
        const { videoId } = await req.json();

        if (!videoId) {
            return NextResponse.json({ success: false, error: "Missing videoId" }, { status: 400 });
        }

        // 1. Fetch video assets
        const [video] = await db.select().from(shortVideoAssets).where(eq(shortVideoAssets.videoId, videoId));
        if (!video) {
            return NextResponse.json({ success: false, error: "Video not found" }, { status: 404 });
        }

        // Guard removed: allow force-retry even if status is 'rendering'
        // (video may be stuck due to a crash — user explicitly triggered Force Retry)

        // 2. Fetch series config for music, caption style, language
        const [series] = await db.select().from(shortVideoSeries).where(eq(shortVideoSeries.seriesId, video.seriesId));
        const musicUrl = series?.music ? getMusicUrl(series.music) : '';

        // 3. Clean up any existing rendered video files/chunks from Appwrite storage
        const currentVideoUrl = video.videoUrl;
        const endpoint = (process.env.APPWRITE_VIDEO_ENDPOINT || process.env.APPWRITE_ENDPOINT || '').replace(/\/$/, '');
        const projectId = process.env.APPWRITE_VIDEO_PROJECT_ID || process.env.APPWRITE_PROJECT_ID;
        const apiKey = process.env.APPWRITE_VIDEO_API_KEY || process.env.APPWRITE_API_KEY;
        const bucketId = process.env.APPWRITE_VIDEO_BUCKET_ID || process.env.APPWRITE_BUCKET_ID;

        if (endpoint && projectId && apiKey && bucketId) {
            try {
                const { Client, Storage } = require('node-appwrite');
                const client = new Client().setEndpoint(endpoint).setProject(projectId).setKey(apiKey);
                const storage = new Storage(client);

                // A. URL-based cleanup (when DB has a videoUrl)
                if (currentVideoUrl) {
                    if (currentVideoUrl.startsWith('{')) {
                        try {
                            const parsed = JSON.parse(currentVideoUrl);
                            if (parsed.chunked && Array.isArray(parsed.ids)) {
                                console.log(`☁️ Deleting ${parsed.ids.length} old video chunks from Appwrite storage...`);
                                const deleteProjectId = parsed.projectId || projectId;
                                const deleteBucketId = parsed.bucketId || bucketId;
                                const deleteClient = new Client().setEndpoint(endpoint).setProject(deleteProjectId).setKey(apiKey);
                                const deleteStorage = new Storage(deleteClient);

                                for (const fid of parsed.ids) {
                                    try {
                                        await deleteStorage.deleteFile(deleteBucketId, fid);
                                        console.log(`   ✅ Appwrite chunk file deleted: ${fid}`);
                                    } catch (chDelErr: any) {
                                        console.warn(`   ⚠️ Failed to delete chunk ${fid}:`, chDelErr.message);
                                    }
                                }
                            }
                        } catch (jsonErr: any) {
                            console.warn('⚠️ Failed to parse chunked videoUrl JSON for deletion:', jsonErr.message);
                        }
                    } else {
                        // Normal file deletion
                        const cleanVideoId = videoId.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 36);
                        try {
                            console.log(`☁️ Deleting Appwrite file ${cleanVideoId} from bucket ${bucketId}`);
                            await storage.deleteFile(bucketId, cleanVideoId);
                            console.log(`✅ Appwrite file deleted: ${cleanVideoId}`);
                        } catch (delErr: any) {
                            console.warn(`⚠️ Failed to delete video file ${cleanVideoId}:`, delErr.message);
                        }
                    }
                }

                // B. Proactive cleanup: always try to delete expected IDs even if videoUrl is null
                //    (handles stuck renders where chunks were uploaded but webhook never fired)
                const cleanVideoId = videoId.replace(/[^a-zA-Z0-9._-]/g, '-');
                // Single-file ID
                try { await storage.deleteFile(bucketId, cleanVideoId.slice(0, 36)); } catch { /* not found — fine */ }
                // Chunk IDs (try up to 20 potential chunks)
                for (let i = 0; i < 20; i++) {
                    const chunkId = `v-${cleanVideoId.slice(0, 28)}-${i}`.slice(0, 36);
                    try { await storage.deleteFile(bucketId, chunkId); } catch { break; /* no more chunks */ }
                }
                console.log(`✅ Proactive Appwrite cleanup done for ${videoId}`);
            } catch (err: any) {
                console.error('❌ Failed to delete file from Appwrite Storage during re-render reset:', err?.message ?? err);
            }
        }

        // 3.5. Reset video status — critical to bypass triggerRender's "already rendered" guard
        await db.update(shortVideoAssets).set({
            status: 'pending',
            videoUrl: null,
        }).where(eq(shortVideoAssets.videoId, videoId));

        // 4. Reconstruct avatar clip data from stored avatarClipUrls
        //    avatarClipUrls format: [introVideoUrl, outroVideoUrl]
        //    For re-renders of older videos we may not have the TTS audio URLs,
        //    so intro/outro are optional. The video will render content scenes only.
        const avatarUrls = (video.avatarClipUrls as string[] | null) || [];
        const INTRO_DURATION_SEC = 9;   // Default intro TTS duration estimate
        const OUTRO_DURATION_SEC = 9.5; // Default outro TTS duration estimate

        let introClip: any = undefined;
        let outroClip: any = undefined;

        // Check if avatarClipUrls contain full objects (new format) or just strings (old format)
        if (avatarUrls.length >= 2) {
            const introEntry = avatarUrls[0] as any;
            const outroEntry = avatarUrls[1] as any;

            if (typeof introEntry === 'object' && introEntry?.videoUrl && introEntry?.audioUrl) {
                // New format: full clip objects stored
                introClip = introEntry;
                outroClip = outroEntry;
            } else if (typeof introEntry === 'string' && introEntry) {
                // Old format: just video URLs, no TTS audio available
                // Skip intro/outro — they require TTS audio we don't have
                console.log(`⚠️ Re-render ${videoId}: avatar clip URLs are old format (strings only). Skipping intro/outro.`);
            }
        }

        // 5. Calculate total duration
        const narrationDuration = video.audioDuration || 60;
        const introDuration = introClip ? (introClip.durationSec || INTRO_DURATION_SEC) : 0;
        const outroDuration = outroClip ? (outroClip.durationSec || OUTRO_DURATION_SEC) : 0;
        const totalDurationSec = introDuration + narrationDuration + outroDuration;

        // 6. Build complete Remotion props from DB data
        const props: Record<string, any> = {
            imageUrls: video.imageUrls || [],
            sceneVideoUrls: (video.sceneVideoUrls as string[]) || [],
            audioUrl: video.audioUrl,
            audioDuration: video.audioDuration,
            musicUrl,
            captionData: video.captionData || { segments: [] },
            captionStyle: series?.captionStyle || 'bold-pop',
            language: series?.language || 'en-IN',
            durationInFrames: Math.floor(totalDurationSec * 30),
        };

        // Include intro/outro if we have full clip data
        if (introClip) props.introClip = introClip;
        if (outroClip) props.outroClip = outroClip;

        // sceneVideoDurations are not stored in DB — Remotion Composition
        // falls back to 5s default per scene, which triggers playbackRate
        // calculation. This is fine for most cases.

        console.log(`🔄 Re-rendering video ${videoId} (${introClip ? 'with' : 'without'} intro/outro, duration=${totalDurationSec}s)`);

        // 7. Trigger render
        const result = await triggerRender(videoId, props);

        return NextResponse.json({
            success: true,
            message: `Re-render started (${result.mode} mode)${!introClip ? ' — without intro/outro' : ''}`,
        });

    } catch (error: any) {
        console.error("❌ Re-render API error:", error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
