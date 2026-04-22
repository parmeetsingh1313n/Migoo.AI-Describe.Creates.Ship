"use client"
import { useUser } from '@clerk/nextjs'
import { motion } from 'framer-motion'
import {
    ArrowLeft,
    Check,
    Clock,
    Download,
    Film,
    FileText,
    Image as ImageIcon,
    Loader2,
    MessageSquarePlus,
    Mic,
    MoreVertical,
    Play,
    RefreshCw,
    Sparkles,
    Subtitles,
    Video,
    Wand2,
} from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useRef, useState, Suspense } from 'react'
import { toast } from 'sonner'
import { Player } from '@remotion/player'
import { MainComposition } from '@/remotion/Composition'
import { getMusicUrl } from '@/lib/music-urls'
import { X } from 'lucide-react'
import * as Dialog from '@radix-ui/react-dialog'

// ─── Types ───────────────────────────────────────────────────────────
interface SeriesData {
    id: number
    seriesId: string
    userId: string
    niche: string
    language: string
    voice: string
    music: string
    videoStyle: string
    captionStyle: string
    title: string
    duration: string
    platform: string
    publishTime: string
    thumbnailUrl: string | null
    status: string | null
    createdAt: string
    updatedAt: string
}

interface VideoAsset {
    id: number
    videoId: string
    seriesId: string
    videoTitle: string
    scriptData: any
    audioUrl: string | null
    audioDuration: number | null
    captionData: any
    imageUrls: string[] | null
    sceneThumbnailUrls: string[] | null
    avatarClipUrls: string[] | null
    videoUrl: string | null
    thumbnailUrl: string | null
    status: string | null
    createdAt: string
}

// ─── Step labels for progress bars ───────────────────────────────────
const STEP_KEYS = ['script', 'voice', 'captions', 'images', 'video', 'render', 'saving'] as const

function getActiveStepIndex(status: string | null): number {
    if (!status || !status.startsWith('generating:')) return -1
    const step = status.split(':')[1]
    return STEP_KEYS.findIndex(s => s === step)
}

function SeriesVideosPageContent() {
    const { user } = useUser()
    const params = useParams()
    const router = useRouter()
    const searchParams = useSearchParams()
    const seriesId = params.seriesId as string
    const shouldGenerate = searchParams.get('generate') === 'true'

    const [series, setSeries] = useState<SeriesData | null>(null)
    const [videos, setVideos] = useState<VideoAsset[]>([])
    const [loading, setLoading] = useState(true)
    const [generating, setGenerating] = useState(false)
    const [triggeringGeneration, setTriggeringGeneration] = useState(false)
    const [selectedVideo, setSelectedVideo] = useState<VideoAsset | null>(null)
    const [resettingStatus, setResettingStatus] = useState(false)
    const [showTopicDialog, setShowTopicDialog] = useState(false)
    const [reRenderingId, setReRenderingId] = useState<string | null>(null)
    const [openCardPopover, setOpenCardPopover] = useState<string | null>(null)
    const cardPopoverRef = useRef<HTMLDivElement>(null)
    const hasTriggeredGenerate = useRef(false)

    // ─── Fetch series + videos ───────────────────────────────────────
    const fetchData = useCallback(async () => {
        try {
            const res = await fetch(`/api/short-series/${seriesId}/videos`)
            const data = await res.json()
            if (data.success) {
                setSeries(data.series)
                setVideos(data.videos)

                const isGenerating = data.series.status?.startsWith('generating')
                setGenerating(!!isGenerating)
            }
        } catch (err) {
            console.error('Failed to fetch series data:', err)
        } finally {
            setLoading(false)
        }
    }, [seriesId])

    useEffect(() => {
        fetchData()
    }, [fetchData])

    // ─── Poll while generating ───────────────────────────────────────
    useEffect(() => {
        if (!generating) return
        const interval = setInterval(fetchData, 4000)
        return () => clearInterval(interval)
    }, [generating, fetchData])

    // Refresh when a video is rendered locally or via cloud
    useEffect(() => {
        const handleRefresh = () => fetchData();
        window.addEventListener('video-rendered', handleRefresh);
        window.addEventListener('focus', handleRefresh); // Refresh when user comes back to tab
        return () => {
            window.removeEventListener('video-rendered', handleRefresh);
            window.removeEventListener('focus', handleRefresh);
        };
    }, [fetchData]);

    // Close card popover on outside click
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (cardPopoverRef.current && !cardPopoverRef.current.contains(e.target as Node)) {
                setOpenCardPopover(null)
            }
        }
        document.addEventListener('mousedown', handler)
        return () => document.removeEventListener('mousedown', handler)
    }, [])

    // ─── Auto-trigger generation if ?generate=true ───────────────────
    useEffect(() => {
        if (shouldGenerate && series && !hasTriggeredGenerate.current && !generating) {
            hasTriggeredGenerate.current = true
            
            // Immediately clear the search param to prevent re-triggers on refresh/re-mount
            const newParams = new URLSearchParams(searchParams.toString())
            newParams.delete('generate')
            const query = newParams.toString()
            const cleanUrl = `/short-generator/${seriesId}${query ? '?' + query : ''}`
            router.replace(cleanUrl, { scroll: false })
            
            handleGenerate()
        }
    }, [shouldGenerate, series, generating, router, searchParams, seriesId])

    // ─── Force Reset Status ─────────────────────────────────────────
    const handleForceStop = async () => {
        if (!confirm('Are you sure you want to force stop? This will clear the "Processing" state.')) return
        
        setResettingStatus(true)
        try {
            const res = await fetch(`/api/short-series/${seriesId}/reset-status`, { method: 'POST' })
            const data = await res.json()
            if (data.success) {
                toast.success('Status reset successfully')
                setTriggeringGeneration(false)
                setGenerating(false)
                fetchData()
            } else {
                toast.error('Failed to reset status')
            }
        } catch (err) {
            console.error(err)
            toast.error('Error resetting status')
        } finally {
            setResettingStatus(false)
        }
    }

    // ─── Trigger generation ──────────────────────────────────────────
    const handleGenerate = async (customTopic?: string) => {
        setTriggeringGeneration(true)
        try {
            const res = await fetch('/api/short-series/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ seriesId, ...(customTopic ? { customTopic } : {}) }),
            })
            const data = await res.json()
            if (data.success) {
                toast.success(customTopic ? `Generating video about: "${customTopic}"` : 'Video generation started!')
                setGenerating(true)
                setTimeout(fetchData, 2000)
            } else {
                toast.error(data.error || 'Failed to start generation')
            }
        } catch {
            toast.error('Failed to start video generation')
        }
        setTriggeringGeneration(false)
    }

    // ─── Re-render a failed/completed video ──────────────────────────
    const handleReRender = async (videoId: string) => {
        setOpenCardPopover(null)
        setReRenderingId(videoId)
        try {
            const res = await fetch('/api/video/re-render', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ videoId }),
            })
            const data = await res.json()
            if (data.success) {
                toast.success('Re-render started! Your AI credits are safe.')
                // Immediately update local state to reflect rendering status
                setVideos(prev => prev.map(v =>
                    v.videoId === videoId
                        ? { ...v, status: 'rendering', videoUrl: null }
                        : v
                ))
                fetchData()
            } else {
                toast.error(data.error || 'Failed to start re-render')
            }
        } catch {
            toast.error('Failed to start re-render')
        }
        setReRenderingId(null)
    }

    const activeStepIndex = getActiveStepIndex(series?.status ?? null)

    // ─── Loading State ───────────────────────────────────────────────
    if (loading) {
        return (
            <div className="max-w-6xl mx-auto px-4 pt-0 pb-6 -mt-6">
                <div className="flex items-center gap-3 mb-8">
                    <div className="h-9 w-9 rounded-xl bg-muted/60 animate-pulse" />
                    <div className="h-6 bg-muted/60 rounded-lg w-48 animate-pulse" />
                </div>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
                    {[1, 2, 3].map(i => (
                        <div key={i} className="rounded-2xl border border-border/40 bg-white/60 overflow-hidden animate-pulse">
                            <div className="h-44 bg-muted/60" />
                            <div className="p-4 space-y-3">
                                <div className="h-4 bg-muted/60 rounded-lg w-3/4" />
                                <div className="h-3 bg-muted/40 rounded-lg w-1/2" />
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        )
    }

    if (!series) {
        return (
            <div className="max-w-6xl mx-auto px-4 pt-0 pb-6 -mt-6 text-center py-20">
                <h2 className="text-xl font-bold mb-2">Series not found</h2>
                <Link href="/short-generator" className="text-primary hover:underline">
                    ← Back to series
                </Link>
            </div>
        )
    }

    return (
        <div className="max-w-6xl mx-auto px-4 pt-0 pb-6 -mt-6">
            {/* Header */}
            <motion.div
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
                className="mb-8"
            >
                {/* Back + Title */}
                <div className="flex items-center gap-3 mb-4">
                    <Link
                        href="/short-generator"
                        className="flex items-center justify-center w-9 h-9 rounded-xl bg-muted/60 hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-all border border-border/40"
                    >
                        <ArrowLeft className="w-4 h-4" />
                    </Link>
                    <div>
                        <h1 className="text-2xl md:text-3xl font-bold">
                            {series.title}
                        </h1>
                    </div>
                </div>

                {/* Action bar */}
                <div className="flex items-center justify-between">
                    <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-linear-to-r from-primary/10 to-accent/10 border border-primary/10 text-xs font-medium text-primary">
                        <Film className="w-3.5 h-3.5" />
                        {videos.length} video{videos.length !== 1 ? 's' : ''} generated
                    </div>

                    <button
                        onClick={() => setShowTopicDialog(true)}
                        disabled={generating || triggeringGeneration}
                        className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold bg-linear-to-r from-primary to-accent text-white shadow-lg shadow-primary/20 hover:shadow-xl hover:shadow-primary/30 hover:scale-[1.02] transition-all duration-200 disabled:opacity-70 disabled:cursor-not-allowed disabled:hover:scale-100 cursor-pointer"
                    >
                        {triggeringGeneration ? (
                            <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                Starting...
                            </>
                        ) : generating ? (
                            <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                Generating...
                            </>
                        ) : (
                            <>
                                <Sparkles className="w-4 h-4" />
                                Generate More
                            </>
                        )}
                    </button>
                </div>
            </motion.div>

            {/* ─── Videos Grid ─────────────────────────────────────── */}
            {videos.length === 0 && !generating && (
                <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="text-center py-16"
                >
                    <div className="w-20 h-20 rounded-2xl bg-linear-to-br from-primary/10 to-accent/10 flex items-center justify-center mx-auto mb-5">
                        <Video className="w-10 h-10 text-primary/50" />
                    </div>
                    <h3 className="text-xl font-bold mb-2">No videos yet</h3>
                    <p className="text-muted-foreground text-sm mb-6 max-w-sm mx-auto">
                        Click &ldquo;Generate More&rdquo; to create your first AI-generated short video for this series
                    </p>
                    <button
                        onClick={() => setShowTopicDialog(true)}
                        disabled={triggeringGeneration}
                        className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold bg-linear-to-r from-primary to-accent text-white shadow-lg shadow-primary/20 hover:shadow-xl hover:scale-[1.02] transition-all cursor-pointer disabled:opacity-70"
                    >
                        <Sparkles className="w-4 h-4" />
                        Generate First Video
                    </button>
                </motion.div>
            )}

            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {/* ─── Generating Card (appears first when generating) ─── */}
                {generating && (
                    <motion.div
                        key="generating-card"
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.4 }}
                        className="relative rounded-2xl border-2 border-violet-500/30 bg-white/70 backdrop-blur-sm overflow-hidden"
                    >
                        {/* Shimmer thumbnail area */}
                        <div className="relative h-44 bg-linear-to-br from-muted/30 to-muted/10 overflow-hidden">
                            <div className="absolute inset-0 bg-linear-to-r from-transparent via-white/30 to-transparent animate-shimmer" />
                            
                            {/* Dynamic Animation Layer */}
                            <div className="flex flex-col items-center justify-center h-full gap-3 relative z-10">
                                {activeStepIndex >= 0 && STEP_KEYS[activeStepIndex] === 'render' ? (
                                    <>
                                        <motion.div
                                            key="render-anim"
                                            initial={{ scale: 0.8, opacity: 0 }}
                                            animate={{ scale: 1, opacity: 1 }}
                                            className="relative"
                                        >
                                            <motion.div
                                                className={`absolute inset-0 rounded-2xl bg-cyan-500 opacity-20`}
                                                animate={{ scale: [1, 1.4, 1] }}
                                                transition={{ duration: 2, repeat: Infinity }}
                                            />
                                            <div className={`w-14 h-14 rounded-2xl bg-cyan-500 flex items-center justify-center shadow-lg shadow-cyan-500/30 relative z-10`}>
                                                <Film className="w-7 h-7 text-white" />
                                            </div>
                                        </motion.div>
                                        <motion.span 
                                            initial={{ opacity: 0, y: 5 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            className="text-sm font-bold text-foreground"
                                        >
                                            Rendering MP4...
                                        </motion.span>
                                    </>
                                ) : (
                                    <>
                                        <motion.div
                                            className="w-14 h-14 rounded-2xl bg-linear-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-lg shadow-violet-500/30"
                                            animate={{ scale: [1, 1.05, 1] }}
                                            transition={{ duration: 2, repeat: Infinity }}
                                        >
                                            <Wand2 className="w-7 h-7 text-white" />
                                        </motion.div>
                                        <span className="text-sm font-semibold text-violet-700">
                                            {activeStepIndex >= 0
                                                ? `${STEP_KEYS[activeStepIndex].charAt(0).toUpperCase() + STEP_KEYS[activeStepIndex].slice(1)}...`
                                                : 'Starting...'}
                                        </span>
                                    </>
                                )}
                            </div>

                            {/* Generating badge */}
                            <div className="absolute top-3 left-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide backdrop-blur-md bg-black/80 text-white z-20">
                                <span className="relative flex h-2 w-2">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
                                </span>
                                AI Generating
                            </div>
                        </div>

                        {/* Info */}
                        <div className="p-4">
                            <h3 className="font-semibold text-sm leading-snug mb-2 text-muted-foreground">
                                Generating new video...
                            </h3>

                            <div className="flex items-center justify-between mb-3">
                                <div className="flex items-center gap-2 text-xs text-muted-foreground/60">
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                    Processing
                                </div>
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        handleForceStop()
                                    }}
                                    disabled={resettingStatus}
                                    className="text-[10px] font-medium text-red-500 hover:text-red-600 transition-colors uppercase tracking-wider disabled:opacity-50"
                                >
                                    {resettingStatus ? 'Stopping...' : 'Force Stop'}
                                </button>
                            </div>

                            {/* Progress bars — light up green as steps complete */}
                            <div className="flex items-center gap-1.5">
                                {STEP_KEYS.map((stepKey, i) => {
                                    const isCompleted = activeStepIndex > i
                                    const isActive = activeStepIndex === i

                                    return (
                                        <div
                                            key={stepKey}
                                            title={stepKey.charAt(0).toUpperCase() + stepKey.slice(1)}
                                            className="w-full h-1.5 rounded-full overflow-hidden bg-muted/40"
                                        >
                                            {isCompleted ? (
                                                <motion.div
                                                    className="h-full rounded-full bg-linear-to-r from-emerald-400 to-green-500"
                                                    initial={{ width: '0%' }}
                                                    animate={{ width: '100%' }}
                                                    transition={{ duration: 0.4 }}
                                                />
                                            ) : isActive ? (
                                                <motion.div
                                                    className="h-full rounded-full bg-linear-to-r from-violet-400 to-purple-500"
                                                    animate={{ width: ['30%', '70%', '30%'] }}
                                                    transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
                                                />
                                            ) : null}
                                        </div>
                                    )
                                })}
                            </div>
                        </div>
                    </motion.div>
                )}

                {/* ─── Completed / Existing Video Cards ─── */}
                {videos.map((video, index) => (
                    <motion.div
                        key={video.videoId}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: index * 0.05, duration: 0.4 }}
                        onClick={() => video.scriptData && video.audioUrl && setSelectedVideo(video)}
                        className={`group relative rounded-2xl border border-border/40 bg-white/70 backdrop-blur-sm transition-all duration-300 overflow-hidden ${
                            video.scriptData && video.audioUrl ? 'hover:shadow-xl hover:shadow-primary/5 hover:border-primary/20 cursor-pointer' : ''
                        }`}
                    >
                        {/* Thumbnail / First scene image */}
                        <div className="relative h-44 bg-linear-to-br from-primary/20 via-accent/10 to-secondary/20 overflow-hidden">
                            {(video.thumbnailUrl || (video.imageUrls && video.imageUrls.length > 0 && video.imageUrls[0] && video.imageUrls[0] !== "SKIP_VEO")) ? (
                                <Image
                                    src={video.thumbnailUrl || video.imageUrls![0]}
                                    alt={video.videoTitle}
                                    fill
                                    className="object-cover group-hover:scale-105 transition-transform duration-500"
                                />
                            ) : (
                                <div className="flex items-center justify-center h-full">
                                    <Film className="w-10 h-10 text-primary/30" />
                                </div>
                            )}

                            {/* Status overlay badge */}
                            <div className={`absolute top-3 left-3 flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide backdrop-blur-sm ${
                                video.status === 'completed' && video.videoUrl
                                    ? 'bg-emerald-500/90 text-white'
                                    : video.status === 'failed'
                                        ? 'bg-red-500/90 text-white'
                                        : 'bg-amber-500/90 text-white'
                            }`}>
                                {video.status === 'completed' && video.videoUrl ? (
                                    <><Check className="w-3 h-3" /> Ready to Download</>
                                ) : video.status === 'failed' ? (
                                    <>Failed</>
                                ) : (
                                    <><Loader2 className="w-3 h-3 animate-spin" /> {video.status === 'rendering' ? 'Rendering MP4...' : 'Processing...'}</>
                                )}
                            </div>

                            {/* Three-dot menu — top right */}
                            <div
                                className="absolute top-3 right-3 z-10"
                                ref={openCardPopover === video.videoId ? cardPopoverRef : null}
                                onClick={(e) => e.stopPropagation()}
                            >
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        setOpenCardPopover(openCardPopover === video.videoId ? null : video.videoId)
                                    }}
                                    className="w-8 h-8 rounded-lg bg-black/40 backdrop-blur-sm flex items-center justify-center text-white opacity-0 group-hover:opacity-100 hover:bg-black/60 transition-all duration-200 cursor-pointer"
                                >
                                    <MoreVertical className="w-4 h-4" />
                                </button>

                                {/* Popover menu */}
                                {openCardPopover === video.videoId && (
                                    <div className="absolute right-0 top-9 z-30 w-44 bg-white rounded-xl border border-border/60 shadow-xl shadow-black/10 py-1.5 animate-in fade-in zoom-in-95 duration-150">
                                        {/* Re-render option — shown for failed/completed/pending videos (not while rendering) */}
                                        {video.status !== 'rendering' && (
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation()
                                                    handleReRender(video.videoId)
                                                }}
                                                disabled={reRenderingId === video.videoId}
                                                className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-foreground hover:bg-muted/50 transition-colors cursor-pointer disabled:opacity-50"
                                            >
                                                {reRenderingId === video.videoId ? (
                                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                                ) : (
                                                    <RefreshCw className="w-3.5 h-3.5" />
                                                )}
                                                Re-render MP4
                                            </button>
                                        )}
                                        {video.status === 'rendering' && (
                                            <div className="flex items-center gap-2.5 px-3 py-2 text-sm text-muted-foreground">
                                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                                Rendering...
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* Duration badge — includes intro + narration + outro */}
                            {video.audioDuration && (
                                <div className="absolute bottom-3 right-3 flex items-center gap-1 px-2 py-1 rounded-lg bg-black/60 backdrop-blur-sm text-white text-[11px] font-medium">
                                    <Clock className="w-3 h-3" />
                                    {(() => {
                                        const INTRO_DURATION = 9;
                                        const OUTRO_DURATION = 9.5;
                                        const totalSec = (video.audioDuration || 0) + INTRO_DURATION + OUTRO_DURATION;
                                        const mins = Math.floor(totalSec / 60);
                                        const secs = Math.floor(totalSec % 60);
                                        return `${mins}:${secs.toString().padStart(2, '0')}`;
                                    })()}
                                </div>
                            )}

                            {/* Play overlay on hover */}
                            <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/20 transition-all duration-300">
                                <div className="w-12 h-12 rounded-full bg-white/90 flex items-center justify-center opacity-0 group-hover:opacity-100 transform scale-75 group-hover:scale-100 transition-all duration-300 shadow-xl">
                                    <Play className="w-5 h-5 text-foreground ml-0.5" />
                                </div>
                            </div>
                        </div>

                        {/* Info */}
                        <div className="p-4">
                            <h3 className="font-semibold text-sm line-clamp-2 leading-snug mb-2">
                                {video.videoTitle}
                            </h3>

                            {/* Mini completion bars */}
                            <div className="flex items-center gap-1.5">
                                {[
                                    { done: !!video.scriptData, label: 'Script' },
                                    { done: !!video.audioUrl, label: 'Voice' },
                                    { done: !!video.captionData, label: 'Captions' },
                                    { done: video.imageUrls && video.imageUrls.length > 0, label: 'Images' },
                                    { done: !!video.audioUrl, label: 'Music' },
                                    { done: video.status === 'completed', label: 'Render' },
                                    { done: video.status === 'completed', label: 'Done' },
                                ].map((s, i) => (
                                    <div
                                        key={i}
                                        title={s.label}
                                        className={`w-full h-1.5 rounded-full transition-colors ${
                                            s.done ? 'bg-linear-to-r from-emerald-400 to-green-500' : 'bg-muted/40'
                                        }`}
                                    />
                                ))}
                            </div>
                        </div>
                    </motion.div>
                ))}
            </div>

            {/* Video Player Modal */}
            <VideoPlayerDialog
                video={selectedVideo}
                series={series}
                onClose={() => setSelectedVideo(null)}
            />

            {/* Generate Topic Dialog */}
            <GenerateTopicDialog
                open={showTopicDialog}
                onClose={() => setShowTopicDialog(false)}
                onGenerate={(customTopic) => {
                    setShowTopicDialog(false)
                    handleGenerate(customTopic)
                }}
                seriesNiche={series.niche}
                disabled={triggeringGeneration}
            />
        </div>
    )
}

function GenerateTopicDialog({
    open,
    onClose,
    onGenerate,
    seriesNiche,
    disabled,
}: {
    open: boolean
    onClose: () => void
    onGenerate: (customTopic?: string) => void
    seriesNiche: string
    disabled: boolean
}) {
    const [mode, setMode] = useState<'choose' | 'custom'>('choose')
    const [customTopic, setCustomTopic] = useState('')

    // Reset state when dialog opens
    useEffect(() => {
        if (open) {
            setMode('choose')
            setCustomTopic('')
        }
    }, [open])

    return (
        <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 animate-in fade-in duration-200" />
                <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md z-50 outline-none animate-in fade-in zoom-in-95 duration-200">
                    <div className="bg-white rounded-2xl shadow-2xl border border-border/40 overflow-hidden">
                        {/* Header */}
                        <div className="px-6 pt-6 pb-4">
                            <div className="flex items-center gap-3 mb-1">
                                <div className="w-10 h-10 rounded-xl bg-linear-to-br from-primary/15 to-accent/15 flex items-center justify-center">
                                    <Sparkles className="w-5 h-5 text-primary" />
                                </div>
                                <div>
                                    <Dialog.Title className="text-lg font-bold text-foreground">
                                        Generate New Video
                                    </Dialog.Title>
                                    <Dialog.Description className="text-xs text-muted-foreground">
                                        Choose how to pick the topic for your next video
                                    </Dialog.Description>
                                </div>
                            </div>
                        </div>

                        {/* Options */}
                        <div className="px-6 pb-6 space-y-3">
                            {mode === 'choose' ? (
                                <>
                                    {/* Option 1: AI Random */}
                                    <button
                                        onClick={() => onGenerate()}
                                        disabled={disabled}
                                        className="w-full group flex items-start gap-4 p-4 rounded-xl border-2 border-border/50 hover:border-primary/40 bg-linear-to-br from-violet-50/50 to-purple-50/50 hover:from-violet-50 hover:to-purple-50 transition-all duration-200 text-left cursor-pointer disabled:opacity-60"
                                    >
                                        <div className="w-11 h-11 rounded-xl bg-linear-to-br from-violet-500 to-purple-600 flex items-center justify-center shrink-0 shadow-md shadow-violet-500/20 group-hover:scale-105 transition-transform">
                                            <Wand2 className="w-5 h-5 text-white" />
                                        </div>
                                        <div>
                                            <span className="font-semibold text-sm text-foreground block">Let AI Choose</span>
                                            <span className="text-xs text-muted-foreground leading-relaxed">
                                                AI picks a unique, viral-worthy angle from your &ldquo;{seriesNiche}&rdquo; niche
                                            </span>
                                        </div>
                                    </button>

                                    {/* Option 2: Custom Topic */}
                                    <button
                                        onClick={() => setMode('custom')}
                                        disabled={disabled}
                                        className="w-full group flex items-start gap-4 p-4 rounded-xl border-2 border-border/50 hover:border-primary/40 bg-linear-to-br from-blue-50/50 to-cyan-50/50 hover:from-blue-50 hover:to-cyan-50 transition-all duration-200 text-left cursor-pointer disabled:opacity-60"
                                    >
                                        <div className="w-11 h-11 rounded-xl bg-linear-to-br from-blue-500 to-cyan-600 flex items-center justify-center shrink-0 shadow-md shadow-blue-500/20 group-hover:scale-105 transition-transform">
                                            <MessageSquarePlus className="w-5 h-5 text-white" />
                                        </div>
                                        <div>
                                            <span className="font-semibold text-sm text-foreground block">Choose My Own Topic</span>
                                            <span className="text-xs text-muted-foreground leading-relaxed">
                                                Type a specific topic you want the video to be about
                                            </span>
                                        </div>
                                    </button>
                                </>
                            ) : (
                                /* Custom Topic Input */
                                <motion.div
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ duration: 0.2 }}
                                    className="space-y-3"
                                >
                                    <div>
                                        <label className="text-sm font-medium text-foreground mb-1.5 block">
                                            What should this video be about?
                                        </label>
                                        <textarea
                                            value={customTopic}
                                            onChange={(e) => setCustomTopic(e.target.value)}
                                            placeholder={`e.g. "Top 5 myths about ${seriesNiche}" or "How ${seriesNiche} will change in 2025"`}
                                            className="w-full px-4 py-3 rounded-xl border border-border/60 bg-muted/30 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-all resize-none"
                                            rows={3}
                                            autoFocus
                                        />
                                    </div>

                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => setMode('choose')}
                                            className="flex-1 h-11 rounded-xl border border-border/60 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-all cursor-pointer"
                                        >
                                            ← Back
                                        </button>
                                        <button
                                            onClick={() => {
                                                if (customTopic.trim()) {
                                                    onGenerate(customTopic.trim())
                                                }
                                            }}
                                            disabled={disabled || !customTopic.trim()}
                                            className="flex-1 h-11 rounded-xl bg-linear-to-r from-primary to-accent text-white text-sm font-semibold shadow-lg shadow-primary/20 hover:shadow-xl hover:scale-[1.02] transition-all disabled:opacity-60 disabled:hover:scale-100 cursor-pointer flex items-center justify-center gap-2"
                                        >
                                            <Sparkles className="w-4 h-4" />
                                            Generate
                                        </button>
                                    </div>
                                </motion.div>
                            )}
                        </div>
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    )
}

function VideoPlayerDialog({ video, series, onClose }: { video: VideoAsset | null, series: SeriesData | null, onClose: () => void }) {
    const [hasStartedPlaying, setHasStartedPlaying] = useState(false);
    const [videoUrl, setVideoUrl] = useState<string | null>(null);
    const [isRendering, setIsRendering] = useState(false);
    const bgMusicRef = useRef<HTMLAudioElement | null>(null);

    // Resolve background music URL from series
    const musicUrl = series?.music ? getMusicUrl(series.music) : '';

    // Initialize local state when video changes
    useEffect(() => {
        if (video) {
            setVideoUrl(video.videoUrl || null);
            setIsRendering(video.status === 'rendering');
            setHasStartedPlaying(false);
        }
    }, [video?.videoId, video?.videoUrl, video?.status]);

    // Polling for rendering status
    useEffect(() => {
        let interval: NodeJS.Timeout;
        if (isRendering && video?.videoId) {
            interval = setInterval(async () => {
                try {
                    const res = await fetch(`/api/video/status?videoId=${video.videoId}`);
                    const data = await res.json();
                    if (data.success && data.video.status === 'completed' && data.video.videoUrl) {
                        setVideoUrl(data.video.videoUrl);
                        setIsRendering(false);
                        toast.success('MP4 Render Complete!');
                        window.dispatchEvent(new CustomEvent('video-rendered', { detail: { videoId: video.videoId } }));
                    } else if (data.success && data.video.status === 'failed') {
                        setIsRendering(false);
                        toast.error('MP4 Render Failed.');
                    }
                } catch (err) {
                    console.error('Polling error:', err);
                }
            }, 3000);
        }
        return () => clearInterval(interval);
    }, [isRendering, video?.videoId]);

    if (!video) return null;

    const handleDownload = () => {
        if (!videoUrl) return;
        window.open(videoUrl, '_blank');
    };

    // Sync background music with video play/pause
    const handleVideoPlay = () => {
        setHasStartedPlaying(true);
        console.log('🎵 handleVideoPlay called — musicUrl:', musicUrl, '| bgMusicRef:', bgMusicRef.current);
        if (bgMusicRef.current) {
            console.log('🎵 Attempting to play background music at volume:', bgMusicRef.current.volume);
            bgMusicRef.current.play().then(() => {
                console.log('✅ Background music started playing!');
            }).catch((err) => {
                console.error('❌ Background music play failed:', err);
            });
        } else {
            console.warn('⚠️ bgMusicRef.current is null — no audio element found');
        }
    };

    const handleVideoPause = () => {
        if (bgMusicRef.current) {
            bgMusicRef.current.pause();
        }
    };

    const handleClose = () => {
        if (bgMusicRef.current) {
            bgMusicRef.current.pause();
            bgMusicRef.current.currentTime = 0;
        }
        onClose();
    };

    return (
        <Dialog.Root open={!!video} onOpenChange={(open) => !open && handleClose()}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 animate-in fade-in duration-300" />
                <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-[340px] z-50 outline-none">
                    <div className="relative w-full aspect-9/16 rounded-3xl overflow-hidden shadow-2xl border border-white/10 bg-black">

                        {/* Hidden background music audio element */}
                        {musicUrl && (
                            <audio
                                ref={(el) => {
                                    bgMusicRef.current = el;
                                    if (el) el.volume = 0.12;
                                }}
                                src={musicUrl}
                                loop
                                preload="auto"
                                style={{ display: 'none' }}
                            />
                        )}

                        {/* Player / Video Tag */}
                        {videoUrl ? (
                            <video
                                src={videoUrl}
                                className="w-full h-full object-contain"
                                controls
                                autoPlay
                                loop
                                onPlay={handleVideoPlay}
                                onPause={handleVideoPause}
                                onEnded={handleVideoPause}
                            />
                        ) : (
                            <Player
                                component={MainComposition as any}
                                durationInFrames={Math.floor((video.audioDuration || 60) * 30)}
                                compositionWidth={720}
                                compositionHeight={1280}
                                fps={30}
                                controls
                                autoPlay
                                loop
                                style={{
                                    width: '100%',
                                    height: '100%',
                                }}
                                inputProps={{
                                    imageUrls: video.imageUrls || [],
                                    avatarClipData: (video.avatarClipUrls || []).map((url: string) => url ? { url, motionDuration: undefined } : null),
                                    audioUrl: video.audioUrl || '',
                                    musicUrl: musicUrl,
                                    captionData: video.captionData || { segments: [] },
                                    captionStyle: series?.captionStyle || 'bold-pop',
                                    language: series?.language || 'en-IN',
                                    durationInFrames: Math.floor((video.audioDuration || 60) * 30),
                                }}
                            />
                        )}

                        {/* Close button */}
                        <button
                            onClick={handleClose}
                            className="absolute top-4 right-4 w-10 h-10 rounded-full bg-black/40 hover:bg-black/60 backdrop-blur-md text-white flex items-center justify-center transition-all border border-white/10 z-10 cursor-pointer"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>

                    {/* Actions */}
                    <div className="mt-4 flex gap-3">
                        {videoUrl && hasStartedPlaying ? (
                            <motion.button
                                initial={{ opacity: 0, scale: 0.9 }}
                                animate={{ opacity: 1, scale: 1 }}
                                onClick={handleDownload}
                                className="flex-1 h-12 rounded-2xl bg-white text-black font-bold flex items-center justify-center gap-2 hover:bg-white/90 transition-all cursor-pointer shadow-lg"
                            >
                                <Download className="w-5 h-5" />
                                Download MP4
                            </motion.button>
                        ) : isRendering ? (
                            <div className="flex-1 h-12 rounded-2xl bg-white/10 text-white/50 font-medium flex items-center justify-center gap-2 border border-white/5">
                                <Loader2 className="w-4 h-4 animate-spin" />
                                Rendering MP4...
                            </div>
                        ) : null}
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

function SeriesVideosPage() {
    return (
        <Suspense fallback={
            <div className="max-w-6xl mx-auto px-4 pt-0 pb-6 -mt-6">
                <div className="flex items-center gap-3 mb-8">
                    <div className="h-9 w-9 rounded-xl bg-muted/60 animate-pulse" />
                    <div className="h-6 bg-muted/60 rounded-lg w-48 animate-pulse" />
                </div>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
                    {[1, 2, 3].map(i => (
                        <div key={i} className="rounded-2xl border border-border/40 bg-white/60 overflow-hidden animate-pulse">
                            <div className="h-44 bg-muted/60" />
                            <div className="p-4 space-y-3">
                                <div className="h-4 bg-muted/60 rounded-lg w-3/4" />
                                <div className="h-3 bg-muted/40 rounded-lg w-1/2" />
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        }>
            <SeriesVideosPageContent />
        </Suspense>
    )
}

export default SeriesVideosPage
