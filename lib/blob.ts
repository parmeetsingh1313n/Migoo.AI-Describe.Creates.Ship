/**
 * @module lib/blob
 * @description Appwrite Storage wrapper — drop-in replacement for the old
 * Vercel Blob `putWithRotation` helper.
 *
 * Exports the same `putWithRotation(pathname, body, options)` signature so
 * every call-site in `inngest/functions.ts` continues to work unchanged.
 *
 * Retry strategy:
 *   - 503/502/504 (Varnish/backend blips): retry same config up to 3×
 *     with exponential backoff (2s → 4s → 8s).
 *   - 401/403 (auth failure): rotate to next Appwrite config immediately.
 *   - Other errors: rotate config and retry once.
 */

import { Client, ID, Storage } from "node-appwrite";
import { InputFile } from "node-appwrite/file";

// ═══════════════════════════════════════════════════════════════════════════════
// APPWRITE CLIENT SETUP
// ═══════════════════════════════════════════════════════════════════════════════

interface AppwriteConfig {
    projectId: string;
    apiKey: string;
    bucketId: string;
}

function getAppwriteConfigs(): AppwriteConfig[] {
    const configs: AppwriteConfig[] = [];
    
    // Check base config (with video fallback)
    const baseProject = process.env.APPWRITE_VIDEO_PROJECT_ID || process.env.APPWRITE_PROJECT_ID;
    const baseApiKey = process.env.APPWRITE_VIDEO_API_KEY || process.env.APPWRITE_API_KEY;
    const baseBucket = process.env.APPWRITE_VIDEO_BUCKET_ID || process.env.APPWRITE_BUCKET_ID;

    if (baseProject && baseApiKey && baseBucket) {
        configs.push({
            projectId: baseProject,
            apiKey: baseApiKey,
            bucketId: baseBucket,
        });
    }

    // Check numbered configs (1 through 5)
    for (let i = 1; i <= 5; i++) {
        const projectId = process.env[`APPWRITE_PROJECT_ID${i}`];
        const apiKey = process.env[`APPWRITE_API_KEY${i}`];
        const bucketId = process.env[`APPWRITE_BUCKET_ID${i}`];

        if (projectId && apiKey && bucketId) {
            configs.push({ projectId, apiKey, bucketId });
        }
    }

    if (configs.length === 0) {
        throw new Error("No Appwrite config found. Set APPWRITE_PROJECT_ID, APPWRITE_API_KEY, and APPWRITE_BUCKET_ID in .env");
    }

    return configs;
}

let currentConfigIndex = 0;

function getNextAppwriteConfig(): AppwriteConfig {
    const configs = getAppwriteConfigs();
    const config = configs[currentConfigIndex % configs.length];
    currentConfigIndex++;
    return config;
}

function getConfigAt(index: number): AppwriteConfig {
    const configs = getAppwriteConfigs();
    return configs[index % configs.length];
}

function createAppwriteClient(config: AppwriteConfig): Client {
    const endpoint = (process.env.APPWRITE_VIDEO_ENDPOINT || process.env.APPWRITE_ENDPOINT)?.replace(/\/$/, "");
    
    if (!endpoint) {
        throw new Error("Missing Appwrite config. Set APPWRITE_ENDPOINT in .env");
    }

    return new Client()
        .setEndpoint(endpoint)
        .setProject(config.projectId)
        .setKey(config.apiKey);
}

// ─────────────────────────────────────────────────────────────────────────────
// Return type that matches the old Vercel Blob PutBlobResult shape so no
// call-site needs to change.
// ─────────────────────────────────────────────────────────────────────────────
export type PutBlobResult = {
    url: string;
    pathname: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Kept for API compatibility (was used with Vercel token rotation).
// With Appwrite we use a single API key, so this just returns an empty string.
// ─────────────────────────────────────────────────────────────────────────────
export function getBlobToken(): string {
    return "";
}

// ═══════════════════════════════════════════════════════════════════════════════
// UPLOAD HELPER — WITH RETRY + CONFIG ROTATION
// ═══════════════════════════════════════════════════════════════════════════════

/** Whether an HTTP status code is a transient server error worth retrying on the SAME config */
function isTransient(code: number | undefined): boolean {
    // Only retry true network-level failures (code === undefined) or rate-limiting (429)
    // on the SAME config. Server issues like 502, 503, 504 are usually node/project quota/space issues on Appwrite,
    // so we want to immediately rotate to the next config to succeed instantly!
    if (code === undefined) return true;
    return code === 429;
}

/** Whether an HTTP status code means this config is permanently broken (rotate) */
function isAuthError(code: number | undefined): boolean {
    return code === 401 || code === 403;
}

/**
 * Upload a file to Appwrite Storage with automatic retry and config rotation.
 *
 * @param pathname  Logical path used as the filename (e.g. "shorts/abc/audio.wav").
 *                  The last segment becomes the stored filename.
 * @param body      File content — a Buffer or string.
 * @param options   `contentType` and optional `access` / `allowOverwrite` flags
 *                  (access is ignored; all files inherit bucket-level permissions).
 * @returns         `{ url, pathname }` — url is the public view URL.
 */
/**
 * One full pass: try every config once (with per-config retries for
 * transient/auth errors as before). Returns the result on success, or throws
 * the last error with an extra `allServerErrors` flag if every config that
 * was tried failed with a 5xx — that pattern means the whole Appwrite region
 * is degraded (confirmed: reads still succeed, only writes 500 — see
 * lib/blob.ts module docblock), not that any one project/config is broken,
 * so rotating configs again won't help but waiting briefly might.
 */
async function attemptAllConfigsOnce(
    endpoint: string,
    filename: string,
    buffer: Buffer,
    pathname: string,
    startIndex: number
): Promise<PutBlobResult> {
    const configs = getAppwriteConfigs();
    const totalConfigs = configs.length;
    const MAX_PER_CONFIG_RETRIES = 3;

    let lastError: any = null;
    let serverErrorCount = 0;

    for (let rotation = 0; rotation < totalConfigs; rotation++) {
        const configIndex = (startIndex + rotation) % totalConfigs;
        const config = configs[configIndex];

        const client  = createAppwriteClient(config);
        const storage = new Storage(client);

        console.log(
            `☁️  Appwrite upload → config #${configIndex + 1}/${totalConfigs} | projectId=${config.projectId.substring(0, 8)} | bucket=${config.bucketId.substring(0, 8)} | file=${filename} | ${buffer.length} bytes`
        );

        let baseDelay = 2000; // 2s → 4s → 8s for transient retries
        let configFailedWithServerError = false;

        for (let attempt = 1; attempt <= MAX_PER_CONFIG_RETRIES; attempt++) {
            try {
                const fileId = ID.unique(); // fresh ID every attempt

                const result = await storage.createFile({
                    bucketId: config.bucketId,
                    fileId,
                    file: InputFile.fromBuffer(buffer, filename),
                });

                const url = `${endpoint}/storage/buckets/${config.bucketId}/files/${result.$id}/view?project=${config.projectId}`;
                console.log(`✅ Appwrite upload success (config #${configIndex + 1}, attempt ${attempt}): ${url}`);
                return { url, pathname };

            } catch (err: any) {
                lastError = err;
                const code: number | undefined = err?.code;

                console.error(
                    `❌ Appwrite upload failed (config #${configIndex + 1}, attempt ${attempt}/${MAX_PER_CONFIG_RETRIES}): ` +
                    `code=${code ?? 'network'} type=${err?.type ?? err?.name ?? 'Error'} — ${err?.message} | response=${err?.response}`
                );

                if (code !== undefined && code >= 500) configFailedWithServerError = true;

                // Auth error — this config's key is bad, immediately rotate to next config
                if (isAuthError(code)) {
                    console.warn(`🔑 Auth error on config #${configIndex + 1}, rotating to next config...`);
                    break; // exit per-config retry loop → try next config
                }

                // Transient error — wait and retry same config
                if (isTransient(code) && attempt < MAX_PER_CONFIG_RETRIES) {
                    console.warn(`⏳ Transient ${code} error, retrying in ${baseDelay}ms...`);
                    await new Promise(r => setTimeout(r, baseDelay));
                    baseDelay *= 2; // exponential backoff: 2s → 4s → 8s
                    continue;
                }

                // Non-transient, non-auth error — rotate to next config
                if (!isTransient(code)) {
                    console.warn(`⚠️ Non-transient error (${code}), rotating to next config...`);
                    break;
                }

                // Exhausted retries for transient error — rotate to next config
                console.warn(`⚠️ Exhausted ${MAX_PER_CONFIG_RETRIES} retries on config #${configIndex + 1}, rotating...`);
                break;
            }
        }

        if (configFailedWithServerError) serverErrorCount++;
    }

    // All configs exhausted this pass
    const err = lastError ?? new Error(`Appwrite upload failed for ${pathname}`);
    (err as any).allServerErrors = serverErrorCount === totalConfigs;
    throw err;
}

export async function putWithRotation(
    pathname: string,
    body: Buffer | string,
    options: {
        access?: string;
        contentType?: string;
        allowOverwrite?: boolean;
    }
): Promise<PutBlobResult> {
    const endpoint = (process.env.APPWRITE_VIDEO_ENDPOINT || process.env.APPWRITE_ENDPOINT)?.replace(/\/$/, "");
    if (!endpoint) {
        throw new Error("Missing Appwrite config. Set APPWRITE_ENDPOINT in .env");
    }

    // Normalise body to Buffer once
    const buffer: Buffer = Buffer.isBuffer(body)
        ? body
        : Buffer.from(body as string, "utf-8");

    const filename = pathname.split("/").filter(Boolean).pop() ?? "file";

    const configs = getAppwriteConfigs();
    const totalConfigs = configs.length;

    // Start from the current rotating index
    const startIndex = currentConfigIndex % totalConfigs;
    currentConfigIndex++;

    try {
        return await attemptAllConfigsOnce(endpoint, filename, buffer, pathname, startIndex);
    } catch (err: any) {
        if (!err.allServerErrors) {
            console.error(`❌ All ${totalConfigs} Appwrite config(s) failed for: ${pathname}`);
            throw err;
        }

        // Every config failed with a 5xx — this is Appwrite's shared regional
        // infra having an issue (confirmed live: reads succeed, writes 500
        // across every project on the same endpoint), not any one config
        // being broken. These blips have historically self-resolved within
        // seconds to minutes, so one delayed full retry is worth it before
        // giving up for good.
        console.warn(`⚠️ All ${totalConfigs} configs hit 5xx — likely a regional Appwrite outage, not a config issue. Waiting 8s for one retry pass...`);
        await new Promise(r => setTimeout(r, 8000));

        try {
            return await attemptAllConfigsOnce(endpoint, filename, buffer, pathname, startIndex);
        } catch (retryErr: any) {
            console.error(`❌ All ${totalConfigs} Appwrite config(s) failed again after retry pass for: ${pathname}`);
            throw retryErr;
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUTHENTICATED READ HELPER
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Fetch an Appwrite storage file that putWithRotation produced. The stored
 * files inherit bucket-level permissions which are NOT guaranteed to be
 * public-read, and the account can hit its bandwidth quota (HTTP 402) — a bare
 * `fetch(url)` then fails. This resolves the API key for the URL's project (from
 * the same env configs used to upload) and sends it as X-Appwrite-Key so the
 * read is authenticated. Falls back to an unauthenticated fetch if the project
 * can't be matched (e.g. a legacy non-Appwrite URL).
 *
 * @param url  A `.../storage/buckets/<b>/files/<id>/view?project=<p>` URL.
 * @returns    The response body as a Buffer.
 */
export async function fetchAppwriteFile(url: string): Promise<Buffer> {
    // Find the API key whose project matches this URL's ?project= param.
    let apiKey: string | undefined;
    try {
        const projectId = new URL(url).searchParams.get("project") ?? undefined;
        if (projectId) {
            const match = getAppwriteConfigs().find((c) => c.projectId === projectId);
            apiKey = match?.apiKey;
        }
    } catch { /* not a parseable URL — fall through to plain fetch */ }

    const headers: Record<string, string> = {};
    if (apiKey) {
        const projectId = new URL(url).searchParams.get("project") ?? "";
        headers["X-Appwrite-Project"] = projectId;
        headers["X-Appwrite-Key"] = apiKey;
    }

    // Retry transient failures (network / 429 / 5xx) a few times.
    let lastErr: any = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const res = await fetch(url, { headers });
            if (res.ok) return Buffer.from(await res.arrayBuffer());
            lastErr = new Error(`HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 160)}`);
            // 401/403/402 won't fix themselves on retry; bail immediately.
            if ([401, 402, 403, 404].includes(res.status)) break;
        } catch (e: any) {
            lastErr = e;
        }
        if (attempt < 3) await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
    throw new Error(`Failed to fetch Appwrite file ${url} — ${lastErr?.message ?? lastErr}`);
}
