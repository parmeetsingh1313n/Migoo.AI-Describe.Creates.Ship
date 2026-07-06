/**
 * @module lib/scene-asset
 * @description Helpers for per-scene user-uploaded assets (images/videos) in
 * motion graphics. Handles uploading videos to Appwrite (single or chunked when
 * over the 50 MB per-file cap) and serving them back with HTTP Range support so
 * Remotion's <OffthreadVideo> can stream them.
 *
 * Images are small and go straight through putWithRotation (public blob URL).
 * Videos need this module because a) large ones must be split, and b) they must
 * be served from a URL that ends in `.mp4` so Remotion detects them as video.
 */

import { Client, ID, Storage } from "node-appwrite";
import { InputFile } from "node-appwrite/file";

// ─── Appwrite config (mirrors lib/blob.ts) ───────────────────────────────────
interface AppwriteConfig { projectId: string; apiKey: string; bucketId: string; endpoint: string }

export function getVideoAppwriteConfig(): AppwriteConfig {
    const endpoint = (process.env.APPWRITE_VIDEO_ENDPOINT || process.env.APPWRITE_ENDPOINT || "").replace(/\/$/, "");
    const projectId = process.env.APPWRITE_VIDEO_PROJECT_ID || process.env.APPWRITE_PROJECT_ID || "";
    const apiKey = process.env.APPWRITE_VIDEO_API_KEY || process.env.APPWRITE_API_KEY || "";
    const bucketId = process.env.APPWRITE_VIDEO_BUCKET_ID || process.env.APPWRITE_BUCKET_ID || "";
    if (!endpoint || !projectId || !apiKey || !bucketId) {
        throw new Error("Missing Appwrite video config (ENDPOINT / PROJECT_ID / API_KEY / BUCKET_ID)");
    }
    return { endpoint, projectId, apiKey, bucketId };
}

/** Resolve the API key that matches a projectId stored in chunk metadata. */
export function resolveApiKeyForProject(projectId: string): string {
    if (projectId === (process.env.APPWRITE_VIDEO_PROJECT_ID || process.env.APPWRITE_PROJECT_ID)) {
        return process.env.APPWRITE_VIDEO_API_KEY || process.env.APPWRITE_API_KEY || "";
    }
    for (let i = 1; i <= 5; i++) {
        if (projectId === process.env[`APPWRITE_PROJECT_ID${i}`]) return process.env[`APPWRITE_API_KEY${i}`] || "";
    }
    return process.env.APPWRITE_VIDEO_API_KEY || process.env.APPWRITE_API_KEY || "";
}

// ─── Streamable metadata stored per video asset ──────────────────────────────
export type VideoStreamMeta =
    | { chunked: false; fileId: string; bucketId: string; endpoint: string; projectId: string }
    | { chunked: true; ids: string[]; bucketId: string; endpoint: string; projectId: string };

const SINGLE_FILE_MAX = 49 * 1024 * 1024; // ~49 MB — safe margin under Appwrite's 50 MB per-file cap
const CHUNK_SIZE = 44 * 1024 * 1024;      // 44 MB per chunk when splitting

/**
 * Upload a video buffer to Appwrite. Small clips go as one file; larger clips
 * are split into raw byte chunks (each a separate file) that the stream route
 * later reassembles. Returns metadata the stream route uses to serve the video.
 */
export async function uploadVideoToAppwrite(buffer: Buffer, assetId: string): Promise<VideoStreamMeta> {
    const cfg = getVideoAppwriteConfig();
    const client = new Client().setEndpoint(cfg.endpoint).setProject(cfg.projectId).setKey(cfg.apiKey);
    const storage = new Storage(client);

    if (buffer.length <= SINGLE_FILE_MAX) {
        const fileId = ID.unique();
        await storage.createFile({ bucketId: cfg.bucketId, fileId, file: InputFile.fromBuffer(buffer, `${assetId}.mp4`) });
        return { chunked: false, fileId, bucketId: cfg.bucketId, endpoint: cfg.endpoint, projectId: cfg.projectId };
    }

    // Chunked: split into ≤44 MB raw byte slices, upload each as its own file.
    const totalChunks = Math.ceil(buffer.length / CHUNK_SIZE);
    const ids: string[] = [];
    for (let i = 0; i < totalChunks; i++) {
        const slice = buffer.subarray(i * CHUNK_SIZE, Math.min((i + 1) * CHUNK_SIZE, buffer.length));
        const fileId = `sa-${assetId}-${i}`.slice(0, 36);
        try { await storage.deleteFile({ bucketId: cfg.bucketId, fileId }); } catch { /* fresh */ }
        await storage.createFile({ bucketId: cfg.bucketId, fileId, file: InputFile.fromBuffer(Buffer.from(slice), `${fileId}.bin`) });
        ids.push(fileId);
    }
    return { chunked: true, ids, bucketId: cfg.bucketId, endpoint: cfg.endpoint, projectId: cfg.projectId };
}

/** Delete the Appwrite file(s) backing a video asset. Best-effort. */
export async function deleteVideoFromAppwrite(meta: VideoStreamMeta): Promise<void> {
    try {
        const apiKey = resolveApiKeyForProject(meta.projectId);
        const client = new Client().setEndpoint(meta.endpoint).setProject(meta.projectId).setKey(apiKey);
        const storage = new Storage(client);
        const ids = meta.chunked ? meta.ids : [meta.fileId];
        for (const fileId of ids) { try { await storage.deleteFile({ bucketId: meta.bucketId, fileId }); } catch { /* ignore */ } }
    } catch { /* best-effort */ }
}

// ─── Streaming ───────────────────────────────────────────────────────────────
export function parseRange(rangeHeader: string | null, totalSize: number): { start: number; end: number } | null {
    if (!rangeHeader) return null;
    const m = rangeHeader.match(/bytes=(\d*)-(\d*)/);
    if (!m) return null;
    const start = m[1] ? parseInt(m[1], 10) : 0;
    const end = m[2] ? parseInt(m[2], 10) : totalSize - 1;
    if (isNaN(start) || isNaN(end) || start > end || end >= totalSize) return null;
    return { start, end };
}

/** Download one Appwrite file's bytes (auth-injected for private buckets). */
async function fetchFile(fileId: string, meta: VideoStreamMeta, apiKey: string): Promise<Uint8Array> {
    const url = `${meta.endpoint}/storage/buckets/${meta.bucketId}/files/${fileId}/download?project=${meta.projectId}`;
    const res = await fetch(url, { headers: { "X-Appwrite-Project": meta.projectId, "X-Appwrite-Key": apiKey } });
    if (!res.ok) throw new Error(`Failed to fetch file ${fileId}: HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
}

/** Reassemble a video asset's full byte buffer from Appwrite. */
export async function fetchVideoBuffer(meta: VideoStreamMeta): Promise<Uint8Array> {
    const apiKey = resolveApiKeyForProject(meta.projectId);
    const ids = meta.chunked ? meta.ids : [meta.fileId];
    const parts: Uint8Array[] = [];
    for (const id of ids) parts.push(await fetchFile(id, meta, apiKey));
    const total = parts.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const p of parts) { out.set(p, off); off += p.length; }
    return out;
}
