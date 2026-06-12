"use client"

import { useUser } from '@clerk/nextjs'
import {
    Clock,
    Maximize,
    Mic,
    MicOff,
    Music,
    Play,
    Ratio,
    Sparkles,
    Target,
    Video,
    Wand2,
    Zap,
    Megaphone,
    BarChart3,
    Smartphone,
    GraduationCap,
    Briefcase,
    Calendar,
    Loader2,
    Trash2,
    ArrowRight,
    ImagePlus,
    X,
    Upload,
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { MUSIC_URLS } from '@/lib/music-urls'
import RotatingText from './_components/RotatingText'
import EmptyMotionState from './_components/EmptyMotionState'
import CoreFeatures from './_components/CoreFeatures'

// ─── Types ───────────────────────────────────────────────────────────────────

interface MotionGraphicScene {
    type: string
    headline?: string
    subtext?: string
    imageUrl?: string
    colors?: { bg?: string; text?: string; accent?: string }
}

interface Project {
    id: number
    projectId: string
    prompt: string
    duration: number
    aspectRatio: string
    status: string
    thumbnailUrl: string | null
    videoUrl: string | null
    sceneData: MotionGraphicScene[] | null
    theme: { palette?: string } | null
    createdAt: string
}

// ─── Use Cases ───────────────────────────────────────────────────────────────

const USE_CASES = [
    { icon: Target,         title: 'Product Promos',  desc: 'Animate features with cinematic text & stats',   color: 'from-primary to-accent' },
    { icon: BarChart3,      title: 'Data Stories',    desc: 'Animated charts, counters & comparisons',        color: 'from-cyan-400 to-blue-400' },
    { icon: Smartphone,     title: 'Social Clips',    desc: 'Instagram Reels, TikTok & YouTube Shorts',       color: 'from-pink-400 to-rose-400' },
    { icon: GraduationCap,  title: 'Course Trailers', desc: 'Promote courses with animated previews',         color: 'from-emerald-400 to-green-400' },
    { icon: Briefcase,      title: 'Startup Pitches', desc: 'Animated pitch decks for investors',             color: 'from-amber-400 to-orange-400' },
    { icon: Calendar,       title: 'Event Promos',    desc: 'Conference & launch announcements',              color: 'from-secondary to-pink-400' },
]

const DURATION_OPTIONS = [
    { value: 15, label: '15s', desc: 'Quick hook' },
    { value: 30, label: '30s', desc: 'Standard' },
    { value: 60, label: '60s', desc: 'Detailed' },
]

const RATIO_OPTIONS = [
    { value: '16:9', label: '16:9', icon: <Maximize className="w-4 h-4" />, desc: 'Landscape' },
    { value: '9:16', label: '9:16', icon: <Smartphone className="w-4 h-4" />, desc: 'Portrait' },
    { value: '1:1', label: '1:1', icon: <Ratio className="w-4 h-4" />, desc: 'Square' },
]

const MUSIC_OPTIONS = Object.entries(MUSIC_URLS).map(([key]) => ({
    value: key,
    label: key.charAt(0).toUpperCase() + key.slice(1),
}))

export default function MotionGraphicsPage() {
    const { isSignedIn } = useUser()
    const router = useRouter()

    // Form state
    const [prompt, setPrompt] = useState('')
    const [duration, setDuration] = useState(30)
    const [aspectRatio, setAspectRatio] = useState('16:9')
    const [voiceoverEnabled, setVoiceoverEnabled] = useState(false)
    const [music, setMusic] = useState('cinematic')
    const [isCreating, setIsCreating] = useState(false)
    const [uploadedAssets, setUploadedAssets] = useState<Array<{ file: File; preview: string; name: string }>>([])
    const [uploadingAssets, setUploadingAssets] = useState(false)
    const assetInputRef = useRef<HTMLInputElement>(null)

    // Projects
    const [projects, setProjects] = useState<Project[]>([])
    const [loadingProjects, setLoadingProjects] = useState(true)

    const fetchProjects = useCallback(async () => {
        try {
            const res = await fetch('/api/motion-graphics')
            const data = await res.json()
            if (data.success) setProjects(data.projects || [])
        } catch {
            console.error('Failed to fetch projects')
        } finally {
            setLoadingProjects(false)
        }
    }, [])

    useEffect(() => {
        if (isSignedIn) fetchProjects()
    }, [isSignedIn, fetchProjects])

    const handleAssetSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || [])
        if (!files.length) return
        const newAssets = files.map(file => ({
            file,
            preview: URL.createObjectURL(file),
            name: file.name,
        }))
        setUploadedAssets(prev => [...prev, ...newAssets])
        if (assetInputRef.current) assetInputRef.current.value = ''
    }

    const removeAsset = (index: number) => {
        setUploadedAssets(prev => {
            const removed = prev[index]
            if (removed?.preview) URL.revokeObjectURL(removed.preview)
            return prev.filter((_, i) => i !== index)
        })
    }

    const handleCreate = async () => {
        if (!prompt.trim() || prompt.trim().length < 5) {
            toast.error('Please enter a prompt (at least 5 characters)')
            return
        }
        setIsCreating(true)
        try {
            // 1. Upload any assets first
            let assetContext = ''
            if (uploadedAssets.length > 0) {
                setUploadingAssets(true)
                const uploadResults: Array<{ url: string; name: string; description: string }> = []
                for (const asset of uploadedAssets) {
                    try {
                        const formData = new FormData()
                        formData.append('file', asset.file)
                        // We need the projectId to upload, but we create the project first.
                        // Instead, encode assets as base64 in sessionStorage and upload after redirect.
                    } catch {}
                }
                // We'll handle uploads AFTER project creation — store files temporarily
            }

            // 2. Create project with enhanced prompt
            const res = await fetch('/api/motion-graphics', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt: prompt.trim(), duration, aspectRatio, voiceoverEnabled, music }),
            })
            const data = await res.json()
            if (data.success && data.projectId) {
                // 3. Upload assets to the project
                if (uploadedAssets.length > 0) {
                    toast.info(`Uploading ${uploadedAssets.length} asset(s)...`)
                    const uploadedUrls: string[] = []
                    for (const asset of uploadedAssets) {
                        try {
                            const formData = new FormData()
                            formData.append('file', asset.file)
                            const uploadRes = await fetch(`/api/motion-graphics/${data.projectId}/upload`, { method: 'POST', body: formData })
                            const uploadData = await uploadRes.json()
                            if (uploadData.url) {
                                uploadedUrls.push(`[UPLOADED IMAGE: ${asset.name} — URL: ${uploadData.url} — DESCRIPTION: ${uploadData.description || 'Reference asset'}]`)
                            }
                        } catch {}
                    }
                    // Store upload context in sessionStorage so the project page can prepend it to the first message
                    if (uploadedUrls.length > 0) {
                        sessionStorage.setItem(`mg_assets_${data.projectId}`, JSON.stringify(uploadedUrls))
                    }
                }
                toast.success('Project created!')
                router.push(`/motion-graphics/${data.projectId}`)
            } else {
                toast.error(data.error || 'Failed to create project')
            }
        } catch {
            toast.error('Something went wrong')
        } finally {
            setIsCreating(false)
            setUploadingAssets(false)
        }
    }

    const handleDelete = async (projectId: string, e: React.MouseEvent) => {
        e.preventDefault()
        e.stopPropagation()
        if (!confirm('Delete this project?')) return
        try {
            await fetch(`/api/motion-graphics/${projectId}`, { method: 'DELETE' })
            setProjects(prev => prev.filter(p => p.projectId !== projectId))
            toast.success('Project deleted')
        } catch {
            toast.error('Failed to delete')
        }
    }

    const getStatusBadge = (status: string) => {
        if (status === 'completed') return { text: 'Ready', cls: 'bg-emerald-50 text-emerald-600 border-emerald-200' }
        if (status === 'failed') return { text: 'Failed', cls: 'bg-red-50 text-red-600 border-red-200' }
        if (status?.startsWith('generating')) return { text: 'Generating', cls: 'bg-amber-50 text-amber-600 border-amber-200' }
        return { text: 'Draft', cls: 'bg-blue-50 text-blue-600 border-blue-200' }
    }

    return (
        <div className="relative min-h-screen bg-muted/20 pb-20">
            <div className="relative z-10 max-w-5xl mx-auto px-6 pt-0 pb-16 -mt-4 md:-mt-6">

                {/* ─── Header ────────────────────────────────────────── */}
                <div className="text-center mb-10">
                    <h1 
                      className="text-4xl md:text-5xl text-center mb-4 flex items-center justify-center gap-x-2.5 flex-wrap text-foreground"
                      style={{
                        fontFamily: "'Instrument Serif', serif",
                        fontStyle: 'italic',
                        fontWeight: 700,
                        letterSpacing: '-0.3px',
                        lineHeight: '1.25',
                        minHeight: '60px'
                      }}
                    >
                        <RotatingText
                          texts={[
                            "Your Ideas,",
                            "Your Vision,",
                            "Your Brand,",
                            "Your Story,"
                          ]}
                          duration={2600}
                          className="text-foreground w-[180px] sm:w-[220px] md:w-[260px] justify-end"
                        />
                        <span className="text-primary border-b border-primary/30 shrink-0">
                            In Motion.
                        </span>
                    </h1>
                    <p className="text-muted-foreground max-w-lg mx-auto leading-relaxed">
                        Describe your vision, pick a theme, and let AI generate professional motion graphics
                        for promos, explainers, and social media content.
                    </p>
                </div>

                {/* ─── Creator Card ──────────────────────────────────── */}
                <div className="relative max-w-4xl mx-auto rounded-2xl border border-border/50 bg-white/70 backdrop-blur-sm p-7 md:p-8 shadow-[0_2px_10px_-3px_rgba(0,0,0,0.05)] hover:shadow-lg hover:shadow-black/5 transition-all duration-300 overflow-hidden">
                    {/* Subtle glow on hover */}
                    <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-primary/5 to-accent/5 opacity-0 hover:opacity-100 transition-opacity duration-500 pointer-events-none" />

                    <div className="relative z-10 space-y-6">
                        {/* Prompt */}
                        <div>
                            <label className="text-sm font-bold text-foreground mb-2 block">
                                Describe your motion graphic
                            </label>
                            <div className="relative">
                                <textarea
                                    id="motion-graphic-prompt"
                                    value={prompt}
                                    onChange={(e) => setPrompt(e.target.value)}
                                    placeholder="e.g. A product launch video for a fitness app showing key features like workout tracking, meal planning, and community challenges with energetic animations..."
                                    rows={3}
                                    className="w-full px-4 py-3 rounded-xl bg-muted/40 border border-border text-foreground placeholder:text-muted-foreground/50 focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-all resize-none text-[15px]"
                                />
                                <Sparkles className="absolute right-3 top-3 w-4 h-4 text-primary/30" />
                            </div>
                        </div>

                        {/* Upload Assets */}
                        <div>
                            <label className="text-sm font-bold text-foreground mb-2.5 flex items-center gap-2">
                                <Upload className="w-4 h-4 text-muted-foreground" /> Upload Assets
                                <span className="text-xs font-normal text-muted-foreground/70">(Logo, product shots, UI screenshots — optional)</span>
                            </label>
                            <input
                                ref={assetInputRef}
                                type="file"
                                accept="image/*"
                                multiple
                                className="hidden"
                                onChange={handleAssetSelect}
                            />
                            {uploadedAssets.length > 0 ? (
                                <div className="flex flex-wrap gap-3 mb-3">
                                    {uploadedAssets.map((asset, i) => (
                                        <div key={i} className="relative group">
                                            <div className="w-20 h-20 rounded-xl overflow-hidden border-2 border-border/50 shadow-sm hover:border-primary/30 transition-colors">
                                                <img src={asset.preview} alt={asset.name} className="w-full h-full object-cover" />
                                            </div>
                                            <button
                                                onClick={() => removeAsset(i)}
                                                className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer shadow-md hover:bg-red-600"
                                            >
                                                <X className="w-3 h-3" />
                                            </button>
                                            <p className="text-[10px] text-muted-foreground text-center mt-1 max-w-[80px] truncate">{asset.name}</p>
                                        </div>
                                    ))}
                                    <button
                                        onClick={() => assetInputRef.current?.click()}
                                        className="w-20 h-20 rounded-xl border-2 border-dashed border-border/50 flex flex-col items-center justify-center gap-1 text-muted-foreground hover:text-primary hover:border-primary/30 hover:bg-primary/5 transition-all cursor-pointer"
                                    >
                                        <ImagePlus className="w-5 h-5" />
                                        <span className="text-[10px] font-medium">Add more</span>
                                    </button>
                                </div>
                            ) : (
                                <button
                                    onClick={() => assetInputRef.current?.click()}
                                    className="w-full py-4 rounded-xl border-2 border-dashed border-border/50 flex items-center justify-center gap-3 text-muted-foreground hover:text-primary hover:border-primary/30 hover:bg-primary/5 transition-all cursor-pointer group"
                                >
                                    <div className="w-10 h-10 rounded-xl bg-muted/60 group-hover:bg-primary/10 flex items-center justify-center transition-colors">
                                        <ImagePlus className="w-5 h-5" />
                                    </div>
                                    <div className="text-left">
                                        <p className="text-sm font-semibold">Upload logo, product images, or screenshots</p>
                                        <p className="text-xs opacity-70">PNG, JPG, SVG — these will appear in your video scenes</p>
                                    </div>
                                </button>
                            )}
                        </div>

                        {/* Duration + Aspect Ratio */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                            <div>
                                <label className="text-sm font-bold text-foreground mb-2.5 flex items-center gap-2">
                                    <Clock className="w-4 h-4 text-muted-foreground" /> Duration
                                </label>
                                <div className="flex gap-2">
                                    {DURATION_OPTIONS.map(opt => (
                                        <button
                                            key={opt.value}
                                            onClick={() => setDuration(opt.value)}
                                            className={`flex-1 py-2.5 px-3 rounded-xl text-sm font-medium transition-all cursor-pointer border
                                                ${duration === opt.value
                                                    ? 'bg-primary/10 border-primary/25 text-primary shadow-sm'
                                                    : 'bg-muted/30 border-border/50 text-muted-foreground hover:bg-muted/50 hover:border-border'
                                                }
                                            `}
                                        >
                                            <div className="font-bold">{opt.label}</div>
                                            <div className="text-[10px] opacity-60">{opt.desc}</div>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div>
                                <label className="text-sm font-bold text-foreground mb-2.5 flex items-center gap-2">
                                    <Maximize className="w-4 h-4 text-muted-foreground" /> Aspect Ratio
                                </label>
                                <div className="flex gap-2">
                                    {RATIO_OPTIONS.map(opt => (
                                        <button
                                            key={opt.value}
                                            onClick={() => setAspectRatio(opt.value)}
                                            className={`flex-1 py-2.5 px-3 rounded-xl text-sm font-medium transition-all cursor-pointer border flex flex-col items-center gap-1
                                                ${aspectRatio === opt.value
                                                    ? 'bg-primary/10 border-primary/25 text-primary shadow-sm'
                                                    : 'bg-muted/30 border-border/50 text-muted-foreground hover:bg-muted/50 hover:border-border'
                                                }
                                            `}
                                        >
                                            {opt.icon}
                                            <div className="text-[10px] opacity-60">{opt.desc}</div>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* Music + Voiceover */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                            <div>
                                <label className="text-sm font-bold text-foreground mb-2.5 flex items-center gap-2">
                                    <Music className="w-4 h-4 text-muted-foreground" /> Background Music
                                </label>
                                <select
                                    id="music-select"
                                    value={music}
                                    onChange={(e) => setMusic(e.target.value)}
                                    className="w-full px-4 py-2.5 rounded-xl bg-muted/40 border border-border text-foreground text-sm focus:ring-2 focus:ring-primary/20 cursor-pointer"
                                >
                                    <option value="none">No Music</option>
                                    {MUSIC_OPTIONS.map(m => (
                                        <option key={m.value} value={m.value}>{m.label}</option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="text-sm font-bold text-foreground mb-2.5 flex items-center gap-2">
                                    {voiceoverEnabled
                                        ? <Mic className="w-4 h-4 text-emerald-500" />
                                        : <MicOff className="w-4 h-4 text-muted-foreground" />
                                    }
                                    AI Voiceover
                                </label>
                                <button
                                    id="voiceover-toggle"
                                    onClick={() => setVoiceoverEnabled(!voiceoverEnabled)}
                                    className={`w-full py-2.5 px-4 rounded-xl text-sm font-medium transition-all cursor-pointer border flex items-center justify-between
                                        ${voiceoverEnabled
                                            ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                                            : 'bg-muted/30 border-border/50 text-muted-foreground hover:bg-muted/50'
                                        }
                                    `}
                                >
                                    <span>{voiceoverEnabled ? 'Voiceover ON' : 'Voiceover OFF'}</span>
                                    <div className={`w-10 h-5 rounded-full transition-colors relative ${voiceoverEnabled ? 'bg-emerald-500' : 'bg-muted-foreground/30'}`}>
                                        <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform shadow-sm ${voiceoverEnabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
                                    </div>
                                </button>
                                {voiceoverEnabled && (
                                    <p className="text-[11px] text-emerald-600 mt-1.5 px-1">
                                        ✨ Energetic professional narration — separate from on-screen text
                                    </p>
                                )}
                            </div>
                        </div>

                        {/* Create Button */}
                        <button
                            id="create-project-btn"
                            onClick={handleCreate}
                            disabled={isCreating || !prompt.trim()}
                            className={`group relative w-full py-3.5 rounded-2xl text-base font-bold transition-all cursor-pointer flex items-center justify-center gap-2.5 overflow-hidden
                                ${!prompt.trim() || isCreating
                                    ? 'bg-muted text-muted-foreground cursor-not-allowed'
                                    : 'bg-gradient-to-r from-primary to-accent text-white hover:shadow-xl hover:shadow-primary/20 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.99]'
                                }
                            `}
                        >
                            {/* Shine effect */}
                            <div className="absolute inset-0 bg-white/20 translate-y-[-100%] group-hover:translate-y-[100%] transition-transform duration-700 ease-in-out pointer-events-none" />
                            {isCreating ? (
                                <><Loader2 className="w-5 h-5 animate-spin" /> Creating project...</>
                            ) : (
                                <><Zap className="w-5 h-5" /> Create Motion Graphic</>
                            )}
                        </button>
                    </div>
                </div>

                {/* ─── Core Features marketing section ─── */}
                <CoreFeatures />

                {/* ─── Your Projects ─────────────────────────────────── */}
                <div className="mt-14">
                    <div className="flex items-center justify-between mb-6">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-md">
                                <Video className="w-5 h-5 text-white" />
                            </div>
                            <div>
                                <h2 className="text-lg font-bold text-foreground">Your Projects</h2>
                                <p className="text-xs text-muted-foreground">{projects.length} motion graphic{projects.length !== 1 ? 's' : ''}</p>
                            </div>
                        </div>
                    </div>

                    {loadingProjects ? (
                        <div className="flex items-center justify-center py-16">
                            <Loader2 className="w-6 h-6 animate-spin text-primary" />
                        </div>
                    ) : projects.length === 0 ? (
                        <EmptyMotionState />
                    ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                            {projects.map((project) => {
                                const badge = getStatusBadge(project.status)
                                return (
                                    <Link
                                        key={project.projectId}
                                        href={`/motion-graphics/${project.projectId}`}
                                        className="group relative rounded-2xl bg-white/80 backdrop-blur-md border border-white/40 hover:border-primary/20 overflow-hidden shadow-[0_2px_10px_-3px_rgba(0,0,0,0.05)] hover:shadow-[0_8px_30px_-4px_rgba(0,0,0,0.1)] hover:-translate-y-1 transition-all duration-300"
                                    >
                                        {/* Thumbnail */}
                                        <div className="h-36 bg-muted/30 flex items-center justify-center relative overflow-hidden">
                                            {(() => {
                                                // Priority 1: explicit thumbnailUrl
                                                if (project.thumbnailUrl) {
                                                    return <img src={project.thumbnailUrl} alt="" className="w-full h-full object-cover" />
                                                }
                                                // Priority 2: first scene with an imageUrl from sceneData
                                                const firstImageScene = project.sceneData?.find(s => s.imageUrl)
                                                if (firstImageScene?.imageUrl) {
                                                    return <img src={firstImageScene.imageUrl} alt="" className="w-full h-full object-cover" />
                                                }
                                                // Priority 3: themed gradient with first scene headline
                                                const palette = project.theme?.palette || 'midnight'
                                                const paletteColors: Record<string, { bg: string; accent: string }> = {
                                                    midnight: { bg: '#0a0a0f', accent: '#6366f1' },
                                                    sunset:   { bg: '#1a0a0a', accent: '#f97316' },
                                                    ocean:    { bg: '#0a1628', accent: '#06b6d4' },
                                                    emerald:  { bg: '#0a1a0a', accent: '#10b981' },
                                                    rose:     { bg: '#1a0a14', accent: '#f43f5e' },
                                                    neon:     { bg: '#000000', accent: '#a855f7' },
                                                }
                                                const colors = paletteColors[palette] || paletteColors.midnight
                                                const firstScene = project.sceneData?.[0]
                                                const headline = firstScene?.headline || project.prompt.slice(0, 40)
                                                return (
                                                    <div
                                                        className="w-full h-full flex flex-col items-center justify-center p-4 text-center"
                                                        style={{ background: `linear-gradient(135deg, ${colors.bg} 0%, ${colors.accent}30 100%)` }}
                                                    >
                                                        <p className="text-white font-bold text-sm leading-snug line-clamp-2 drop-shadow-lg" style={{ textShadow: `0 0 20px ${colors.accent}80` }}>
                                                            {headline}
                                                        </p>
                                                        <span className="text-white/50 text-[10px] mt-2 font-medium">
                                                            {project.aspectRatio} · {project.duration}s
                                                        </span>
                                                    </div>
                                                )
                                            })()}
                                            <div className={`absolute top-2 right-2 px-2 py-0.5 rounded-full text-[10px] font-bold border ${badge.cls}`}>
                                                {badge.text}
                                            </div>
                                            {/* Hover play */}
                                            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                                                <Play className="w-10 h-10 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow-lg" />
                                            </div>
                                        </div>

                                        <div className="p-4">
                                            <p className="text-sm font-medium text-foreground line-clamp-2 leading-snug mb-2">
                                                {project.prompt}
                                            </p>
                                            <div className="flex items-center justify-between">
                                                <span className="text-[11px] text-muted-foreground">
                                                    {new Date(project.createdAt).toLocaleDateString()}
                                                </span>
                                                <button
                                                    onClick={(e) => handleDelete(project.projectId, e)}
                                                    className="p-1.5 rounded-lg hover:bg-red-50 text-muted-foreground hover:text-red-500 transition-colors cursor-pointer"
                                                >
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                </button>
                                            </div>
                                        </div>
                                    </Link>
                                )
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
