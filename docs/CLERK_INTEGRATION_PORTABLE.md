# Clerk Auth — Portable Integration Guide

A complete, copy-paste guide to the exact Clerk setup used in this project (Next.js App Router). Drop these files into any new Next.js project, point them at **its own Clerk workspace/keys**, and you get the same auth flow: video-background auth pages, a custom glass "Continue" button, middleware-level route protection + rate limiting + CSRF, and an auto-upsert of the signed-in user into your database.

Everything here is self-contained. Replace the keys with your new project's Clerk instance and adjust the DB upsert to your schema.

---

## 1. Install

```bash
npm install @clerk/nextjs@^6.36.10 axios zod
```

`@clerk/nextjs` v6 is required — the middleware API (`clerkMiddleware`, `createRouteMatcher`) and server helpers (`currentUser`) used below are v6-style. `axios` is used by the provider to call `/api/user`. `zod` is optional (only for the env validation in step 3).

---

## 2. Environment variables

Create a Clerk application at https://dashboard.clerk.com, then copy its keys into `.env` (or `.env.local`). **These must be your NEW project's own workspace keys** — do not reuse another app's keys.

```env
# ── Clerk (get these from YOUR OWN Clerk dashboard → API Keys) ──
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_xxxxxxxxxxxxxxxxxxxx
CLERK_SECRET_KEY=sk_test_xxxxxxxxxxxxxxxxxxxx

# Routing (these can stay as-is)
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL=/
NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL=/
NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=/
NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL=/
```

`NEXT_PUBLIC_*` keys are exposed to the browser (safe — publishable key). `CLERK_SECRET_KEY` is server-only; never expose it.

---

## 3. (Optional) Validated env config — `lib/env.ts`

Fails fast at import time if Clerk keys are missing. Skip this if you don't want zod validation.

```ts
import { z } from "zod";

const envSchema = z.object({
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().min(1, "Clerk publishable key is required"),
  CLERK_SECRET_KEY: z.string().min(1, "Clerk secret key is required"),
  // add your other vars (DATABASE_URL, etc.) here
});

export const env = envSchema.parse(process.env);
```

---

## 4. Middleware — `middleware.ts` (project root)

This is the heart of route protection. It does three things in order: **rate limiting** (60 req/min per IP on `/api/*`), **CSRF** (origin check on mutations), then **auth protection** (everything not in `isPublicRoute` requires a session).

> Trim the public-route list to your project. Keep `/`, `/sign-in(.*)`, `/sign-up(.*)` at minimum. Remove the app-specific routes (`/api/render-chapter`, `/api/motion-graphics/...`, etc.) that don't exist in your new project.

```ts
import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'

// Routes reachable WITHOUT a session. Everything else requires auth.
const isPublicRoute = createRouteMatcher([
    '/',                    // Landing page
    '/sign-in(.*)',
    '/sign-up(.*)',
    '/api/webhooks(.*)',    // external webhooks (verify their own signatures)
    '/api/user',            // user upsert (guarded by currentUser() inside)
    // add any other public endpoints for YOUR project here
])

// ── In-memory rate limiter (per server instance) ──────────────
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();

function checkRateLimit(ip: string): { allowed: boolean; remaining: number } {
    const now = Date.now();
    const windowMs = 60_000; // 1 minute
    const maxRequests = 60;

    const entry = rateLimitMap.get(ip);

    // Periodic cleanup so the map doesn't grow unbounded
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
    if (entry.count > maxRequests) return { allowed: false, remaining: 0 };
    return { allowed: true, remaining: maxRequests - entry.count };
}

export default clerkMiddleware(async (auth, req) => {
    // ── Rate limiting for API routes ──────────────────────────
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

        const response = NextResponse.next();
        response.headers.set('X-RateLimit-Limit', '60');
        response.headers.set('X-RateLimit-Remaining', String(remaining));
    }

    // ── CSRF protection for API mutations ─────────────────────
    const method = req.method;
    if (req.nextUrl.pathname.startsWith('/api/') && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
        const origin = req.headers.get('origin');
        const host = req.headers.get('host');

        const isInternalRoute = req.nextUrl.pathname.startsWith('/api/webhooks');

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

    // ── Auth protection for non-public routes ─────────────────
    if (!isPublicRoute(req)) {
        await auth.protect()
    }
})

export const config = {
    matcher: [
        // Skip Next.js internals and static files
        '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest|mp4|webm|wav|mp3|m4a|ogg)).*)',
        // Always run for API/trpc
        '/(api|trpc)(.*)',
    ],
}
```

> **Note on the rate limiter:** it's an in-memory `Map`, so each serverless instance / server process keeps its own count. It's a lightweight guard, not a distributed limiter. For strict global limits use Redis (e.g. Upstash). Fine as-is for most apps.

---

## 5. ClerkProvider + custom auth UI — `components/auth/ClerkWrapper.tsx`

This is the big one. It contains:
- `customAppearance` — a full glass/dark theme for Clerk's components
- `ClerkProviderWrapper` — wraps the app, sets sign-in/up URLs
- `CustomSignIn` / `CustomSignUp` — render Clerk's `<SignIn>`/`<SignUp>` but hide Clerk's submit button and inject a custom glass "Continue" button (via DOM + MutationObserver)
- `ProtectedRoute` — client-side guard that redirects to sign-in

```tsx
'use client';

import {
    ClerkProvider,
    RedirectToSignIn,
    SignIn,
    SignUp,
    useAuth,
} from '@clerk/nextjs';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

const customAppearance = {
    variables: {
        colorPrimary: '#ffffff',
        colorSuccess: '#10b981',
        colorWarning: '#f59e0b',
        colorDanger: '#ef4444',
        colorBackground: 'transparent',
        colorText: '#ffffff',
        colorInputText: '#ffffff',
        colorInputBackground: 'rgba(255, 255, 255, 0.08)',
        borderRadius: '0.75rem',
        colorAlphaShade: 'rgba(255, 255, 255, 0.1)',
        fontSize: '14px',
        fontFamily: "'Outfit', sans-serif",
    },
    elements: {
        rootBox: 'w-full',
        card: 'bg-transparent shadow-none border-0 p-0',
        header: 'hidden',
        socialButtonsBlockButton: {
            height: '44px',
            padding: '0 16px',
            borderRadius: '9999px',
            backgroundColor: 'rgba(255, 255, 255, 0.06)',
            backdropFilter: 'blur(12px)',
            color: 'rgba(255, 255, 255, 0.8)',
            fontWeight: '500',
            fontSize: '14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '12px',
            transition: 'all 200ms ease',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            '&:hover': {
                backgroundColor: 'rgba(255, 255, 255, 0.12)',
                transform: 'translateY(-1px)',
                boxShadow: '0 4px 20px rgba(0, 0, 0, 0.2)',
            }
        },
        socialButtonsBlockButtonArrow: { display: 'none' },
        socialButtonsBlockButtonText: { fontWeight: '500', color: 'rgba(255,255,255,0.8)' },
        socialButtonsProviderIcon: { width: '20px', height: '20px' },
        dividerLine: { backgroundColor: 'rgba(255, 255, 255, 0.12)' },
        dividerText: {
            color: 'rgba(255, 255, 255, 0.5)',
            backgroundColor: 'transparent',
            padding: '0 12px',
            fontSize: '13px'
        },
        formFieldLabel: {
            color: 'rgba(255, 255, 255, 0.7)',
            fontWeight: '500',
            fontSize: '14px',
            marginBottom: '6px'
        },
        formFieldInput: {
            height: '44px',
            padding: '0 20px',
            borderRadius: '9999px',
            backgroundColor: 'rgba(255, 255, 255, 0.06)',
            backdropFilter: 'blur(8px)',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            color: '#ffffff',
            fontSize: '14px',
            transition: 'all 200ms ease',
            '&:focus': {
                borderColor: 'rgba(255, 255, 255, 0.3)',
                boxShadow: '0 0 0 3px rgba(255, 255, 255, 0.08)',
                outline: 'none',
            }
        },
        // Clerk's own submit button is hidden — we inject our own (see below)
        formButtonPrimary: {
            display: 'none',
        },
        footer: { display: 'none' },
        footerActionLink: {
            color: 'rgba(255, 255, 255, 0.7)',
            fontWeight: '500',
            '&:hover': { textDecoration: 'underline', color: '#ffffff' }
        },
        identityPreviewEditButton: {
            color: 'rgba(255, 255, 255, 0.7)',
            '&:hover': { color: '#ffffff' }
        },
        identityPreview: {
            backgroundColor: 'rgba(255, 255, 255, 0.06)',
            borderRadius: '9999px',
            border: '1px solid rgba(255, 255, 255, 0.12)',
        },
        identityPreviewText: { color: 'rgba(255, 255, 255, 0.8)' },
        formFieldAction: {
            color: 'rgba(255, 255, 255, 0.5)',
            '&:hover': { color: '#ffffff' }
        },
        formFieldSuccessText: { color: '#10b981' },
        formFieldErrorText: { color: '#f87171' },
        otpCodeFieldInput: {
            backgroundColor: 'rgba(255, 255, 255, 0.06)',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            color: '#ffffff',
            borderRadius: '0.75rem',
        },
        alternativeMethodsBlockButton: {
            color: 'rgba(255, 255, 255, 0.7)',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            borderRadius: '9999px',
            backgroundColor: 'rgba(255, 255, 255, 0.04)',
            '&:hover': {
                backgroundColor: 'rgba(255, 255, 255, 0.08)',
                color: '#ffffff',
            }
        },
        userButtonBox: {
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
            gap: '4px'
        },
        userButtonOuterIdentifier: {
            fontSize: '13px',
            color: 'rgba(255, 255, 255, 0.6)'
        },
        userButtonPopoverCard: {
            backgroundColor: '#ffffff !important',
            color: '#171717 !important',
            border: '1px solid #f0f0f0 !important',
            boxShadow: '0 10px 30px rgba(0, 0, 0, 0.15) !important',
            borderRadius: '16px !important',
            overflow: 'hidden !important',
        },
        userButtonPopoverMain: {
            backgroundColor: '#ffffff !important',
            color: '#171717 !important',
        },
        userButtonPopoverActions: { backgroundColor: '#ffffff !important' },
        userButtonPopoverActionButton: {
            color: '#171717 !important',
            '&:hover': { backgroundColor: '#f5f5f5 !important' }
        },
        userButtonPopoverActionButtonText: {
            color: '#171717 !important',
            fontWeight: '500 !important',
        },
        userButtonPopoverActionButtonIcon: { color: '#737373 !important' },
        userPreviewMainIdentifier: {
            color: '#171717 !important',
            fontWeight: '600 !important',
        },
        userPreviewSecondaryIdentifier: { color: '#737373 !important' },
        userButtonPopoverFooter: { display: 'none !important' },
        navbar: {
            backgroundColor: 'rgba(0, 0, 0, 0.4)',
            backdropFilter: 'blur(12px)',
            borderBottom: '1px solid rgba(255, 255, 255, 0.1)'
        },
        navbarButton: {
            '&:hover': { backgroundColor: 'rgba(255, 255, 255, 0.08)' }
        },
    },
};

interface ClerkWrapperProps {
    children: React.ReactNode;
}

export function ClerkProviderWrapper({ children }: ClerkWrapperProps) {
    return (
        <ClerkProvider
            appearance={customAppearance}
            signInUrl="/sign-in"
            signUpUrl="/sign-up"
            afterSignInUrl="/"
            afterSignUpUrl="/"
        >
            {children}
        </ClerkProvider>
    );
}

// ── Custom Sign In ────────────────────────────────────────────
export function CustomSignIn() {
    const [mounted, setMounted] = useState(false);

    useEffect(() => { setMounted(true); }, []);

    useEffect(() => {
        if (!mounted) return;

        // Clerk renders its own submit button; we hide it and append a
        // custom glass "Continue" button that just proxies the click.
        const replaceClerkButton = () => {
            const clerkButton = document.querySelector('.cl-formButtonPrimary') as HTMLButtonElement;
            const formElement = clerkButton?.closest('form');

            if (clerkButton && formElement && !document.getElementById('custom-signin-button')) {
                clerkButton.style.display = 'none';

                const buttonContainer = document.createElement('div');
                buttonContainer.id = 'custom-signin-button';
                buttonContainer.className = 'mt-4';
                formElement.appendChild(buttonContainer);

                const handleCustomClick = () => { clerkButton.click(); };

                const customButton = document.createElement('button');
                customButton.type = 'button';
                customButton.className = 'w-full py-3 px-6 rounded-full text-white font-medium text-sm transition-all duration-300 hover:scale-[1.02] active:scale-95 cursor-pointer font-[Outfit]';
                customButton.style.cssText = 'background: rgba(255,255,255,0.09); backdrop-filter: blur(50px) saturate(180%); -webkit-backdrop-filter: blur(50px) saturate(180%); border: 1px solid rgba(255,255,255,0.25); box-shadow: inset 0 1px 1px rgba(255,255,255,0.22), 0 4px 24px rgba(0,0,0,0.3);';
                customButton.onclick = handleCustomClick;
                customButton.textContent = 'Continue';

                buttonContainer.appendChild(customButton);
            }
        };

        // Clerk mounts async, so retry a few times AND watch the DOM
        const attempts = [100, 300, 500, 1000];
        attempts.forEach(delay => { setTimeout(replaceClerkButton, delay); });

        const observer = new MutationObserver(() => { replaceClerkButton(); });
        observer.observe(document.body, { childList: true, subtree: true });
        return () => { observer.disconnect(); };
    }, [mounted]);

    if (!mounted) return null;

    return (
        <div className="w-full">
            <div className="flex flex-col items-center mb-5">
                <div className="relative">
                    <Image src={'/logo-transparent.png'} alt='logo' width={64} height={64} />
                </div>
                <h1 className="text-xl font-semibold text-center text-white mb-1 font-['Outfit']">
                    Welcome Back
                </h1>
                <p className="text-sm text-white/50 text-center mb-4 font-['Outfit']">
                    Sign in to your account
                </p>
            </div>

            <SignIn
                routing="path"
                path="/sign-in"
                appearance={customAppearance}
                signUpUrl="/sign-up"
            />
        </div>
    );
}

// ── Custom Sign Up ────────────────────────────────────────────
export function CustomSignUp() {
    const [mounted, setMounted] = useState(false);

    useEffect(() => { setMounted(true); }, []);

    useEffect(() => {
        if (!mounted) return;

        const replaceClerkButton = () => {
            const clerkButton = document.querySelector('.cl-formButtonPrimary') as HTMLButtonElement;
            const formElement = clerkButton?.closest('form');

            if (clerkButton && formElement && !document.getElementById('custom-signup-button')) {
                clerkButton.style.display = 'none';

                const buttonContainer = document.createElement('div');
                buttonContainer.id = 'custom-signup-button';
                buttonContainer.className = 'mt-4';
                formElement.appendChild(buttonContainer);

                const handleCustomClick = () => { clerkButton.click(); };

                const customButton = document.createElement('button');
                customButton.type = 'button';
                customButton.className = 'w-full py-3 px-6 rounded-full text-white font-medium text-sm transition-all duration-300 hover:scale-[1.02] active:scale-95 cursor-pointer font-[Outfit]';
                customButton.style.cssText = 'background: rgba(255,255,255,0.09); backdrop-filter: blur(50px) saturate(180%); -webkit-backdrop-filter: blur(50px) saturate(180%); border: 1px solid rgba(255,255,255,0.25); box-shadow: inset 0 1px 1px rgba(255,255,255,0.22), 0 4px 24px rgba(0,0,0,0.3);';
                customButton.onclick = handleCustomClick;
                customButton.textContent = 'Continue';

                buttonContainer.appendChild(customButton);
            }
        };

        const attempts = [100, 300, 500, 1000];
        attempts.forEach(delay => { setTimeout(replaceClerkButton, delay); });

        const observer = new MutationObserver(() => { replaceClerkButton(); });
        observer.observe(document.body, { childList: true, subtree: true });
        return () => { observer.disconnect(); };
    }, [mounted]);

    if (!mounted) return null;

    return (
        <div className="w-full">
            <div className="flex flex-col items-center mb-3">
                <div className="relative mb-2">
                    <Image src={'/logo-transparent.png'} alt='logo' width={60} height={60} />
                </div>
                <h1 className="text-lg font-semibold text-center text-white mb-1 font-['Outfit']">
                    Create Account
                </h1>
                <p className="text-xs text-white/50 text-center mb-2 font-['Outfit']">
                    Join us and start creating amazing courses
                </p>
            </div>

            <SignUp
                routing="path"
                path="/sign-up"
                appearance={customAppearance}
                signInUrl="/sign-in"
            />
        </div>
    );
}

// ── Client-side protected route guard ─────────────────────────
export function ProtectedRoute({ children }: { children: React.ReactNode }) {
    const { isLoaded, userId } = useAuth();
    const router = useRouter();

    if (!isLoaded) {
        return (
            <div className="h-screen flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" />
            </div>
        );
    }

    if (!userId) return <RedirectToSignIn />;

    return <>{children}</>;
}
```

> **The "Continue" button trick:** Clerk's `formButtonPrimary` is hidden via CSS (`display:none`). A `MutationObserver` + timed retries wait for Clerk's async form to mount, then inject a styled button whose `onclick` just calls `clerkButton.click()`. This lets you fully restyle the primary action without Clerk's theming limits. If you don't need it, delete the `useEffect` blocks and set `formButtonPrimary` to your own styles instead.

---

## 6. Root layout — `app/layout.tsx`

Wrap the whole app in `ClerkProviderWrapper`. Keep your own fonts/metadata; the key line is the wrapper around `{children}`.

```tsx
import { ClerkProviderWrapper } from '@/components/auth/ClerkWrapper'
import type { Metadata } from 'next'
import './globals.css'
import Provider from './provider'

export const metadata: Metadata = {
  title: 'Your App',
  description: 'Your description',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>
        <ClerkProviderWrapper>
          <Provider>
            {children}
          </Provider>
        </ClerkProviderWrapper>
      </body>
    </html>
  )
}
```

---

## 7. Auth pages — catch-all routes

Clerk's `<SignIn>` / `<SignUp>` with `routing="path"` need catch-all segments so Clerk can handle sub-steps (OTP, SSO callback, etc.).

**`app/(auth)/sign-in/[[...sign-in]]/page.tsx`**
```tsx
import AuthLayout from '@/components/auth/AuthLayout';
import { CustomSignIn } from '@/components/auth/ClerkWrapper';

export default function SignInPage() {
    return (
        <AuthLayout>
            <CustomSignIn />
        </AuthLayout>
    );
}
```

**`app/(auth)/sign-up/[[...sign-up]]/page.tsx`**
```tsx
import AuthLayout from '@/components/auth/AuthLayout';
import { CustomSignUp } from '@/components/auth/ClerkWrapper';

export default function SignUpPage() {
    return (
        <AuthLayout>
            <CustomSignUp />
        </AuthLayout>
    );
}
```

---

## 8. Auth page shell — `components/auth/AuthLayout.tsx`

Optional but recommended — the split-screen video-background layout with a toggle between sign-in/sign-up. Swap `AUTH_VIDEO` for your own asset (or replace the `<video>` with a static image / gradient).

```tsx
'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';

// Replace with your own background video (or drop the <video> entirely)
const AUTH_VIDEO = "https://your-cdn.example.com/auth-background.mp4";

interface AuthLayoutProps {
    children: ReactNode;
}

export default function AuthLayout({ children }: AuthLayoutProps) {
    const pathname = usePathname();
    const router = useRouter();
    const isSignIn = pathname.includes('/sign-in');

    return (
        <div className="relative h-screen w-full overflow-hidden bg-black">
            {/* Video background */}
            <video
                autoPlay loop muted playsInline
                className="absolute inset-0 w-full h-full object-cover z-0"
            >
                <source src={AUTH_VIDEO} type="video/mp4" />
            </video>
            <div className="absolute inset-0 z-[1] bg-black/40" />

            <div className="relative z-10 flex h-full w-full">
                {/* Left: form panel */}
                <div className="relative flex flex-col w-full lg:w-[52%] h-full">
                    <nav className="relative z-20 flex items-center justify-between px-8 lg:px-10 pt-8 lg:pt-10">
                        <div />
                        <button
                            onClick={() => router.push(isSignIn ? '/sign-up' : '/sign-in')}
                            className="rounded-full px-5 py-2.5 text-white/80 text-sm font-medium hover:text-white hover:scale-105 transition-all duration-300 cursor-pointer border border-white/20 backdrop-blur"
                        >
                            {isSignIn ? 'Create Account' : 'Sign In'}
                        </button>
                    </nav>

                    <div className="relative z-20 flex-1 flex flex-col items-center overflow-y-auto min-h-0 px-4 lg:px-8">
                        <div className="w-full max-w-md mx-auto my-auto py-4">
                            {children}
                        </div>
                    </div>
                </div>

                {/* Right: hero panel (desktop only) */}
                <div className="hidden lg:flex flex-col w-[48%] h-full p-6 relative">
                    <div className="relative z-20 flex items-center justify-end mb-6">
                        <Link
                            href="/"
                            className="rounded-full flex items-center gap-2 px-5 py-2.5 cursor-pointer hover:scale-105 transition-all duration-200 group border border-white/20 backdrop-blur"
                        >
                            <ArrowLeft className="w-4 h-4 text-white/70 group-hover:text-white transition-colors" />
                            <span className="text-white/60 text-sm group-hover:text-white/90 transition-colors">Back to Home</span>
                        </Link>
                    </div>
                    <div className="flex-1 flex flex-col items-center justify-center relative z-20">
                        <h1 className="text-6xl xl:text-7xl font-medium text-white tracking-[-0.05em] text-center leading-[1.1]">
                            Your headline here
                        </h1>
                        <p className="text-white/50 text-sm mt-6 text-center max-w-md">
                            Your subheadline / tagline here.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
```

---

## 9. User context + auto-upsert — `context/` + `app/provider.tsx`

On sign-in, POST to `/api/user` to create-or-fetch the DB user, and hold it in React context so any component can read `userDetail`.

**`context/UserDetailContext.tsx`**
```tsx
import { createContext } from "react";

export const UserDetailContext = createContext<any>(null);
```

**`app/provider.tsx`**
```tsx
"use client"
import { UserDetailContext } from '@/context/UserDetailContext';
import { useUser } from '@clerk/nextjs';
import axios from 'axios';
import React, { useEffect, useState } from 'react';

function Provider({ children }: { children: React.ReactNode }) {
    const { isSignedIn, isLoaded } = useUser();
    const [userDetail, setUserDetail] = useState(null);

    useEffect(() => {
        const CreateNewUser = async () => {
            if (isLoaded && isSignedIn && !userDetail) {
                try {
                    const result = await axios.post('/api/user', {});
                    setUserDetail(result.data);
                } catch (error) {
                    console.error('Error creating user:', error);
                }
            }
        }
        CreateNewUser();
    }, [isSignedIn, isLoaded]);

    return (
        <UserDetailContext.Provider value={{ userDetail, setUserDetail }}>
            <div className='min-h-screen'>{children}</div>
        </UserDetailContext.Provider>
    )
}

export default Provider
```

---

## 10. User upsert API — `app/api/user/route.ts`

Server route that reads the Clerk session with `currentUser()` and upserts into your DB. **Adapt the DB calls to your own ORM/schema** — the auth part is what matters.

```ts
import { currentUser } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
// import your db + users table here

export async function POST(req: NextRequest) {
    try {
        const user = await currentUser();

        // Auth guard — validate Clerk session
        if (!user?.primaryEmailAddress?.emailAddress || !user?.fullName) {
            return NextResponse.json(
                { error: "Authentication required. Please sign in." },
                { status: 401 }
            );
        }

        const email = user.primaryEmailAddress.emailAddress;
        const name = user.fullName;

        // ── Replace with your DB upsert ──────────────────────────
        // const existing = await db.select().from(usersTable).where(eq(usersTable.email, email));
        // if (existing.length) return NextResponse.json(existing[0]);
        // const [created] = await db.insert(usersTable).values({ email, name }).returning();
        // return NextResponse.json(created, { status: 201 });

        return NextResponse.json({ email, name });
    } catch (error: any) {
        console.error("User API Error:", error.message);
        return NextResponse.json({ error: "Failed to process user request" }, { status: 500 });
    }
}
```

---

## 11. Protecting any API route (server-side pattern)

Beyond middleware, guard individual routes by reading the session. Two common helpers from `@clerk/nextjs/server`:

```ts
import { currentUser, auth } from "@clerk/nextjs/server";

// Full user object (email, name, etc.) — used in this project:
export async function GET() {
    const user = await currentUser();
    if (!user?.primaryEmailAddress?.emailAddress) {
        return Response.json({ error: "Authentication required" }, { status: 401 });
    }
    const email = user.primaryEmailAddress.emailAddress; // use as your user key
    // ...
}

// Or just the userId (lighter):
export async function POST() {
    const { userId } = await auth();
    if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
    // ...
}
```

This project keys DB rows by **email** (`user.primaryEmailAddress.emailAddress`), not Clerk's `userId`. Pick one convention and stick to it.

---

## 12. Reading auth in client components

```tsx
'use client'
import { UserButton, useUser } from '@clerk/nextjs';

function Header() {
    const { isSignedIn, isLoaded } = useUser();

    if (!isLoaded) return <Spinner />;            // still resolving
    if (!isSignedIn) return <SignInLink />;        // logged out

    return <UserButton afterSignOutUrl="/" />;     // logged in → avatar + menu
}
```

Available client hooks: `useUser()` (`isLoaded`, `isSignedIn`, `user`), `useAuth()` (`isLoaded`, `userId`, `sessionId`, `getToken()`), and components `<UserButton>`, `<SignedIn>`, `<SignedOut>`, `<SignInButton>`, `<SignOutButton>`.

---

## File checklist

```
.env                                              # step 2 — YOUR keys
lib/env.ts                                        # step 3 (optional)
middleware.ts                                     # step 4
components/auth/ClerkWrapper.tsx                  # step 5
components/auth/AuthLayout.tsx                    # step 8
app/layout.tsx                                    # step 6
app/provider.tsx                                  # step 9
app/(auth)/sign-in/[[...sign-in]]/page.tsx        # step 7
app/(auth)/sign-up/[[...sign-up]]/page.tsx        # step 7
context/UserDetailContext.tsx                     # step 9
app/api/user/route.ts                             # step 10
```

## Setup order for the new project

1. `npm install @clerk/nextjs axios zod`
2. Create a Clerk app → paste **its own** keys into `.env` (step 2).
3. In the Clerk dashboard, set the sign-in/up paths to `/sign-in` and `/sign-up`, and enable the social providers / email you want.
4. Drop in the files from the checklist.
5. Adjust `isPublicRoute` in `middleware.ts` to your app's public pages.
6. Wire `app/api/user/route.ts` to your DB schema (or delete it + the provider upsert if you don't need a user table).
7. Replace `AUTH_VIDEO`, logos (`/logo-transparent.png`), and hero copy with your branding.
8. `npm run dev` → visit `/sign-in`.

---

## Notes / gotchas

- **v6 API only.** `clerkMiddleware` + `auth.protect()` are `@clerk/nextjs@^6`. Older `authMiddleware` won't work with this code.
- **Keys are per-workspace.** Each project gets its own Clerk application and its own `pk_`/`sk_` keys. Never share a secret key across projects.
- **Catch-all routes are required** for `routing="path"`. Missing the `[[...sign-in]]` folder breaks OTP/SSO redirects.
- **The custom "Continue" button** depends on Clerk's internal class `.cl-formButtonPrimary`. If a future Clerk version renames it, the injected button won't appear — the safe fallback is to remove the `formButtonPrimary: { display: 'none' }` line so Clerk's native button shows again.
- **Rate limiter is in-memory** — see the note in step 4. Swap for Redis if you need it global/persistent.
- **CSRF check** compares `origin` vs `host` on mutations. If you call your API from a different trusted origin (mobile app, separate frontend), add it to an allowlist instead of blocking.
