import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// ── Job tracking ─────────────────────────────────────────────────────────────
type JobState = { status: 'rendering'|'completed'|'failed'; progress: number; url?: string; error?: string; };
const renderJobs = new Map<string, JobState>();

function log(id: string, msg: string) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(`🎬 [render/${id.slice(0,8)}] ${msg}`);
  try { fs.mkdirSync(path.join(process.cwd(),'public','renders'),{recursive:true}); fs.appendFileSync(path.join(process.cwd(),'public','renders',`chapter-${id}.log`),line+'\n'); } catch {}
}

function getFFmpeg(): string {
  const bin = require('ffmpeg-static') as string;
  return fs.existsSync(bin) ? bin : path.join(process.cwd(),'node_modules','ffmpeg-static',process.platform==='win32'?'ffmpeg.exe':'ffmpeg');
}

// ── Download audio ────────────────────────────────────────────────────────────
async function downloadAudioToDisk(url: string, dest: string): Promise<string> {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 100) return dest;
  fs.mkdirSync(path.dirname(dest), {recursive:true});
  const headers: Record<string,string> = {};
  let fetchUrl = url;
  if (fetchUrl.includes('appwrite.io') && fetchUrl.includes('/storage')) {
    const pid = fetchUrl.match(/[?&]project=([^&]+)/)?.[1];
    for (const s of ['','1','2','3','4','5']) {
      const p = process.env[`APPWRITE_PROJECT_ID${s}`], k = process.env[`APPWRITE_API_KEY${s}`];
      if (p && k && p === pid) { headers['X-Appwrite-Key']=k; headers['X-Appwrite-Project']=p; break; }
    }
    if (!headers['X-Appwrite-Key']) { headers['X-Appwrite-Key']=process.env.APPWRITE_API_KEY??''; headers['X-Appwrite-Project']=process.env.APPWRITE_PROJECT_ID??''; }
    fetchUrl = fetchUrl.replace(/[?&]project=[^&]+/,'').replace(/\?$/,'').replace(/\/v1\/\/storage/,'/v1/storage');
  }
  const res = await fetch(fetchUrl, {headers});
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
  return dest;
}

// ── Build reveal intervals (matches ChapterVideo.tsx player logic exactly) ────
type RevealInterval = { startSec: number; endSec: number; revealIds: string[]; fragmentIndex: number; isLegacy: boolean; };

function buildRevealIntervals(slide: any, totalSec: number): RevealInterval[] {
  const revealData: string[] = slide.revealData ?? [];
  const fragmentData: number[]|undefined = slide.fragmentData;
  const chunks: any[] = slide.caption?.chunks ?? [];

  const isLegacy = revealData.length > 0 && String(revealData[0]).startsWith('r');
  const isNewFrag = Array.isArray(fragmentData) && fragmentData.length > 0;

  if (isLegacy) {
    // Build cumulative reveal states at caption timestamps
    const events: Array<{at:number; ids:string[]}> = [];
    let cum: string[] = [];
    for (let i = 0; i < revealData.length; i++) {
      cum = [...cum, revealData[i]];
      const at = Math.max(0, (chunks[i]?.timestamp?.[0] ?? (i * 1.2)) - 0.05);
      events.push({ at, ids: [...cum] });
    }
    events.sort((a,b) => a.at - b.at);

    const result: RevealInterval[] = [];
    // Initial state: show r1 from t=0 until first event
    if (events.length === 0) return [{ startSec:0, endSec:totalSec, revealIds:revealData, fragmentIndex:-1, isLegacy:true }];
    if (events[0].at > 0.05) result.push({ startSec:0, endSec:events[0].at, revealIds:[revealData[0]], fragmentIndex:-1, isLegacy:true });
    for (let i = 0; i < events.length; i++) {
      result.push({ startSec:events[i].at, endSec: i+1<events.length ? events[i+1].at : totalSec, revealIds:events[i].ids, fragmentIndex:-1, isLegacy:true });
    }
    return result;

  } else if (isNewFrag) {
    const events: Array<{at:number; idx:number}> = [];
    const data = fragmentData!;
    for (let i = 0; i < data.length; i++) {
      events.push({ at: Math.max(0,(chunks[i]?.timestamp?.[0] ?? (i*1.2))-0.05), idx: data[i] });
    }
    events.sort((a,b) => a.at - b.at);

    const result: RevealInterval[] = [];
    if (events.length === 0) return [{ startSec:0, endSec:totalSec, revealIds:[], fragmentIndex:999, isLegacy:false }];
    if (events[0].at > 0.05) result.push({ startSec:0, endSec:events[0].at, revealIds:[], fragmentIndex:-1, isLegacy:false });
    for (let i = 0; i < events.length; i++) {
      result.push({ startSec:events[i].at, endSec:i+1<events.length?events[i+1].at:totalSec, revealIds:[], fragmentIndex:events[i].idx, isLegacy:false });
    }
    return result;

  } else {
    // No reveals — show everything
    return [{ startSec:0, endSec:totalSec, revealIds:revealData, fragmentIndex:999, isLegacy:false }];
  }
}

// ── Build HTML for a specific reveal state ────────────────────────────────────
function buildRevealHtml(html: string, interval: RevealInterval): string {
  let content = html
    .replace(/<!DOCTYPE[^>]*>/gi,'')
    .replace(/<\/?html[^>]*>/gi,'');
  const headMatch = content.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
  const headContent = headMatch ? headMatch[1] : '';
  content = content.replace(/<head[^>]*>[\s\S]*?<\/head>/i,'');
  const bodyMatch = content.match(/<body([^>]*)>([\s\S]*)<\/body>/i);
  const bodyAttrs = bodyMatch ? bodyMatch[1] : '';
  content = bodyMatch ? bodyMatch[2] : content.replace(/<\/?body[^>]*>/gi,'');

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
    document.querySelectorAll('[data-background-gradient]').forEach(function(el){var g=el.getAttribute('data-background-gradient');if(g){el.style.background=g;el.style.minHeight='720px';el.style.minWidth='1280px';}});
    document.querySelectorAll('[data-background-color]').forEach(function(el){var c=el.getAttribute('data-background-color');if(c){el.style.backgroundColor=c;el.style.minHeight='720px';}});
    var fb=document.querySelector('[data-background-gradient]');if(fb){document.body.style.background=fb.getAttribute('data-background-gradient')||'';}`;

  return `<!DOCTYPE html><html><head><meta charset="UTF-8">${headContent}
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=Outfit:wght@300;400;500;600;700;800;900&family=Poppins:wght@300;400;500;600;700;800;900&family=Space+Grotesk:wght@400;500;600;700&display=swap');
*{box-sizing:border-box;margin:0;padding:0;}
body{width:1280px;height:720px;overflow:hidden;background:#0f172a;}
section{width:1280px!important;height:720px!important;max-height:720px!important;overflow:hidden!important;}
[data-reveal]{opacity:0;transition:none;}[data-reveal].active{opacity:1!important;transform:none!important;}
[data-fragment-index]{opacity:0;transition:none;}[data-fragment-index].visible{opacity:1!important;transform:none!important;filter:none!important;}
.glassmorphism-card,.glass-card,.glass{background:rgba(255,255,255,0.07)!important;backdrop-filter:blur(16px)!important;border:1px solid rgba(255,255,255,0.13)!important;border-radius:14px!important;padding:12px 16px!important;}
.card,.box,.info-card,.feature-card,.stat-card{background:rgba(255,255,255,0.07)!important;border:1px solid rgba(255,255,255,0.12)!important;border-radius:12px!important;padding:12px 16px!important;}
.gradient-border-card,.glowing-card{background:#0f172a!important;box-shadow:0 0 0 2px rgba(139,92,246,0.55)!important;border-radius:12px!important;padding:12px 16px!important;}
img{max-width:100%;}
</style></head>
<body${bodyAttrs} style="margin:0;padding:0;width:1280px;height:720px;overflow:hidden;background:#0f172a;">
${content}
<script>(function(){${bgScript}${revealScript}})();</script>
</body></html>`;
}

// ── Screenshot HTML via Puppeteer ─────────────────────────────────────────────
async function screenshot(html: string, outPath: string): Promise<void> {
  const puppeteer = await import('puppeteer');
  const browser = await puppeteer.default.launch({
    headless: true,
    args:['--no-sandbox','--disable-setuid-sandbox','--disable-gpu','--disable-dev-shm-usage','--window-size=1280,720'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({width:1280,height:720,deviceScaleFactor:1});
    await page.setContent(html, {waitUntil:'domcontentloaded',timeout:15000});
    await new Promise(r => setTimeout(r,600));
    await page.screenshot({path: outPath as `${string}.png`, type:'png', clip:{x:0,y:0,width:1280,height:720}});
  } finally { await browser.close(); }
}

// ── FFmpeg: image loop + audio segment → mp4 ─────────────────────────────────
async function makeClip(
  imgPath: string,
  audioPath: string,
  audioStart: number,
  duration: number,
  out: string,
  prevImgPath?: string
): Promise<void> {
  const ff = getFFmpeg();
  const fd = Math.min(0.5, duration / 2); // transition duration (0.5s max, or half of clip if extremely short)
  const hasPrev = prevImgPath && fs.existsSync(prevImgPath);

  const cmd = [
    `"${ff}" -y`,
    hasPrev ? `-loop 1 -framerate 30 -t ${duration.toFixed(3)} -i "${prevImgPath}"` : '',
    `-loop 1 -framerate 30 -t ${duration.toFixed(3)} -i "${imgPath}"`,
    `-ss ${audioStart.toFixed(3)} -t ${duration.toFixed(3)} -i "${audioPath}"`,
    `-c:v libx264 -preset fast -crf 18 -pix_fmt yuv420p`,
    hasPrev
      ? `-filter_complex "[1:v]format=yuva420p,fade=t=in:st=0:d=${fd.toFixed(3)}:alpha=1[fadein];[0:v][fadein]overlay=x=0:y=0,scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1"`
      : `-vf "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1"`,
    `-c:a aac -b:a 192k -ar 44100`,
    `-t ${duration.toFixed(3)} -movflags +faststart`,
    `"${out}"`,
  ].filter(Boolean).join(' ');

  await execAsync(cmd, {maxBuffer:100*1024*1024, timeout:1800000});
}

// ── FFmpeg concat ─────────────────────────────────────────────────────────────
async function concat(clips: string[], out: string): Promise<void> {
  const ff = getFFmpeg();
  const lst = out.replace('.mp4','_list.txt');
  fs.writeFileSync(lst, clips.map(c=>`file '${c.replace(/\\/g,'/')}'`).join('\n'));
  const cmd = `"${ff}" -y -f concat -safe 0 -i "${lst}" -c copy "${out}"`;
  await execAsync(cmd, {maxBuffer:500*1024*1024, timeout:30*60*1000});
  try { fs.unlinkSync(lst); } catch {}
}

// ── Main render pipeline ──────────────────────────────────────────────────────
async function startRender(chapterId: string, slides: any[], durationsBySlideId: Record<string,number>, fps: number, outputPath: string) {
  const workDir = path.join(process.cwd(),'public','tmp','render-work',chapterId);
  fs.mkdirSync(workDir,{recursive:true});
  fs.mkdirSync(path.dirname(outputPath),{recursive:true});

  log(chapterId, `🚀 Started. ${slides.length} slides, FFmpeg+Puppeteer mode`);
  const slideClips: string[] = [];
  const totalSlides = slides.length;

  for (let i = 0; i < totalSlides; i++) {
    const slide = slides[i];
    const durationFrames = durationsBySlideId[slide.slideId] ?? (6*fps);
    const totalSec = durationFrames / fps;
    const baseProgress = Math.round((i / totalSlides) * 90);
    renderJobs.set(chapterId, {status:'rendering', progress:baseProgress});

    log(chapterId, `📽 Slide ${i+1}/${totalSlides} — ${totalSec.toFixed(1)}s`);

    // Download audio
    const ext = (slide.audioFileUrl??'').match(/\.(mp3|wav|ogg|aac)/i)?.[1]??'mp3';
    const audioPath = path.join(workDir,`audio-${i}.${ext}`);
    try {
      await downloadAudioToDisk(slide.audioFileUrl, audioPath);
      log(chapterId, `  🎵 Audio ready`);
    } catch(e:any) {
      log(chapterId, `  ⚠️ Audio failed: ${e.message} — making silent`);
      await execAsync(`"${getFFmpeg()}" -y -f lavfi -i anullsrc=r=44100:cl=stereo -t ${totalSec.toFixed(3)} "${audioPath}"`).catch(()=>{});
    }

    // Build reveal intervals
    const intervals = buildRevealIntervals(slide, totalSec);
    log(chapterId, `  🎞 ${intervals.length} reveal state(s)`);

    const intervalClips: string[] = [];
    for (let j = 0; j < intervals.length; j++) {
      const iv = intervals[j];
      const clipDur = iv.endSec - iv.startSec;
      if (clipDur < 0.05) continue; // skip tiny intervals

      // Screenshot at this reveal state
      const imgPath = path.join(workDir,`s${i}-state${j}.png`);
      try {
        const revealHtml = buildRevealHtml(slide.html, iv);
        await screenshot(revealHtml, imgPath);
      } catch(e:any) {
        log(chapterId, `  ⚠️ Screenshot failed: ${e.message} — black frame`);
        await execAsync(`"${getFFmpeg()}" -y -f lavfi -i color=c=black:s=1280x720:r=1:d=1 -frames:v 1 "${imgPath}"`).catch(()=>{});
      }

      // Make clip: image looped + audio slice, crossfade from previous state if j > 0
      const clipPath = path.join(workDir,`s${i}-clip${j}.mp4`);
      const prevImgPath = j > 0 ? path.join(workDir,`s${i}-state${j-1}.png`) : undefined;
      await makeClip(imgPath, audioPath, iv.startSec, clipDur, clipPath, prevImgPath);
      intervalClips.push(clipPath);
    }

    // Concat all interval clips → one slide clip
    const slideClip = path.join(workDir,`slide-${i}.mp4`);
    if (intervalClips.length === 1) {
      fs.renameSync(intervalClips[0], slideClip);
    } else if (intervalClips.length > 1) {
      await concat(intervalClips, slideClip);
    } else {
      // Fallback: silent black
      await execAsync(`"${getFFmpeg()}" -y -f lavfi -i color=c=black:s=1280x720:r=30:d=${totalSec.toFixed(3)} -f lavfi -i anullsrc=r=44100:cl=stereo -c:v libx264 -c:a aac -t ${totalSec.toFixed(3)} "${slideClip}"`).catch(()=>{});
    }
    slideClips.push(slideClip);
    log(chapterId, `  ✅ Slide ${i+1} done`);
  }

  // Final concat
  log(chapterId, `🔗 Concatenating ${slideClips.length} slides...`);
  renderJobs.set(chapterId, {status:'rendering', progress:93});
  await concat(slideClips, outputPath);

  const mb = fs.existsSync(outputPath) ? (fs.statSync(outputPath).size/1024/1024).toFixed(1) : '?';
  log(chapterId, `🏁 DONE! ${mb} MB → ${outputPath}`);
  renderJobs.set(chapterId, {status:'completed', progress:100, url:`/renders/chapter-${chapterId}.mp4`});
  try { fs.rmSync(workDir,{recursive:true,force:true}); } catch {}
}

// ── POST ──────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({error:'Invalid JSON'},{status:400}); }
  const { chapterId, slides, durationsBySlideId, totalFrames } = body;
  if (!chapterId || !slides?.length || !durationsBySlideId) return NextResponse.json({error:'Missing fields'},{status:400});

  const existing = renderJobs.get(chapterId);
  if (existing?.status==='rendering') return NextResponse.json({status:'already_rendering', progress:existing.progress});

  const outputPath = path.join(process.cwd(),'public','renders',`chapter-${chapterId}.mp4`);
  if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 1024) {
    renderJobs.set(chapterId, {status:'completed',progress:100,url:`/renders/chapter-${chapterId}.mp4`});
    return NextResponse.json({status:'already_complete', url:`/renders/chapter-${chapterId}.mp4`});
  }

  renderJobs.set(chapterId, {status:'rendering', progress:0});
  const fps = 30;
  startRender(chapterId, slides, durationsBySlideId, fps, outputPath).catch(err => {
    log(chapterId, `❌ ${err.message}`);
    renderJobs.set(chapterId, {status:'failed', progress:0, error:String(err.message).slice(0,300)});
  });
  return NextResponse.json({status:'started', jobId:chapterId});
}

// ── GET ───────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const chapterId = req.nextUrl.searchParams.get('chapterId');
  if (!chapterId) return NextResponse.json({error:'Missing chapterId'},{status:400});
  const outputPath = path.join(process.cwd(),'public','renders',`chapter-${chapterId}.mp4`);
  const job = renderJobs.get(chapterId);
  if (!job && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 1024) return NextResponse.json({status:'completed',progress:100,url:`/renders/chapter-${chapterId}.mp4`});
  return NextResponse.json(job ?? {status:'idle',progress:0});
}
