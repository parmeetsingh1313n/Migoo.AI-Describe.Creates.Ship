/**
 * @module lib/theme-palette
 *
 * Shared color-palette logic for motion graphics.
 *
 * A project's `theme` JSON is:
 *   { mode: 'preset' | 'custom', palette?: string, customColors?: string[],
 *     resolved: { bg, text, accent, secondary, gradient } }
 *
 * `resolved` is always computed and stored at save time (here, client-side,
 * whenever the user confirms a theme) so Remotion never re-runs derivation —
 * it just reads `theme.resolved` directly (see MotionGraphicComposition.tsx).
 *
 * PRESET_PALETTES mirrors the 6 hardcoded palettes in
 * remotion/MotionGraphicComposition.tsx's PALETTES constant (same hex values)
 * — kept as a separate copy here so client (non-Remotion) code doesn't need
 * to import the Remotion bundle just to read palette colors.
 */

export interface ResolvedPalette {
    bg: string;
    text: string;
    accent: string;
    secondary: string;
    gradient: string;
}

export interface MotionGraphicTheme {
    mode: 'preset' | 'custom';
    palette?: string;
    customColors?: string[];
    resolved: ResolvedPalette;
}

export const PRESET_PALETTES: Record<string, ResolvedPalette> = {
    midnight: {
        bg: '#0a0a0f', text: '#ffffff', accent: '#6366f1', secondary: '#818cf8',
        gradient: 'linear-gradient(135deg, #0a0a0f 0%, #1e1b4b 50%, #0a0a0f 100%)',
    },
    sunset: {
        bg: '#1a0a0a', text: '#ffffff', accent: '#f97316', secondary: '#fb923c',
        gradient: 'linear-gradient(135deg, #1a0a0a 0%, #7c2d12 50%, #1a0a0a 100%)',
    },
    ocean: {
        bg: '#0a1628', text: '#ffffff', accent: '#06b6d4', secondary: '#22d3ee',
        gradient: 'linear-gradient(135deg, #0a1628 0%, #164e63 50%, #0a1628 100%)',
    },
    emerald: {
        bg: '#0a1a0a', text: '#ffffff', accent: '#10b981', secondary: '#34d399',
        gradient: 'linear-gradient(135deg, #0a1a0a 0%, #064e3b 50%, #0a1a0a 100%)',
    },
    rose: {
        bg: '#1a0a14', text: '#ffffff', accent: '#f43f5e', secondary: '#fb7185',
        gradient: 'linear-gradient(135deg, #1a0a14 0%, #881337 50%, #1a0a14 100%)',
    },
    neon: {
        bg: '#000000', text: '#ffffff', accent: '#a855f7', secondary: '#c084fc',
        gradient: 'linear-gradient(135deg, #000000 0%, #3b0764 50%, #000000 100%)',
    },
};

export const PRESET_LIST = [
    { id: 'midnight', name: 'Midnight' },
    { id: 'sunset', name: 'Sunset' },
    { id: 'ocean', name: 'Ocean' },
    { id: 'emerald', name: 'Emerald' },
    { id: 'rose', name: 'Rose' },
    { id: 'neon', name: 'Neon' },
];

// ─── Color math (no deps — small, self-contained) ────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
    const clean = hex.replace('#', '').trim();
    const full = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean;
    const num = parseInt(full, 16);
    return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

/** Relative luminance (0=black, 1=white), per WCAG. */
function luminance(hex: string): number {
    const [r, g, b] = hexToRgb(hex).map(v => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** HSL saturation (0-1) — used to pick the most "vivid" swatches as accent colors. */
function saturation(hex: string): number {
    const [r, g, b] = hexToRgb(hex).map(v => v / 255);
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return 0;
    const d = max - min;
    return l > 0.5 ? d / (2 - max - min) : d / (max + min);
}

function contrastRatio(a: string, b: string): number {
    const l1 = luminance(a) + 0.05;
    const l2 = luminance(b) + 0.05;
    return l1 > l2 ? l1 / l2 : l2 / l1;
}

/**
 * Derive a full role-based palette (bg/text/accent/secondary/gradient) from a
 * freeform, user-ordered list of hex colors — any count >= 1.
 *
 * - bg: the darkest swatch (dark backgrounds read best for motion graphics text)
 * - text: white or black, whichever contrasts best against bg (never taken
 *   from the user's swatches — legibility over strict fidelity to the palette)
 * - accent: the most saturated (vivid) swatch, excluding bg
 * - secondary: the next-most-saturated distinct swatch, excluding bg/accent
 *   (falls back to a lightened accent if there's only one usable color)
 * - gradient: a multi-stop linear-gradient built from ALL swatches in the
 *   user's original order (not the sorted order), so the preview matches
 *   what they arranged
 */
export function deriveRolesFromSwatches(colors: string[]): ResolvedPalette {
    const clean = colors.map(c => (c.startsWith('#') ? c : `#${c}`)).filter(c => /^#[0-9a-fA-F]{3,6}$/.test(c));
    if (clean.length === 0) return PRESET_PALETTES.midnight;

    const byLuminance = [...clean].sort((a, b) => luminance(a) - luminance(b));
    const bg = byLuminance[0];
    const text = contrastRatio('#ffffff', bg) >= contrastRatio('#000000', bg) ? '#ffffff' : '#000000';

    const remaining = clean.filter(c => c !== bg);
    const bySaturation = [...(remaining.length ? remaining : clean)].sort((a, b) => saturation(b) - saturation(a));
    const accent = bySaturation[0] || '#a855f7';
    const secondary = bySaturation.find(c => c !== accent) || accent;

    const gradient = clean.length >= 2
        ? `linear-gradient(135deg, ${clean.join(', ')})`
        : `linear-gradient(135deg, ${bg} 0%, ${accent} 50%, ${bg} 100%)`;

    return { bg, text, accent, secondary, gradient };
}

/** Build a full theme object from a chosen preset id. */
export function themeFromPreset(presetId: string): MotionGraphicTheme {
    const resolved = PRESET_PALETTES[presetId] || PRESET_PALETTES.midnight;
    return { mode: 'preset', palette: presetId, resolved };
}

/** Build a full theme object from a freeform custom swatch list. */
export function themeFromCustomSwatches(swatches: string[]): MotionGraphicTheme {
    return { mode: 'custom', customColors: swatches, resolved: deriveRolesFromSwatches(swatches) };
}

/**
 * Fingerprint of "what colors this video would render with" — the global
 * theme plus any per-scene color overrides. Used both client-side (to decide
 * whether the current theme has already been rendered) and server-side (to
 * tag each completed render in `renderHistory`) — computed identically in
 * both places so a lookup always matches correctly.
 */
export function computeThemeFingerprint(theme: any, scenes: any[] | undefined | null): string {
    const sceneColors = (scenes || []).map((s: any) => (s?.customColors ? JSON.stringify(s.colors) : ''));
    return JSON.stringify({ theme, sceneColors });
}

export interface RenderHistoryEntry {
    fingerprint: string;
    videoUrl: string;
    renderedAt: string;
}

/**
 * Append a completed render to a project's render history — replacing any
 * existing entry for the same fingerprint (re-rendering an identical theme
 * updates in place rather than duplicating) and capping the list so it can't
 * grow unbounded across many theme experiments.
 */
export function appendRenderHistory(
    existing: RenderHistoryEntry[] | null | undefined,
    entry: RenderHistoryEntry,
    maxEntries = 20
): RenderHistoryEntry[] {
    const filtered = (existing || []).filter(h => h.fingerprint !== entry.fingerprint);
    filtered.push(entry);
    return filtered.slice(-maxEntries);
}
