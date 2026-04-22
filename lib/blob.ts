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
    
    // Check base config
    if (process.env.APPWRITE_PROJECT_ID && process.env.APPWRITE_API_KEY && process.env.APPWRITE_BUCKET_ID) {
        configs.push({
            projectId: process.env.APPWRITE_PROJECT_ID,
            apiKey: process.env.APPWRITE_API_KEY,
            bucketId: process.env.APPWRITE_BUCKET_ID,
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
    const endpoint = process.env.APPWRITE_ENDPOINT?.replace(/\/$/, "");
    
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

/** Whether an HTTP status code is a transient server error worth retrying */
function isTransient(code: number | undefined): boolean {
    return code === 502 || code === 503 || code === 504 || code === 429;
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
export async function putWithRotation(
    pathname: string,
    body: Buffer | string,
    options: {
        access?: string;
        contentType?: string;
        allowOverwrite?: boolean;
    }
): Promise<PutBlobResult> {
    const endpoint = process.env.APPWRITE_ENDPOINT?.replace(/\/$/, "");
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

    // Try each config in order, with per-config retries for transient errors
    const MAX_PER_CONFIG_RETRIES = 3;
    const MAX_CONFIG_ROTATIONS   = totalConfigs; // try every config once

    let lastError: any = null;

    for (let rotation = 0; rotation < MAX_CONFIG_ROTATIONS; rotation++) {
        const configIndex = (startIndex + rotation) % totalConfigs;
        const config = configs[configIndex];

        const client  = createAppwriteClient(config);
        const storage = new Storage(client);

        console.log(
            `☁️  Appwrite upload → config #${configIndex + 1}/${totalConfigs} | projectId=${config.projectId.substring(0, 8)} | bucket=${config.bucketId.substring(0, 8)} | file=${filename} | ${buffer.length} bytes`
        );

        let baseDelay = 2000; // 2s → 4s → 8s for transient retries

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
                    `code=${code} — ${err?.message?.substring(0, 200)}`
                );

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
    }

    // All configs exhausted
    console.error(`❌ All ${totalConfigs} Appwrite config(s) failed for: ${pathname}`);
    throw lastError ?? new Error(`Appwrite upload failed for ${pathname}`);
}
