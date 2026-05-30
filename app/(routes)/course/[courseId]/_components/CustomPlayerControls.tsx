"use client";
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { PlayerRef } from '@remotion/player';
import { 
    Play, 
    Pause, 
    SkipBack, 
    SkipForward, 
    Volume2, 
    VolumeX, 
    Maximize, 
    Minimize, 
    Settings 
} from 'lucide-react';

// Shared module-level tracker to store the ID of the active player controls instance
let globalActiveInstanceId: string | null = null;

// Format time as HH:MM:SS if >= 60 min, else MM:SS
export function formatTime(totalSeconds: number): string {
    if (isNaN(totalSeconds) || !isFinite(totalSeconds)) return '0:00';
    const hrs = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = Math.floor(totalSeconds % 60);

    if (hrs > 0) {
        return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    return `${String(mins)}:${String(secs).padStart(2, '0')}`;
}

interface CustomPlayerControlsProps {
    playerRef: React.RefObject<PlayerRef | null>;
    fps: number;
    totalFrames: number;
    containerRef?: React.RefObject<HTMLDivElement | null>;
    playbackSpeed: number;
    setPlaybackSpeed: (speed: number) => void;
}

export function CustomPlayerControls({
    playerRef,
    fps,
    totalFrames,
    containerRef,
    playbackSpeed,
    setPlaybackSpeed,
}: CustomPlayerControlsProps) {
    const instanceId = useRef(Math.random().toString());
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentFrame, setCurrentFrame] = useState(0);
    const [isFullscreen, setIsFullscreen] = useState(false);
    
    // Premium control states
    const [volume, setVolume] = useState(1);
    const [isMuted, setIsMuted] = useState(false);
    const [showSpeedMenu, setShowSpeedMenu] = useState(false);
    
    // Progress bar interactions
    const [hoverTime, setHoverTime] = useState<number | null>(null);
    const [hoverX, setHoverX] = useState(0);
    const [isHoveringBar, setIsHoveringBar] = useState(false);
    const [isHoveringVolume, setIsHoveringVolume] = useState(false);
    
    const progressBarRef = useRef<HTMLDivElement>(null);
    const isDraggingRef = useRef(false);

    // Register active instance on mount
    useEffect(() => {
        if (!globalActiveInstanceId) {
            globalActiveInstanceId = instanceId.current;
        }
        return () => {
            if (globalActiveInstanceId === instanceId.current) {
                globalActiveInstanceId = null;
            }
        };
    }, []);

    // Set as active when player starts playing
    useEffect(() => {
        if (isPlaying) {
            globalActiveInstanceId = instanceId.current;
        }
    }, [isPlaying]);

    // Set as active when user hovers over the player area
    useEffect(() => {
        const el = containerRef?.current;
        if (!el) return;

        const handleMouseEnter = () => {
            globalActiveInstanceId = instanceId.current;
        };

        el.addEventListener('mouseenter', handleMouseEnter);
        return () => {
            el.removeEventListener('mouseenter', handleMouseEnter);
        };
    }, [containerRef]);

    // Sync state with Remotion Player events
    useEffect(() => {
        const player = playerRef.current;
        if (!player) return;

        const onPlay = () => setIsPlaying(true);
        const onPause = () => setIsPlaying(false);
        const onFrameUpdate = (e: any) => {
            setCurrentFrame(e.detail.frame);
        };
        const onEnded = () => setIsPlaying(false);

        player.addEventListener('play', onPlay);
        player.addEventListener('pause', onPause);
        player.addEventListener('frameupdate', onFrameUpdate);
        player.addEventListener('ended', onEnded);

        // Initial state sync
        setIsPlaying(player.isPlaying());
        setCurrentFrame(player.getCurrentFrame());

        return () => {
            player.removeEventListener('play', onPlay);
            player.removeEventListener('pause', onPause);
            player.removeEventListener('frameupdate', onFrameUpdate);
            player.removeEventListener('ended', onEnded);
        };
    }, [playerRef]);

    // Fullscreen listeners (supports standard & vendor-prefixed browser API)
    useEffect(() => {
        const getFullscreenElement = () => {
            return document.fullscreenElement ||
                (document as any).webkitFullscreenElement ||
                (document as any).mozFullScreenElement ||
                (document as any).msFullscreenElement;
        };

        const handler = () => setIsFullscreen(!!getFullscreenElement());

        document.addEventListener('fullscreenchange', handler);
        document.addEventListener('webkitfullscreenchange', handler);
        document.addEventListener('mozfullscreenchange', handler);
        document.addEventListener('MSFullscreenChange', handler);

        return () => {
            document.removeEventListener('fullscreenchange', handler);
            document.removeEventListener('webkitfullscreenchange', handler);
            document.removeEventListener('mozfullscreenchange', handler);
            document.removeEventListener('MSFullscreenChange', handler);
        };
    }, []);

    const togglePlay = useCallback(() => {
        const player = playerRef.current;
        if (!player) return;
        if (isPlaying) {
            player.pause();
        } else {
            player.play();
        }
    }, [playerRef, isPlaying]);

    const skip = useCallback((seconds: number) => {
        const player = playerRef.current;
        if (!player) return;
        const framesToSkip = Math.round(seconds * fps);
        const newFrame = Math.max(0, Math.min(totalFrames - 1, currentFrame + framesToSkip));
        player.seekTo(newFrame);
    }, [playerRef, fps, totalFrames, currentFrame]);

    const handleVolumeChange = useCallback((val: number) => {
        const player = playerRef.current;
        if (!player) return;
        setVolume(val);
        setIsMuted(val === 0);
        player.setVolume(val);
    }, [playerRef]);

    const toggleMute = useCallback(() => {
        const player = playerRef.current;
        if (!player) return;
        const newMuted = !isMuted;
        setIsMuted(newMuted);
        player.setVolume(newMuted ? 0 : volume);
    }, [playerRef, isMuted, volume]);

    const handleSpeedChange = useCallback((speed: number) => {
        setPlaybackSpeed(speed);
        setShowSpeedMenu(false);
    }, [setPlaybackSpeed]);

    const toggleFullscreen = useCallback(() => {
        const el = containerRef?.current;
        if (!el) return;

        try {
            if (document.fullscreenElement || (document as any).webkitFullscreenElement || (document as any).mozFullScreenElement || (document as any).msFullscreenElement) {
                const exitMethod = document.exitFullscreen || (document as any).webkitExitFullscreen || (document as any).mozCancelFullScreen || (document as any).msExitFullscreen;
                if (exitMethod) {
                    exitMethod.call(document).catch(() => { });
                }
            } else {
                const requestMethod = el.requestFullscreen || (el as any).webkitRequestFullscreen || (el as any).mozRequestFullScreen || (el as any).msRequestFullscreen;
                if (requestMethod) {
                    requestMethod.call(el).catch(() => {
                        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    });
                }
            }
        } catch (error) {
            console.error('Fullscreen request failed:', error);
        }
    }, [containerRef]);

    // Keyboard Shortcuts (Space to play/pause, Left/Right arrow to skip 5s)
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Only trigger shortcut for the active/focused video player
            if (globalActiveInstanceId !== instanceId.current) return;

            // Only trigger if focus is not in input/textarea
            const tag = document.activeElement?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

            if (e.code === 'Space') {
                e.preventDefault();
                togglePlay();
            } else if (e.code === 'ArrowLeft') {
                e.preventDefault();
                skip(-5);
            } else if (e.code === 'ArrowRight') {
                e.preventDefault();
                skip(5);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [togglePlay, skip]);

    // Time calculations
    const currentTime = currentFrame / fps;
    const totalTime = totalFrames / fps;
    const progressPct = totalFrames > 0 ? (currentFrame / totalFrames) * 100 : 0;

    // Progress bar Click & Drag logic
    const fractionFromEvent = useCallback((e: MouseEvent | React.MouseEvent) => {
        const rect = progressBarRef.current?.getBoundingClientRect();
        if (!rect || rect.width === 0) return 0;
        return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    }, []);

    const seekFromFraction = useCallback((fraction: number) => {
        const clamped = Math.max(0, Math.min(1, fraction));
        const targetFrame = Math.round(clamped * totalFrames);
        playerRef.current?.seekTo(Math.max(0, Math.min(totalFrames - 1, targetFrame)));
    }, [totalFrames, playerRef]);

    const handleProgressMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        e.preventDefault();
        isDraggingRef.current = true;

        // Prevent global selection & cursor issues during dragging
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'grabbing';

        seekFromFraction(fractionFromEvent(e));

        const onMove = (ev: MouseEvent) => {
            if (isDraggingRef.current) seekFromFraction(fractionFromEvent(ev));
        };
        const onUp = () => {
            isDraggingRef.current = false;
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
        setHoverTime(fraction * totalTime);
        setHoverX(e.clientX - rect.left);
    };

    const handleProgressMouseLeave = () => {
        setHoverTime(null);
        setIsHoveringBar(false);
    };

    const btnStyle: React.CSSProperties = {
        background: 'none', border: 'none', color: 'white', cursor: 'pointer',
        padding: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center',
        borderRadius: '50%', transition: 'background 0.15s, transform 0.1s',
    };

    return (
        <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            padding: '12px 16px',
            background: 'linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.92) 100%)',
            backdropFilter: 'blur(12px)',
            borderTop: '1px solid rgba(255,255,255,0.08)',
            borderRadius: isFullscreen ? 0 : '0 0 16px 16px',
            flexShrink: 0,
            zIndex: 20,
            width: '100%',
            boxSizing: 'border-box',
        }}>
            {/* Draggable Progress Bar (Hit area 20px, visual track 4px/6px) */}
            <div
                ref={progressBarRef}
                onMouseDown={handleProgressMouseDown}
                onMouseMove={handleProgressMouseMove}
                onMouseLeave={handleProgressMouseLeave}
                onMouseEnter={() => setIsHoveringBar(true)}
                style={{
                    width: '100%',
                    height: 20,
                    cursor: 'pointer',
                    position: 'relative',
                    userSelect: 'none',
                    display: 'flex',
                    alignItems: 'center',
                }}
            >
                {/* Precise Hover Timestamp Tooltip */}
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

                {/* Visual track */}
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
                    {/* Thumb knob */}
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

            {/* Buttons Row */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    {/* Skip Back */}
                    <button onClick={() => skip(-5)} title="Back 5s" style={btnStyle}
                        onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.1)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}>
                        <SkipBack size={16} fill="white" />
                    </button>

                    {/* Play/Pause */}
                    <button onClick={togglePlay} title={isPlaying ? 'Pause' : 'Play'} style={{
                        ...btnStyle,
                        background: 'rgba(255, 255, 255, 0.1)',
                    }}
                        onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.1)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}>
                        {isPlaying ? <Pause size={18} fill="white" /> : <Play size={18} fill="white" style={{ marginLeft: 1 }} />}
                    </button>

                    {/* Skip Forward */}
                    <button onClick={() => skip(5)} title="Forward 5s" style={btnStyle}
                        onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.1)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}>
                        <SkipForward size={16} fill="white" />
                    </button>

                    {/* Volume Controls */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 8 }}
                         onMouseEnter={() => setIsHoveringVolume(true)}
                         onMouseLeave={() => setIsHoveringVolume(false)}
                    >
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
                            className="vol-slider"
                            style={{
                                width: isHoveringVolume ? 60 : 0,
                                opacity: isHoveringVolume ? 1 : 0,
                                pointerEvents: isHoveringVolume ? 'auto' : 'none',
                                height: 4,
                                accentColor: '#ef4444',
                                transition: 'width 0.2s ease, opacity 0.2s ease',
                                cursor: 'pointer',
                                outline: 'none',
                                background: 'rgba(255,255,255,0.3)',
                                borderRadius: 2,
                            }}
                        />
                    </div>

                    {/* Time Counter */}
                    <span style={{
                        color: 'rgba(255,255,255,0.85)',
                        fontSize: '13px',
                        fontFamily: 'monospace',
                        marginLeft: 12,
                        userSelect: 'none',
                    }}>
                        {formatTime(currentTime)} <span style={{ color: 'rgba(255,255,255,0.3)' }}>/</span> {formatTime(totalTime)}
                    </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginLeft: 'auto', position: 'relative' }}>
                    {/* Playback Speed Setting Menu */}
                    <button 
                        onClick={() => setShowSpeedMenu(!showSpeedMenu)} 
                        title="Speed" 
                        style={{ ...btnStyle, color: showSpeedMenu ? '#ef4444' : 'white' }}
                    >
                        <Settings size={18} />
                    </button>

                    {showSpeedMenu && (
                        <div style={{
                            position: 'absolute',
                            bottom: '100%',
                            right: 0,
                            marginBottom: '10px',
                            background: 'rgba(15, 23, 42, 0.95)',
                            backdropFilter: 'blur(10px)',
                            border: '1px solid rgba(255,255,255,0.15)',
                            borderRadius: '8px',
                            padding: '6px 0',
                            display: 'flex',
                            flexDirection: 'column',
                            minWidth: '85px',
                            zIndex: 100,
                            boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5)',
                        }}>
                            {[0.5, 1, 1.5, 1.75, 2].map((s) => (
                                <button
                                    key={s}
                                    onClick={() => handleSpeedChange(s)}
                                    style={{
                                        background: playbackSpeed === s ? 'rgba(239, 68, 68, 0.15)' : 'transparent',
                                        border: 'none',
                                        color: playbackSpeed === s ? '#ef4444' : 'white',
                                        padding: '6px 12px',
                                        fontSize: '12px',
                                        textAlign: 'left',
                                        cursor: 'pointer',
                                        fontWeight: playbackSpeed === s ? 700 : 400,
                                        transition: 'background 0.15s',
                                    }}
                                    onMouseEnter={(e) => { if (playbackSpeed !== s) e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
                                    onMouseLeave={(e) => { if (playbackSpeed !== s) e.currentTarget.style.background = 'transparent'; }}
                                >
                                    {s === 1 ? 'Normal' : `${s}x`}
                                </button>
                            ))}
                        </div>
                    )}

                    {/* Fullscreen Toggle */}
                    {containerRef && (
                        <button onClick={toggleFullscreen} title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'} style={btnStyle}
                            onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.1)'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}>
                            {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
