"use client"

/**
 * ChapteredVideoPlayer — custom video player for the completed motion-graphic
 * render, with YouTube-style scene/chapter markers on the progress bar.
 *
 * Chapter boundaries are computed as pure fractions of total scene durationSec
 * (not replicated frame math) and scaled against the native <video>'s real
 * `duration` once loaded — this keeps markers correct regardless of any
 * frame-rounding in the Remotion render, since fractions are scale-invariant.
 *
 * Visual/interaction design (progress bar hit-area, thumb knob, hover tooltip,
 * fullscreen handling) ported from CustomPlayerControls.tsx / ChapterPreviewPlayer.tsx
 * (course chapter players), adapted from Remotion PlayerRef events to native
 * <video> events, with touch support added for mobile.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Play, Pause, SkipBack, SkipForward, Volume2, VolumeX, Maximize, Minimize } from 'lucide-react'

function formatTime(totalSeconds: number): string {
    if (isNaN(totalSeconds) || !isFinite(totalSeconds)) return '0:00'
    const hrs = Math.floor(totalSeconds / 3600)
    const mins = Math.floor((totalSeconds % 3600) / 60)
    const secs = Math.floor(totalSeconds % 60)
    if (hrs > 0) return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    return `${String(mins)}:${String(secs).padStart(2, '0')}`
}

interface Chapter {
    index: number
    startFrac: number
    endFrac: number
    label: string
}

interface ChapteredVideoPlayerProps {
    src: string
    scenes: any[]
    aspectRatio: string
}

export default function ChapteredVideoPlayer({ src, scenes, aspectRatio }: ChapteredVideoPlayerProps) {
    const videoRef = useRef<HTMLVideoElement>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const progressBarRef = useRef<HTMLDivElement>(null)
    const isDraggingRef = useRef(false)

    const [isPlaying, setIsPlaying] = useState(false)
    const [currentTime, setCurrentTime] = useState(0)
    const [duration, setDuration] = useState(0)
    const [volume, setVolume] = useState(1)
    const [isMuted, setIsMuted] = useState(false)
    const [isFullscreen, setIsFullscreen] = useState(false)
    const [isHoveringVolume, setIsHoveringVolume] = useState(false)
    const [isHoveringBar, setIsHoveringBar] = useState(false)
    const [hoverTime, setHoverTime] = useState<number | null>(null)
    const [hoverX, setHoverX] = useState(0)
    const [hoverLabel, setHoverLabel] = useState<string | null>(null)

    // ── Chapter boundaries — pure proportions of scene durationSec, scale-invariant ──
    const chapters = useMemo<Chapter[]>(() => {
        if (!scenes?.length) return []
        const totalDurationSec = scenes.reduce((s, sc) => s + (Number(sc?.durationSec) || 5), 0) || 1
        let cum = 0
        return scenes.map((sc, i) => {
            const dur = Number(sc?.durationSec) || 5
            const startFrac = cum / totalDurationSec
            cum += dur
            const label =
                sc?.headline || sc?.title || sc?.content || sc?.text ||
                (sc?.type ? String(sc.type).replace(/_/g, ' ') : `Scene ${i + 1}`)
            return { index: i, startFrac, endFrac: cum / totalDurationSec, label }
        })
    }, [scenes])

    const chapterAtFraction = useCallback((fraction: number): Chapter | null => {
        if (!chapters.length) return null
        return chapters.find(c => fraction >= c.startFrac && fraction < c.endFrac) || chapters[chapters.length - 1]
    }, [chapters])

    // ── Native <video> event wiring ──────────────────────────────────────────
    useEffect(() => {
        const video = videoRef.current
        if (!video) return
        const onLoadedMetadata = () => setDuration(video.duration || 0)
        const onTimeUpdate = () => setCurrentTime(video.currentTime || 0)
        const onPlay = () => setIsPlaying(true)
        const onPause = () => setIsPlaying(false)
        const onEnded = () => setIsPlaying(false)
        const onVolumeChange = () => { setVolume(video.volume); setIsMuted(video.muted) }

        video.addEventListener('loadedmetadata', onLoadedMetadata)
        video.addEventListener('timeupdate', onTimeUpdate)
        video.addEventListener('play', onPlay)
        video.addEventListener('pause', onPause)
        video.addEventListener('ended', onEnded)
        video.addEventListener('volumechange', onVolumeChange)
        if (video.duration) setDuration(video.duration)

        return () => {
            video.removeEventListener('loadedmetadata', onLoadedMetadata)
            video.removeEventListener('timeupdate', onTimeUpdate)
            video.removeEventListener('play', onPlay)
            video.removeEventListener('pause', onPause)
            video.removeEventListener('ended', onEnded)
            video.removeEventListener('volumechange', onVolumeChange)
        }
    }, [src])

    // Fullscreen listeners (cross-browser)
    useEffect(() => {
        const getFullscreenElement = () =>
            document.fullscreenElement || (document as any).webkitFullscreenElement ||
            (document as any).mozFullScreenElement || (document as any).msFullscreenElement
        const handler = () => setIsFullscreen(!!getFullscreenElement())
        document.addEventListener('fullscreenchange', handler)
        document.addEventListener('webkitfullscreenchange', handler)
        document.addEventListener('mozfullscreenchange', handler)
        document.addEventListener('MSFullscreenChange', handler)
        return () => {
            document.removeEventListener('fullscreenchange', handler)
            document.removeEventListener('webkitfullscreenchange', handler)
            document.removeEventListener('mozfullscreenchange', handler)
            document.removeEventListener('MSFullscreenChange', handler)
        }
    }, [])

    const togglePlay = useCallback(() => {
        const video = videoRef.current
        if (!video) return
        if (video.paused) video.play().catch(() => {}); else video.pause()
    }, [])

    const skip = useCallback((seconds: number) => {
        const video = videoRef.current
        if (!video || !video.duration) return
        video.currentTime = Math.max(0, Math.min(video.duration, video.currentTime + seconds))
    }, [])

    const handleVolumeChange = useCallback((val: number) => {
        const video = videoRef.current
        if (!video) return
        video.volume = val
        video.muted = val === 0
    }, [])

    const toggleMute = useCallback(() => {
        const video = videoRef.current
        if (!video) return
        video.muted = !video.muted
    }, [])

    const toggleFullscreen = useCallback(() => {
        const el = containerRef.current
        if (!el) return
        try {
            const fsEl = document.fullscreenElement || (document as any).webkitFullscreenElement ||
                (document as any).mozFullScreenElement || (document as any).msFullscreenElement
            if (fsEl) {
                const exit = document.exitFullscreen || (document as any).webkitExitFullscreen ||
                    (document as any).mozCancelFullScreen || (document as any).msExitFullscreen
                exit?.call(document).catch(() => {})
            } else {
                const request = el.requestFullscreen || (el as any).webkitRequestFullscreen ||
                    (el as any).mozRequestFullScreen || (el as any).msRequestFullscreen
                request?.call(el).catch(() => {})
            }
        } catch { /* fullscreen not supported — no-op */ }
    }, [])

    // ── Progress bar: click/drag (mouse + touch) to seek ─────────────────────
    const fractionFromClientX = useCallback((clientX: number) => {
        const rect = progressBarRef.current?.getBoundingClientRect()
        if (!rect || rect.width === 0) return 0
        return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    }, [])

    const seekFromFraction = useCallback((fraction: number) => {
        const video = videoRef.current
        if (!video || !video.duration) return
        video.currentTime = Math.max(0, Math.min(video.duration, fraction * video.duration))
    }, [])

    const handleProgressMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        e.preventDefault()
        isDraggingRef.current = true
        document.body.style.userSelect = 'none'
        document.body.style.cursor = 'grabbing'
        seekFromFraction(fractionFromClientX(e.clientX))

        const onMove = (ev: MouseEvent) => { if (isDraggingRef.current) seekFromFraction(fractionFromClientX(ev.clientX)) }
        const onUp = () => {
            isDraggingRef.current = false
            document.body.style.userSelect = ''
            document.body.style.cursor = ''
            window.removeEventListener('mousemove', onMove)
            window.removeEventListener('mouseup', onUp)
        }
        window.addEventListener('mousemove', onMove)
        window.addEventListener('mouseup', onUp)
    }, [seekFromFraction, fractionFromClientX])

    const handleProgressMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        const rect = progressBarRef.current?.getBoundingClientRect()
        if (!rect || rect.width === 0) return
        const fraction = fractionFromClientX(e.clientX)
        setHoverTime(fraction * duration)
        setHoverX(e.clientX - rect.left)
        setHoverLabel(chapterAtFraction(fraction)?.label ?? null)
    }, [duration, fractionFromClientX, chapterAtFraction])

    const handleProgressMouseLeave = useCallback(() => {
        setHoverTime(null)
        setHoverLabel(null)
        setIsHoveringBar(false)
    }, [])

    const handleProgressTouchStart = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
        isDraggingRef.current = true
        const touch = e.touches[0]
        if (touch) seekFromFraction(fractionFromClientX(touch.clientX))

        const onMove = (ev: TouchEvent) => {
            if (!isDraggingRef.current) return
            const t = ev.touches[0]
            if (t) seekFromFraction(fractionFromClientX(t.clientX))
        }
        const onEnd = () => {
            isDraggingRef.current = false
            window.removeEventListener('touchmove', onMove)
            window.removeEventListener('touchend', onEnd)
        }
        window.addEventListener('touchmove', onMove, { passive: true })
        window.addEventListener('touchend', onEnd)
    }, [seekFromFraction, fractionFromClientX])

    // Space/arrow keyboard shortcuts scoped to when this player is focused
    const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
        if (e.code === 'Space') { e.preventDefault(); togglePlay() }
        else if (e.code === 'ArrowLeft') { e.preventDefault(); skip(-5) }
        else if (e.code === 'ArrowRight') { e.preventDefault(); skip(5) }
    }, [togglePlay, skip])

    const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0
    const btnStyle: React.CSSProperties = {
        background: 'none', border: 'none', color: 'white', cursor: 'pointer',
        padding: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center',
        borderRadius: '50%', transition: 'background 0.15s, transform 0.1s',
    }

    return (
        <div
            ref={containerRef}
            tabIndex={0}
            onKeyDown={handleKeyDown}
            className="rounded-2xl overflow-hidden bg-black border border-border shadow-xl mb-4 outline-none"
            style={{
                aspectRatio: isFullscreen ? undefined : (aspectRatio === '9:16' ? '9/16' : aspectRatio === '1:1' ? '1/1' : '16/9'),
                maxHeight: isFullscreen ? '100vh' : '500px',
                height: isFullscreen ? '100vh' : undefined,
                display: 'flex',
                flexDirection: 'column',
            }}
        >
            <div className="relative flex-1 min-h-0" onClick={togglePlay}>
                <video
                    ref={videoRef}
                    src={src}
                    autoPlay
                    loop
                    className="w-full h-full object-contain"
                />
            </div>

            {/* Custom controls bar */}
            <div style={{
                display: 'flex', flexDirection: 'column', gap: 6,
                padding: '12px 16px',
                background: 'linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.92) 100%)',
                backdropFilter: 'blur(12px)',
                borderTop: '1px solid rgba(255,255,255,0.08)',
                flexShrink: 0,
                zIndex: 20,
            }}>
                {/* Draggable progress bar with chapter dividers */}
                <div
                    ref={progressBarRef}
                    onMouseDown={handleProgressMouseDown}
                    onMouseMove={handleProgressMouseMove}
                    onMouseLeave={handleProgressMouseLeave}
                    onMouseEnter={() => setIsHoveringBar(true)}
                    onTouchStart={handleProgressTouchStart}
                    style={{ width: '100%', height: 20, cursor: 'pointer', position: 'relative', userSelect: 'none', display: 'flex', alignItems: 'center' }}
                >
                    {hoverTime !== null && (
                        <div style={{
                            position: 'absolute', bottom: '24px', left: `${hoverX}px`, transform: 'translateX(-50%)',
                            background: 'rgba(15, 23, 42, 0.95)', border: '1px solid rgba(255,255,255,0.15)', color: 'white',
                            padding: '4px 10px', borderRadius: '6px', fontSize: '11px', fontFamily: 'monospace',
                            pointerEvents: 'none', whiteSpace: 'nowrap', zIndex: 100, boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                        }}>
                            {hoverLabel && (
                                <span style={{ fontFamily: 'inherit', fontWeight: 700, textTransform: 'capitalize', letterSpacing: 0.2 }}>
                                    {hoverLabel}
                                </span>
                            )}
                            <span>{formatTime(hoverTime)}</span>
                        </div>
                    )}

                    <div style={{ width: '100%', height: isHoveringBar ? 6 : 4, background: 'rgba(255,255,255,0.18)', borderRadius: 3, position: 'relative', transition: 'height 0.15s ease', overflow: 'visible' }}>
                        {/* Chapter divider ticks */}
                        {chapters.slice(1).map((c) => (
                            <div key={c.index} style={{
                                position: 'absolute', left: `${c.startFrac * 100}%`, top: 0, bottom: 0,
                                width: 2, background: 'rgba(0,0,0,0.5)', transform: 'translateX(-1px)', zIndex: 2,
                            }} />
                        ))}
                        {/* Progress fill */}
                        <div style={{ width: `${progressPct}%`, height: '100%', background: 'linear-gradient(90deg, #6366f1, #a855f7)', borderRadius: 3 }} />
                        {/* Thumb knob */}
                        <div style={{
                            position: 'absolute', top: '50%', left: `${progressPct}%`, transform: 'translate(-50%, -50%)',
                            width: isHoveringBar ? 14 : 10, height: isHoveringBar ? 14 : 10, borderRadius: '50%', background: '#fff',
                            pointerEvents: 'none', boxShadow: '0 0 8px rgba(0,0,0,0.8)', border: '2px solid #a855f7',
                            transition: 'width 0.15s, height 0.15s',
                        }} />
                    </div>
                </div>

                {/* Buttons row */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <button onClick={() => skip(-5)} title="Back 5s" style={btnStyle}>
                            <SkipBack size={16} fill="white" />
                        </button>
                        <button onClick={togglePlay} title={isPlaying ? 'Pause' : 'Play'} style={{ ...btnStyle, background: 'rgba(255,255,255,0.1)' }}>
                            {isPlaying ? <Pause size={18} fill="white" /> : <Play size={18} fill="white" style={{ marginLeft: 1 }} />}
                        </button>
                        <button onClick={() => skip(5)} title="Forward 5s" style={btnStyle}>
                            <SkipForward size={16} fill="white" />
                        </button>

                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 8 }}
                             onMouseEnter={() => setIsHoveringVolume(true)}
                             onMouseLeave={() => setIsHoveringVolume(false)}
                        >
                            <button onClick={toggleMute} title={isMuted ? 'Unmute' : 'Mute'} style={btnStyle}>
                                {isMuted ? <VolumeX size={17} /> : <Volume2 size={17} />}
                            </button>
                            <input
                                type="range" min="0" max="1" step="0.05"
                                value={isMuted ? 0 : volume}
                                onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
                                style={{
                                    width: isHoveringVolume ? 60 : 0, opacity: isHoveringVolume ? 1 : 0,
                                    pointerEvents: isHoveringVolume ? 'auto' : 'none', height: 4, accentColor: '#a855f7',
                                    transition: 'width 0.2s ease, opacity 0.2s ease', cursor: 'pointer', outline: 'none',
                                    background: 'rgba(255,255,255,0.3)', borderRadius: 2,
                                }}
                            />
                        </div>

                        <span style={{ color: 'rgba(255,255,255,0.85)', fontSize: '13px', fontFamily: 'monospace', marginLeft: 12, userSelect: 'none' }}>
                            {formatTime(currentTime)} <span style={{ color: 'rgba(255,255,255,0.3)' }}>/</span> {formatTime(duration)}
                        </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <button onClick={toggleFullscreen} title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'} style={btnStyle}>
                            {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}
