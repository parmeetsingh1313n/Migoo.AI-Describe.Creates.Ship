// Helper to unzip Sarvam output ZIP in Node.js (server-side only)

export async function unzipSarvamOutput(zipBuffer: ArrayBuffer): Promise<{
    markdown: string;
    images: Array<{ name: string; data: Buffer; mime: string }>;
}> {
    // Dynamic import of AdmZip — only available server-side
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const AdmZip = require("adm-zip");
    const zip = new AdmZip(Buffer.from(zipBuffer));
    const entries = zip.getEntries();

    let markdown = "";
    const images: Array<{ name: string; data: Buffer; mime: string }> = [];

    for (const entry of entries) {
        if (entry.isDirectory) continue;
        const name = entry.entryName.split("/").pop() || entry.entryName;
        const data: Buffer = entry.getData();

        if (name.endsWith(".md")) {
            markdown += data.toString("utf-8") + "\n\n";
        } else if (/\.(png|jpe?g)$/i.test(name)) {
            images.push({
                name,
                data,
                mime: /\.png$/i.test(name) ? "image/png" : "image/jpeg",
            });
        }
    }

    return { markdown, images };
}
