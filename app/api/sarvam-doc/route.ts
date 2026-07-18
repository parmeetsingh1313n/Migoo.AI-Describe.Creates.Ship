import { NextRequest, NextResponse } from "next/server";
import { unzipSarvamOutput } from "./unzip-helper";


const SARVAM_BASE = "https://api.sarvam.ai";

/** Read all Sarvam API keys from env: SARVAM_API_KEY, SARVAM_API_KEY_2 … _10 */
function getSarvamKeys(): string[] {
    const keys: string[] = [];
    if (process.env.SARVAM_API_KEY) keys.push(process.env.SARVAM_API_KEY);
    for (let i = 2; i <= 10; i++) {
        const k = process.env[`SARVAM_API_KEY_${i}`];
        if (k) keys.push(k);
    }
    return keys;
}

/** Resolve the key for a given index, falling back to the primary key. A doc
 *  job is stateful across requests, so once create-job picks a working key the
 *  client threads its index (key_index) back on upload/start/status. */
function sarvamKeyAt(index?: number): string {
    const keys = getSarvamKeys();
    if (keys.length === 0) throw new Error("No SARVAM_API_KEY configured");
    if (typeof index === "number" && index >= 0 && index < keys.length) return keys[index];
    return keys[0];
}

/** Credit/auth/rate-limit errors that warrant rotating to the next key. */
function isSarvamKeyError(status: number, body: string): boolean {
    return status === 401 || status === 402 || status === 403 || status === 429 ||
        body.includes('Insufficient credits') || body.includes('insufficient_credits') ||
        body.includes('add more credits');
}

// ── Appwrite ──────────────────────────────────────────────────────────────────
const APPWRITE_ENDPOINT = process.env.APPWRITE_ENDPOINT!;
const APPWRITE_PROJECT  = process.env.APPWRITE_PROJECT_ID!;
const APPWRITE_API_KEY  = process.env.APPWRITE_API_KEY!;
const APPWRITE_BUCKET   = process.env.APPWRITE_BUCKET_ID!;

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/sarvam-doc
// body: { action: 'create-job', language?, format? }                        → { job_id, key_index }
//       { action: 'upload',     job_id, key_index, fileName, fileData(b64) } → { ok }
//       { action: 'start',      job_id, key_index }                          → { ok: true }
// GET  /api/sarvam-doc?action=status&job_id=xxx&key_index=n
//       → { state, markdown?, images? }
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { action } = body;

        switch (action) {
            case "create-job":   return createJob(body);
            case "upload":       return uploadFile(body);
            case "start":        return startJob(body);
            default:
                return NextResponse.json({ error: "Unknown action" }, { status: 400 });
        }
    } catch (err: any) {
        console.error("sarvam-doc POST error:", err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const action  = searchParams.get("action");
    const job_id  = searchParams.get("job_id");
    const keyIdx  = searchParams.get("key_index");

    if (action === "status" && job_id) {
        return pollStatus(job_id, keyIdx ? parseInt(keyIdx, 10) : 0);
    }
    return NextResponse.json({ error: "Unknown GET action" }, { status: 400 });
}

// ── 1. Create job (rotates keys to find a working one) ────────────────────────
async function createJob({ language = "en-IN", format = "md" }: any) {
    const keys = getSarvamKeys();
    if (keys.length === 0) throw new Error("No SARVAM_API_KEY configured");

    let lastErr = "";
    for (let ki = 0; ki < keys.length; ki++) {
        const keyLabel = ki === 0 ? "primary" : `key_${ki + 1}`;
        const res = await fetch(`${SARVAM_BASE}/doc-digitization/job/v1`, {
            method: "POST",
            headers: {
                "api-subscription-key": keys[ki],
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                job_parameters: { language, output_format: format },
            }),
        });
        if (res.ok) {
            const data = await res.json();
            // Return key_index so the client threads the SAME key through the job.
            return NextResponse.json({ job_id: data.job_id, state: data.job_state, key_index: ki });
        }
        const txt = await res.text();
        lastErr = `${res.status} ${txt.slice(0, 120)}`;
        if (isSarvamKeyError(res.status, txt) && ki < keys.length - 1) {
            console.warn(`⚠️ sarvam-doc create-job [${keyLabel}] ${lastErr} — rotating key...`);
            continue;
        }
        throw new Error(`Sarvam create-job failed: ${lastErr}`);
    }
    throw new Error(`Sarvam create-job: all ${keys.length} key(s) exhausted (${lastErr})`);
}

// ── 2. Get upload URL + upload file ──────────────────────────────────────────
async function uploadFile({ job_id, key_index, fileName, fileData }: any) {
    const key = sarvamKeyAt(key_index);
    // Step A: get presigned URL from Sarvam
    const urlRes = await fetch(`${SARVAM_BASE}/doc-digitization/job/v1/upload-files`, {
        method: "POST",
        headers: {
            "api-subscription-key": key,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ job_id, files: [fileName] }),
    });
    if (!urlRes.ok) {
        const txt = await urlRes.text();
        throw new Error(`Sarvam get-upload-links failed: ${urlRes.status} ${txt}`);
    }
    const urlData = await urlRes.json();
    const presignedUrl: string = urlData.upload_urls?.[fileName]?.file_url;
    if (!presignedUrl) {
        throw new Error("No presigned URL returned from Sarvam");
    }

    // Step B: upload file directly to Sarvam's storage from server
    const fileBuffer = Buffer.from(fileData, "base64");
    const contentType = fileName.endsWith(".pdf") ? "application/pdf" : "application/zip";

    const uploadRes = await fetch(presignedUrl, {
        method: "PUT",
        headers: { "Content-Type": contentType },
        body: fileBuffer,
    });
    if (!uploadRes.ok) {
        throw new Error(`Sarvam file upload failed: ${uploadRes.status}`);
    }

    return NextResponse.json({ ok: true });
}

// ── 3. Start job ──────────────────────────────────────────────────────────────
async function startJob({ job_id, key_index }: any) {
    const key = sarvamKeyAt(key_index);
    const res = await fetch(`${SARVAM_BASE}/doc-digitization/job/v1/${job_id}/start`, {
        method: "POST",
        headers: { "api-subscription-key": key, "Content-Type": "application/json" },
        body: "{}",
    });
    if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Sarvam start failed: ${res.status} ${txt}`);
    }
    return NextResponse.json({ ok: true });
}

// ── 4. Poll status → extract markdown + images ───────────────────────────────
async function pollStatus(job_id: string, key_index = 0) {
    const key = sarvamKeyAt(key_index);
    const res = await fetch(`${SARVAM_BASE}/doc-digitization/job/v1/${job_id}/status`, {
        headers: { "api-subscription-key": key },
    });
    if (!res.ok) {
        throw new Error(`Sarvam status failed: ${res.status}`);
    }
    const data = await res.json();
    const state: string = data.job_state;

    // Still running
    if (!["Completed", "PartiallyCompleted"].includes(state)) {
        return NextResponse.json({ state });
    }

    // Download output ZIP
    const dlRes = await fetch(`${SARVAM_BASE}/doc-digitization/job/v1/${job_id}/download-files`, {
        method: "POST",
        headers: { "api-subscription-key": key, "Content-Type": "application/json" },
        body: "{}",
    });
    if (!dlRes.ok) {
        throw new Error(`Sarvam download-files failed: ${dlRes.status}`);
    }
    const dlData = await dlRes.json();
    const downloadUrls: Record<string, { file_url: string }> = dlData.download_urls || {};

    // Collect markdown text and image URLs
    let markdown = "";
    const imageAppwriteUrls: string[] = [];

    for (const [fname, { file_url }] of Object.entries(downloadUrls)) {
        const fileRes = await fetch(file_url);
        const buf = await fileRes.arrayBuffer();

        if (fname.endsWith(".md")) {
            // It's a markdown file
            markdown += new TextDecoder().decode(buf) + "\n\n";
        } else if (/\.(png|jpe?g)$/i.test(fname)) {
            // It's an extracted image — upload to Appwrite
            try {
                const appwriteUrl = await uploadToAppwrite(
                    Buffer.from(buf),
                    fname,
                    /\.png$/i.test(fname) ? "image/png" : "image/jpeg"
                );
                imageAppwriteUrls.push(appwriteUrl);
            } catch (e) {
                console.warn(`Failed to upload Sarvam image ${fname} to Appwrite:`, e);
            }
        } else if (fname.endsWith(".zip")) {
            // Output is a ZIP — unzip and process contents
            const { markdown: md, images } = await unzipSarvamOutput(buf);
            markdown += md;
            for (const img of images) {
                try {
                    const url = await uploadToAppwrite(img.data, img.name, img.mime);
                    imageAppwriteUrls.push(url);
                    // Replace local image path in markdown with Appwrite URL
                    markdown = markdown.replace(new RegExp(`!\\[.*?\\]\\(${escapeRegex(img.name)}\\)`, "g"), `![chart](${url})`);
                } catch (e) {
                    console.warn(`Failed to upload image ${img.name}:`, e);
                }
            }
        }
    }

    return NextResponse.json({
        state,
        markdown: markdown.trim(),
        images: imageAppwriteUrls,
    });
}

// ── Appwrite upload helper ────────────────────────────────────────────────────
async function uploadToAppwrite(data: Buffer | Uint8Array, fileName: string, mimeType: string): Promise<string> {
    const fileId = `sarvam_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const form = new FormData();
    form.append("fileId", fileId);
    // Cast to Uint8Array so TypeScript sees ArrayBuffer (not SharedArrayBuffer) — satisfies BlobPart
    form.append("file", new Blob([new Uint8Array(data)], { type: mimeType }), fileName);

    const res = await fetch(
        `${APPWRITE_ENDPOINT}/storage/buckets/${APPWRITE_BUCKET}/files`,
        {
            method: "POST",
            headers: {
                "X-Appwrite-Project": APPWRITE_PROJECT,
                "X-Appwrite-Key": APPWRITE_API_KEY,
            },
            body: form,
        }
    );
    if (!res.ok) {
        throw new Error(`Appwrite upload failed: ${res.status}`);
    }
    return `${APPWRITE_ENDPOINT}/storage/buckets/${APPWRITE_BUCKET}/files/${fileId}/view?project=${APPWRITE_PROJECT}`;
}

function escapeRegex(s: string) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
