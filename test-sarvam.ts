import * as dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config({ path: ".env" });

const SARVAM_API_KEY = process.env.SARVAM_API_KEY;

async function testTTS() {
    console.log("Testing Sarvam TTS...");
    console.log("Using API Key:", SARVAM_API_KEY ? `${SARVAM_API_KEY.substring(0, 10)}...` : "UNDEFINED");
    
    try {
        const res = await fetch("https://api.sarvam.ai/text-to-speech", {
            method: "POST",
            headers: { 
                "api-subscription-key": SARVAM_API_KEY || "", 
                "Content-Type": "application/json" 
            },
            body: JSON.stringify({ 
                text: "Hello! This is a test of the Sarvam Text to Speech API to ensure it works correctly with our video course generator.", 
                target_language_code: "en-IN", 
                speaker: "kabir", 
                pace: 1.05, 
                speech_sample_rate: 22050, 
                enable_preprocessing: true, 
                model: "bulbul:v3", 
                temperature: 0.6, 
                output_audio_codec: "wav" 
            }),
        });
        
        console.log("HTTP Response Status:", res.status);
        const text = await res.text();
        console.log("Response text length:", text.length);
        
        if (!res.ok) {
            console.error("❌ Sarvam TTS API Error:", text);
            return;
        }
        
        const data = JSON.parse(text);
        if (data.audios?.[0]) {
            console.log("✅ Sarvam TTS Succeeded! Received audio buffer base64 length:", data.audios[0].length);
        } else {
            console.error("❌ No audio returned in response:", data);
        }
    } catch (e: any) {
        console.error("❌ TTS Test crashed with exception:", e);
    }
}

testTTS().catch(console.error);
