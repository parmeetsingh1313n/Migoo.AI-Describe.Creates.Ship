/**
 * upload-motion-graphic.js
 *
 * Uploads the Remotion-rendered motion graphic video (out/video.mp4) to
 * Appwrite Storage, then calls the per-project webhook to notify the app.
 *
 * Environment variables required (set in GitHub Actions secrets):
 *   APPWRITE_ENDPOINT   – e.g. https://fra.cloud.appwrite.io/v1
 *   APPWRITE_PROJECT_ID – Appwrite project ID
 *   APPWRITE_API_KEY    – Server API key with storage.write scope
 *   APPWRITE_BUCKET_ID  – Target storage bucket ID
 *   PROJECT_ID          – Motion graphic project ID
 *   WEBHOOK_URL         – Full URL to PATCH (e.g. .../api/motion-graphics/{projectId}/webhook)
 *   WEBHOOK_SECRET      – Shared secret for Authorization: Bearer header
 */

const sdk  = require('node-appwrite');
const { InputFile } = require('node-appwrite/file');
const fs   = require('fs');
const path = require('path');

async function upload() {
    // ── Config ──────────────────────────────────────────────────────────────
    const filePath   = path.join(process.cwd(), 'out/video.mp4');
    const projectId  = process.env.PROJECT_ID;
    const webhookUrl = process.env.WEBHOOK_URL;

    const endpoint   = (process.env.APPWRITE_VIDEO_ENDPOINT || process.env.APPWRITE_ENDPOINT || '').replace(/\/$/, '');
    const appProjectId = process.env.APPWRITE_VIDEO_PROJECT_ID || process.env.APPWRITE_PROJECT_ID;
    const apiKey     = process.env.APPWRITE_VIDEO_API_KEY    || process.env.APPWRITE_API_KEY;
    const bucketId   = process.env.APPWRITE_VIDEO_BUCKET_ID  || process.env.APPWRITE_BUCKET_ID;

    // ── Guard: required env vars ─────────────────────────────────────────────
    if (!projectId) {
        console.error('❌ Missing PROJECT_ID');
        process.exit(1);
    }
    if (!endpoint || !appProjectId || !apiKey || !bucketId) {
        console.error('❌ Missing one or more Appwrite env vars');
        if (webhookUrl) await notifyWebhook(webhookUrl, null, 'failed');
        process.exit(1);
    }

    // ── Guard: file must exist ───────────────────────────────────────────────
    if (!fs.existsSync(filePath)) {
        console.error('❌ Rendered file not found:', filePath);
        if (webhookUrl) await notifyWebhook(webhookUrl, null, 'failed');
        process.exit(1);
    }

    // ── Appwrite client ──────────────────────────────────────────────────────
    const client = new sdk.Client()
        .setEndpoint(endpoint)
        .setProject(appProjectId)
        .setKey(apiKey);

    const storage = new sdk.Storage(client);

    const finalSizeBytes = fs.statSync(filePath).size;
    const fileSizeMB     = (finalSizeBytes / 1024 / 1024).toFixed(1);
    const CHUNK_SIZE_BYTES = 44 * 1024 * 1024; // 44 MB per chunk (under Appwrite 50 MB limit)

    try {
        if (finalSizeBytes > CHUNK_SIZE_BYTES) {
            // ── Chunked upload ───────────────────────────────────────────────
            const totalChunks = Math.ceil(finalSizeBytes / CHUNK_SIZE_BYTES);
            console.log(`✂️  Splitting ${fileSizeMB} MB → ${totalChunks} chunks of ≤44 MB...`);

            const chunksDir = path.join(path.dirname(filePath), 'video-chunks');
            fs.mkdirSync(chunksDir, { recursive: true });

            const inFd   = fs.openSync(filePath, 'r');
            const chunkIds = [];
            const BUF_SIZE = 8 * 1024 * 1024;
            const buf = Buffer.allocUnsafe(BUF_SIZE);

            try {
                for (let i = 0; i < totalChunks; i++) {
                    const chunkName = `chunk-${String(i).padStart(3, '0')}.bin`;
                    const chunkPath = path.join(chunksDir, chunkName);
                    const outFd = fs.openSync(chunkPath, 'w');
                    let bytesWritten = 0;

                    while (bytesWritten < CHUNK_SIZE_BYTES) {
                        const toRead = Math.min(BUF_SIZE, CHUNK_SIZE_BYTES - bytesWritten);
                        const bytesRead = fs.readSync(inFd, buf, 0, toRead, null);
                        if (bytesRead === 0) break;
                        fs.writeSync(outFd, buf, 0, bytesRead);
                        bytesWritten += bytesRead;
                    }
                    fs.closeSync(outFd);

                    const cleanId  = projectId.replace(/[^a-zA-Z0-9._-]/g, '-');
                    const chunkFileId = `mg-${cleanId.slice(0, 26)}-${i}`.slice(0, 36);

                    try { await storage.deleteFile({ bucketId, fileId: chunkFileId }); } catch {}

                    console.log(`   [${i + 1}/${totalChunks}] Uploading ${chunkName} as ${chunkFileId}...`);
                    await storage.createFile({
                        bucketId,
                        fileId: chunkFileId,
                        file:   InputFile.fromPath(chunkPath, chunkName),
                    });
                    chunkIds.push(chunkFileId);
                }
                fs.closeSync(inFd);

                const videoUrl = JSON.stringify({
                    chunked: true,
                    rawBinary: true,
                    count: totalChunks,
                    ids: chunkIds,
                    bucketId,
                    endpoint,
                    projectId: appProjectId,
                });

                console.log('✅ Chunked upload complete.');
                if (webhookUrl) await notifyWebhook(webhookUrl, videoUrl, 'completed');

                try { fs.rmSync(chunksDir, { recursive: true, force: true }); } catch {}
                console.log('🎉 Done!');
                process.exit(0);

            } catch (chunkErr) {
                try { fs.closeSync(inFd); } catch {}
                try { fs.rmSync(chunksDir, { recursive: true, force: true }); } catch {}
                throw chunkErr;
            }

        } else {
            // ── Single-file upload ───────────────────────────────────────────
            console.log(`☁️  Uploading single file ${fileSizeMB} MB → Appwrite (bucket: ${bucketId})...`);
            const filename   = `mg-${projectId}.mp4`;
            const cleanId    = `mg-${projectId.replace(/[^a-zA-Z0-9._-]/g, '-')}`.slice(0, 36);

            try { await storage.deleteFile({ bucketId, fileId: cleanId }); } catch {}

            const result = await storage.createFile({
                bucketId,
                fileId: cleanId,
                file:   InputFile.fromPath(filePath, filename),
            });

            const videoUrl = `${endpoint}/storage/buckets/${bucketId}/files/${result.$id}/view?project=${appProjectId}`;
            console.log('✅ Video uploaded:', videoUrl);

            if (webhookUrl) await notifyWebhook(webhookUrl, videoUrl, 'completed');
            console.log('🎉 Done!');
            process.exit(0);
        }

    } catch (error) {
        console.error('❌ Upload failed:', error?.message ?? error);
        if (webhookUrl) await notifyWebhook(webhookUrl, null, 'failed');
        process.exit(1);
    }
}

async function notifyWebhook(webhookUrl, videoUrl, status) {
    try {
        console.log(`📡 Calling webhook: ${webhookUrl} (status: ${status})`);
        const secret  = process.env.WEBHOOK_SECRET;
        const headers = { 'Content-Type': 'application/json' };
        if (secret) headers['Authorization'] = `Bearer ${secret}`;

        const body = { status };
        if (videoUrl) body.videoUrl = videoUrl;

        const response = await fetch(webhookUrl, {
            method:  'PATCH',
            headers,
            body:    JSON.stringify(body),
        });

        if (response.ok) {
            console.log('✅ Webhook notified successfully');
        } else {
            console.error('⚠️  Webhook notification failed:', await response.text());
        }
    } catch (err) {
        console.error('⚠️  Webhook call error:', err?.message ?? err);
    }
}

upload();
