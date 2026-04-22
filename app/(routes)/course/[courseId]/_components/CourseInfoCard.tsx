import { Course } from '@/type/CourseType';
import { Player, PlayerRef } from '@remotion/player';
import { BookOpen, ChartNoAxesColumnIncreasing, Clock, Play, Sparkles } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { CourseComposition } from './ChapterVideo';
import { CustomPlayerControls, formatTime } from './CourseChapters';

type Props = {
    course: Course | undefined;
}

function CourseInfoCard({ course }: Props) {
    const fps = 30;
    const slides = course?.chapterContentSlides ?? [];
    const [isStarted, setIsStarted] = useState(false);
    const [hasImageError, setHasImageError] = useState(false);

    const playerRef = useRef<PlayerRef | null>(null);
    const containerRef = useRef<HTMLDivElement | null>(null);

    // Instantly compute durations from stored audioDuration (no async fetch needed)
    const durationsBySlideId = useMemo(() => {
        if (!slides || slides.length === 0) return null;
        // Only compute if at least one slide has audioDuration
        const hasAnyDuration = slides.some(s => s.audioDuration != null && s.audioDuration > 0);
        if (!hasAnyDuration) return null;

        const entries: Record<string, number> = {};
        for (const slide of slides) {
            const seconds = slide.audioDuration ?? 1; // fallback 1 second
            entries[slide.slideId] = Math.max(1, Math.ceil(seconds * fps));
        }
        return entries;
    }, [slides, fps]);

    const totalFrames = durationsBySlideId
        ? Object.values(durationsBySlideId).reduce((sum, frames) => sum + frames, 0)
        : 0;
    const totalSeconds = totalFrames / fps;

    const handlePlay = () => {
        setIsStarted(true);
        setTimeout(() => {
            playerRef.current?.play();
        }, 100);
    };

    const thumbnailUrl = course?.courseThumbnail;
    const courseName = course?.courseLayout?.courseName || 'this course';

    return (
        <div>
            <div className=' p-20 py-10 rounded-2xl grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 bg-gradient-to-br from-slate-950 via-slate-800 to-emerald-950 items-center'>
                <div>
                    <h2 className='flex gap-2 p-1 px-2 border rounded-2xl inline-flex text-white border-gray-200/70'><Sparkles />Course Preview</h2>
                    <h2 className='text-5xl font-bold mt-5 text-white'>{course?.courseLayout?.courseName}</h2>
                    <p className='text-lg text-muted-foreground mt-3'>{course?.courseLayout?.courseDescription}</p>

                    <div className='mt-5 mb-5 flex gap-5'>
                        <h2 className='px-3 p-2 border rounded-4xl flex gap-2 items-center inline-flex text-white border-gray-200/70'><ChartNoAxesColumnIncreasing className='text-sky-400' />{course?.courseLayout?.level}</h2>
                        <h2 className='px-3 p-2 border rounded-4xl flex gap-2 items-center inline-flex text-white border-gray-200/70'><BookOpen className='text-green-400' />{course?.courseLayout?.totalChapters} Chapters</h2>
                        {durationsBySlideId && (
                            <h2 className='px-3 p-2 border rounded-4xl flex gap-2 items-center inline-flex text-white border-gray-200/70'>
                                <Clock className='text-orange-400' />
                                {formatTime(totalSeconds)}
                            </h2>
                        )}
                    </div>

                </div>
                {/* Player + custom controls wrapper for fullscreen */}
                <div ref={containerRef} className='border-2 rounded-2xl border-white/10 overflow-hidden lg:col-span-2 flex flex-col relative' style={{ background: '#000', height: '380px', width: '100%' }}>
                    {!isStarted ? (
                        /* YouTube-style thumbnail overlay */
                        <div
                            style={{
                                position: 'absolute',
                                top: 0,
                                left: 0,
                                width: '100%',
                                height: '100%',
                                cursor: 'pointer',
                                overflow: 'hidden',
                                zIndex: 10
                            }}
                            onClick={handlePlay}
                        >
                            {/* Thumbnail Image or Fallback */}
                            {(thumbnailUrl && !hasImageError) ? (
                                <img
                                    src={thumbnailUrl}
                                    alt={courseName}
                                    onError={() => setHasImageError(true)}
                                    style={{
                                        width: '100%',
                                        height: '100%',
                                        objectFit: 'cover',
                                        position: 'absolute',
                                        top: 0,
                                        left: 0,
                                        zIndex: 0
                                    }}
                                />
                            ) : (
                                <div style={{
                                    width: '100%',
                                    height: '100%',
                                    position: 'absolute',
                                    top: 0,
                                    left: 0,
                                    background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0a0f1e 100%)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    zIndex: 0
                                }}>
                                    <p className='text-white/30 text-xs font-medium uppercase tracking-widest'>
                                        No Preview Available
                                    </p>
                                </div>
                            )}

                            {/* Dark gradient overlay for text readability */}
                            <div style={{
                                position: 'absolute',
                                top: 0,
                                left: 0,
                                width: '100%',
                                height: '100%',
                                background: 'linear-gradient(to bottom, rgba(0,0,0,0.3) 0%, rgba(0,0,0,0) 40%, rgba(0,0,0,0) 60%, rgba(0,0,0,0.8) 100%)',
                                zIndex: 1
                            }} />

                            {/* "Complete Course" Heading at top */}
                            <div style={{
                                position: 'absolute',
                                top: '24px',
                                left: '24px',
                                right: '24px',
                                zIndex: 2
                            }}>
                                <p style={{
                                    color: 'rgba(255,255,255,0.7)',
                                    fontSize: '12px',
                                    fontWeight: 600,
                                    textTransform: 'uppercase',
                                    letterSpacing: '2px',
                                    marginBottom: '4px'
                                }}>Full Video Guide</p>
                                <h3 style={{
                                    color: 'white',
                                    fontSize: '24px',
                                    fontWeight: 700,
                                    lineHeight: 1.3,
                                    textShadow: '0 2px 8px rgba(0,0,0,0.6)',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                }}>Complete Course on {courseName}</h3>
                            </div>

                            {/* Centered Play Button & Label */}
                            <div style={{
                                position: 'absolute',
                                top: '50%',
                                left: '50%',
                                transform: 'translate(-50%, -50%)',
                                zIndex: 3,
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                gap: '12px'
                            }}>
                                <div style={{
                                    width: '68px',
                                    height: '68px',
                                    borderRadius: '50%',
                                    background: 'rgba(255, 0, 0, 0.9)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    boxShadow: '0 8px 32px rgba(255,0,0,0.3)',
                                    transition: 'transform 0.2s, background 0.2s',
                                    cursor: 'pointer',
                                }}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.transform = 'scale(1.1)';
                                        e.currentTarget.style.background = 'rgba(255, 0, 0, 1)';
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.transform = 'scale(1)';
                                        e.currentTarget.style.background = 'rgba(255, 0, 0, 0.9)';
                                    }}
                                >
                                    <Play size={30} fill="white" color="white" style={{ marginLeft: '3px' }} />
                                </div>
                            </div>

                            {/* Duration badge at bottom-right */}
                            {durationsBySlideId && (
                                <div style={{
                                    position: 'absolute',
                                    bottom: '12px',
                                    right: '12px',
                                    zIndex: 2,
                                    background: 'rgba(0,0,0,0.8)',
                                    color: 'white',
                                    padding: '3px 8px',
                                    borderRadius: '4px',
                                    fontSize: '12px',
                                    fontWeight: 600,
                                    fontFamily: 'monospace',
                                }}>
                                    {formatTime(totalSeconds)}
                                </div>
                            )}
                        </div>
                    ) : (
                        /* Actual Player */
                        <>
                            <div style={{ flex: 1, position: 'relative', width: '100%', height: 'calc(100% - 44px)' }}>
                                <Player
                                    ref={playerRef}
                                    component={CourseComposition}
                                    durationInFrames={totalFrames || 30}
                                    compositionWidth={1280}
                                    compositionHeight={720}
                                    fps={fps}
                                    style={{
                                        width: '100%',
                                        height: '100%',
                                    }}
                                    inputProps={{
                                        slides: slides.map(slide => ({
                                            slideId: slide.slideId,
                                            html: slide.html,
                                            audioFileUrl: slide.audioUrl,
                                            revealData: slide.revealData,
                                            caption: slide.captions
                                        })),
                                        durationsBySlideId: durationsBySlideId || {}
                                    }}
                                />
                            </div>
                            <CustomPlayerControls
                                playerRef={playerRef}
                                fps={fps}
                                totalFrames={totalFrames || 30}
                                containerRef={containerRef}
                            />
                        </>
                    )}
                </div>


            </div>

        </div >
    )
}

export default CourseInfoCard