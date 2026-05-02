/**
 * Smart Content Sampler + Notes Generator
 *
 * Uses a TIERED MODEL STRATEGY to automatically adapt to rate limits:
 *
 *  Tier 1 — llama-3.3-70b-versatile  (high quality, ~12K TPM free tier)
 *            Content: up to 18K chars ≈ 4.5K tokens
 *            Output:  up to 7K tokens
 *            Total:   ~11.5K tokens (safely under 12K TPM)
 *
 *  Tier 2 — llama-3.1-8b-instant     (250K TPM free tier, 131K context)
 *            Content: up to 60K chars ≈ 15K tokens
 *            Output:  up to 8K tokens
 *            Total:   ~23K tokens (well under 250K TPM)
 *            Triggered automatically when Tier 1 hits a 413/429 error.
 *
 * Sampling strategy:
 *   • First N chars  — intro, objectives, TOC
 *   • Section excerpts evenly distributed through the middle
 *   • Last M chars   — conclusion, future scope, references
 */

// ─── Model Tiers ──────────────────────────────────────────────────────────────

interface ModelTier {
    model: string;
    maxContentChars: number;   // chars sent as input
    maxOutputTokens: number;   // max_tokens for completion
    headChars: number;
    tailChars: number;
    minCharsPerSection: number;
}

const TIERS: ModelTier[] = [
    {
        // Tier 1: High-quality 70B — safe for free tier (≤12K TPM)
        model: "llama-3.3-70b-versatile",
        maxContentChars: 16_000,
        maxOutputTokens: 5_500,
        headChars: 2_500,
        tailChars: 1_200,
        minCharsPerSection: 500,
    },
    {
        // Tier 2: Fast 8B — 250K TPM, handles large docs easily
        model: "llama-3.1-8b-instant",
        maxContentChars: 55_000,
        maxOutputTokens: 6_500,
        headChars: 5_000,
        tailChars: 2_500,
        minCharsPerSection: 1_000,
    },
];

// ─── Smart Content Sampler ────────────────────────────────────────────────────

/**
 * Detect section headings in the document.
 * Headings are lines that are: short (<80 chars), not purely punctuation,
 * and look like titles (ALL CAPS, Title Case, or prefixed with # / numbers).
 */
function detectHeadings(content: string): number[] {
    const lines = content.split("\n");
    const headingPositions: number[] = [];
    let charPos = 0;

    for (const line of lines) {
        const trimmed = line.trim();
        if (
            trimmed.length > 2 &&
            trimmed.length < 80 &&
            !/^[.\-_*=]+$/.test(trimmed) &&
            (
                /^#{1,4}\s/.test(trimmed) ||
                /^\d+[\.]\s+[A-Z]/.test(trimmed) ||
                /^[A-Z][A-Z\s]{4,}$/.test(trimmed) ||
                /^[A-Z][a-z]+(\s[A-Z][a-z]+){1,6}$/.test(trimmed)
            )
        ) {
            headingPositions.push(charPos);
        }
        charPos += line.length + 1;
    }

    return headingPositions;
}

/**
 * Sample a document to fit within `maxContentChars`.
 * Takes a generous head + detected sections (each up to minCharsPerSection) + tail.
 */
function smartSample(content: string, tier: ModelTier): string {
    if (content.length <= tier.maxContentChars) {
        return content;
    }

    const { headChars, tailChars, maxContentChars, minCharsPerSection } = tier;
    const middleBudget = maxContentChars - headChars - tailChars;

    const head = content.substring(0, headChars);
    const bodyContent = content.substring(headChars, content.length - tailChars);
    const headingPositions = detectHeadings(bodyContent);

    let middleSection = "";

    if (headingPositions.length > 0) {
        const charsPerSection = Math.max(
            minCharsPerSection,
            Math.floor(middleBudget / headingPositions.length)
        );
        const sections: string[] = [];

        for (let i = 0; i < headingPositions.length; i++) {
            const sectionStart = headingPositions[i];
            const excerpt = bodyContent.substring(sectionStart, sectionStart + charsPerSection);
            sections.push(excerpt.trim());

            if (sections.join("\n\n---\n\n").length > middleBudget) break;
        }

        middleSection = sections.join("\n\n---\n\n");
        console.log(`  📑 Found ${headingPositions.length} sections → ${sections.length} sampled, ${charsPerSection} chars each`);
    } else {
        const numSamples = 20;
        const step = Math.floor(bodyContent.length / (numSamples + 1));
        const sampleSize = Math.floor(middleBudget / numSamples);
        const parts: string[] = [];
        for (let i = 1; i <= numSamples; i++) {
            parts.push(bodyContent.substring(i * step, i * step + sampleSize));
        }
        middleSection = parts.join("\n\n---\n\n");
        console.log(`  📑 No headings found — ${numSamples} evenly-spaced samples`);
    }

    const tail = content.substring(content.length - tailChars);
    const sampled = [head, "\n---\n", middleSection, "\n---\n", tail].join("\n");
    console.log(`  📊 Sampled: ${content.length} → ${sampled.length} chars (head:${headChars} + sections + tail:${tailChars})`);
    return sampled;
}

// ─── Groq Direct Call ─────────────────────────────────────────────────────────

async function callGroqDirect(
    systemPrompt: string,
    userInput: string,
    model: string,
    maxTokens: number,
    retries = 3,
    preferredKeyIndex = 0,
): Promise<any> {
    const apiKeys = (process.env.GROQ_API_KEYS || process.env.GROQ_API_KEY || "")
        .split(",").map(k => k.trim()).filter(Boolean);

    if (apiKeys.length === 0) throw new Error("No GROQ API keys configured");

    let keyIndex = preferredKeyIndex % apiKeys.length;
    let lastError: any = null;

    for (let attempt = 0; attempt < retries; attempt++) {
        const apiKey = apiKeys[keyIndex % apiKeys.length];

        try {
            const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${apiKey}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    model,
                    messages: [
                        { role: "system", content: systemPrompt },
                        { role: "user", content: userInput },
                    ],
                    temperature: 0.55,
                    max_tokens: maxTokens,
                    response_format: { type: "json_object" },
                    stream: false,
                }),
                signal: AbortSignal.timeout(180_000),
            });

            if (!response.ok) {
                const errText = await response.text();
                const isRateLimit = response.status === 429 ||
                    errText.includes("rate_limit") ||
                    errText.includes("tokens per minute");
                const isTooLarge = response.status === 413 ||
                    errText.includes("too large") ||
                    errText.includes("Request too large");

                if ((isRateLimit || isTooLarge) && attempt < retries - 1) {
                    if (isTooLarge) {
                        // Signal caller to try next tier — throw a special error
                        throw Object.assign(
                            new Error(`TOO_LARGE: ${errText}`),
                            { isTooLarge: true }
                        );
                    }
                    const retryMatch = errText.match(/try again in ([\d.]+)s/i);
                    const waitMs = retryMatch
                        ? Math.ceil(parseFloat(retryMatch[1]) * 1000) + 1000
                        : 12_000;
                    keyIndex = (keyIndex + 1) % apiKeys.length;
                    console.log(`  🔄 Rate limit → key ${keyIndex + 1}, waiting ${Math.ceil(waitMs / 1000)}s...`);
                    await new Promise(r => setTimeout(r, waitMs));
                    continue;
                }

                throw new Error(`Groq API error (${response.status}): ${errText}`);
            }

            const data = await response.json();
            const content = data.choices?.[0]?.message?.content?.trim() || "";
            if (!content) throw new Error("Empty response from Groq");

            const jsonStart = content.search(/[{[]/);
            if (jsonStart === -1) throw new Error("No JSON in response");

            try {
                return JSON.parse(content.substring(jsonStart));
            } catch {
                // Try to fix trailing commas
                const fixed = content.substring(jsonStart).replace(/,(\s*[}\]])/g, "$1");
                return JSON.parse(fixed);
            }

        } catch (err: any) {
            lastError = err;

            // Bubble up TOO_LARGE immediately — caller will switch tiers
            if (err.isTooLarge) throw err;

            const isRateLimit = err.message?.includes("rate_limit") ||
                err.message?.includes("429") ||
                err.message?.includes("tokens per minute");

            if (attempt < retries - 1) {
                keyIndex = (keyIndex + 1) % apiKeys.length;
                const wait = isRateLimit ? 12_000 : 3_000;
                console.log(`  🔄 Error (attempt ${attempt + 1}), rotating to key ${keyIndex + 1}, waiting ${wait / 1000}s...`);
                await new Promise(r => setTimeout(r, wait));
                continue;
            }
        }
    }

    throw lastError || new Error("All retries exhausted");
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function generateNotesWithChunking(
    contentContext: string,
    title: string,
    style: string,
    styleGuide: string,
    assetEmbedInstructions: string,
): Promise<any> {
    console.log(`\n📐 Content: ${contentContext.length} chars`);

    const buildPrompts = (sampledContent: string) => {
        const systemPrompt = `You are an expert note-taking assistant. Generate beautifully structured study notes as a JSON object.

OUTPUT FORMAT (${style} style):
${styleGuide}

Also include at the top level:
- "title": the note title
- "generatedAt": current ISO timestamp
- "wordCount": approximate word count
- "readingTime": estimated reading time in minutes
${assetEmbedInstructions ? '- "embeddedAssets": array of { "assetIndex": number, "placement": string, "caption": string }' : ""}

IMPORTANT: The content below is sampled from a larger document. Generate COMPREHENSIVE notes that cover ALL major topics visible in the excerpts. Be detailed — every section should have rich, full-sentence content.

Return ONLY valid JSON. No markdown. Start with { and end with }.`;

        const userInput = `TOPIC: "${title}"

DOCUMENT CONTENT (sampled excerpts):
${sampledContent}
${assetEmbedInstructions}`;

        return { systemPrompt, userInput };
    };

    // ── Tiered model strategy ─────────────────────────────────────────────────
    for (let tierIdx = 0; tierIdx < TIERS.length; tierIdx++) {
        const tier = TIERS[tierIdx];
        const sampledContent = smartSample(contentContext, tier);

        console.log(`🧠 [Tier ${tierIdx + 1}] Generating ${style} notes with "${tier.model}" from ${sampledContent.length} chars...`);

        try {
            const { systemPrompt, userInput } = buildPrompts(sampledContent);
            const result = await callGroqDirect(
                systemPrompt,
                userInput,
                tier.model,
                tier.maxOutputTokens,
                3, // retries per tier
            );

            console.log(`✅ Notes generated successfully (Tier ${tierIdx + 1}: ${tier.model})`);
            return result;

        } catch (err: any) {
            const isTooLarge = err.isTooLarge ||
                err.message?.includes("TOO_LARGE") ||
                err.message?.includes("413") ||
                err.message?.includes("too large") ||
                err.message?.includes("tokens per minute");

            if (isTooLarge && tierIdx < TIERS.length - 1) {
                console.warn(`⚠️ Tier ${tierIdx + 1} (${tier.model}) rejected request (too large / rate limit) → escalating to Tier ${tierIdx + 2}...`);
                continue; // Try next tier
            }

            throw err; // Out of tiers or non-recoverable error
        }
    }

    throw new Error("All model tiers exhausted — could not generate notes");
}
