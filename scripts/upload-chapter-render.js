/**
 * upload-chapter-render.js
 *
 * Uploads out/chapter-{CHAPTER_ID}.mp4 to Appwrite Storage,
 * then POSTs to the webhook URL to notify the application.
 *
 * Environment variables (set as GitHub Actions secrets):
 *   APPWRITE_ENDPOINT    - e.g. https://fra.cloud.appwrite.io/v1
 *   APPWRITE_PROJECT_ID  - Appwrite project ID
 *   APPWRITE_API_KEY     - Server API key with storage.write scope
 *   APPWRITE_BUCKET_ID   - Target storage bucket for chapter videos
 *   CHAPTER_ID           - chapterId being rendered
 *   WEBHOOK_URL          - POST endpoint to notify (render-chapter-callback)
 */

'use strict';

const sdk  = require('node-appwrite');
const { InputFile } = require('node-appwrite/file');
const fs   = require('fs');
const path = require('path');

async function upload() {
  const chapterId  = process.env.CHAPTER_ID;
  const webhookUrl = process.env.WEBHOOK_URL;
  const endpoint   = (process.env.APPWRITE_ENDPOINT ?? '').replace(/\/$/, '');
  const projectId  = process.env.APPWRITE_PROJECT_ID;
  const apiKey     = process.env.APPWRITE_API_KEY;
  const bucketId   = process.env.APPWRITE_BUCKET_ID;

  const filePath = path.join(process.cwd(), 'out', `chapter-${chapterId}.mp4`);

  // ── Guards ──────────────────────────────────────────────────────────────
  if (!chapterId) {
    console.error('❌ CHAPTER_ID not set');
    await notify(webhookUrl, chapterId, null, 'failed', 'CHAPTER_ID env var missing');
    process.exit(1);
  }
  if (!endpoint || !projectId || !apiKey || !bucketId) {
    console.error('❌ Missing Appwrite env vars');
    await notify(webhookUrl, chapterId, null, 'failed', 'Appwrite env vars missing on runner');
    process.exit(1);
  }
  if (!fs.existsSync(filePath)) {
    console.error('❌ Rendered file not found:', filePath);
    await notify(webhookUrl, chapterId, null, 'failed', 'Rendered MP4 file not found on runner');
    process.exit(1);
  }

  // ── Upload ───────────────────────────────────────────────────────────────
  const client  = new sdk.Client().setEndpoint(endpoint).setProject(projectId).setKey(apiKey);
  const storage = new sdk.Storage(client);

  const fileSizeMB = (fs.statSync(filePath).size / 1024 / 1024).toFixed(1);
  console.log(`☁️  Uploading chapter-${chapterId}.mp4 (${fileSizeMB} MB) → Appwrite bucket ${bucketId}`);

  try {
    const fileBuffer = fs.readFileSync(filePath);
    const filename   = `chapter-${chapterId}.mp4`;

    const result = await storage.createFile({
      bucketId,
      fileId: `chapter-${chapterId}`.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 36),
      file: InputFile.fromBuffer(fileBuffer, filename, 'video/mp4'),
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
