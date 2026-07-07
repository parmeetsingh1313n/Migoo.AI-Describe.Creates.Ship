/**
 * Motion Graphics Chat API
 * POST: Send a user message, get AI response with scene understanding
 */

import { motionGraphicsLLM } from "@/lib/motion-graphics-llm";
import { db } from "@/config/db";
import { motionGraphicMessages, motionGraphicProjects } from "@/config/schema";
import { currentUser } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

/** Retry a DB call up to `attempts` times with exponential backoff */
async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
    let delay = 500;
    for (let i = 0; i < attempts; i++) {
        try {
            return await fn();
        } catch (err: any) {
            const isRetryable = /ECONNRESET|fetch failed|timeout|connect|UND_ERR/i.test(err?.message || err?.cause?.message || '');
            if (!isRetryable || i === attempts - 1) throw err;
            console.warn(`⚠️ [mg-chat] DB retry ${i + 1}/${attempts - 1} in ${delay}ms: ${(err.message || '').slice(0, 80)}`);
            await new Promise(r => setTimeout(r, delay));
            delay *= 2;
        }
    }
    throw new Error('unreachable');
}

const MOTION_GRAPHIC_SYSTEM_PROMPT = `[ignoring loop detection]
You are a world-class motion graphics director and cinematic copywriter. You create premium, high-impact promotional videos that feel like Apple keynotes and Nike commercials.

--- CORE CONTENT RULES ---
1. REAL CONTENT ONLY: Every word must be product-specific and authentic. No placeholders, no generic filler.
2. NO SCENE TYPE REPETITION: Each scene type appears exactly once.
3. ICON NAMES: Lucide PascalCase only — Rocket, Zap, Shield, Globe, Cpu, Mic, Video, Layers, Star, TrendingUp, Heart, Users, Sparkles, Trophy, Crown, Bolt.
4. DURATION: 3s for punch/impact scenes. 4-5s for feature/content scenes. 6s for comparison/metrics. NEVER below 3s. NEVER exceed 180s total.
5. COLORS: Do NOT set a "colors" field on scenes. The video has a global theme palette the user chose separately — every scene inherits it automatically. Only include "colors" (plus "customColors":true) on a scene if the user's message explicitly asks to recolor/customize that specific scene.

--- VOICEOVER: CINEMATIC EXCELLENCE REQUIRED ---
You are a MOVIE TRAILER VOICE ACTOR. Every voiceoverLine must be a COMPLETE, FLOWING, POWERFUL sentence that narrates exactly what the viewer sees on screen.

Word count: 3 words per second. 3s = 9-12 words. 4s = 12-16 words. 5s = 15-20 words. 6s = 18-24 words.

BANNED (never write these):
- Sentence fragments with no verb
- "The future is here/now" — overused cliche
- "AI powers [X]" — flat and lifeless  
- Disconnected word lists like "Create. Publish. Dominate."
- Any line under 8 words
- Starting 3 consecutive lines with the same word

REQUIRED TECHNIQUES:
- CONTRAST: "While others spend three hours in a timeline editor, you have already published and gone viral."
- ESCALATION: "First they notice. Then they stop scrolling. Then they share with everyone they know."
- VIVID VERBS: explodes, shatters, ignites, commands, transforms, obliterates, dominates, launches, revolutionizes
- SENSORY: Describe what the viewer sees, feels, experiences in that exact scene
- RHYTHM: One short punchy sentence. Then a longer wave that builds and carries emotion forward.
- SPECIFICITY: Exact numbers, real product names, real feature names — always

EXAMPLES:
BAD: "Migoo emerges, AI video creation platform"
GOOD: "From the darkness, a revolution takes form — Migoo, the AI engine that transforms a single idea into a cinematic masterpiece in under sixty seconds."

BAD: "Create viral videos in seconds, not hours"
GOOD: "While your competitor spends three exhausting hours in a timeline editor, your Migoo video has already been watched, shared, and saved by ten thousand people."

BAD: "100,000 videos created and counting"
GOOD: "Watch the counter spin past one hundred thousand — one hundred thousand creators who chose to stop editing and start dominating."

BAD: "Creator discovers the ultimate video tool"
GOOD: "She switched to Migoo on a Tuesday. By Friday, her video had half a million views and her words say it all: this is the best creative tool I have ever used."

--- ASSET PLACEMENT: MANDATORY ---
6. You will receive an UPLOADED ASSETS TABLE. Each row has: Category | Blob URL | Groq Vision Analysis | Target Scene Types.
7. For EVERY asset in the table: set imageUrl to that EXACT Blob URL in the specified target scene type. Leaving any asset unused is a critical failure.
8. Logo assets → logo_reveal (Scene 1) AND call_to_action (final scene). Both scenes must have the logo URL in imageUrl.
9. Screenshot/UI assets → browser_mockup or phone_mockup. Set imageUrl to the exact screenshot Blob URL.
10. Priority: Uploaded asset URL beats AI-generated image. Never leave imageUrl empty when an asset is available for that scene type.

--- CONTENT DEPTH RULES ---
11. COMPARISON: Minimum 4 detailed points per side. Make "before" sound painful, "after" sound euphoric.
12. TESTIMONIAL: Specific person, specific numbers ("847K views in 4 days"), emotional direct quote.
13. METRICS: Aspirational but realistic. Show the transformation with before and after numbers.
14. FEATURE LIST: Punchy action labels ("Generates Cinema-Grade Scripts in 8 Seconds" not just "Script Generator").
15. PROCESS STEPS: Each step sounds like a RELIEF — easy, exciting, inevitable.

SCENE TYPES: logo_reveal, title_reveal, split_hero, video_hero, bento_grid, neon_glow, gradient_burst, phone_mockup, browser_mockup, search_reveal, feature_list, stat_counter, metric_dashboard, comparison, image_showcase, timeline, process_steps, testimonial, notification_stack, code_terminal, glass_card, quote_reveal, kinetic_text, call_to_action, icon_grid

JSON FORMAT:
{"scenes":[{"type":"...","headline":"...","subtext":"...","imageUrl":"","durationSec":5,"voiceoverLine":"...","items":[],"stat":null,"content":"","query":""}],"voiceoverLines":["line1","line2","..."]}
Do NOT include a "colors" field unless the user explicitly asked to customize that scene's colors — see rule 5.

For items-based scenes, include "items":[{"icon":"...","label":"...","value":"..."}].
For stat_counter: "stat":{"value":100000,"suffix":"+","label":"..."}.
For comparison: "items":[{"label":"Before","value":"point1, point2, point3, point4"},{"label":"After","value":"point1, point2, point3, point4"}].
For code_terminal: code in "content". For testimonial: quote in "content", name in "subtext".`;


export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ projectId: string }> }
) {
    try {
        const user = await currentUser();
        if (!user?.primaryEmailAddress?.emailAddress) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { projectId } = await params;
        const { message, mode, targetSceneIndex } = await req.json();

        if (!message || typeof message !== "string" || message.trim().length < 1) {
            return NextResponse.json({ error: "Message is required" }, { status: 400 });
        }

        // Explicit chat mode from the scene selector dropdown (optional, backward compatible):
        //   'edit' + targetSceneIndex → deterministic patch of that one scene
        //   'add'                     → append exactly one new best-fit scene
        //   'create' / undefined      → full-video generation (legacy behaviour)
        const chatMode: 'create' | 'add' | 'edit' | undefined =
            mode === 'edit' || mode === 'add' || mode === 'create' ? mode : undefined;
        const targetIdx = Number.isInteger(targetSceneIndex) ? targetSceneIndex : null;

        // Verify project ownership
        console.log(`[CHAT] Checking project ownership. projectId: ${projectId}, userId: ${user.primaryEmailAddress.emailAddress}`);

        const [project] = await withRetry(() =>
            db.select()
              .from(motionGraphicProjects)
              .where(
                  and(
                      eq(motionGraphicProjects.projectId, projectId),
                      eq(motionGraphicProjects.userId, user.primaryEmailAddress!.emailAddress)
                  )
              )
        );

        if (!project) {
            console.error(`[CHAT] 404 Not Found. Project ${projectId} does not exist for user ${user.primaryEmailAddress.emailAddress}`);
            return NextResponse.json({ error: "Project not found" }, { status: 404 });
        }

        // Save user message
        await withRetry(() =>
            db.insert(motionGraphicMessages).values({
                projectId,
                role: "user",
                content: message.trim(),
            })
        );

        // Build conversation context — keep last 4 non-system messages to limit tokens
        const existingMessages = await db
            .select()
            .from(motionGraphicMessages)
            .where(eq(motionGraphicMessages.projectId, projectId));

        // Build conversation context — keep last 4 non-system/non-assets messages to limit tokens
        const recentMessages = existingMessages
            .filter((m) => m.role !== "system" && m.role !== "assets")
            .slice(-4);

        const conversationContext = recentMessages
            .map((m) => {
                const content = m.content.length > 400 ? m.content.substring(0, 400) + "..." : m.content;
                return `${m.role === "user" ? "User" : "Assistant"}: ${content}`;
            })
            .join("\n\n");

        // ── Asset table for model — clean markdown table, URL is the key ──
        // Read assets from the dedicated 'role: assets' DB message (stores Groq Vision analysis).
        // Exclude per-scene-locked assets (sceneIndex set) — those are bound to a specific
        // scene via the scene-asset upload flow and must NOT be re-placed by category guessing.
        const assetsMsg = existingMessages.find(m => m.role === "assets");
        const uploadedAssets: { url: string; name: string; description: string; category?: string }[] =
            ((assetsMsg?.metadata as any)?.assets || []).filter((a: any) => a.sceneIndex == null);

        let assetBlock = '';
        if (uploadedAssets.length > 0) {
            const rows = uploadedAssets.map((a, i) => {
                const targetHint =
                    a.category === 'logo'       ? 'logo_reveal, call_to_action' :
                    a.category === 'screenshot' ? 'browser_mockup, phone_mockup' :
                    a.category === 'product'    ? 'image_showcase, split_hero, video_hero' :
                    a.category === 'person'     ? 'testimonial, split_hero' :
                                                  'logo_reveal, browser_mockup, image_showcase';
                return `| Asset ${i + 1} | ${a.category || 'other'} | ${a.url} | ${a.description} | ${targetHint} |`;
            }).join('\n');

            assetBlock = `

UPLOADED ASSETS TABLE — SET imageUrl TO THE EXACT URL FOR THE SPECIFIED SCENE TYPE:
| # | Category | Blob URL (use as imageUrl) | Groq Vision Analysis | Target Scene Types |
|---|----------|---------------------------|----------------------|--------------------|
${rows}

INSTRUCTION: For each row, find the matching scene type in your output and set its imageUrl field to the Blob URL in that row. This is MANDATORY — every asset must appear in the video.`;
        }

        // Summarize scene data instead of dumping full JSON
        let scenesSummary = "No scenes generated yet.";
        if (project.sceneData && Array.isArray(project.sceneData) && project.sceneData.length > 0) {
            const existing = project.sceneData as any[];
            // Include imageUrl status so LLM knows which scenes already have assets and must preserve them
            const sceneList = existing.map((s: any, i: number) =>
                `  ${i + 1}. ${s.type}${s.imageUrl ? ' [HAS_IMAGE — keep imageUrl]' : ''}: "${(s.headline || s.content || '').slice(0, 60)}"`
            ).join('\n');
            scenesSummary = `${existing.length} scenes already exist. When making targeted changes, ONLY modify what the user asks for and PRESERVE all other scenes and their imageUrl fields exactly.\n${sceneList}`;
        }

        const projectContext = `PROJECT DETAILS:
- Duration: ${project.duration} seconds
- Aspect Ratio: ${project.aspectRatio}
- Voiceover: ${project.voiceoverEnabled ? "Enabled" : "Disabled"}
- Music: ${project.music}
- Theme: ${project.theme ? JSON.stringify(project.theme) : "Not set"}
- Scenes: ${scenesSummary}`;

        const trimmedMessage = message.trim();

        // ── Detect partial vs full update ────────────────────────────────────
        // Partial: user references specific scenes without a full numbered scene list
        // Full:    user provides "1. logo_reveal\n2. title_reveal..." numbered list
        const sceneNums = [...trimmedMessage.matchAll(/^(\d+)\./gm)].map(m => parseInt(m[1], 10));
        const explicitSceneCount = sceneNums.length > 0 ? Math.max(...sceneNums) : 0;
        const useChunked = explicitSceneCount > 5;

        const existingScenes = (project.sceneData as any[] | null) || [];
        const hasExistingScenes = existingScenes.length > 0;

        // Pattern 1: explicit scene/slide number ("scene 3", "3rd slide")
        const SCENE_NUM_RE  = /\b(?:scene|slide|card)\s+\d+\b|\b\d+(?:st|nd|rd|th)\s+(?:scene|slide)\b/i;
        // Pattern 2: semantic scene TYPE reference ("logo", "hero", "call to action", "animation"...)
        const SCENE_TYPE_RE = /\b(?:logo|opening|intro|outro|title|headline|call[\s-]?to[\s-]?action|cta|hero|background|testimonial|feature|comparison|metric|counter|browser|phone|mockup|terminal|timeline|process|notification|floating|glass|quote|search|bento|icon|animation|voiceover|narration)\b/i;
        // Refinement INTENT: user wants to change something (not just asking a question)
        const REFINEMENT_RE = /\b(?:change|update|modify|edit|animate|improve|make|fix|add|remove|replace|adjust|enhance|show|put|set|use|rewrite|rephrase|shorten|lengthen|give|try|want|need)\b/i;

        const hasSceneNumRef  = SCENE_NUM_RE.test(trimmedMessage);
        const hasSemanticRef  = SCENE_TYPE_RE.test(trimmedMessage) && REFINEMENT_RE.test(trimmedMessage);

        // Explicit-mode targeting from the dropdown takes priority over regex heuristics.
        const validTargetIdx = targetIdx !== null && targetIdx >= 0 && targetIdx < existingScenes.length ? targetIdx : null;
        const forceEdit = chatMode === 'edit' && validTargetIdx !== null;
        const forceAdd  = chatMode === 'add' && hasExistingScenes;

        const isPartialUpdate = forceEdit || (
            !forceAdd && chatMode !== 'create' && !useChunked && explicitSceneCount === 0 && hasExistingScenes
            && (hasSceneNumRef || hasSemanticRef)
        );

        let aiResponse: any;
        let changedSceneIndices: number[]    = [];
        let animationRequestedIndices: number[] = [];

        if (forceAdd) {
            // ── ADD MODE: generate exactly ONE new scene and append it ───────
            console.log(`[mg-chat] Add-scene mode — appending 1 new scene to ${existingScenes.length}`);
            const existingTypes = existingScenes.map((s: any) => s.type).join(', ');
            const single = await motionGraphicsLLM.json(
                MOTION_GRAPHIC_SYSTEM_PROMPT,
                `${projectContext}${assetBlock}\n\nThe video already has ${existingScenes.length} scenes (types: ${existingTypes}).\n` +
                `The user wants to ADD ONE NEW SCENE. Pick the single best-fit scene type for this request and design ONLY that one scene. Do NOT regenerate or return the existing scenes.\n\n` +
                `User: ${trimmedMessage}\n\n` +
                `Output JSON: { "reply": "your short message", "scenesJson": { "scenes": [ ONE_NEW_SCENE_OBJECT ], "voiceoverLines": ["line for the new scene"] } }`,
                { temperature: 0.8, maxTokens: 4096 }
            );
            const newScenes: any[] = single?.scenesJson?.scenes || single?.scenes || [];
            if (newScenes.length > 0) {
                const appended = [...existingScenes, newScenes[0]];
                changedSceneIndices = [appended.length - 1];
                aiResponse = {
                    reply: single?.reply || `Added a new ${newScenes[0].type?.replace(/_/g, ' ')} scene as Scene ${appended.length}.`,
                    scenesJson: { scenes: appended, voiceoverLines: appended.map((s: any) => s.voiceoverLine).filter(Boolean) },
                };
            } else {
                aiResponse = { reply: single?.reply || "I couldn't design that scene — could you add a bit more detail?", scenesJson: null };
            }

        } else if (isPartialUpdate) {
            // ── PATCH MODE: only update what the user specified ──────────────
            console.log(`[mg-chat] Partial update detected — using patch mode${forceEdit ? ` (targeting Scene ${validTargetIdx! + 1})` : ''}`);
            // When the dropdown selected a specific scene, name it explicitly so the
            // patch model edits exactly that scene regardless of the user's phrasing.
            const patchRequest = forceEdit
                ? `Apply this change to Scene ${validTargetIdx! + 1} (type: ${existingScenes[validTargetIdx!]?.type}) ONLY: ${trimmedMessage}`
                : trimmedMessage;
            const patchResult = await motionGraphicsLLM.patch(
                existingScenes,
                patchRequest,
                assetBlock,
            );

            // Apply patches to a deep copy of existing scenes
            const patchedScenes = existingScenes.map((s: any) => ({ ...s }));
            for (const p of patchResult.patches) {
                // Strip control flags from scene data — they are pipeline signals, not display fields
                const { animationRequested, animationType, ...sceneUpdates } = p.updates;
                patchedScenes[p.index] = { ...patchedScenes[p.index], ...sceneUpdates };

                // Preserve animationType on the scene so Inngest knows which animation style to use
                if (animationType) patchedScenes[p.index].animationType = animationType;

                // A user-requested color patch locks this scene to its own colors —
                // the render only honors scene.colors when customColors is set,
                // so every deliberate recolor must flip this flag too.
                if (sceneUpdates.colors) patchedScenes[p.index].customColors = true;

                changedSceneIndices.push(p.index);
                if (animationRequested === true) {
                    animationRequestedIndices.push(p.index);
                    console.log(`🎬 [mg-chat] Animation requested for scene ${p.index + 1} (${patchedScenes[p.index].type}) — type: ${animationType || 'cinematic_pan'}`);
                }
            }

            aiResponse = {
                reply: patchResult.reply,
                scenesJson: patchResult.patches.length > 0
                    ? { scenes: patchedScenes, voiceoverLines: patchedScenes.map((s: any) => s.voiceoverLine).filter(Boolean) }
                    : null,
            };

            console.log(`[mg-chat] Patch applied to scene indices: [${changedSceneIndices.join(', ')}]`);

        } else if (useChunked) {
            console.log(`[mg-chat] ${explicitSceneCount} explicit scenes detected — using chunked mode (4 per batch)`);
            aiResponse = await motionGraphicsLLM.jsonChunked(
                MOTION_GRAPHIC_SYSTEM_PROMPT,
                `${projectContext}${assetBlock}\n\nCONVERSATION HISTORY:\n${conversationContext}\n\nUser: ${trimmedMessage}\n\nRespond as the assistant. Generate ALL scenes from the user specification.`,
                { temperature: 0.8, scenesPerChunk: 4 }
            );
            aiResponse = { reply: `Your ${aiResponse.scenes?.length || 0} scenes are ready! Check the storyboard on the right. Pick a theme and hit Generate when you're happy.`, scenesJson: aiResponse };
        } else {
            aiResponse = await motionGraphicsLLM.json(
                MOTION_GRAPHIC_SYSTEM_PROMPT,
                `${projectContext}${assetBlock}\n\nCONVERSATION HISTORY:\n${conversationContext}\n\nUser: ${trimmedMessage}\n\nRespond as the assistant. If the user is ready for scenes or you think you have enough context, include a scenes JSON block. Output your response as JSON: { "reply": "your message", "scenesJson": null_or_object }`,
                { temperature: 0.8, maxTokens: 8192 }
            );
        }

        let replyText = aiResponse.reply || aiResponse.message || "I'd love to help! Could you tell me more about what you'd like to create?";
        let scenesData = aiResponse.scenesJson || null;

        // Sanitize technical jargon from the AI reply — users should never see words like "JSON"
        replyText = replyText
            .replace(/\bjson\b/gi, '')
            .replace(/\bscenes? (json|data|object|block)\b/gi, 'scenes')
            .replace(/\b(project details|conversation history|I have received)\b/gi, '')
            .replace(/please find (the |below|above)/gi, '')
            .replace(/\s{2,}/g, ' ')
            .trim();

        // If scenes were generated but reply is empty/generic, provide a friendly default
        if (scenesData?.scenes && (!replyText || replyText.length < 10)) {
            replyText = `Your ${scenesData.scenes.length} scenes are ready! Check them out on the right. Pick a theme and hit Generate when you're happy with the storyboard.`;
        }

        // ── Server-side asset re-injection (guaranteed) ─────────────────────
        // After every LLM response, forcefully inject uploaded asset URLs back
        // into the correct scene slots. This prevents the LLM from ever silently
        // losing the user's brand logo or screenshot during refinement passes.
        // We do NOT overwrite if the scene already has an animated Kling video URL.
        if (scenesData?.scenes && uploadedAssets.length > 0) {
            const LOGO_TYPES   = new Set(['logo_reveal', 'call_to_action']);
            const SCREEN_TYPES = new Set(['browser_mockup', 'phone_mockup', 'bento_grid', 'image_showcase', 'split_hero', 'video_hero']);
            const claimed      = new Set<number>();

            for (const asset of uploadedAssets) {
                const cat = (asset.category || '').toLowerCase();
                let targets: Set<string>;
                if (cat === 'logo')      targets = LOGO_TYPES;
                else if (['screenshot', 'product', 'person'].includes(cat)) targets = SCREEN_TYPES;
                else targets = new Set([...LOGO_TYPES, ...SCREEN_TYPES]);

                // Helper to check if url is a Kling-generated/preserved video
                const isVideo = (url: string | undefined): boolean => {
                    if (!url) return false;
                    return url.endsWith('.mp4') || url.endsWith('.webm') || url.includes('video-files');
                };

                // Inject into first matching unoccupied scene slot
                let injected = false;
                for (let i = 0; i < scenesData.scenes.length; i++) {
                    if (!targets.has(scenesData.scenes[i].type)) continue;
                    if (claimed.has(i)) continue;
                    if (scenesData.scenes[i].userAsset) continue; // locked to a per-scene upload — never overwrite

                    const currentUrl = scenesData.scenes[i].imageUrl;
                    if (isVideo(currentUrl)) {
                        console.log(`[mg-chat] 🎬 Preserving video for Scene ${i + 1} (${scenesData.scenes[i].type}) — skipping static [${cat}] re-injection`);
                        claimed.add(i);
                        injected = true;
                        break;
                    }

                    scenesData.scenes[i] = { ...scenesData.scenes[i], imageUrl: asset.url };
                    claimed.add(i);
                    injected = true;
                    console.log(`[mg-chat] ✅ Re-injected [${cat}] asset → Scene ${i + 1} (${scenesData.scenes[i].type})`);
                    break;
                }

                // Fallback: widen to any visual scene type
                if (!injected) {
                    for (let i = 0; i < scenesData.scenes.length; i++) {
                        if (claimed.has(i)) continue;
                        if (scenesData.scenes[i].userAsset) continue; // locked to a per-scene upload — never overwrite

                        const currentUrl = scenesData.scenes[i].imageUrl;
                        if (isVideo(currentUrl)) {
                            console.log(`[mg-chat] 🎬 Preserving video for Scene ${i + 1} (${scenesData.scenes[i].type}) (fallback)`);
                            claimed.add(i);
                            break;
                        }

                        scenesData.scenes[i] = { ...scenesData.scenes[i], imageUrl: asset.url };
                        claimed.add(i);
                        console.log(`[mg-chat] ✅ Re-injected [${cat}] asset (fallback) → Scene ${i + 1} (${scenesData.scenes[i].type})`);
                        break;
                    }
                }
            }
        }

        if (scenesData?.scenes) {
            // Enforce minimum 3s per scene — prevents scenes from flashing too fast
            scenesData.scenes = scenesData.scenes.map((s: any) => ({
                ...s,
                durationSec: Math.max(3, Number(s.durationSec) || 3),
            }));
            const calculatedDuration = scenesData.scenes.reduce((sum: number, s: any) => sum + (Number(s.durationSec) || 5), 0);

            // Large payload — retry on transient Neon timeouts
            await withRetry(() =>
                db.update(motionGraphicProjects)
                  .set({
                      sceneData:       scenesData.scenes,
                      duration:        calculatedDuration > 0 ? calculatedDuration : project.duration,
                      voiceoverScript: scenesData.voiceoverLines?.join("\n") || null,
                      status:          "draft",
                      videoUrl:        null,
                      remotionProps:   null,
                      updatedAt:       new Date(),
                  })
                  .where(eq(motionGraphicProjects.projectId, projectId))
            );
        }

        // Save assistant message — include changedSceneIndices + animationRequestedIndices for Inngest
        await withRetry(() =>
            db.insert(motionGraphicMessages).values({
                projectId,
                role: "assistant",
                content: replyText,
                metadata: scenesData
                    ? {
                        type: changedSceneIndices.length > 0 ? "scene_patch" : "scene_update",
                        sceneData: scenesData,
                        changedSceneIndices,
                        animationRequestedIndices, // ← Inngest reads this to run GPT-120b Kling prompts
                    }
                    : null,
            })
        );

        return NextResponse.json({
            success: true,
            reply: replyText,
            scenesData,
        });
    } catch (error: any) {
        console.error("❌ Chat error:", error);
        return NextResponse.json(
            { error: error.message || "Failed to generate response" },
            { status: 500 }
        );
    }
}
