import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Course } from '@/type/CourseType';
import { AlertTriangle, CheckCircle2, Download, Dot, FileText, Loader2, Pencil, Play, RefreshCw, Sparkles, Trash2 } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Player, PlayerRef } from '@remotion/player';
import { CourseComposition } from './ChapterVideo';
import { CustomPlayerControls } from './CustomPlayerControls';
import { ChapterNotesDialog } from './ChapterNotesDialog';
import OutlineCockpit from './OutlineCockpit';
import StudioReviewCockpit, { ReviewSlide } from './StudioReviewCockpit';
import DrawOutlineButton from '@/components/ui/DrawOutlineButton';
import axios from 'axios';
import { toast } from 'sonner';


type Props = {
    course: Course | undefined;
    onRefresh?: () => void;
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



function CourseChapters({ course, onRefresh }: Props) {
    const fps = 30;
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [startedChapters, setStartedChapters] = useState<Record<string, boolean>>({});
    const [playbackSpeed, setPlaybackSpeed] = useState(1);

    // ── Download state per chapter ────────────────────────────────────────────
    type DownloadStatus = 'idle' | 'rendering' | 'completed' | 'failed';
    const [dlStatus, setDlStatus] = useState<Record<string, DownloadStatus>>({});
    const [dlProgress, setDlProgress] = useState<Record<string, number>>({});
    const [dlUrls, setDlUrls] = useState<Record<string, string>>({});
    const pollTimers = useRef<Record<string, ReturnType<typeof setInterval>>>({});

    // ── Notes dialog state ────────────────────────────────────────────────────
    const [notesDialog, setNotesDialog] = useState<{ chapterId: string; title: string; slides: any[] } | null>(null);
    const [resettingAudio, setResettingAudio] = useState<Record<string, boolean>>({});

    // ── Outline editor cockpit state ──────────────────────────────────────────
    // `outlineChapter` holds the chapter currently being edited (null = closed).
    // `localOutlines` optimistically overrides a chapter's subContent after a save,
    // so the edit reflects immediately without waiting for a full course refetch.
    const [outlineChapter, setOutlineChapter] = useState<{ chapterId: string; title: string; index: number; points: string[] } | null>(null);
    const [localOutlines, setLocalOutlines] = useState<Record<string, string[]>>({});

    // ── Studio review cockpit state (Stages 2 & 3) ────────────────────────────
    // Opened when a chapter is parked at `review:slides`: the user screens the
    // generated slides, requests per-slide changes, edits narration, then
    // approves — which fires the gated audio phase.
    const [reviewChapter, setReviewChapter] = useState<{ chapterId: string; title: string; index: number; slides: ReviewSlide[] } | null>(null);

    const stopPoll = (chapterId: string) => {
        if (pollTimers.current[chapterId]) {
            clearInterval(pollTimers.current[chapterId]);
            delete pollTimers.current[chapterId];
        }
    };

    const pollRenderStatus = useCallback((chapterId: string) => {
        stopPoll(chapterId);
        pollTimers.current[chapterId] = setInterval(async () => {
            try {
                const res = await axios.get(`/api/render-chapter?chapterId=${chapterId}`);
                const data = res.data;
                if (data.status === 'completed') {
                    setDlStatus(p => ({ ...p, [chapterId]: 'completed' }));
                    setDlProgress(p => ({ ...p, [chapterId]: 100 }));
                    setDlUrls(p => ({ ...p, [chapterId]: data.url }));
                    stopPoll(chapterId);
                } else if (data.status === 'failed') {
                    setDlStatus(p => ({ ...p, [chapterId]: 'failed' }));
                    setDlProgress(p => {
                        const merged = { ...p };
                        delete merged[chapterId];
                        return merged;
                    });
                    stopPoll(chapterId);
                    toast.error(`Render failed: ${data.error ?? 'Unknown error'}`);
                } else if (data.status === 'rendering') {
                    setDlProgress(p => ({ ...p, [chapterId]: data.progress ?? 0 }));
                } else if (data.status === 'idle') {
                    setDlStatus(p => {
                        const merged = { ...p };
                        delete merged[chapterId];
                        return merged;
                    });
                    setDlProgress(p => {
                        const merged = { ...p };
                        delete merged[chapterId];
                        return merged;
                    });
                    stopPoll(chapterId);
                }
            } catch { /* ignore poll errors */ }
        }, 3000);
    }, []);

    const handleDownloadChapter = useCallback(async (chapter: any, chapterSlides: any[], chapterDurations: any) => {
        const chapterId = chapter.chapterId;

        // If already completed, directly trigger browser download
        const existingUrl = dlUrls[chapterId];
        if (dlStatus[chapterId] === 'completed' && existingUrl) {
            const a = document.createElement('a');
            if (existingUrl.trim().startsWith('{') || existingUrl.includes('"chunked"')) {
                a.href = `/api/download-chapter/${chapterId}`;
            } else {
                a.href = existingUrl;
            }
            a.download = `${chapter.chapterTitle.replace(/[^a-z0-9]/gi, '_')}.mp4`;
            a.click();
            return;
        }

        // Start render
        setDlStatus(p => ({ ...p, [chapterId]: 'rendering' }));
        setDlProgress(p => ({ ...p, [chapterId]: 0 }));
        toast.info('🎬 Starting chapter render — this may take a few minutes...');

        try {
            const slides = chapterSlides.map((slide: any) => ({
                slideId: slide.slideId,
                html: slide.html,
                audioFileUrl: slide.audioUrl,
                revealData: slide.revealData,
                fragmentData: Array.isArray(slide.revealData) && slide.revealData.length > 0 && !isNaN(Number(slide.revealData[0]))
                    ? slide.revealData.map(Number)
                    : undefined,
                caption: slide.captions,
            }));

            const res = await axios.post('/api/render-chapter', {
                chapterId,
                slides,
                durationsBySlideId: chapterDurations?.slidesDurations ?? {},
                totalFrames: chapterDurations?.totalFrames ?? 900,
            });

            if (res.data.status === 'already_complete') {
                setDlStatus(p => ({ ...p, [chapterId]: 'completed' }));
                setDlUrls(p => ({ ...p, [chapterId]: res.data.url }));
                toast.success('✅ Chapter MP4 is ready!');
                return;
            }

            // Start polling
            pollRenderStatus(chapterId);
        } catch (err: any) {
            setDlStatus(p => ({ ...p, [chapterId]: 'failed' }));
            toast.error(`Failed to start render: ${err.message}`);
        }
    }, [dlStatus, dlUrls, pollRenderStatus]);

    // Cleanup intervals on unmount
    useEffect(() => {
        return () => { Object.values(pollTimers.current).forEach(clearInterval); };
    }, []);
    
    // Track generation status per chapterId
    const [statuses, setStatuses] = useState<Record<string, {
        status: string;
        slidesComplete: number;
        slidesTotal: number;
        audioComplete: number;
        errorMessage: string | null;
    }>>({});

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

    // Fetch and update statuses
    const fetchStatuses = useCallback(async () => {
        if (!course?.courseId) return;
        try {
            const res = await axios.get(`/api/chapter-status?courseId=${course.courseId}`);
            const list = res.data?.data?.statuses || res.data?.statuses || [];
            
            const map: Record<string, any> = {};
            let completedSome = false;
            
            const newDlStatus: Record<string, DownloadStatus> = {};
            const newDlUrls: Record<string, string> = {};
            const newDlProgress: Record<string, number> = {};
            
            for (const row of list) {
                map[row.chapterId] = {
                    status: row.status,
                    slidesComplete: row.slidesComplete,
                    slidesTotal: row.slidesTotal,
                    audioComplete: row.audioComplete,
                    errorMessage: row.errorMessage,
                };
                
                // Track render status from DB
                if (row.renderStatus === 'video:completed' && row.videoUrl) {
                    newDlStatus[row.chapterId] = 'completed';
                    newDlUrls[row.chapterId] = row.videoUrl;
                    newDlProgress[row.chapterId] = 100;
                } else if (row.renderStatus === 'rendering:video') {
                    newDlStatus[row.chapterId] = 'rendering';
                    newDlProgress[row.chapterId] = row.renderProgress ?? 0;
                    // CRITICAL FIX: if DB says rendering but we're not already polling,
                    // start polling now so the chapter can transition out of the
                    // stale "Rendering 0%" state automatically.
                    if (!pollTimers.current[row.chapterId]) {
                        pollRenderStatus(row.chapterId);
                    }
                } else if (row.renderStatus === 'video:failed') {
                    newDlStatus[row.chapterId] = 'failed';
                    newDlProgress[row.chapterId] = 0;
                } else {
                    newDlStatus[row.chapterId] = 'idle';
                    newDlProgress[row.chapterId] = 0;
                }
                
                // Trigger page refresh when a chapter changes state to 'completed'
                const prev = statuses[row.chapterId];
                if (row.status === 'completed' && prev?.status !== 'completed') {
                    completedSome = true;
                }
                // When a chapter reaches the review gate, refetch the course so the
                // freshly generated slides (html + narration) are available to the
                // Studio review cockpit.
                if (row.status === 'review:slides' && prev?.status !== 'review:slides') {
                    completedSome = true;
                }
            }
            
            setStatuses(map);
            
            // Sync download status/URLs state with DB statuses,
            // while preserving local active rendering states.
            setDlStatus(prev => {
                const merged = { ...prev };
                for (const cid in newDlStatus) {
                    if (
                        prev[cid] !== 'rendering' || 
                        newDlStatus[cid] === 'completed' || 
                        newDlStatus[cid] === 'failed' || 
                        (newDlStatus[cid] === 'idle' && !pollTimers.current[cid])
                    ) {
                        merged[cid] = newDlStatus[cid];
                    }
                }
                return merged;
            });
            
            setDlUrls(prev => {
                const merged = { ...prev };
                for (const cid in newDlUrls) {
                    merged[cid] = newDlUrls[cid];
                }
                return merged;
            });

            setDlProgress(prev => {
                const merged = { ...prev };
                for (const cid in newDlProgress) {
                    if (!pollTimers.current[cid]) {
                        merged[cid] = newDlProgress[cid];
                    }
                }
                return merged;
            });
            
            if (completedSome && onRefresh) {
                onRefresh();
            }
        } catch (err) {
            console.error("Failed to fetch chapter statuses:", err);
        }
    }, [course?.courseId, onRefresh, statuses, pollRenderStatus]);

    // Initial status fetch on mount/course change
    useEffect(() => {
        fetchStatuses();
    }, [course?.courseId]);

    // Poll status every 3s if any chapter is currently generating or queued
    useEffect(() => {
        const isGeneratingAny = Object.values(statuses).some(
            s => s.status === 'queued' || s.status === 'generating:slides' || s.status === 'generating:audio'
        );

        if (!isGeneratingAny) return;

        const interval = setInterval(() => {
            fetchStatuses();
        }, 3000);

        return () => clearInterval(interval);
    }, [statuses, fetchStatuses]);

    const handleResetAudio = useCallback(async (chapterId: string) => {
        const confirmReset = window.confirm(
            "⚠️ Are you sure you want to delete this chapter's generated audio/voiceover and start from scratch?\n\n" +
            "This will clear the current voiceover audio and captions, allowing you to run the generation pipeline fresh."
        );
        if (!confirmReset) return;

        setResettingAudio(p => ({ ...p, [chapterId]: true }));
        const tId = toast.loading("🧹 Clearing chapter audio & resetting status...");

        try {
            const res = await axios.post('/api/reset-chapter-audio', {
                courseId: course?.courseId,
                chapterId: chapterId
            });

            if (res.data?.success) {
                toast.success("✅ Chapter audio reset successfully!", { id: tId });
                fetchStatuses();
                if (onRefresh) onRefresh();
            } else {
                throw new Error(res.data?.message || "Failed to reset chapter audio.");
            }
        } catch (err: any) {
            console.error(err);
            toast.error(err.message || "Failed to reset chapter audio.", { id: tId });
        } finally {
            setResettingAudio(p => ({ ...p, [chapterId]: false }));
        }
    }, [course?.courseId, fetchStatuses, onRefresh]);

    const handleDeleteChapterRender = useCallback(async (chapterId: string) => {
        const confirmDelete = window.confirm(
            "⚠️ Are you sure you want to delete the rendered video for this chapter?\n\n" +
            "This will delete the MP4 file and reset its render status, allowing you to trigger a fresh render."
        );
        if (!confirmDelete) return;

        const tId = toast.loading("🧹 Deleting rendered video...");
        try {
            const res = await axios.delete(`/api/render-chapter?chapterId=${chapterId}`);
            if (res.data?.success) {
                // Reset local states
                stopPoll(chapterId);
                setDlStatus(p => {
                    const merged = { ...p };
                    delete merged[chapterId];
                    return merged;
                });
                setDlProgress(p => {
                    const merged = { ...p };
                    delete merged[chapterId];
                    return merged;
                });
                setDlUrls(p => {
                    const merged = { ...p };
                    delete merged[chapterId];
                    return merged;
                });
                
                toast.success("✅ Rendered video deleted successfully!", { id: tId });
                
                // Fetch updated statuses to sync with DB
                fetchStatuses();
            } else {
                throw new Error(res.data?.error || "Failed to delete rendered video.");
            }
        } catch (err: any) {
            console.error("❌ Deletion failed:", err);
            toast.error(err.message || "Failed to delete rendered video.", { id: tId });
        }
    }, [fetchStatuses]);

    // Triggers generation event for a single chapter
    const handleGenerateChapter = async (chapter: any, index: number) => {
        if (!course?.courseId) return;
        
        // 1. Fire image generation (non-blocking)
        axios.post('/api/generate-images', {
            courseName: course.courseName,
            courseId: course.courseId,
            chapters: course.courseLayout?.chapters || [],
        }).catch(e => console.error('⚠️ Image queue failed:', e.message));

        // 2. Queue video content generation
        try {
            // One slide per outline point (capped at 15) — reflect that in the
            // optimistic progress total so the bar isn't stuck at "/7".
            const optimisticTotal = Math.min(15, Math.max(1, chapter.subContent?.length || 7));
            setStatuses(prev => ({
                ...prev,
                [chapter.chapterId]: {
                    status: 'queued',
                    slidesComplete: 0,
                    slidesTotal: optimisticTotal,
                    audioComplete: 0,
                    errorMessage: null
                }
            }));
            await axios.post('/api/generate-video-content', {
                chapter,
                courseId: course.courseId,
                courseName: course.courseName,
                chapterIndex: index,
            });
            toast.success(`📤 Generation started for Chapter ${index + 1}!`);
        } catch (err: any) {
            console.error("❌ Generation trigger failed:", err);
            toast.error(`Failed to queue generation: ${err.message}`);
        }
    };

    // Open the Studio review cockpit for a chapter parked at `review:slides`.
    const openReview = useCallback((chapter: any, index: number, chapterSlides: any[]) => {
        const slides: ReviewSlide[] = [...chapterSlides]
            .sort((a, b) => (a.slideIndex ?? 0) - (b.slideIndex ?? 0))
            .map(s => ({
                slideId: s.slideId,
                slideIndex: s.slideIndex,
                html: s.html ?? '',
                narration: s.narration,
                revealData: s.revealData,
            }));
        if (slides.length === 0) {
            toast.info('Slides are still finishing up — try again in a moment.');
            if (onRefresh) onRefresh();
            return;
        }
        setReviewChapter({ chapterId: chapter.chapterId, title: chapter.chapterTitle, index, slides });
    }, [onRefresh]);

    // Approve reviewed slides → fire the gated audio (TTS) phase.
    const handleApproveSlides = useCallback(async (chapter: any, index: number) => {
        if (!course?.courseId) return;
        // Optimistically flip to the audio phase so the card shows progress + polls.
        setStatuses(prev => {
            const existing = prev[chapter.chapterId];
            const total = existing?.slidesTotal || chapter.subContent?.length || 7;
            return {
                ...prev,
                [chapter.chapterId]: {
                    status: 'generating:audio',
                    slidesComplete: total,
                    slidesTotal: total,
                    audioComplete: 0,
                    errorMessage: null,
                },
            };
        });
        try {
            await axios.post('/api/approve-slides', {
                chapter,
                courseId: course.courseId,
                courseName: course.courseName,
                chapterIndex: index,
            });
        } catch (err: any) {
            console.error('❌ Approve failed:', err);
            toast.error(`Failed to start voiceover: ${err?.response?.data?.error || err.message}`);
        }
    }, [course?.courseId, course?.courseName]);

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
            // Sort slides by slideIndex so durations are always in Slide 1→N order,
            // regardless of which chapter was generated first.
            const chapterSlides = course.chapterContentSlides
                .filter(slide => slide.chapterId === chapter.chapterId)
                .sort((a, b) => (a.slideIndex ?? 0) - (b.slideIndex ?? 0));

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

    // Render the beautiful generation overlay states
    const renderGenerationUI = (chapter: any, index: number, chapterSlides: any[] = []) => {
        const s = statuses[chapter.chapterId] || {
            status: 'idle',
            slidesComplete: 0,
            slidesTotal: 7,
            audioComplete: 0,
            errorMessage: null
        };
        const status = s.status;
        const slidesComplete = s.slidesComplete || 0;
        const slidesTotal = s.slidesTotal || 7;
        const audioComplete = s.audioComplete || 0;
        const errorMsg = s.errorMessage;

        // division safeguards to avoid NaN progress bars
        const total = slidesTotal > 0 ? slidesTotal : 7;
        const slidesPercent = Math.min(100, Math.round((slidesComplete / total) * 100));
        const audioPercent = Math.min(100, Math.round((audioComplete / total) * 100));

        // Inject high-end CSS keyframes directly for self-contained, smooth hardware-accelerated animations
        const animationStyles = (
            <style dangerouslySetInnerHTML={{__html: `
                @keyframes floatCard {
                    0%, 100% { transform: translateY(0px) rotate(-1deg); }
                    50% { transform: translateY(-8px) rotate(1deg); }
                }
                @keyframes ambientPulse {
                    0%, 100% { opacity: 0.15; transform: scale(1) translate(-50%, -50%); }
                    50% { opacity: 0.35; transform: scale(1.2) translate(-45%, -45%); }
                }
                @keyframes soundBar {
                    0%, 100% { height: 8px; }
                    50% { height: 36px; }
                }
                @keyframes shimmerSweep {
                    0% { transform: translateX(-150%); }
                    50% { transform: translateX(150%); }
                    100% { transform: translateX(150%); }
                }
            `}} />
        );

        switch (status) {
            case 'queued':
                return (
                    <div className="relative flex flex-col items-center justify-center h-full p-4 text-center bg-zinc-950 text-white gap-3 select-none overflow-hidden">
                        {animationStyles}
                        {/* Shifting background aurora */}
                        <div className="absolute top-1/2 left-1/2 w-64 h-64 rounded-full bg-purple-600/20 blur-[80px] -translate-x-1/2 -translate-y-1/2 pointer-events-none" style={{ animation: 'ambientPulse 6s ease-in-out infinite' }} />
                        
                        <div className="relative z-10 flex flex-col items-center gap-4">
                            {/* Rotating double-ring indicator */}
                            <div className="relative flex items-center justify-center w-16 h-16">
                                <div className="absolute inset-0 rounded-full border-2 border-purple-500/20 border-t-purple-500 animate-spin" style={{ animationDuration: '1.2s' }} />
                                <div className="absolute inset-2 rounded-full border-2 border-indigo-500/10 border-b-indigo-400 animate-spin" style={{ animationDuration: '2s', animationDirection: 'reverse' }} />
                                <Sparkles className="h-5 w-5 text-purple-400 animate-pulse" />
                            </div>
                            <div className="space-y-1">
                                <p className="text-xs font-semibold tracking-wider uppercase text-purple-300 drop-shadow-[0_0_10px_rgba(168,85,247,0.4)]">Awaiting Pipeline</p>
                                <p className="text-[11px] text-zinc-400 max-w-[240px] leading-relaxed">Securing server-side slots. Allocating high-performance GPU engines...</p>
                            </div>
                        </div>
                    </div>
                );
            case 'generating:slides': {
                return (
                    <div className="relative flex flex-col justify-center h-full p-6 bg-zinc-950 text-white gap-4 select-none overflow-hidden">
                        {animationStyles}
                        {/* Aurora background */}
                        <div className="absolute top-1/2 left-1/2 w-72 h-72 rounded-full bg-violet-600/15 blur-[90px] -translate-x-1/2 -translate-y-1/2 pointer-events-none" style={{ animation: 'ambientPulse 8s ease-in-out infinite' }} />
                        
                        <div className="relative z-10 flex gap-4 items-center">
                            {/* Mini Floating Card skeleton to represent slides being designed */}
                            <div className="flex-shrink-0 w-16 h-12 bg-zinc-900/80 rounded-lg border border-white/10 p-1.5 flex flex-col gap-1 shadow-2xl relative overflow-hidden" style={{ animation: 'floatCard 4s ease-in-out infinite' }}>
                                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent -translate-x-full" style={{ animation: 'shimmerSweep 2s infinite' }} />
                                <div className="h-1.5 w-8 bg-purple-500/40 rounded-full" />
                                <div className="h-1.5 w-full bg-zinc-800 rounded-sm" />
                                <div className="flex gap-1 mt-auto">
                                    <div className="h-3 w-3 bg-indigo-500/30 rounded-sm" />
                                    <div className="flex flex-col gap-0.5 w-full">
                                        <div className="h-1 w-full bg-zinc-800 rounded-sm" />
                                        <div className="h-1 w-2/3 bg-zinc-800 rounded-sm" />
                                    </div>
                                </div>
                            </div>
                            
                            <div className="flex-1 space-y-1">
                                <div className="flex justify-between items-end">
                                    <div className="flex items-center gap-1.5">
                                        <Sparkles className="h-3.5 w-3.5 text-purple-400 animate-pulse" />
                                        <span className="text-[10px] md:text-xs font-bold uppercase tracking-widest text-purple-400">Phase 1: Designing Slides</span>
                                    </div>
                                    <span className="text-[10px] md:text-xs font-mono text-zinc-400 font-bold">{slidesComplete}/{total} ({slidesPercent}%)</span>
                                </div>
                                <div className="w-full bg-zinc-900 rounded-full h-2.5 overflow-hidden border border-white/5 shadow-inner">
                                    <div 
                                        className="bg-gradient-to-r from-purple-500 via-violet-500 to-indigo-500 h-full rounded-full transition-all duration-500 ease-out shadow-[0_0_12px_rgba(168,85,247,0.6)] relative" 
                                        style={{ width: `${slidesPercent}%` }}
                                    >
                                        {/* Glowing end bead */}
                                        {slidesPercent > 0 && (
                                            <div className="absolute right-0 top-0 bottom-0 w-1.5 bg-white/60 blur-[1px] animate-pulse" />
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                        <p className="relative z-10 text-[10px] text-zinc-400 italic text-center font-medium">
                            Synthesizing layout, formatting markup, and binding visuals for slide #{slidesComplete + 1}...
                        </p>
                    </div>
                );
            }
            case 'generating:audio': {
                return (
                    <div className="relative flex flex-col justify-center h-full p-6 bg-zinc-950 text-white gap-4 select-none overflow-hidden">
                        {animationStyles}
                        {/* Shifting background aurora */}
                        <div className="absolute top-1/2 left-1/2 w-72 h-72 rounded-full bg-cyan-600/15 blur-[90px] -translate-x-1/2 -translate-y-1/2 pointer-events-none" style={{ animation: 'ambientPulse 7s ease-in-out infinite' }} />
                        
                        <div className="relative z-10 flex gap-4 items-center">
                            {/* Animated Audio Equalizer Visualizer */}
                            <div className="flex-shrink-0 w-16 h-12 bg-zinc-900/80 rounded-lg border border-white/10 flex items-center justify-center gap-1 shadow-2xl">
                                <div className="w-1 bg-cyan-400 rounded-full" style={{ animation: 'soundBar 1.2s ease-in-out infinite', animationDelay: '0.1s' }} />
                                <div className="w-1 bg-indigo-400 rounded-full" style={{ animation: 'soundBar 1s ease-in-out infinite', animationDelay: '0.3s' }} />
                                <div className="w-1 bg-violet-400 rounded-full" style={{ animation: 'soundBar 1.4s ease-in-out infinite', animationDelay: '0.5s' }} />
                                <div className="w-1 bg-indigo-400 rounded-full" style={{ animation: 'soundBar 0.9s ease-in-out infinite', animationDelay: '0.2s' }} />
                                <div className="w-1 bg-cyan-400 rounded-full" style={{ animation: 'soundBar 1.3s ease-in-out infinite', animationDelay: '0.4s' }} />
                            </div>
                            
                            <div className="flex-1 space-y-1">
                                <div className="flex justify-between items-end">
                                    <div className="flex items-center gap-1.5">
                                        <Loader2 className="h-3.5 w-3.5 animate-spin text-cyan-400" />
                                        <span className="text-[10px] md:text-xs font-bold uppercase tracking-widest text-cyan-400 font-semibold">Phase 2: Narrating & Audio</span>
                                    </div>
                                    <span className="text-[10px] md:text-xs font-mono text-zinc-400 font-bold">{audioComplete}/{total} ({audioPercent}%)</span>
                                </div>
                                <div className="w-full bg-zinc-900 rounded-full h-2.5 overflow-hidden border border-white/5 shadow-inner">
                                    <div 
                                        className="bg-gradient-to-r from-indigo-500 via-cyan-500 to-emerald-400 h-full rounded-full transition-all duration-500 ease-out shadow-[0_0_12px_rgba(6,182,212,0.6)] relative" 
                                        style={{ width: `${audioPercent}%` }}
                                    >
                                        {/* Glowing end bead */}
                                        {audioPercent > 0 && (
                                            <div className="absolute right-0 top-0 bottom-0 w-1.5 bg-white/60 blur-[1px] animate-pulse" />
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                        <p className="relative z-10 text-[10px] text-cyan-300 italic text-center font-medium animate-pulse">
                            Synthesizing studio-grade AI narration for slide #{audioComplete + 1}...
                        </p>
                    </div>
                );
            }
            case 'review:slides':
                return (
                    <div className="relative flex flex-col items-center justify-center h-full p-5 text-center bg-gradient-to-br from-zinc-950 via-[#0b1220] to-zinc-950 text-white gap-3 select-none overflow-hidden">
                        {animationStyles}
                        <div className="absolute top-1/2 left-1/2 w-64 h-64 rounded-full blur-[80px] -translate-x-1/2 -translate-y-1/2 pointer-events-none" style={{ background: 'rgba(109,91,211,0.25)', animation: 'ambientPulse 7s ease-in-out infinite' }} />

                        <div className="relative z-10 flex flex-col items-center gap-3">
                            <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/5 shadow-[0_0_20px_rgba(109,91,211,0.35)]">
                                <Sparkles className="h-6 w-6 text-violet-300 animate-pulse" />
                                <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-[10px] font-bold text-white shadow">
                                    <CheckCircle2 className="h-3.5 w-3.5" />
                                </span>
                            </div>
                            <div className="space-y-1">
                                <p className="text-sm font-bold text-white">Slides ready to review</p>
                                <p className="text-[11px] text-zinc-400 max-w-[260px] leading-relaxed">
                                    Screen every slide, request changes, and fine-tune the narration before the voiceover is generated.
                                </p>
                            </div>
                            <button
                                onClick={() => openReview(chapter, index, chapterSlides)}
                                className="mt-1 cursor-pointer flex items-center gap-2 px-5 py-2 rounded-full text-xs font-bold text-white shadow-lg transition-transform hover:scale-105 active:scale-95"
                                style={{ background: 'linear-gradient(135deg, #3EA5D6 0%, #3363AD 50%, #6D5BD3 100%)' }}
                            >
                                <Play className="h-3.5 w-3.5 fill-current" />
                                Review &amp; finalize
                            </button>
                        </div>
                    </div>
                );
            case 'failed':
                return (
                    <div className="relative flex flex-col items-center justify-center h-full p-4 text-center bg-zinc-950 text-white gap-3 select-none overflow-hidden">
                        {animationStyles}
                        <div className="absolute top-1/2 left-1/2 w-64 h-64 rounded-full bg-rose-900/20 blur-[80px] -translate-x-1/2 -translate-y-1/2 pointer-events-none" />
                        
                        <div className="relative z-10 flex flex-col items-center gap-3">
                            <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-full animate-bounce shadow-[0_0_15px_rgba(244,63,94,0.2)]">
                                <AlertTriangle className="h-6 w-6 text-rose-500" />
                            </div>
                            <div className="space-y-1 max-w-[90%]">
                                <p className="text-sm font-bold text-rose-400">Generation Failed</p>
                                <p className="text-[10px] md:text-[11px] text-zinc-400 line-clamp-2 leading-relaxed max-w-[260px] mx-auto">{errorMsg || "An error occurred during execution."}</p>
                            </div>
                            <button
                                onClick={() => handleGenerateChapter(chapter, index)}
                                className="mt-1 cursor-pointer flex items-center gap-1.5 px-4 py-1.5 bg-rose-950/80 hover:bg-rose-900 border border-rose-800/80 hover:border-rose-700 rounded-full text-xs text-rose-200 font-semibold transition-all hover:scale-105 active:scale-95 hover:shadow-[0_0_12px_rgba(244,63,94,0.3)] duration-200"
                            >
                                <RefreshCw className="h-3.5 w-3.5" />
                                Retry Generation
                            </button>
                        </div>
                    </div>
                );
            case 'idle':
            default:
                return (
                    <div className="relative flex flex-col items-center justify-center h-full p-6 text-center bg-gradient-to-b from-zinc-900 to-black text-white gap-4 overflow-hidden group select-none">
                        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-32 h-32 bg-purple-500/10 rounded-full blur-2xl group-hover:bg-purple-500/20 transition-all duration-700" />
                        
                        <div className="z-10 flex flex-col items-center gap-2">
                            <div className="p-3 bg-zinc-800/80 border border-zinc-700/50 rounded-2xl group-hover:border-purple-500/30 transition-all duration-300">
                                <Sparkles className="h-6 w-6 text-purple-400 animate-pulse" />
                            </div>
                            <div>
                                <p className="text-sm font-semibold text-zinc-200">Video Content Ready</p>
                                <p className="text-[11px] text-zinc-500 mt-0.5">Generate slides & AI voiceover for this chapter</p>
                            </div>
                        </div>

                        <DrawOutlineButton
                            onClick={() => handleGenerateChapter(chapter, index)}
                            fullWidth={false}
                            variant="dark"
                            accentColor="#7c3aed"
                            className="text-xs border border-purple-600/30"
                        >
                            <Play className="h-3 w-3 fill-current" />
                            Generate Video Content
                        </DrawOutlineButton>
                    </div>
                );
        }
    };

    return (
        <div className='max-w-6xl -mt-5 p-10 border rounded-3xl shadow-lg w-full bg-background/80 backdrop-blur-xl'>
            <div className='flex justify-between items-center'>
                <h2 className='font-bold text-2xl mb-2'>Course preview</h2>
                <h2 className='text-sm text-muted-foreground'>Chapters and Short Preview</h2>
            </div>
            <div className='mt-5'>
                {course?.courseLayout?.chapters?.map((chapter, index) => {
                    // Sort by slideIndex so slides always play in their authored order (1→N)
                    // even when chapters were generated out of sequence (e.g. Ch.2 before Ch.1).
                    const chapterSlides = (course.chapterContentSlides?.filter(
                        slide => slide.chapterId === chapter.chapterId
                    ) || []).sort((a, b) => (a.slideIndex ?? 0) - (b.slideIndex ?? 0));
                    
                    const chStatus = statuses[chapter.chapterId];
                    // Consider it generated ONLY if we actually have slides in the database AND either:
                    // 1. The status is completed
                    // 2. Or every slide has audioUrl
                    const isGenerated = chapterSlides.length > 0 && (chStatus 
                        ? chStatus.status === 'completed' 
                        : chapterSlides.every(s => s.audioUrl));

                    const chapterDurations = durationsByChapterId?.[chapter.chapterId];
                    const pRef = getPlayerRef(chapter.chapterId);
                    const cRef = getContainerRef(chapter.chapterId);
                    const totalFrames = chapterDurations?.totalFrames || 30;
                    const chapterStarted = startedChapters[chapter.chapterId] || false;
                    const chapterSeconds = totalFrames / fps;

                    // Effective outline points — a local optimistic save overrides the stored layout.
                    const effectivePoints = localOutlines[chapter.chapterId] ?? chapter.subContent ?? [];
                    // Editable only before generation (idle/failed) — once slides exist, the points
                    // already drove slide creation, so editing is locked until a reset.
                    const isReviewing = chStatus?.status === 'review:slides';
                    const isGenerating = chStatus?.status === 'queued' || chStatus?.status === 'generating:slides' || chStatus?.status === 'generating:audio';
                    const canEditOutline = !isGenerated && !isGenerating && !isReviewing;

                    return (
                        <Card key={index} className='mb-5'>
                            <CardHeader>
                                <div className='flex items-center justify-between gap-3 flex-wrap'>
                                    <div className='flex items-center gap-3 flex-1 min-w-0'>
                                        <h2 className='p-2 bg-primary/40 inline-flex h-10 w-10 text-center rounded-2xl justify-center items-center flex-shrink-0'>{index + 1}</h2>
                                        <CardTitle className='md:text-xl text-base truncate'>
                                            {chapter.chapterTitle}
                                        </CardTitle>
                                    </div>

                                     {/* ── Action buttons (only for generated chapters) ── */}
                                     {isGenerated && (
                                         <div className='flex items-center gap-2 flex-shrink-0'>                                             {/* Notes PDF button */}
                                             <button
                                                 onClick={() => setNotesDialog({ chapterId: chapter.chapterId, title: chapter.chapterTitle, slides: chapterSlides })}
                                                 className='cursor-pointer flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800/60 hover:bg-zinc-700/80 border border-zinc-600/50 hover:border-amber-500/50 text-zinc-300 hover:text-amber-300 rounded-xl text-xs font-semibold transition-all hover:scale-105 active:scale-95 group'
                                             >
                                                 <FileText className='h-3.5 w-3.5 group-hover:text-amber-400 transition-colors' />
                                                 <span className='hidden sm:inline'>Notes PDF</span>
                                             </button>

                                             {/* Reset Audio button */}
                                             <button
                                                 disabled={resettingAudio[chapter.chapterId]}
                                                 onClick={() => handleResetAudio(chapter.chapterId)}
                                                 className='cursor-pointer flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800/60 hover:bg-rose-950/40 hover:text-rose-300 border border-zinc-600/50 hover:border-rose-500/50 text-zinc-300 rounded-xl text-xs font-semibold transition-all hover:scale-105 active:scale-95 group disabled:opacity-50 disabled:cursor-not-allowed'
                                                 title="Delete voiceover audio and captions to regenerate from scratch"
                                             >
                                                 {resettingAudio[chapter.chapterId] ? (
                                                     <Loader2 className='h-3.5 w-3.5 animate-spin text-rose-400' />
                                                 ) : (
                                                     <Trash2 className='h-3.5 w-3.5 group-hover:text-rose-400 transition-colors' />
                                                 )}
                                                 <span className='hidden sm:inline'>Reset Audio</span>
                                             </button>

                                             {/* Download MP4 button */}
                                             {(() => {
                                                 const ds = dlStatus[chapter.chapterId] ?? 'idle';
                                                 const prog = dlProgress[chapter.chapterId] ?? 0;

                                                 if (ds === 'rendering') return (
                                                     <div className='flex items-center gap-2 px-3 py-1.5 bg-zinc-800/60 border border-zinc-700/50 rounded-xl text-xs text-zinc-300'>
                                                         <Loader2 className='h-3.5 w-3.5 animate-spin text-purple-400' />
                                                         <span className='font-semibold hidden sm:inline'>Rendering</span>
                                                         <span className='font-mono text-purple-300 font-bold'>{prog}%</span>
                                                     </div>
                                                 );
                                                 if (ds === 'completed') return (
                                                     <>
                                                         <button
                                                             onClick={() => handleDownloadChapter(chapter, chapterSlides, chapterDurations)}
                                                             className='cursor-pointer flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-xl text-xs font-bold shadow-[0_4px_16px_rgba(16,185,129,0.35)] transition-all hover:scale-105 active:scale-95'
                                                         >
                                                             <Download className='h-3.5 w-3.5' />
                                                             Download MP4
                                                         </button>
                                                         <button
                                                             onClick={() => handleDeleteChapterRender(chapter.chapterId)}
                                                             className='cursor-pointer flex items-center gap-1.5 px-3 py-1.5 bg-rose-950/40 hover:bg-rose-900/40 hover:text-rose-200 border border-rose-800/50 hover:border-rose-500/50 text-rose-300 rounded-xl text-xs font-semibold transition-all hover:scale-105 active:scale-95 group'
                                                             title="Delete rendered video to reset status"
                                                         >
                                                             <Trash2 className='h-3.5 w-3.5 group-hover:text-rose-400 transition-colors' />
                                                             <span className='hidden sm:inline'>Delete Video</span>
                                                         </button>
                                                     </>
                                                 );
                                                 if (ds === 'failed') return (
                                                     <button
                                                         onClick={() => handleDownloadChapter(chapter, chapterSlides, chapterDurations)}
                                                         className='cursor-pointer flex items-center gap-1.5 px-3 py-1.5 bg-rose-900/60 hover:bg-rose-800/80 border border-rose-700/50 text-rose-300 rounded-xl text-xs font-semibold transition-all hover:scale-105'
                                                     >
                                                         <RefreshCw className='h-3.5 w-3.5' />
                                                         Retry Render
                                                     </button>
                                                 );
                                                 return (
                                                     <button
                                                         onClick={() => handleDownloadChapter(chapter, chapterSlides, chapterDurations)}
                                                         className='cursor-pointer flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800/60 hover:bg-zinc-700/80 border border-zinc-600/50 hover:border-purple-500/50 text-zinc-300 hover:text-white rounded-xl text-xs font-semibold transition-all hover:scale-105 active:scale-95 group'
                                                     >
                                                         <Download className='h-3.5 w-3.5 group-hover:text-purple-400 transition-colors' />
                                                         <span className='hidden sm:inline'>Download MP4</span>
                                                     </button>
                                                 );
                                             })()}
                                         </div>
                                     )}

                                     {/* ── Customize outline (only before generation) ── */}
                                     {canEditOutline && (
                                         <button
                                             onClick={() => setOutlineChapter({
                                                 chapterId: chapter.chapterId,
                                                 title: chapter.chapterTitle,
                                                 index,
                                                 points: effectivePoints,
                                             })}
                                             className='cursor-pointer flex items-center gap-1.5 px-3 py-1.5 flex-shrink-0 bg-primary/10 hover:bg-primary/20 border border-primary/25 hover:border-primary/50 text-primary rounded-xl text-xs font-semibold transition-all hover:scale-105 active:scale-95 group'
                                             title="Add, remove, edit or enhance the points in this chapter"
                                         >
                                             <Pencil className='h-3.5 w-3.5 transition-colors' />
                                             <span className='hidden sm:inline'>Customize</span>
                                         </button>
                                     )}
                                 </div>
                             </CardHeader>

                            <CardContent>
                                <div className='grid grid-cols-1 md:grid-cols-2 gap-5'>
                                    <div>
                                        {effectivePoints.map((content, idx) => (
                                            <div key={idx} className='flex gap-2 items-center mt-2'>
                                                <Dot className='h-5 w-5 text-primary' />
                                                <h2>{content}</h2>
                                            </div>
                                        ))}
                                    </div>
                                    {/* Player + controls wrapper */}
                                    <div ref={cRef} style={{
                                        background: '#000',
                                        borderRadius: (isFullscreen && typeof document !== 'undefined' && document.fullscreenElement === cRef.current) ? '0' : '8px',
                                        overflow: 'hidden',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        position: 'relative',
                                        height: (isFullscreen && typeof document !== 'undefined' && document.fullscreenElement === cRef.current) ? '100vh' : '220px',
                                        width: '100%',
                                    }}>
                                        {!isGenerated ? (
                                            /* Render beautiful generation state machine UI */
                                            renderGenerationUI(chapter, index, chapterSlides)
                                        ) : !chapterStarted ? (
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
                                            /* Actual Remotion Player + custom controls */
                                            <>
                                                <div style={{ flex: 1, position: 'relative', width: '100%', minHeight: 0 }}>
                                                    <Player
                                                        ref={pRef}
                                                        component={CourseComposition}
                                                        durationInFrames={totalFrames}
                                                        compositionWidth={1440}
                                                        compositionHeight={720}
                                                        fps={fps}
                                                        playbackRate={playbackSpeed}
                                                        style={{
                                                            width: '100%',
                                                            height: '100%',
                                                            borderRadius: '8px 8px 0 0',
                                                        }}
                                                        inputProps={{
                                                            slides: chapterSlides.map(slide => ({
                                                                slideId: slide.slideId,
                                                                html: slide.html ?? '',
                                                                audioFileUrl: slide.audioUrl ?? '',
                                                                revealData: slide.revealData,
                                                                fragmentData: Array.isArray(slide.revealData) && slide.revealData.length > 0 && !isNaN(Number(slide.revealData[0]))
                                                                    ? slide.revealData.map(Number)
                                                                    : undefined,
                                                                caption: slide.captions,
                                                            })),
                                                            durationsBySlideId: chapterDurations?.slidesDurations || {}
                                                        }}
                                                    />
                                                </div>
                                                <CustomPlayerControls
                                                    playerRef={pRef}
                                                    fps={fps}
                                                    totalFrames={totalFrames}
                                                    containerRef={cRef}
                                                    playbackSpeed={playbackSpeed}
                                                    setPlaybackSpeed={setPlaybackSpeed}
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
            {/* ── Chapter Notes Dialog ── */}
            {notesDialog && (
                <ChapterNotesDialog
                    open={!!notesDialog}
                    onClose={() => setNotesDialog(null)}
                    chapterTitle={notesDialog.title}
                    slides={notesDialog.slides}
                    courseId={course?.courseId || ''}
                    chapterId={notesDialog.chapterId}
                />
            )}

            {outlineChapter && (
                <OutlineCockpit
                    open={!!outlineChapter}
                    onClose={() => setOutlineChapter(null)}
                    courseId={course?.courseId || ''}
                    chapterId={outlineChapter.chapterId}
                    chapterTitle={outlineChapter.title}
                    chapterIndex={outlineChapter.index}
                    initialPoints={outlineChapter.points}
                    onSaved={(points) => {
                        // Optimistically reflect the edit in the UI immediately.
                        setLocalOutlines(prev => ({ ...prev, [outlineChapter.chapterId]: points }));
                        if (onRefresh) onRefresh();
                    }}
                    onSaveAndGenerate={(points) => {
                        const chapterForGen = {
                            ...(course?.courseLayout?.chapters?.find(c => c.chapterId === outlineChapter.chapterId) || {}),
                            chapterId: outlineChapter.chapterId,
                            chapterTitle: outlineChapter.title,
                            subContent: points,
                        };
                        handleGenerateChapter(chapterForGen, outlineChapter.index);
                    }}
                />
            )}

            {reviewChapter && (
                <StudioReviewCockpit
                    open={!!reviewChapter}
                    onClose={() => setReviewChapter(null)}
                    courseId={course?.courseId || ''}
                    chapterId={reviewChapter.chapterId}
                    chapterTitle={reviewChapter.title}
                    chapterIndex={reviewChapter.index}
                    slides={reviewChapter.slides}
                    onApprove={() => {
                        const chapterForGen = {
                            ...(course?.courseLayout?.chapters?.find(c => c.chapterId === reviewChapter.chapterId) || {}),
                            chapterId: reviewChapter.chapterId,
                            chapterTitle: reviewChapter.title,
                        };
                        handleApproveSlides(chapterForGen, reviewChapter.index);
                    }}
                />
            )}
        </div>
    );
}

export default CourseChapters