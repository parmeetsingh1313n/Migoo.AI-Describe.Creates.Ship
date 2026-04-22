import fetch from 'node-fetch';
import * as dotenv from 'dotenv';
dotenv.config();

async function testSeedance() {
    const apiKey = process.env.LEONARDO_API_KEY;
    console.log("Testing with key:", apiKey?.substring(0, 10) + "...");

    const payload = {
        model: "seedance-1.0-pro-fast",
        public: false,
        parameters: {
            prompt: "A beautifully painted landscape of a forest at sunset, slow pan.",
            duration: 4,
            width: 1248,
            height: 704
        }
    };

    const res = await fetch("https://cloud.leonardo.ai/api/rest/v2/generations", {
        method: "POST",
        headers: {
            "accept": "application/json",
            "authorization": `Bearer ${apiKey}`,
            "content-type": "application/json"
        },
        body: JSON.stringify(payload)
    });

    const text = await res.text();
    console.log("Status:", res.status);
    console.log("Response:", text);
}

testSeedance().catch(console.error);
