import { NextRequest, NextResponse } from "next/server";

const APPWRITE_ENDPOINT = process.env.APPWRITE_ENDPOINT!;
const APPWRITE_PROJECT  = process.env.APPWRITE_PROJECT_ID!;
const APPWRITE_API_KEY  = process.env.APPWRITE_API_KEY!;
const APPWRITE_BUCKET   = process.env.APPWRITE_BUCKET_ID!;

export async function POST(req: NextRequest) {
    try {
        const formData = await req.formData();
        const file = formData.get("file") as File;
        if (!file) {
            return NextResponse.json({ error: "No file provided" }, { status: 400 });
        }

        const buffer = Buffer.from(await file.arrayBuffer());
        const fileId = `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        
        const form = new FormData();
        form.append("fileId", fileId);
        form.append("file", new Blob([new Uint8Array(buffer)], { type: file.type }), file.name);

        const uploadRes = await fetch(
            `${APPWRITE_ENDPOINT}/storage/buckets/${APPWRITE_BUCKET}/files`,
            {
                method: "POST",
                headers: {
                    "X-Appwrite-Project": APPWRITE_PROJECT,
                    "X-Appwrite-Key": APPWRITE_API_KEY,
                },
                body: form,
            }
        );

        if (!uploadRes.ok) {
            const err = await uploadRes.text();
            throw new Error(`Upload failed: ${uploadRes.status} ${err}`);
        }

        const appwriteUrl = `${APPWRITE_ENDPOINT}/storage/buckets/${APPWRITE_BUCKET}/files/${fileId}/view?project=${APPWRITE_PROJECT}`;

        return NextResponse.json({ url: appwriteUrl });
    } catch (err: any) {
        console.error("upload-image POST error:", err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
