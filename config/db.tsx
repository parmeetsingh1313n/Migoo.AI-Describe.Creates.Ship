import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { env } from '@/lib/env';

// Neon HTTP driver — stateless, no connection pool needed.
// Per-request timeouts are handled by the dbRetry wrapper below.
const sql = neon(env.DATABASE_URL);

export const db = drizzle(sql);

/**
 * Legacy (read-only) DB client pointing to the OLD Neon project.
 * Used as a fallback to surface historical course data that was
 * created before the primary database was migrated.
 * Set LEGACY_DATABASE_URL in .env to enable; null if not configured.
 */
export const dbLegacy = (() => {
    const legacyUrl = process.env.LEGACY_DATABASE_URL;
    if (!legacyUrl) return null;
    try {
        return drizzle(neon(legacyUrl));
    } catch {
        return null;
    }
})();

/**
 * Retry a database operation with exponential backoff.
 * Retries on timeout / connection errors (common with Neon cold starts).
 *
 * @example
 *   const rows = await dbRetry(() =>
 *       db.select().from(usersTable).where(eq(usersTable.email, email))
 *   );
 */
export async function dbRetry<T>(
    fn: () => Promise<T>,
    { retries = 3, baseDelayMs = 1000 } = {}
): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            return await fn();
        } catch (err: any) {
            lastError = err;
            const errStr = String(err?.message || "").toLowerCase();
            const causeStr = String(err?.cause?.message || "").toLowerCase();
            const causeName = String(err?.cause?.name || "").toLowerCase();

            const isRetryable =
                errStr.includes('timeout') ||
                errStr.includes('econnreset') ||
                errStr.includes('aborted') ||
                errStr.includes('fetch failed') ||
                errStr.includes('failed to fetch') ||
                causeStr.includes('timeout') ||
                causeStr.includes('aborted') ||
                causeStr.includes('fetch failed') ||
                causeName.includes('aborterror') ||
                err?.cause?.code === 23; // TIMEOUT_ERR DOMException

            if (!isRetryable || attempt === retries) throw err;
            const delay = baseDelayMs * 2 ** attempt;
            console.warn(
                `⚠️ DB retry ${attempt + 1}/${retries} after ${delay}ms — ${err?.message?.slice(0, 100)}`
            );
            await new Promise((r) => setTimeout(r, delay));
        }
    }
    throw lastError;
}
