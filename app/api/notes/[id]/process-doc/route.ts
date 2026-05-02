/**
 * Notes — Sarvam Document Intelligence Pipeline
 *
 * Handles PDFs of ANY size by splitting into ≤10-page chunks.
 * Each chunk is processed as a separate Sarvam job, then results are combined.
 *
 * Flow:
 *   1. Receive raw PDF binary from client
 *   2. Split into 10-page chunks using pdf-lib
 *   3. For each chunk: create job → upload → start → poll → download
 *   4. Combine all extracted text
 *   5. Save to DB, return to client
 */

import { db, dbRetry } from "@/config/db";
import { notesProjects } from "@/config/schema";
import { currentUser } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { PDFDocument } from "pdf-lib";
import JSZip from "jszip";

const SARVAM_BASE = "https://api.sarvam.ai";
const MAX_PAGES_PER_JOB = 10;

function getSarvamKey(): string {
    const key = process.env.SARVAM_API_KEY;
    if (!key) throw new Error("SARVAM_API_KEY not set in .env");
    return key;
}

// ─── PDF Splitting ───────────────────────────────────────────

async function splitPdf(pdfBytes: Uint8Array): Promise<{ chunk: Uint8Array; startPage: number; endPage: number }[]> {
    const srcDoc = await PDFDocument.load(pdfBytes);
    const totalPages = srcDoc.getPageCount();
    console.log(`📄 PDF has ${totalPages} pages — splitting into chunks of ${MAX_PAGES_PER_JOB}`);

    if (totalPages <= MAX_PAGES_PER_JOB) {
        return [{ chunk: pdfBytes, startPage: 1, endPage: totalPages }];
    }

    const chunks: { chunk: Uint8Array; startPage: number; endPage: number }[] = [];

    for (let start = 0; start < totalPages; start += MAX_PAGES_PER_JOB) {
        const end = Math.min(start + MAX_PAGES_PER_JOB, totalPages);
        const newDoc = await PDFDocument.create();
        const pageIndices = Array.from({ length: end - start }, (_, i) => start + i);
        const copiedPages = await newDoc.copyPages(srcDoc, pageIndices);

        for (const page of copiedPages) {
            newDoc.addPage(page);
        }

        const chunkBytes = await newDoc.save();
        chunks.push({
            chunk: chunkBytes,
            startPage: start + 1,
            endPage: end,
        });
        console.log(`  📦 Chunk ${chunks.length}: pages ${start + 1}-${end}`);
    }

    return chunks;
}

// ─── Sarvam API Helpers ──────────────────────────────────────

async function sarvamCreateJob() {
    const res = await fetch(`${SARVAM_BASE}/doc-digitization/job/v1`, {
        method: "POST",
        headers: {
            "api-subscription-key": getSarvamKey(),
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            job_parameters: { language: "en-IN", output_format: "md" },
        }),
    });
    if (!res.ok) throw new Error(`createJob failed (${res.status}): ${await res.text()}`);
    return res.json();
}

async function sarvamGetUploadUrl(jobId: string, filename: string) {
    const res = await fetch(`${SARVAM_BASE}/doc-digitization/job/v1/upload-files`, {
        method: "POST",
        headers: {
            "api-subscription-key": getSarvamKey(),
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ job_id: jobId, files: [filename] }),
    });
    if (!res.ok) throw new Error(`getUploadUrl failed (${res.status}): ${await res.text()}`);
    return res.json();
}

async function sarvamUploadFile(presignedUrl: string, fileBytes: Uint8Array, contentType: string) {
    const res = await fetch(presignedUrl, {
        method: "PUT",
        headers: {
            "Content-Type": contentType,
            "x-ms-blob-type": "BlockBlob",
        },
        body: new Blob([fileBytes as any], { type: contentType }),
    });
    if (!res.ok) throw new Error(`upload failed (${res.status}): ${await res.text()}`);
}

async function sarvamStartJob(jobId: string) {
    const res = await fetch(`${SARVAM_BASE}/doc-digitization/job/v1/${jobId}/start`, {
        method: "POST",
        headers: {
            "api-subscription-key": getSarvamKey(),
            "Content-Type": "application/json",
        },
    });
    if (!res.ok) throw new Error(`startJob failed (${res.status}): ${await res.text()}`);
    return res.json();
}

async function sarvamPollStatus(jobId: string, maxAttempts = 90): Promise<any> {
    for (let i = 0; i < maxAttempts; i++) {
        const res = await fetch(`${SARVAM_BASE}/doc-digitization/job/v1/${jobId}/status`, {
            headers: { "api-subscription-key": getSarvamKey() },
        });
        if (!res.ok) {
            await new Promise(r => setTimeout(r, 3000));
            continue;
        }
        const data = await res.json();
        if (data.job_state === "Completed" || data.job_state === "PartiallyCompleted") return data;
        if (data.job_state === "Failed") throw new Error(`Job failed: ${data.error_message || "Unknown"}`);
        await new Promise(r => setTimeout(r, 2000));
    }
    throw new Error("Job timed out");
}

async function sarvamGetDownloadUrls(jobId: string) {
    const res = await fetch(`${SARVAM_BASE}/doc-digitization/job/v1/${jobId}/download-files`, {
        method: "POST",
        headers: {
            "api-subscription-key": getSarvamKey(),
            "Content-Type": "application/json",
        },
    });
    if (!res.ok) throw new Error(`getDownloadUrls failed (${res.status}): ${await res.text()}`);
    return res.json();
}

async function downloadAndExtractZip(downloadUrl: string): Promise<string> {
    const res = await fetch(downloadUrl);
    if (!res.ok) throw new Error(`ZIP download failed: ${res.status}`);

    const buffer = await res.arrayBuffer();
    const zip = await JSZip.loadAsync(buffer);
    let text = "";

    for (const [filename, file] of Object.entries(zip.files)) {
        if (file.dir) continue;
        const ext = filename.split(".").pop()?.toLowerCase() || "";
        // Only extract clean text — skip .json (raw block metadata with coordinates/confidence)
        if (["md", "txt", "html"].includes(ext)) {
            const content = await file.async("text");
            text += `\n${content}`;
            console.log(`📄 Extracted: ${filename} (${content.length} chars)`);
        } else {
            console.log(`⏭️ Skipped: ${filename} (${ext} — raw metadata)`);
        }
    }
    return text.trim();
}

// ─── Process a single chunk through the full Sarvam pipeline ──

// Wrap a single image in a ZIP (Sarvam requires images inside ZIP, not raw)
async function wrapImageInZip(imageBytes: Uint8Array, imageName: string): Promise<{ zipBytes: Uint8Array; zipName: string }> {
    const zip = new JSZip();
    zip.file(imageName, imageBytes);
    const zipBuffer = await zip.generateAsync({ type: "uint8array" });
    const zipName = imageName.replace(/\.[^/.]+$/, "") + ".zip";
    console.log(`  📦 Wrapped ${imageName} in ZIP (${(zipBuffer.length / 1024).toFixed(0)}KB)`);
    return { zipBytes: zipBuffer, zipName };
}

async function processChunk(
    chunkBytes: Uint8Array,
    chunkFilename: string,
    chunkLabel: string,
    contentType: string = "application/pdf"
): Promise<string> {
    // If image, wrap in ZIP first (Sarvam requires it)
    let uploadBytes = chunkBytes;
    let uploadFilename = chunkFilename;
    let uploadContentType = contentType;

    if (contentType.startsWith("image/")) {
        const { zipBytes, zipName } = await wrapImageInZip(chunkBytes, chunkFilename);
        uploadBytes = zipBytes;
        uploadFilename = zipName;
        uploadContentType = "application/zip";
    }

    console.log(`  🔧 [${chunkLabel}] Creating job...`);
    const jobRes = await sarvamCreateJob();
    const jobId = jobRes.job_id;

    console.log(`  🔗 [${chunkLabel}] Getting upload URL...`);
    const uploadUrlRes = await sarvamGetUploadUrl(jobId, uploadFilename);
    const presignedUrl = uploadUrlRes.upload_urls?.[uploadFilename]?.file_url;
    if (!presignedUrl) throw new Error(`No presigned URL for ${chunkLabel}`);

    console.log(`  ⬆️ [${chunkLabel}] Uploading ${(uploadBytes.length / 1024).toFixed(0)}KB...`);
    await sarvamUploadFile(presignedUrl, uploadBytes, uploadContentType);

    console.log(`  ▶️ [${chunkLabel}] Starting job ${jobId}...`);
    await sarvamStartJob(jobId);

    console.log(`  ⏳ [${chunkLabel}] Polling...`);
    await sarvamPollStatus(jobId);

    console.log(`  ⬇️ [${chunkLabel}] Downloading results...`);
    const downloadRes = await sarvamGetDownloadUrls(jobId);
    let outputUrl = "";
    for (const [, details] of Object.entries(downloadRes.download_urls || {})) {
        const d = details as any;
        if (d?.file_url) { outputUrl = d.file_url; break; }
    }
    if (!outputUrl) throw new Error(`No download URL for ${chunkLabel}`);

    const extracted = await downloadAndExtractZip(outputUrl);
    console.log(`  ✅ [${chunkLabel}] Extracted ${extracted.length} chars`);
    return extracted;
}

// ─── Main Handler ────────────────────────────────────────────

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const user = await currentUser();
        if (!user?.primaryEmailAddress?.emailAddress) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { id: noteId } = await params;
        const contentType = req.headers.get("content-type") || "";

        // Only accept raw binary uploads
        if (contentType.includes("application/json")) {
            return NextResponse.json(
                { error: "Send file as raw binary with x-filename header" },
                { status: 400 }
            );
        }

        const filename = req.headers.get("x-filename") || "document.pdf";
        const fileContentType = req.headers.get("x-content-type") || "application/pdf";

        // Read the raw file
        const arrayBuffer = await req.arrayBuffer();
        const fileBuffer = new Uint8Array(arrayBuffer);
        const fileSizeMB = (fileBuffer.length / 1024 / 1024).toFixed(1);
        console.log(`\n📝 Sarvam Pipeline: ${filename} (${fileSizeMB}MB)`);

        let allExtractedText = "";

        // ── PDF: split into chunks if needed ─────────────────
        if (fileContentType.includes("pdf")) {
            const chunks = await splitPdf(fileBuffer);
            console.log(`📦 ${chunks.length} chunk(s) to process`);

            // Process chunks sequentially (to avoid rate limits)
            for (let i = 0; i < chunks.length; i++) {
                const { chunk, startPage, endPage } = chunks[i];
                const chunkFilename = chunks.length === 1
                    ? filename
                    : `${filename.replace(".pdf", "")}_pages_${startPage}-${endPage}.pdf`;
                const label = `Chunk ${i + 1}/${chunks.length} (pp. ${startPage}-${endPage})`;

                try {
                    const text = await processChunk(chunk, chunkFilename, label);
                    allExtractedText += `\n\n--- Pages ${startPage}-${endPage} ---\n${text}`;
                } catch (err: any) {
                    console.error(`  ❌ [${label}] Failed: ${err.message}`);
                    allExtractedText += `\n\n--- Pages ${startPage}-${endPage} ---\n[ERROR: ${err.message}]`;
                }

                // Small delay between chunks to avoid rate limiting
                if (i < chunks.length - 1) {
                    await new Promise(r => setTimeout(r, 1000));
                }
            }
        } else {
            // ── Images: Use Groq Vision (llama-4-scout) ─────
            // Sarvam doesn't handle single images well — Groq Vision reads charts, graphs, text from images
            console.log(`🖼️ Image detected — using Groq Vision (llama-4-scout)...`);

            const { groq } = await import("@/config/groq");
            const sharp = (await import("sharp")).default;

            // Convert any image format (AVIF, WebP, HEIC, etc.) to JPEG for Groq compatibility
            console.log(`🔄 Converting image to JPEG...`);
            const jpegBuffer = await sharp(Buffer.from(fileBuffer))
                .jpeg({ quality: 90 })
                .toBuffer();

            const base64 = jpegBuffer.toString("base64");
            const dataUrl = `data:image/jpeg;base64,${base64}`;
            console.log(`✅ Converted to JPEG (${(jpegBuffer.length / 1024).toFixed(0)}KB)`);

            const visionPrompt = `Analyze this image in detail. Extract ALL text, data, and information visible in it.

If it contains:
- **Charts/Graphs**: Describe the type (bar, line, pie, etc.), axes labels, data points, trends, and key takeaways
- **Tables**: Reproduce the table content in markdown format
- **Text/Documents**: Extract all readable text preserving structure
- **Diagrams/Flowcharts**: Describe the flow, connections, and labels
- **Screenshots**: Describe what's shown and extract any visible text
- **Infographics**: Extract all data points, statistics, and labels

Be thorough and structured. Use markdown formatting with headers, bullet points, and tables where appropriate.`;

            try {
                allExtractedText = await groq.captionImage(dataUrl, visionPrompt, {
                    maxTokens: 4000,
                    temperature: 0.2,
                });
                console.log(`✅ Groq Vision extracted ${allExtractedText.length} chars`);
            } catch (err: any) {
                console.error(`❌ Groq Vision failed: ${err.message}`);
                allExtractedText = `[Image analysis failed: ${err.message}]`;
            }
        }

        allExtractedText = allExtractedText.trim();

        // Save to DB
        await dbRetry(() =>
            db.update(notesProjects)
                .set({
                    extractedContent: allExtractedText,
                    sourceType: "document",
                    updatedAt: new Date(),
                })
                .where(eq(notesProjects.noteId, noteId))
        );

        console.log(`\n✅ Done! Total extracted: ${allExtractedText.length} chars for ${noteId}`);

        return NextResponse.json({
            success: true,
            noteId,
            extractedText: allExtractedText,
            charCount: allExtractedText.length,
        });

    } catch (error: any) {
        console.error("❌ Sarvam processing failed:", error);
        return NextResponse.json(
            { error: error.message || "Processing failed" },
            { status: 500 }
        );
    }
}
