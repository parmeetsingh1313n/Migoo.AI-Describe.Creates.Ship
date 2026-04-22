import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Course } from '@/type/CourseType';
import { Player, PlayerRef } from '@remotion/player';
import { Dot, Maximize, Minimize, Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CourseComposition } from './ChapterVideo';

type Props = {
    course: Course | undefined;
}

// Format time as HH:MM:SS if >= 60 min, else MM:SS
export function formatTime(totalSeconds: number): string {
    const hrs = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = Math.floor(totalSeconds % 60);

    if (hrs > 0) {
        return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    return `${String(mins)}:${String(secs).padStart(2, '0')}`;
}

// Custom controls overlay for the Remotion Player
export function CustomPlayerControls({
    playerRef,
    fps,
    totalFrames,
    containerRef,
}: {
    playerRef: React.RefObject<PlayerRef | null>;
    fps: number;
    totalFrames: number;
    containerRef?: React.RefObject<HTMLDivElement | null>;
}) {
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentFrame, setCurrentFrame] = useState(0);
    const [isFullscreen, setIsFullscreen] = useState(false);

    useEffect(() => {
        const player = playerRef.current;
        if (!player) return;

        const onPlay = () => setIsPlaying(true);
        const onPause = () => setIsPlaying(false);
        const onFrameUpdate = (e: { detail: { frame: number } }) => {
            setCurrentFrame(e.detail.frame);
        };
        const onEnded = () => setIsPlaying(false);

        player.addEventListener('play', onPlay);
        player.addEventListener('pause', onPause);
        player.addEventListener('frameupdate', onFrameUpdate as any);
        player.addEventListener('ended', onEnded);

        return () => {
            player.removeEventListener('play', onPlay);
            player.removeEventListener('pause', onPause);
            player.removeEventListener('frameupdate', onFrameUpdate as any);
            player.removeEventListener('ended', onEnded);
        };
    }, [playerRef]);

    // Listen for fullscreen changes
    useEffect(() => {
        const handleFullscreenChange = () => {
            setIsFullscreen(!!document.fullscreenElement);
        };
        document.addEventListener('fullscreenchange', handleFullscreenChange);
        return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
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
            // Silently fail
        }
    }, [containerRef]);

    const currentTime = currentFrame / fps;
    const totalTime = totalFrames / fps;
    const progress = totalFrames > 0 ? (currentFrame / totalFrames) * 100 : 0;

    const btnStyle: React.CSSProperties = {
        background: 'none',
        border: 'none',
        color: 'white',
        cursor: 'pointer',
        padding: '2px',
        display: 'flex',
        alignItems: 'center',
    };

    return (
        <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '8px 12px',
            background: 'rgba(0,0,0,0.85)',
            borderRadius: '0 0 8px 8px',
            width: '100%',
            boxSizing: 'border-box',
            height: '44px', // Fixed height for consistency
        }}>
            {/* Skip Back 5s */}
            <button onClick={() => skip(-5)} title="Skip back 5 seconds" style={btnStyle}>
                <SkipBack size={14} />
            </button>

            {/* Play/Pause */}
            <button onClick={togglePlay} title={isPlaying ? 'Pause' : 'Play'} style={{ ...btnStyle, margin: '0 4px' }}>
                {isPlaying ? <Pause size={20} fill="white" /> : <Play size={20} fill="white" />}
            </button>

            {/* Skip Forward 5s */}
            <button onClick={() => skip(5)} title="Skip forward 5 seconds" style={btnStyle}>
                <SkipForward size={16} />
            </button>

            {/* Progress bar container */}
            <div
                style={{
                    flex: 1,
                    height: '24px', // Taller hit area
                    display: 'flex',
                    alignItems: 'center',
                    cursor: 'pointer',
                    position: 'relative',
                    margin: '0 8px'
                }}
                onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const pct = (e.clientX - rect.left) / rect.width;
                    const frame = Math.round(pct * totalFrames);
                    playerRef.current?.seekTo(Math.max(0, Math.min(totalFrames - 1, frame)));
                }}
                onMouseEnter={(e) => {
                    const bar = e.currentTarget.querySelector('.progress-bar-bg') as HTMLDivElement;
                    if (bar) bar.style.height = '6px';
                }}
                onMouseLeave={(e) => {
                    const bar = e.currentTarget.querySelector('.progress-bar-bg') as HTMLDivElement;
                    if (bar) bar.style.height = '4px';
                }}
            >
                {/* Background bar */}
                <div className="progress-bar-bg" style={{
                    width: '100%',
                    height: '4px',
                    background: 'rgba(255,255,255,0.2)',
                    borderRadius: '3px',
                    position: 'relative',
                    transition: 'height 0.1s'
                }}>
                    {/* Progress fill */}
                    <div style={{
                        width: `${progress}%`,
                        height: '100%',
                        background: '#ef4444', // YouTube red
                        borderRadius: '3px',
                        transition: 'width 0.1s',
                        position: 'relative'
                    }}>
                        {/* Thumb / Knob */}
                        <div style={{
                            position: 'absolute',
                            right: '-6px',
                            top: '50%',
                            transform: 'translateY(-50%)',
                            width: '12px',
                            height: '12px',
                            borderRadius: '50%',
                            background: '#ef4444',
                            boxShadow: '0 0 10px rgba(0,0,0,0.8)',
                            display: progress > 0 ? 'block' : 'none',
                            border: '2px solid white'
                        }} />
                    </div>
                </div>
            </div>

            {/* Time label */}
            <span style={{
                color: 'white',
                fontSize: '12px',
                fontFamily: 'monospace',
                whiteSpace: 'nowrap',
                minWidth: '70px',
                textAlign: 'center'
            }}>
                {formatTime(currentTime)} / {formatTime(totalTime)}
            </span>

            {/* Fullscreen toggle */}
            {containerRef && (
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        toggleFullscreen();
                    }}
                    title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
                    style={btnStyle}
                >
                    {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
                </button>
            )}
        </div>
    );
}

function CourseChapters({ course }: Props) {
    const fps = 30;
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [startedChapters, setStartedChapters] = useState<Record<string, boolean>>({});

    // Store refs for each chapter's player and container
    const playerRefs = useRef<Record<string, React.RefObject<PlayerRef | null>>>({});
    const containerRefs = useRef<Record<string, React.RefObject<HTMLDivElement | null>>>({});

    // Track fullscreen state globally with vendor prefix support
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

    // Instantly compute durations from stored audioDuration (no async fetch needed)
    const durationsByChapterId = useMemo(() => {
        if (!course?.chapterContentSlides || course.chapterContentSlides.length === 0) {
            return null;
        }

        // Only compute if at least one slide has audioDuration
        const hasAnyDuration = course.chapterContentSlides.some(
            s => s.audioDuration != null && s.audioDuration > 0
        );
        if (!hasAnyDuration) return null;

        const chapters = course.courseLayout?.chapters || [];
        const durationsMap: Record<string, { slidesDurations: Record<string, number>; totalFrames: number }> = {};

        for (const chapter of chapters) {
            const chapterSlides = course.chapterContentSlides.filter(
                slide => slide.chapterId === chapter.chapterId
            );

            if (chapterSlides.length > 0) {
                const slidesDurations: Record<string, number> = {};
                let totalFrames = 0;

                for (const slide of chapterSlides) {
                    const seconds = slide.audioDuration ?? 1; // fallback 1 second
                    const frames = Math.max(1, Math.ceil(seconds * fps));
                    slidesDurations[slide.slideId] = frames;
                    totalFrames += frames;
                }

                durationsMap[chapter.chapterId] = { slidesDurations, totalFrames };
            }
        }

        return durationsMap;
    }, [course?.chapterContentSlides, course?.courseLayout?.chapters, fps]);

    // Get or create refs for a chapter
    const getPlayerRef = (chapterId: string) => {
        if (!playerRefs.current[chapterId]) {
            playerRefs.current[chapterId] = { current: null };
        }
        return playerRefs.current[chapterId];
    };
    const getContainerRef = (chapterId: string) => {
        if (!containerRefs.current[chapterId]) {
            containerRefs.current[chapterId] = { current: null };
        }
        return containerRefs.current[chapterId];
    };

    const handleChapterPlay = (chapterId: string) => {
        setStartedChapters(prev => ({ ...prev, [chapterId]: true }));
        setTimeout(() => {
            const pRef = playerRefs.current[chapterId];
            if (pRef?.current) {
                pRef.current.play();
            }
        }, 100);
    };

    return (
        <div className='max-w-6xl -mt-5 p-10 border rounded-3xl shadow-lg w-full bg-background/80 backdrop-blur-xl'>
            <div className='flex justify-between items-center'>
                <h2 className='font-bold text-2xl mb-2'>Course preview</h2>
                <h2 className='text-sm text-muted-foreground'>Chapters and Short Preview</h2>
            </div>
            <div className='mt-5'>
                {course?.courseLayout?.chapters?.map((chapter, index) => {
                    const chapterSlides = course.chapterContentSlides?.filter(
                        slide => slide.chapterId === chapter.chapterId
                    ) || [];
                    const chapterDurations = durationsByChapterId?.[chapter.chapterId];
                    const pRef = getPlayerRef(chapter.chapterId);
                    const cRef = getContainerRef(chapter.chapterId);
                    const totalFrames = chapterDurations?.totalFrames || 30;
                    const chapterStarted = startedChapters[chapter.chapterId] || false;
                    const chapterSeconds = totalFrames / fps;

                    return (
                        <Card key={index} className='mb-5'>
                            <CardHeader>
                                <div className='flex items-center gap-3'>
                                    <h2 className='p-2 bg-primary/40 inline-flex h-10 w-10 text-center rounded-2xl justify-center items-center'>{index + 1}</h2>
                                    <CardTitle className='md:text-xl text-base'>
                                        {chapter.chapterTitle}
                                    </CardTitle>
                                </div>
                            </CardHeader>

                            <CardContent>
                                <div className='grid grid-cols-2 gap-5'>
                                    <div>
                                        {chapter.subContent.map((content, idx) => (
                                            <div key={idx} className='flex gap-2 items-center mt-2'>
                                                <Dot className='h-5 w-5 text-primary' />
                                                <h2>{content}</h2>
                                            </div>
                                        ))}
                                    </div>
                                    {/* Player + controls wrapper for fullscreen */}
                                    <div ref={cRef} style={{
                                        background: '#000',
                                        borderRadius: '8px',
                                        overflow: 'hidden',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        position: 'relative',
                                        ...(isFullscreen ? { height: '100%', width: '100%' } : { height: '214px' }),
                                    }}>
                                        {!chapterStarted ? (
                                            /* YouTube-style black placeholder overlay */
                                            <div
                                                style={{
                                                    position: 'absolute',
                                                    top: 0,
                                                    left: 0,
                                                    width: '100%',
                                                    height: '100%',
                                                    cursor: 'pointer',
                                                    overflow: 'hidden',
                                                    zIndex: 10,
                                                    background: '#000',
                                                    display: 'flex',
                                                    flexDirection: 'column',
                                                }}
                                                onClick={() => handleChapterPlay(chapter.chapterId)}
                                            >
                                                {/* Chapter title at top */}
                                                <div style={{
                                                    position: 'absolute',
                                                    top: '12px',
                                                    left: '12px',
                                                    right: '12px',
                                                    zIndex: 2,
                                                }}>
                                                    <p style={{
                                                        color: 'rgba(255,255,255,0.6)',
                                                        fontSize: '10px',
                                                        fontWeight: 600,
                                                        textTransform: 'uppercase',
                                                        letterSpacing: '1px',
                                                        marginBottom: '2px',
                                                    }}>Chapter {index + 1}</p>
                                                    <h3 style={{
                                                        color: 'white',
                                                        fontSize: '13px',
                                                        fontWeight: 700,
                                                        lineHeight: 1.3,
                                                        textShadow: '0 1px 6px rgba(0,0,0,0.6)',
                                                        overflow: 'hidden',
                                                        textOverflow: 'ellipsis',
                                                        whiteSpace: 'nowrap',
                                                    }}>{chapter.chapterTitle}</h3>
                                                </div>

                                                {/* Centered Play Button */}
                                                <div style={{
                                                    position: 'absolute',
                                                    top: '50%',
                                                    left: '50%',
                                                    transform: 'translate(-50%, -50%)',
                                                    zIndex: 2,
                                                    width: '48px',
                                                    height: '48px',
                                                    borderRadius: '50%',
                                                    background: 'rgba(255, 0, 0, 0.9)',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    boxShadow: '0 4px 16px rgba(255,0,0,0.3)',
                                                    transition: 'transform 0.2s, background 0.2s',
                                                }}
                                                    onMouseEnter={(e) => {
                                                        e.currentTarget.style.transform = 'translate(-50%, -50%) scale(1.1)';
                                                        e.currentTarget.style.background = 'rgba(255, 0, 0, 1)';
                                                    }}
                                                    onMouseLeave={(e) => {
                                                        e.currentTarget.style.transform = 'translate(-50%, -50%) scale(1)';
                                                        e.currentTarget.style.background = 'rgba(255, 0, 0, 0.9)';
                                                    }}
                                                >
                                                    <Play size={22} fill="white" color="white" style={{ marginLeft: '2px' }} />
                                                </div>

                                                {/* Duration badge at bottom-right */}
                                                {chapterDurations && (
                                                    <div style={{
                                                        position: 'absolute',
                                                        bottom: '8px',
                                                        right: '8px',
                                                        zIndex: 2,
                                                        background: 'rgba(0,0,0,0.8)',
                                                        color: 'white',
                                                        padding: '2px 6px',
                                                        borderRadius: '3px',
                                                        fontSize: '11px',
                                                        fontWeight: 600,
                                                        fontFamily: 'monospace',
                                                    }}>
                                                        {formatTime(chapterSeconds)}
                                                    </div>
                                                )}
                                            </div>
                                        ) : (
                                            /* Actual Player */
                                            <>
                                                <Player
                                                    ref={pRef}
                                                    component={CourseComposition}
                                                    durationInFrames={totalFrames}
                                                    compositionWidth={1280}
                                                    compositionHeight={720}
                                                    fps={fps}
                                                    style={{
                                                        width: '100%',
                                                        borderRadius: isFullscreen ? '0' : '8px 8px 0 0',
                                                        flex: 1,
                                                        minHeight: 0,
                                                    }}
                                                    inputProps={{
                                                        slides: chapterSlides.map(slide => ({
                                                            slideId: slide.slideId,
                                                            html: slide.html,
                                                            audioFileUrl: slide.audioUrl,
                                                            revealData: slide.revealData,
                                                            caption: slide.captions
                                                        })),
                                                        durationsBySlideId: chapterDurations?.slidesDurations || {}
                                                    }}
                                                />
                                                <CustomPlayerControls
                                                    playerRef={pRef}
                                                    fps={fps}
                                                    totalFrames={totalFrames}
                                                    containerRef={cRef}
                                                />
                                            </>
                                        )}
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    );
                })}
            </div>
        </div >
    )
}

export default CourseChapters