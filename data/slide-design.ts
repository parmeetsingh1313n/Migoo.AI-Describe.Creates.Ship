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
    // First 8 are the highest-priority/most-common picks — deliberately diverse + image-rich, NOT table/diff.
    // Chapters are no longer fixed-length (see expandChapterTopics in inngest/course-functions.ts):
    // each subContent point becomes 1-3 slides depending on depth, capped at MAX_SLIDES_PER_CHAPTER (25).
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
    "CODE SNIPPET — ONE syntax-highlighted code card (use the .code-card component), a REAL, COMPLETE, working snippet up to ~50 lines (it auto-scrolls in sync with narration — never fake-truncate it), a filename/language chip in the header, and it is the ENTIRE body; NEVER an image of code, NEVER a table cell",
    "CODE + EXPLAIN — a 2-column body: a syntax-highlighted .code-card (a real complete snippet, up to ~20 lines, auto-scrolls) on one side and 2-3 short numbered takeaways on the other; for explaining what a snippet does",
    "CODE + CALLOUTS — a 2-column body: a syntax-highlighted .code-card (a real complete snippet, up to ~20 lines, auto-scrolls) on one side and 2-3 numbered callout cards (circular number + bold label + one-line detail) on the other; each callout maps to a part of the code",
    "CODE + STEPS — a 2-column body: a syntax-highlighted .code-card (a real complete snippet, up to ~20 lines, auto-scrolls) on one side and a compact 3-4 step NUMBERED STEPPER (circular numbers joined by a spine) on the other; for code that follows a sequence of stages",
    "CODE + COMPANION — a 2-column body: a syntax-highlighted .code-card (a real complete snippet, up to ~20 lines, auto-scrolls) on one side and ONE companion component chosen from the catalog on the other (metric row, definition cards, mini comparison table, tag/chip cloud, concept-vs-example, mini bar-chart, feature list) — pick whichever FITS the code, NOT always callouts. The companion must be DENSE: every item carries a bold title + a real one-line detail.",
    "MERMAID DIAGRAM — a REAL rendered Mermaid flowchart/sequence/state diagram (diagram-as-code, never hand-drawn boxes) for processes, algorithms, state machines, or architecture; ≤ 3 words per node label",
    "LIVE CHART — a REAL Chart.js bar/line/pie/doughnut chart (never a hand-CSS'd bar approximation) for genuine numeric/statistical comparisons; 3-6 data points",
    "FORMULA / MATH CALLOUT — one REAL KaTeX-rendered formula or equation, large and centered, with a short one-line explanation beneath; for math, algorithm complexity, or scientific notation",
];

// ─────────────────────────────────────────────────────────────────────────────
// Q&A DISCUSSION ARCHETYPES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Layouts for the end-of-chapter Q&A session. These are NEVER part of the normal
 * rotation — they are assigned explicitly to the trailing Q&A slides (see
 * isQnaTopic / qnaArchetypeFor).
 *
 * Every one follows the same spine: the QUESTION sits in a banded card at the
 * TOP of the slide, and the body below works through the answer step by step, so
 * a viewer sees what is being asked before any of the answer appears. The four
 * variants differ by what KIND of question is being answered, because a
 * numerical, a code, a theory and a conceptual question each need a different
 * working-out.
 */
export const QNA_ARCHETYPES = [
    "Q&A — NUMERICAL WORKED SOLUTION — the QUESTION in a full-width tinted band at the TOP (small-caps 'Question' kicker + the question in serif, 20-24px). Body = a vertical worked solution: 3-5 numbered steps, each a circular step number + a bold one-line statement of what this step does + the actual arithmetic/formula for that step in mono or KaTeX. Values carry units. Final step is a highlighted ANSWER row with an accent left-border and the result in a large bold number. Never skip algebra — every line must follow visibly from the one above.",
    "Q&A — CODE SOLUTION WALKTHROUGH — the QUESTION in a full-width tinted band at the TOP. Body = 2 columns: a syntax-highlighted .code-card (header + <pre><code>, a REAL complete working solution, auto-scrolls) on one side, and 3-4 numbered callouts on the other, each mapping to a specific part of the code (a bold label + a real one-line explanation of WHY that line/block is there). Include the expected output as a small mono strip beneath the code when it clarifies the answer.",
    "Q&A — THEORY / CONCEPTUAL ANSWER — the QUESTION in a full-width tinted band at the TOP. Body = a structured answer: a one-line DIRECT ANSWER in a highlighted definition card first (the viewer gets the answer immediately), then 3-4 supporting points as numbered feature rows (bold claim + one-line justification each), and where a contrast makes it click, a compact 2-column 'this vs that' block. No walls of text — every point is a titled row.",
    "Q&A — REASONING / TRADE-OFF ANSWER — the QUESTION in a full-width tinted band at the TOP. Body = the shape of the reasoning: either a 3-4 node decision flow (circular nodes joined by a gradient line, each a condition → outcome), or a 2-column WHEN-TO-USE vs WHEN-NOT-TO table, whichever the question calls for — followed by a single-line VERDICT band in an accent tint. For questions where the honest answer is 'it depends', make the dependency explicit and visual.",
];

/** Prefix stamped on Q&A slide topics so the pipeline can recognise them. */
export const QNA_TOPIC_PREFIX = "[Q&A]";

/** True when a slide topic is one of the appended Q&A discussion slides. */
export function isQnaTopic(topic: string): boolean {
    return typeof topic === "string" && topic.trimStart().startsWith(QNA_TOPIC_PREFIX);
}

/**
 * Pick the Q&A layout for the nth Q&A slide. Rotates by question type so a
 * chapter's Q&A session doesn't show four identical-looking slides; the writer
 * is separately told to pick questions whose types actually vary.
 */
export function qnaArchetypeFor(qnaIndex: number): string {
    return QNA_ARCHETYPES[qnaIndex % QNA_ARCHETYPES.length];
}

/** True for any Q&A layout (so the anti-repeat ledger can exempt them). */
export function isQnaArchetype(archetype: string): boolean {
    return typeof archetype === "string" && archetype.startsWith("Q&A");
}

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
    const STRIDE = 8;                          // co-prime with the catalog length (35)
    const offset = 1 + chapterIndex * 3;       // each chapter starts at a different archetype (3 co-prime with 35)
    let idx = (offset + si * STRIDE) % n;
    if (idx === 0) idx = 1;                     // never reuse COVER for a non-intro slide
    return SLIDE_ARCHETYPES[idx];
}

/** The component name (before the em-dash) for an archetype string. */
export function componentName(archetype: string): string {
    return archetype.split(/[—-]/)[0].trim();
}

/**
 * A deterministic NON-code archetype near a given (chapterIndex, si) — used when a
 * slide's natural rotation lands on a code archetype but the chapter has already
 * spent its code budget, so we swap in visual variety instead of yet another code
 * card. Walks the co-prime rotation forward until it hits a non-code entry.
 */
export function pickNonCodeArchetype(chapterIndex: number, si: number): string {
    const n = SLIDE_ARCHETYPES.length;
    const STRIDE = 8;
    const offset = 1 + chapterIndex * 3;
    for (let step = 0; step < n; step++) {
        let idx = (offset + (si + step) * STRIDE) % n;
        if (idx === 0) idx = 1;
        if (!isCodeArchetype(SLIDE_ARCHETYPES[idx])) return SLIDE_ARCHETYPES[idx];
    }
    return SLIDE_ARCHETYPES[1]; // unreachable (catalog has many non-code entries)
}

/** Whether an archetype is a code slide (must be a .code-card, never an image). */
export function isCodeArchetype(archetype: string): boolean {
    return /^CODE/i.test(componentName(archetype));
}

/**
 * Cheap keyword heuristic for "does this topic warrant a real code example?" —
 * used as a fallback signal when a per-topic LLM needsCode classification is
 * unavailable/unreliable, so a chapter never loses all its code slides just
 * because one upstream call had a bad response.
 *
 * IMPORTANT: kept DELIBERATELY NARROW. An earlier version matched broad nouns
 * (list, array, variable, module, library, code, string…) that appear in almost
 * every programming topic, so nearly every slide got force-overridden to a code
 * card and the whole component catalog collapsed to code. This version only fires
 * on topics that are genuinely about writing/reading a concrete snippet — verbs
 * and syntax constructs, not the vocabulary of the domain.
 */
export function isLikelyCodeTopic(topic: string): boolean {
    return /\b(implement(ing|ation)?|syntax|code example|write (a|the) (function|method|class|loop|query)|for loop|while loop|list comprehension|regex|regular expression|sql query|constructor|inheritance|recursion|recursive|try\/?except|try\/?catch|exception handling|async\/?await|callback|closure|decorator|generator function|lambda|function signature|method chaining)\b/i.test(topic);
}

/**
 * How many code slides a chapter of `totalSlides` should be allowed to contain.
 * The topic-aware override forces code archetypes when a topic looks code-shaped;
 * without a cap a programming chapter can become ALL code cards. Cap at ~40% (at
 * least 1) so the rest of the catalog (diagrams, charts, steppers, …) still shows.
 */
export function codeSlideBudget(totalSlides: number): number {
    return Math.max(1, Math.round(totalSlides * 0.4));
}

/**
 * The mixed-layout archetypes: a code card paired with ONE small companion
 * component (numbered takeaways / progress steps / checklist) in a 2-column body.
 * These are the ONLY archetypes where code may sit next to another component —
 * everywhere else the strict one-component rule still applies.
 */
export function isCodeCompanionArchetype(archetype: string): boolean {
    return /^CODE \+/i.test(componentName(archetype));
}
