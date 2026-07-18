"use client"
import { useUser } from '@clerk/nextjs'
import { motion } from 'framer-motion'
import {
    ArrowRight,
    AlertTriangle,
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
import MorphingText from './_components/MorphingText'
import EmptyShortsState from './_components/EmptyShortsState'
import DrawOutlineButton from '@/components/ui/DrawOutlineButton'

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
    // GitHub-style delete confirmation: the series pending deletion + the text
    // the user has typed to confirm (must exactly match the series title).
    const [confirmDelete, setConfirmDelete] = useState<ShortSeries | null>(null)
    const [confirmText, setConfirmText] = useState('')
    const [generatingThumbnail, setGeneratingThumbnail] = useState<string | null>(null)
    const [generatingVideo, setGeneratingVideo] = useState<string | null>(null)
    const attemptedThumbnails = useRef<Set<string>>(new Set())

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

    // Manual thumbnail regeneration — calls API synchronously (Imagen 4 responds in ~5-10s)
    const handleRegenThumbnail = async (s: ShortSeries) => {
        setGeneratingThumbnail(s.seriesId)
        toast.info('Generating thumbnail with Imagen 4…', { duration: 6000 })
        try {
            // Single call — API generates + saves + returns URL directly
            const res = await fetch('/api/short-series/generate-thumbnail', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ seriesId: s.seriesId, title: s.title, niche: s.niche }),
            })
            const data = await res.json()
            if (!res.ok || !data.success) {
                throw new Error(data?.error || `HTTP ${res.status}`)
            }
            const url: string = data.thumbnailUrl
            setSeries(prev => prev.map(item =>
                item.seriesId === s.seriesId
                    ? { ...item, thumbnailUrl: url }
                    : item
            ))
            toast.success('Thumbnail generated!')
        } catch (err: any) {
            toast.error(`Thumbnail generation failed: ${err?.message ?? 'Unknown error'}`)
        }
        setGeneratingThumbnail(null)
    }



    // Close popover on outside click. Use a data-attribute check (not a
    // conditional ref) so it's immune to ref-timing: a click anywhere inside
    // ANY popover root (trigger + menu) never closes prematurely.
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            const target = e.target as Element | null
            if (target && target.closest('[data-series-popover]')) return
            setOpenPopover(null)
        }
        document.addEventListener('mousedown', handler)
        return () => document.removeEventListener('mousedown', handler)
    }, [])

    // Pause/Resume
    const handleToggleStatus = async (s: ShortSeries) => {
        const newStatus = s.status === 'paused' ? 'active' : 'paused'
        setOpenPopover(null)
        try {
            const res = await fetch(`/api/short-series/${s.seriesId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: newStatus }),
            })
            const data = await res.json().catch(() => ({}))
            if (res.ok && data.success) {
                setSeries(prev => prev.map(item =>
                    item.seriesId === s.seriesId ? { ...item, status: newStatus } : item
                ))
                toast.success(newStatus === 'paused' ? 'Series paused' : 'Series resumed')
            } else {
                toast.error(data?.error || `Failed to update status (HTTP ${res.status})`)
            }
        } catch (err: any) {
            toast.error(`Failed to update status: ${err?.message ?? 'network error'}`)
        }
    }

    // Delete
    const handleDelete = async (seriesId: string) => {
        setDeletingId(seriesId)
        try {
            const res = await fetch(`/api/short-series/${seriesId}`, { method: 'DELETE' })
            const data = await res.json().catch(() => ({}))
            if (res.ok && data.success) {
                setSeries(prev => prev.filter(item => item.seriesId !== seriesId))
                toast.success('Series deleted')
                setConfirmDelete(null)
                setConfirmText('')
            } else {
                toast.error(data?.error || `Failed to delete series (HTTP ${res.status})`)
            }
        } catch (err: any) {
            toast.error(`Failed to delete series: ${err?.message ?? 'network error'}`)
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

                <h1 
                  className="text-4xl md:text-5xl text-center text-foreground"
                  style={{
                    fontFamily: "'Instrument Serif', serif",
                    fontStyle: 'italic',
                    fontWeight: 700,
                    letterSpacing: '-0.3px',
                    lineHeight: '1.25',
                    minHeight: '60px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                    <MorphingText
                      texts={[
                        ["Your", "Short Series"],
                        ["Create", "Viral Content"],
                        ["Engage", "Your Audience"],
                        ["Describe It,", "Ship It"]
                      ]}
                      holdDelay={3000}
                    />
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
                <DrawOutlineButton
                    href="/short-generator/create"
                    fullWidth={false}
                    className="text-sm font-semibold border border-primary/30"
                >
                    <Plus className="w-4 h-4" />
                    Create New
                </DrawOutlineButton>
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
                        <EmptyShortsState />
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
                                            <div className="relative" data-series-popover>
                                                <button
                                                    onClick={() => setOpenPopover(openPopover === s.seriesId ? null : s.seriesId)}
                                                    className="shrink-0 w-7 h-7 rounded-lg hover:bg-muted/60 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                                                >
                                                    <MoreVertical className="w-4 h-4" />
                                                </button>

                                                {/* Popover */}
                                                {openPopover === s.seriesId && (
                                                    <div className="absolute right-0 top-8 z-50 w-40 bg-white rounded-xl border border-border/60 shadow-xl shadow-black/10 py-1.5 animate-fade-in-up">
                                                        <Link
                                                            href={`/short-generator/create?edit=${s.seriesId}`}
                                                            onClick={() => setOpenPopover(null)}
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
                                                            onClick={() => { setOpenPopover(null); setConfirmText(''); setConfirmDelete(s); }}
                                                            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-destructive hover:bg-destructive/5 transition-colors cursor-pointer disabled:opacity-50"
                                                        >
                                                            <Trash2 className="w-3.5 h-3.5" />
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

            {/* ── Delete confirmation modal (GitHub-style: type the name to confirm) ── */}
            {confirmDelete && (
                <div
                    className="fixed inset-0 z-[100] flex items-center justify-center p-4"
                    onMouseDown={() => { if (deletingId !== confirmDelete.seriesId) { setConfirmDelete(null); setConfirmText('') } }}
                >
                    {/* Backdrop */}
                    <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

                    {/* Card */}
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 10 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
                        onMouseDown={(e) => e.stopPropagation()}
                        className="relative w-full max-w-md bg-white rounded-2xl border border-border/60 shadow-2xl shadow-black/20 overflow-hidden"
                    >
                        {/* Header */}
                        <div className="flex items-start gap-4 p-6 pb-4">
                            <div className="shrink-0 w-11 h-11 rounded-xl bg-destructive/10 flex items-center justify-center">
                                <AlertTriangle className="w-5 h-5 text-destructive" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <h2 className="text-lg font-semibold text-foreground">Delete series</h2>
                                <p className="text-sm text-muted-foreground mt-1">
                                    This action is <span className="font-semibold text-foreground">permanent</span> and cannot be undone. All generated videos, assets, and progress for this series will be deleted.
                                </p>
                            </div>
                        </div>

                        {/* Confirm input */}
                        <div className="px-6 pb-2">
                            <label className="block text-sm text-muted-foreground mb-2">
                                To confirm, type <span className="font-semibold text-foreground break-all">{confirmDelete.title}</span> below:
                            </label>
                            <input
                                autoFocus
                                type="text"
                                value={confirmText}
                                onChange={(e) => setConfirmText(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && confirmText.trim() === confirmDelete.title.trim() && deletingId !== confirmDelete.seriesId) {
                                        handleDelete(confirmDelete.seriesId)
                                    }
                                    if (e.key === 'Escape') { setConfirmDelete(null); setConfirmText('') }
                                }}
                                placeholder={confirmDelete.title}
                                className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-muted/30 text-sm text-foreground outline-none focus:border-destructive/60 focus:ring-2 focus:ring-destructive/15 transition-all"
                            />
                        </div>

                        {/* Footer */}
                        <div className="flex items-center justify-end gap-2.5 p-6 pt-4">
                            <button
                                onClick={() => { setConfirmDelete(null); setConfirmText('') }}
                                disabled={deletingId === confirmDelete.seriesId}
                                className="px-4 py-2 rounded-xl text-sm font-medium border border-border text-foreground hover:bg-muted/50 transition-colors cursor-pointer disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={() => handleDelete(confirmDelete.seriesId)}
                                disabled={confirmText.trim() !== confirmDelete.title.trim() || deletingId === confirmDelete.seriesId}
                                className="px-4 py-2 rounded-xl text-sm font-semibold bg-destructive text-white shadow-sm hover:bg-destructive/90 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
                            >
                                {deletingId === confirmDelete.seriesId ? (
                                    <>
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        Deleting…
                                    </>
                                ) : (
                                    <>
                                        <Trash2 className="w-4 h-4" />
                                        Delete this series
                                    </>
                                )}
                            </button>
                        </div>
                    </motion.div>
                </div>
            )}
        </div>
    )
}

export default ShortGeneratorPage
