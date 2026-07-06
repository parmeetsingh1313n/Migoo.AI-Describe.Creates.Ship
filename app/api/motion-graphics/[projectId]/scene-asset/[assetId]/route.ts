/**
 * GET /api/motion-graphics/[projectId]/scene-asset/[assetId]
 *
 * Serves a user-uploaded scene video asset (single or chunked in Appwrite) as a
 * proper video/mp4 response with HTTP Range support, so Remotion's
 * <OffthreadVideo>/<Video> (triggered by the .mp4 extension) can stream it and
 * a browser <video> can seek it. The [assetId] segment includes the ".mp4"
 * suffix (e.g. "abc123.mp4") — that suffix is what makes Remotion detect video.
 */

import { NextRequest } from "next/server";
import { db } from "@/config/db";
import { motionGraphicMessages } from "@/config/schema";
import { and, eq } from "drizzle-orm";
import { parseRange, fetchVideoBuffer, type VideoStreamMeta } from "@/lib/scene-asset";

interface SceneAssetRecord {
    id: string;
    sceneIndex: number;
    type: "image" | "video";
    url: string;
    name: string;
    streamMeta?: VideoStreamMeta;
}

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ projectId: string; assetId: string }> },
) {
    const { projectId, assetId: rawAssetId } = await params;
    const assetId = rawAssetId.replace(/\.mp4$/i, "");

    try {
        const [assetsMsg] = await db
            .select({ metadata: motionGraphicMessages.metadata })
            .from(motionGraphicMessages)
            .where(and(eq(motionGraphicMessages.projectId, projectId), eq(motionGraphicMessages.role, "assets")))
            .limit(1);

        const records: SceneAssetRecord[] = (assetsMsg?.metadata as any)?.assets || [];
        const record = records.find((r) => r.id === assetId && r.type === "video");
        if (!record?.streamMeta) return new Response("Asset not found", { status: 404 });

        const buffer = await fetchVideoBuffer(record.streamMeta);
        const totalSize = buffer.length;
        const rangeHeader = req.headers.get("range");

        if (rangeHeader) {
            const range = parseRange(rangeHeader, totalSize);
            if (!range) {
                return new Response("Invalid Range", { status: 416, headers: { "Content-Range": `bytes */${totalSize}` } });
            }
            const { start, end } = range;
            const slice = buffer.subarray(start, end + 1);
            return new Response(slice as any, {
                status: 206,
                headers: {
                    "Content-Type": "video/mp4",
                    "Content-Length": String(end - start + 1),
                    "Content-Range": `bytes ${start}-${end}/${totalSize}`,
                    "Accept-Ranges": "bytes",
                    "Cache-Control": "no-store",
                },
            });
        }

        return new Response(buffer as any, {
            status: 200,
            headers: {
                "Content-Type": "video/mp4",
                "Content-Length": String(totalSize),
                "Accept-Ranges": "bytes",
                "Cache-Control": "no-store",
            },
        });
    } catch (err: any) {
        console.error("[scene-asset/stream] error:", err?.message || err);
        return new Response(`Error streaming asset: ${err?.message}`, { status: 500 });
    }
}
