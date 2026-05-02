/**
 * Notes Generator — AI Generation Pipeline (Groq Only, NO Gemini)
 * POST: Generate structured notes from user content
 *
 * AI Models:
 *   - Content structuring: Groq (llama-3.3-70b-versatile) via aiFallback
 *   - Image analysis: Groq Vision (llama-4-scout) via groq.captionImage
 *   - Document extraction: Sarvam Vision (separate endpoint)
 */

import { db, dbRetry } from "@/config/db";
import { notesProjects } from "@/config/schema";
import { groq } from "@/config/groq";
import { currentUser } from "@clerk/nextjs/server";
import { generateNotesImages } from "@/lib/notes-image-gen";
import { generateNotesWithChunking } from "@/lib/chunked-notes-generator";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

// ─── Image Analysis via Groq Vision ─────────────────────────
async function analyzeImageWithGroq(imageUrl: string, context: string): Promise<string> {
    const prompt = `Analyze this image thoroughly. Extract ALL text, data, statistics, labels, and descriptions visible in it.
If it's a chart/graph: describe the data points, axes, trends, and key takeaways.
If it's a screenshot: describe the UI elements, content, and key information.
If it's a diagram: describe the relationships, flow, and components.
If it's a photo: describe the subject, context, and any text visible.

Context: ${context}

Return a detailed description that can be used to reference this content in study notes.`;

    // Fetch the image
    const imageRes = await fetch(imageUrl);
    if (!imageRes.ok) throw new Error(`Failed to fetch image: ${imageRes.status}`);

    const imageBuffer = await imageRes.arrayBuffer();
    if (imageBuffer.byteLength === 0) throw new Error("Image file is empty");
    if (imageBuffer.byteLength > 6 * 1024 * 1024) throw new Error("Image too large for vision analysis (>6MB)");

    // Detect MIME type
    const rawContentType = imageRes.headers.get("content-type") || "image/png";
    const mimeType = rawContentType.split(";")[0].trim();

    // Groq only supports jpeg, png, gif, webp — NOT avif, heic, tiff etc.
    const groqSupported = ["image/jpeg", "image/png", "image/gif", "image/webp"];
    const needsConversion = !groqSupported.includes(mimeType);

    let finalBase64: string;
    let finalMime: string;

    if (needsConversion) {
        // Convert unsupported formats (AVIF, HEIC, TIFF, etc.) to JPEG using sharp
        console.log(`🔄 Converting ${mimeType} → JPEG for Groq vision...`);
        const sharp = (await import("sharp")).default;
        const jpegBuffer = await sharp(Buffer.from(imageBuffer))
            .jpeg({ quality: 90 })
            .toBuffer();
        finalBase64 = jpegBuffer.toString("base64");
        finalMime = "image/jpeg";
        console.log(`✅ Converted to JPEG (${(jpegBuffer.length / 1024).toFixed(0)}KB)`);
    } else {
        finalBase64 = Buffer.from(imageBuffer).toString("base64");
        finalMime = mimeType;
    }

    const dataUrl = `data:${finalMime};base64,${finalBase64}`;

    return groq.captionImage(dataUrl, prompt, {
        maxTokens: 2048,
        temperature: 0.3,
    });
}

// ─── Main Generation ─────────────────────────────────────────
export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        // Auth check — gracefully skip for Inngest/server-side background calls
        let userEmail: string | null = null;
        try {
            const user = await currentUser();
            userEmail = user?.primaryEmailAddress?.emailAddress || null;
        } catch (authErr) {
            // Clerk fails when called from Inngest (no session) — that's OK
            console.log("⚠️ Clerk auth skipped (background job context)");
        }

        const { id: noteId } = await params;

        // Fetch the project
        const [project] = await db
            .select()
            .from(notesProjects)
            .where(eq(notesProjects.noteId, noteId));

        if (!project) {
            return NextResponse.json({ error: "Project not found" }, { status: 404 });
        }

        // Update status
        await dbRetry(() =>
            db.update(notesProjects)
                .set({ status: "generating" })
                .where(eq(notesProjects.noteId, noteId))
        );

        // ── Step 1: Process uploaded images with Groq Vision ─────
        let assetContext = "";
        const uploadedAssets = (project.uploadedAssets as any[]) || [];
        const imageAssets = uploadedAssets.filter(
            (a) => a.type?.startsWith("image/")
        );

        if (imageAssets.length > 0) {
            console.log(`🔍 Analyzing ${imageAssets.length} image(s) with Groq Vision...`);
            const descriptions: string[] = [];
            for (const asset of imageAssets) {
                try {
                    const desc = await analyzeImageWithGroq(asset.url, project.title);
                    descriptions.push(`[IMAGE: ${asset.name || "Image"}]\n${desc}`);
                } catch (err) {
                    console.warn(`⚠️ Failed to analyze image: ${(err as Error).message}`);
                    descriptions.push(`[IMAGE: ${asset.name || "Image"}]\nImage uploaded but could not be analyzed.`);
                }
            }
            assetContext = `\n\n--- UPLOADED VISUAL ASSETS (integrate this data into the notes) ---\n${descriptions.join("\n\n")}`;
        }

        // ── Step 2: Build content context ────────────────────────
        let contentContext = "";

        // Priority: extractedContent (from Sarvam) > sourceContent > topic
        if (project.extractedContent) {
            // Document was processed by Sarvam
            contentContext = project.extractedContent;
            console.log(`📄 Using Sarvam-extracted content: ${contentContext.length} chars`);
        } else if (project.sourceType === "text" && project.sourceContent) {
            contentContext = project.sourceContent;
        } else if (project.sourceType === "topic") {
            contentContext = `Generate comprehensive study notes about: "${project.title}"`;
        } else if (project.sourceContent) {
            contentContext = project.sourceContent;
        } else {
            contentContext = `Generate comprehensive study notes about: "${project.title}"`;
        }

        // ── Step 3: Generate structured notes via Groq (with chunking) ──
        const styleInstructions: Record<string, string> = {
            cornell: `You are generating Cornell-style study notes as compact JSON.
Cover every major chapter from the source document.

OUTPUT STRUCTURE:
- "cueColumn": 8-10 key questions/terms for the left sidebar
- "mainNotes": exactly 10-12 sections (no more, no fewer)
- "summary": 3-4 sentence summary
- "keyTerms": 8 items, each { "term": string, "definition": string }
- "imagePosition": 0-based index of where to embed an uploaded image (if any)

Each section: { "heading": string, "type": <one of 13 types below>, ...type-specific fields }

SECTION TYPES — rotate through all 13, use each at most twice:
1. "bullets" — { "bullets": string[] } — 4-6 items, full sentences
2. "numbered" — { "bullets": string[] } — 4-6 numbered items
3. "table" — { "table": { "headers": string[], "rows": string[][] } } — min 3 cols, 3 rows of real data
4. "callout" — { "calloutText": string } — one key insight sentence
5. "highlight" — { "highlightTitle": string, "highlightBody": string } — 2 sentences
6. "cards" — { "cards": [{"icon": string, "title": string, "description": string}] } — 4-6 cards
7. "numbered-grid" — { "items": [{"title": string, "description": string}] } — 4-6 items
8. "circular-map" — { "centerLabel": string, "items": [{"title": string, "description": string}] } — 4-6 items
9. "quote-cards" — { "quotes": [{"title": string, "text": string}] } — 3 quotes
10. "flowchart" — { "steps": [{"label": string, "detail": string}] } — 4-6 steps
11. "horizontal-flowchart" — { "steps": [{"label": string, "detail": string, "icon": string}] } — 4-5 steps with icons
12. "radial-list" — { "centerLabel": string, "items": [{"icon": string, "title": string, "description": string}] } — 3-4 items
13. "step-cards" — { "steps": [{"label": string, "detail": string, "icon": string}] } — 4-5 steps with icons

ICON KEYS: chart-line, chart-bar, code, laptop-code, terminal, database, server, brain, lightbulb,
gears, briefcase, users, shield, rocket, bolt, clock, network, cloud, book, graduation-cap, tools, key

RULES:
1. Produce exactly 10-12 sections — not more
2. Use "table" for comparisons/metrics, "step-cards" for methodology, "horizontal-flowchart" for pipelines
3. Use "radial-list" for system components, "circular-map" for concept groups
4. Each bullet/detail: one clear, informative sentence — no empty strings
5. VARY types — do not repeat the same type more than twice`,

            mindmap: `Use Mind Map format:
- "centralTopic": the main topic string
- "branches": array of { "label": string, "children": array of { "label": string, "detail": string } }
- "connections": array of { "from": string, "to": string, "label": string } for cross-links`,

            flashcard: `Use Flashcard Grid format:
- "cards": array of { "front": string (term/question), "back": string (answer/definition), "category": string, "difficulty": "easy"|"medium"|"hard" }
- Aim for 12-20 cards covering all key concepts`,

            infographic: `Use Infographic format:
- "headline": main title string
- "subtitle": brief description
- "stats": array of { "value": string, "label": string, "icon": string (emoji) }
- "sections": array of { "title": string, "icon": string (emoji), "points": string[] }
- "highlight": a key takeaway quote or fact
- "timeline": optional array of { "date": string, "event": string }`,

            cheatsheet: `Use Cheat Sheet format:
- "title": main title
- "columns": array of { "heading": string, "items": array of { "label": string, "value": string, "code": string? } }
- "quickRef": array of { "shortcut": string, "action": string }
- "warnings": array of important caveats/gotchas
- "codeBlocks": array of { "language": string, "title": string, "code": string }`,

            timeline: `Use Timeline format:
- "title": main title
- "events": array of { "date": string, "title": string, "description": string, "icon": string (emoji), "importance": "high"|"medium"|"low" }
- "summary": overview text`,
        };

        const style = project.noteStyle || "cornell";
        const styleGuide = styleInstructions[style] || styleInstructions.cornell;

        // Build asset embedding instructions
        const assetEmbedInstructions = imageAssets.length > 0
            ? `\n\nIMPORTANT — UPLOADED IMAGES:
The user has uploaded ${imageAssets.length} image(s)/chart(s)/screenshot(s).
Their descriptions are provided below. You MUST reference and integrate this visual data into the notes:
- If it's a chart/graph: extract the data and include it as stats or in relevant sections
- If it's a screenshot: describe what it shows and reference it
- If it's a diagram: incorporate the relationships into the notes structure
- Include an "embeddedAssets" array in your response: array of { "assetIndex": number (0-based), "placement": string (which section to place it in), "caption": string }
${assetContext}`
            : "";

        console.log(`🧠 Generating ${style} notes for: "${project.title}" using Groq (chunked pipeline)...`);

        const generatedData = await generateNotesWithChunking(
            contentContext,
            project.title,
            style,
            styleGuide,
            assetEmbedInstructions,
        );

        // ── Step 4: Save to DB ───────────────────────────────────
        await dbRetry(() =>
            db.update(notesProjects)
                .set({
                    generatedData,
                    status: "completed",
                    updatedAt: new Date(),
                })
                .where(eq(notesProjects.noteId, noteId))
        );

        console.log(`✅ Notes generated successfully: ${noteId}`);

        // ── Step 5: Fire-and-forget image generation ─────────────
        // Runs in background — user sees notes immediately, images load later
        generateNotesImages(noteId).then((result) => {
            if (result.success) console.log(`🖼️ ${result.imagesGenerated} images generated for ${noteId} (${result.model})`);
            else console.warn(`⚠️ Image generation failed for ${noteId}: ${result.error}`);
        });

        return NextResponse.json({
            success: true,
            noteId,
            generatedData,
        });
    } catch (error: any) {
        console.error("❌ Notes generation failed:", error);

        // Update status to failed
        try {
            const { id: noteId } = await params;
            await db.update(notesProjects)
                .set({ status: "failed" })
                .where(eq(notesProjects.noteId, noteId));
        } catch {}

        return NextResponse.json(
            { error: error.message || "Generation failed" },
            { status: 500 }
        );
    }
}
