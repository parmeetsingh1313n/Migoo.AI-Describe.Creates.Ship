import { putWithRotation } from "@/lib/blob";
import { NextRequest, NextResponse } from "next/server";

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB per file
const MAX_IMAGES    = 5;
const MAX_VIDEOS    = 2;

const ALLOWED_MIME = [
    "image/jpeg", "image/png", "image/webp",
    "video/mp4", "video/quicktime", "video/webm"
];

async function uploadOneFile(
    file: File,
    sceneIndex: string | null,
    fileSeq: number
): Promise<{ url: string; fileId: string; isVideo: boolean; mimeType: string }> {
    const ext    = file.name.split(".").pop() || "bin";
    const fileId = `studio_scene${sceneIndex ?? "0"}_f${fileSeq}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const buffer = Buffer.from(await file.arrayBuffer());

    // ✅ Use the same node-appwrite SDK path as the normal shorts pipeline
    const pathname = `studio/assets/scene${sceneIndex ?? "0"}/${fileId}.${ext}`;
    const result = await putWithRotation(pathname, buffer, {
        access: "public",
        contentType: file.type,
    });

    return {
        url:      result.url,
        fileId,
        isVideo:  file.type.startsWith("video/"),
        mimeType: file.type,
    };
}

export async function POST(req: NextRequest) {
    try {
        const form       = await req.formData();
        const sceneIndex = form.get("sceneIndex") as string | null;

        // Collect all uploaded files
        const rawFiles: File[] = [];
        for (const [key, value] of form.entries()) {
            if ((key === "file" || key === "files" || key.startsWith("file")) && value instanceof File) {
                rawFiles.push(value);
            }
        }

        if (rawFiles.length === 0) {
            return NextResponse.json({ error: "No files provided" }, { status: 400 });
        }

        // Validate
        const imageFiles = rawFiles.filter(f => f.type.startsWith("image/"));
        const videoFiles = rawFiles.filter(f => f.type.startsWith("video/"));

        if (imageFiles.length > MAX_IMAGES) {
            return NextResponse.json({ error: `Max ${MAX_IMAGES} images per scene` }, { status: 400 });
        }
        if (videoFiles.length > MAX_VIDEOS) {
            return NextResponse.json({ error: `Max ${MAX_VIDEOS} videos per scene` }, { status: 400 });
        }

        for (const file of rawFiles) {
            if (file.size > MAX_FILE_SIZE) {
                return NextResponse.json({ error: `File "${file.name}" too large (max 50 MB)` }, { status: 413 });
            }
            if (!ALLOWED_MIME.includes(file.type)) {
                return NextResponse.json({
                    error: `Unsupported type "${file.type}". Allowed: JPG, PNG, WebP, MP4, MOV, WebM`
                }, { status: 415 });
            }
        }

        // Upload all files in parallel using the SDK
        const uploaded = await Promise.all(
            rawFiles.map((file, idx) => uploadOneFile(file, sceneIndex, idx))
        );

        return NextResponse.json({ ok: true, files: uploaded });
    } catch (err: any) {
        console.error("studio/upload-scene-asset error:", err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
