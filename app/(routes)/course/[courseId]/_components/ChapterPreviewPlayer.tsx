'use client';

import React, {
    useCallback, useEffect, useMemo, useRef, useState, memo, startTransition
} from 'react';
import { Maximize, Minimize, Pause, Play, SkipBack, SkipForward, Volume2, VolumeX, Settings } from 'lucide-react';
import { injectRuntime } from './ChapterVideo';

/* ----------------------------- Types ----------------------------- */

export type PreviewSlide = {
    slideId: string;
    html: string;
    audioUrl: string;
    revealData?: string[] | number[];
    fragmentData?: number[];
    caption?: {
        chunks: { timestamp: [number, number] }[];
    };
};

type Props = {
    slides: PreviewSlide[];
    durationsBySlideId: Record<string, number>;
    fps?: number;
};

/* ----------------------------- Helpers ----------------------------- */

function formatTime(totalSeconds: number): string {
    const mins = Math.floor(totalSeconds / 60);
    const secs = Math.floor(totalSeconds % 60);
    return `${mins}:${String(secs).padStart(2, '0')}`;
}

/* ── Memoized iframe — only re-renders when slide content or visibility changes ── */
const SlideIFrame = memo(({
    runtimeHtml,
    active,
    scale,
    offsetX,
    offsetY,
    iframeRef,
}: {
    runtimeHtml: string;
    active: boolean;
    scale: number;
    offsetX: number;
    offsetY: number;
    iframeRef: (el: HTMLIFrameElement | null) => void;
}) => (
    <iframe
        ref={iframeRef}
        srcDoc={runtimeHtml}
        sandbox="allow-scripts allow-same-origin"
        style={{
            position: 'absolute',
            top: 0, left: 0,
            width: '1440px', height: '720px',
            border: 'none',
            transform: `translate(${offsetX}px, ${offsetY}px) scale(${scale})`,
            transformOrigin: 'top left',
            opacity: active ? 1 : 0,
            transition: active ? 'opacity 0.22s ease' : 'none',
            pointerEvents: 'none',
            zIndex: active ? 1 : 0,
            backgroundColor: '#000',
            willChange: 'opacity',
        }}
    />
), (p, n) =>
    p.runtimeHtml === n.runtimeHtml &&
    p.active    === n.active    &&
    p.scale     === n.scale     &&
    p.offsetX   === n.offsetX   &&
    p.offsetY   === n.offsetY
);
SlideIFrame.displayName = 'SlideIFrame';

/* ── Memoized hidden audio elements — one per slide, ALL preloaded ── */
const SlideAudio = memo(({
    audioUrl,
    audioRef,
}: {
    audioUrl: string;
    audioRef: (el: HTMLAudioElement | null) => void;
}) => (
    <audio
        ref={audioRef}
        src={audioUrl}
        preload="auto"
        style={{ display: 'none' }}
    />
), (p, n) => p.audioUrl === n.audioUrl);
SlideAudio.displayName = 'SlideAudio';

/* ----------------------------- Component ----------------------------- */

export function ChapterPreviewPlayer({ slides, durationsBySlideId, fps = 30 }: Props) {
    /* ── Core playback state (kept minimal — only UI-visible things) ── */
    const [currentIndex, setCurrentIndex]   = useState(0);
    const [isPlaying, setIsPlaying]         = useState(false);
    const [isFullscreen, setIsFullscreen]   = useState(false);
    const [progressPct, setProgressPct]     = useState(0);
    const [displayTime, setDisplayTime]     = useState({ global: 0, total: 0 });

    /* ── Premium Control States ── */
    const [volume, setVolume]               = useState(1);
    const [isMuted, setIsMuted]             = useState(false);
    const [playbackSpeed, setPlaybackSpeed] = useState(1);
    const [showSpeedMenu, setShowSpeedMenu] = useState(false);
    const [hoverTime, setHoverTime]         = useState<number | null>(null);
    const [hoverX, setHoverX]               = useState(0);
    const [isHoveringBar, setIsHoveringBar] = useState(false);

    /* ── Refs (hot path — no React re-renders) ── */
    const currentIndexRef   = useRef(0);
    const isPlayingRef      = useRef(false);
    const totalSecondsRef   = useRef(0);
    const rafIdRef          = useRef<number>(0);
    const lastUIUpdateRef   = useRef(0);          // throttle: only update UI at ~10fps
    const isDraggingRef     = useRef(false);
    const seekingRef        = useRef(false);      // guards against ended-event race
    const seekLockUntilRef  = useRef(0);           // ms timestamp — RAF ignores audio.currentTime before this
    const containerRef      = useRef<HTMLDivElement>(null);
    const wrapperRef        = useRef<HTMLDivElement>(null);
    const iframeRefs        = useRef<Record<string, HTMLIFrameElement | null>>({});
    const audioRefs         = useRef<Record<string, HTMLAudioElement | null>>({});
    const pendingSeekRef    = useRef<number | null>(null);
    const localTimeRef      = useRef(0);

    const volumeRef         = useRef(1);
    const isMutedRef        = useRef(false);
    const playbackSpeedRef  = useRef(1);

    /* ── Dimensions & scale ── */
    const [dimensions, setDimensions] = useState({ width: 1440, height: 720 });
    useEffect(() => {
        const el = wrapperRef.current;
        if (!el) return;
        const ro = new ResizeObserver(entries => {
            for (const e of entries) {
                const { width, height } = e.contentRect;
                setDimensions({ width: width || 1440, height: height || 720 });
            }
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    const scale   = useMemo(() => Math.min(dimensions.width / 1440, dimensions.height / 720), [dimensions]);
    const offsetX = useMemo(() => (dimensions.width  - 1440 * scale) / 2, [dimensions, scale]);
    const offsetY = useMemo(() => (dimensions.height -  720 * scale) / 2, [dimensions, scale]);

    /* ── Pre-compute runtime HTML once per slide ── */
    const slidesWithHtml = useMemo(() =>
        slides.map(s => ({ ...s, runtimeHtml: injectRuntime(s.html) })),
        [slides]
    );

    /* ── Timeline (cumulative seconds per slide) ── */
    const timeline = useMemo(() => {
        let cumulative = 0;
        return slides.map(slide => {
            const durationSecs = (durationsBySlideId[slide.slideId] ?? 6 * fps) / fps;
            const entry = { slideId: slide.slideId, startSec: cumulative, durationSecs };
            cumulative += durationSecs;
            return entry;
        });
    }, [slides, durationsBySlideId, fps]);

    const totalSeconds = useMemo(() => {
        if (!timeline.length) return 0;
        const last = timeline[timeline.length - 1];
        return last.startSec + last.durationSecs;
    }, [timeline]);

    totalSecondsRef.current = totalSeconds;

    /* ── Helper: get the active audio element ── */
    const activeAudio = useCallback(() =>
        audioRefs.current[slides[currentIndexRef.current]?.slideId ?? ''] ?? null,
        [slides]
    );

    /* ── Helper: jump to a specific slide + offset without state thrashing ── */
    const seekTo = useCallback((slideIndex: number, offsetSec: number, shouldPlay: boolean) => {
        // Guard: prevent handleAudioEnded from firing during this seek
        seekingRef.current = true;

        const prevIdx = currentIndexRef.current;

        // Pause old audio (may trigger 'ended' — seekingRef blocks that)
        const oldAudio = audioRefs.current[slides[prevIdx]?.slideId ?? ''];
        if (oldAudio) {
            oldAudio.pause();
            // Reset to start so it doesn't fire 'ended' after we unguard
            try { oldAudio.currentTime = 0; } catch (_) {}
        }

        // Update ref immediately
        currentIndexRef.current = slideIndex;
        localTimeRef.current = offsetSec;

        const newAudio = audioRefs.current[slides[slideIndex]?.slideId ?? ''];
        if (newAudio) {
            // Apply volume and playbackRate state immediately
            newAudio.volume = isMutedRef.current ? 0 : volumeRef.current;
            newAudio.playbackRate = playbackSpeedRef.current;

            // If audio is ready, seek immediately
            if (newAudio.readyState >= 2) {
                newAudio.currentTime = offsetSec;
                if (shouldPlay) newAudio.play().catch(() => {});
            } else {
                // Not ready — queue seek on canplay
                pendingSeekRef.current = offsetSec;
                newAudio.load(); // Force load so browser fetches it and canplay fires
                const onReady = () => {
                    newAudio.currentTime = offsetSec;
                    newAudio.volume = isMutedRef.current ? 0 : volumeRef.current;
                    newAudio.playbackRate = playbackSpeedRef.current;
                    if (shouldPlay) newAudio.play().catch(() => {});
                    newAudio.removeEventListener('canplay', onReady);
                };
                newAudio.addEventListener('canplay', onReady);
            }
        }

        // Lock the RAF loop for 600ms so it doesn't overwrite the seeked display
        // with stale audio.currentTime (audio might not have seeked yet)
        seekLockUntilRef.current = performance.now() + 600;

        // Update localTimeRef immediately so RAF loop reflects new position right away
        localTimeRef.current = offsetSec;

        // IMMEDIATE React state update — must not defer, the iframe switch depends on it
        setCurrentIndex(slideIndex);

        // Allow ended events again after this tick
        requestAnimationFrame(() => { seekingRef.current = false; });
    }, [slides]);

    /* ── RAF loop — runs at 60fps but only touches React state at ~10fps ── */
    useEffect(() => {
        const tick = (now: number) => {
            const audio = activeAudio();

            // During the seek-lock window, skip audio.currentTime reads entirely.
            // seekFromFraction already called setProgressPct/setDisplayTime with the
            // correct target values — we just hold those until the audio has actually seeked.
            const isLocked = performance.now() < seekLockUntilRef.current;

            if (!isLocked && audio && isPlayingRef.current) {
                localTimeRef.current = audio.currentTime;

                // Throttle React state updates to ~10fps (every 100ms)
                if (now - lastUIUpdateRef.current >= 100) {
                    lastUIUpdateRef.current = now;
                    const globalT = (timeline[currentIndexRef.current]?.startSec ?? 0) + audio.currentTime;
                    const total   = totalSecondsRef.current;
                    const pct     = total > 0 ? (globalT / total) * 100 : 0;

                    startTransition(() => {
                        setProgressPct(pct);
                        setDisplayTime({ global: globalT, total });
                    });
                }
            }
            rafIdRef.current = requestAnimationFrame(tick);
        };

        rafIdRef.current = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(rafIdRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [timeline]); // only re-create when timeline changes

    /* ── Audio ended → advance to next slide ── */
    const handleAudioEnded = useCallback((slideIndex: number) => {
        // Ignore ended events that fire during a seek operation
        if (seekingRef.current) return;
        if (slideIndex !== currentIndexRef.current) return; // stale handler
        if (slideIndex < slides.length - 1) {
            seekTo(slideIndex + 1, 0, true);
        } else {
            isPlayingRef.current = false;
            setIsPlaying(false);
            const total = totalSecondsRef.current;
            setProgressPct(100);
            setDisplayTime({ global: total, total });
        }
    }, [slides.length, seekTo]);

    /* ── Controls ── */
    const play = useCallback(() => {
        const audio = activeAudio();
        if (audio) {
            audio.volume = isMutedRef.current ? 0 : volumeRef.current;
            audio.playbackRate = playbackSpeedRef.current;
            audio.play().catch(() => {});
        }
        isPlayingRef.current = true;
        setIsPlaying(true);
    }, [activeAudio]);

    const pause = useCallback(() => {
        activeAudio()?.pause();
        isPlayingRef.current = false;
        setIsPlaying(false);
    }, [activeAudio]);

    const togglePlay = useCallback(() => {
        if (isPlayingRef.current) pause(); else play();
    }, [play, pause]);

    const skip = useCallback((seconds: number) => {
        const audio = activeAudio();
        if (!audio) return;
        const newTime = (audio.currentTime ?? 0) + seconds;
        const idx = currentIndexRef.current;

        if (newTime < 0 && idx > 0) {
            const prevDur = timeline[idx - 1].durationSecs;
            seekTo(idx - 1, Math.max(0, prevDur + newTime), isPlayingRef.current);
        } else if (audio.duration && newTime > audio.duration && idx < slides.length - 1) {
            seekTo(idx + 1, 0, isPlayingRef.current);
        } else {
            audio.currentTime = Math.max(0, newTime);
        }
    }, [activeAudio, timeline, slides.length, seekTo]);

    /* ── Progress bar — supports both click and drag ── */
    const seekFromFraction = useCallback((fraction: number) => {
        const clamped = Math.max(0, Math.min(1, fraction));
        const targetGlobal = clamped * totalSecondsRef.current;

        let targetIdx = 0;
        for (let i = 0; i < timeline.length; i++) {
            if (targetGlobal >= timeline[i].startSec) targetIdx = i;
            else break;
        }
        const offset = targetGlobal - timeline[targetIdx].startSec;
        seekTo(targetIdx, offset, isPlayingRef.current);

        // Instantly update the progress bar (don't wait for RAF)
        const pct = clamped * 100;
        setProgressPct(pct);
        setDisplayTime({ global: targetGlobal, total: totalSecondsRef.current });
    }, [timeline, seekTo]);

    const progressBarRef = useRef<HTMLDivElement>(null);

    const fractionFromEvent = useCallback((e: MouseEvent | React.MouseEvent) => {
        const rect = progressBarRef.current?.getBoundingClientRect();
        if (!rect || rect.width === 0) return 0;
        return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    }, []);

    const handleProgressMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        e.preventDefault();
        isDraggingRef.current = true;

        // Prevent text-selection & "banned" cursor globally during drag
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'grabbing';

        seekFromFraction(fractionFromEvent(e));

        const onMove = (ev: MouseEvent) => {
            if (isDraggingRef.current) seekFromFraction(fractionFromEvent(ev));
        };
        const onUp = () => {
            isDraggingRef.current = false;
            // Restore global cursor/selection
            document.body.style.userSelect = '';
            document.body.style.cursor = '';
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    }, [seekFromFraction, fractionFromEvent]);

    const handleProgressMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
        const rect = progressBarRef.current?.getBoundingClientRect();
        if (!rect || rect.width === 0) return;
        const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        setHoverTime(fraction * totalSecondsRef.current);
        setHoverX(e.clientX - rect.left);
    };

    const handleProgressMouseLeave = () => {
        setHoverTime(null);
        setIsHoveringBar(false);
    };

    /* ── Premium Speed & Volume Actions ── */
    const handleSpeedChange = (speed: number) => {
        playbackSpeedRef.current = speed;
        setPlaybackSpeed(speed);
        setShowSpeedMenu(false);
        const audio = activeAudio();
        if (audio) {
            audio.playbackRate = speed;
        }
    };

    const handleVolumeChange = (newVolume: number) => {
        volumeRef.current = newVolume;
        setVolume(newVolume);
        if (newVolume > 0) {
            isMutedRef.current = false;
            setIsMuted(false);
        }
        const audio = activeAudio();
        if (audio) {
            audio.volume = isMutedRef.current ? 0 : newVolume;
        }
    };

    const toggleMute = useCallback(() => {
        const nextMute = !isMutedRef.current;
        isMutedRef.current = nextMute;
        setIsMuted(nextMute);
        const audio = activeAudio();
        if (audio) {
            audio.volume = nextMute ? 0 : volumeRef.current;
        }
    }, [activeAudio]);


    /* ── Fullscreen ── */
    const toggleFullscreen = useCallback(() => {
        const el = containerRef.current;
        if (!el) return;
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
        else el.requestFullscreen().catch(() => {});
    }, []);
    useEffect(() => {
        const h = () => setIsFullscreen(!!document.fullscreenElement);
        document.addEventListener('fullscreenchange', h);
        return () => document.removeEventListener('fullscreenchange', h);
    }, []);

    /* ── Keyboard Shortcuts ── */
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const activeTag = document.activeElement?.tagName.toLowerCase();
            if (activeTag === 'input' || activeTag === 'textarea') return;

            switch (e.code) {
                case 'Space':
                    e.preventDefault();
                    togglePlay();
                    break;
                case 'ArrowRight':
                    e.preventDefault();
                    skip(5);
                    break;
                case 'ArrowLeft':
                    e.preventDefault();
                    skip(-5);
                    break;
                case 'KeyF':
                    e.preventDefault();
                    toggleFullscreen();
                    break;
                case 'KeyM':
                    e.preventDefault();
                    toggleMute();
                    break;
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [togglePlay, skip, toggleFullscreen
        , toggleMute]);

    /* ── Reveal / fragment sync — only runs when localTime crosses a boundary ── */
    const lastTimeRef = useRef<number>(0);
    const lastRevealIdxRef = useRef<number>(-1);
    useEffect(() => {
        let rafId: number;
        const syncReveal = () => {
            const slide = slides[currentIndexRef.current];
            if (!slide) { rafId = requestAnimationFrame(syncReveal); return; }

            const iframe = iframeRefs.current[slide.slideId];
            const win = iframe?.contentWindow;
            if (!win) { rafId = requestAnimationFrame(syncReveal); return; }

            const lTime = localTimeRef.current;
            const isBackward = lTime < lastTimeRef.current;
            lastTimeRef.current = lTime;

            const isLegacy = Boolean(slide.revealData?.length && typeof slide.revealData[0] === 'string' && String(slide.revealData[0]).startsWith('r'));
            const isNewFragment = Boolean(slide.fragmentData?.length);

            if (isLegacy) {
                const ids = (slide.revealData as string[]) ?? [];
                const chunks = slide.caption?.chunks ?? [];
                let lastRevealedIdx = -1;
                for (let i = 0; i < ids.length; i++) {
                    const at = Math.max(0, (chunks[i]?.timestamp?.[0] ?? i * 1.2) - 0.05);
                    if (lTime >= at) lastRevealedIdx = i;
                }

                if (isBackward) {
                    lastRevealIdxRef.current = -1;
                    win.postMessage({ type: 'RESET' }, '*');
                }

                if (lastRevealedIdx !== lastRevealIdxRef.current) {
                    lastRevealIdxRef.current = lastRevealedIdx;
                    for (let i = 0; i <= lastRevealedIdx; i++) {
                        win.postMessage({ type: i === 0 ? 'REVEAL_IMMEDIATE' : 'REVEAL', id: ids[i] }, '*');
                    }
                    if (lastRevealedIdx < 0) {
                        win.postMessage({ type: 'REVEAL_IMMEDIATE', id: ids[0] }, '*');
                    }
                }
            } else if (isNewFragment || (slide.revealData?.length && !isNaN(Number(slide.revealData[0])))) {
                const indices = slide.fragmentData ?? (slide.revealData?.map(Number) ?? []);
                const chunks = slide.caption?.chunks ?? [];
                let targetIdx = -1;
                for (let i = 0; i < indices.length; i++) {
                    const at = Math.max(0, (chunks[i]?.timestamp?.[0] ?? i * 1.2) - 0.05);
                    if (lTime >= at) targetIdx = indices[i] as number;
                }
                if (targetIdx !== lastRevealIdxRef.current) {
                    lastRevealIdxRef.current = targetIdx;
                    win.postMessage({ type: 'NAVIGATE_FRAGMENT', index: targetIdx }, '*');
                }
            }

            rafId = requestAnimationFrame(syncReveal);
        };
        rafId = requestAnimationFrame(syncReveal);
        return () => cancelAnimationFrame(rafId);
    }, [slides]);

    /* Reset reveal state when slide changes */
    useEffect(() => {
        lastRevealIdxRef.current = -1;
        lastTimeRef.current = 0;
    }, [currentIndex]);



    /* ── Reset when slide list changes ── */
    const slideKey = slides.map(s => s.slideId).join(',');
    useEffect(() => {
        currentIndexRef.current = 0;
        isPlayingRef.current = false;
        localTimeRef.current = 0;
        Object.values(audioRefs.current).forEach(a => { if (a) { a.pause(); try { a.currentTime = 0; } catch(_) {} } });
        setCurrentIndex(0);
        setIsPlaying(false);
        setProgressPct(0);
        setDisplayTime({ global: 0, total: totalSecondsRef.current });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [slideKey]);

    /* ── Styles ── */
    const btnStyle: React.CSSProperties = {
        background: 'none', border: 'none', color: 'white', cursor: 'pointer',
        padding: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center',
        borderRadius: '4px', transition: 'background 0.15s, transform 0.1s',
    };

    return (
        <div
            ref={containerRef}
            style={{
                position: 'relative',
                background: '#000',
                width: '100%',
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                borderRadius: isFullscreen ? 0 : '16px',
                overflow: 'hidden',
                boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
                border: isFullscreen ? 'none' : '1px solid rgba(255, 255, 255, 0.1)',
            }}
        >
            {/* ── Hidden audio elements — one per slide, ALL pre-loaded ── */}
            {slides.map(slide => (
                <SlideAudio
                    key={slide.slideId}
                    audioUrl={slide.audioUrl}
                    audioRef={el => { audioRefs.current[slide.slideId] = el; }}
                />
            ))}
            {/* Per-slide audio ended handlers (attached after ref is set) */}
            <AudioEndedHandlers
                slides={slides}
                audioRefs={audioRefs}
                onEnded={handleAudioEnded}
            />

            {/* ── Slide iframes — all pre-loaded, only one visible ── */}
            <div ref={wrapperRef} style={{ flex: 1, position: 'relative', overflow: 'hidden', backgroundColor: '#000' }}>
                {slidesWithHtml.map((slide, i) => (
                    <SlideIFrame
                        key={slide.slideId}
                        runtimeHtml={slide.runtimeHtml}
                        active={i === currentIndex}
                        scale={scale}
                        offsetX={offsetX}
                        offsetY={offsetY}
                        iframeRef={el => { iframeRefs.current[slide.slideId] = el; }}
                    />
                ))}

                {/* Click-to-play overlay */}
                {!isPlaying && (
                    <div
                        onClick={togglePlay}
                        style={{
                            position: 'absolute', inset: 0,
                            zIndex: 10, cursor: 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            background: 'rgba(0,0,0,0.4)',
                            backdropFilter: 'blur(4px)',
                            transition: 'all 0.3s ease',
                        }}
                    >
                        <div style={{
                            width: 68, height: 68, borderRadius: '50%',
                            background: 'linear-gradient(135deg, #ef4444, #f97316)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            boxShadow: '0 10px 30px rgba(239, 68, 68, 0.5)',
                            transform: 'scale(1)',
                            transition: 'transform 0.2s',
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.1)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
                        >
                            <Play size={28} fill="white" color="white" style={{ marginLeft: 4 }} />
                        </div>
                    </div>
                )}
            </div>

            {/* ── Controls Bar (Glassmorphic) ── */}
            <div style={{
                display: 'flex', flexDirection: 'column', gap: 6,
                padding: '12px 16px',
                background: 'linear-gradient(180deg, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0.95) 100%)',
                backdropFilter: 'blur(10px)',
                borderTop: '1px solid rgba(255,255,255,0.08)',
                borderRadius: isFullscreen ? 0 : '0 0 16px 16px',
                flexShrink: 0,
                zIndex: 20,
            }}>
                {/* Draggable progress bar — 20px transparent hit area with thin visual track inside */}
                <div
                    ref={progressBarRef}
                    onMouseDown={handleProgressMouseDown}
                    onMouseMove={handleProgressMouseMove}
                    onMouseLeave={handleProgressMouseLeave}
                    onMouseEnter={() => setIsHoveringBar(true)}
                    style={{
                        width: '100%',
                        height: 20,          /* large transparent hit area */
                        cursor: 'pointer',
                        position: 'relative',
                        userSelect: 'none',
                        display: 'flex',
                        alignItems: 'center',
                    }}
                >
                    {/* Timestamp Tooltip on Hover — positioned relative to hit-area wrapper */}
                    {hoverTime !== null && (
                        <div style={{
                            position: 'absolute',
                            bottom: '24px',
                            left: `${hoverX}px`,
                            transform: 'translateX(-50%)',
                            background: 'rgba(15, 23, 42, 0.95)',
                            border: '1px solid rgba(255,255,255,0.15)',
                            color: 'white',
                            padding: '3px 8px',
                            borderRadius: '6px',
                            fontSize: '11px',
                            fontFamily: 'monospace',
                            pointerEvents: 'none',
                            whiteSpace: 'nowrap',
                            zIndex: 100,
                            boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                        }}>
                            {formatTime(hoverTime)}
                        </div>
                    )}

                    {/* Visual track (thin, centered inside the hit area) */}
                    <div style={{
                        width: '100%',
                        height: isHoveringBar ? 6 : 4,
                        background: 'rgba(255,255,255,0.18)',
                        borderRadius: 3,
                        position: 'relative',
                        transition: 'height 0.15s ease',
                        overflow: 'visible',
                    }}>
                        {/* Progress fill */}
                        <div style={{
                            width: `${progressPct}%`,
                            height: '100%',
                            background: 'linear-gradient(90deg, #ef4444, #ec4899)',
                            borderRadius: 3,
                        }} />
                        {/* Thumb knob — always visible */}
                        <div style={{
                            position: 'absolute',
                            top: '50%',
                            left: `${progressPct}%`,
                            transform: 'translate(-50%, -50%)',
                            width: isHoveringBar ? 14 : 10,
                            height: isHoveringBar ? 14 : 10,
                            borderRadius: '50%',
                            background: '#fff',
                            pointerEvents: 'none',
                            boxShadow: '0 0 8px rgba(0,0,0,0.8)',
                            border: '2px solid #ef4444',
                            transition: 'width 0.15s, height 0.15s',
                        }} />
                    </div>
                </div>

                {/* Buttons row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <button onClick={() => skip(-5)} title="Back 5s" style={btnStyle}
                        onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.1)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}>
                        <SkipBack size={16} />
                    </button>

                    <button onClick={togglePlay} title={isPlaying ? 'Pause' : 'Play'} style={{
                        ...btnStyle,
                        background: 'rgba(255, 255, 255, 0.1)',
                        padding: '6px',
                        borderRadius: '50%',
                    }}
                        onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.1)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}>
                        {isPlaying
                            ? <Pause size={18} fill="white" />
                            : <Play size={18} fill="white" style={{ marginLeft: 1 }} />
                        }
                    </button>

                    <button onClick={() => skip(5)} title="Forward 5s" style={btnStyle}
                        onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.1)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}>
                        <SkipForward size={16} />
                    </button>

                    {/* Volume Control */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 8 }}>
                        <button onClick={toggleMute} title={isMuted ? 'Unmute' : 'Mute'} style={btnStyle}>
                            {isMuted ? <VolumeX size={17} /> : <Volume2 size={17} />}
                        </button>
                        <input
                            type="range"
                            min="0"
                            max="1"
                            step="0.05"
                            value={isMuted ? 0 : volume}
                            onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
                            style={{
                                width: 60,
                                accentColor: '#ef4444',
                                height: 4,
                                borderRadius: 2,
                                cursor: 'pointer',
                            }}
                        />
                    </div>

                    <span style={{ flex: 1 }} />

                    <span style={{
                        color: 'rgba(255,255,255,0.85)', fontSize: 12,
                        fontFamily: 'monospace', fontWeight: 600, whiteSpace: 'nowrap',
                    }}>
                        {formatTime(displayTime.global)} / {formatTime(displayTime.total)}
                    </span>

                    {/* Playback Speed Setting */}
                    <div style={{ position: 'relative' }}>
                        <button
                            onClick={() => setShowSpeedMenu(!showSpeedMenu)}
                            title="Playback Speed"
                            style={{
                                ...btnStyle,
                                fontSize: 11,
                                fontWeight: 700,
                                padding: '4px 8px',
                                background: 'rgba(255, 255, 255, 0.08)',
                                borderRadius: '6px',
                                gap: 4
                            }}
                        >
                            <Settings size={13} />
                            {playbackSpeed}x
                        </button>

                        {showSpeedMenu && (
                            <div style={{
                                position: 'absolute',
                                bottom: '34px',
                                right: 0,
                                background: 'rgba(15, 23, 42, 0.95)',
                                border: '1px solid rgba(255,255,255,0.15)',
                                borderRadius: '8px',
                                padding: '4px 0',
                                display: 'flex',
                                flexDirection: 'column',
                                width: 80,
                                zIndex: 100,
                                boxShadow: '0 10px 25px -5px rgba(0,0,0,0.5)',
                            }}>
                                {[0.75, 1, 1.25, 1.5, 2].map((s) => (
                                    <button
                                        key={s}
                                        onClick={() => handleSpeedChange(s)}
                                        style={{
                                            background: 'none',
                                            border: 'none',
                                            color: playbackSpeed === s ? '#ef4444' : '#fff',
                                            padding: '6px 12px',
                                            textAlign: 'left',
                                            fontSize: 11,
                                            fontWeight: 600,
                                            cursor: 'pointer',
                                            transition: 'background 0.1s',
                                        }}
                                        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.08)'; }}
                                        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                                    >
                                        {s}x
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    <button onClick={toggleFullscreen} title="Fullscreen" style={btnStyle}
                        onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.1)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}>
                        {isFullscreen ? <Minimize size={15} /> : <Maximize size={15} />}
                    </button>
                </div>
            </div>
        </div>
    );
}

/* ── Attach onended handlers to audio elements after they mount ── */
function AudioEndedHandlers({
    slides,
    audioRefs,
    onEnded,
}: {
    slides: PreviewSlide[];
    audioRefs: React.MutableRefObject<Record<string, HTMLAudioElement | null>>;
    onEnded: (slideIndex: number) => void;
}) {
    useEffect(() => {
        const cleanups: (() => void)[] = [];
        slides.forEach((slide, i) => {
            const audio = audioRefs.current[slide.slideId];
            if (!audio) return;
            const handler = () => onEnded(i);
            audio.addEventListener('ended', handler);
            cleanups.push(() => audio.removeEventListener('ended', handler));
        });
        return () => cleanups.forEach(c => c());
    }, [slides, audioRefs, onEnded]);

    return null;
}
