import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { env } from '@/lib/env';

// Neon HTTP driver — stateless, no connection pool needed.
// Per-request timeouts are handled by the dbRetry wrapper below.
const sql = neon(env.DATABASE_URL);

export const db = drizzle(sql);

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
    { retries = 2, baseDelayMs = 1000 } = {}
): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            return await fn();
        } catch (err: any) {
            lastError = err;
            const isRetryable =
                err?.message?.includes('timeout') ||
                err?.message?.includes('ECONNRESET') ||
                err?.message?.includes('aborted') ||
                err?.cause?.code === 23; // TIMEOUT_ERR DOMException
            if (!isRetryable || attempt === retries) throw err;
            const delay = baseDelayMs * 2 ** attempt;
            console.warn(
                `⚠️ DB retry ${attempt + 1}/${retries} after ${delay}ms — ${err?.message?.slice(0, 80)}`
            );
            await new Promise((r) => setTimeout(r, delay));
        }
    }
    throw lastError;
}
