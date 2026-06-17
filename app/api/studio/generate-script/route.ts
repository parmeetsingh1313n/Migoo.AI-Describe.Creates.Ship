import { shortsLLM } from "@/lib/shorts-llm";
import { translateScript } from "@/lib/translate";
import { searchWeb, WebSource } from "@/lib/web-search";
import { NextRequest, NextResponse } from "next/server";

// POST /api/studio/generate-script
// body: { topic, contextMarkdown?, instruction?, language, seriesNiche, docImages? }
// Returns: { scriptData }
// maxDuration=300 allows the RAG search (~15s) + script LLM (~40s) to complete safely.
export const maxDuration = 300;

export async function POST(req: NextRequest) {
    try {
        const { topic, contextMarkdown, instruction, language, seriesNiche, docImages } = await req.json();

        if (!topic && !contextMarkdown) {
            return NextResponse.json({ error: "topic or contextMarkdown required" }, { status: 400 });
        }

        // Always generate in ENGLISH (Llama's strongest language for content quality)
        // Then translate to target language after generation for best results
        const lang = 'ENGLISH';
        const targetLanguage = language || 'en-IN';
        const needsTranslation = !targetLanguage.startsWith('en');
        console.log(`📝 Studio script — generating in ENGLISH, target: ${targetLanguage}, translate: ${needsTranslation}, topic: ${topic?.slice(0, 60)}`);
        const WORDS_PER_SEC = 2.5;
        const sceneCount = 6;
        const totalWordsMin = Math.ceil(88 * WORDS_PER_SEC);   // 220
        const totalWordsMax = Math.ceil(130 * WORDS_PER_SEC);  // 325

        // ── Web Research (Tavily + Wikipedia) ─────────────────────────
        let webSources: WebSource[] = [];
        let webContextBlock = "";
        let searchedAt = "";
        if (topic) {
            try {
                // skipDistillation:true — skip the 50-60s LLM distillation step.
                // The script generation LLM receives raw snippet context which is
                // sufficient; it does its own synthesis from the research.
                const research = await searchWeb(topic, { skipDistillation: true });
                webSources = research.sources;
                webContextBlock = research.contextBlock;
                searchedAt = research.searchedAt;
            } catch (err: any) {
                console.warn('⚠️ Web search failed (continuing without):', err.message);
            }
        }

        // Build context block for AI
        let contextBlock = "";
        if (contextMarkdown) {
            contextBlock = `
REFERENCE DOCUMENT (Extracted via Sarvam Document Intelligence):
---
${contextMarkdown.slice(0, 8000)}
---
${instruction ? `USER INSTRUCTION: ${instruction}` : ""}

The document above is your PRIMARY SOURCE. Base the video script on the actual facts, data, and insights from this document. Do NOT fabricate information.
`;
        }

        // Build image context for multimodal
        let imageContext = "";
        if (docImages && docImages.length > 0) {
            imageContext = `
DOCUMENT IMAGES/CHARTS: The following image URLs were extracted from the document: ${docImages.slice(0, 5).join(", ")}
If a specific chart or graph is crucial for a scene, set that scene's asset_url to the image URL and sceneCategory to "doc_image". Remotion will display the actual chart on screen.
`;
        }

        const systemPrompt = `You are a world-class viral storyteller and documentary scriptwriter. Write an engaging ENGLISH video script.

🚨 SUPER CRITICAL RULES:
1. Output ONLY a valid JSON object wrapped in <json> and </json> tags.
2. NEVER output markdown code blocks.
3. If a reference document is provided, base the script on its actual content. Be accurate.
4. Write ONLY in ENGLISH. Use clear, concise English that translates well to other languages.

🙏 HONORIFICS & CULTURAL SENSITIVITY (MANDATORY):
When mentioning ANY of the following, you MUST use the appropriate respectful honorific or title. NEVER refer to a revered figure by bare name alone:
• Sikh Gurus: Always use "Guru ... Ji" or "श्री गुरु ... जी" (e.g. "Guru Nanak Dev Ji", "श्री गुरु रामदास जी", "Guru Gobind Singh Ji")
• Hindu Deities & Avatars: Always prefix with "Bhagwan", "Shri", "Lord" etc. (e.g. "Bhagwan Shri Ram", "भगवान श्री कृष्ण", "Lord Shiva", "Mata Sita Ji", "माता पार्वती जी")
• Islamic Figures: Use "Hazrat", "Prophet (PBUH)" etc. (e.g. "Hazrat Muhammad (PBUH)", "हज़रत मुहम्मद सल्लल्लाहु अलैहि वसल्लम")
• Buddhist/Jain Figures: Use "Bhagwan", "Lord", "Tirthankar" etc. (e.g. "Bhagwan Mahavir", "Lord Buddha", "भगवान महावीर स्वामी")
• Christian Figures: Use "Lord Jesus Christ", "Saint", "Mother Mary" etc.
• Saints & Spiritual Leaders: Always add "Ji", "Sahib", "Sant", "Baba", "Swami", "Sri" etc. (e.g. "Sant Kabir Das Ji", "Swami Vivekananda Ji", "Baba Farid Ji", "संत रविदास जी")
• Historical Kings/Emperors: Use proper titles (e.g. "Maharaja Ranjit Singh Ji", "Chhatrapati Shivaji Maharaj", "महाराणा प्रताप जी")
• Freedom Fighters & National Leaders: Add respectful suffixes (e.g. "Mahatma Gandhi Ji", "Netaji Subhash Chandra Bose", "Shaheed Bhagat Singh Ji", "राष्ट्रपिता महात्मा गांधी जी")
• Any revered elder, teacher, or cultural figure: Default to adding "Ji" or the culturally appropriate suffix.
This applies in BOTH Hindi and English scripts. Disrespectful, casual, or bare-name references to sacred/revered figures are STRICTLY FORBIDDEN.

🧠 SCENE PLANNING (DO THIS MENTALLY BEFORE WRITING):
Before writing ANY narration, you MUST mentally plan 6 DISTINCT subtopics that directly relate to the video title. Each subtopic must cover a DIFFERENT aspect. For example, if the title is about "turbulent history of a city":
- Scene 1: A specific shocking event/fact (the hook)
- Scene 2: The founding/origin story with specific dates and names
- Scene 3: A specific war, battle, or political event
- Scene 4: A specific uprising, movement, or massacre with exact details
- Scene 5: A specific modern transformation or recent event
- Scene 6: Powerful emotional conclusion tying scenes 1-5 together
NEVER waste a scene on generic tourism info, food, or generic culture UNLESS the title specifically asks about those topics.

🔴 TOPIC ADHERENCE (CRITICAL):
- Every scene MUST directly relate to the video TITLE. If the title says "turbulent history", do NOT write about food, tourism, or generic travel info.
- Ask yourself for each scene: "Does this scene deliver on the PROMISE of the title?" If not, REWRITE it.
- The viewer clicked because of the title. EVERY scene must deliver on that promise.

SCRIPT REQUIREMENTS:
1. TOTAL LENGTH: 310-350 words of narration across ALL 6 scenes. Each scene MUST have 50-60 words.
2. SCENES: You MUST output an array named "scenes" containing exactly 6 scene objects.
3. NARRATION STYLE: No meta-commentary. Start directly with the hook. Each scene's narration MUST be a DENSE paragraph containing AT LEAST 5 to 7 long, extremely detailed sentences packed with SPECIFIC facts, real dates, real names, real numbers, emotions, and vivid descriptions. SHORT narrations are UNACCEPTABLE.
4. SCENE STRUCTURE (MANDATORY):
   - SCENE 1 (HOOK): Open with a jaw-dropping fact, bold claim, or provocative question. NO greetings, NO "welcome", NO "in this video".
   - SCENES 2-5 (BODY): Build the narrative with escalating intensity. Each scene MUST introduce a COMPLETELY DIFFERENT subtopic. Never repeat or rephrase.
   - SCENE 6 (CONCLUSION): Powerful, emotionally resonant conclusion. Tie together key points from scenes 1-5. End with a memorable closing line. 50-60 words.
5. IMAGE PROMPTS: For "real_entity" scenes — 30-50 word ultra-detailed photorealistic prompts (lighting, angle, texture, atmosphere, lens).
6. VIDEO PROMPTS: For ALL scenes — 30-50 word cinematic video description (camera movement, effects). NO text/titles/words in video.
7. THUMBNAIL: A stunning, text-free, click-worthy visual prompt (30-40 words). NO TEXT, NO WORDS, NO LETTERS.
8. SCENE CATEGORY:
   - "real_entity": real person, real monument, real artifact, historical site
   - "living_thing": fictional/generic people, animals
   - "general": abstract, graphics, concepts
   - "doc_image": when you assign an extracted document chart/image as the scene background
${imageContext}
9. TTS FORMATTING: No ellipses, em-dashes, en-dashes, ALL CAPS, colons, semicolons, or parentheticals. Clean short sentences only.

🔴 ANTI-REPETITION (ABSOLUTELY CRITICAL):
- NEVER repeat the same idea, phrase, or sentence across different scenes.
- BANNED phrases (NEVER use): "this place is known for its rich history", "attracts tourists from around the world", "a unique and fascinating destination", "a memorable experience", "rich history and culture", "rich history, culture and traditional cuisine"
- Each scene must contain at least 3 SPECIFIC facts (dates, names, numbers) not mentioned in any other scene.
- If you catch yourself writing a sentence similar to one in a previous scene, DELETE it and write something completely different.
- Generic summarizing sentences like "this place is very beautiful and attracts tourists" are STRICTLY FORBIDDEN.

🚨 Complete ALL 6 scenes in the scenes array.`;

        const userPrompt = `Topic: "${topic || "Summarize the key insights from the document"}"
Niche: "${seriesNiche || "general"}"
Language: ENGLISH
${contextBlock}
${webContextBlock}

IMPORTANT: Before writing, plan 6 DISTINCT subtopics for the 6 scenes. Each subtopic must cover a DIFFERENT angle directly related to the title. Do NOT repeat information across scenes. Every sentence must contain a SPECIFIC fact, date, name, or number. Generic filler is NOT acceptable.${webSources.length > 0 ? ' USE the web research results above for accurate, current facts.' : ''}

Write a complete 6-scene viral script in ENGLISH. You MUST write 310-350 words total narration. Each scene needs 50-60 words. Concise but information-dense. Output your response according to the exact requested JSON schema structure.`;

        const MAX_ATTEMPTS = 2;
        let bestResult: any = null;
        let bestWordCount = 0;

        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            try {
                const sceneSchema = {
                    type: 'object',
                    properties: {
                        narration: { type: 'string' },
                        imagePrompt: { type: 'string' },
                        videoPrompt: { type: 'string' },
                        sceneCategory: { type: 'string', enum: ['real_entity', 'living_thing', 'general', 'doc_image'] },
                        asset_url: { type: 'string', nullable: true },
                        duration: { type: 'number' },
                        wordCount: { type: 'number' },
                    },
                    required: ['narration', 'imagePrompt', 'videoPrompt', 'sceneCategory', 'duration', 'wordCount'],
                };
                const result = await shortsLLM.json(systemPrompt, userPrompt, {
                    temperature: attempt === 1 ? 0.7 : 0.8,
                    maxTokens: 8192,
                });

                // ── Normalize AI field names (models sometimes return snake_case) ──
                // videoTitle fallback: never let it be undefined or "undefined"
                if (!result.videoTitle || result.videoTitle === 'undefined') {
                    result.videoTitle = topic || 'Untitled Video';
                }
                // thumbnailPrompt: handle both flat and nested { thumbnail: { prompt } }
                if (!result.thumbnailPrompt && result.thumbnail?.prompt) {
                    result.thumbnailPrompt = result.thumbnail.prompt;
                }
                // Normalize scene fields: snake_case → camelCase
                if (result.scenes && Array.isArray(result.scenes)) {
                    result.scenes = result.scenes.map((s: any, idx: number) => ({
                        ...s,
                        sceneNumber:   s.sceneNumber   ?? idx + 1,
                        sceneCategory: s.sceneCategory ?? s.category ?? 'general',
                        imagePrompt:   s.imagePrompt   ?? s.image_prompt ?? '',
                        videoPrompt:   s.videoPrompt   ?? s.video_prompt ?? '',
                    }));
                }

                if (!result.scenes || result.scenes.length < sceneCount) continue;

                const wordCount = result.scenes.reduce(
                    (sum: number, s: any) => sum + (s.narration?.split(/\s+/).length || 0), 0
                );

                if (wordCount > bestWordCount) {
                    bestResult = result;
                    bestWordCount = wordCount;
                }

                if (wordCount >= totalWordsMin * 0.85) break;
            } catch (err: any) {
                console.error(`Script gen attempt ${attempt} failed:`, err.message);
            }
        }

        if (!bestResult) {
            return NextResponse.json({ error: "Script generation failed. Please try again." }, { status: 500 });
        }

        // Recalculate durations
        for (const scene of bestResult.scenes) {
            const words = scene.narration?.split(/\s+/).length || 0;
            scene.wordCount = words;
            scene.duration = Math.round(words / WORDS_PER_SEC);
        }
        bestResult.totalWordCount = bestWordCount;

        // ── Translate to target language if not English ─────────────────
        if (needsTranslation && bestResult.scenes?.length > 0) {
            console.log(`🌐 Translating script to ${targetLanguage}...`);
            const narrations = bestResult.scenes.map((s: any) => s.narration || '');
            const translated = await translateScript({
                videoTitle: bestResult.videoTitle,
                narrations,
                targetLanguage,
            });
            // Apply translated narrations back to scenes
            bestResult.videoTitle = translated.videoTitle;
            bestResult.scenes = bestResult.scenes.map((s: any, i: number) => ({
                ...s,
                narration: translated.narrations[i] || s.narration,
                // Recalculate word count for translated text
                wordCount: (translated.narrations[i] || s.narration).split(/\s+/).length,
                duration: Math.round((translated.narrations[i] || s.narration).split(/\s+/).length / WORDS_PER_SEC),
            }));
            bestResult.totalWordCount = bestResult.scenes.reduce(
                (sum: number, s: any) => sum + (s.wordCount || 0), 0
            );
            console.log(`✅ Translation complete — ${bestResult.totalWordCount} words in ${targetLanguage}`);
        }

        return NextResponse.json({
            scriptData: bestResult,
            webSources: webSources.length > 0 ? webSources : undefined,
            searchedAt: searchedAt || undefined,
        });
    } catch (err: any) {
        console.error("studio/generate-script error:", err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
