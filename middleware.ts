import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'

// Make home page and course-generator public so users can stay on them when signed out
const isPublicRoute = createRouteMatcher([
    '/',  // Landing page is public
    '/course-generator',  // Course generator (was previously /)
    '/sign-in(.*)',
    '/sign-up(.*)',
    '/api/webhooks(.*)',
    '/api/inngest(.*)',
    '/api/user',
    '/proxy(.*)',  // Remotion asset proxy
    '/api/render-chapter(.*)',
    '/api/render-chapter-callback(.*)',
    '/api/video/webhook',   // GitHub Actions upload callback (secured by WEBHOOK_SECRET header)
    '/api/video/props(.*)', // Remotion render props endpoint (secured by WEBHOOK_SECRET header/query)
    '/api/stream-video(.*)', // Video streaming endpoint (needs to be public for video tags/players)
    '/api/motion-graphics/(.*)/props',   // GitHub Actions fetch props (secured by WEBHOOK_SECRET)
    '/api/motion-graphics/(.*)/webhook', // GitHub Actions upload callback (secured by WEBHOOK_SECRET)
    '/api/motion-graphics/(.*)/scene-asset/(.*)', // User-uploaded scene video, fetched by the Remotion render farm
])

// Rate limiting store for middleware-level protection
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();

/**
 * Simple rate limiter for the middleware layer.
 *
 * Read (GET/HEAD) and write (POST/PUT/PATCH/DELETE) requests get SEPARATE
 * budgets keyed per IP, because the app legitimately polls several status
 * endpoints at once (course image-readiness every 4s, chapter status every 3s,
 * per-chapter render polls). A single 60/min cap made those polls trip a 429,
 * which blocked the UI from SEEING generated images (generation itself runs in
 * Inngest and was never rate-limited). Reads get a high ceiling; writes stay
 * strict to keep abuse protection on the endpoints that actually mutate data.
 */
const READ_LIMIT = 300;   // GET/HEAD per minute per IP — covers heavy polling
const WRITE_LIMIT = 60;   // POST/PUT/PATCH/DELETE per minute per IP

function checkRateLimit(ip: string, isWrite: boolean): { allowed: boolean; remaining: number } {
    const now = Date.now();
    const windowMs = 60_000; // 1 minute
    const maxRequests = isWrite ? WRITE_LIMIT : READ_LIMIT;
    const mapKey = `${isWrite ? 'w' : 'r'}:${ip}`;

    const entry = rateLimitMap.get(mapKey);

    // Cleanup old entries periodically
    if (rateLimitMap.size > 10000) {
        for (const [key, val] of rateLimitMap.entries()) {
            if (now > val.resetTime) rateLimitMap.delete(key);
        }
    }

    if (!entry || now > entry.resetTime) {
        rateLimitMap.set(mapKey, { count: 1, resetTime: now + windowMs });
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

        const isWrite = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
        const limit = isWrite ? WRITE_LIMIT : READ_LIMIT;
        const { allowed, remaining } = checkRateLimit(ip, isWrite);

        if (!allowed) {
            return NextResponse.json(
                { error: 'Too many requests. Please try again later.' },
                {
                    status: 429,
                    headers: {
                        'Retry-After': '60',
                        'X-RateLimit-Limit': String(limit),
                        'X-RateLimit-Remaining': '0',
                    },
                }
            );
        }

        // Add rate limit headers to response
        const response = NextResponse.next();
        response.headers.set('X-RateLimit-Limit', String(limit));
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
        // Run for API routes EXCEPT /api/stream-video/* (must be fully public for video players)
        '/(api(?!/stream-video)|trpc)(.*)',
    ],
}