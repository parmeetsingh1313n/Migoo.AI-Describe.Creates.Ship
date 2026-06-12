"use client"

/**
 * NoteDesigns — Pure image-based page backgrounds.
 * Each design uses an actual image from /public/notes-design/ as the page background,
 * plus a matching Tailwind color palette derived from the image's dominant colors.
 *
 * Design keys: abstractPastel | geoPebbles | botanical | elegantLeaf
 */

export type NoteDesignKey = 'abstractPastel' | 'geoPebbles' | 'botanical' | 'elegantLeaf'

// ─── Design Config ───────────────────────────────────────────
export interface DesignConfig {
    key: NoteDesignKey
    label: string
    desc: string
    img: string           // Path to background image in /public/notes-design/
    pageBg: string        // CSS background-color (matches image bg)
    // Tailwind classes — same shape as old THEME_COLORS so templates work unchanged
    colors: {
        bg: string
        pageBg: string
        card: string
        text: string
        muted: string
        accent: string
        accentBg: string
        border: string
        codeBg: string
        headerBg: string
        circleBg: string
        bulletColor: string
    }
    // Raw hex values for inline CSS styles (used by cards, circular-map, quote-cards, etc.)
    hex: {
        accent: string       // Primary accent color
        accentLight: string  // Very light accent tint (card backgrounds)
        accentLighter: string // Even lighter (gradient end)
        accentBorder: string // Subtle border
        circle: string       // Circle/badge fill
        text: string         // Main text
        muted: string        // Secondary text
        line: string         // Divider / connector lines
        quoteMark: string    // Large quote mark color
        shadow: string       // Drop shadow color (translucent)
    }
}

export const NOTE_DESIGNS: Record<NoteDesignKey, DesignConfig> = {
    // ── d1.jpg — Abstract Pastel: pink blobs, sage green, white bg ──
    abstractPastel: {
        key: 'abstractPastel',
        label: 'Abstract Pastel',
        desc: 'Pink blobs, sage green splatters & floral shapes',
        img: '/notes-design/d1.jpg',
        pageBg: '#ffffff',
        colors: {
            bg: 'bg-white', pageBg: '#ffffff',
            card: 'bg-[#fdf2f6]', text: 'text-[#3d3040]', muted: 'text-[#8a7a8a]',
            accent: 'text-[#c06080]', accentBg: 'bg-[#c06080]/8',
            border: 'border-[#c06080]/15', codeBg: 'bg-[#f8f0f2]',
            headerBg: 'bg-gradient-to-r from-[#c06080] to-[#a0508a]',
            circleBg: 'bg-[#c06080]', bulletColor: 'bg-[#c06080]',
        },
        hex: {
            accent: '#c06080', accentLight: '#fdf2f6', accentLighter: '#fef8fa',
            accentBorder: '#e8a0b8', circle: '#c06080',
            text: '#3d3040', muted: '#8a7a8a', line: '#d4899f', quoteMark: '#c06080',
            shadow: 'rgba(192,96,128,0.2)',
        },
    },

    // ── d2.png — Geo Pebbles: colorful hand-drawn stone border, white bg ──
    geoPebbles: {
        key: 'geoPebbles',
        label: 'Geo Pebbles',
        desc: 'Colorful hand-drawn pebble border',
        img: '/notes-design/d2.png',
        pageBg: '#ffffff',
        colors: {
            bg: 'bg-white', pageBg: '#ffffff',
            card: 'bg-[#f0f7f7]', text: 'text-[#2d3748]', muted: 'text-[#718096]',
            accent: 'text-[#2b7a78]', accentBg: 'bg-[#2b7a78]/8',
            border: 'border-[#2b7a78]/15', codeBg: 'bg-[#f0f5f5]',
            headerBg: 'bg-gradient-to-r from-[#2b7a78] to-[#3d5a80]',
            circleBg: 'bg-[#2b7a78]', bulletColor: 'bg-[#3d8b8a]',
        },
        hex: {
            accent: '#2b7a78', accentLight: '#e6f4f4', accentLighter: '#f0f9f9',
            accentBorder: '#7ac0be', circle: '#2b7a78',
            text: '#2d3748', muted: '#718096', line: '#7ab8b6', quoteMark: '#2b7a78',
            shadow: 'rgba(43,122,120,0.2)',
        },
    },

    // ── d3.png — Botanical: sage green organic blobs, cream bg ──
    botanical: {
        key: 'botanical',
        label: 'Botanical',
        desc: 'Sage green organic blobs, leaves & rings',
        img: '/notes-design/d3.png',
        pageBg: '#f5f0e8',
        colors: {
            bg: 'bg-[#f5f0e8]', pageBg: '#f5f0e8',
            card: 'bg-[#eee9df]', text: 'text-[#3a3f32]', muted: 'text-[#6b7c60]',
            accent: 'text-[#5a6b4f]', accentBg: 'bg-[#5a6b4f]/8',
            border: 'border-[#5a6b4f]/15', codeBg: 'bg-[#e8e3d8]',
            headerBg: 'bg-gradient-to-r from-[#7a8f6e] to-[#5a6b4f]',
            circleBg: 'bg-[#6b7c60]', bulletColor: 'bg-[#7a8f6e]',
        },
        hex: {
            accent: '#5a6b4f', accentLight: '#eee9df', accentLighter: '#f3f0e8',
            accentBorder: '#a3b096', circle: '#6b7c60',
            text: '#3a3f32', muted: '#6b7c60', line: '#a3b096', quoteMark: '#6b7c60',
            shadow: 'rgba(90,107,79,0.2)',
        },
    },

    // ── d4.png — Elegant Leaf: gold border, navy blue leaves, white bg ──
    elegantLeaf: {
        key: 'elegantLeaf',
        label: 'Elegant Leaf',
        desc: 'Gold framed with navy blue leaf accents',
        img: '/notes-design/d4.png',
        pageBg: '#fdfcf9',
        colors: {
            bg: 'bg-[#fdfcf9]', pageBg: '#fdfcf9',
            card: 'bg-[#f5f3ee]', text: 'text-[#2c3e50]', muted: 'text-[#6b7b8d]',
            accent: 'text-[#4a6274]', accentBg: 'bg-[#4a6274]/8',
            border: 'border-[#4a6274]/15', codeBg: 'bg-[#f0eee8]',
            headerBg: 'bg-gradient-to-r from-[#4a6274] to-[#34495e]',
            circleBg: 'bg-[#4a6274]', bulletColor: 'bg-[#5a7a8f]',
        },
        hex: {
            accent: '#4a6274', accentLight: '#edf1f5', accentLighter: '#f5f7fa',
            accentBorder: '#93a8b8', circle: '#4a6274',
            text: '#2c3e50', muted: '#6b7b8d', line: '#93a8b8', quoteMark: '#4a6274',
            shadow: 'rgba(74,98,116,0.2)',
        },
    },
}

export const DESIGN_KEYS = Object.keys(NOTE_DESIGNS) as NoteDesignKey[]

// Helper: get design config (with fallback)
export function getDesignConfig(key: string | null | undefined): DesignConfig {
    return NOTE_DESIGNS[(key || 'botanical') as NoteDesignKey] || NOTE_DESIGNS.botanical
}

// Helper: get pageBg for a design
export function getDesignPageBg(key: string | null | undefined): string {
    return getDesignConfig(key).pageBg
}

// ─── Background Image Component ──────────────────────────────
// Renders the design image as an absolute-positioned background
export function NoteDesignBg({ design }: { design: NoteDesignKey }) {
    const config = getDesignConfig(design)
    return (
        <img
            src={config.img}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 w-full h-full pointer-events-none select-none"
            style={{ objectFit: 'cover', zIndex: 0 }}
            draggable={false}
        />
    )
}
