/**
 * Per-Scene Asset Upload API for Motion Graphics
 *
 * POST: Attach an image OR video to a SPECIFIC scene (by index). The asset is
 *   locked to that scene (userAsset:true) so the render pipeline shows it
 *   VERBATIM and never sends it to Wan/Kling. Images are described via Groq
 *   Vision; the scene template is then auto-redesigned around the asset.
 * DELETE (?assetId=...): unbind the asset from its scene and delete the file.
 *
 * Images  → public blob URL via putWithRotation.
 * Videos  → Appwrite (single ≤49MB, else chunked) served through
 *           /scene-asset/[assetId].mp4 (Range-enabled) so Remotion streams it.
 */

import { db } from "@/config/db";
import { motionGraphicMessages, motionGraphicProjects } from "@/config/schema";
import { currentUser } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { putWithRotation } from "@/lib/blob";
import { groq } from "@/config/groq";
import { motionGraphicsLLM } from "@/lib/motion-graphics-llm";
import { uploadVideoToAppwrite, deleteVideoFromAppwrite, type VideoStreamMeta } from "@/lib/scene-asset";

const IMAGE_MAX = 10 * 1024 * 1024;         // 10 MB
const VIDEO_MAX = 300 * 1024 * 1024;        // 300 MB (chunked upload handles >50 MB)

/** Per-scene asset record kept in the role:"assets" message metadata. */
interface SceneAssetRecord {
    id: string;
    sceneIndex: number;
    type: "image" | "video";
    url: string;                 // image blob URL OR video stream URL (ends in .mp4)
    name: string;
    description?: string;        // images (Groq Vision)
    streamMeta?: VideoStreamMeta;
    durationSec?: number;        // videos
}

function appBaseUrl(): string {
    return (
        process.env.NEXT_PUBLIC_APP_URL ||
        (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "") ||
        ""
    ).replace(/\/$/, "");
}

async function ownProject(projectId: string, email: string) {
    const [project] = await db
        .select()
        .from(motionGraphicProjects)
        .where(and(eq(motionGraphicProjects.projectId, projectId), eq(motionGraphicProjects.userId, email)))
        .limit(1);
    return project;
}

async function loadAssetsMsg(projectId: string) {
    const [msg] = await db
        .select()
        .from(motionGraphicMessages)
        .where(and(eq(motionGraphicMessages.projectId, projectId), eq(motionGraphicMessages.role, "assets")))
        .limit(1);
    return msg;
}

async function saveAssetRecords(projectId: string, records: SceneAssetRecord[], existingId?: number) {
    if (existingId) {
        await db
            .update(motionGraphicMessages)
            .set({ metadata: { type: "uploaded_assets", assets: records } })
            .where(eq(motionGraphicMessages.id, existingId));
    } else {
        await db.insert(motionGraphicMessages).values({
            projectId,
            role: "assets",
            content: "scene assets",
            metadata: { type: "uploaded_assets", assets: records },
        });
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST — attach an image/video to a scene
// ─────────────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
    try {
        const user = await currentUser();
        const email = user?.primaryEmailAddress?.emailAddress;
        if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const { projectId } = await params;
        const project = await ownProject(projectId, email);
        if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

        const form = await req.formData();
        const file = form.get("file") as File | null;
        const sceneIndex = parseInt(String(form.get("sceneIndex") ?? ""), 10);
        const clientDuration = parseFloat(String(form.get("durationSec") ?? ""));

        if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });
        const scenes = (project.sceneData as any[]) || [];
        if (isNaN(sceneIndex) || sceneIndex < 0 || sceneIndex >= scenes.length) {
            return NextResponse.json({ error: "Invalid sceneIndex" }, { status: 400 });
        }

        const isImage = file.type.startsWith("image/");
        const isVideo = file.type.startsWith("video/");
        if (!isImage && !isVideo) {
            return NextResponse.json({ error: "Only image or video files are allowed" }, { status: 400 });
        }
        if (isImage && file.size > IMAGE_MAX) {
            return NextResponse.json({ error: "Image too large (max 10 MB)" }, { status: 400 });
        }
        if (isVideo && file.size > VIDEO_MAX) {
            return NextResponse.json({ error: "Video too large (max 300 MB)" }, { status: 400 });
        }

        const buffer = Buffer.from(await file.arrayBuffer());
        const assetId = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

        // ── Build the asset record + resolve the scene's imageUrl ────────────────
        let record: SceneAssetRecord;
        let sceneImageUrl: string;
        let sceneDuration: number | undefined;
        let visionDescription = "";

        if (isImage) {
            const ext = file.name.split(".").pop() || "jpg";
            const filename = `motion-graphics/${projectId}/scene-${sceneIndex}-${assetId}.${ext}`;
            const blob = await putWithRotation(filename, buffer, { access: "public", contentType: file.type });

            // Groq Vision description for the auto-redesign step (non-fatal).
            try {
                const dataUrl = `data:${file.type};base64,${buffer.toString("base64")}`;
                const raw = await groq.captionImage(
                    dataUrl,
                    `Describe this image for a motion-graphics scene in 1-2 sentences: what it shows and how it should be framed on screen. Be concrete and visual.`,
                );
                visionDescription = raw.replace(/^DESCRIPTION:\s*/i, "").trim().slice(0, 400);
            } catch (e: any) {
                console.warn("[scene-asset] Groq vision failed (non-fatal):", e?.message);
            }

            sceneImageUrl = blob.url;
            record = { id: assetId, sceneIndex, type: "image", url: blob.url, name: file.name, description: visionDescription };
        } else {
            // Video → Appwrite (single or chunked); served through the .mp4 stream route.
            const streamMeta = await uploadVideoToAppwrite(buffer, assetId);
            const base = appBaseUrl();
            const streamPath = `/api/motion-graphics/${projectId}/scene-asset/${assetId}.mp4`;
            sceneImageUrl = base ? `${base}${streamPath}` : streamPath; // absolute for the render farm
            sceneDuration = Math.max(3, Math.min(30, Math.round(clientDuration || 0) || 5));
            record = { id: assetId, sceneIndex, type: "video", url: sceneImageUrl, name: file.name, streamMeta, durationSec: sceneDuration };
        }

        // ── Persist the asset record (replace any existing asset for this scene) ──
        const assetsMsg = await loadAssetsMsg(projectId);
        const prev: SceneAssetRecord[] = (assetsMsg?.metadata as any)?.assets || [];
        // Delete any previously-bound video file for this scene to avoid orphans.
        for (const old of prev) {
            if (old.sceneIndex === sceneIndex && old.type === "video" && old.streamMeta) {
                await deleteVideoFromAppwrite(old.streamMeta);
            }
        }
        const nextRecords = [...prev.filter((a) => a.sceneIndex !== sceneIndex), record];
        await saveAssetRecords(projectId, nextRecords, assetsMsg?.id);

        // ── Lock the asset onto the scene object ─────────────────────────────────
        scenes[sceneIndex] = {
            ...scenes[sceneIndex],
            imageUrl: sceneImageUrl,
            userAsset: true,
            assetType: isImage ? "image" : "video",
            ...(visionDescription ? { assetDescription: visionDescription } : {}),
            ...(sceneDuration ? { durationSec: sceneDuration } : {}),
        };

        // ── Auto-redesign this ONE scene's TEXT around the asset (non-fatal) ─────
        // IMPORTANT: the scene TYPE must never change here. Every scene type has a
        // bespoke Remotion animation (e.g. logo_reveal's rings/particles/shimmer,
        // search_reveal's typing bar) — swapping types on upload was the bug the
        // user reported (logo_reveal → generic layout, search_reveal → caption
        // card). Only headline/subtext/content are rewritten to fit the asset.
        try {
            const currentType = scenes[sceneIndex].type;
            const kind = isImage
                ? `a user-uploaded image described as: "${visionDescription || "a reference image"}"`
                : `a user-uploaded video clip`;
            const request =
                `Scene ${sceneIndex + 1} (type: "${currentType}") now contains ${kind}. ` +
                `Rewrite ONLY its headline/subtext/content so the on-screen text fits this asset. ` +
                `Do NOT change the scene type — it must remain exactly "${currentType}". ` +
                `Do NOT change imageUrl — it is LOCKED to the uploaded asset. Do not touch any other scene.`;

            const { patches } = await motionGraphicsLLM.patch(scenes, request, "");
            const mine = (patches || []).find((p) => p.index === sceneIndex);
            if (mine?.updates) {
                const u = { ...mine.updates };
                // Never let the redesign override the locked media, duration, or type.
                delete (u as any).imageUrl;
                delete (u as any).animationRequested;
                delete (u as any).animationType;
                delete (u as any).type;
                if (sceneDuration) delete (u as any).durationSec;
                scenes[sceneIndex] = {
                    ...scenes[sceneIndex],
                    ...u,
                    type: currentType,
                    imageUrl: sceneImageUrl,
                    userAsset: true,
                    assetType: isImage ? "image" : "video",
                    ...(visionDescription ? { assetDescription: visionDescription } : {}),
                    ...(sceneDuration ? { durationSec: sceneDuration } : {}),
                };
            }
        } catch (e: any) {
            console.warn("[scene-asset] auto-redesign failed (non-fatal):", e?.message);
        }

        // ── Persist scenes + reset render state ──────────────────────────────────
        const calculatedDuration = scenes.reduce((s: number, x: any) => s + (Number(x.durationSec) || 5), 0);
        await db
            .update(motionGraphicProjects)
            .set({
                sceneData: scenes,
                duration: calculatedDuration > 0 ? calculatedDuration : project.duration,
                status: "draft",
                videoUrl: null,
                remotionProps: null,
                updatedAt: new Date(),
            })
            .where(eq(motionGraphicProjects.projectId, projectId));

        return NextResponse.json({
            success: true,
            sceneIndex,
            scene: scenes[sceneIndex],
            assetType: isImage ? "image" : "video",
            description: visionDescription || undefined,
        });
    } catch (err: any) {
        console.error("[scene-asset] POST error:", err?.message || err);
        return NextResponse.json({ error: err?.message || "Upload failed" }, { status: 500 });
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE — unbind an asset from its scene
// ─────────────────────────────────────────────────────────────────────────────
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
    try {
        const user = await currentUser();
        const email = user?.primaryEmailAddress?.emailAddress;
        if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const { projectId } = await params;
        const project = await ownProject(projectId, email);
        if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

        const assetId = req.nextUrl.searchParams.get("assetId");
        const sceneIdxParam = req.nextUrl.searchParams.get("sceneIndex");
        const assetsMsg = await loadAssetsMsg(projectId);
        const prev: SceneAssetRecord[] = (assetsMsg?.metadata as any)?.assets || [];

        const target = prev.find(
            (a) => (assetId && a.id === assetId) || (sceneIdxParam != null && a.sceneIndex === parseInt(sceneIdxParam, 10)),
        );
        if (!target) return NextResponse.json({ error: "Asset not found" }, { status: 404 });

        if (target.type === "video" && target.streamMeta) await deleteVideoFromAppwrite(target.streamMeta);
        await saveAssetRecords(projectId, prev.filter((a) => a.id !== target.id), assetsMsg?.id);

        // Clear the lock fields on the scene.
        const scenes = (project.sceneData as any[]) || [];
        if (scenes[target.sceneIndex]) {
            const s = { ...scenes[target.sceneIndex] };
            delete s.imageUrl;
            delete s.userAsset;
            delete s.assetType;
            delete s.assetDescription;
            scenes[target.sceneIndex] = s;
            await db
                .update(motionGraphicProjects)
                .set({ sceneData: scenes, status: "draft", videoUrl: null, remotionProps: null, updatedAt: new Date() })
                .where(eq(motionGraphicProjects.projectId, projectId));
        }

        return NextResponse.json({ success: true, sceneIndex: target.sceneIndex });
    } catch (err: any) {
        console.error("[scene-asset] DELETE error:", err?.message || err);
        return NextResponse.json({ error: err?.message || "Delete failed" }, { status: 500 });
    }
}
