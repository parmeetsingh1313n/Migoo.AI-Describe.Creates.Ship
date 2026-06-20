import fs from 'fs';
import path from 'path';

const API_KEY  = 'pollo_61Jnpf5RrGVwfMmrmznmApL0hsX0gWgsEhBrE66KPSwA';
const BASE_URL = 'https://pollo.ai/api/platform';

const HEADERS = {
  'Content-Type': 'application/json',
  'x-api-key': API_KEY,
};

// Color helper functions for console styling
const c = {
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

// ─── Polling helper ───────────────────────────────────────────────────────────
const STATUS_ENDPOINTS = (taskId) => [
  `${BASE_URL}/generation/${taskId}/status`,
  `${BASE_URL}/generation/${taskId}`,
  `${BASE_URL}/generations/${taskId}`,
  `${BASE_URL}/task/${taskId}`,
  `${BASE_URL}/generation/task/${taskId}`,
];

async function pollTask(taskId, label = 'Task', maxWaitMs = 10 * 60 * 1000) {
  console.log(c.cyan(`\n⏳ Polling ${label} (taskId: ${taskId})...`));

  let workingUrl = null;
  for (const url of STATUS_ENDPOINTS(taskId)) {
    try {
      const r = await fetch(url, { headers: HEADERS });
      const text = await r.text();
      console.log(`   Trying status endpoint: ${url}`);
      console.log(`   → Status: ${r.status}  Response: ${text.slice(0, 300)}`);
      if (r.ok || r.status === 200) {
        try {
          const parsed = JSON.parse(text);
          if (parsed.status || parsed.data?.status || parsed.code) {
            workingUrl = url;
            break;
          }
        } catch (_) {}
      }
    } catch (err) { 
      console.log(`   → Error: ${err.message}`);
    }
  }

  if (!workingUrl) {
    console.log(c.yellow(`⚠️  Could not find a working status endpoint.`));
    return null;
  }

  console.log(c.green(`✅ Status endpoint found: ${workingUrl}`));

  const start    = Date.now();
  const interval = 5_000;

  while (Date.now() - start < maxWaitMs) {
    await new Promise(resolve => setTimeout(resolve, interval));

    const res  = await fetch(workingUrl, { headers: HEADERS });
    const data = await res.json();
    const gen = data?.data?.generations?.[0];
    const status = gen?.status || data?.data?.status || data?.status || 'unknown';
    const elapsed = Math.round((Date.now() - start) / 1000);
    console.log(`   [${elapsed}s] status: ${c.yellow(status)}`);

    if (status === 'succeed' || status === 'success' || status === 'completed') {
      const output = gen?.url || data?.data?.output || data?.output || data?.data?.url || data?.url;
      console.log(c.green(`\n🎉 ${label} DONE!`));
      console.log(c.bold(`   Output URL: ${output}`));
      return output;
    }

    if (status === 'failed' || status === 'error') {
      const err = gen?.failMsg || data?.data?.error || data?.error || JSON.stringify(data);
      console.log(c.red(`\n❌ ${label} FAILED: ${err}`));
      return null;
    }
  }

  console.log(c.red(`\n⏰ Timeout waiting for ${label} after ${maxWaitMs / 1000}s`));
  return null;
}

// ─── Phase 1: GPT Image 2.0 ──────────────────────────────────────────────────
async function generateImage() {
  console.log(c.bold(c.cyan('\n════════════════════════════════════════════════════════════')));
  console.log(c.bold('   PHASE 1: GENERATE BABA DEEP SINGH JI IMAGE (GPT IMAGE 2.0) '));
  console.log(c.bold(c.cyan('════════════════════════════════════════════════════════════')));

  const prompt = [
    'A photorealistic cinematic full-body shot of Baba Deep Singh Ji, the legendary Sikh warrior saint.',
    'Standing in front of Sri Harmandir Sahib (The Golden Temple) under a starry night sky.',
    'He is an elderly, powerful Sikh warrior in his late 60s with a majestic long flowing white beard and deep, wise, intense eyes.',
    'He is wearing a traditional dark blue turban (Dumala) adorned with small steel weapons (shastars) and a steel quoit (chakkar).',
    'He is dressed in a full-length traditional dark blue warrior chola (robe) with a saffron sash (kamarkassa) around his waist, showing his full attire down to his feet.',
    'In his hand, he holds a heavy, steel double-edged sword (khanda) resting on the ground.',
    'Reflective pool water with beautiful temple reflections in the background, 8K resolution, highly detailed skin textures, realistic facial features, cinematic lighting, photorealism.',
  ].join(' ');

  const body = {
    input: {
      prompt,
      resolution: '1K',
      quality: 'medium', // 0.97 credits
      aspectRatio: '1:1',
    },
  };

  console.log(`\n📤 Sending request to GPT Image 2.0...`);
  console.log(`   Prompt: "${prompt.slice(0, 100)}..."`);

  const res  = await fetch(`${BASE_URL}/generation/openai/gpt-image-2-0/image`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(body),
  });

  const data = await res.json();
  console.log('\n📥 Raw Response:', JSON.stringify(data, null, 2));

  if (data?.code !== 'SUCCESS' && !data?.data?.taskId) {
    throw new Error('Failed to create image generation task');
  }

  const taskId = data?.data?.taskId;
  console.log(c.green(`✅ Task created: ${taskId}`));

  const imageUrl = await pollTask(taskId, 'GPT Image 2.0', 5 * 60 * 1000);
  if (!imageUrl) {
    throw new Error('Image generation failed or timed out');
  }

  // Save image locally
  const imageRes = await fetch(imageUrl);
  const buffer = Buffer.from(await imageRes.arrayBuffer());
  const destDir = path.join(process.cwd(), 'scripts');
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }
  fs.writeFileSync(path.join(destDir, 'pollinations-image-test.jpg'), buffer);
  console.log(c.green(`✅ Saved image to scripts/pollinations-image-test.jpg`));

  return imageUrl;
}

// ─── Phase 2: Seedance 1.5 Pro ────────────────────────────────────────────────
async function generateVideo(imageUrl) {
  console.log(c.bold(c.cyan('\n════════════════════════════════════════════════════════════')));
  console.log(c.bold('   PHASE 2: GENERATE VIDEO FROM IMAGE (SEEDANCE 1.5 PRO)    '));
  console.log(c.bold(c.cyan('════════════════════════════════════════════════════════════')));

  const prompt = 'Baba Deep Singh Ji standing heroically, wind gently blowing his flowing white beard and dark blue robe, cinematic lighting, slow motion movement.';

  const body = {
    input: {
      image: imageUrl,
      prompt,
      resolution: '480p', // 1 credit for 5 seconds duration
      length: 5,
      aspectRatio: '1:1',
      cameraFixed: false,
      generateAudio: false
    }
  };

  console.log(`\n📤 Sending request to Seedance 1.5 Pro...`);
  console.log(`   Image URL: ${imageUrl}`);
  console.log(`   Prompt: "${prompt}"`);

  const res = await fetch(`${BASE_URL}/generation/bytedance/seedance-1-5-pro`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(body)
  });

  const data = await res.json();
  console.log('\n📥 Raw Response:', JSON.stringify(data, null, 2));

  if (data?.code !== 'SUCCESS' && !data?.data?.taskId) {
    throw new Error('Failed to create video generation task');
  }

  const taskId = data?.data?.taskId;
  console.log(c.green(`✅ Task created: ${taskId}`));

  const videoUrl = await pollTask(taskId, 'Seedance 1.5 Pro Video', 10 * 60 * 1000);
  if (!videoUrl) {
    throw new Error('Video generation failed or timed out');
  }

  // Save video locally
  console.log(`\n⬇️ Downloading generated video from: ${c.cyan(videoUrl)}`);
  const videoRes = await fetch(videoUrl);
  const buffer = Buffer.from(await videoRes.arrayBuffer());
  const destDir = path.join(process.cwd(), 'scripts');
  fs.writeFileSync(path.join(destDir, 'pollinations-test.mp4'), buffer);
  console.log(c.bold(c.green(`\n🎉 SUCCESS! Video saved locally to scripts/pollinations-test.mp4\n`)));
}

// ─── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  try {
    let imageUrl = process.argv[2];
    
    if (!imageUrl) {
      // Step 1: Generate the image first
      imageUrl = await generateImage();
    } else {
      console.log(c.yellow(`\nℹ️ Using provided image URL: ${imageUrl}`));
    }
    
    // Step 2: Pass that image to the Seedance 1.5 Pro video generator
    await generateVideo(imageUrl);
    
  } catch (err) {
    console.error(c.red(`\n❌ Error: ${err.message}`));
  }
})();
