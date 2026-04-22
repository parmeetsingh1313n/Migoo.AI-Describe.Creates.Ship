// ═══════════════════════════════════════════════════════════════════════════════
// Reusable Caption Styles — used in both the Studio form selector and
// Remotion compositions.  IDs MUST match the Studio's CAPTION_STYLES array
// in StudioStageStyle.tsx so the selected style is applied at render time.
// ═══════════════════════════════════════════════════════════════════════════════

export interface CaptionStyleConfig {
    id: string
    label: string
    description: string
    /** CSS/style properties for Remotion */
    fontFamily: string
    fontSize: number
    fontWeight: number
    color: string
    backgroundColor: string
    textStroke: string
    textShadow: string
    textTransform: 'none' | 'uppercase' | 'lowercase' | 'capitalize'
    /**
     * Animation type applied per-segment in the Remotion <Captions> component.
     *   word-pop    – word-by-word scale pop + color change (Hormozi / MrBeast)
     *   karaoke     – word-by-word colour highlight
     *   typewriter  – character-by-character reveal
     *   glow        – pulsing neon opacity
     *   bounce      – whole segment bounces in from below
     *   fade        – gentle opacity fade-in
     *   word-box    – word-by-word background highlight
     *   word-bounce – individual words bounce on activation
     *   pop         – whole segment pops in (legacy fallback)
     */
    animation:
        | 'word-pop'
        | 'karaoke'
        | 'typewriter'
        | 'glow'
        | 'bounce'
        | 'fade'
        | 'word-box'
        | 'word-bounce'
        | 'pop'
    highlightColor: string
    borderRadius: number
    padding: string
    /** Extra CSS applied to the active/highlighted word (word-* animations) */
    activeWordStyle?: React.CSSProperties
    letterSpacing?: string
}

export const captionStyles: CaptionStyleConfig[] = [
    // ── 1. Hormozi ──────────────────────────────────────────────────────────
    {
        id: 'hormozi',
        label: 'Hormozi',
        description: 'Bold yellow, word-by-word pop • ALL CAPS',
        fontFamily: "'Montserrat', 'Arial Black', sans-serif",
        fontSize: 44,
        fontWeight: 900,
        color: '#FFFFFF',
        backgroundColor: 'transparent',
        textStroke: '2px #000000',
        textShadow: '1px 1px 0 #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 3px 3px 6px rgba(0,0,0,0.8)',
        textTransform: 'uppercase',
        animation: 'word-pop',
        highlightColor: '#FACC15',
        borderRadius: 0,
        padding: '0',
        letterSpacing: '0.05em',
    },

    // ── 2. MrBeast ──────────────────────────────────────────────────────────
    {
        id: 'mrbeast',
        label: 'MrBeast',
        description: 'Giant text, thick black stroke',
        fontFamily: "'Montserrat', 'Impact', 'Arial Black', sans-serif",
        fontSize: 52,
        fontWeight: 900,
        color: '#FFFFFF',
        backgroundColor: 'transparent',
        textStroke: '3px #000000',
        textShadow: '2px 2px 0 #000, -2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 0 2px 0 #000, 0 -2px 0 #000',
        textTransform: 'uppercase',
        animation: 'word-pop',
        highlightColor: '#FFD700',
        borderRadius: 0,
        padding: '0',
        letterSpacing: '0.04em',
        activeWordStyle: {
            textShadow: '2px 2px 0 #000, -2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 0 0 16px rgba(255,215,0,0.45)',
        },
    },

    // ── 3. Minimal ──────────────────────────────────────────────────────────
    {
        id: 'minimal',
        label: 'Minimal',
        description: 'Clean white, gentle fade',
        fontFamily: "'Inter', 'Helvetica Neue', sans-serif",
        fontSize: 36,
        fontWeight: 500,
        color: '#FFFFFF',
        backgroundColor: 'transparent',
        textStroke: 'none',
        textShadow: '1px 1px 4px rgba(0,0,0,0.6)',
        textTransform: 'none',
        animation: 'fade',
        highlightColor: '#FFFFFF',
        borderRadius: 0,
        padding: '0',
        letterSpacing: '0.02em',
    },

    // ── 4. Karaoke ──────────────────────────────────────────────────────────
    {
        id: 'karaoke',
        label: 'Karaoke',
        description: 'Highlighted word as spoken',
        fontFamily: "'Inter', sans-serif",
        fontSize: 40,
        fontWeight: 700,
        color: 'rgba(255,255,255,0.45)',
        backgroundColor: 'transparent',
        textStroke: '1.5px #000000',
        textShadow: '2px 2px 4px rgba(0,0,0,0.7)',
        textTransform: 'none',
        animation: 'karaoke',
        highlightColor: '#22D3EE',
        borderRadius: 0,
        padding: '0',
    },

    // ── 5. Boxed ────────────────────────────────────────────────────────────
    {
        id: 'boxed',
        label: 'Boxed',
        description: 'Dark background, high contrast',
        fontFamily: "'Inter', sans-serif",
        fontSize: 38,
        fontWeight: 700,
        color: '#FFFFFF',
        backgroundColor: 'rgba(0,0,0,0.6)',
        textStroke: 'none',
        textShadow: 'none',
        textTransform: 'none',
        animation: 'word-box',
        highlightColor: '#6366F1',
        borderRadius: 6,
        padding: '6px 12px',
        activeWordStyle: {
            backgroundColor: 'rgba(99,102,241,0.85)',
            borderRadius: '4px',
            padding: '2px 6px',
        },
    },

    // ── 6. Neon Glow ────────────────────────────────────────────────────────
    {
        id: 'neon',
        label: 'Neon Glow',
        description: 'Vibrant glowing neon effect',
        fontFamily: "'Inter', sans-serif",
        fontSize: 40,
        fontWeight: 800,
        color: '#D946EF',
        backgroundColor: 'transparent',
        textStroke: '1px #D946EF',
        textShadow: '0 0 7px rgba(217,70,239,0.35), 0 0 14px rgba(217,70,239,0.15)',
        textTransform: 'none',
        animation: 'glow',
        highlightColor: '#F0ABFC',
        borderRadius: 0,
        padding: '0',
        letterSpacing: '0.03em',
    },

    // ── 7. Typewriter ───────────────────────────────────────────────────────
    {
        id: 'typewriter',
        label: 'Typewriter',
        description: 'Monospace, letter-by-letter feel',
        fontFamily: "'Space Mono', 'JetBrains Mono', 'Courier New', monospace",
        fontSize: 34,
        fontWeight: 500,
        color: '#4ADE80',
        backgroundColor: 'rgba(0,0,0,0.75)',
        textStroke: 'none',
        textShadow: '0 0 8px rgba(74,222,128,0.3)',
        textTransform: 'none',
        animation: 'typewriter',
        highlightColor: '#4ADE80',
        borderRadius: 8,
        padding: '8px 16px',
        letterSpacing: '0.02em',
    },

    // ── 8. Ali Abdaal ───────────────────────────────────────────────────────
    {
        id: 'ali-abdaal',
        label: 'Ali Abdaal',
        description: 'Clean modern, pastel highlight',
        fontFamily: "'Inter', sans-serif",
        fontSize: 38,
        fontWeight: 600,
        color: 'rgba(255,255,255,0.55)',
        backgroundColor: 'transparent',
        textStroke: 'none',
        textShadow: '1px 1px 4px rgba(0,0,0,0.5)',
        textTransform: 'none',
        animation: 'karaoke',
        highlightColor: '#86EFAC',
        borderRadius: 0,
        padding: '0',
        letterSpacing: '0.01em',
        activeWordStyle: {
            backgroundColor: 'rgba(134,239,172,0.18)',
            borderBottom: '3px solid #86EFAC',
            padding: '2px 5px',
        },
    },

    // ── 9. Gradient Pop ─────────────────────────────────────────────────────
    {
        id: 'gradient',
        label: 'Gradient Pop',
        description: 'Colorful gradient text effect',
        fontFamily: "'Inter', 'Arial Black', sans-serif",
        fontSize: 42,
        fontWeight: 800,
        color: '#C084FC',
        backgroundColor: 'transparent',
        textStroke: 'none',
        textShadow: '2px 2px 6px rgba(0,0,0,0.7)',
        textTransform: 'none',
        animation: 'word-pop',
        highlightColor: '#E879F9',
        borderRadius: 0,
        padding: '0',
        letterSpacing: '0.03em',
        activeWordStyle: {
            textShadow: '0 0 14px rgba(168,85,247,0.5)',
        },
    },

    // ── 10. Bounce ──────────────────────────────────────────────────────────
    {
        id: 'bounce',
        label: 'Bounce',
        description: 'Energetic bouncing words',
        fontFamily: "'Inter', sans-serif",
        fontSize: 42,
        fontWeight: 800,
        color: 'rgba(255,255,255,0.45)',
        backgroundColor: 'transparent',
        textStroke: 'none',
        textShadow: '2px 2px 4px rgba(0,0,0,0.7)',
        textTransform: 'uppercase',
        animation: 'word-bounce',
        highlightColor: '#FB923C',
        borderRadius: 0,
        padding: '0',
    },

    // ── 11. Classic ─────────────────────────────────────────────────────────
    {
        id: 'classic',
        label: 'Classic',
        description: 'Traditional white subtitles',
        fontFamily: "'Playfair Display', 'Georgia', 'Times New Roman', serif",
        fontSize: 38,
        fontWeight: 400,
        color: '#FFFFFF',
        backgroundColor: 'transparent',
        textStroke: 'none',
        textShadow: '1px 1px 3px rgba(0,0,0,0.8)',
        textTransform: 'none',
        animation: 'fade',
        highlightColor: '#FFFFFF',
        borderRadius: 0,
        padding: '0',
        letterSpacing: '0.01em',
    },

    // ── 12. Outline ─────────────────────────────────────────────────────────
    {
        id: 'outline',
        label: 'Outline',
        description: 'Stroke-only with color fill',
        fontFamily: "'Inter', 'Arial Black', sans-serif",
        fontSize: 42,
        fontWeight: 900,
        color: 'transparent',
        backgroundColor: 'transparent',
        textStroke: '1.5px rgba(255,255,255,0.5)',
        textShadow: 'none',
        textTransform: 'uppercase',
        animation: 'karaoke',
        highlightColor: '#38BDF8',
        borderRadius: 0,
        padding: '0',
        letterSpacing: '0.04em',
        activeWordStyle: {
            color: '#38BDF8',
            WebkitTextStroke: '1.5px #38BDF8',
            textShadow: '0 0 12px rgba(56,189,248,0.4)',
        },
    },

    // ── Legacy fallbacks (kept for backward compatibility with older videos) ─
    {
        id: 'bold-pop',
        label: 'Bold Pop',
        description: 'Classic bold white text with pop-in animation',
        fontFamily: "'Montserrat', sans-serif",
        fontSize: 42,
        fontWeight: 900,
        color: '#FFFFFF',
        backgroundColor: 'transparent',
        textStroke: '2px #000000',
        textShadow: '3px 3px 6px rgba(0,0,0,0.8)',
        textTransform: 'uppercase',
        animation: 'pop',
        highlightColor: '#FFD700',
        borderRadius: 0,
        padding: '0',
    },
    {
        id: 'neon-glow',
        label: 'Neon Glow (Legacy)',
        description: 'Glowing neon text with pulsing light effect',
        fontFamily: "'Orbitron', sans-serif",
        fontSize: 36,
        fontWeight: 700,
        color: '#FF00FF',
        backgroundColor: 'transparent',
        textStroke: '1px #FF00FF',
        textShadow: '0 0 10px #FF00FF, 0 0 20px #FF00FF, 0 0 40px #FF00FF, 0 0 80px #FF00FF',
        textTransform: 'uppercase',
        animation: 'glow',
        highlightColor: '#FF00FF',
        borderRadius: 0,
        padding: '0',
    },
    {
        id: 'bounce-box',
        label: 'Bounce Box (Legacy)',
        description: 'Text with colored background box that bounces in',
        fontFamily: "'Poppins', sans-serif",
        fontSize: 36,
        fontWeight: 800,
        color: '#FFFFFF',
        backgroundColor: '#FF3366',
        textStroke: 'none',
        textShadow: 'none',
        textTransform: 'uppercase',
        animation: 'bounce',
        highlightColor: '#FFDD00',
        borderRadius: 12,
        padding: '10px 20px',
    },
    {
        id: 'cinematic-fade',
        label: 'Cinematic Fade (Legacy)',
        description: 'Elegant fade-in text with serif font',
        fontFamily: "'Playfair Display', serif",
        fontSize: 40,
        fontWeight: 700,
        color: '#FFFFFF',
        backgroundColor: 'transparent',
        textStroke: 'none',
        textShadow: '2px 2px 8px rgba(0,0,0,0.9)',
        textTransform: 'none',
        animation: 'fade',
        highlightColor: '#FFD700',
        borderRadius: 0,
        padding: '0',
    },
]
