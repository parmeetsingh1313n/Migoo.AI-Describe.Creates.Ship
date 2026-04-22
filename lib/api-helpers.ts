/**
 * @module api-helpers
 * @description Shared API response utilities with security headers and typed responses.
 *
 * Provides consistent response formatting, security headers, and error handling
 * across all Next.js API routes.
 *
 * @example
 * ```ts
 * import { apiSuccess, apiError, withSecurityHeaders } from '@/lib/api-helpers';
 *
 * // Success response
 * return apiSuccess({ data: courses }, 200);
 *
 * // Error response
 * return apiError('Not found', 404, 'COURSE_NOT_FOUND');
 *
 * // Add security headers to existing response
 * return withSecurityHeaders(NextResponse.json(data));
 * ```
 */

import { NextResponse } from "next/server";

/** Standard API success response shape */
export interface ApiSuccessResponse<T = unknown> {
  success: true;
  data: T;
  timestamp: string;
}

/** Standard API error response shape */
export interface ApiErrorResponse {
  success: false;
  error: string;
  code?: string;
  details?: unknown;
  timestamp: string;
}

/** Security headers applied to all API responses */
const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-XSS-Protection": "1; mode=block",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "X-DNS-Prefetch-Control": "off",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
};

/** CORS headers for API responses */
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": process.env.NEXT_PUBLIC_APP_URL || "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

/**
 * Apply security and CORS headers to a NextResponse object.
 *
 * @param response - The NextResponse to add headers to
 * @returns The same response with security headers applied
 */
export function withSecurityHeaders(response: NextResponse): NextResponse {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(key, value);
  }
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    response.headers.set(key, value);
  }
  return response;
}

/**
 * Create a standardized success API response with security headers.
 *
 * @param data - Response payload
 * @param status - HTTP status code (default: 200)
 * @returns NextResponse with security headers and typed body
 */
export function apiSuccess<T>(data: T, status: number = 200): NextResponse {
  const body: ApiSuccessResponse<T> = {
    success: true,
    data,
    timestamp: new Date().toISOString(),
  };
  const response = NextResponse.json(body, { status });
  return withSecurityHeaders(response);
}

/**
 * Create a standardized error API response with security headers.
 *
 * @param message - Human-readable error message
 * @param status - HTTP status code (default: 500)
 * @param code - Optional machine-readable error code
 * @param details - Optional additional error details (hidden in production)
 * @returns NextResponse with security headers and typed error body
 */
export function apiError(
  message: string,
  status: number = 500,
  code?: string,
  details?: unknown
): NextResponse {
  const body: ApiErrorResponse = {
    success: false,
    error: message,
    code,
    details: process.env.NODE_ENV === "development" ? details : undefined,
    timestamp: new Date().toISOString(),
  };
  const response = NextResponse.json(body, { status });
  return withSecurityHeaders(response);
}

/**
 * Create a standardized OPTIONS response for CORS preflight.
 *
 * @returns NextResponse with CORS and security headers
 */
export function apiOptions(): NextResponse {
  const response = new NextResponse(null, { status: 204 });
  return withSecurityHeaders(response);
}
