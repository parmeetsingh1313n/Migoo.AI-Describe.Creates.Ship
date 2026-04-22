"use client"
import { useUser } from '@clerk/nextjs'
import { motion } from 'framer-motion'
import {
    ArrowRight,
    Calendar,
    Clapperboard,
    Edit3,
    Eye,
    ImageIcon,
    Loader2,
    MoreVertical,
    Pause,
    Play,
    Plus,
    RefreshCw,
    Sparkles,
    Trash2,
    Video,
    Zap,
} from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

interface ShortSeries {
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

type TabMode = 'new' | 'courses'

function ShortGeneratorPage() {
    const { user } = useUser()
    const router = useRouter()
    const [activeTab, setActiveTab] = useState<TabMode>('new')
    const [series, setSeries] = useState<ShortSeries[]>([])
    const [loading, setLoading] = useState(true)
    const [openPopover, setOpenPopover] = useState<string | null>(null)
    const [deletingId, setDeletingId] = useState<string | null>(null)
    const [generatingThumbnail, setGeneratingThumbnail] = useState<string | null>(null)
    const [generatingVideo, setGeneratingVideo] = useState<string | null>(null)
    const attemptedThumbnails = useRef<Set<string>>(new Set())
    const popoverRef = useRef<HTMLDivElement>(null)

    const userId = user?.primaryEmailAddress?.emailAddress

    // Fetch series
    const fetchSeries = useCallback(async () => {
        if (!userId) return
        try {
            const res = await fetch(`/api/short-series?userId=${encodeURIComponent(userId)}`)
            const data = await res.json()
            if (data.success) {
                setSeries(data.series)
            }
        } catch (err) {
            console.error('Failed to fetch series:', err)
        } finally {
            setLoading(false)
        }
    }, [userId])

    useEffect(() => {
        fetchSeries()
    }, [fetchSeries])

    // Manual thumbnail regeneration
    const handleRegenThumbnail = async (s: ShortSeries) => {
        setGeneratingThumbnail(s.seriesId)
        try {
            const res = await fetch('/api/short-series/generate-thumbnail', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ seriesId: s.seriesId, title: s.title, niche: s.niche }),
            })
            const data = await res.json()
            if (data.success && data.thumbnailUrl) {
                setSeries(prev => prev.map(item =>
                    item.seriesId === s.seriesId
                        ? { ...item, thumbnailUrl: data.thumbnailUrl }
                        : item
                ))
                toast.success('Thumbnail generated!')
            } else {
                toast.error('Thumbnail generation failed')
            }
        } catch {
            toast.error('Thumbnail generation failed')
        }
        setGeneratingThumbnail(null)
    }

    // Close popover on outside click
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
                setOpenPopover(null)
            }
        }
        document.addEventListener('mousedown', handler)
        return () => document.removeEventListener('mousedown', handler)
    }, [])

    // Pause/Resume
    const handleToggleStatus = async (s: ShortSeries) => {
        const newStatus = s.status === 'paused' ? 'active' : 'paused'
        try {
            const res = await fetch(`/api/short-series/${s.seriesId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: newStatus }),
            })
            const data = await res.json()
            if (data.success) {
                setSeries(prev => prev.map(item =>
                    item.seriesId === s.seriesId ? { ...item, status: newStatus } : item
                ))
                toast.success(newStatus === 'paused' ? 'Series paused' : 'Series resumed')
            }
        } catch {
            toast.error('Failed to update status')
        }
        setOpenPopover(null)
    }

    // Delete
    const handleDelete = async (seriesId: string) => {
        setDeletingId(seriesId)
        try {
            const res = await fetch(`/api/short-series/${seriesId}`, { method: 'DELETE' })
            const data = await res.json()
            if (data.success) {
                setSeries(prev => prev.filter(item => item.seriesId !== seriesId))
                toast.success('Series deleted')
            }
        } catch {
            toast.error('Failed to delete series')
        }
        setDeletingId(null)
        setOpenPopover(null)
    }

    // Generate videos — trigger Inngest function
    const handleGenerate = async (s: ShortSeries) => {
        setGeneratingVideo(s.seriesId)
        try {
            const res = await fetch('/api/short-series/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ seriesId: s.seriesId }),
            })
            const data = await res.json()
            if (data.success) {
                toast.success(`Video generation started for "${s.title}"`)
            } else {
                toast.error(data.error || 'Failed to start generation')
            }
        } catch {
            toast.error('Failed to start video generation')
        }
        setGeneratingVideo(null)
    }

    const formatDate = (date: string) => {
        return new Date(date).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
        })
    }

    return (
        <div className="max-w-6xl mx-auto px-4 pt-0 pb-6 -mt-6">
            {/* Header */}
            <motion.div
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
                className="text-center mb-8"
            >
                <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-gradient-to-r from-primary/10 to-accent/10 border border-primary/10 mb-4">
                    <Zap className="w-4 h-4 text-primary" />
                    <span className="text-sm font-medium text-primary">AI Short Video Generator</span>
                </div>
                <h1 className="text-3xl md:text-4xl font-bold">
                    Your <span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">Short Series</span>
                </h1>
            </motion.div>

            {/* Toggle + Create Button Bar */}
            <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="flex items-center justify-between mb-8"
            >
                {/* Toggle */}
                <div className="flex items-center bg-muted/60 rounded-xl p-1 border border-border/40">
                    <button
                        onClick={() => setActiveTab('new')}
                        className={`
                            flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 cursor-pointer
                            ${activeTab === 'new'
                                ? 'bg-white shadow-sm text-foreground border border-border/50'
                                : 'text-muted-foreground hover:text-foreground'
                            }
                        `}
                    >
                        <Clapperboard className="w-4 h-4" />
                        New Series
                    </button>
                    <button
                        onClick={() => setActiveTab('courses')}
                        className={`
                            flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 cursor-pointer relative
                            ${activeTab === 'courses'
                                ? 'bg-white shadow-sm text-foreground border border-border/50'
                                : 'text-muted-foreground hover:text-foreground'
                            }
                        `}
                    >
                        <Video className="w-4 h-4" />
                        From Courses
                        <span className="text-[9px] font-bold uppercase tracking-wider bg-gradient-to-r from-secondary/20 to-secondary/10 text-secondary px-1.5 py-0.5 rounded-full border border-secondary/20">
                            Soon
                        </span>
                    </button>
                </div>

                {/* Create New Button */}
                <Link
                    href="/short-generator/create"
                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold bg-gradient-to-r from-primary to-accent text-white shadow-lg shadow-primary/20 hover:shadow-xl hover:shadow-primary/30 hover:scale-[1.02] transition-all duration-200"
                >
                    <Plus className="w-4 h-4" />
                    Create New
                </Link>
            </motion.div>

            {/* Content — New Series Tab */}
            {activeTab === 'new' && (
                <>
                    {/* Director's Chair CTA */}
                    <motion.div
                        initial={{ opacity: 0, scale: 0.98, y: 10 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        transition={{ delay: 0.15, duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
                        className="mb-8"
                    >
                        <Link href="/studio/create" className="group block relative">
                            <div className="absolute inset-0 bg-gradient-to-r from-primary/15 to-accent/15 rounded-2xl blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                            <div className="relative rounded-2xl border border-primary/20 bg-white/80 backdrop-blur-md p-6 shadow-[0_2px_15px_-3px_rgba(0,0,0,0.05)] hover:border-primary/40 hover:shadow-[0_10px_40px_-5px_rgba(0,0,0,0.1)] hover:-translate-y-1 transition-all duration-300 overflow-hidden">
                                <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />
                                <div className="relative flex items-center gap-5">
                                    <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary to-accent flex items-center justify-center shrink-0 shadow-lg shadow-primary/20 group-hover:scale-110 group-hover:rotate-3 transition-transform duration-300">
                                        <Clapperboard className="w-7 h-7 text-white" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-1.5">
                                            <span className="text-[10px] bg-primary/10 text-primary border border-primary/20 px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wider">
                                                ⭐ Migoo Studio
                                            </span>
                                        </div>
                                        <h3 className="font-bold text-base text-foreground mb-1 group-hover:text-primary transition-colors">
                                            Full Creative Studio
                                        </h3>
                                        <p className="text-[13px] text-muted-foreground leading-relaxed">
                                            Upload PDFs <span className="mx-1.5 text-border">•</span> Inject your own footage <span className="mx-1.5 text-border">•</span> Edit every scene <span className="mx-1.5 text-border">•</span> Human-touched content that survives demonetization
                                        </p>
                                    </div>
                                    <div className="w-10 h-10 rounded-full bg-primary/5 flex items-center justify-center text-primary opacity-70 group-hover:opacity-100 group-hover:bg-primary group-hover:text-white group-hover:translate-x-1 transition-all duration-300 shrink-0">
                                        <ArrowRight className="w-5 h-5 transition-transform" />
                                    </div>
                                </div>
                            </div>
                        </Link>
                    </motion.div>

                    {/* Loading Skeletons */}
                    {loading && (
                        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
                            {[1, 2, 3].map(i => (
                                <div key={i} className="rounded-2xl border border-border/40 bg-white/60 overflow-hidden animate-pulse">
                                    <div className="h-44 bg-muted/60" />
                                    <div className="p-4 space-y-3">
                                        <div className="h-4 bg-muted/60 rounded-lg w-3/4" />
                                        <div className="h-3 bg-muted/40 rounded-lg w-1/2" />
                                        <div className="flex gap-2 pt-2">
                                            <div className="h-8 bg-muted/40 rounded-lg flex-1" />
                                            <div className="h-8 bg-muted/40 rounded-lg flex-1" />
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Empty State */}
                    {!loading && series.length === 0 && (
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            className="text-center py-16"
                        >
                            <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-primary/10 to-accent/10 flex items-center justify-center mx-auto mb-5">
                                <Clapperboard className="w-10 h-10 text-primary/50" />
                            </div>
                            <h3 className="text-xl font-bold mb-2">No series yet</h3>
                            <p className="text-muted-foreground text-sm mb-6 max-w-sm mx-auto">
                                Create your first AI-generated short video series and start producing viral content
                            </p>
                            <Link
                                href="/short-generator/create"
                                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold bg-gradient-to-r from-primary to-accent text-white shadow-lg shadow-primary/20 hover:shadow-xl hover:scale-[1.02] transition-all"
                            >
                                <Plus className="w-4 h-4" />
                                Create Your First Series
                            </Link>
                        </motion.div>
                    )}

                    {/* Series Grid */}
                    {!loading && series.length > 0 && (
                        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
                            {series.map((s, index) => (
                                <motion.div
                                    key={s.seriesId}
                                    initial={{ opacity: 0, y: 20 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: index * 0.05, duration: 0.4 }}
                                    className="group relative rounded-2xl border border-border/40 bg-white/70 backdrop-blur-sm hover:shadow-xl hover:shadow-primary/5 hover:border-primary/20 transition-all duration-300"
                                >
                                    {/* Thumbnail */}
                                    <div className="relative h-44 bg-gradient-to-br from-primary/20 via-accent/10 to-secondary/20 overflow-hidden rounded-t-2xl">
                                        {s.thumbnailUrl ? (
                                            <Image
                                                src={s.thumbnailUrl}
                                                alt={s.title}
                                                fill
                                                className="object-cover group-hover:scale-105 transition-transform duration-500"
                                            />
                                        ) : (
                                            <div className="flex flex-col items-center justify-center h-full gap-2">
                                                {generatingThumbnail === s.seriesId ? (
                                                    <Loader2 className="w-6 h-6 text-primary/40 animate-spin" />
                                                ) : (
                                                    <>
                                                        <ImageIcon className="w-8 h-8 text-primary/30" />
                                                        <button
                                                            onClick={() => handleRegenThumbnail(s)}
                                                            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/60 backdrop-blur-sm text-xs font-medium text-primary hover:bg-white/80 transition-colors cursor-pointer"
                                                        >
                                                            <RefreshCw className="w-3 h-3" />
                                                            Generate Thumbnail
                                                        </button>
                                                    </>
                                                )}
                                            </div>
                                        )}

                                        {/* Status badge */}
                                        {s.status === 'paused' && (
                                            <div className="absolute top-3 left-3 flex items-center gap-1 px-2 py-1 rounded-full bg-yellow-500/90 text-white text-[10px] font-bold uppercase tracking-wide">
                                                <Pause className="w-3 h-3" />
                                                Paused
                                            </div>
                                        )}

                                        {/* Edit icon on thumbnail */}
                                        <Link
                                            href={`/short-generator/create?edit=${s.seriesId}`}
                                            className="absolute top-3 right-3 w-8 h-8 rounded-lg bg-black/40 backdrop-blur-sm flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity duration-200 hover:bg-black/60"
                                        >
                                            <Edit3 className="w-4 h-4" />
                                        </Link>
                                    </div>

                                    {/* Info */}
                                    <div className="p-4">
                                        <div className="flex items-start justify-between gap-2 mb-2">
                                            <h3 className="font-semibold text-sm line-clamp-2 leading-snug">
                                                {s.title}
                                            </h3>

                                            {/* Popover trigger */}
                                            <div className="relative" ref={openPopover === s.seriesId ? popoverRef : null}>
                                                <button
                                                    onClick={() => setOpenPopover(openPopover === s.seriesId ? null : s.seriesId)}
                                                    className="shrink-0 w-7 h-7 rounded-lg hover:bg-muted/60 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                                                >
                                                    <MoreVertical className="w-4 h-4" />
                                                </button>

                                                {/* Popover */}
                                                {openPopover === s.seriesId && (
                                                    <div className="absolute right-0 top-8 z-20 w-40 bg-white rounded-xl border border-border/60 shadow-xl shadow-black/10 py-1.5 animate-fade-in-up">
                                                        <Link
                                                            href={`/short-generator/create?edit=${s.seriesId}`}
                                                            className="flex items-center gap-2.5 px-3 py-2 text-sm text-foreground hover:bg-muted/50 transition-colors"
                                                        >
                                                            <Edit3 className="w-3.5 h-3.5" />
                                                            Edit
                                                        </Link>
                                                        <button
                                                            onClick={() => handleToggleStatus(s)}
                                                            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-foreground hover:bg-muted/50 transition-colors cursor-pointer"
                                                        >
                                                            {s.status === 'paused' ? (
                                                                <>
                                                                    <Play className="w-3.5 h-3.5" />
                                                                    Resume
                                                                </>
                                                            ) : (
                                                                <>
                                                                    <Pause className="w-3.5 h-3.5" />
                                                                    Pause
                                                                </>
                                                            )}
                                                        </button>
                                                        <div className="h-px bg-border/40 my-1" />
                                                        <button
                                                            onClick={() => handleDelete(s.seriesId)}
                                                            disabled={deletingId === s.seriesId}
                                                            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-destructive hover:bg-destructive/5 transition-colors cursor-pointer disabled:opacity-50"
                                                        >
                                                            {deletingId === s.seriesId ? (
                                                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                                            ) : (
                                                                <Trash2 className="w-3.5 h-3.5" />
                                                            )}
                                                            Delete
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        {/* Date */}
                                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-4">
                                            <Calendar className="w-3 h-3" />
                                            {formatDate(s.createdAt)}
                                        </div>

                                        {/* Action buttons */}
                                        <div className="flex items-center gap-2">
                                            <Link
                                                href={`/short-generator/${s.seriesId}`}
                                                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-border/50 text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-all cursor-pointer"
                                            >
                                                <Eye className="w-3.5 h-3.5" />
                                                View Videos
                                            </Link>
                                            <Link
                                                href={`/short-generator/${s.seriesId}?generate=true`}
                                                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-gradient-to-r from-primary/90 to-accent/90 text-white shadow-sm hover:shadow-md hover:scale-[1.02] transition-all cursor-pointer"
                                            >
                                                <Sparkles className="w-3.5 h-3.5" />
                                                Generate
                                            </Link>
                                        </div>
                                    </div>
                                </motion.div>
                            ))}
                        </div>
                    )}
                </>
            )}

            {/* Content — From Courses Tab */}
            {activeTab === 'courses' && (
                <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="text-center py-16"
                >
                    <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-secondary/10 to-secondary/5 flex items-center justify-center mx-auto mb-5">
                        <Video className="w-10 h-10 text-secondary/50" />
                    </div>
                    <h3 className="text-xl font-bold mb-2">Coming Soon</h3>
                    <p className="text-muted-foreground text-sm max-w-md mx-auto">
                        Soon you&apos;ll be able to turn your generated video courses into bite-sized shorts — perfect as quick revision content for each chapter.
                    </p>
                </motion.div>
            )}
        </div>
    )
}

export default ShortGeneratorPage
