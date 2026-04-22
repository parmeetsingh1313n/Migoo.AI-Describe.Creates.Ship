import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'

// Make home page public so users can stay on it when signed out
const isPublicRoute = createRouteMatcher([
    '/',  // Home page is public
    '/sign-in(.*)',
    '/sign-up(.*)',
    '/api/webhooks(.*)',
    '/api/inngest(.*)',
    '/api/user'
])

// Rate limiting store for middleware-level protection
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();

/**
 * Simple rate limiter for middleware layer.
 * Limits each IP to 60 requests per minute for API routes.
 */
function checkRateLimit(ip: string): { allowed: boolean; remaining: number } {
    const now = Date.now();
    const windowMs = 60_000; // 1 minute
    const maxRequests = 60;

    const entry = rateLimitMap.get(ip);

    // Cleanup old entries periodically
    if (rateLimitMap.size > 10000) {
        for (const [key, val] of rateLimitMap.entries()) {
            if (now > val.resetTime) rateLimitMap.delete(key);
        }
    }

    if (!entry || now > entry.resetTime) {
        rateLimitMap.set(ip, { count: 1, resetTime: now + windowMs });
        return { allowed: true, remaining: maxRequests - 1 };
    }

    entry.count++;
    if (entry.count > maxRequests) {
        return { allowed: false, remaining: 0 };
    }

    return { allowed: true, remaining: maxRequests - entry.count };
}

export default clerkMiddleware(async (auth, req) => {
    // ── Rate limiting for API routes ──────────────────────────────
    if (req.nextUrl.pathname.startsWith('/api/')) {
        const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
            ?? req.headers.get('x-real-ip')
            ?? 'unknown';

        const { allowed, remaining } = checkRateLimit(ip);

        if (!allowed) {
            return NextResponse.json(
                { error: 'Too many requests. Please try again later.' },
                {
                    status: 429,
                    headers: {
                        'Retry-After': '60',
                        'X-RateLimit-Limit': '60',
                        'X-RateLimit-Remaining': '0',
                    },
                }
            );
        }

        // Add rate limit headers to response
        const response = NextResponse.next();
        response.headers.set('X-RateLimit-Limit', '60');
        response.headers.set('X-RateLimit-Remaining', String(remaining));
    }

    // ── CSRF protection for API mutations ────────────────────────
    const method = req.method;
    if (req.nextUrl.pathname.startsWith('/api/') && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
        const origin = req.headers.get('origin');
        const host = req.headers.get('host');

        // Allow requests from the same origin, or from Inngest/webhooks
        const isInternalRoute = req.nextUrl.pathname.startsWith('/api/inngest') ||
                                req.nextUrl.pathname.startsWith('/api/webhooks');

        if (!isInternalRoute && origin && host) {
            const originHost = new URL(origin).host;
            if (originHost !== host) {
                return NextResponse.json(
                    { error: 'CSRF validation failed: origin mismatch' },
                    { status: 403 }
                );
            }
        }
    }

    // ── Auth protection for non-public routes ────────────────────
    if (!isPublicRoute(req)) {
        await auth.protect()
    }
})

export const config = {
    matcher: [
        // Skip Next.js internals and all static files, unless found in search params
        '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest|mp4|webm|wav|mp3|m4a|ogg|avatars|tmp)).*)',
        // Always run for API routes
        '/(api|trpc)(.*)',
    ],
}