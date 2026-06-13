import { shortsLLM } from "@/lib/shorts-llm";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { currentNarration, instruction, prevNarration, nextNarration, sceneIndex, totalScenes } = body;

        console.log("📥 enhance-scene received:", {
            sceneIndex,
            totalScenes,
            hasNarration: currentNarration !== undefined && currentNarration !== null,
            narrationLength: typeof currentNarration === "string" ? currentNarration.length : "N/A",
            hasPrev: !!prevNarration,
            hasNext: !!nextNarration,
            hasInstruction: !!instruction,
        });

        // Allow empty currentNarration (write-from-scratch scenario)
        if (currentNarration === undefined || currentNarration === null) {
            return NextResponse.json({ error: "Missing field: currentNarration" }, { status: 400 });
        }
        if (!instruction || typeof instruction !== "string" || !instruction.trim()) {
            return NextResponse.json({ error: "Missing field: instruction" }, { status: 400 });
        }

        const sceneLabel = sceneIndex !== undefined
            ? `Scene ${sceneIndex + 1} of ${totalScenes || "?"}`
            : "Scene";

        const systemPrompt = `You are an expert scriptwriter and editor. Your task is to rewrite a single scene's narration based on the user's explicit instructions.

CRITICAL RULES:
1. ONLY return a valid JSON object. Do not wrap it in markdown blockquotes or XML tags.
2. Keep the word count naturally similar to the original, or expand upon it if the user instruction asks for more detail. Respond comprehensively.
3. Do not include meta-commentary, timestamps, or scene labels. Just the pure narration text.
4. Output cleanly without any emojis, ellipses, parentheticals, or weird characters.
5. DO NOT use any double quotes (") inside the narration text. Use single quotes (') instead.
6. NARRATIVE CONTINUITY: The rewritten scene must flow naturally from the previous scene and into the next. Do not repeat information already covered in the previous scene.
7. Match the original language of the narration exactly (Hindi, English, etc.)
8. HONORIFICS: When referring to any religious figure, deity, guru, saint, historical king, freedom fighter, or revered personality, you MUST always use the proper respectful honorific (e.g. "Ji", "Shri", "Bhagwan", "Guru ... Ji", "Maharaj", "Sant", "Hazrat", "Lord", "Saint", etc.). Never use bare names for sacred or revered figures.

JSON SCHEMA:
{
    "narration": "the rewritten text goes here"
}

CRITICAL: Output ONLY valid JSON. No markdown code fences, no XML tags. Start your response with { and end with }.
`;

        const prevBlock = prevNarration?.trim()
            ? `--- PREVIOUS SCENE (for context — do NOT repeat this content) ---\n"${prevNarration.trim()}"\n`
            : "(This is the first scene — no previous scene.)";

        const currentBlock = currentNarration?.trim()
            ? `--- CURRENT SCENE (this is what you must rewrite) ---\n"${currentNarration.trim()}"`
            : "--- CURRENT SCENE ---\n(empty — write a new narration from scratch based on the instruction)";

        const nextBlock = nextNarration?.trim()
            ? `--- NEXT SCENE (for reference — your rewrite must flow into this) ---\n"${nextNarration.trim()}"`
            : "(This is the last scene — no next scene.)";

        const userPrompt = `You are rewriting ${sceneLabel}.

${prevBlock}

${currentBlock}

${nextBlock}

--- USER INSTRUCTION ---
"${instruction.trim()}"

Rewrite ONLY the current scene's narration following the instruction, maintaining narrative continuity with the surrounding scenes.`;

        const result = await shortsLLM.json(systemPrompt, userPrompt, {
            temperature: 0.7,
            maxTokens: 4096,
        });

        const rawText = typeof result === 'string' ? result : JSON.stringify(result);
        console.log("📤 OpenRouter rawText (first 300):", JSON.stringify(rawText.slice(0, 300)));

        // ── Extraction pipeline ────────────────────────────────────────────────
        let narration: string | null = null;

        // Strategy 1 — Direct object access (already parsed by groq.json)
        if (!narration && result?.narration && typeof result.narration === "string" && result.narration.trim()) {
            narration = result.narration.trim();
            console.log("✅ Strategy 1 succeeded, length:", narration!.length);
        }

        // Strategy 2 — Parse as string
        if (!narration && typeof result === "string") {
            try {
                const parsed = JSON.parse(result.trim());
                if (parsed?.narration && typeof parsed.narration === "string" && parsed.narration.trim()) {
                    narration = parsed.narration.trim();
                    console.log("✅ Strategy 2 succeeded, length:", narration!.length);
                }
            } catch (e: any) {
                console.log("⚠️ Strategy 2 failed:", e.message);
            }
        }

        // Strategy 3 — Regex anchored to end of string
        if (!narration) {
            const match = rawText.match(/"narration"\s*:\s*"([\s\S]+?)"\s*\}?\s*$/);
            if (match?.[1]?.trim()) {
                narration = match[1]
                    .replace(/\\n/g, " ")
                    .replace(/\\"/g, '"')
                    .replace(/\n/g, " ")
                    .trim();
                console.log("✅ Strategy 3 succeeded, length:", narration.length);
            } else {
                console.log("⚠️ Strategy 3: no regex match");
            }
        }

        // Strategy 4 — Char-by-char walk after "narration": "
        if (!narration) {
            const match = rawText.match(/"narration"\s*:\s*"([\s\S]+)/);
            if (match) {
                const rest = match[1];
                let end = -1;
                for (let i = 0; i < rest.length; i++) {
                    if (rest[i] === "\\") { i++; continue; }
                    if (rest[i] === '"')  { end = i; break; }
                }
                const extracted = end !== -1 ? rest.slice(0, end) : rest.replace(/["{}]/g, "");
                if (extracted.trim()) {
                    narration = extracted.replace(/\\n/g, " ").replace(/\n/g, " ").trim();
                    console.log("✅ Strategy 4 succeeded, length:", narration.length);
                } else {
                    console.log("⚠️ Strategy 4: extracted empty string");
                }
            } else {
                console.log("⚠️ Strategy 4: no 'narration' key found in rawText at all");
            }
        }

        if (!narration) {
            console.error("❌ All strategies failed. Full rawText:", rawText);
            throw new Error("Invalid format returned by AI");
        }

        console.log("✅ Final narration length:", narration.length);
        return NextResponse.json({ narration });

    } catch (err: any) {
        console.error("studio/enhance-scene error:", err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
