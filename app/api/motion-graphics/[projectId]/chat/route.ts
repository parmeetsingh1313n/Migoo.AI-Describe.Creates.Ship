/**
 * Motion Graphics Chat API
 * POST: Send a user message, get AI response with scene understanding
 */

import { aiFallback } from "@/config/ai-fallback";
import { db } from "@/config/db";
import { motionGraphicMessages, motionGraphicProjects } from "@/config/schema";
import { currentUser } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

const MOTION_GRAPHIC_SYSTEM_PROMPT = `You are a motion graphics director. Generate cinematic video scenes.

RULES:
1. Use REAL product-specific content, never generic placeholders.
2. Never repeat the same scene type.
3. For "icon" fields: use Lucide PascalCase names (Rocket, Zap, Shield, Globe, Cpu, Mic, Video, Music, Layers) or Emojis.
4. VOICEOVER SYNC RULE: Each voiceoverLine must NARRATE what the viewer is SEEING on screen in that scene — with energy and passion like a movie trailer narrator.
   - For a logo_reveal showing "Migoo": "Watch as the Migoo logo emerges from pure darkness, a beacon of creative revolution illuminating your screen."
   - For a feature_list with AI Scripting, Voice, Design: "Behold the full arsenal — AI-powered scripting, neural voice generation, and intelligent design tools, all at your fingertips."
   - For a stat_counter showing 1M+: "The counter spins — one hundred thousand, five hundred thousand — crossing one million videos created by creators just like you."
   - NEVER write generic taglines like "The future is here" — ALWAYS describe the visual: what appears, what animates, what the viewer sees.
   - Each line must be ~3 words per second (3s=9 words, 5s=15 words). For 60s video, total must be ~180+ words.
5. Generate ALL scenes the user requests — do NOT cut short.
6. MINIMUM SCENE DURATION: Every scene must be at least 3 seconds. Use 3-5s for simple scenes and 4-6s for content-heavy scenes (feature_list, metric_dashboard, comparison).
7. REPLY TONE: Your "reply" field must be friendly and non-technical. NEVER mention "JSON", "data", "object", "scenes JSON", "project details", "conversation history", or "block". Speak like a creative director talking to a client.
8. MANDATORY ASSET SCAN: Scan the user message and conversation history for all "[UPLOADED IMAGE: ...]" tags. If you find N unique image URLs, you MUST generate at least N scenes that use these unique URLs. It is a CRITICAL FAILURE to leave any provided asset unused.
9. SMART PLACEMENT & PRIORITY: 
   - Uploaded assets take 100% priority over AI-generated images (Nano Banana).
   - Logo/Icon → logo_reveal (Scene 1) and call_to_action (Scene 24).
   - Screenshot/App UI → browser_mockup, phone_mockup, or bento_grid.
   - Product/Person → image_showcase, video_hero, or split_hero.
10. NO REPETITION OF NANO BANANA: Only leave "imageUrl" empty for AI generation if you have already used every single uploaded asset provided.
11. COMPARISON DEPTH: Comparison scenes MUST have at least 3 detailed points per side. Use high-contrast text. Example: "Traditional: Slow, Expensive, Hard" vs "Migoo: 10x Faster, Free, AI-Powered".
12. BENTO & STATS CONTENT: Always include high-end specs (8K, 120 FPS, AI-Powered).
13. 3-MINUTE DURATION CAP: Total duration MUST NOT exceed 180s.
14. HIGH CONTRAST COLORS: Use WHITE (#ffffff) or NEON colors for text on dark backgrounds.

SCENE TYPES: logo_reveal, title_reveal, split_hero, video_hero, bento_grid, neon_glow, gradient_burst, phone_mockup, browser_mockup, search_reveal, feature_list, stat_counter, metric_dashboard, comparison, image_showcase, timeline, process_steps, testimonial, notification_stack, code_terminal, glass_card, quote_reveal, kinetic_text, call_to_action, icon_grid

JSON FORMAT:
{"scenes":[{"type":"...","headline":"...","subtext":"...","imageUrl":"","durationSec":5,"voiceoverLine":"...","colors":{"bg":"#0a0a0f","text":"#fff","accent":"#6366f1"},"items":[],"stat":null,"content":"","query":""}],"voiceoverLines":["all voiceoverLines combined"]}

For items-based scenes (feature_list, icon_grid, bento_grid, metric_dashboard, timeline, process_steps, notification_stack), always include an "items" array with {"icon":"...","label":"...","value":"..."}.
For stat_counter, include "stat":{"value":1000000,"suffix":"+","label":"..."}.
For comparison, use "items":[{"label":"Before","value":"..."},{"label":"After","value":"..."}].
For code_terminal, put code in "content". For testimonial, put quote in "content", name in "subtext".`;

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
        const { message } = await req.json();

        if (!message || typeof message !== "string" || message.trim().length < 1) {
            return NextResponse.json({ error: "Message is required" }, { status: 400 });
        }

        // Verify project ownership
        console.log(`[CHAT] Checking project ownership. projectId: ${projectId}, userId: ${user.primaryEmailAddress.emailAddress}`);
        const allProjectsForUser = await db.select({ id: motionGraphicProjects.projectId }).from(motionGraphicProjects).where(eq(motionGraphicProjects.userId, user.primaryEmailAddress.emailAddress));
        console.log(`[CHAT] User has projects: ${allProjectsForUser.map(p => p.id).join(', ')}`);

        const [project] = await db
            .select()
            .from(motionGraphicProjects)
            .where(
                and(
                    eq(motionGraphicProjects.projectId, projectId),
                    eq(motionGraphicProjects.userId, user.primaryEmailAddress.emailAddress)
                )
            );

        if (!project) {
            console.error(`[CHAT] 404 Not Found. Project ${projectId} does not exist for user ${user.primaryEmailAddress.emailAddress}`);
            return NextResponse.json({ error: "Project not found" }, { status: 404 });
        }

        // Save user message — preserve image context so the AI remembers assets in future turns
        await db.insert(motionGraphicMessages).values({
            projectId,
            role: "user",
            content: message.trim(),
        });

        // Build conversation context — SMART WINDOWING to stay under Groq's 12K TPM
        const existingMessages = await db
            .select()
            .from(motionGraphicMessages)
            .where(eq(motionGraphicMessages.projectId, projectId));

        // Only keep the last 4 non-system messages to limit token usage
        const recentMessages = existingMessages
            .filter((m) => m.role !== "system")
            .slice(-4);

        const conversationContext = recentMessages
            .map((m) => {
                // Truncate individual messages to 300 chars to prevent bloat
                const content = m.content.length > 300 ? m.content.substring(0, 300) + "..." : m.content;
                return `${m.role === "user" ? "User" : "Assistant"}: ${content}`;
            })
            .join("\n\n");

        // Summarize scene data instead of dumping full JSON
        let scenesSummary = "No scenes generated yet.";
        if (project.sceneData && Array.isArray(project.sceneData) && project.sceneData.length > 0) {
            const sceneTypes = (project.sceneData as any[]).map((s: any) => s.type).join(", ");
            scenesSummary = `${(project.sceneData as any[]).length} scenes already generated (types: ${sceneTypes}). User may want to refine them.`;
        }

        const projectContext = `PROJECT DETAILS:
- Duration: ${project.duration} seconds
- Aspect Ratio: ${project.aspectRatio}
- Voiceover: ${project.voiceoverEnabled ? "Enabled" : "Disabled"}
- Music: ${project.music}
- Theme: ${project.theme ? JSON.stringify(project.theme) : "Not set"}
- Scenes: ${scenesSummary}`;

        // Truncate very long user messages to ~4000 chars to stay within token limits
        // (24-scene prompts can be ~3500 chars — must not be cut off)
        const trimmedMessage = message.trim().length > 4000 
            ? message.trim().substring(0, 4000) + "\n[Message truncated for token limits — key details above]"
            : message.trim();

        // Generate AI response
        const aiResponse = await aiFallback.json(
            MOTION_GRAPHIC_SYSTEM_PROMPT,
            `${projectContext}\n\nCONVERSATION HISTORY:\n${conversationContext}\n\nUser: ${trimmedMessage}\n\nRespond as the assistant. If the user is ready for scenes or you think you have enough context, include a scenes JSON block. Output your response as JSON: { "reply": "your message", "scenesJson": null_or_object }`,
            { temperature: 0.8, maxOutputTokens: 8192 }
        );

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

        // If scenes were generated, update the project
        if (scenesData?.scenes) {
            // Enforce minimum 3s per scene — prevents scenes from flashing too fast
            scenesData.scenes = scenesData.scenes.map((s: any) => ({
                ...s,
                durationSec: Math.max(3, Number(s.durationSec) || 3),
            }));
            const calculatedDuration = scenesData.scenes.reduce((sum: number, s: any) => sum + (Number(s.durationSec) || 5), 0);
            
            await db
                .update(motionGraphicProjects)
                .set({
                    sceneData: scenesData.scenes,
                    duration: calculatedDuration > 0 ? calculatedDuration : project.duration,
                    voiceoverScript: scenesData.voiceoverLines?.join("\n") || null,
                    status: "draft", // Reset status so the UI knows to generate again
                    videoUrl: null,  // Clear old video
                    remotionProps: null, // Clear old render data
                    updatedAt: new Date(),
                })
                .where(eq(motionGraphicProjects.projectId, projectId));
        }

        // Save assistant message
        await db.insert(motionGraphicMessages).values({
            projectId,
            role: "assistant",
            content: replyText,
            metadata: scenesData ? { type: "scene_update", sceneData: scenesData } : null,
        });

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
