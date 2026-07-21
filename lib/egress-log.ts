/**
 * @module lib/egress-log
 * @description Lightweight, dependency-free egress visibility. Logs the byte
 * size of a response payload per endpoint so you can SEE which routes/courses
 * burn data-transfer in your platform logs (Vercel) BEFORE hitting a quota 402,
 * instead of finding out when the DB starts rejecting queries.
 *
 * No dashboard, no external service — just structured console lines you can grep:
 *   📊 EGRESS route=/api/course course=abc bytes=812345 (0.77 MB) rows=42
 *
 * Also keeps a small in-process running total per route (best-effort; resets on
 * cold start) so a single log line can show cumulative pressure within a warm
 * lambda.
 */

const runningTotals = new Map<string, number>();

/** Approximate serialized byte size of any JSON-able value (UTF-8). */
export function approxBytes(payload: unknown): number {
    try {
        if (payload == null) return 0;
        const str = typeof payload === "string" ? payload : JSON.stringify(payload);
        return Buffer.byteLength(str, "utf-8");
    } catch {
        return 0;
    }
}

/**
 * Log the egress size of a payload for a route. Returns the payload unchanged so
 * it can wrap a return value inline:
 *   return apiSuccess(logEgress("/api/course", data, { course: courseId, rows: slides.length }));
 */
export function logEgress<T>(
    route: string,
    payload: T,
    meta: Record<string, string | number> = {}
): T {
    const bytes = approxBytes(payload);
    const total = (runningTotals.get(route) ?? 0) + bytes;
    runningTotals.set(route, total);

    const mb = (bytes / 1_048_576).toFixed(2);
    const totalMb = (total / 1_048_576).toFixed(2);
    const metaStr = Object.entries(meta).map(([k, v]) => `${k}=${v}`).join(" ");
    console.log(
        `📊 EGRESS route=${route} ${metaStr} bytes=${bytes} (${mb} MB) warmTotal=${totalMb}MB`
    );
    return payload;
}
