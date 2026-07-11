/**
 * @module api/enhance-narration
 * @description Stage 3 — polish a slide's narration text with the LLM.
 *
 * POST /api/enhance-narration { text, slideTopic?, chapterTitle? } -> { text }
 *
 * Used by the Studio review cockpit's ✨ Enhance button on the narration editor
 * (inline replace + undo). Calls shortsLLM.text(), which inherits the shared
 * NVIDIA key rotation + model fallback — no rate-limit handling needed here.
 */

import { shortsLLM } from "@/lib/shorts-llm";
import { validateInput, enhanceNarrationSchema } from "@/lib/validations";
import { NextRequest, NextResponse } from "next/server";

// Narration bodies are long — allow the full serverless budget.
export const maxDuration = 300;

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const validation = validateInput(enhanceNarrationSchema, body);
        if (!validation.success) {
            return NextResponse.json({ error: "Invalid input", details: validation.errors }, { status: 400 });
        }
        const { text, slideTopic, chapterTitle } = validation.data;

        const systemPrompt = `You are an expert scriptwriter and instructional narrator refining the SPOKEN narration for a single slide in a professional video course.

You will be given the current narration script for one slide. Rewrite it so it is clearer, warmer, and more engaging to LISTEN to — while preserving the SAME meaning, facts, teaching points and overall length.

CRITICAL RULES:
1. Return ONLY the polished narration as plain text. No markdown, no headings, no bullet points, no quotation marks wrapping the whole thing, no preamble like "Here is".
2. Keep it roughly the same length as the input — do NOT drastically shorten or pad it.
3. Preserve every concept, example, definition, and transition that the original teaches. Do NOT invent new facts or remove key teaching content.
4. Write for the EAR: natural spoken rhythm, smooth transitions, no on-screen-only cues, no stage directions, no emojis.
5. Do NOT include any HTML, SSML tags, or slide markup — this is pure narration text fed to a text-to-speech engine.
6. Preserve the original language of the narration.`;

        const contextBits: string[] = [];
        if (chapterTitle?.trim()) contextBits.push(`Chapter: "${chapterTitle.trim()}"`);
        if (slideTopic?.trim()) contextBits.push(`Slide topic: "${slideTopic.trim()}"`);
        const contextBlock = contextBits.length ? `${contextBits.join("\n")}\n\n` : "";

        const userPrompt = `${contextBlock}Refine the following slide narration. Return ONLY the improved narration text.

--- CURRENT NARRATION ---
${text.trim()}`;

        const raw = await shortsLLM.text(systemPrompt, userPrompt, {
            temperature: 0.6,
            // Give the model room for a full-length narration reply.
            maxTokens: 8000,
        });

        let polished = (raw ?? "").trim();
        // Strip accidental markdown fences / wrapping quotes the model may add.
        polished = polished
            .replace(/^```[a-z]*\s*/i, "")
            .replace(/```\s*$/i, "")
            .replace(/^["'`]+|["'`]+$/g, "")
            .trim();

        if (!polished) {
            throw new Error("Empty response from AI");
        }

        return NextResponse.json({ text: polished });
    } catch (err: any) {
        console.error("enhance-narration error:", err?.message);
        return NextResponse.json({ error: err?.message || "Enhance failed" }, { status: 500 });
    }
}
