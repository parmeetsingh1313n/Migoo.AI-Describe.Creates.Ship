import { aiFallback } from "@/config/ai-fallback";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
    try {
        const { niche, seriesTitle } = await req.json();

        const systemPrompt = `You are an expert YouTube title creator. Given a channel's overarching niche and a specific Series Title, generate 8 highly compelling, click-worthy, and unique YouTube video titles explicitly tailored to the topic of that specific series.
        For example, if the Series Title is "Amritsar Historical Facts", all 8 titles MUST specifically be about Amritsar history and not just generic world history. Focus entirely on the Series Title context.
        The titles should be realistic, highly engaging, and look exactly like top-performing YouTube video titles.
        Do NOT include emojis or bullet points.

        RULES:
        1. Output ONLY a valid JSON object wrapped in <json> and </json> tags.
        2. Create exactly 8 video titles.

        JSON SCHEMA:
        <json>
        {
            "titles": [
                "I Tried The 7-Day Dopamine Detox (Here's What Happened)",
                "The Hidden Truth Behind Ancient Rome's Collapse",
                "Why 99% Of Startups Fail In Their First Year",
                "How To Build Muscle Twice As Fast (Scientifically Proven)"
            ]
        }
        </json>`;

        const userPrompt = `Overarching Niche: "${niche || 'general content'}"
        Specific Series Title: "${seriesTitle || 'general content'}"
        Generate 8 unique viral video titles perfectly scoped to the Specific Series Title.`;

        const result = await aiFallback.json(systemPrompt, userPrompt, {
            temperature: 0.8,
            maxOutputTokens: 1024,
            // Structured output — Groq returns JSON via prompt instructions
            schema: {
                type: 'object',
                properties: {
                    titles: {
                        type: 'array',
                        items: { type: 'string' },
                        minItems: 8,
                        maxItems: 8,
                    },
                },
                required: ['titles'],
            },
        });

        if (!result.titles || !Array.isArray(result.titles) || result.titles.length === 0) {
            throw new Error("Invalid format returned by AI");
        }

        return NextResponse.json({ angles: result.titles.slice(0, 8) });
    } catch (err: any) {
        console.error("studio/generate-angles error:", err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
