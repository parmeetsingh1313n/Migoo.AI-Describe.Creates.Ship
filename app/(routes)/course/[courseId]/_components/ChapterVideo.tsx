import { useEffect, useMemo, useRef, useState } from "react";
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
  var VIEWPORT_W = 1280;
  var VIEWPORT_H = 720;
  var MIN_SCALE = 0.25;
  var MAX_SCALE = 1.5;
  var lastScale = -1;

  function getWrapper() {
    var children = document.body.children;
    for (var i = 0; i < children.length; i++) {
      if (children[i].tagName === 'DIV') return children[i];
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

    var scaleY = VIEWPORT_H / Math.max(naturalH, 1);
    var scaleX = VIEWPORT_W / Math.max(naturalW, 1);
    var scale = Math.min(scaleX, scaleY);
    scale = Math.min(scale, MAX_SCALE);
    scale = Math.max(scale, MIN_SCALE);

    if (Math.abs(scale - lastScale) < 0.002) return;
    lastScale = scale;

    var scaledH = naturalH * scale;
    var offsetY = Math.max(0, (VIEWPORT_H - scaledH) / 2);
    var scaledW = naturalW * scale;
    var offsetX = Math.max(0, (VIEWPORT_W - scaledW) / 2);

    wrapper.style.transformOrigin = 'top left';
    wrapper.style.transform = 'translate(' + offsetX + 'px, ' + offsetY + 'px) scale(' + scale + ')';
    wrapper.style.width = VIEWPORT_W + 'px';
    wrapper.style.height = naturalH + 'px';
    wrapper.style.overflow = 'visible';
  }

  // Observe DOM changes
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
const injectRuntime = (html: string): string => {
  let content = html;

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
  </style>
</head>
<body${bodyAttrs} style="margin:0; padding:0; width:1280px; height:720px; overflow:hidden;">
  ${content}
  ${AUTO_SCALE_SCRIPT}
  ${FRAGMENT_RUNTIME_SCRIPT}
</body>
</html>`;

  return fullHtml;
};

/* ------------------- Slide iframe with fragment control ------------------- */

const SlideIFrameWithReveal = ({ slide }: { slide: Slide }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
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

  const handleLoad = () => {
    // Also set ready on load as a fallback
    setTimeout(() => setReady(true), 100);
  };

  // Drive reveals/fragments based on current time
  useEffect(() => {
    if (!ready) return;

    const win = iframeRef.current?.contentWindow;
    if (!win) return;

    if (isLegacy || (!isNewFragment && revealPlan.length > 0 && 'id' in revealPlan[0])) {
      // LEGACY: send REVEAL messages with string IDs
      for (const item of revealPlan) {
        if ('id' in item && time >= item.at) {
          if (!hasShownHeading.current && item.id === 'r1') {
            win.postMessage({ type: "REVEAL_IMMEDIATE", id: "r1" }, "*");
            hasShownHeading.current = true;
          } else {
            win.postMessage({ type: "REVEAL", id: item.id }, "*");
          }
        }
      }

      // Ensure heading is always visible
      if (!hasShownHeading.current) {
        win.postMessage({ type: "REVEAL_IMMEDIATE", id: "r1" }, "*");
        hasShownHeading.current = true;
      }
    } else {
      // NEW FRAGMENT: send NAVIGATE_FRAGMENT with highest visible index
      let targetIndex = -1;
      for (const item of revealPlan) {
        if ('index' in item && time >= item.at) {
          targetIndex = item.index;
        }
      }
      win.postMessage({ type: 'NAVIGATE_FRAGMENT', index: targetIndex }, '*');
    }
  }, [time, ready, revealPlan]);

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <iframe
        ref={iframeRef}
        srcDoc={injectRuntime(slide.html)}
        onLoad={handleLoad}
        sandbox="allow-scripts allow-same-origin"
        style={{
          width: 1280,
          height: 720,
          border: "none",
          display: "block",
          backgroundColor: "#000"
        }}
      />
      <Audio src={slide.audioFileUrl} />
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

  const TRANSITION_FRAMES = 10;

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

      from += dur - (index < slides.length - 1 ? TRANSITION_FRAMES : 0);

      return item;
    });
  }, [slides, durationsBySlideId, fps]);

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {timeline.map(({ slide, from, dur, isFirstSlide }) => (
        <Sequence key={slide.slideId} from={from} durationInFrames={dur}>
          <SlideWithTransition slide={slide} isFirstSlide={isFirstSlide} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};