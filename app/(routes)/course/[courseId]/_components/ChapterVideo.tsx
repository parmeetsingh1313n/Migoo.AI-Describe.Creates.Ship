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
    scale = Math.min(scaleX, scaleY);
    
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

/* ---------------------- Inject Runtime into HTML ---------------------- */

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

    /* ── DYNAMIC HEIGHT FOR MEASUREMENT & DYNAMIC AUTO-SCALE ────────────────── */
    /* We remove hard height/max-height clamps so the script can measure the     */
    /* natural height of overflowing slides. The transform fits content in        */
    /* 1440×720.                                                                  */
    section {
      width: 1440px !important;
      box-sizing: border-box !important;
    }
    /*
     * DO NOT set height: 100% on all section > div children.
     * Slides can have multiple sibling divs directly inside <section>
     * (decorative circles, badge fragments, main layout, footer, etc.).
     * Forcing height: 100% on ALL of them makes fragment wrapper divs
     * (e.g. the badges div with data-fragment-index='0') expand to 720px,
     * pushing the title, subtitle and all main content below the fold.
     *
     * Only ensure width is 100% here; individual slides that need their
     * inner wrapper to be 720px tall already declare that in inline styles.
     */
    section > div {
      width: 100% !important;
      box-sizing: border-box !important;
    }
    /* Full-bleed / watermark absolute containers must respect 720px */
    div[style*='height: 720px'],
    div[style*='height:720px'] {
      overflow: hidden !important;
      max-height: 720px !important;
    }
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
  onLoad
}: {
  html: string;
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  onLoad: () => void;
}) => {
  const srcDoc = useMemo(() => injectRuntime(html), [html]);

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
      // NEW FRAGMENT: send NAVIGATE_FRAGMENT with highest visible index
      let targetIndex = -1;
      for (const item of revealPlan) {
        if ('index' in item && time >= item.at) {
          targetIndex = item.index;
        }
      }

      // Only post if index changed or we seeked backward
      if (targetIndex !== lastIndexRef.current || isBackward) {
        win.postMessage({ type: 'NAVIGATE_FRAGMENT', index: targetIndex }, '*');
        lastIndexRef.current = targetIndex;
      }
    }
  }, [time, ready, revealPlan]);

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