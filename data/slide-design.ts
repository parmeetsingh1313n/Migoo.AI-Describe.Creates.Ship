/**
 * Shared slide-design system
 * ──────────────────────────
 * Single source of truth for the per-slide component rotation used by BOTH the
 * bulk generation pipeline (inngest/course-functions.ts) and the single-slide
 * regeneration route (app/api/regenerate-slide/route.ts).
 *
 * Keeping this in one place prevents the two call sites from drifting apart
 * (they previously used different archetype lists AND different pickers, which
 * is how "every chapter looked identical / the funnel repeated" crept back in).
 */

// Each entry names the PRIMARY component a slide must be built around. The text
// before the em-dash is the component name; the rest is its build spec.
export const SLIDE_ARCHETYPES = [
    // First 8 are what an 8-slide chapter uses — deliberately diverse + image-rich, NOT table/diff.
    "COVER — kicker + one large headline + single-line dek; body shows a relevant image in a bounded ~40% side column (never full-width, never under the headline)",
    "GAUGE / SPEEDOMETER — a half-ring conic meter showing one score/level on the left + a short explanation on the right",
    "ANNOTATED DIAGRAM — a relevant image in a ~50% side column with 2-3 numbered callout labels beside it (labels NEXT TO the image, never on top)",
    "FUNNEL — 4 narrowing gradient stage bars (e.g. pipeline / conversion / drop-off) with a percentage each",
    "QUADRANT / 2x2 MATRIX — two labelled axes and four tinted cells (e.g. value vs effort); each cell one short label",
    "HORIZONTAL TIMELINE / FLOW — 3-5 circular step nodes joined by a gradient line/arrows, each with a short label",
    "PYRAMID / HIERARCHY — 3-4 stacked tiers from wide foundation to narrow peak, each tier one label",
    "KPI DASHBOARD TILES — 2-3 big-number tiles each with a label and a mini trend bar; dashboard feel",
    // Remaining components (used for longer chapters / single-slide regen).
    "COMPARISON TABLE — a premium 3-5 row table (Aspect / Option A / Option B) with a tinted header row; for differences and 'X vs Y'",
    "BEFORE / AFTER DIFF — two side-by-side columns (red-tinted Before, green-tinted After) each with an accent left-border and a small-caps label",
    "HUB-AND-SPOKE — a central circular concept node with 3-4 radiating pills (pills in flow columns, never over the hub)",
    "DONUT / RING STAT — a conic-gradient percentage ring on one side + a short label/explanation on the other",
    "CHECKLIST — DO vs DON'T: two columns of green ✓ points and red ✗ points",
    "NUMBERED STEPPER — 3-4 vertical steps with circular numbers joined by a spine; for sequences / how-to",
    "VENN / OVERLAP — two translucent overlapping circles labelled Set A / Set B with a 'shared' middle (the only intentional overlap)",
    "MINI BAR-CHART — 3-4 gradient columns of varying height with short labels; quick visual data compare",
    "ROADMAP / MILESTONE PATH — a horizontal gradient track with 3-4 flagged checkpoints, each a phase + short note",
    "ICON FEATURE GRID — a 2x2 of large glyph + bold label + one line, generous spacing (premium, not cramped tiles)",
    "METRIC CALLOUT ROW — 2-3 label → big number → delta metrics; results / dashboard feel",
    "PROGRESS / METER BARS — 3-4 labelled gradient progress bars with percentages, stacked",
    "NUMBERED FEATURE ROWS — 3-4 rows separated by hairlines, each = big serif index number + bold title + one-line detail (no boxes)",
    "STAT ROW — 2-3 huge gradient statistics with captions, plus a short supporting line; data-forward",
    "BUBBLE CARDS — a row of 2-3 soft rounded bubble cards (big radius, inset highlight, soft shadow), each a gradient chip + title + one line",
    "DEFINITION / CALLOUT CARD — one key term with an accent spine, the term in serif + a concise one-line meaning",
    "TAG / CHIP CLOUD — 6-9 concept keywords as rounded pills in varied accent tints; fast overview / glossary",
    "CONCEPT vs EXAMPLE — two labelled columns: the abstract concept on one side, a concrete example (mono font) on the other",
    "PRINCIPLE BAND — one strong italic serif statement in a tinted full-width band; a memorable takeaway",
    "CODE SNIPPET — ONE syntax-highlighted code card (use the .code-card component) with ≤ 9 short lines, a filename/language chip in the header, and it is the ENTIRE body; NEVER an image of code",
    "CODE + EXPLAIN — a 2-column body: a small syntax-highlighted .code-card (≤ 8 lines) on one side and 2-3 short numbered takeaways on the other; for explaining what a snippet does",
];

export const SLIDE_TYPE_PAIRS = [
    "Playfair Display headline + Outfit body",
    "Space Grotesk headline + Inter body",
    "Playfair Display headline + DM Sans body",
    "Outfit bold headline + Inter body",
    "Instrument Serif italic headline + Space Grotesk body",
];

export const SLIDE_ACCENTS = ["#6D5BD3", "#3EA5D6", "#E0653A", "#E8B84B", "#2FA98C", "#D64B7F"];

/**
 * Deterministic per-chapter/per-slide archetype picker.
 *
 * Keying on (chapterIndex, si) with a chapter offset + a co-prime stride means
 * (a) different chapters NEVER share the same component sequence, and
 * (b) no two slides in a chapter repeat a component (co-prime stride visits all).
 * si === 0 stays COVER (intro). We skip index 0 for non-intro slides so a middle
 * slide can never accidentally land back on the COVER layout.
 */
export function pickArchetype(chapterIndex: number, si: number): string {
    if (si === 0) return SLIDE_ARCHETYPES[0]; // INTRO is always a COVER
    const n = SLIDE_ARCHETYPES.length;
    const STRIDE = 7;                          // co-prime with the catalog length
    const offset = 1 + chapterIndex * 5;       // each chapter starts at a different archetype
    let idx = (offset + si * STRIDE) % n;
    if (idx === 0) idx = 1;                     // never reuse COVER for a non-intro slide
    return SLIDE_ARCHETYPES[idx];
}

/** The component name (before the em-dash) for an archetype string. */
export function componentName(archetype: string): string {
    return archetype.split(/[—-]/)[0].trim();
}

/** Whether an archetype is a code slide (must be a .code-card, never an image). */
export function isCodeArchetype(archetype: string): boolean {
    return /^CODE/i.test(componentName(archetype));
}
