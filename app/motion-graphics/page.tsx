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
    Volume2,
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { MUSIC_URLS } from '@/lib/music-urls'
import RotatingText from './_components/RotatingText'
import EmptyMotionState from './_components/EmptyMotionState'
import CoreFeatures from './_components/CoreFeatures'
import DrawOutlineButton from '@/components/ui/DrawOutlineButton'

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

// Sarvam AI voiceover languages
const LANGUAGES = [
    { id: 'en-IN', label: 'English (India)', flag: '🇮🇳' },
    { id: 'hi-IN', label: 'Hindi', flag: '🇮🇳' },
    { id: 'bn-IN', label: 'Bengali', flag: '🇮🇳' },
    { id: 'ta-IN', label: 'Tamil', flag: '🇮🇳' },
    { id: 'te-IN', label: 'Telugu', flag: '🇮🇳' },
    { id: 'gu-IN', label: 'Gujarati', flag: '🇮🇳' },
    { id: 'kn-IN', label: 'Kannada', flag: '🇮🇳' },
    { id: 'ml-IN', label: 'Malayalam', flag: '🇮🇳' },
    { id: 'mr-IN', label: 'Marathi', flag: '🇮🇳' },
    { id: 'pa-IN', label: 'Punjabi', flag: '🇮🇳' },
    { id: 'od-IN', label: 'Odia', flag: '🇮🇳' },
]

// Sarvam Bulbul v3 speakers with gender and characteristics info
const SPEAKERS = [
    { id: 'shubh', label: 'Shubh', type: 'Male', mood: 'Default · Clear' },
    { id: 'aditya', label: 'Aditya', type: 'Male', mood: 'Professional' },
    { id: 'ritu', label: 'Ritu', type: 'Female', mood: 'Warm' },
    { id: 'priya', label: 'Priya', type: 'Female', mood: 'Friendly' },
    { id: 'neha', label: 'Neha', type: 'Female', mood: 'Soft' },
    { id: 'rahul', label: 'Rahul', type: 'Male', mood: 'Energetic' },
    { id: 'pooja', label: 'Pooja', type: 'Female', mood: 'Calm' },
    { id: 'rohan', label: 'Rohan', type: 'Male', mood: 'Casual' },
    { id: 'simran', label: 'Simran', type: 'Female', mood: 'Cheerful' },
    { id: 'kavya', label: 'Kavya', type: 'Female', mood: 'Expressive' },
    { id: 'amit', label: 'Amit', type: 'Male', mood: 'Firm' },
    { id: 'dev', label: 'Dev', type: 'Male', mood: 'Deep' },
    { id: 'ishita', label: 'Ishita', type: 'Female', mood: 'Lively' },
    { id: 'shreya', label: 'Shreya', type: 'Female', mood: 'Bright' },
    { id: 'kabir', label: 'Kabir', type: 'Male', mood: 'Confident' },
    { id: 'anand', label: 'Anand', type: 'Male', mood: 'Pleasant' },
    { id: 'roopa', label: 'Roopa', type: 'Female', mood: 'Gentle' },
    { id: 'varun', label: 'Varun', type: 'Male', mood: 'Dynamic' },
    { id: 'tanya', label: 'Tanya', type: 'Female', mood: 'Bold' },
    { id: 'sunny', label: 'Sunny', type: 'Male', mood: 'Upbeat' },
    { id: 'shruti', label: 'Shruti', type: 'Female', mood: 'Melodic' },
    { id: 'mohit', label: 'Mohit', type: 'Male', mood: 'Smooth' },
    { id: 'rupali', label: 'Rupali', type: 'Female', mood: 'Graceful' },
    { id: 'sophia', label: 'Sophia', type: 'Female', mood: 'Modern' },
]

// Preview texts by language
const PREVIEW_TEXTS: Record<string, string> = {
    'en-IN': 'Welcome to Migoo! Your stories deserve to be seen by the world.',
    'hi-IN': 'मिगू में आपका स्वागत है! आपकी कहानियाँ दुनिया के सामने आने के काबिल हैं।',
    'bn-IN': 'মিগুতে আপনাকে স্বাগতম! আপনার গল্পগুলো বিশ্বের কাছে পৌঁছানোর যোগ্য।',
    'ta-IN': 'மிகூவிற்கு வரவேற்கிறோம்! உங்கள் கதைகள் உலகை சென்றடைய வேண்டும்.',
    'te-IN': 'మిగూకి స్వాగతం! మీ కథలు ప్రపంచానికి చేరాలి.',
    'gu-IN': 'મિગુમાં તમારું સ્વાગત છે! તમારી વાર્તાઓ દુનિયા સુધી પહોંચવી જોઈએ.',
    'kn-IN': 'ಮಿಗೂಗೆ ಸ್ವಾಗತ! ನಿಮ್ಮ ಕಥೆಗಳು ಜಗತ್ತಿನ ಮುಂದೆ ಬರಬೇಕು.',
    'ml-IN': 'മിഗൂവിലേക്ക് സ്വാഗതം! നിങ്ങളുടെ കഥകൾ ലോകത്തിന് മുന്നിൽ എത്തണം.',
    'mr-IN': 'मिगूमध्ये आपले स्वागत आहे! तुमच्या कथा जगासमोर यायला हव्यात.',
    'pa-IN': 'ਮਿਗੂ ਵਿੱਚ ਤੁਹਾਡਾ ਸਵਾਗਤ ਹੈ! ਤੁਹਾਡੀਆਂ ਕਹਾਣੀਆਂ ਦੁਨੀਆ ਤੱਕ ਪਹੁੰਚਣੀਆਂ ਚਾਹੀਦੀਆਂ ਹਨ।',
    'od-IN': 'ମିଗୁକୁ ଆପଣଙ୍କ ସ୍ୱାଗତ! ଆପଣଙ୍କ କାହାଣୀ ଦୁନିଆ ଆଗରେ ଆସିବା ଉଚିତ।',
}

export default function MotionGraphicsPage() {
    const { isSignedIn } = useUser()
    const router = useRouter()

    // Form state
    const [prompt, setPrompt] = useState('')
    const [duration, setDuration] = useState(30)
    const [aspectRatio, setAspectRatio] = useState('16:9')
    const [voiceoverEnabled, setVoiceoverEnabled] = useState(false)
    const [voice, setVoice] = useState('rahul')
    const [language, setLanguage] = useState('en-IN')
    const [playingVoice, setPlayingVoice] = useState<string | null>(null)
    const audioRef = useRef<HTMLAudioElement | null>(null)
    const [music, setMusic] = useState('cinematic')
    const [isCreating, setIsCreating] = useState(false)
    const [uploadedAssets, setUploadedAssets] = useState<Array<{ file: File; preview: string; name: string }>>([])
    const [uploadingAssets, setUploadingAssets] = useState(false)
    const assetInputRef = useRef<HTMLInputElement>(null)

    // Stop audio on unmount
    useEffect(() => {
        return () => {
            if (audioRef.current) {
                audioRef.current.pause()
                audioRef.current = null
            }
        }
    }, [])

    const handlePreview = async (speakerId: string) => {
        if (audioRef.current) {
            audioRef.current.pause()
            audioRef.current = null
        }

        if (playingVoice === speakerId) {
            setPlayingVoice(null)
            return
        }

        setPlayingVoice(speakerId)

        try {
            const previewText = PREVIEW_TEXTS[language] || PREVIEW_TEXTS['en-IN']

            const response = await fetch('/api/tts-preview', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: previewText,
                    speaker: speakerId,
                    language: language,
                }),
            })

            if (!response.ok) {
                throw new Error('Preview failed')
            }

            const { audio } = await response.json()

            const audioBlob = new Blob(
                [Uint8Array.from(atob(audio), c => c.charCodeAt(0))],
                { type: 'audio/wav' }
            )
            const audioUrl = URL.createObjectURL(audioBlob)
            const audioElement = new Audio(audioUrl)
            audioRef.current = audioElement

            audioElement.onended = () => {
                setPlayingVoice(null)
                URL.revokeObjectURL(audioUrl)
            }

            audioElement.onerror = () => {
                setPlayingVoice(null)
                toast.error('Audio playback failed')
            }

            await audioElement.play()
        } catch (error) {
            setPlayingVoice(null)
            toast.error('Voice preview unavailable right now')
            console.error('TTS Preview error:', error)
        }
    }

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
                body: JSON.stringify({ prompt: prompt.trim(), duration, aspectRatio, voiceoverEnabled, voice, language, music }),
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
                                    <>
                                        <p className="text-[11px] text-emerald-600 mt-1.5 px-1 mb-3">
                                            ✨ Energetic professional narration — separate from on-screen text
                                        </p>
                                        <div className="space-y-3 p-3.5 rounded-xl border border-emerald-100 bg-emerald-50/20 text-left">
                                            <div className="grid grid-cols-2 gap-3">
                                                <div>
                                                    <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block mb-1">
                                                        Language
                                                    </label>
                                                    <select
                                                        value={language}
                                                        onChange={(e) => setLanguage(e.target.value)}
                                                        className="w-full px-2.5 py-1.5 rounded-lg bg-white border border-border text-foreground text-xs focus:ring-2 focus:ring-primary/20 cursor-pointer"
                                                    >
                                                        {LANGUAGES.map(lang => (
                                                            <option key={lang.id} value={lang.id}>{lang.flag} {lang.label}</option>
                                                        ))}
                                                    </select>
                                                </div>

                                                <div>
                                                    <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block mb-1">
                                                        Voice
                                                    </label>
                                                    <div className="flex gap-1.5 items-center">
                                                        <select
                                                            value={voice}
                                                            onChange={(e) => setVoice(e.target.value)}
                                                            className="flex-1 px-2.5 py-1.5 rounded-lg bg-white border border-border text-foreground text-xs focus:ring-2 focus:ring-primary/20 cursor-pointer"
                                                        >
                                                            {SPEAKERS.map(speaker => (
                                                                <option key={speaker.id} value={speaker.id}>
                                                                    {speaker.label} ({speaker.type})
                                                                </option>
                                                            ))}
                                                        </select>
                                                        <button
                                                            onClick={() => handlePreview(voice)}
                                                            type="button"
                                                            className="p-1.5 rounded-lg border border-border bg-white text-primary hover:bg-muted/50 cursor-pointer flex items-center justify-center transition-colors"
                                                            title="Preview voice"
                                                        >
                                                            {playingVoice === voice ? (
                                                                <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
                                                            ) : (
                                                                <Volume2 className="w-3.5 h-3.5" />
                                                            )}
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>

                        {/* Create Button — testing DrawOutlineButton style here only */}
                        <DrawOutlineButton
                            id="create-project-btn"
                            onClick={handleCreate}
                            disabled={isCreating || !prompt.trim()}
                            className="text-base font-bold border border-border"
                        >
                            {isCreating ? (
                                <><Loader2 className="w-5 h-5 animate-spin" /> Creating project...</>
                            ) : (
                                <><Zap className="w-5 h-5" /> Create Motion Graphic</>
                            )}
                        </DrawOutlineButton>
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
