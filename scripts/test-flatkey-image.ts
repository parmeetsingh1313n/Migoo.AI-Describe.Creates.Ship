import dotenv from "dotenv";
dotenv.config();

const apiKey = "sk-SivNgg9OS1eQgCvBKVDW23TVXJNhvJU3Y3LRBtiBZVcpysOu";
const FLATKEY_BASE = "https://console.flatkey.ai";

async function testModel(modelName: string) {
    console.log(`\n--------------------------------------------`);
    console.log(`Testing model: ${modelName}`);
    const start = Date.now();
    try {
        const res = await fetch(`${FLATKEY_BASE}/v1/images/generations`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: modelName,
                prompt: "A beautiful golden sunset over a peaceful lake, cinematic lighting",
                n: 1,
                size: "1024x1024",
                response_format: "b64_json",
            }),
        });

        const elapsed = (Date.now() - start) / 1000;
        console.log(`Status: ${res.status} (${elapsed.toFixed(1)}s)`);
        
        const text = await res.text();
        if (!res.ok) {
            console.log(`Error Response: ${text.slice(0, 500)}`);
            return;
        }

        const data = JSON.parse(text);
        const b64 = data?.data?.[0]?.b64_json;
        const url = data?.data?.[0]?.url;
        console.log(`b64_json exists: ${!!b64}`);
        if (b64) {
            console.log(`b64_json length: ${b64.length}`);
        }
        console.log(`url exists: ${!!url}`);
        if (url) {
            console.log(`url: ${url}`);
        }
    } catch (e: any) {
        console.error(`Exception:`, e.message);
    }
}

async function main() {
    // Let's test a few models
    await testModel("openai/gpt-image-2");
    await testModel("openai/gpt-image-1.5");
    await testModel("google/imagen-3");
    await testModel("black-forest-labs/flux-1-schnell");
}

main();
