#!/usr/bin/env node
/**
 * render-chapter-gh.js
 *
 * Standalone Puppeteer + FFmpeg chapter render script.
 * Runs inside a GitHub Actions ubuntu runner.
 *
 * Input  : tmp/chapter-payload.json  (written by the workflow before this script)
 * Output : out/chapter-{chapterId}.mp4
 *
 * Environment variables (provided as GitHub Secrets):
 *   APPWRITE_ENDPOINT      - e.g. https://fra.cloud.appwrite.io/v1
 *   APPWRITE_PROJECT_ID    - Primary Appwrite project ID
 *   APPWRITE_API_KEY       - Server API key (storage.read scope)
 *   APPWRITE_PROJECT_ID1…5 - Extra project IDs  (optional, multi-project support)
 *   APPWRITE_API_KEY1…5    - Extra API keys    (optional, multi-project support)
 */

'use strict';

const fs      = require('fs');
const path    = require('path');
const { exec }    = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

// ── Load payload ────────────────────────────────────────────────────────────
const payloadPath = path.join(process.cwd(), 'tmp', 'chapter-payload.json');
if (!fs.existsSync(payloadPath)) {
  console.error('❌ tmp/chapter-payload.json not found');
  process.exit(1);
}
const payload = JSON.parse(fs.readFileSync(payloadPath, 'utf-8'));
const { chapterId, fetchUrl } = payload;
let slides = payload.slides;
let durationsBySlideId = payload.durationsBySlideId;
let baseUrl = payload.baseUrl || '';

// Webhook URL for posting progress + completion back to Vercel
const webhookUrl = payload.webhookUrl || process.env.WEBHOOK_URL || '';

// ── Helper: POST progress to callback URL ───────────────────────────────────
async function postProgress(slidesComplete, slidesTotal) {
  if (!webhookUrl) return;
  // Map slides → 0-90% range. 90-99 reserved for concat/upload.
  const pct = Math.round((slidesComplete / slidesTotal) * 90);
  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chapterId,
        status: 'progress',
        progress: pct,
        slidesComplete,
        slidesTotal,
      }),
    });
    console.log(`📊 Progress update sent: ${pct}% (${slidesComplete}/${slidesTotal} slides)`);
  } catch (e) {
    console.warn(`⚠️  Failed to POST progress: ${e.message}`);
  }
}

if (!chapterId) {
  console.error('❌ Invalid payload — missing chapterId');
  process.exit(1);
}

const fps     = 30;
const workDir = path.join(process.cwd(), 'tmp', 'render-work', chapterId);
const outDir  = path.join(process.cwd(), 'out');
const outFile = path.join(outDir, `chapter-${chapterId}.mp4`);

fs.mkdirSync(workDir, { recursive: true });
fs.mkdirSync(outDir,  { recursive: true });

// ── FFmpeg ───────────────────────────────────────────────────────────────────
function getFFmpeg() {
  // Prefer the bundled ffmpeg-static binary
  try {
    const bin = require('ffmpeg-static');
    if (bin && fs.existsSync(bin)) return bin;
  } catch {}
  // Fall back to system FFmpeg (available on ubuntu-latest runners)
  return 'ffmpeg';
}

// ── Download audio to disk ───────────────────────────────────────────────────
async function downloadAudioToDisk(url, dest) {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 100) return dest;
  fs.mkdirSync(path.dirname(dest), { recursive: true });

  const headers = {};
  let fetchUrl  = url;

  // Inject Appwrite auth header if the URL points to Appwrite Storage
  if (fetchUrl.includes('appwrite.io') && fetchUrl.includes('/storage')) {
    const pid = fetchUrl.match(/[?&]project=([^&]+)/)?.[1];
    // Try each configured Appwrite project
    for (const s of ['', '1', '2', '3', '4', '5']) {
      const p = process.env[`APPWRITE_PROJECT_ID${s}`];
      const k = process.env[`APPWRITE_API_KEY${s}`];
      if (p && k && p === pid) {
        headers['X-Appwrite-Key']     = k;
        headers['X-Appwrite-Project'] = p;
        break;
      }
    }
    // Fall back to primary keys
    if (!headers['X-Appwrite-Key']) {
      headers['X-Appwrite-Key']     = process.env.APPWRITE_API_KEY  ?? '';
      headers['X-Appwrite-Project'] = process.env.APPWRITE_PROJECT_ID ?? '';
    }
    // Strip the ?project= param (we're passing it as a header instead)
    fetchUrl = fetchUrl
      .replace(/[?&]project=[^&]+/, '')
      .replace(/\?$/, '')
      .replace(/\/v1\/\/storage/, '/v1/storage');
  }

  const res = await fetch(fetchUrl, { headers });
  if (!res.ok) throw new Error(`Audio download HTTP ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
  console.log(`    ✅ Audio downloaded (${(buf.length / 1024).toFixed(0)} KB)`);
  return dest;
}

// ── Build reveal intervals ───────────────────────────────────────────────────
function buildRevealIntervals(slide, totalSec) {
  const revealData   = slide.revealData   ?? [];
  const fragmentData = slide.fragmentData;
  const chunks       = slide.caption?.chunks ?? [];

  const isLegacy  = revealData.length > 0 && String(revealData[0]).startsWith('r');
  const isNewFrag = Array.isArray(fragmentData) && fragmentData.length > 0;

  if (isLegacy) {
    const events = [];
    let cum = [];
    for (let i = 0; i < revealData.length; i++) {
      cum = [...cum, revealData[i]];
      const at = Math.max(0, (chunks[i]?.timestamp?.[0] ?? (i * 1.2)) - 0.05);
      events.push({ at, ids: [...cum] });
    }
    events.sort((a, b) => a.at - b.at);

    const result = [];
    if (events.length === 0) return [{ startSec: 0, endSec: totalSec, revealIds: revealData, fragmentIndex: -1, isLegacy: true }];
    if (events[0].at > 0.05) result.push({ startSec: 0, endSec: events[0].at, revealIds: [revealData[0]], fragmentIndex: -1, isLegacy: true });
    for (let i = 0; i < events.length; i++) {
      result.push({ startSec: events[i].at, endSec: i + 1 < events.length ? events[i + 1].at : totalSec, revealIds: events[i].ids, fragmentIndex: -1, isLegacy: true });
    }
    return result;

  } else if (isNewFrag) {
    const events = [];
    for (let i = 0; i < fragmentData.length; i++) {
      events.push({ at: Math.max(0, (chunks[i]?.timestamp?.[0] ?? (i * 1.2)) - 0.05), idx: fragmentData[i] });
    }
    events.sort((a, b) => a.at - b.at);

    const result = [];
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

// ── Build HTML for a specific reveal state ────────────────────────────────────
function buildRevealHtml(html, interval, baseUrl) {
  let content = html
    .replace(/<!DOCTYPE[^>]*>/gi, '')
    .replace(/<\/?html[^>]*>/gi, '');

  const headMatch   = content.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
  const headContent = headMatch ? headMatch[1] : '';
  content = content.replace(/<head[^>]*>[\s\S]*?<\/head>/i);

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
    var fb=document.querySelector('[data-background-gradient]');if(fb){document.body.style.background=fb.getAttribute('data-background-gradient')||'';
    }else{var fc=document.querySelector('[data-background-color]');if(fc){document.body.style.backgroundColor=fc.getAttribute('data-background-color')||'';}else{document.body.style.background='linear-gradient(135deg,#0f172a 0%,#1e293b 100%)';}}`;

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
        // Height is the real constraint. Clamp width's influence so a stray-wide
        // element (e.g. a long code line) can never collapse the whole slide into
        // a tiny column — content is forced to wrap so real width ≈ 1440.
        scaleX = Math.max(scaleX, 0.82);
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

      // Re-scale after fonts load (critical — prevents fallback-font zoom)
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(function() {
          lastScale = -1;
          applyScale();
        });
      }
    })();
  `;

  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
${baseHref}${headContent}
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=Outfit:wght@300;400;500;600;700;800;900&family=Poppins:wght@300;400;500;600;700;800;900&family=Space+Grotesk:wght@400;500;600;700&family=Playfair+Display:ital,wght@0,400..900;1,400..900&family=DM+Sans:ital,opsz,wght@0,9..40,100..1000;1,9..40,100..1000&display=swap');
*{box-sizing:border-box;margin:0;padding:0;}
*::-webkit-scrollbar{display:none;width:0;height:0;}
*{scrollbar-width:none;-ms-overflow-style:none;}
/* NEVER overflow horizontally: wide content must wrap, not force scrollWidth that shrinks the whole slide. */
pre,code,p,h1,h2,h3,h4,span,div,li,td,th,blockquote{overflow-wrap:anywhere;}
pre,code,table,img,.code-card{max-width:100%!important;}
pre,code{white-space:pre-wrap!important;word-break:break-word!important;}
table{table-layout:fixed!important;}
.code-card{border-radius:14px!important;border:1px solid rgba(255,255,255,0.10)!important;background:#0b1020!important;overflow:hidden!important;box-shadow:0 18px 44px rgba(0,0,0,0.45)!important;width:100%!important;}
.code-card-header{display:flex!important;align-items:center!important;gap:8px!important;padding:11px 16px!important;background:rgba(255,255,255,0.04)!important;border-bottom:1px solid rgba(255,255,255,0.07)!important;}
.code-card-dot{width:11px!important;height:11px!important;border-radius:50%!important;flex-shrink:0!important;}
.code-card-dot.r{background:#ff5f56!important;}.code-card-dot.y{background:#ffbd2e!important;}.code-card-dot.g{background:#27c93f!important;}
.code-card-name{margin-left:8px!important;font-family:'Space Grotesk',monospace!important;font-size:13px!important;color:#9fb3d1!important;letter-spacing:0.3px!important;}
.code-card pre,.code-card-body{margin:0!important;padding:18px 22px!important;font-family:'Space Grotesk','Space Mono',ui-monospace,monospace!important;font-size:16px!important;line-height:1.6!important;color:#e6edf7!important;white-space:pre-wrap!important;overflow-wrap:anywhere!important;word-break:break-word!important;overflow:visible!important;tab-size:2!important;max-width:100%!important;}
.code-card code{font-family:inherit!important;background:none!important;}
.tok-kw{color:#c792ea!important;font-weight:600!important;}.tok-str{color:#c3e88d!important;}.tok-num{color:#f78c6c!important;}.tok-com{color:#6b7a99!important;font-style:italic!important;}.tok-fn{color:#82aaff!important;}.tok-punct{color:#89ddff!important;}
body{width:1440px;height:720px;overflow:hidden;background:#0f172a;}
[data-reveal]{opacity:0;transition:none;}[data-reveal].active{opacity:1!important;transform:none!important;}
[data-fragment-index]{opacity:0;transition:none;}[data-fragment-index].visible{opacity:1!important;transform:none!important;filter:none!important;}
.glassmorphism-card,.glassmorphism,.glass-card,.glass{background:rgba(255,255,255,0.07)!important;backdrop-filter:blur(16px)!important;-webkit-backdrop-filter:blur(16px)!important;border:1px solid rgba(255,255,255,0.13)!important;border-radius:14px!important;padding:12px 16px!important;color:#e2e8f0;}
.card,.box,.content-box,.info-card,.feature-card,.stat-card{background:rgba(255,255,255,0.07)!important;border:1px solid rgba(255,255,255,0.12)!important;border-radius:12px!important;padding:12px 16px!important;color:#e2e8f0;}
.gradient-border-card,.gradient-border,.glowing-card,.glow-card{background:#0f172a!important;box-shadow:0 0 0 2px rgba(139,92,246,0.55)!important;border-radius:12px!important;padding:12px 16px!important;color:#e2e8f0;}
.outlined-card,.outlined,.border-card,.minimal-card{background:transparent!important;border:1.5px solid rgba(255,255,255,0.22)!important;border-radius:10px!important;padding:12px 16px!important;color:#e2e8f0;}
.gradient-fill-card,.gradient-card,.gradient-fill{background:linear-gradient(135deg,rgba(59,130,246,0.18),rgba(139,92,246,0.18))!important;border:1px solid rgba(255,255,255,0.09)!important;border-radius:12px!important;padding:12px 16px!important;color:#e2e8f0;}
.neumorphic-card,.neumorphic,.neu-card{background:#1e293b!important;box-shadow:6px 6px 12px rgba(0,0,0,0.45),-4px -4px 10px rgba(255,255,255,0.04)!important;border-radius:16px!important;padding:12px 16px!important;color:#e2e8f0;}
.minimal-tag,.tag-card,.pill-card,.chip{background:rgba(255,255,255,0.09)!important;border-radius:24px!important;padding:6px 16px!important;display:inline-flex!important;align-items:center!important;gap:8px!important;color:#e2e8f0;}
.stat-block{display:flex!important;flex-direction:column!important;align-items:center!important;text-align:center!important;padding:14px 10px!important;background:rgba(255,255,255,0.05)!important;border-radius:14px!important;border:1px solid rgba(255,255,255,0.09)!important;}
.stat-number{font-size:34px!important;font-weight:900!important;line-height:1!important;background:linear-gradient(135deg,#3b82f6,#8b5cf6)!important;-webkit-background-clip:text!important;-webkit-text-fill-color:transparent!important;}
.stat-label{font-size:11px!important;color:#94a3b8!important;margin-top:5px!important;}
.badge,.label-badge,.status-badge{display:inline-flex!important;align-items:center!important;padding:4px 12px!important;border-radius:20px!important;font-size:11px!important;font-weight:600!important;background:rgba(139,92,246,0.2)!important;border:1px solid rgba(139,92,246,0.4)!important;color:#c4b5fd!important;}
.alert-box{background:rgba(245,158,11,0.08)!important;border-left:4px solid #f59e0b!important;border-radius:8px!important;padding:10px 14px!important;color:#fef08a!important;font-size:12px!important;}
.info-box{background:rgba(59,130,246,0.08)!important;border-left:4px solid #3b82f6!important;border-radius:8px!important;padding:10px 14px!important;color:#93c5fd!important;font-size:12px!important;}
.success-box{background:rgba(16,185,129,0.08)!important;border-left:4px solid #10b981!important;border-radius:8px!important;padding:10px 14px!important;color:#a7f3d0!important;font-size:12px!important;}
.gradient-box{background:linear-gradient(135deg,rgba(59,130,246,0.1),rgba(139,92,246,0.1))!important;border:1px solid rgba(255,255,255,0.08)!important;border-left:4px solid #8b5cf6!important;border-radius:8px!important;padding:10px 14px!important;color:#e9d5ff!important;font-size:12px!important;}
.quote-card{border-left:4px solid #8b5cf6!important;background:rgba(139,92,246,0.07)!important;border-radius:0 10px 10px 0!important;padding:11px 16px!important;font-style:italic!important;font-size:13px!important;color:#e2e8f0!important;}
.code-block-premium{font-family:'Space Mono',monospace!important;font-size:11px!important;line-height:1.4!important;max-height:350px!important;overflow:hidden!important;border-radius:12px!important;border:1px solid rgba(255,255,255,0.08)!important;background:#090d16!important;padding:14px!important;}
.process-row{display:flex!important;flex-direction:row!important;justify-content:space-between!important;width:100%!important;gap:12px!important;margin:4px 0!important;}
.process-step{flex:1!important;background:rgba(255,255,255,0.05)!important;border:1px solid rgba(255,255,255,0.08)!important;border-radius:12px!important;padding:12px!important;text-align:center!important;position:relative!important;}
.process-step-number{width:26px!important;height:26px!important;border-radius:50%!important;background:linear-gradient(135deg,#3b82f6,#8b5cf6)!important;display:flex!important;align-items:center!important;justify-content:center!important;margin:0 auto 8px auto!important;font-size:11px!important;font-weight:800!important;color:#ffffff!important;}
.grid-2-col{display:grid!important;grid-template-columns:repeat(2,1fr)!important;gap:16px!important;width:100%!important;}
.grid-3-col{display:grid!important;grid-template-columns:repeat(3,1fr)!important;gap:16px!important;width:100%!important;}
.grid-4-col{display:grid!important;grid-template-columns:repeat(4,1fr)!important;gap:12px!important;width:100%!important;}
.bento-grid{display:grid!important;grid-template-columns:repeat(3,1fr)!important;gap:14px!important;width:100%!important;}
.bento-span-2{grid-column:span 2!important;}.bento-span-3{grid-column:span 3!important;}
.kanban-board{display:grid!important;grid-template-columns:repeat(3,1fr)!important;gap:10px!important;width:100%!important;}
.kanban-column{background:rgba(255,255,255,0.03)!important;border-radius:10px!important;border:1px solid rgba(255,255,255,0.07)!important;overflow:hidden!important;}
.timeline-row{display:flex!important;flex-direction:row!important;justify-content:space-between!important;align-items:flex-start!important;width:100%!important;position:relative!important;padding-top:24px!important;margin-top:10px!important;}
.premium-table{width:100%!important;border-collapse:collapse!important;border-radius:12px!important;overflow:hidden!important;background:rgba(255,255,255,0.03)!important;border:1px solid rgba(255,255,255,0.08)!important;}
.premium-table th{background:linear-gradient(90deg,rgba(59,130,246,0.15),rgba(139,92,246,0.15))!important;color:#ffffff!important;font-weight:700!important;text-align:left!important;padding:10px 14px!important;font-size:13px!important;border-bottom:1.5px solid rgba(255,255,255,0.15)!important;}
.premium-table td{padding:8px 14px!important;font-size:11px!important;color:#cbd5e1!important;border-bottom:1px solid rgba(255,255,255,0.05)!important;}
.split-card{display:flex!important;border-radius:12px!important;overflow:hidden!important;border:1px solid rgba(255,255,255,0.08)!important;}
.split-card-accent{width:5px!important;flex-shrink:0!important;background:linear-gradient(180deg,#3b82f6,#8b5cf6)!important;}
.split-card-body{flex:1!important;padding:10px 14px!important;background:rgba(255,255,255,0.04)!important;}
.feature-matrix{display:grid!important;grid-template-columns:repeat(4,1fr)!important;gap:10px!important;width:100%!important;}
.feature-matrix-cell{display:flex!important;flex-direction:column!important;align-items:center!important;padding:11px 8px!important;background:rgba(255,255,255,0.04)!important;border-radius:10px!important;border:1px solid rgba(255,255,255,0.07)!important;text-align:center!important;font-size:11px!important;color:#cbd5e1!important;gap:6px!important;}
.diff-panel{display:grid!important;grid-template-columns:1fr 1fr!important;gap:3px!important;width:100%!important;}
.diff-panel-left{background:rgba(244,63,94,0.07)!important;border:1px solid rgba(244,63,94,0.22)!important;padding:11px 14px!important;border-radius:10px 0 0 10px!important;}
.diff-panel-right{background:rgba(16,185,129,0.07)!important;border:1px solid rgba(16,185,129,0.22)!important;padding:11px 14px!important;border-radius:0 10px 10px 0!important;}
.row-list{display:flex!important;flex-direction:column!important;width:100%!important;border-radius:10px!important;overflow:hidden!important;}
.row-list-item{display:flex!important;align-items:center!important;gap:12px!important;padding:9px 14px!important;font-size:12px!important;color:#cbd5e1!important;}
.row-list-item:nth-child(odd){background:rgba(255,255,255,0.04)!important;}
.row-list-item:nth-child(even){background:rgba(255,255,255,0.02)!important;}
.accent{color:#8b5cf6!important;}.accent-blue{color:#3b82f6!important;}.accent-pink{color:#ec4899!important;}.accent-green{color:#10b981!important;}.accent-cyan{color:#06b6d4!important;}.accent-orange{color:#f59e0b!important;}.text-muted{color:#94a3b8!important;}.text-light{color:#cbd5e1!important;}
.progress-bar-container{width:100%;height:10px;background:rgba(255,255,255,0.06);border-radius:5px;overflow:hidden;}
.progress-bar-fill{height:100%;background:linear-gradient(90deg,#3b82f6,#8b5cf6);border-radius:5px;}
.divider{height:1px;background:rgba(255,255,255,0.12);margin:8px 0;}
.divider-vertical{width:1px;background:rgba(255,255,255,0.12);margin:0 8px;align-self:stretch;}
img{max-width:100%;}
section{width:1440px!important;box-sizing:border-box!important;}
section>div{width:100%!important;box-sizing:border-box!important;}
div[style*='height: 720px'],div[style*='height:720px']{overflow:hidden!important;max-height:720px!important;}
</style></head>
<body${bodyAttrs} style="margin:0;padding:0;width:1440px;height:720px;overflow:hidden;background:#0f172a;">
${content}
<script>(function(){${bgScript}${revealScript}${scaleScript}})();</script>
</body></html>`;
}

// ── Shared Puppeteer browser pool (one browser per parallel slide worker) ────
// Each slide gets its own browser instance to allow true parallelism.
// Browser is launched once per slide render, kept open for all states, then closed.
async function screenshotWithBrowser(browser, html, outPath) {
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1440, height: 720, deviceScaleFactor: 1 });
    // Option 3: use 'domcontentloaded' + short sleep instead of slow networkidle0
    // This saves ~1-2s per screenshot while still getting fonts loaded
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.evaluateHandle(() => document.fonts.ready);
    // Option 3: reduced from 800ms to 300ms — enough for layout reflow
    await new Promise(r => setTimeout(r, 300));
    await page.screenshot({ path: outPath, type: 'png', clip: { x: 0, y: 0, width: 1440, height: 720 } });
  } finally {
    await page.close();
  }
}

// ── Option 1: Render a single slide (called in parallel for all slides) ───────
async function renderSlide(i, slide, totalSlides) {
  const puppeteer = require('puppeteer');
  const durationFrames = (durationsBySlideId ?? {})[slide.slideId] ?? (6 * fps);
  const totalSec = durationFrames / fps;

  console.log(`\n📽  Slide ${i + 1}/${totalSlides} — ${totalSec.toFixed(1)}s (${slide.slideId})`);

  // Download audio
  const ext = (slide.audioFileUrl ?? '').match(/\.(mp3|wav|ogg|aac)/i)?.[1] ?? 'mp3';
  const audioPath = path.join(workDir, `audio-${i}.${ext}`);
  try {
    await downloadAudioToDisk(slide.audioFileUrl, audioPath);
  } catch (e) {
    console.warn(`  ⚠️  Audio failed: ${e.message} — using silence`);
    await makeSilent(audioPath, totalSec);
  }

  // Build reveal intervals
  const intervals = buildRevealIntervals(slide, totalSec);
  console.log(`  🎞  ${intervals.length} reveal state(s)`);

  // Launch ONE browser per slide (kept open for all states of this slide)
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu',
      '--disable-dev-shm-usage', '--window-size=1440,720',
      '--font-render-hinting=none', '--disable-font-subpixel-positioning',
    ],
  });

  const intervalClips = [];
  try {
    for (let j = 0; j < intervals.length; j++) {
      const iv = intervals[j];
      const clipDur = iv.endSec - iv.startSec;
      if (clipDur < 0.05) continue;

      // Screenshot
      const imgPath = path.join(workDir, `s${i}-state${j}.png`);
      try {
        const revealHtml = buildRevealHtml(slide.html, iv, baseUrl);
        await screenshotWithBrowser(browser, revealHtml, imgPath);
        console.log(`  📸 Slide ${i + 1} state ${j} OK`);
      } catch (e) {
        console.warn(`  ⚠️  Screenshot failed: ${e.message} — black frame`);
        await execAsync(`"${getFFmpeg()}" -y -f lavfi -i color=c=black:s=1440x720:r=1:d=1 -frames:v 1 "${imgPath}"`).catch(() => {});
      }

      // Clip
      const clipPath = path.join(workDir, `s${i}-clip${j}.mp4`);
      const prevImgPath = j > 0 ? path.join(workDir, `s${i}-state${j - 1}.png`) : undefined;
      await makeClip(imgPath, audioPath, iv.startSec, clipDur, clipPath, prevImgPath);
      intervalClips.push(clipPath);
    }
  } finally {
    await browser.close();
  }

  // Merge interval clips → slide clip
  const slideClip = path.join(workDir, `slide-${i}.mp4`);
  if (intervalClips.length === 1) {
    fs.renameSync(intervalClips[0], slideClip);
  } else if (intervalClips.length > 1) {
    await concat(intervalClips, slideClip);
  } else {
    await execAsync(`"${getFFmpeg()}" -y -f lavfi -i color=c=black:s=1440x720:r=30:d=${totalSec.toFixed(3)} -f lavfi -i anullsrc=r=44100:cl=stereo -c:v libx264 -c:a aac -t ${totalSec.toFixed(3)} "${slideClip}"`).catch(() => {});
  }

  console.log(`  ✅ Slide ${i + 1} complete`);
  return { index: i, slideClip, durationSec: totalSec };
}

// ── Main render pipeline ─────────────────────────────────────────────────────
async function render() {
  if (fetchUrl) {
    console.log(`📡 Fetching chapter slides from Vercel: ${fetchUrl}`);
    const res = await fetch(fetchUrl, {
      headers: {
        'x-appwrite-key': process.env.APPWRITE_API_KEY || ''
      }
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch slides data: HTTP ${res.status}`);
    }
    const data = await res.json();
    slides = data.slides;
    durationsBySlideId = data.durationsBySlideId;
    baseUrl = data.baseUrl || '';
    console.log(`   Fetched ${slides.length} slides successfully. (Base URL: ${baseUrl})`);
  }

  if (!Array.isArray(slides) || slides.length === 0) {
    throw new Error('No slides found to render');
  }

  const totalSlides = slides.length;
  console.log(`🎬 render-chapter-gh: chapterId=${chapterId}, slides=${totalSlides}`);
  console.log(`⚡ Rendering all ${totalSlides} slides IN PARALLEL...`);

  // Option 1: PARALLEL slide rendering — all slides processed simultaneously
  // Each slide gets its own Puppeteer browser + FFmpeg processes
  const CONCURRENCY = Math.min(totalSlides, 4); // cap at 4 to avoid OOM on 7GB runners
  const results = [];

  // Process in batches of CONCURRENCY
  let completedSlides = 0;
  for (let batch = 0; batch < totalSlides; batch += CONCURRENCY) {
    const batchSlides = slides.slice(batch, batch + CONCURRENCY);
    const batchResults = await Promise.all(
      batchSlides.map((slide, idx) => renderSlide(batch + idx, slide, totalSlides))
    );
    results.push(...batchResults);
    completedSlides += batchSlides.length;
    // POST real progress after each batch — slides map to 0-90% range
    await postProgress(completedSlides, totalSlides);
  }

  // Sort results back in order (parallel may complete out of order)
  results.sort((a, b) => a.index - b.index);
  const slideClips = results.map(r => r.slideClip);
  const totalDurationSec = results.reduce((sum, r) => sum + r.durationSec, 0);

  // Final concat → output file directly (no extra compression pass — clips already at CRF 28)
  // Option 2: Skip redundant compression pass — saves 3-5 minutes!
  console.log(`\n🔗 Concatenating ${slideClips.length} slides...`);
  await postProgress(totalSlides, totalSlides); // 90% — all slides done, concat starting
  await concat(slideClips, outFile);
  const concatMb = fs.existsSync(outFile) ? (fs.statSync(outFile).size / 1024 / 1024).toFixed(1) : '?';
  console.log(`   ✅ Concat complete: ${concatMb} MB (clips already encoded at CRF 28, skipping re-encode)`);

  // Signal 95% — concat done, about to split/upload
  if (webhookUrl) {
    try {
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chapterId, status: 'progress', progress: 95, slidesComplete: totalSlides, slidesTotal: totalSlides }),
      });
    } catch {}
  }

  const mb = fs.existsSync(outFile) ? (fs.statSync(outFile).size / 1024 / 1024).toFixed(1) : '?';
  console.log(`\n🏁 DONE — ${mb} MB → ${outFile}`);

  // ── Raw binary split for Appwrite upload (preserves MP4 container integrity) ──
  // IMPORTANT: We do NOT use FFmpeg segment muxer here because that creates
  // independent playable MP4 containers each with their own duration header.
  // Instead we split raw bytes — like splitting a zip into parts.
  // On download, the server streams parts back-to-back → browser gets exact
  // original bytes → reads the ONE correct 42-minute header → plays in full.
  const CHUNK_SIZE_BYTES = 44 * 1024 * 1024; // 44 MB raw chunks (stays under Appwrite 50MB limit)
  const finalSizeBytes = fs.existsSync(outFile) ? fs.statSync(outFile).size : 0;

  if (finalSizeBytes > CHUNK_SIZE_BYTES) {
    const chunksDir = path.join(path.dirname(outFile), `chapter-${chapterId}-chunks`);
    fs.mkdirSync(chunksDir, { recursive: true });

    const totalChunks = Math.ceil(finalSizeBytes / CHUNK_SIZE_BYTES);
    console.log(`\n✂️  Raw-binary splitting ${(finalSizeBytes / 1024 / 1024).toFixed(1)} MB → ${totalChunks} raw chunks of ≤44 MB...`);

    const inFd = fs.openSync(outFile, 'r');
    const chunkFiles = [];
    const BUF_SIZE = 8 * 1024 * 1024; // 8 MB read buffer
    const buf = Buffer.allocUnsafe(BUF_SIZE);

    for (let i = 0; i < totalChunks; i++) {
      const chunkName = `chunk-${String(i).padStart(3, '0')}.bin`;
      const chunkPath = path.join(chunksDir, chunkName);
      const outFd = fs.openSync(chunkPath, 'w');
      let bytesWritten = 0;

      while (bytesWritten < CHUNK_SIZE_BYTES) {
        const toRead = Math.min(BUF_SIZE, CHUNK_SIZE_BYTES - bytesWritten);
        const bytesRead = fs.readSync(inFd, buf, 0, toRead, null);
        if (bytesRead === 0) break;
        fs.writeSync(outFd, buf, 0, bytesRead);
        bytesWritten += bytesRead;
      }
      fs.closeSync(outFd);
      const chunkMb = (fs.statSync(chunkPath).size / 1024 / 1024).toFixed(1);
      console.log(`   ✅ chunk-${i}: ${chunkMb} MB`);
      chunkFiles.push(chunkName);
    }
    fs.closeSync(inFd);

    const sidecarPath = outFile.replace('.mp4', '-chunks.json');
    fs.writeFileSync(sidecarPath, JSON.stringify({ chunksDir, chunkFiles, rawBinary: true, totalBytes: finalSizeBytes }));
    console.log(`   ✅ Split into ${chunkFiles.length} raw binary chunks — original MP4 header intact`);
  } else {
    console.log(`   File is ${(finalSizeBytes / 1024 / 1024).toFixed(1)} MB — single upload (no chunking needed)`);
  }

  // Clean up work dir
  try { fs.rmSync(workDir, { recursive: true, force: true }); } catch {}
}

// ── Entry point ──────────────────────────────────────────────────────────────
render().catch(err => {
  console.error('❌ Render failed:', err.message ?? err);
  process.exit(1);
});

// ── FFmpeg: image loop + audio slice → mp4 ──────────────────────────────────
async function makeClip(imgPath, audioPath, audioStart, duration, out, prevImgPath) {
  const ff  = getFFmpeg();
  const fd  = Math.min(0.5, duration / 2);
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

// ── FFmpeg concat ────────────────────────────────────────────────────────────
async function concat(clips, out) {
  const ff  = getFFmpeg();
  const lst = out.replace('.mp4', '_list.txt');
  fs.writeFileSync(lst, clips.map(c => `file '${c.replace(/\\/g, '/')}'`).join('\n'));
  const cmd = `"${ff}" -y -f concat -safe 0 -i "${lst}" -c copy "${out}"`;
  await execAsync(cmd, { maxBuffer: 500 * 1024 * 1024, timeout: 30 * 60 * 1000 });
  try { fs.unlinkSync(lst); } catch {}
}

// ── Silent audio fallback ────────────────────────────────────────────────────
async function makeSilent(dest, durationSec) {
  const ff = getFFmpeg();
  await execAsync(`"${ff}" -y -f lavfi -i anullsrc=r=44100:cl=stereo -t ${durationSec.toFixed(3)} "${dest}"`).catch(() => {});
}


