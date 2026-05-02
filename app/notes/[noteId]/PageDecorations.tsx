"use client"

/**
 * Page Decorations — SVG decorative elements for note templates
 * Matches the organic/botanical aesthetic with blobs, stars, leaves, and rings
 * All colors are theme-aware
 */

interface DecorationColors {
    pageBg: string      // cream background
    blobMain: string    // primary blob color (sage green)
    blobLight: string   // lighter blob/ring color
    blobAccent: string  // accent blob (brown/tan)
    leafStroke: string  // leaf outline color
    starColor: string   // star fill color
}

// Theme-to-decoration color mapping
export const DECORATION_THEMES: Record<string, DecorationColors> = {
    dark: {
        pageBg: '#1a1a2e',
        blobMain: 'rgba(139,92,246,0.25)',   // violet
        blobLight: 'rgba(139,92,246,0.10)',
        blobAccent: 'rgba(99,102,241,0.20)',
        leafStroke: 'rgba(139,92,246,0.30)',
        starColor: 'rgba(139,92,246,0.25)',
    },
    light: {
        pageBg: '#faf8f5',
        blobMain: '#a8b5a0',     // sage green (matches reference)
        blobLight: '#d4ddd0',
        blobAccent: '#c4b5a0',
        leafStroke: '#6b7c60',
        starColor: '#8a9a7e',
    },
    neon: {
        pageBg: '#0a0a1a',
        blobMain: 'rgba(6,182,212,0.25)',   // cyan
        blobLight: 'rgba(6,182,212,0.10)',
        blobAccent: 'rgba(168,85,247,0.20)',
        leafStroke: 'rgba(6,182,212,0.30)',
        starColor: 'rgba(6,182,212,0.25)',
    },
    pastel: {
        pageBg: '#fef7f0',
        blobMain: '#e8a0b4',    // pink
        blobLight: '#f0d0dc',
        blobAccent: '#d4b896',
        leafStroke: '#c07090',
        starColor: '#dba0b8',
    },
    ocean: {
        pageBg: '#0c1222',
        blobMain: 'rgba(34,211,238,0.20)',  // cyan
        blobLight: 'rgba(34,211,238,0.08)',
        blobAccent: 'rgba(56,189,248,0.15)',
        leafStroke: 'rgba(34,211,238,0.25)',
        starColor: 'rgba(34,211,238,0.20)',
    },
}

export function PageDecorations({ theme = 'light' }: { theme: string }) {
    const c = DECORATION_THEMES[theme] || DECORATION_THEMES.light

    return (
        <>
            {/* ═══ TOP-LEFT: Large organic blob ═══ */}
            <svg
                className="absolute top-0 left-0 pointer-events-none"
                width="280" height="260" viewBox="0 0 280 260"
                style={{ zIndex: 0 }}
            >
                {/* Back blob (sage green) */}
                <path
                    d="M-20,-10 C40,-15 90,20 130,50 C170,80 200,30 230,60 C260,90 270,140 240,170 C210,200 160,180 120,200 C80,220 30,210 10,170 C-10,130 -30,80 -20,40 Z"
                    fill={c.blobMain}
                />
                {/* Front blob (page color, creates cutout effect) */}
                <path
                    d="M30,30 C70,10 120,40 140,80 C160,120 130,160 100,170 C70,180 20,160 10,120 C0,80 -10,50 30,30 Z"
                    fill={c.pageBg}
                />
            </svg>

            {/* ═══ TOP-RIGHT: Partial blob at edge ═══ */}
            <svg
                className="absolute top-0 right-0 pointer-events-none"
                width="160" height="140" viewBox="0 0 160 140"
                style={{ zIndex: 0 }}
            >
                <path
                    d="M100,-20 C140,-10 170,30 165,70 C160,110 130,140 90,135 C50,130 80,80 100,50 C120,20 60,10 100,-20 Z"
                    fill={c.blobMain} opacity="0.7"
                />
            </svg>

            {/* ═══ RIGHT-MIDDLE: Four-pointed stars ═══ */}
            <svg
                className="absolute pointer-events-none"
                style={{ top: '55%', right: '30px', zIndex: 0 }}
                width="60" height="80" viewBox="0 0 60 80"
            >
                {/* Large star */}
                <path
                    d="M30,5 L35,20 L50,25 L35,30 L30,45 L25,30 L10,25 L25,20 Z"
                    fill={c.starColor}
                />
                {/* Small star */}
                <path
                    d="M45,50 L48,58 L56,61 L48,64 L45,72 L42,64 L34,61 L42,58 Z"
                    fill={c.starColor} opacity="0.6"
                />
                {/* Tiny dot star */}
                <circle cx="20" cy="60" r="3" fill={c.starColor} opacity="0.4" />
            </svg>

            {/* ═══ BOTTOM-LEFT: Large oval + accent circle ═══ */}
            <svg
                className="absolute bottom-0 left-0 pointer-events-none"
                width="200" height="250" viewBox="0 0 200 250"
                style={{ zIndex: 0 }}
            >
                {/* Brown/tan accent circle (behind) */}
                <ellipse
                    cx="60" cy="210" rx="55" ry="50"
                    fill={c.blobAccent} opacity="0.6"
                />
                {/* Large sage green oval (foreground) */}
                <ellipse
                    cx="75" cy="195" rx="70" ry="80"
                    fill={c.blobMain}
                />
                {/* Leaf branch illustration */}
                <g transform="translate(40, 140) rotate(-20)" opacity="0.7">
                    {/* Main stem */}
                    <path
                        d="M30,80 C30,60 28,40 25,20"
                        stroke={c.leafStroke} strokeWidth="1.5" fill="none"
                    />
                    {/* Left leaves */}
                    <path d="M25,25 C15,15 5,20 10,30 C15,35 22,30 25,25Z" stroke={c.leafStroke} strokeWidth="1" fill="none" />
                    <path d="M27,40 C17,30 5,35 12,45 C17,50 24,45 27,40Z" stroke={c.leafStroke} strokeWidth="1" fill="none" />
                    <path d="M28,55 C18,45 8,50 14,60 C19,65 25,60 28,55Z" stroke={c.leafStroke} strokeWidth="1" fill="none" />
                    {/* Right leaves */}
                    <path d="M26,32 C36,22 46,27 40,37 C35,42 29,37 26,32Z" stroke={c.leafStroke} strokeWidth="1" fill="none" />
                    <path d="M28,48 C38,38 48,43 42,53 C37,58 31,53 28,48Z" stroke={c.leafStroke} strokeWidth="1" fill="none" />
                    <path d="M29,63 C39,53 49,58 43,68 C38,73 32,68 29,63Z" stroke={c.leafStroke} strokeWidth="1" fill="none" />
                </g>
            </svg>

            {/* ═══ BOTTOM-RIGHT: Concentric semicircle rings ═══ */}
            <svg
                className="absolute bottom-0 right-0 pointer-events-none"
                width="160" height="160" viewBox="0 0 160 160"
                style={{ zIndex: 0 }}
            >
                <g transform="translate(110, 130)">
                    {[80, 65, 50, 35, 20].map((r, i) => (
                        <circle
                            key={i}
                            cx="0" cy="0" r={r}
                            fill="none"
                            stroke={c.blobLight}
                            strokeWidth="2"
                            opacity={0.4 + i * 0.1}
                        />
                    ))}
                </g>
            </svg>

            {/* ═══ Small accent dot (middle-left) ═══ */}
            <svg
                className="absolute pointer-events-none"
                style={{ top: '40%', left: '15px', zIndex: 0 }}
                width="20" height="20" viewBox="0 0 20 20"
            >
                <circle cx="10" cy="10" r="4" fill={c.blobLight} opacity="0.5" />
            </svg>
        </>
    )
}
