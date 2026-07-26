/**
 * Course Chapter Notes Generator
 * POST: Generate structured cornell-style notes from chapter slide HTML
 * Uses OpenRouter (Owl Alpha + Nex N2 Pro fallback) via the shared client
 */

import { db } from "@/config/db";
import { chapterContentSlides } from "@/config/schema";
import { eq, and, asc } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { generateNanoBananaImagesParallel } from "@/lib/apify-image";
import { resolveSlideHtml } from "@/lib/slide-html";

// ── Extract readable text from slide HTML ────────────────────────────────────
function extractTextFromHtml(html: string): string {
    return html
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ')
        .trim();
}

// ── Notes-safe JSON parser ───────────────────────────────────────────────────
// Does NOT look for "html" fields — handles plain academic text with quotes
function parseNotesJson(raw: string): any {
    // 1. Strip markdown fences
    let text = raw.trim()
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/```\s*$/i, '')
        .trim();

    // 2. Direct parse first
    try { return JSON.parse(text); } catch {}

    // 3. Find the outermost { ... } block
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start !== -1 && end > start) {
        const slice = text.slice(start, end + 1);
        try { return JSON.parse(slice); } catch {}

        // 4. Fix unescaped double-quotes inside string values.
        // Walk char by char; when inside a JSON string, escape lone " that
        // are NOT preceded by backslash and NOT the closing quote.
        try {
            let fixed = '';
            let inStr = false;
            let escape = false;
            for (let i = 0; i < slice.length; i++) {
                const ch = slice[i];
                if (escape) { fixed += ch; escape = false; continue; }
                if (ch === '\\') { fixed += ch; escape = true; continue; }
                if (ch === '"') {
                    if (!inStr) { inStr = true; fixed += ch; continue; }
                    // Peek ahead: if next non-whitespace is :, ,, }, ] then this is closing
                    let j = i + 1;
                    while (j < slice.length && slice[j] === ' ') j++;
                    const next = slice[j];
                    if ([',', '}', ']', ':'].includes(next) || j >= slice.length) {
                        inStr = false; fixed += ch;
                    } else {
                        // Mid-string quote — escape it
                        fixed += '\\"';
                    }
                    continue;
                }
                fixed += ch;
            }
            return JSON.parse(fixed);
        } catch {}
    }

    // 5. Try to salvage partial: extract complete section objects
    try {
        const mainNotesMatch = text.match(/"mainNotes"\s*:\s*\[/);
        if (mainNotesMatch) {
            const titleMatch = text.match(/"title"\s*:\s*"([^"]+)"/);
            const summaryMatch = text.match(/"summary"\s*:\s*"([^"]+)"/);
            const sectionsRaw = text.slice((mainNotesMatch.index ?? 0) + mainNotesMatch[0].length);
            const sections: any[] = [];
            let depth = 0, buf = '', inSec = false;
            for (const ch of sectionsRaw) {
                if (ch === '{') { depth++; inSec = true; }
                if (inSec) buf += ch;
                if (ch === '}') { depth--; if (depth === 0 && inSec) { try { sections.push(JSON.parse(buf)); } catch {} buf = ''; inSec = false; } }
                if (ch === ']' && depth === 0) break;
            }
            if (sections.length > 0) {
                return {
                    title: titleMatch?.[1] ?? 'Chapter Notes',
                    summary: summaryMatch?.[1] ?? '',
                    mainNotes: sections,
                    keyTerms: [],
                };
            }
        }
    } catch {}

    throw new Error('Could not parse notes JSON — all strategies exhausted');
}

export async function POST(req: NextRequest) {
    try {
        const { courseId, chapterId, chapterTitle } = await req.json();

        if (!courseId || !chapterId) {
            return NextResponse.json({ error: "Missing courseId or chapterId" }, { status: 400 });
        }

        // ── Step 1: Fetch all slides for this chapter ────────────────────────
        const slides = await db
            .select({ html: chapterContentSlides.html, htmlUrl: chapterContentSlides.htmlUrl, slideIndex: chapterContentSlides.slideIndex })
            .from(chapterContentSlides)
            .where(and(
                eq(chapterContentSlides.courseId, courseId),
                eq(chapterContentSlides.chapterId, chapterId),
            ))
            .orderBy(asc(chapterContentSlides.slideIndex));

        if (!slides.length) {
            return NextResponse.json({ error: "No slides found for this chapter" }, { status: 404 });
        }

        // ── Step 2: Build content context from slide HTML ────────────────────
        // HTML lives in Appwrite (htmlUrl) or inline (legacy) — resolve each first.
        const resolvedHtml = await Promise.all(slides.map(s => resolveSlideHtml(s)));
        const slideContents = slides.map((s, i) => {
            const text = extractTextFromHtml(resolvedHtml[i] || '');
            return `--- SLIDE ${i + 1} ---\n${text}`;
        }).join('\n\n');

        console.log(`📝 Generating notes for chapter "${chapterTitle}" (${slides.length} slides, ${slideContents.length} chars)`);

        // ── Step 3: Generate via GLM as raw text ───────────────────────
        const systemPrompt = `You are an expert academic note-maker and information designer. You receive the text content extracted from educational video slides of a chapter. Your job is to create the DEFINITIVE study dossier for this chapter — notes so complete, structured and visual that a student could skip the video and still master every concept, then use the same pages for rapid revision before an exam.

OUTPUT FORMAT: Return a single JSON object with this exact structure:

{
  "title": "Chapter title",
  "summary": "3-4 sentence comprehensive chapter summary",
  "mainNotes": [
    {
      "heading": "Section heading",
      "type": "<one of the 31 types below>",
      ...type-specific fields
    }
  ],
  "keyTerms": [
    { "term": "Key concept", "definition": "Clear definition" }
  ]
}

ICON VOCABULARY — wherever a field is named "icon", give ONE lowercase keyword naming the concept, chosen from (or close to) this vocabulary. The renderer draws a real outlined icon from it — NEVER write "icon-xxx", never an emoji, never a sentence:
windows, macos, linux, terminal, desktop, laptop, mobile, keyboard, cpu, server, cloud, web, network, code, syntax, json, git, bug, tool, config, setup, package, module, database, variable, function, string, play, run, launch, rocket, power, install, download, save, loop, repeat, exit, search, filter, share, arrow, step, flow, pipeline, milestone, flag, goal, idea, tip, brain, learn, book, notes, write, checklist, question, puzzle, focus, chart, graph, trend, math, sum, percent, compare, gauge, speed, table, grid, science, test, atom, check, done, success, wrong, fail, warning, info, star, award, trophy, best, sparkle, fast, energy, fire, key, lock, security, time, clock, timer, history, calendar, map, location, compass, home, building, work, money, cost, user, team, chat, mail, voice, audio, camera, video, image, design, sun, night, water, mountain, tree, plant, grow, path, gift, reward, game, coffee, link, folder, file, layers, point.
Pick the keyword that MATCHES the item's meaning (a step about installing → "install"; about the REPL → "terminal"; about variables → "variable").

SECTION TYPES — use maximum variety across your sections, rotating types so no two adjacent sections share one:

1. "bullets" — { "bullets": ["point1", ...] } — 4-6 detailed bullet points
2. "numbered" — { "bullets": ["step1", ...] } — 4-6 numbered items
3. "table" — { "table": { "headers": ["col1","col2","col3"], "rows": [["a","b","c"], ...] } } — min 3 cols, 3-5 rows
4. "callout" — { "calloutText": "Important insight or key takeaway" }
5. "highlight" — { "highlightTitle": "Title", "highlightBody": "Detailed explanation" }
6. "cards" — { "cards": [{"icon": "key", "title": "Card Title", "description": "Detail"}] } — 4-6 cards
7. "numbered-grid" — { "items": [{"title": "Item", "description": "Detail"}] } — 4-6 items
8. "circular-map" — { "centerLabel": "Central Concept", "items": [{"icon": "keyword", "title": "Related", "description": "How"}] } — 4-6
9. "quote-cards" — { "quotes": [{"title": "Label", "text": "Quote or fact"}] } — 3 quotes
10. "flowchart" — { "steps": [{"label": "Step", "detail": "What happens", "icon": "keyword"}] } — 4-6 steps
11. "horizontal-flowchart" — { "steps": [{"label": "Step", "detail": "Detail", "icon": "keyword"}] } — 4-5 steps
12. "radial-list" — { "centerLabel": "Center", "items": [{"icon": "keyword", "title": "Item", "description": "Detail"}] } — 3-4
13. "step-cards" — { "steps": [{"label": "Step", "detail": "Detail", "icon": "keyword"}] } — 4-5 steps
14. "timeline" — { "events": [{"date": "Phase/Period", "title": "Event", "description": "Detail"}] } — 4-6 events
15. "comparison" — { "leftLabel": "Option A", "rightLabel": "Option B", "points": [{"left": "A trait", "right": "B trait", "aspect": "Category"}] } — 3-5 points
16. "stats-row" — { "stats": [{"value": "85%", "label": "Accuracy", "icon": "chart"}] } — 3-4 stats
17. "definition-list" — { "definitions": [{"term": "Concept", "meaning": "Explanation"}] } — 4-6 pairs
18. "checklist" — { "items": [{"text": "Task or requirement", "checked": true}] } — 5-7 items
19. "gradient-banner" — { "emoji": "goal", "bannerText": "Key principle", "subText": "Supporting explanation" } (emoji field takes an icon KEYWORD)
20. "matrix" — { "quadrants": [{"label": "Q1", "items": ["item1","item2"]}, ...exactly 4 quadrants] }
21. "icon-list" — { "listItems": [{"emoji": "keyword", "title": "Feature", "detail": "Description"}] } — 4-6 items
22. "code-block" — { "language": "python", "filename": "example.py", "code": "real runnable code with \\n line breaks", "output": "what it prints (optional)", "explanation": "one-line takeaway (optional)" } — REAL code from the chapter, 4-15 lines. MANDATORY at least once when the chapter teaches any code.
23. "qa-cards" — { "questions": [{"question": "Exam-style question", "answer": "Complete worked answer"}] } — 2-3 pairs testing UNDERSTANDING of this chapter, not recall
24. "mnemonic" — { "phrase": "Catchy Memory Phrase Here", "meaning": "what each first letter stands for" } — invent a genuinely helpful memory device for a list the chapter teaches
25. "formula" — { "expression": "E = mc²  /  O(n log n)  /  result = base ** exp", "legend": [{"symbol": "n", "meaning": "input size"}] } — for any formula, rule or complexity the chapter contains
26. "pyramid" — { "tiers": [{"label": "Peak concept", "detail": "one line"}, ...3-4 tiers, FIRST is the peak] } — hierarchies, foundations, priority orders
27. "venn" — { "leftLabel": "A", "rightLabel": "B", "sharedLabel": "Both", "leftItems": ["..."], "sharedItems": ["..."], "rightItems": ["..."] } — 2-3 items each — overlapping concepts
28. "do-dont" — { "dos": ["good practice", ...], "donts": ["mistake to avoid", ...] } — 3-5 each — best practices vs common errors
29. "big-fact" — { "fact": "ONE huge number/short phrase (e.g. '3.5x', '1991', 'Zero')", "context": "one sentence explaining why it matters" } — the chapter's most memorable single fact
30. "progress-bars" — { "bars": [{"label": "Skill/Topic", "percent": 80, "detail": "optional one line"}] } — 3-5 bars — relative importance, difficulty, coverage or adoption
31. "roadmap" — { "milestones": [{"icon": "keyword", "label": "Milestone", "detail": "what you can do at this point"}] } — 4-6 — the learning journey of this chapter

CRITICAL JSON RULES (strictly follow to avoid parse errors):
- All string values must use ONLY single quotes INSIDE text if you need quotes, never raw double-quote characters inside a JSON string value
- In "code" fields escape every newline as \\n and every double quote as \\"
- Do not use apostrophes that look like quotes — use plain ASCII apostrophe only
- No trailing commas
- No comments in the JSON
- Return ONLY the raw JSON object, no markdown fences, no preamble

CONTENT RULES — this is a study DOSSIER, not a summary:
1. Generate 16-24 sections covering EVERY topic the slides teach, in the slides' teaching order — nothing skipped
2. Use at least 12 DIFFERENT section types; never two adjacent sections of the same type
3. MANDATORY sections when applicable: at least one "code-block" if the chapter shows any code; at least one "qa-cards"; at least one "do-dont"; at least one of "mnemonic"/"big-fact"/"formula"; close with a "roadmap" or "gradient-banner" wrap-up
4. Every bullet/detail is a complete, information-dense sentence that TEACHES — never a bare label, never filler
5. Include concrete specifics from the slides: real commands, real values, real names, real numbers — a student should trust these notes as accurate
6. Include 8-12 keyTerms with precise definitions
7. Headings are clean title-case phrases with NO numbering prefixes`;

        const userMessage = `Generate comprehensive study notes for this chapter.

CHAPTER TITLE: ${chapterTitle || 'Chapter Notes'}

SLIDE CONTENT:
${slideContents}

Return ONLY the raw JSON object.`;

        // ── Step 3: Call NvidiaAPI directly (bypasses slide-specific json client) ──
        async function callOpenRouter(model: string): Promise<string> {
            const apiKey = process.env.NVIDIA_API_KEY || process.env.NVIDIA_API_KEY1 || '';
            if (!apiKey) throw new Error('No NVIDIA_API_KEY configured');

            const res = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model,
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userMessage },
                    ],
                    temperature: 0.4,
                    max_tokens: 16000,
                }),
            });
            if (!res.ok) throw new Error(`NvidiaAPI ${model} failed: ${res.status}`);
            const data = await res.json();
            const text = data.choices?.[0]?.message?.content;
            if (!text) throw new Error('Empty response from NvidiaAPI');
            console.log(`📄 Raw notes response from [${model}]: ${text.length} chars`);
            return text;
        }

        // ── Helper to call NvidiaAPI to plan beautiful image prompts ──
        async function callOpenRouterForPrompts(
            model: string,
            chapterTitle: string,
            slideContents: string
        ): Promise<string[]> {
            const apiKey = process.env.NVIDIA_API_KEY || process.env.NVIDIA_API_KEY1 || '';
            if (!apiKey) throw new Error('No NVIDIA_API_KEY configured');

            const promptsSystemPrompt = `You are a visual design assistant specializing in creating highly effective image generation prompts for educational materials.
Your job is to generate 4 distinct, highly detailed prompts for generating beautiful images representing the concepts in the study chapter.

ILLUSTRATION STYLE REQUIREMENTS:
- Clean flat-design educational illustration
- Style: modern minimal, soft colors, white/light background, vector-like quality
- Types of visual assets: textbook diagrams, infographics, labeled diagrams, concept maps, annotated charts, flat isometric views
- Visuals must be exceptionally elegant, using a harmonious pastel color palette (e.g. mint, lavender, soft peach, dusty teal, gold accents)
- STRICTLY NO TEXT — all elements must use abstract symbols, shapes, gears, connections, and visual metaphors instead of readable words. If there is a label, represent it as an abstract box or line, not actual characters.

OUTPUT FORMAT: Return a single JSON array of strings containing exactly 4 detailed prompts.
Example:
[
  "A detailed infographic diagram of ... in a clean flat-design vector style with a soft light background ...",
  "An elegant isometric textbook diagram showing ... in a modern minimal aesthetic with soft lavender and gold pastel colors ...",
  ...
]

Return ONLY the raw JSON array of strings, no markdown fences, no preamble.`;

            const userMessage = `Generate 4 beautiful image prompts following the illustration style requirements for this chapter.

CHAPTER TITLE: ${chapterTitle || 'Chapter Notes'}

SLIDE CONTENT:
${slideContents}

Return ONLY the raw JSON array of strings.`;

            const res = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model,
                    messages: [
                        { role: 'system', content: promptsSystemPrompt },
                        { role: 'user', content: userMessage },
                    ],
                    temperature: 0.6,
                    max_tokens: 4000,
                }),
            });
            if (!res.ok) throw new Error(`NvidiaAPI ${model} failed for prompts: ${res.status}`);
            const data = await res.json();
            const text = data.choices?.[0]?.message?.content;
            if (!text) throw new Error('Empty response from NvidiaAPI prompts');
            
            try {
                let cleanText = text.trim()
                    .replace(/^```json\s*/i, '')
                    .replace(/^```\s*/i, '')
                    .replace(/```\s*$/i, '')
                    .trim();
                const arr = JSON.parse(cleanText);
                if (Array.isArray(arr)) {
                    return arr.slice(0, 4);
                }
            } catch (e) {
                console.error("Failed to parse prompts array:", e);
            }
            
            // Safe fallback prompts
            return [
                `Flat design educational infographic representing ${chapterTitle}, modern minimal, soft colors, white background, vector quality, no text`,
                `Concept map showing components of ${chapterTitle}, clean flat design vector, pastel harmonious color palette, light background, no text`,
                `Isometric 2D textbook diagram illustrating ${chapterTitle}, modern minimal, dusty teal and lavender colors, soft lighting, no text`,
                `Annotated abstract schematic of ${chapterTitle} systems, flat style vector illustration, clean lines, white background, no text`
            ];
        }

        // ── Phase 1: Parallel content generation (primary) and prompt generation (primary) ──
        console.log(`🚀 Starting simultaneous generation: Notes + Prompts`);
        
        let notesRawText = "";
        let promptsList: string[] = [];

        try {
            const [notesResult, promptsResult] = await Promise.all([
                // 1. Notes Content Generation (GLM-5.2 primary, gpt-oss-120b + llama fallbacks)
                (async () => {
                    try {
                        return await callOpenRouter('z-ai/glm-5.2');
                    } catch (primaryErr) {
                        console.warn('⚠️ GLM-5.2 failed, falling back to gpt-oss-120b for notes:', primaryErr);
                        try {
                            return await callOpenRouter('openai/gpt-oss-120b');
                        } catch (superErr) {
                            console.warn('⚠️ gpt-oss-120b failed, falling back to llama-3.3-70b for notes:', superErr);
                            return await callOpenRouter('meta/llama-3.3-70b-instruct');
                        }
                    }
                })(),
                // 2. Prompts Generation via GLM-5.2 primary, with fallbacks
                (async () => {
                    try {
                        return await callOpenRouterForPrompts('z-ai/glm-5.2', chapterTitle, slideContents);
                    } catch (err) {
                        console.warn('⚠️ GLM-5.2 prompts failed, trying gpt-oss-120b:', err);
                        try {
                            return await callOpenRouterForPrompts('openai/gpt-oss-120b', chapterTitle, slideContents);
                        } catch (superErr) {
                            console.warn('⚠️ gpt-oss-120b prompts failed, trying llama-3.3-70b:', superErr);
                            try {
                                return await callOpenRouterForPrompts('meta/llama-3.3-70b-instruct', chapterTitle, slideContents);
                            } catch (fallbackErr) {
                                console.error('⚠️ Fallback prompts generation failed, using defaults:', fallbackErr);
                                return [
                                    `Flat design educational infographic representing ${chapterTitle}, modern minimal, soft colors, white background, vector quality, no text`,
                                    `Concept map showing components of ${chapterTitle}, clean flat design vector, pastel harmonious color palette, light background, no text`,
                                    `Isometric 2D textbook diagram illustrating ${chapterTitle}, modern minimal, dusty teal and lavender colors, soft lighting, no text`,
                                    `Annotated abstract schematic of ${chapterTitle} systems, flat style vector illustration, clean lines, white background, no text`
                                ];
                            }
                        }
                    }
                })()
            ]);

            notesRawText = notesResult;
            promptsList = promptsResult;

        } catch (err: any) {
            console.error("❌ Parallel notes/prompts generation failed:", err);
            throw err;
        }

        console.log(`📄 Raw notes response: ${notesRawText.length} chars`);

        // ── Phase 2: Parse Notes Content ──
        const generatedData = parseNotesJson(notesRawText);
        console.log(`✅ Notes parsed for "${chapterTitle}": ${generatedData?.mainNotes?.length || 0} sections, ${generatedData?.keyTerms?.length || 0} terms`);

        // ── Phase 3: Parallel Leonardo Nano Banana 2 Image Generation ──
        console.log(`🎨 Triggering concurrent image generation via Leonardo Nano Banana 2 for ${promptsList.length} prompts`);
        
        const scenes = promptsList.map((prompt, index) => ({
            index,
            prompt,
            width: 1376,
            height: 768,
            styleUUID: "703d6fe5-7f1c-4a9e-8da0-5331f214d5cf" // Graphic Design 2D
        }));

        let pageImages: Array<{ pageIndex: number; imageUrl: string; prompt: string }> = [];

        try {
            const imageResults = await generateNanoBananaImagesParallel(scenes);
            
            imageResults.forEach((res) => {
                if (res.success && res.imageUrl) {
                    pageImages.push({
                        pageIndex: res.index,
                        imageUrl: res.imageUrl,
                        prompt: promptsList[res.index]
                    });
                }
            });
            console.log(`✅ Parallel image generation complete: ${pageImages.length}/${promptsList.length} images ready`);
        } catch (imgErr: any) {
            console.error("⚠️ Parallel image generation failed or timed out:", imgErr);
        }

        // ── Phase 4: Inject ai-image sections INTO mainNotes at evenly spaced positions ──
        if (pageImages.length > 0 && generatedData.mainNotes?.length) {
            const sections = generatedData.mainNotes;
            const totalSections = sections.length;
            const spacing = Math.floor(totalSections / (pageImages.length + 1));

            // Insert in reverse order so earlier indices aren't shifted
            for (let i = pageImages.length - 1; i >= 0; i--) {
                const insertAt = Math.min(spacing * (i + 1), totalSections);
                const nearbySection = sections[Math.min(insertAt, totalSections - 1)];
                const contextHeading = nearbySection?.heading || nearbySection?.title || `Concept Illustration ${i + 1}`;
                sections.splice(insertAt, 0, {
                    type: 'ai-image',
                    heading: `Visual: ${contextHeading}`,
                    imageUrl: pageImages[i].imageUrl,
                    prompt: pageImages[i].prompt,
                    imageStyle: i % 4,
                });
            }
            console.log(`🖼️ Injected ${pageImages.length} ai-image sections into mainNotes (now ${sections.length} total)`);
        }

        return NextResponse.json({
            success: true,
            generatedData,
        });

    } catch (error: any) {
        console.error("❌ Course notes generation failed:", error);
        return NextResponse.json(
            { error: error.message || "Generation failed" },
            { status: 500 }
        );
    }
}
