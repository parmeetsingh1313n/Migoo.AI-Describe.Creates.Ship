/**
 * Shared reveal.js deck wrapper.
 * ──────────────────────────────
 * Used by BOTH the live-preview iframe (ChapterVideo.tsx) and the Puppeteer
 * capture page (app/api/render-chapter/route.ts) so slides render through the
 * SAME real reveal.js engine instead of the two independently-hand-rolled
 * scale/fragment approximations that used to live in each file.
 *
 * Assets are self-hosted under /public/reveal (copied from node_modules at
 * dev time) — no CDN, so Puppeteer capture never races a network fetch.
 *
 * Fragment navigation is driven through a `window.__deck` global + a small
 * postMessage bridge that reuses the SAME message type strings the old custom
 * engine used (NAVIGATE_FRAGMENT / SHOW_ALL_FRAGMENTS / RESET_FRAGMENTS /
 * REVEAL_READY), so callers driving the iframe from a parent window don't
 * need to change. Puppeteer drives the same deck directly via
 * `page.evaluate(idx => window.__deck.slide(0, 0, idx))` instead of postMessage.
 */

/** <link>/<script> tags for reveal.js core + the plugins we ship. baseUrl is the app origin (e.g. https://host or '' for relative). */
export function revealAssetTags(baseUrl: string): string {
  const b = baseUrl.replace(/\/$/, "");
  return `
<link rel="stylesheet" href="${b}/reveal/reset.css">
<link rel="stylesheet" href="${b}/reveal/reveal.css">
<link rel="stylesheet" href="${b}/reveal/vendor/katex/katex.min.css">
<script src="${b}/reveal/reveal.js"></script>
<script src="${b}/reveal/plugin/math.js"></script>
<script src="${b}/reveal/vendor/katex/katex.min.js"></script>
<script src="${b}/reveal/vendor/mermaid.min.js"></script>
<script src="${b}/reveal/vendor/chart.js"></script>
<script src="${b}/reveal/vendor/mark.min.js"></script>
<script src="${b}/reveal/vendor/typed.js"></script>
`;
}

/** Wraps an LLM-authored <section>...</section> in reveal.js's required deck structure. */
export function wrapInRevealDeck(sectionHtml: string): string {
  return `<div class="reveal"><div class="slides">${sectionHtml}</div></div>`;
}

/**
 * reveal.js core CSS already handles the native fragment styles (fade-up,
 * fade-down, fade-left, fade-right, grow, shrink, fade-in) via `.fragment` +
 * `.visible`. The prompt also asks for three extra style names the LLM has
 * used since before this engine existed (scale-in, blur-in, slide-up) —
 * these aren't real reveal.js styles, so we supply them ourselves using the
 * exact same `.fragment.<name>` / `.fragment.<name>.visible` convention
 * reveal.js itself uses, so they animate identically to the native ones.
 */
export const REVEAL_CUSTOM_FRAGMENT_STYLES = `
<style>
.reveal .fragment.scale-in { opacity: 0; transform: scale(0.5); }
.reveal .fragment.scale-in.visible { opacity: 1; transform: none; }
.reveal .fragment.blur-in { opacity: 0; filter: blur(8px); transform: scale(0.95); }
.reveal .fragment.blur-in.visible { opacity: 1; filter: none; transform: none; }
.reveal .fragment.slide-up { opacity: 0; transform: translateY(60px); }
.reveal .fragment.slide-up.visible { opacity: 1; transform: none; }
.reveal, .reveal .slides, .reveal .slides section { width: 100% !important; height: 100% !important; }
.reveal .slides section { top: 0 !important; }
.mark-hl { background: rgba(139,92,246,0.35); color: inherit; border-radius: 3px; padding: 0 2px; }
/* Long code snippets get a BOUNDED, auto-scrolling card (scrollCodeToProgress
   drives scrollTop) instead of the old behavior of shrinking the whole slide
   to fit an ever-growing code block. */
.reveal .code-card-body, .reveal .code-card pre {
  max-height: 460px !important;
  overflow-y: auto !important;
}
</style>
`;

/**
 * Reveal.js init + companion plugin bootstrap (Mermaid/Chart/mark.js/Typed
 * aren't reveal.js plugins themselves — they're standalone libraries we
 * trigger ourselves once the deck is ready) + the postMessage/global bridge
 * for programmatic fragment navigation.
 */
export const REVEAL_INIT_SCRIPT = `
<script>
(function () {
  function runCompanionLibs() {
    // Mermaid — render each <pre class="mermaid"> block individually so one bad
    // diagram can't leave raw syntax text on screen (the old silent catch did).
    if (window.mermaid) {
      try {
        window.mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'loose' });
      } catch (e) { console.error('[mermaid] initialize failed:', e); }
      var mnodes = document.querySelectorAll('pre.mermaid, .mermaid');
      mnodes.forEach(function (el, i) {
        if (el.getAttribute('data-mermaid-done')) return;
        var src = (el.textContent || '').trim();
        if (!src) return;
        var id = 'mmd-' + i + '-' + src.length;
        try {
          Promise.resolve(window.mermaid.render(id, src)).then(function (out) {
            el.innerHTML = (out && out.svg) ? out.svg : String(out);
            el.setAttribute('data-mermaid-done', '1');
          }).catch(function (err) {
            console.error('[mermaid] render failed:', err, '\\nsource:\\n', src);
            el.innerHTML = "<div style='padding:20px;border:1px solid rgba(214,75,127,0.4);border-radius:12px;background:rgba(214,75,127,0.08);color:#e6b3c6;font-size:14px;'>Diagram could not be rendered.</div>";
            el.setAttribute('data-mermaid-done', '1');
          });
        } catch (err) {
          console.error('[mermaid] render threw:', err, '\\nsource:\\n', src);
          el.innerHTML = "<div style='padding:20px;border:1px solid rgba(214,75,127,0.4);border-radius:12px;background:rgba(214,75,127,0.08);color:#e6b3c6;font-size:14px;'>Diagram could not be rendered.</div>";
          el.setAttribute('data-mermaid-done', '1');
        }
      });
    }
    // KaTeX — render any [data-katex] elements (LaTeX source in data-katex attr).
    if (window.katex) {
      document.querySelectorAll('[data-katex]').forEach(function (el) {
        try { window.katex.render(el.getAttribute('data-katex') || '', el, { throwOnError: false }); } catch (e) {}
      });
    }
    // Chart.js — render any <canvas data-chart-type='bar|line|pie|doughnut'
    // data-chart-labels='A|B|C' data-chart-values='1|2|3'>. Flat pipe-delimited
    // attributes on purpose — NOT a JSON attribute, so the LLM never has to
    // nest double-quoted JSON inside a single-quoted HTML attribute (that
    // combination is exactly what breaks the JSON-output parser downstream).
    if (window.Chart) {
      document.querySelectorAll('canvas[data-chart-type]').forEach(function (el) {
        try {
          var type = el.getAttribute('data-chart-type') || 'bar';
          var labels = (el.getAttribute('data-chart-labels') || '').split('|').filter(Boolean);
          var values = (el.getAttribute('data-chart-values') || '').split('|').map(Number).filter(function (n) { return !isNaN(n); });
          var color = el.getAttribute('data-chart-color') || '#6D5BD3';
          new window.Chart(el, {
            type: type,
            data: { labels: labels, datasets: [{ data: values, backgroundColor: color, borderColor: color, borderWidth: 1 }] },
            options: {
              responsive: true, maintainAspectRatio: false, animation: false,
              plugins: { legend: { display: type === 'pie' || type === 'doughnut', labels: { color: '#e2e8f0' } } },
              scales: (type === 'pie' || type === 'doughnut') ? {} : {
                x: { ticks: { color: '#9fb3d1' }, grid: { color: 'rgba(255,255,255,0.08)' } },
                y: { ticks: { color: '#9fb3d1' }, grid: { color: 'rgba(255,255,255,0.08)' } },
              },
            },
          });
        } catch (e) {}
      });
    }
    // Typed.js — typewriter effect on [data-typed] elements.
    if (window.Typed) {
      document.querySelectorAll('[data-typed]').forEach(function (el) {
        try {
          var text = el.getAttribute('data-typed') || el.textContent || '';
          el.textContent = '';
          new window.Typed(el, { strings: [text], typeSpeed: 18, showCursor: false });
        } catch (e) {}
      });
    }
    // mark.js — progressive inline emphasis on [data-mark] elements (space-separated terms).
    if (window.Mark) {
      document.querySelectorAll('[data-mark]').forEach(function (el) {
        try {
          var terms = (el.getAttribute('data-mark') || '').split('|').filter(Boolean);
          if (terms.length) new window.Mark(el).mark(terms, { className: 'mark-hl' });
        } catch (e) {}
      });
    }
  }

  function boot() {
    var deck = new Reveal({
      embedded: true,
      width: 1440,
      height: 720,
      margin: 0,
      minScale: 0.2,
      maxScale: 1,
      center: true,
      controls: false,
      progress: false,
      hash: false,
      keyboard: false,
      transition: 'none',
      plugins: (window.RevealMath && window.RevealMath.KaTeX) ? [window.RevealMath.KaTeX] : [],
    });
    window.__deck = deck;
    deck.initialize().then(function () {
      runCompanionLibs();
      window.parent.postMessage({ type: 'REVEAL_READY' }, '*');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.addEventListener('message', function (e) {
    var msg = e.data;
    if (!msg || !msg.type || !window.__deck) return;
    if (msg.type === 'NAVIGATE_FRAGMENT') {
      window.__deck.slide(0, 0, msg.index);
    } else if (msg.type === 'SHOW_ALL_FRAGMENTS') {
      var slideEl = window.__deck.getSlideElements()[0];
      var total = slideEl ? slideEl.querySelectorAll('.fragment').length : 999;
      window.__deck.slide(0, 0, total);
    } else if (msg.type === 'RESET_FRAGMENTS') {
      window.__deck.slide(0, 0, -1);
    } else if (msg.type === 'SCROLL_CODE') {
      scrollCodeToProgress(msg.progress);
    }
  });

  // Auto-scroll long .code-card bodies as narration proceeds — driven by a
  // 0..1 progress value covering this slide's whole on-screen duration, not
  // reveal.js fragment state. No-op if the code fits without scrolling.
  function scrollCodeToProgress(progress) {
    var body = document.querySelector('.code-card-body, .code-card pre');
    if (!body) return;
    var maxScroll = body.scrollHeight - body.clientHeight;
    if (maxScroll <= 0) return;
    var p = Math.max(0, Math.min(1, progress));
    body.scrollTop = maxScroll * p;
  }
  window.__scrollCodeToProgress = scrollCodeToProgress;
})();
</script>
`;
export const COMPONENT_STYLESHEET = `
    /* ── HALLUCINATION RECOVERY ────────────────────────────────────────────────
     * owl-alpha sometimes generates CSS class names instead of inline styles.
     * These rules ensure those class names always render correctly,
     * fixing all existing slides in the DB without re-generation.
     * ──────────────────────────────────────────────────────────────────────── */

    /* Glassmorphism cards */
    .glassmorphism-card, .glassmorphism, .glass-card, .glass {
      background: rgba(255,255,255,0.07) !important;
      backdrop-filter: blur(16px) !important;
      -webkit-backdrop-filter: blur(16px) !important;
      border: 1px solid rgba(255,255,255,0.13) !important;
      border-radius: 14px !important;
      padding: 12px 16px !important;
      color: #e2e8f0;
    }

    /* Gradient border / glowing edge cards */
    .gradient-border-card, .gradient-border, .glowing-card, .glow-card {
      background: #0f172a !important;
      box-shadow: 0 0 0 2px rgba(139,92,246,0.55) !important;
      border-radius: 12px !important;
      padding: 12px 16px !important;
      color: #e2e8f0;
    }

    /* Outlined / minimal cards */
    .outlined-card, .outlined, .border-card, .minimal-card {
      background: transparent !important;
      border: 1.5px solid rgba(255,255,255,0.22) !important;
      border-radius: 10px !important;
      padding: 12px 16px !important;
      color: #e2e8f0;
    }

    /* Neumorphic dark cards */
    .neumorphic-card, .neumorphic, .neu-card {
      background: #1e293b !important;
      box-shadow: 6px 6px 12px rgba(0,0,0,0.45), -4px -4px 10px rgba(255,255,255,0.04) !important;
      border-radius: 16px !important;
      padding: 12px 16px !important;
      color: #e2e8f0;
    }

    /* Gradient fill cards */
    .gradient-fill-card, .gradient-card, .gradient-fill {
      background: linear-gradient(135deg, rgba(59,130,246,0.18), rgba(139,92,246,0.18)) !important;
      border: 1px solid rgba(255,255,255,0.09) !important;
      border-radius: 12px !important;
      padding: 12px 16px !important;
      color: #e2e8f0;
    }

    /* Minimal tag / pill */
    .minimal-tag, .tag-card, .pill-card, .chip {
      background: rgba(255,255,255,0.09) !important;
      border-radius: 24px !important;
      padding: 6px 16px !important;
      display: inline-flex !important;
      align-items: center !important;
      gap: 8px !important;
      color: #e2e8f0;
    }

    /* Generic card / box fallback */
    .card, .box, .content-box, .info-card, .feature-card, .stat-card {
      background: rgba(255,255,255,0.07) !important;
      border: 1px solid rgba(255,255,255,0.12) !important;
      border-radius: 12px !important;
      padding: 12px 16px !important;
      color: #e2e8f0;
    }

    /* Badge / chip */
    .badge, .label-badge, .status-badge {
      display: inline-flex !important;
      align-items: center !important;
      padding: 4px 12px !important;
      border-radius: 20px !important;
      font-size: 11px !important;
      font-weight: 600 !important;
      background: rgba(139,92,246,0.2) !important;
      border: 1px solid rgba(139,92,246,0.4) !important;
      color: #c4b5fd !important;
    }

    /* Divider line */
    .divider { height: 1px; background: rgba(255,255,255,0.12); margin: 8px 0; }
    .divider-vertical { width: 1px; background: rgba(255,255,255,0.12); margin: 0 8px; align-self: stretch; }

    /* Accent text colors the model might use by class */
    .accent { color: #8b5cf6 !important; }
    .accent-blue { color: #3b82f6 !important; }
    .accent-pink { color: #ec4899 !important; }
    .accent-green { color: #10b981 !important; }
    .accent-cyan { color: #06b6d4 !important; }
    .accent-orange { color: #f59e0b !important; }
    .text-muted { color: #94a3b8 !important; }
    .text-light { color: #cbd5e1 !important; }

    /* Progress bars the model generates as class-based */
    .progress-bar-container {
      width: 100%; height: 10px;
      background: rgba(255,255,255,0.06);
      border-radius: 5px; overflow: hidden;
    }
    .progress-bar-fill {
      height: 100%;
      background: linear-gradient(90deg, #3b82f6, #8b5cf6);
      border-radius: 5px;
    }

    /* ── PREMIUM LAYOUT UTILITIES (PREVENTS OVERFLOW) ────────────────────────── */
    .grid-2-col {
      display: grid !important;
      grid-template-columns: repeat(2, 1fr) !important;
      gap: 16px !important;
      width: 100% !important;
    }
    .grid-3-col {
      display: grid !important;
      grid-template-columns: repeat(3, 1fr) !important;
      gap: 16px !important;
      width: 100% !important;
    }
    .grid-4-col {
      display: grid !important;
      grid-template-columns: repeat(4, 1fr) !important;
      gap: 12px !important;
      width: 100% !important;
    }
    .flex-row-layout {
      display: flex !important;
      flex-direction: row !important;
      gap: 16px !important;
      align-items: stretch !important;
      width: 100% !important;
    }
    .flex-col-layout {
      display: flex !important;
      flex-direction: column !important;
      gap: 12px !important;
      width: 100% !important;
    }

    /* Premium Tables */
    .premium-table {
      width: 100% !important;
      border-collapse: collapse !important;
      border-radius: 12px !important;
      overflow: hidden !important;
      background: rgba(255, 255, 255, 0.03) !important;
      border: 1px solid rgba(255, 255, 255, 0.08) !important;
      margin: 4px 0 !important;
    }
    .premium-table th {
      background: linear-gradient(90deg, rgba(59, 130, 246, 0.15), rgba(139, 92, 246, 0.15)) !important;
      color: #ffffff !important;
      font-weight: 700 !important;
      text-align: left !important;
      padding: 10px 14px !important;
      font-size: 13px !important;
      border-bottom: 1.5px solid rgba(255, 255, 255, 0.15) !important;
    }
    .premium-table td {
      padding: 8px 14px !important;
      font-size: 11px !important;
      color: #cbd5e1 !important;
      border-bottom: 1px solid rgba(255, 255, 255, 0.05) !important;
    }
    .premium-table tr:last-child td {
      border-bottom: none !important;
    }

    /* Bento Grid System */
    .bento-grid {
      display: grid !important;
      grid-template-columns: repeat(3, 1fr) !important;
      gap: 14px !important;
      width: 100% !important;
    }
    .bento-span-2 {
      grid-column: span 2 !important;
    }
    .bento-span-3 {
      grid-column: span 3 !important;
    }

    /* Process Flow System */
    .process-row {
      display: flex !important;
      flex-direction: row !important;
      justify-content: space-between !important;
      width: 100% !important;
      gap: 12px !important;
      margin: 4px 0 !important;
    }
    .process-step {
      flex: 1 !important;
      background: rgba(255, 255, 255, 0.05) !important;
      border: 1px solid rgba(255, 255, 255, 0.08) !important;
      border-radius: 12px !important;
      padding: 12px !important;
      text-align: center !important;
      position: relative !important;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15) !important;
    }
    .process-step-number {
      width: 26px !important;
      height: 26px !important;
      border-radius: 50% !important;
      background: linear-gradient(135deg, #3b82f6, #8b5cf6) !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      margin: 0 auto 8px auto !important;
      font-size: 11px !important;
      font-weight: 800 !important;
      color: #ffffff !important;
      box-shadow: 0 0 10px rgba(139, 92, 246, 0.4) !important;
    }

    /* Horizontal Timelines */
    .timeline-row {
      display: flex !important;
      flex-direction: row !important;
      justify-content: space-between !important;
      align-items: flex-start !important;
      width: 100% !important;
      position: relative !important;
      padding-top: 24px !important;
      margin-top: 10px !important;
    }
    .timeline-bar {
      position: absolute !important;
      top: 6px !important;
      left: 10% !important;
      right: 10% !important;
      height: 3px !important;
      background: linear-gradient(90deg, #3b82f6, #8b5cf6, #ec4899) !important;
      border-radius: 2px !important;
      z-index: 0 !important;
    }
    .timeline-node {
      display: flex !important;
      flex-direction: column !important;
      align-items: center !important;
      text-align: center !important;
      flex: 1 !important;
      position: relative !important;
      z-index: 1 !important;
    }
    .timeline-dot {
      width: 14px !important;
      height: 14px !important;
      border-radius: 50% !important;
      background: #ffffff !important;
      border: 3px solid #8b5cf6 !important;
      box-shadow: 0 0 8px #8b5cf6 !important;
      margin-bottom: 8px !important;
    }

    /* Alert / Callout / Highlight Boxes */
    .alert-box {
      background: rgba(245, 158, 11, 0.08) !important;
      border-left: 4px solid #f59e0b !important;
      border-radius: 8px !important;
      padding: 10px 14px !important;
      color: #fef08a !important;
      font-size: 12px !important;
    }
    .info-box {
      background: rgba(59, 130, 246, 0.08) !important;
      border-left: 4px solid #3b82f6 !important;
      border-radius: 8px !important;
      padding: 10px 14px !important;
      color: #93c5fd !important;
      font-size: 12px !important;
    }
    .success-box {
      background: rgba(16, 185, 129, 0.08) !important;
      border-left: 4px solid #10b981 !important;
      border-radius: 8px !important;
      padding: 10px 14px !important;
      color: #a7f3d0 !important;
      font-size: 12px !important;
    }
    .gradient-box {
      background: linear-gradient(135deg, rgba(59, 130, 246, 0.1), rgba(139, 92, 246, 0.1)) !important;
      border: 1px solid rgba(255, 255, 255, 0.08) !important;
      border-left: 4px solid #8b5cf6 !important;
      border-radius: 8px !important;
      padding: 10px 14px !important;
      color: #e9d5ff !important;
      font-size: 12px !important;
    }

    /* Premium Lists */
    .premium-list {
      display: flex !important;
      flex-direction: column !important;
      gap: 8px !important;
      width: 100% !important;
      list-style: none !important;
    }
    .premium-list-item {
      display: flex !important;
      align-items: center !important;
      gap: 10px !important;
      padding: 6px 10px !important;
      background: rgba(255, 255, 255, 0.03) !important;
      border-radius: 8px !important;
      font-size: 12px !important;
      color: #cbd5e1 !important;
    }

    /* Code Block Premium */
    .code-block-premium {
      font-family: 'Space Mono', monospace !important;
      font-size: 11px !important;
      line-height: 1.4 !important;
      max-height: 350px !important;
      overflow: hidden !important;
      border-radius: 12px !important;
      border: 1px solid rgba(255, 255, 255, 0.08) !important;
      background: #090d16 !important;
      padding: 14px !important;
      box-shadow: inset 0 2px 8px rgba(0,0,0,0.8) !important;
    }

    /* ── CODE CARD — real, readable, syntax-highlighted code snippet ──────────
       This is the ONLY correct way to show code. Readable font (never clipped),
       an IDE-style header with traffic-light dots + a filename/language chip,
       and tokens colored by the injected highlighter (.tok-* classes below).
       NO max-height/overflow:hidden here — the prompt caps code at ≤ 9 short
       lines so it fits the 720px budget without shrinking. */
    .code-card {
      border-radius: 14px !important;
      border: 1px solid rgba(255,255,255,0.10) !important;
      background: #0b1020 !important;
      overflow: hidden !important;
      box-shadow: 0 18px 44px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.05) !important;
      width: 100% !important;
    }
    .code-card-header {
      display: flex !important; align-items: center !important; gap: 8px !important;
      padding: 11px 16px !important;
      background: rgba(255,255,255,0.04) !important;
      border-bottom: 1px solid rgba(255,255,255,0.07) !important;
    }
    .code-card-dot { width: 11px !important; height: 11px !important; border-radius: 50% !important; flex-shrink: 0 !important; }
    .code-card-dot.r { background: #ff5f56 !important; }
    .code-card-dot.y { background: #ffbd2e !important; }
    .code-card-dot.g { background: #27c93f !important; }
    .code-card-name {
      margin-left: 8px !important; font-family: 'Space Grotesk', monospace !important;
      font-size: 13px !important; color: #9fb3d1 !important; letter-spacing: 0.3px !important;
    }
    .code-card pre, .code-card-body {
      margin: 0 !important; padding: 18px 22px !important;
      font-family: 'Space Grotesk','Space Mono', ui-monospace, monospace !important;
      font-size: 16px !important; line-height: 1.6 !important;
      color: #e6edf7 !important;
      /* WRAP, don't scroll: a long line must fold onto the next line instead of
         forcing horizontal overflow (which used to shrink the entire slide). */
      white-space: pre-wrap !important;
      overflow-wrap: anywhere !important; word-break: break-word !important;
      overflow: visible !important; tab-size: 2 !important; max-width: 100% !important;
    }
    .code-card code { font-family: inherit !important; background: none !important; }
    /* Syntax tokens (set by the injected highlighter) */
    .tok-kw   { color: #c792ea !important; font-weight: 600 !important; }
    .tok-str  { color: #c3e88d !important; }
    .tok-num  { color: #f78c6c !important; }
    .tok-com  { color: #6b7a99 !important; font-style: italic !important; }
    .tok-fn   { color: #82aaff !important; }
    .tok-punct{ color: #89ddff !important; }

    /* ── NEW PREMIUM VISUAL COMPONENTS ─────────────────────────────────────── */

    /* 1. Stat / Metric Display */
    .stat-block {
      display: flex !important; flex-direction: column !important;
      align-items: center !important; text-align: center !important;
      padding: 14px 10px !important;
      background: rgba(255,255,255,0.05) !important;
      border-radius: 14px !important; border: 1px solid rgba(255,255,255,0.09) !important;
    }
    .stat-number {
      font-size: 34px !important; font-weight: 900 !important; line-height: 1 !important;
      background: linear-gradient(135deg, #3b82f6, #8b5cf6) !important;
      -webkit-background-clip: text !important; -webkit-text-fill-color: transparent !important;
    }
    .stat-label {
      font-size: 11px !important; color: #94a3b8 !important; margin-top: 5px !important;
    }

    /* 2. Two-Tone Split Card */
    .split-card {
      display: flex !important; border-radius: 12px !important;
      overflow: hidden !important; border: 1px solid rgba(255,255,255,0.08) !important;
    }
    .split-card-accent {
      width: 5px !important; flex-shrink: 0 !important;
      background: linear-gradient(180deg, #3b82f6, #8b5cf6) !important;
    }
    .split-card-body {
      flex: 1 !important; padding: 10px 14px !important;
      background: rgba(255,255,255,0.04) !important;
    }

    /* 3. Terminal / Console Style Card */
    .terminal-card {
      background: #0a0f1a !important; border-radius: 10px !important;
      border: 1px solid rgba(255,255,255,0.09) !important; overflow: hidden !important;
    }
    .terminal-header {
      background: #111827 !important; padding: 7px 12px !important;
      display: flex !important; align-items: center !important; gap: 6px !important;
      border-bottom: 1px solid rgba(255,255,255,0.07) !important;
    }
    .terminal-dot {
      width: 9px !important; height: 9px !important; border-radius: 50% !important;
    }
    .terminal-body {
      padding: 10px 14px !important; font-family: 'Space Mono', monospace !important;
      font-size: 11px !important; line-height: 1.6 !important; color: #a3e635 !important;
    }

    /* 4. Kanban-style 3-Column Board */
    .kanban-board {
      display: grid !important; grid-template-columns: repeat(3, 1fr) !important;
      gap: 10px !important; width: 100% !important;
    }
    .kanban-column {
      background: rgba(255,255,255,0.03) !important; border-radius: 10px !important;
      border: 1px solid rgba(255,255,255,0.07) !important; overflow: hidden !important;
    }
    .kanban-header {
      padding: 7px 10px !important; font-size: 11px !important; font-weight: 700 !important;
      text-transform: uppercase !important; letter-spacing: 0.5px !important;
    }
    .kanban-item {
      margin: 5px 7px !important; padding: 7px 9px !important;
      background: rgba(255,255,255,0.05) !important; border-radius: 7px !important;
      font-size: 11px !important; color: #cbd5e1 !important; border-left: 3px solid !important;
    }

    /* 5. Quote / Blockquote Card */
    .quote-card {
      border-left: 4px solid #8b5cf6 !important;
      background: rgba(139,92,246,0.07) !important;
      border-radius: 0 10px 10px 0 !important;
      padding: 11px 16px !important; font-style: italic !important;
      font-size: 13px !important; color: #e2e8f0 !important;
    }
    .quote-attribution {
      font-size: 11px !important; color: #8b5cf6 !important;
      margin-top: 6px !important; font-style: normal !important; font-weight: 600 !important;
      display: block !important;
    }

    /* 6. Feature Matrix (4-col icon + label grid) */
    .feature-matrix {
      display: grid !important; grid-template-columns: repeat(4, 1fr) !important;
      gap: 10px !important; width: 100% !important;
    }
    .feature-matrix-cell {
      display: flex !important; flex-direction: column !important;
      align-items: center !important; padding: 11px 8px !important;
      background: rgba(255,255,255,0.04) !important; border-radius: 10px !important;
      border: 1px solid rgba(255,255,255,0.07) !important; text-align: center !important;
      font-size: 11px !important; color: #cbd5e1 !important; gap: 6px !important;
    }

    /* 7. Hotspot / Glow-Indicator Card */
    .hotspot-card {
      position: relative !important; padding: 11px 14px !important;
      background: rgba(255,255,255,0.05) !important; border-radius: 12px !important;
      border: 1px solid rgba(255,255,255,0.10) !important;
    }
    .hotspot-dot {
      position: absolute !important; top: -4px !important; right: -4px !important;
      width: 11px !important; height: 11px !important; border-radius: 50% !important;
      background: #10b981 !important; box-shadow: 0 0 8px #10b981 !important;
    }

    /* 8. Alternating Row List */
    .row-list {
      display: flex !important; flex-direction: column !important;
      width: 100% !important; border-radius: 10px !important; overflow: hidden !important;
    }
    .row-list-item {
      display: flex !important; align-items: center !important; gap: 12px !important;
      padding: 9px 14px !important; font-size: 12px !important; color: #cbd5e1 !important;
    }
    .row-list-item:nth-child(odd) { background: rgba(255,255,255,0.04) !important; }
    .row-list-item:nth-child(even) { background: rgba(255,255,255,0.02) !important; }
    .row-list-icon {
      font-size: 16px !important; flex-shrink: 0 !important;
      width: 24px !important; text-align: center !important;
    }

    /* 9. Before / After Diff Panel */
    .diff-panel {
      display: grid !important; grid-template-columns: 1fr 1fr !important;
      gap: 3px !important; width: 100% !important;
    }
    .diff-panel-left {
      background: rgba(244,63,94,0.07) !important;
      border: 1px solid rgba(244,63,94,0.22) !important;
      padding: 11px 14px !important; border-radius: 10px 0 0 10px !important;
    }
    .diff-panel-right {
      background: rgba(16,185,129,0.07) !important;
      border: 1px solid rgba(16,185,129,0.22) !important;
      padding: 11px 14px !important; border-radius: 0 10px 10px 0 !important;
    }
    .diff-label {
      font-size: 10px !important; font-weight: 700 !important;
      text-transform: uppercase !important; letter-spacing: 0.6px !important;
      margin-bottom: 8px !important; display: block !important;
    }

    section {
      width: 1440px !important;
      box-sizing: border-box !important;
    }
    section > div {
      width: 100% !important;
      box-sizing: border-box !important;
    }
    div[style*='height: 720px'],
    div[style*='height:720px'] {
      overflow: hidden !important;
      max-height: 720px !important;
    }
`;
