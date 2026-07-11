/**
 * @module api/enhance-point
 * @description Polish a single course-outline bullet point with the LLM.
 *
 * POST /api/enhance-point  { text, chapterTitle?, contextPoints? } -> { text }
 *
 * Used by the Outline Editor cockpit's ✨ Enhance button. Calls shortsLLM.json(),
 * which inherits the shared NVIDIA key rotation + model fallback — no rate-limit
 * handling needed here.
 */

import { shortsLLM } from "@/lib/shorts-llm";
import { validateInput, enhancePointSchema } from "@/lib/validations";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const validation = validateInput(enhancePointSchema, body);
        if (!validation.success) {
            return NextResponse.json(
                { error: "Invalid input", details: validation.errors },
                { status: 400 }
            );
        }
        const { text, chapterTitle, contextPoints } = validation.data;

        const systemPrompt = `You are an expert instructional designer refining the outline of a video course chapter. You will be given ONE bullet point (a learning objective) and must rewrite it so it is clearer, more specific, and more compelling — while keeping the SAME underlying meaning and scope.

CRITICAL RULES:
1. ONLY return a valid JSON object. No markdown, no code fences, no XML tags.
2. Return EXACTLY one polished bullet point — do NOT split it into multiple points or add new topics.
3. Keep it concise: a single line, roughly the same length as the input (max ~200 characters). Do NOT write a paragraph.
4. No emojis, no ellipses, no trailing punctuation like "...". No leading bullet characters or numbering.
5. DO NOT use any double quotes (") inside the text. Use single quotes (') if needed.
6. Preserve the original language of the point.
7. Make it action-oriented and specific (what the learner will understand or be able to do), not vague.

JSON SCHEMA:
{
    "text": "the polished bullet point"
}

CRITICAL: Output ONLY valid JSON. Start with { and end with }.`;

        const chapterBlock = chapterTitle?.trim()
            ? `--- CHAPTER TITLE (for context) ---\n"${chapterTitle.trim()}"\n`
            : "(No chapter title provided.)";

        const contextBlock = contextPoints?.length
            ? `--- OTHER POINTS IN THIS CHAPTER (for context — do NOT duplicate their meaning) ---\n${contextPoints
                  .map((p) => `- ${p.trim()}`)
                  .join("\n")}\n`
            : "(No other points provided.)";

        const userPrompt = `Refine the following single course-outline point.

${chapterBlock}

${contextBlock}

--- POINT TO REFINE ---
"${text.trim()}"

Rewrite ONLY this point, keeping its meaning and scope, making it clearer and more specific.`;

        const result = await shortsLLM.json(systemPrompt, userPrompt, {
            temperature: 0.6,
            maxTokens: 512,
        });

        const rawText = typeof result === "string" ? result : JSON.stringify(result);

        // ── Extraction pipeline (mirrors studio/enhance-scene) ──────────────────
        let polished: string | null = null;

        // Strategy 1 — direct object access (already parsed)
        if (!polished && result?.text && typeof result.text === "string" && result.text.trim()) {
            polished = result.text.trim();
        }

        // Strategy 2 — parse a JSON string
        if (!polished && typeof result === "string") {
            try {
                const parsed = JSON.parse(result.trim());
                if (parsed?.text && typeof parsed.text === "string" && parsed.text.trim()) {
                    polished = parsed.text.trim();
                }
            } catch { /* fall through */ }
        }

        // Strategy 3 — regex anchored to end of string
        if (!polished) {
            const match = rawText.match(/"text"\s*:\s*"([\s\S]+?)"\s*\}?\s*$/);
            if (match?.[1]?.trim()) {
                polished = match[1].replace(/\\n/g, " ").replace(/\\"/g, '"').replace(/\n/g, " ").trim();
            }
        }

        // Strategy 4 — char-by-char walk after "text": "
        if (!polished) {
            const match = rawText.match(/"text"\s*:\s*"([\s\S]+)/);
            if (match) {
                const rest = match[1];
                let end = -1;
                for (let i = 0; i < rest.length; i++) {
                    if (rest[i] === "\\") { i++; continue; }
                    if (rest[i] === '"') { end = i; break; }
                }
                const extracted = end !== -1 ? rest.slice(0, end) : rest.replace(/["{}]/g, "");
                if (extracted.trim()) {
                    polished = extracted.replace(/\\n/g, " ").replace(/\n/g, " ").trim();
                }
            }
        }

        if (!polished) {
            console.error("enhance-point: all strategies failed. rawText:", rawText.slice(0, 300));
            throw new Error("Invalid format returned by AI");
        }

        // Guard against runaway length — keep it a single tidy bullet
        if (polished.length > 300) polished = polished.slice(0, 300).trim();

        return NextResponse.json({ text: polished });
    } catch (err: any) {
        console.error("enhance-point error:", err?.message);
        return NextResponse.json({ error: err?.message || "Enhance failed" }, { status: 500 });
    }
}
