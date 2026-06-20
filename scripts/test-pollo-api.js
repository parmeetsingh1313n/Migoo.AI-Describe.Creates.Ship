/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Pollo AI API — Test Script
 * Tests: GPT Image 2.0 (text→image) + Seedance 1.5 Pro (text→video)
 *
 * Run:  node scripts/test-pollo-api.js
 * ─────────────────────────────────────────────────────────────────────────────
 */

const API_KEY  = 'pollo_61Jnpf5RrGVwfMmrmznmApL0hsX0gWgsEhBrE66KPSwA';
const BASE_URL = 'https://pollo.ai/api/platform';

const HEADERS = {
  'Content-Type': 'application/json',
  'x-api-key': API_KEY,
};

// ─── Colour helpers ───────────────────────────────────────────────────────────
const c = {
  green:  (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  red:    (s) => `\x1b[31m${s}\x1b[0m`,
  cyan:   (s) => `\x1b[36m${s}\x1b[0m`,
  bold:   (s) => `\x1b[1m${s}\x1b[0m`,
};

// ─── Polling helper ───────────────────────────────────────────────────────────
// Tries multiple possible status-endpoint patterns until one works
const STATUS_ENDPOINTS = (taskId) => [
  `${BASE_URL}/generation/${taskId}/status`,
  `${BASE_URL}/generation/${taskId}`,
  `${BASE_URL}/generations/${taskId}`,
  `${BASE_URL}/task/${taskId}`,
  `${BASE_URL}/generation/task/${taskId}`,
];

async function pollTask(taskId, label = 'Task', maxWaitMs = 3 * 60 * 1000) {
  console.log(c.cyan(`\n⏳ Polling ${label} (taskId: ${taskId})...`));

  // ── Discover which status endpoint works ──────────────────────────────────
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
          // Check if it looks like a valid response
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
    console.log(c.yellow(`⚠️  Could not find a working status endpoint. Tried:`));
    STATUS_ENDPOINTS(taskId).forEach(u => console.log('   ', u));
    console.log(c.yellow(`   → The generation may still complete. Check your Pollo dashboard.`));
    return null;
  }

  console.log(c.green(`✅ Status endpoint found: ${workingUrl}`));

  // ── Poll until done ───────────────────────────────────────────────────────
  const start    = Date.now();
  const interval = 5_000; // poll every 5s

  while (Date.now() - start < maxWaitMs) {
    await sleep(interval);

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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Test 1: GPT Image 2.0 — Text to Image ───────────────────────────────────
async function testGptImage() {
  console.log(c.bold(c.cyan('\n═══════════════════════════════════════════')));
  console.log(c.bold('  TEST 1: GPT Image 2.0 — Text to Image'));
  console.log(c.bold(c.cyan('═══════════════════════════════════════════')));

  const prompt = [
    'A photorealistic cinematic portrait of Baba Deep Singh Ji, the legendary Sikh warrior saint.',
    'An elderly, powerful Sikh warrior in his late 60s with a majestic long flowing white beard',
    'and deep, wise, intense eyes.',
    'He is wearing a traditional dark blue turban (Dumala) adorned with small steel weapons (shastars)',
    'and a steel quoit (chakkar).',
    'He wears a traditional dark blue warrior chola (robe) with a sash.',
    'In his hand, he holds a heavy, steel double-edged sword (khanda).',
    'The background is a dramatic atmospheric battlefield at sunset with subtle dust particles and golden light rays.',
    '8K resolution, highly detailed skin textures, realistic facial features, cinematic lighting, photorealism.',
  ].join(' ');

  const body = {
    input: {
      prompt,
      resolution: '1K',
      quality: 'high',
      aspectRatio: '1:1', // required by Zod schema
    },
  };

  console.log(`\n📤 Sending request to GPT Image 2.0...`);
  console.log(`   Prompt: "${prompt.slice(0, 80)}..."`);

  try {
    const res  = await fetch(`${BASE_URL}/generation/openai/gpt-image-2-0/image`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify(body),
    });

    const data = await res.json();
    console.log('\n📥 Raw response:', JSON.stringify(data, null, 2));

    if (data?.code !== 'SUCCESS' && !data?.data?.taskId) {
      console.log(c.red('❌ Failed to create image task'));
      return;
    }

    const taskId = data?.data?.taskId;
    console.log(c.green(`✅ Task created: ${taskId}  (status: ${data?.data?.status})`));

    await pollTask(taskId, 'GPT Image 2.0');
  } catch (err) {
    console.log(c.red(`❌ Request error: ${err.message}`));
  }
}

// ─── Test 2: Seedance 1.5 Pro — Text to Video ────────────────────────────────
async function testSeedanceVideo() {
  console.log(c.bold(c.cyan('\n═══════════════════════════════════════════')));
  console.log(c.bold('  TEST 2: Seedance 1.5 Pro — Text to Video'));
  console.log(c.bold(c.cyan('═══════════════════════════════════════════')));

  const prompt = [
    'Cinematic vertical shot of the Golden Temple (Harmandir Sahib) at sunrise,',
    'golden reflections shimmering on the sacred Amrit Sarovar pool,',
    'Sikh pilgrims walking peacefully on white marble Parikrama,',
    'slow dramatic push-in camera movement, photorealistic, 4K quality.',
  ].join(' ');

  const body = {
    input: {
      prompt,
      resolution: '720p',
      length: 5,
      aspectRatio: '9:16',   // vertical — YouTube Shorts
      cameraFixed: false,
      generateAudio: false,  // no audio — we add voiceover separately
    },
  };

  console.log(`\n📤 Sending request to Seedance 1.5 Pro...`);
  console.log(`   Prompt: "${prompt.slice(0, 80)}..."`);

  try {
    const res  = await fetch(`${BASE_URL}/generation/bytedance/seedance-1-5-pro`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify(body),
    });

    const data = await res.json();
    console.log('\n📥 Raw response:', JSON.stringify(data, null, 2));

    if (data?.code !== 'SUCCESS' && !data?.data?.taskId) {
      console.log(c.red('❌ Failed to create video task'));
      return;
    }

    const taskId = data?.data?.taskId;
    console.log(c.green(`✅ Task created: ${taskId}  (status: ${data?.data?.status})`));

    await pollTask(taskId, 'Seedance 1.5 Pro Video', 5 * 60 * 1000); // 5 min timeout
  } catch (err) {
    console.log(c.red(`❌ Request error: ${err.message}`));
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  console.log(c.bold('\n🚀 Pollo AI API Test Suite'));
  console.log(`   API Key: ${API_KEY.slice(0, 18)}...`);
  console.log(`   Base URL: ${BASE_URL}`);

  await testGptImage();
  // await testSeedanceVideo();

  console.log(c.bold(c.green('\n\n✅ All tests complete.')));
  console.log('If URLs were found, open them in your browser to view the generated media.\n');
})();
