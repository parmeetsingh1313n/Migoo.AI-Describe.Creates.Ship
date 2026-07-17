/**
 * upload-chapter-render.js
 *
 * Uploads out/chapter-{CHAPTER_ID}.mp4 to Appwrite Storage,
 * then POSTs to the webhook URL to notify the application.
 *
 * Environment variables (set as GitHub Actions secrets):
 *   APPWRITE_VIDEO_ENDPOINT   - e.g. https://fra.cloud.appwrite.io/v1
 *   APPWRITE_VIDEO_PROJECT_ID - Appwrite project ID
 *   APPWRITE_VIDEO_API_KEY    - Server API key with storage.write scope
 *   APPWRITE_VIDEO_BUCKET_ID  - Target storage bucket for chapter videos
 *   CHAPTER_ID                - chapterId being rendered
 *   WEBHOOK_URL               - POST endpoint to notify (render-chapter-callback)
 */

'use strict';

const sdk  = require('node-appwrite');
const { InputFile } = require('node-appwrite/file');
const fs   = require('fs');
const path = require('path');

async function upload() {
  const chapterId  = process.env.CHAPTER_ID;
  const webhookUrl = process.env.WEBHOOK_URL;
  const endpoint   = (process.env.APPWRITE_VIDEO_ENDPOINT ?? process.env.APPWRITE_ENDPOINT ?? '').replace(/\/$/, '');
  const projectId  = process.env.APPWRITE_VIDEO_PROJECT_ID;
  const apiKey     = process.env.APPWRITE_VIDEO_API_KEY;
  const bucketId   = process.env.APPWRITE_VIDEO_BUCKET_ID;

  const filePath = path.join(process.cwd(), 'out', `chapter-${chapterId}.mp4`);

  // ── Guards ──────────────────────────────────────────────────────────────
  if (!chapterId) {
    console.error('❌ CHAPTER_ID not set');
    await notify(webhookUrl, chapterId, null, 'failed', 'CHAPTER_ID env var missing');
    process.exit(1);
  }
  if (!endpoint || !projectId || !apiKey || !bucketId) {
    console.error('❌ Missing Appwrite env vars (APPWRITE_VIDEO_ENDPOINT / PROJECT_ID / API_KEY / BUCKET_ID)');
    await notify(webhookUrl, chapterId, null, 'failed', 'Appwrite env vars missing on runner');
    process.exit(1);
  }
  if (!fs.existsSync(filePath)) {
    console.error('❌ Rendered file not found:', filePath);
    await notify(webhookUrl, chapterId, null, 'failed', 'Rendered MP4 file not found on runner');
    process.exit(1);
  }

  // ── GitHub Release upload (primary path for large files) ─────────────────
  const repo    = process.env.GITHUB_REPOSITORY;
  const ghToken = process.env.GITHUB_TOKEN;

  if (ghToken && repo) {
    console.log(`🐙 Uploading to GitHub Release 'renders' in ${repo}...`);
    try {
      const { execSync } = require('child_process');

      // Ensure the 'renders' release exists
      try {
        execSync(`gh release view renders --repo "${repo}"`, { env: { ...process.env, GITHUB_TOKEN: ghToken } });
      } catch {
        console.log(`   Release 'renders' not found. Creating it...`);
        execSync(`gh release create renders --title "Rendered Videos" --notes "Rendered chapter videos for course generator" --repo "${repo}"`, { env: { ...process.env, GITHUB_TOKEN: ghToken } });
      }

      // Upload file using gh CLI (supports up to 2GB files)
      console.log(`   Uploading ${path.basename(filePath)}...`);
      execSync(`gh release upload renders "${filePath}" --clobber --repo "${repo}"`, { env: { ...process.env, GITHUB_TOKEN: ghToken } });

      const videoUrl = `https://github.com/${repo}/releases/download/renders/chapter-${chapterId}.mp4`;
      console.log('✅ GitHub Upload complete:', videoUrl);

      await notify(webhookUrl, chapterId, videoUrl, 'completed', null);
      console.log('🎉 Done!');
      process.exit(0);
    } catch (err) {
      console.error('❌ GitHub upload failed:', err?.message ?? err);
      console.log('⚠️ Falling back to Appwrite upload...');
    }
  }

  // ── Appwrite upload ───────────────────────────────────────────────────────
  const client  = new sdk.Client().setEndpoint(endpoint).setProject(projectId).setKey(apiKey);
  const storage = new sdk.Storage(client);

  const sidecarPath = filePath.replace('.mp4', '-chunks.json');
  let useChunked = false;
  let chunksDir = '';
  let chunkFiles = [];
  if (fs.existsSync(sidecarPath)) {
    try {
      const sidecar = JSON.parse(fs.readFileSync(sidecarPath, 'utf-8'));
      chunksDir = path.join(path.dirname(filePath), `chapter-${chapterId}-chunks`);
      chunkFiles = sidecar.chunkFiles || [];
      if (chunkFiles.length > 0 && fs.existsSync(chunksDir)) {
        useChunked = true;
      }
    } catch (err) {
      console.warn('⚠️ Failed to parse chunk sidecar:', err.message);
    }
  }

  if (useChunked) {
    console.log(`☁️  Uploading ${chunkFiles.length} chunks from ${chunksDir} → Appwrite bucket ${bucketId}`);
    try {
      const chunkIds = [];
      for (let i = 0; i < chunkFiles.length; i++) {
        const chunkFile = chunkFiles[i];
        const chunkPath = path.join(chunksDir, chunkFile);
        const cleanChapterId = chapterId.replace(/[^a-zA-Z0-9._-]/g, '-');
        const chunkFileId = `c-${cleanChapterId.slice(0, 28)}-${i}`.slice(0, 36);
        console.log(`   [${i + 1}/${chunkFiles.length}] Uploading ${chunkFile} as ${chunkFileId}...`);
        await storage.createFile({
          bucketId,
          fileId: chunkFileId,
          file: InputFile.fromPath(chunkPath, chunkFile),
        });
        chunkIds.push(chunkFileId);
      }

      const videoUrl = JSON.stringify({
        chunked: true,
        rawBinary: true,   // raw byte split — NOT independent MP4 containers
        count: chunkFiles.length,
        ids: chunkIds,
        bucketId,
        endpoint,
        projectId,
      });

      console.log('✅ Raw-binary chunked upload complete. videoUrl metadata:', videoUrl);
      await notify(webhookUrl, chapterId, videoUrl, 'completed', null);
      console.log('🎉 Done!');
      process.exit(0);
    } catch (err) {
      console.error('❌ Chunked upload failed:', err?.message ?? err);
      await notify(webhookUrl, chapterId, null, 'failed', String(err?.message ?? err).slice(0, 300));
      process.exit(1);
    }
  } else {
    const fileSizeMB = (fs.statSync(filePath).size / 1024 / 1024).toFixed(1);
    console.log(`☁️  Uploading chapter-${chapterId}.mp4 (${fileSizeMB} MB) → Appwrite bucket ${bucketId}`);

    try {
      const filename = `chapter-${chapterId}.mp4`;

      const result = await storage.createFile({
        bucketId,
        fileId: `chapter-${chapterId}`.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 36),
        file: InputFile.fromPath(filePath, filename),
      });

      const videoUrl = `${endpoint}/storage/buckets/${bucketId}/files/${result.$id}/view?project=${projectId}`;
      console.log('✅ Upload complete:', videoUrl);

      await notify(webhookUrl, chapterId, videoUrl, 'completed', null);
      console.log('🎉 Done!');
      process.exit(0);
    } catch (err) {
      console.error('❌ Upload failed:', err?.message ?? err);
      await notify(webhookUrl, chapterId, null, 'failed', String(err?.message ?? err).slice(0, 300));
      process.exit(1);
    }
  }
}

async function notify(webhookUrl, chapterId, videoUrl, status, error) {
  if (!webhookUrl) {
    console.warn('⚠️  WEBHOOK_URL not set — skipping callback');
    return;
  }
  try {
    console.log(`📡 Calling webhook: ${webhookUrl} (status: ${status})`);
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chapterId, videoUrl, status, error }),
    });
    if (res.ok) {
      console.log('✅ Webhook notified');
    } else {
      console.warn('⚠️  Webhook returned non-OK:', res.status, await res.text().catch(() => ''));
    }
  } catch (err) {
    console.warn('⚠️  Webhook call failed:', err?.message ?? err);
  }
}

upload();
