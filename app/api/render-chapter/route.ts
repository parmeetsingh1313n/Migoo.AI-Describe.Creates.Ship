import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import { db } from '@/config/db';
import { chapterGenerationStatus, chapterContentSlides } from '@/config/schema';
import { eq } from 'drizzle-orm';

const execAsync = promisify(exec);

// ── In-memory job tracking (used for local dev only) ──────────────────────────
type JobState = { status: 'rendering' | 'completed' | 'failed'; progress: number; url?: string; error?: string; };
const renderJobs = new Map<string, JobState>();

function log(id: string, msg: string) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(`🎬 [render/${id.slice(0, 8)}] ${msg}`);
  try {
    fs.mkdirSync(path.join(process.cwd(), 'public', 'renders'), { recursive: true });
    fs.appendFileSync(path.join(process.cwd(), 'public', 'renders', `chapter-${id}.log`), line + '\n');
  } catch {}
}

function getFFmpeg(): string {
  const pkg = 'ffmpeg-static';
  const bin = require(pkg) as string;
  return fs.existsSync(bin) ? bin : path.join(process.cwd(), 'node_modules', 'ffmpeg-static', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
}

// ── Detect deployment mode ───────────────────────────────────────────────────
function isGitHubActionsMode(): boolean {
  return !!(process.env.GH_PAT && process.env.GH_OWNER && process.env.GH_REPO);
}

// ── Dispatch to GitHub Actions ───────────────────────────────────────────────
async function dispatchToGitHub(payload: {
  chapterId: string;
  fetchUrl: string;
  webhookUrl: string;
}) {
  const token = process.env.GH_PAT!;
  const owner = process.env.GH_OWNER!;
  const repo  = process.env.GH_REPO!;

  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/dispatches`, {
    method: 'POST',
    headers: {
      'Authorization':        `Bearer ${token}`,
      'Accept':               'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type':         'application/json',
    },
    body: JSON.stringify({
      event_type:     'render-chapter',
      client_payload: payload,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GitHub API ${res.status}: ${text.slice(0, 200)}`);
  }
}

// ── Build the callback URL from the incoming request ─────────────────────────
function buildCallbackUrl(req: NextRequest): string {
  // Explicit override (useful for Vercel with custom domains)
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return `${process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '')}/api/render-chapter-callback`;
  }
  const host  = req.headers.get('host') ?? 'localhost:3000';
  const proto = host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https';
  return `${proto}://${host}/api/render-chapter-callback`;
}

// ── Download audio ────────────────────────────────────────────────────────────
async function downloadAudioToDisk(url: string, dest: string): Promise<string> {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 100) return dest;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const headers: Record<string, string> = {};
  let fetchUrl = url;
  if (fetchUrl.includes('appwrite.io') && fetchUrl.includes('/storage')) {
    const pid = fetchUrl.match(/[?&]project=([^&]+)/)?.[1];
    for (const s of ['', '1', '2', '3', '4', '5']) {
      const p = process.env[`APPWRITE_PROJECT_ID${s}`], k = process.env[`APPWRITE_API_KEY${s}`];
      if (p && k && p === pid) { headers['X-Appwrite-Key'] = k; headers['X-Appwrite-Project'] = p; break; }
    }
    if (!headers['X-Appwrite-Key']) { headers['X-Appwrite-Key'] = process.env.APPWRITE_API_KEY ?? ''; headers['X-Appwrite-Project'] = process.env.APPWRITE_PROJECT_ID ?? ''; }
    fetchUrl = fetchUrl.replace(/[?&]project=[^&]+/, '').replace(/\?$/, '').replace(/\/v1\/\/storage/, '/v1/storage');
  }
  const res = await fetch(fetchUrl, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
  return dest;
}

// ── Build reveal intervals (mirrors ChapterVideo.tsx player logic) ─────────────
type RevealInterval = { startSec: number; endSec: number; revealIds: string[]; fragmentIndex: number; isLegacy: boolean; };

function buildRevealIntervals(slide: any, totalSec: number): RevealInterval[] {
  const revealData: string[] = slide.revealData ?? [];
  const fragmentData: number[] | undefined = slide.fragmentData;
  const chunks: any[] = slide.caption?.chunks ?? [];

  const isLegacy  = revealData.length > 0 && String(revealData[0]).startsWith('r');
  const isNewFrag = Array.isArray(fragmentData) && fragmentData.length > 0;

  if (isLegacy) {
    const events: Array<{ at: number; ids: string[] }> = [];
    let cum: string[] = [];
    for (let i = 0; i < revealData.length; i++) {
      cum = [...cum, revealData[i]];
      const at = Math.max(0, (chunks[i]?.timestamp?.[0] ?? (i * 1.2)) - 0.05);
      events.push({ at, ids: [...cum] });
    }
    events.sort((a, b) => a.at - b.at);
    const result: RevealInterval[] = [];
    if (events.length === 0) return [{ startSec: 0, endSec: totalSec, revealIds: revealData, fragmentIndex: -1, isLegacy: true }];
    if (events[0].at > 0.05) result.push({ startSec: 0, endSec: events[0].at, revealIds: [revealData[0]], fragmentIndex: -1, isLegacy: true });
    for (let i = 0; i < events.length; i++) {
      result.push({ startSec: events[i].at, endSec: i + 1 < events.length ? events[i + 1].at : totalSec, revealIds: events[i].ids, fragmentIndex: -1, isLegacy: true });
    }
    return result;

  } else if (isNewFrag) {
    const events: Array<{ at: number; idx: number }> = [];
    const data = fragmentData!;
    for (let i = 0; i < data.length; i++) {
      events.push({ at: Math.max(0, (chunks[i]?.timestamp?.[0] ?? (i * 1.2)) - 0.05), idx: data[i] });
    }
    events.sort((a, b) => a.at - b.at);
    const result: RevealInterval[] = [];
    if (events.length === 0) return [{ startSec: 0, endSec: totalSec, revealIds: [], fragmentIndex: 999, isLegacy: false }];
    if (events[0].at > 0.05) result.push({ startSec: 0, endSec: events[0].at, revealIds: [], fragmentIndex: -1, isLegacy: false });
    for (let i = 0; i < events.length; i++) {
      result.push({ startSec: events[i].at, endSec: i + 1 < events.length ? events[i + 1].at : totalSec, revealIds: [], fragmentIndex: events[i].idx, isLegacy: false });
    }
    return result;

  } else {
    return [{ startSec: 0, endSec: totalSec, revealIds: revealData, fragmentIndex: 999, isLegacy: false }];
  }
}

function buildRevealHtml(html: string, interval: RevealInterval, baseUrl: string): string {
  let content = html
    .replace(/<!DOCTYPE[^>]*>/gi, '')
    .replace(/<\/?html[^>]*>/gi, '');
  const headMatch   = content.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
  const headContent = headMatch ? headMatch[1] : '';
  content = content.replace(/<head[^>]*>[\s\S]*?<\/head>/i, '');
  const bodyMatch = content.match(/<body([^>]*)>([\s\S]*)<\/body>/i);
  const bodyAttrs = bodyMatch ? bodyMatch[1] : '';
  content         = bodyMatch ? bodyMatch[2] : content.replace(/<\/?body[^>]*>/gi, '');

  const baseHref = baseUrl ? `<base href="${baseUrl.replace(/\/$/, '')}/">` : '';

  const revealScript = interval.isLegacy
    ? `document.querySelectorAll('[data-reveal]').forEach(function(el){
        var id=el.getAttribute('data-reveal');
        var show=${JSON.stringify(interval.revealIds)};
        if(show.indexOf(id)>=0){el.classList.add('active');el.style.opacity='1';el.style.transform='none';}
        else{el.style.opacity='0';}
      });`
    : `document.querySelectorAll('[data-fragment-index]').forEach(function(el){
        var idx=parseInt(el.getAttribute('data-fragment-index'),10);
        if(idx<=${interval.fragmentIndex}){el.style.opacity='1';el.style.transform='none';el.style.filter='none';el.classList.add('visible');}
        else{el.style.opacity='0';}
      });`;

  const bgScript = `
    document.querySelectorAll('[data-background-gradient]').forEach(function(el){var g=el.getAttribute('data-background-gradient');if(g){el.style.background=g;el.style.minHeight='720px';el.style.minWidth='1440px';}});
    document.querySelectorAll('[data-background-color]').forEach(function(el){var c=el.getAttribute('data-background-color');if(c){el.style.backgroundColor=c;el.style.minHeight='720px';}});
    var fb=document.querySelector('[data-background-gradient]');if(fb){document.body.style.background=fb.getAttribute('data-background-gradient')||'';}`;

  const scaleScript = `
    (function() {
      var VIEWPORT_W = 1440;
      var VIEWPORT_H = 720;
      var MIN_SCALE = 0.25;
      var lastScale = -1;

      function getWrapper() {
        var children = document.body.children;
        for (var i = 0; i < children.length; i++) {
          if (children[i].tagName === 'DIV' || children[i].tagName === 'SECTION') return children[i];
        }
        return children[0];
      }

      function applyScale() {
        var wrapper = getWrapper();
        if (!wrapper) return;

        wrapper.style.transform = 'none';
        wrapper.style.width = VIEWPORT_W + 'px';
        wrapper.style.minHeight = '0';
        wrapper.style.height = 'auto';
        wrapper.style.overflow = 'visible';
        wrapper.style.position = 'relative';

        void wrapper.offsetHeight;

        var naturalH = wrapper.scrollHeight;
        var naturalW = wrapper.scrollWidth;

        var measureH = naturalH;
        if (naturalH < 100) measureH = VIEWPORT_H;
        var measureW = naturalW;
        if (naturalW < 100) measureW = VIEWPORT_W;

        var scaleY = VIEWPORT_H / Math.max(measureH, 1);
        var scaleX = VIEWPORT_W / Math.max(measureW, 1);
        var scale = Math.min(scaleX, scaleY);
        
        scale = Math.min(scale, 1.0);
        scale = Math.max(scale, MIN_SCALE);

        if (Math.abs(scale - lastScale) < 0.002) return;
        lastScale = scale;

        var scaledH = measureH * scale;
        var offsetY = Math.max(0, (VIEWPORT_H - scaledH) / 2);
        var scaledW = measureW * scale;
        var offsetX = Math.max(0, (VIEWPORT_W - scaledW) / 2);

        wrapper.style.transformOrigin = 'top left';
        wrapper.style.transform = 'translate(' + offsetX + 'px, ' + offsetY + 'px) scale(' + scale + ')';
        wrapper.style.width = VIEWPORT_W + 'px';
        wrapper.style.height = measureH + 'px';
        wrapper.style.overflow = 'visible';
      }

      var observer = new MutationObserver(function() {
        lastScale = -1;
        requestAnimationFrame(applyScale);
      });

      function init() {
        var wrapper = getWrapper();
        if (wrapper) {
          observer.observe(wrapper, { childList: true, subtree: true, attributes: true });
        }
        applyScale();
      }

      document.addEventListener('load', function(e) {
        if (e.target && e.target.tagName === 'IMG') {
          lastScale = -1;
          requestAnimationFrame(applyScale);
        }
      }, true);

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
      } else {
        init();
      }

      window.addEventListener('load', function() {
        lastScale = -1;
        applyScale();
      });
    })();
  `;

  return `<!DOCTYPE html><html><head><meta charset="UTF-8">${baseHref}${headContent}
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=Outfit:wght@300;400;500;600;700;800;900&family=Poppins:wght@300;400;500;600;700;800;900&family=Space+Grotesk:wght@400;500;600;700&display=swap');
*{box-sizing:border-box;margin:0;padding:0;}
body{width:1440px;height:720px;overflow:hidden;background:#0f172a;}
[data-reveal]{opacity:0;transition:none;}[data-reveal].active{opacity:1!important;transform:none!important;}
[data-fragment-index]{opacity:0;transition:none;}[data-fragment-index].visible{opacity:1!important;transform:none!important;filter:none!important;}
.glassmorphism-card,.glass-card,.glass{background:rgba(255,255,255,0.07)!important;backdrop-filter:blur(16px)!important;border:1px solid rgba(255,255,255,0.13)!important;border-radius:14px!important;padding:12px 16px!important;}
.card,.box,.info-card,.feature-card,.stat-card{background:rgba(255,255,255,0.07)!important;border:1px solid rgba(255,255,255,0.12)!important;border-radius:12px!important;padding:12px 16px!important;}
.gradient-border-card,.glowing-card{background:#0f172a!important;box-shadow:0 0 0 2px rgba(139,92,246,0.55)!important;border-radius:12px!important;padding:12px 16px!important;}
img{max-width:100%;}
</style></head>
<body${bodyAttrs} style="margin:0;padding:0;width:1440px;height:720px;overflow:hidden;background:#0f172a;">
${content}
<script>(function(){${bgScript}${revealScript}${scaleScript}})();</script>
</body></html>`;
}

async function screenshot(html: string, outPath: string): Promise<void> {
  const pkg = 'puppeteer';
  const puppeteer = require(pkg);
  const browser   = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--window-size=1440,720'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 720, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await new Promise(r => setTimeout(r, 600));
    await page.screenshot({ path: outPath as `${string}.png`, type: 'png', clip: { x: 0, y: 0, width: 1440, height: 720 } });
  } finally { await browser.close(); }
}

async function makeClip(imgPath: string, audioPath: string, audioStart: number, duration: number, out: string, prevImgPath?: string): Promise<void> {
  const ff = getFFmpeg();
  const fd = Math.min(0.5, duration / 2);
  const hasPrev = prevImgPath && fs.existsSync(prevImgPath);
  const cmd = [
    `"${ff}" -y`,
    hasPrev ? `-loop 1 -framerate 30 -t ${duration.toFixed(3)} -i "${prevImgPath}"` : '',
    `-loop 1 -framerate 30 -t ${duration.toFixed(3)} -i "${imgPath}"`,
    `-ss ${audioStart.toFixed(3)} -t ${duration.toFixed(3)} -i "${audioPath}"`,
    `-c:v libx264 -preset fast -crf 28 -tune stillimage -pix_fmt yuv420p`,
    hasPrev
      ? `-filter_complex "[1:v]format=yuva420p,fade=t=in:st=0:d=${fd.toFixed(3)}:alpha=1[fadein];[0:v][fadein]overlay=x=0:y=0,scale=1440:720:force_original_aspect_ratio=decrease,pad=1440:720:(ow-iw)/2:(oh-ih)/2,setsar=1"`
      : `-vf "scale=1440:720:force_original_aspect_ratio=decrease,pad=1440:720:(ow-iw)/2:(oh-ih)/2,setsar=1"`,
    `-c:a aac -b:a 128k -ar 44100`,
    `-t ${duration.toFixed(3)} -movflags +faststart`,
    `"${out}"`,
  ].filter(Boolean).join(' ');
  await execAsync(cmd, { maxBuffer: 100 * 1024 * 1024, timeout: 1800000 });
}

async function concat(clips: string[], out: string): Promise<void> {
  const ff  = getFFmpeg();
  const lst = out.replace('.mp4', '_list.txt');
  fs.writeFileSync(lst, clips.map(c => `file '${c.replace(/\\/g, '/')}'`).join('\n'));
  const cmd = `"${ff}" -y -f concat -safe 0 -i "${lst}" -c copy "${out}"`;
  await execAsync(cmd, { maxBuffer: 500 * 1024 * 1024, timeout: 30 * 60 * 1000 });
  try { fs.unlinkSync(lst); } catch {}
}

// ── Local render pipeline (used when GITHUB_TOKEN is not configured) ──────────
async function startLocalRender(chapterId: string, slides: any[], durationsBySlideId: Record<string, number>, fps: number, outputPath: string, baseUrl: string) {
  const workDir = path.join(process.cwd(), 'public', 'tmp', 'render-work', chapterId);
  fs.mkdirSync(workDir, { recursive: true });
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  log(chapterId, `🚀 Started. ${slides.length} slides, FFmpeg+Puppeteer mode`);
  const slideClips: string[] = [];
  const totalSlides = slides.length;

  for (let i = 0; i < totalSlides; i++) {
    const slide          = slides[i];
    const durationFrames = durationsBySlideId[slide.slideId] ?? Math.ceil(6 * fps);
    const totalSec       = durationFrames / fps;
    const baseProgress   = Math.round((i / totalSlides) * 90);
    renderJobs.set(chapterId, { status: 'rendering', progress: baseProgress });

    log(chapterId, `📽 Slide ${i + 1}/${totalSlides} — ${totalSec.toFixed(1)}s`);

    const ext       = (slide.audioFileUrl ?? '').match(/\.(mp3|wav|ogg|aac)/i)?.[1] ?? 'mp3';
    const audioPath = path.join(workDir, `audio-${i}.${ext}`);
    try {
      await downloadAudioToDisk(slide.audioFileUrl, audioPath);
      log(chapterId, `  🎵 Audio ready`);
    } catch (e: any) {
      log(chapterId, `  ⚠️ Audio failed: ${e.message} — making silent`);
      await execAsync(`"${getFFmpeg()}" -y -f lavfi -i anullsrc=r=44100:cl=stereo -t ${totalSec.toFixed(3)} "${audioPath}"`).catch(() => {});
    }

    const intervals = buildRevealIntervals(slide, totalSec);
    log(chapterId, `  🎞 ${intervals.length} reveal state(s)`);

    const intervalClips: string[] = [];
    for (let j = 0; j < intervals.length; j++) {
      const iv      = intervals[j];
      const clipDur = iv.endSec - iv.startSec;
      if (clipDur < 0.05) continue;

      const imgPath = path.join(workDir, `s${i}-state${j}.png`);
      try {
        const revealHtml = buildRevealHtml(slide.html, iv, baseUrl);
        await screenshot(revealHtml, imgPath);
      } catch (e: any) {
        log(chapterId, `  ⚠️ Screenshot failed: ${e.message} — black frame`);
        await execAsync(`"${getFFmpeg()}" -y -f lavfi -i color=c=black:s=1440x720:r=1:d=1 -frames:v 1 "${imgPath}"`).catch(() => {});
      }

      const clipPath    = path.join(workDir, `s${i}-clip${j}.mp4`);
      const prevImgPath = j > 0 ? path.join(workDir, `s${i}-state${j - 1}.png`) : undefined;
      await makeClip(imgPath, audioPath, iv.startSec, clipDur, clipPath, prevImgPath);
      intervalClips.push(clipPath);
    }

    const slideClip = path.join(workDir, `slide-${i}.mp4`);
    if (intervalClips.length === 1) {
      fs.renameSync(intervalClips[0], slideClip);
    } else if (intervalClips.length > 1) {
      await concat(intervalClips, slideClip);
    } else {
      await execAsync(`"${getFFmpeg()}" -y -f lavfi -i color=c=black:s=1440x720:r=30:d=${totalSec.toFixed(3)} -f lavfi -i anullsrc=r=44100:cl=stereo -c:v libx264 -c:a aac -t ${totalSec.toFixed(3)} "${slideClip}"`).catch(() => {});
    }
    slideClips.push(slideClip);
    log(chapterId, `  ✅ Slide ${i + 1} done`);
  }

  log(chapterId, `🔗 Concatenating ${slideClips.length} slides...`);
  renderJobs.set(chapterId, { status: 'rendering', progress: 93 });
  await concat(slideClips, outputPath);

  const mb = fs.existsSync(outputPath) ? (fs.statSync(outputPath).size / 1024 / 1024).toFixed(1) : '?';
  log(chapterId, `🏁 DONE! ${mb} MB → ${outputPath}`);
  renderJobs.set(chapterId, { status: 'completed', progress: 100, url: `/renders/chapter-${chapterId}.mp4` });
  try { fs.rmSync(workDir, { recursive: true, force: true }); } catch {}
}

// ── POST — start render ───────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const { chapterId, slides, durationsBySlideId, totalFrames } = body;
  if (!chapterId || !slides?.length || !durationsBySlideId) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
  }

  // ── Check if already rendering (in-memory guard for local dev) ────────────
  const existing = renderJobs.get(chapterId);
  if (existing?.status === 'rendering') {
    return NextResponse.json({ status: 'already_rendering', progress: existing.progress });
  }

  // ── Check DB for an in-progress GitHub Actions render ─────────────────────
  if (isGitHubActionsMode()) {
    try {
      const [row] = await db
        .select({ renderStatus: chapterGenerationStatus.renderStatus, videoUrl: chapterGenerationStatus.videoUrl })
        .from(chapterGenerationStatus)
        .where(eq(chapterGenerationStatus.chapterId, chapterId))
        .limit(1);

      if (row?.renderStatus === 'rendering:video') {
        return NextResponse.json({ status: 'rendering', progress: 30 });
      }
      if (row?.renderStatus === 'video:completed' && row.videoUrl) {
        return NextResponse.json({ status: 'already_complete', url: row.videoUrl });
      }
    } catch { /* DB might not have this chapter row yet — continue */ }
  }

  // ── Check if local file already exists ────────────────────────────────────
  const localOutputPath = path.join(process.cwd(), 'public', 'renders', `chapter-${chapterId}.mp4`);
  if (fs.existsSync(localOutputPath) && fs.statSync(localOutputPath).size > 1024) {
    renderJobs.set(chapterId, { status: 'completed', progress: 100, url: `/renders/chapter-${chapterId}.mp4` });
    return NextResponse.json({ status: 'already_complete', url: `/renders/chapter-${chapterId}.mp4` });
  }

  // ── GitHub Actions mode ───────────────────────────────────────────────────
  if (isGitHubActionsMode()) {
    const webhookUrl = buildCallbackUrl(req);
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ? process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '') : `${req.nextUrl.protocol}//${req.headers.get('host')}`;
    const fetchUrl = `${appUrl}/api/render-chapter?chapterId=${chapterId}&fetchData=true`;

    console.log(`🚀 Dispatching chapter render to GitHub Actions: ${chapterId}`);
    console.log(`   Callback URL: ${webhookUrl}`);
    console.log(`   Fetch URL:    ${fetchUrl}`);

    try {
      await dispatchToGitHub({ chapterId, fetchUrl, webhookUrl });

      // Mark as rendering in DB
      try {
        await db
          .update(chapterGenerationStatus)
          .set({ renderStatus: 'rendering:video', videoUrl: null, renderError: null })
          .where(eq(chapterGenerationStatus.chapterId, chapterId));
      } catch (dbErr: any) {
        console.warn('DB update failed (non-fatal):', dbErr.message);
      }

      return NextResponse.json({ status: 'started', jobId: chapterId, mode: 'github-actions' });
    } catch (ghErr: any) {
      console.error('GitHub dispatch failed:', ghErr.message);
      return NextResponse.json({ error: `GitHub dispatch failed: ${ghErr.message}` }, { status: 502 });
    }
  }

  // ── Local render mode (dev / no GitHub creds) ─────────────────────────────
  renderJobs.set(chapterId, { status: 'rendering', progress: 0 });
  const fps = 30;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ? process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '') : `${req.nextUrl.protocol}//${req.headers.get('host')}`;
  startLocalRender(chapterId, slides, durationsBySlideId, fps, localOutputPath, appUrl).catch(err => {
    log(chapterId, `❌ ${err.message}`);
    renderJobs.set(chapterId, { status: 'failed', progress: 0, error: String(err.message).slice(0, 300) });
  });
  return NextResponse.json({ status: 'started', jobId: chapterId, mode: 'local' });
}

// ── GET — poll render status ──────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const chapterId = req.nextUrl.searchParams.get('chapterId');
  if (!chapterId) return NextResponse.json({ error: 'Missing chapterId' }, { status: 400 });

  // ── Secure slide data fetch for GitHub Actions ─────────────────────────────
  const fetchData = req.nextUrl.searchParams.get('fetchData') === 'true';
  if (fetchData) {
    const authHeader = req.headers.get('x-appwrite-key') || req.headers.get('Authorization')?.replace('Bearer ', '');
    if (!authHeader || authHeader !== process.env.APPWRITE_API_KEY) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
      const dbSlides = await db
        .select()
        .from(chapterContentSlides)
        .where(eq(chapterContentSlides.chapterId, chapterId))
        .orderBy(chapterContentSlides.slideIndex);

      const slides = dbSlides.map(slide => {
        const rev = (slide.revealData as any[]) ?? [];
        const hasFragmentData = Array.isArray(rev) && rev.length > 0 && !isNaN(Number(rev[0]));
        return {
          slideId: slide.slideId,
          html: slide.html,
          audioFileUrl: slide.audioUrl,
          revealData: slide.revealData,
          fragmentData: hasFragmentData ? rev.map(Number) : undefined,
          caption: slide.captions,
        };
      });

      const durationsBySlideId: Record<string, number> = {};
      const fps = 30;
      for (const slide of dbSlides) {
        const seconds = slide.audioDuration ?? 1;
        const frames = Math.max(1, Math.ceil(seconds * fps));
        durationsBySlideId[slide.slideId] = frames;
      }

      const appUrl = process.env.NEXT_PUBLIC_APP_URL ? process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '') : `${req.nextUrl.protocol}//${req.headers.get('host')}`;
      return NextResponse.json({
        chapterId,
        slides,
        durationsBySlideId,
        baseUrl: appUrl,
      });
    } catch (dbErr: any) {
      return NextResponse.json({ error: `Failed to fetch chapter data: ${dbErr.message}` }, { status: 500 });
    }
  }

  // 1. Check local file first (completed local dev renders)
  const localOutputPath = path.join(process.cwd(), 'public', 'renders', `chapter-${chapterId}.mp4`);
  if (fs.existsSync(localOutputPath) && fs.statSync(localOutputPath).size > 1024) {
    renderJobs.set(chapterId, { status: 'completed', progress: 100, url: `/renders/chapter-${chapterId}.mp4` });
    return NextResponse.json({ status: 'completed', progress: 100, url: `/renders/chapter-${chapterId}.mp4` });
  }

  // 2. Check local in-memory Map (in-progress local dev renders)
  const job = renderJobs.get(chapterId);
  if (job) {
    return NextResponse.json(job);
  }

  // 3. Fall back to checking DB (works for GitHub Actions and deployed database)
  try {
    const [row] = await db
      .select({
        renderStatus: chapterGenerationStatus.renderStatus,
        videoUrl:     chapterGenerationStatus.videoUrl,
        renderError:  chapterGenerationStatus.renderError,
      })
      .from(chapterGenerationStatus)
      .where(eq(chapterGenerationStatus.chapterId, chapterId))
      .limit(1);

    if (row?.renderStatus === 'video:completed' && row.videoUrl) {
      return NextResponse.json({ status: 'completed', progress: 100, url: row.videoUrl });
    }
    // Only report rendering from DB if we are running in GitHub Actions mode
    if (isGitHubActionsMode() && row?.renderStatus === 'rendering:video') {
      return NextResponse.json({ status: 'rendering', progress: 50 });
    }
    if (row?.renderStatus === 'video:failed') {
      return NextResponse.json({ status: 'failed', error: row.renderError ?? 'Render failed' });
    }
  } catch { /* DB error — fall through */ }

  return NextResponse.json({ status: 'idle', progress: 0 });
}
