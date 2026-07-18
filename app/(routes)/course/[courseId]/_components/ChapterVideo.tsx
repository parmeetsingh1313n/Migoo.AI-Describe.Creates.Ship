import { useEffect, useMemo, useRef, useState, memo, useCallback } from "react";
import {
  AbsoluteFill,
  Audio,
  interpolate,
  Sequence,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { revealAssetTags, wrapInRevealDeck, REVEAL_INIT_SCRIPT, REVEAL_CUSTOM_FRAGMENT_STYLES, COMPONENT_STYLESHEET, CINEMATIC_DIRECTOR_SCRIPT, COMPONENT_ANIMATION_STYLES } from "@/lib/reveal-doc";

/* -------------------------------- Types -------------------------------- */

type CaptionChunk = {
  timestamp: [number, number];
};

type Slide = {
  slideId: string;
  html: string;
  audioFileUrl: string;
  revealData?: string[];    // legacy support (string IDs like "r1", "r2")
  fragmentData?: number[];  // new fragment indices
  caption?: {
    chunks: CaptionChunk[];
  };
};

/* ---------------------- Auto-Scale Script (iframe) ---------------------- */

/**
 * Inline script that auto-scales slide content to fit 1280×720.
 * Measures natural content size, then applies CSS transform scale + translate.
 */
const AUTO_SCALE_SCRIPT = `
<script>
(function() {
  var VIEWPORT_W = 1440;
  var VIEWPORT_H = 720;
  var MIN_SCALE = 0.25;
  var MAX_SCALE = 1.5;
  var lastScale = -1;

  // ── Apply Reveal.js data-background-* attributes as real CSS ──────────────
  // Our runtime doesn't use Reveal.js, so data-background-gradient / color
  // are never applied automatically. Without this fix all slides render on
  // a plain white background, making white text invisible.
  function applyBackgrounds() {
    // Handle data-background-gradient
    document.querySelectorAll('[data-background-gradient]').forEach(function(el) {
      var grad = el.getAttribute('data-background-gradient');
      if (grad) {
        el.style.background = grad;
        el.style.backgroundImage = grad;
        // Ensure the element covers the full viewport
        if (!el.style.minHeight) el.style.minHeight = VIEWPORT_H + 'px';
        if (!el.style.minWidth)  el.style.minWidth  = VIEWPORT_W + 'px';
      }
    });

    // Handle data-background-color
    document.querySelectorAll('[data-background-color]').forEach(function(el) {
      var col = el.getAttribute('data-background-color');
      if (col) {
        el.style.backgroundColor = col;
        if (!el.style.minHeight) el.style.minHeight = VIEWPORT_H + 'px';
        if (!el.style.minWidth)  el.style.minWidth  = VIEWPORT_W + 'px';
      }
    });

    // Handle data-background-image
    document.querySelectorAll('[data-background-image]').forEach(function(el) {
      var img = el.getAttribute('data-background-image');
      if (img) {
        el.style.backgroundImage = 'url(' + img + ')';
        el.style.backgroundSize = 'cover';
        el.style.backgroundPosition = 'center';
        if (!el.style.minHeight) el.style.minHeight = VIEWPORT_H + 'px';
        if (!el.style.minWidth)  el.style.minWidth  = VIEWPORT_W + 'px';
      }
    });

    // Mirror first slide's background onto body for seamless look
    var firstBg = document.querySelector('[data-background-gradient]');
    if (firstBg) {
      document.body.style.background = firstBg.getAttribute('data-background-gradient') || '';
    } else {
      var firstCol = document.querySelector('[data-background-color]');
      if (firstCol) {
        document.body.style.backgroundColor = firstCol.getAttribute('data-background-color') || '';
      } else {
        // Default dark background so white text is always visible
        document.body.style.background = 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)';
      }
    }
  }

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

    // Reset transform for measurement
    wrapper.style.transform = 'none';
    wrapper.style.width = VIEWPORT_W + 'px';
    wrapper.style.minHeight = '0';
    wrapper.style.height = 'auto';
    wrapper.style.overflow = 'visible';
    wrapper.style.position = 'relative';

    void wrapper.offsetHeight;

    var naturalH = wrapper.scrollHeight;
    var naturalW = wrapper.scrollWidth;

    // Baseline slide dimensions are 1280x720. If content collapses (e.g. < 100px),
    // treat the baseline as 720px/1280px.
    var measureH = naturalH;
    if (measureH < 100) measureH = VIEWPORT_H;
    var measureW = naturalW;
    if (measureW < 100) measureW = VIEWPORT_W;

    var scaleY = VIEWPORT_H / Math.max(measureH, 1);
    var scaleX = VIEWPORT_W / Math.max(measureW, 1);

    // ── HEIGHT IS THE REAL CONSTRAINT ─────────────────────────────────────────
    // A single wide element (e.g. a long, unwrapped code line) used to blow up
    // scrollWidth to ~3000px, which made scaleX tiny and collapsed the WHOLE
    // slide into a microscopic unreadable column. Content is now forced to wrap
    // (see .code-card / global wrap rules), so real width ≈ 1440. As a belt-and-
    // suspenders guard, clamp the width's influence so a stray-wide element can
    // only ever reduce the scale slightly — it must NEVER nuke the whole slide.
    scaleX = Math.max(scaleX, 0.82);
    var scale = Math.min(scaleX, scaleY);

    // We want to scale DOWN overflowing content, but NEVER scale UP sparse content beyond 1.0
    // to keep layout clean and readable.
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

  // Observe DOM changes
  var observer = new MutationObserver(function() {
    lastScale = -1;
    requestAnimationFrame(applyScale);
  });

  function init() {
    applyBackgrounds(); // ← run backgrounds FIRST, before scaling
    var wrapper = getWrapper();
    if (wrapper) {
      observer.observe(wrapper, { childList: true, subtree: true, attributes: true });
    }
    applyScale();
  }

  // Re-scale when images load
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
</script>
`;

/* ---------------------- Fragment Runtime (iframe) ---------------------- */

/**
 * Unified fragment system — handles BOTH old (data-reveal="r1") and
 * new (data-fragment-index="0") attributes.
 *
 * Old slides: class='reveal' data-reveal='r1' → toggled via REVEAL messages
 * New slides: class='fragment' data-fragment-index='0' → toggled via NAVIGATE_FRAGMENT
 *
 * All elements start hidden and are shown progressively.
 */
const FRAGMENT_RUNTIME_SCRIPT = `
<script>
(function () {
  // ---------- LEGACY REVEAL SUPPORT (data-reveal="r1", "r2", ...) ----------
  var revealedIds = new Set();

  function resetReveals() {
    revealedIds.clear();
    document.querySelectorAll("[data-reveal]").forEach(function(el) {
      if (el.getAttribute("data-reveal") === "r1") {
        el.classList.add("active");
      } else {
        el.classList.remove("active");
      }
    });
  }

  function revealById(id) {
    if (revealedIds.has(id)) return;
    revealedIds.add(id);
    var el = document.querySelector("[data-reveal='" + id + "']");
    if (el) el.classList.add("active");
  }

  function revealByIdImmediate(id) {
    if (revealedIds.has(id)) return;
    revealedIds.add(id);
    var el = document.querySelector("[data-reveal='" + id + "']");
    if (el) {
      el.style.transition = "none";
      el.classList.add("active");
      void el.offsetWidth;
      requestAnimationFrame(function() {
        setTimeout(function() { el.style.transition = ""; }, 50);
      });
    }
  }

  // ---------- NEW FRAGMENT SUPPORT (data-fragment-index="0", "1", ...) ----------
  function navigateFragment(targetIndex) {
    var fragments = document.querySelectorAll("[data-fragment-index]");
    fragments.forEach(function(el) {
      var idx = parseInt(el.getAttribute("data-fragment-index"), 10);
      if (idx <= targetIndex) {
        el.classList.add("visible", "current-fragment");
        el.style.opacity = "1";
        el.style.transform = "none";
      } else {
        el.classList.remove("visible", "current-fragment");
        el.style.opacity = "";
        el.style.transform = "";
      }
    });
  }

  function showAllFragments() {
    document.querySelectorAll("[data-fragment-index]").forEach(function(f) {
      f.classList.add("visible");
      f.style.opacity = "1";
      f.style.transform = "none";
    });
    document.querySelectorAll("[data-reveal]").forEach(function(el) {
      el.classList.add("active");
    });
  }

  // ---------- MESSAGE HANDLER ----------
  window.addEventListener("message", function (e) {
    var msg = e.data;
    if (!msg || !msg.type) return;

    // Legacy messages
    if (msg.type === "RESET") {
      resetReveals();
    } else if (msg.type === "REVEAL") {
      revealById(msg.id);
    } else if (msg.type === "REVEAL_IMMEDIATE") {
      revealByIdImmediate(msg.id);
    } else if (msg.type === "REVEAL_MULTIPLE") {
      msg.ids.forEach(function(id) { revealById(id); });
    } else if (msg.type === "REVEAL_MULTIPLE_IMMEDIATE") {
      msg.ids.forEach(function(id) { revealByIdImmediate(id); });
    }
    // New fragment messages
    else if (msg.type === "NAVIGATE_FRAGMENT") {
      navigateFragment(msg.index);
    } else if (msg.type === "SHOW_ALL_FRAGMENTS") {
      showAllFragments();
    } else if (msg.type === "RESET_FRAGMENTS") {
      navigateFragment(-1);
    }
  });

  // Ensure r1 heading is always visible on load (legacy)
  window.addEventListener("load", function() {
    var r1 = document.querySelector("[data-reveal='r1']");
    if (r1) r1.classList.add("active");
    // Signal ready
    window.parent.postMessage({ type: "REVEAL_READY" }, "*");
  });
})();
</script>
`;

/* ---------------------- Syntax Highlighter (iframe) ---------------------- */

/**
 * Zero-dependency syntax highlighter for `.code-card code` blocks.
 * Runs inside the iframe (and the Puppeteer render doc) so code is colored
 * identically in preview and final video — no CDN, no build step. It tokenizes
 * the raw text content once and wraps keywords / strings / numbers / comments /
 * function-calls / punctuation in `.tok-*` spans styled by the stylesheet.
 * Language-agnostic (covers JS/TS/Python/common C-like syntax).
 */
const CODE_HIGHLIGHT_SCRIPT = `
<script>
(function () {
  var KW = /\\b(function|return|if|else|for|while|const|let|var|def|class|import|from|export|new|await|async|try|catch|finally|throw|in|of|is|not|and|or|None|True|False|null|true|false|undefined|this|self|public|private|static|void|int|float|str|bool|print|lambda|yield|with|as|pass|break|continue|switch|case|default|typeof|instanceof)\\b/;
  function esc(s){ return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function hl(raw){
    // Token order matters: comments & strings first so their contents aren't re-tokenized.
    var re = /(\\/\\/[^\\n]*|#[^\\n]*)|("(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*'|\\\`(?:[^\\\`\\\\]|\\\\.)*\\\`)|(\\b\\d+(?:\\.\\d+)?\\b)|([A-Za-z_$][\\w$]*)(\\s*\\()|([A-Za-z_$][\\w$]*)|([{}()\\[\\].,;:=+\\-*\\/<>!&|?%]+)/g;
    var out = '', m;
    while ((m = re.exec(raw)) !== null) {
      if (m[1])      out += '<span class="tok-com">'   + esc(m[1]) + '</span>';
      else if (m[2]) out += '<span class="tok-str">'   + esc(m[2]) + '</span>';
      else if (m[3]) out += '<span class="tok-num">'   + esc(m[3]) + '</span>';
      else if (m[4]) out += '<span class="tok-fn">'    + esc(m[4]) + '</span>' + esc(m[5]);
      else if (m[6]) out += KW.test(m[6]) ? '<span class="tok-kw">' + esc(m[6]) + '</span>' : esc(m[6]);
      else if (m[7]) out += '<span class="tok-punct">' + esc(m[7]) + '</span>';
    }
    return out;
  }
  function run(){
    document.querySelectorAll('.code-card code, code.code-hl').forEach(function(el){
      if (el.getAttribute('data-hl') === '1') return;
      el.getAttribute('data-hl'); // no-op guard
      el.innerHTML = hl(el.textContent || '');
      el.setAttribute('data-hl','1');
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();
</script>
`;

/**
 * Build a clean HTML document from the LLM's slide HTML.
 * Handles both old (data-reveal) and new (data-fragment-index) slide formats.
 * NO CDN dependencies — everything is inlined.
 */
export const injectRuntime = (html: string): string => {
  let content = html;

  // ── FIX LLM ATTRIBUTE QUOTE MISMATCHES ─────────────────────────────────────
  // Sometimes LLMs generate mismatched quotes, like style='margin-bottom: 6px;"
  // or style='font-weight: 600;". This character-level sanitize ensures all
  // attributes are properly matched before injecting into the iframe.
  content = content.replace(/(\w+)='([^']*?)"/g, "$1='$2'");
  content = content.replace(/(\w+)="([^"]*?)'/g, "$1=\"$2\"");

  // Strip structural tags
  content = content.replace(/<!DOCTYPE[^>]*>/gi, '');
  content = content.replace(/<\/?html[^>]*>/gi, '');

  // Extract <head> content
  let headContent = '';
  const headMatch = content.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
  if (headMatch) {
    headContent = headMatch[1];
    content = content.replace(/<head[^>]*>[\s\S]*?<\/head>/i, '');
  }

  // Extract body content
  const bodyMatch = content.match(/<body([^>]*)>([\s\S]*)<\/body>/i);
  let bodyAttrs = '';
  if (bodyMatch) {
    bodyAttrs = bodyMatch[1] || '';
    content = bodyMatch[2];
  } else {
    content = content.replace(/<\/?body[^>]*>/gi, '');
  }

  // Remove any tailwind script tags (not needed)
  content = content.replace(/<script[^>]*tailwindcss[^>]*><\/script>/gi, '');


  const fullHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  ${headContent}
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=Outfit:wght@300;400;500;600;700;800;900&family=Poppins:wght@300;400;500;600;700;800;900&family=Space+Grotesk:wght@400;500;600;700&family=Playfair+Display:ital,wght@0,400..900;1,400..900&family=Instrument+Serif:ital@0;1&family=DM+Sans:ital,opsz,wght@0,9..40,100..1000;1,9..40,100..1000&display=swap');

    * { box-sizing: border-box; margin: 0; padding: 0; }

    /* ── NEVER OVERFLOW HORIZONTALLY ──────────────────────────────────────────
       A single wide element (long code line, unbreakable token, over-wide table)
       used to explode the slide's scrollWidth and force the auto-scaler to shrink
       the WHOLE slide into a tiny column. These guards make wide content wrap /
       stay bounded so width ≈ 1440 and only height drives any scaling. */
    pre, code, p, h1, h2, h3, h4, span, div, li, td, th, blockquote { overflow-wrap: anywhere; }
    pre, code, table, img, .code-card { max-width: 100% !important; }
    table { table-layout: fixed !important; }

    /* ---- HIDE SCROLLBAR APPEARANCE (cosmetic only) ---- */
    *::-webkit-scrollbar { display: none; width: 0; height: 0; }
    * { scrollbar-width: none; -ms-overflow-style: none; }

    /* ---- LEGACY REVEAL SYSTEM (data-reveal) ---- */
    [data-reveal] {
      opacity: 0;
      transform: translateY(20px);
      transition: opacity 0.7s cubic-bezier(0.4, 0, 0.2, 1),
                  transform 0.7s cubic-bezier(0.4, 0, 0.2, 1);
    }
    [data-reveal].active {
      opacity: 1 !important;
      transform: translateY(0) !important;
    }
    [data-reveal]:nth-child(odd) { transition-delay: 0.1s; }
    [data-reveal]:nth-child(even) { transition-delay: 0.2s; }

    /* ---- NEW FRAGMENT SYSTEM (data-fragment-index) ---- */
    [data-fragment-index] {
      opacity: 0;
      transition: all 0.6s cubic-bezier(0.4, 0, 0.2, 1);
    }
    [data-fragment-index].visible {
      opacity: 1 !important;
      transform: none !important;
      filter: none !important;
    }

    /* Fragment style: fade-up (default) */
    .fragment.fade-up, [data-fragment-index] {
      transform: translateY(30px);
    }

    /* Fragment style: fade-down */
    .fragment.fade-down {
      transform: translateY(-30px);
    }

    /* Fragment style: fade-left */
    .fragment.fade-left {
      transform: translateX(40px);
    }

    /* Fragment style: fade-right */
    .fragment.fade-right {
      transform: translateX(-40px);
    }

    /* Fragment style: grow */
    .fragment.grow {
      transform: scale(0.7);
    }

    /* Fragment style: shrink */
    .fragment.shrink {
      transform: scale(1.2);
    }

    /* Fragment style: scale-in (custom) */
    .fragment.scale-in {
      transform: scale(0.5);
    }

    /* Fragment style: blur-in (custom) */
    .fragment.blur-in {
      filter: blur(8px);
      transform: scale(0.95);
    }

    /* Fragment style: slide-up (custom) */
    .fragment.slide-up {
      transform: translateY(60px);
    }

    /* Fragment style: fade-in (just opacity) */
    .fragment.fade-in {
      transform: none;
    }

    /* Ensure images behave */
    img { max-width: 100%; }

    ${COMPONENT_STYLESHEET}
  </style>
</head>
<body${bodyAttrs} style="margin:0; padding:0; width:1440px; height:720px; overflow:hidden;">
  ${content}
  ${AUTO_SCALE_SCRIPT}
  ${FRAGMENT_RUNTIME_SCRIPT}
</body>
</html>`;

  return fullHtml;
};

/**
 * Build the iframe document using REAL reveal.js as the layout/fragment engine
 * (instead of the AUTO_SCALE_SCRIPT/FRAGMENT_RUNTIME_SCRIPT approximation
 * `injectRuntime` uses) — for slides on the numeric `fragmentData` system only.
 * Legacy `revealData` (string-ID) slides keep using `injectRuntime` above.
 */
export const injectRevealDeckRuntime = (html: string): string => {
  let content = html;

  content = content.replace(/(\w+)='([^']*?)"/g, "$1='$2'");
  content = content.replace(/(\w+)="([^"]*?)'/g, "$1=\"$2\"");
  content = content.replace(/<!DOCTYPE[^>]*>/gi, '');
  content = content.replace(/<\/?html[^>]*>/gi, '');

  let headContent = '';
  const headMatch = content.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
  if (headMatch) {
    headContent = headMatch[1];
    content = content.replace(/<head[^>]*>[\s\S]*?<\/head>/i, '');
  }

  const bodyMatch = content.match(/<body([^>]*)>([\s\S]*)<\/body>/i);
  if (bodyMatch) {
    content = bodyMatch[2];
  } else {
    content = content.replace(/<\/?body[^>]*>/gi, '');
  }
  content = content.replace(/<script[^>]*tailwindcss[^>]*><\/script>/gi, '');

  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <base href="${origin}/">
  ${headContent}
  ${revealAssetTags('')}
  ${REVEAL_CUSTOM_FRAGMENT_STYLES}
  ${COMPONENT_ANIMATION_STYLES}
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=Outfit:wght@300;400;500;600;700;800;900&family=Poppins:wght@300;400;500;600;700;800;900&family=Space+Grotesk:wght@400;500;600;700&family=Playfair+Display:ital,wght@0,400..900;1,400..900&family=Instrument+Serif:ital@0;1&family=DM+Sans:ital,opsz,wght@0,9..40,100..1000;1,9..40,100..1000&display=swap');
    * { box-sizing: border-box; margin: 0; padding: 0; }
    pre, code, p, h1, h2, h3, h4, span, div, li, td, th, blockquote { overflow-wrap: anywhere; }
    pre, code, table, img, .code-card { max-width: 100% !important; }
    table { table-layout: fixed !important; }
    *::-webkit-scrollbar { display: none; width: 0; height: 0; }
    * { scrollbar-width: none; -ms-overflow-style: none; }
    img { max-width: 100%; }
    section { box-sizing: border-box !important; }
    body { background: #0f172a; }
    ${COMPONENT_STYLESHEET}
  </style>
</head>
<body style="margin:0; padding:0; width:1440px; height:720px; overflow:hidden;">
  ${wrapInRevealDeck(content)}
  ${REVEAL_INIT_SCRIPT}
  ${CINEMATIC_DIRECTOR_SCRIPT}
</body>
</html>`;
};

/* ------------------- Isolated Static Slide IFrame ------------------- */

/**
 * Static component that is isolated from the 30fps useCurrentFrame() tick.
 * This guarantees the iframe only loads and compiles ONCE when the slide mounts,
 * rather than refreshing or reloading on every single frame, which blocks
 * the main thread and causes severe audio preview stuttering/repetition.
 */
const StaticSlideIFrame = memo(({
  html,
  iframeRef,
  onLoad,
  useReveal,
}: {
  html: string;
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  onLoad: () => void;
  useReveal: boolean;
}) => {
  const srcDoc = useMemo(
    () => (useReveal ? injectRevealDeckRuntime(html) : injectRuntime(html)),
    [html, useReveal]
  );

  return (
    <iframe
      ref={iframeRef}
      srcDoc={srcDoc}
      onLoad={onLoad}
      sandbox="allow-scripts allow-same-origin"
      style={{
        width: 1440,
        height: 720,
        border: "none",
        display: "block",
        backgroundColor: "#000"
      }}
    />
  );
});
StaticSlideIFrame.displayName = "StaticSlideIFrame";

/* ------------------- Slide iframe with fragment control ------------------- */

const SlideIFrameWithReveal = ({ slide }: { slide: Slide }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const time = frame / fps;

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const hasShownHeading = useRef(false);

  // Detect which system this slide uses
  const isLegacy = Boolean(slide.revealData?.length && typeof slide.revealData[0] === 'string' && String(slide.revealData[0]).startsWith('r'));
  const isNewFragment = Boolean(slide.fragmentData?.length);

  // Build reveal/fragment plan from captions
  const revealPlan = useMemo(() => {
    if (isLegacy) {
      // Legacy: use revealData string IDs
      const ids = slide.revealData ?? [];
      const chunks = slide.caption?.chunks ?? [];
      if (ids.length === 0) return [];

      return ids.map((id, i) => {
        const chunkTime = chunks[i]?.timestamp?.[0] ?? (i * 1.2);
        return { id, at: Math.max(0, chunkTime - 0.05) };
      });
    } else if (isNewFragment) {
      // New: use fragmentData indices
      const indices = slide.fragmentData ?? [];
      const chunks = slide.caption?.chunks ?? [];
      if (indices.length === 0) return [];

      return indices.map((idx, i) => {
        const chunkTime = chunks[i]?.timestamp?.[0] ?? (i * 1.2);
        return { index: idx, at: Math.max(0, chunkTime - 0.05) };
      });
    } else {
      // Fallback: check revealData with number arrays (from DB column)
      const data = slide.revealData ?? [];
      const chunks = slide.caption?.chunks ?? [];
      if (data.length === 0) return [];

      // Could be numbers stored as strings
      const isNumeric = data.length > 0 && !isNaN(Number(data[0]));
      if (isNumeric) {
        return data.map((val, i) => {
          const chunkTime = chunks[i]?.timestamp?.[0] ?? (i * 1.2);
          return { index: Number(val), at: Math.max(0, chunkTime - 0.05) };
        });
      }

      return data.map((id, i) => {
        const chunkTime = chunks[i]?.timestamp?.[0] ?? (i * 1.2);
        return { id: String(id), at: Math.max(0, chunkTime - 0.05) };
      });
    }
  }, [slide.slideId, slide.revealData, slide.fragmentData, slide.caption]);

  // Cinematic camera timeline — mirrors the video render's cineTimeline shape
  // ([{ index, startSec, endSec }]). Prefer the backend fragmentTimeline (same
  // source the MP4 uses); else derive one from revealPlan so the preview camera
  // moves identically to the downloaded video. Legacy string-ID slides get no
  // camera (they don't in the render either).
  const slideDurationSec = durationInFrames / fps;
  const cineTimeline = useMemo(() => {
    if (isLegacy) return [];
    const backend = (slide.caption as any)?.fragmentTimeline;
    if (Array.isArray(backend) && backend.length > 0) {
      return backend
        .filter((iv: any) => typeof iv?.index === 'number' && iv.index >= 0)
        .map((iv: any) => ({
          index: iv.index,
          startSec: iv.startSec ?? 0,
          endSec: iv.endSec ?? slideDurationSec,
        }));
    }
    // Derive from revealPlan: each fragment runs until the next one begins.
    const withIndex = revealPlan.filter((p: any) => typeof p.index === 'number' && p.index >= 0);
    return withIndex.map((p: any, i: number) => ({
      index: p.index as number,
      startSec: p.at as number,
      endSec: i + 1 < withIndex.length ? (withIndex[i + 1] as any).at : slideDurationSec,
    }));
  }, [isLegacy, slide.caption, revealPlan, slideDurationSec]);

  // Listen for REVEAL_READY from iframe
  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      if (e.data?.type === 'REVEAL_READY') {
        setReady(true);
        hasShownHeading.current = false;
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleLoad = useCallback(() => {
    // Also set ready on load as a fallback
    setTimeout(() => setReady(true), 100);
  }, []);

  const lastIndexRef = useRef<number>(-1);
  const sentRevealIds = useRef<Set<string>>(new Set());
  const lastTimeRef = useRef<number>(0);

  // Reset tracking when ready transitions or slideId changes
  useEffect(() => {
    lastIndexRef.current = -1;
    sentRevealIds.current.clear();
    hasShownHeading.current = false;
    lastTimeRef.current = 0;
  }, [slide.slideId, ready]);

  // Hand the cinematic timeline to the iframe once it's ready, so window.__seekTo
  // drives the SAME camera the video render uses.
  useEffect(() => {
    if (!ready || isLegacy) return;
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    win.postMessage({ type: 'INIT_CINE', timeline: cineTimeline, duration: slideDurationSec }, '*');
  }, [ready, isLegacy, cineTimeline, slideDurationSec]);

  // Drive reveals/fragments based on current time
  useEffect(() => {
    if (!ready) return;

    const win = iframeRef.current?.contentWindow;
    if (!win) return;

    const isBackward = time < lastTimeRef.current;
    lastTimeRef.current = time;

    if (isLegacy || (!isNewFragment && revealPlan.length > 0 && 'id' in revealPlan[0])) {
      // If we seeked backward, reset reveals
      if (isBackward) {
        sentRevealIds.current.clear();
        hasShownHeading.current = false;
        win.postMessage({ type: "RESET" }, "*");
      }

      // LEGACY: send REVEAL messages with string IDs only if they haven't been sent yet
      for (const item of revealPlan) {
        if ('id' in item && time >= item.at) {
          const id = item.id;
          if (!sentRevealIds.current.has(id)) {
            if (!hasShownHeading.current && id === 'r1') {
              win.postMessage({ type: "REVEAL_IMMEDIATE", id: "r1" }, "*");
              hasShownHeading.current = true;
            } else {
              win.postMessage({ type: "REVEAL", id }, "*");
            }
            sentRevealIds.current.add(id);
          }
        }
      }

      // Ensure heading is always visible
      if (!hasShownHeading.current) {
        win.postMessage({ type: "REVEAL_IMMEDIATE", id: "r1" }, "*");
        hasShownHeading.current = true;
        sentRevealIds.current.add('r1');
      }
    } else {
      // NEW FRAGMENT: drive the cinematic director by TIME every frame so the
      // camera pans/zooms smoothly — identical to the recorded video. __seekTo
      // both reveals fragments up to `time` AND moves the camera. If the slide
      // has no cine timeline (or the director isn't present), __seekTo still
      // just reveals fragments, and the fallback below keeps plain nav working.
      if (cineTimeline.length > 0) {
        win.postMessage({ type: 'SEEK', time }, '*');
      } else {
        let targetIndex = -1;
        for (const item of revealPlan) {
          if ('index' in item && time >= item.at) {
            targetIndex = item.index;
          }
        }
        if (targetIndex !== lastIndexRef.current || isBackward) {
          win.postMessage({ type: 'SEEK', time, index: targetIndex }, '*');
          lastIndexRef.current = targetIndex;
        }
      }
    }
  }, [time, ready, revealPlan, cineTimeline]);

  // Auto-scroll long code cards in sync with narration progress across the
  // slide's whole on-screen duration (independent of fragment reveal state).
  // No-op inside the iframe if the code fits without scrolling.
  useEffect(() => {
    if (!ready || isLegacy) return;
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    const progress = durationInFrames > 0 ? frame / durationInFrames : 0;
    win.postMessage({ type: 'SCROLL_CODE', progress }, '*');
  }, [frame, ready, isLegacy, durationInFrames]);

  // Soft audio fade-out in final 8 frames to prevent hard audio cuts between slides
  const FADE_OUT_FRAMES = 8;
  const audioVolume = interpolate(
    frame,
    [durationInFrames - FADE_OUT_FRAMES, durationInFrames],
    [1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <StaticSlideIFrame
        html={slide.html}
        iframeRef={iframeRef}
        onLoad={handleLoad}
        useReveal={!isLegacy}
      />
      <Audio src={slide.audioFileUrl} volume={audioVolume} pauseWhenBuffering />
    </AbsoluteFill>
  );
};

/* ----------------------------- Slide Transition Wrapper ----------------------------- */

const SlideWithTransition = ({
  slide,
  isFirstSlide
}: {
  slide: Slide;
  isFirstSlide: boolean;
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const fadeInDuration = 12;
  const opacity = isFirstSlide
    ? 1
    : interpolate(
      frame,
      [0, fadeInDuration],
      [0, 1],
      { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
    );

  const slideSpring = spring({
    frame,
    fps,
    config: {
      damping: 18,
      stiffness: 100,
    },
  });

  const translateX = isFirstSlide
    ? 0
    : interpolate(slideSpring, [0, 1], [80, 0]);

  return (
    <AbsoluteFill
      style={{
        opacity,
        transform: `translateX(${translateX}px)`,
      }}
    >
      <SlideIFrameWithReveal slide={slide} />
    </AbsoluteFill>
  );
};

/* ----------------------------- Course Composition ----------------------------- */

type Props = {
  slides: Slide[];
  durationsBySlideId: Record<string, number>;
};

export const CourseComposition = ({ slides, durationsBySlideId }: Props) => {
  const { fps } = useVideoConfig();

  const timeline = useMemo(() => {
    let from = 0;
    return slides.map((slide, index) => {
      const dur = durationsBySlideId[slide.slideId] ?? Math.ceil(6 * fps);
      const item = {
        slide,
        from,
        dur,
        isFirstSlide: index === 0
      };

      // ── NO transition overlap! ────────────────────────────────────────────────
      // Overlapping sequences means two <Audio> elements play at the same time,
      // causing the "repeating seconds" audio glitch. Each slide starts exactly
      // when the previous one ends. The visual fade-in on SlideWithTransition
      // still creates a smooth look without any audio overlap.
      from += dur;

      return item;
    });
  }, [slides, durationsBySlideId, fps]);

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {timeline.map(({ slide, from, dur, isFirstSlide }) => (
        <Sequence key={slide.slideId} from={from} durationInFrames={dur} premountFor={30}>
          <SlideWithTransition slide={slide} isFirstSlide={isFirstSlide} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};