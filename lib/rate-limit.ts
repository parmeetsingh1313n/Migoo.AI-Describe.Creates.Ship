/**
 * @module rate-limit
 * @description In-memory sliding window rate limiter for API routes.
 *
 * Uses a simple Map-based approach with automatic cleanup of expired entries.
 * Suitable for single-instance deployments (Vercel serverless, etc.).
 *
 * @example
 * ```ts
 * import { rateLimit, getClientIp } from '@/lib/rate-limit';
 *
 * export async function POST(req: NextRequest) {
 *   const ip = getClientIp(req);
 *   const { success, remaining, reset } = rateLimit(ip, { maxRequests: 10, windowMs: 60000 });
 *   if (!success) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
 * }
 * ```
 */

import type { NextRequest } from "next/server";

/** Configuration options for the rate limiter */
export interface RateLimitOptions {
  /** Maximum number of requests allowed within the time window */
  maxRequests: number;
  /** Time window in milliseconds */
  windowMs: number;
}

/** Result of a rate limit check */
export interface RateLimitResult {
  /** Whether the request is allowed */
  success: boolean;
  /** Number of remaining requests in the current window */
  remaining: number;
  /** Timestamp (ms) when the current window resets */
  reset: number;
}

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

/** In-memory store for rate limit tracking */
const rateLimitStore = new Map<string, RateLimitEntry>();

/** Interval for cleaning up expired entries (5 minutes) */
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
let lastCleanup = Date.now();

/**
 * Clean up expired rate limit entries to prevent memory leaks.
 * Called automatically during rate limit checks.
 */
function cleanup(): void {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;

  lastCleanup = now;
  for (const [key, entry] of rateLimitStore.entries()) {
    if (now > entry.resetTime) {
      rateLimitStore.delete(key);
    }
  }
}

/**
 * Check and apply rate limiting for a given identifier.
 *
 * @param identifier - Unique identifier for the client (e.g., IP address, user ID)
 * @param options - Rate limit configuration
 * @returns RateLimitResult indicating whether the request is allowed
 */
export function rateLimit(
  identifier: string,
  options: RateLimitOptions = { maxRequests: 30, windowMs: 60_000 }
): RateLimitResult {
  cleanup();

  const now = Date.now();
  const entry = rateLimitStore.get(identifier);

  if (!entry || now > entry.resetTime) {
    // New window
    const resetTime = now + options.windowMs;
    rateLimitStore.set(identifier, { count: 1, resetTime });
    return { success: true, remaining: options.maxRequests - 1, reset: resetTime };
  }

  // Existing window
  entry.count++;

  if (entry.count > options.maxRequests) {
    return { success: false, remaining: 0, reset: entry.resetTime };
  }

  return {
    success: true,
    remaining: options.maxRequests - entry.count,
    reset: entry.resetTime,
  };
}

/**
 * Extract client IP address from a Next.js request.
 * Checks common proxy headers before falling back to "unknown".
 *
 * @param req - Next.js request object
 * @returns Client IP address string
 */
export function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  return req.headers.get("x-real-ip") ?? "unknown";
}

/**
 * Reset the rate limit store. Primarily used in testing.
 */
export function resetRateLimitStore(): void {
  rateLimitStore.clear();
}
