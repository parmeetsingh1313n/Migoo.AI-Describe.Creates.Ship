"use client"

import { useUser, UserButton } from '@clerk/nextjs'
import {
    ArrowLeft,
    ChevronRight,
    Loader2,
    Mic,
    Palette,
    Play,
    RefreshCw,
    RotateCcw,
    Send,
    Sparkles,
    MessageSquare,
    Wand2,
    Download,
    CheckCircle2,
    Zap,
    Bot,
    User,
    ImagePlus,
    X,
    Rocket,
} from 'lucide-react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import ChapteredVideoPlayer from './_components/ChapteredVideoPlayer'
import LiveMotionGraphicPlayer from './_components/LiveMotionGraphicPlayer'
import PalettePicker from './_components/PalettePicker'
import ThemeGateScreen from './_components/ThemeGateScreen'
import type { MotionGraphicTheme } from '@/lib/theme-palette'

// Fingerprint of the theme + per-scene color overrides currently in effect —
// compared against a snapshot taken whenever a fresh render lands, to know
// whether the last exported MP4 still matches what's live-previewed.
function colorFingerprint(p: Pick<Project, 'theme' | 'sceneData'> | null): string {
    if (!p) return ''
    const sceneColors = ((p.sceneData as any[]) || []).map((s: any) => (s?.customColors ? JSON.stringify(s.colors) : ''))
    return JSON.stringify({ theme: p.theme, sceneColors })
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface Message {
    id: number
    role: 'user' | 'assistant' | 'system'
    content: string
    metadata?: any
    createdAt: string
}

interface Project {
    projectId: string
    prompt: string
    duration: number
    aspectRatio: string
    voiceoverEnabled: number
    voice: string
    language: string
    music: string
    theme: MotionGraphicTheme | null
    themeConfirmed?: number
    sceneData: any[]
    voiceoverScript: string | null
    audioUrl: string | null
    remotionProps: any
    videoUrl: string | null
    status: string
    createdAt: string
}

// ─── Status Steps ────────────────────────────────────────────────────────────

const STATUS_STEPS = [
    { key: 'generating:scenes', label: 'Generating Scenes',   icon: <Sparkles className="w-4 h-4" /> },
    { key: 'generating:assets', label: 'Creating Assets',     icon: <Palette className="w-4 h-4" /> },
    { key: 'generating:voice',  label: 'Recording Voiceover', icon: <Mic className="w-4 h-4" /> },
    { key: 'generating:video',  label: 'Rendering Video',     icon: <Play className="w-4 h-4" /> },
]

export default function MotionGraphicProjectPage() {
    const { isSignedIn } = useUser()
    const params = useParams()
    const projectId = params.projectId as string

    const [project, setProject] = useState<Project | null>(null)
    const [messages, setMessages] = useState<Message[]>([])
    const [loading, setLoading] = useState(true)
    const [chatInput, setChatInput] = useState('')
    const [sending, setSending] = useState(false)
    const [activeTab, setActiveTab] = useState<'chat' | 'theme'>('chat')
    const messagesEndRef = useRef<HTMLDivElement>(null)
    const [generating, setGenerating] = useState(false)
    const autoSentRef = useRef(false)
    const imageInputRef = useRef<HTMLInputElement>(null)
    const [uploadedImages, setUploadedImages] = useState<Array<{ url: string; name: string; description?: string }>>([])
    const [uploading, setUploading] = useState(false)
    const textareaRef = useRef<HTMLTextAreaElement>(null)
    // Scene-targeting mode for the chat (only shown after the first prompt creates scenes):
    //   'add'  → next message appends a new scene
    //   number → next message edits that scene index (0-based)
    const [sceneTarget, setSceneTarget] = useState<'add' | number>('add')
    const [enhancing, setEnhancing] = useState(false)
    // Per-scene asset attach (storyboard): which scene index is currently uploading
    const [assetUploadingIndex, setAssetUploadingIndex] = useState<number | null>(null)
    const sceneAssetInputRef = useRef<HTMLInputElement>(null)
    const sceneAssetTargetIndex = useRef<number | null>(null)
    // Per-scene color override (storyboard): which scene's palette popover is open / saving
    const [colorPickerIndex, setColorPickerIndex] = useState<number | null>(null)
    const [colorSavingIndex, setColorSavingIndex] = useState<number | null>(null)
    // Live-preview export tracking: fingerprint of theme/colors baked into the
    // most recently completed render, so we know if the live preview has
    // diverged (unsaved changes) since that render.
    const [exportedFingerprint, setExportedFingerprint] = useState<string | null>(null)
    const [isExporting, setIsExporting] = useState(false)

    // Auto-resize textarea
    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto'
            textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 192)}px` // 192px = max-h-48
        }
    }, [chatInput])

    const fetchProject = useCallback(async () => {
        try {
            const res = await fetch(`/api/motion-graphics/${projectId}`)
            const data = await res.json()
            if (data.success) {
                setProject(data.project)
                setMessages(data.messages || [])
            }
        } catch {
            toast.error('Failed to load project')
        } finally {
            setLoading(false)
        }
    }, [projectId])

    useEffect(() => {
        if (isSignedIn && projectId) fetchProject()
    }, [isSignedIn, projectId, fetchProject])

    // Poll during generation
    useEffect(() => {
        if (!project?.status?.startsWith('generating')) return
        const interval = setInterval(fetchProject, 3000)
        return () => clearInterval(interval)
    }, [project?.status, fetchProject])

    // Auto-scroll chat
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [messages])

    // Whenever a (new) rendered video lands, snapshot the theme/colors it was
    // rendered with — this is what the live preview's "unsaved changes"
    // indicator compares against.
    useEffect(() => {
        if (project?.videoUrl) {
            setExportedFingerprint(colorFingerprint(project))
        }
    }, [project?.videoUrl])

    // Auto-send the project prompt as the first chat message
    useEffect(() => {
        // Only user/assistant messages count — system messages are inserted on creation
        const hasUserMessages = messages.some(m => m.role === 'user' || m.role === 'assistant')
        if (
            !loading &&
            project &&
            project.prompt &&
            !!project.themeConfirmed &&
            !hasUserMessages &&
            !autoSentRef.current &&
            !sending
        ) {
            autoSentRef.current = true
            const autoSend = async () => {
                setSending(true)
                // Check for pre-uploaded assets from the creation page
                let userMsg = project.prompt
                try {
                    const storedAssets = sessionStorage.getItem(`mg_assets_${projectId}`)
                    if (storedAssets) {
                        const assetUrls = JSON.parse(storedAssets) as string[]
                        if (assetUrls.length > 0) {
                            userMsg = `${userMsg}\n\n${assetUrls.join('\n')}`
                        }
                        sessionStorage.removeItem(`mg_assets_${projectId}`)
                    }
                } catch {}
                const tempMsg: Message = {
                    id: Date.now(), role: 'user', content: project.prompt, createdAt: new Date().toISOString(),
                }
                setMessages(prev => [...prev, tempMsg])

                try {
                    const res = await fetch(`/api/motion-graphics/${projectId}/chat`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ message: userMsg }),
                    })
                    const data = await res.json()
                    if (data.success) {
                        const aiMsg: Message = {
                            id: Date.now() + 1, role: 'assistant', content: data.reply,
                            metadata: data.scenesData ? { type: 'scene_update', sceneData: data.scenesData } : null,
                            createdAt: new Date().toISOString(),
                        }
                        setMessages(prev => [...prev, aiMsg])
                        if (data.scenesData?.scenes) {
                            fetchProject()
                            toast.success('Scenes generated from your prompt!')
                        }
                    }
                } catch {
                    console.error('Auto-send failed')
                } finally {
                    setSending(false)
                }
            }
            autoSend()
        }
    }, [loading, project, messages, sending, projectId, fetchProject])

    const handleSend = async () => {
        if (!chatInput.trim() || sending) return
        const userMsg = chatInput.trim()
        setChatInput('')
        setSending(true)

        const tempMsg: Message = {
            id: Date.now(), role: 'user', content: userMsg, createdAt: new Date().toISOString(),
        }
        setMessages(prev => [...prev, tempMsg])

        try {
            const res = await fetch(`/api/motion-graphics/${projectId}/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: userMsg }),
            })
            const data = await res.json()
            if (data.success) {
                const aiMsg: Message = {
                    id: Date.now() + 1, role: 'assistant', content: data.reply,
                    metadata: data.scenesData ? { type: 'scene_update', sceneData: data.scenesData } : null,
                    createdAt: new Date().toISOString(),
                }
                setMessages(prev => [...prev, aiMsg])
                if (data.scenesData?.scenes) {
                    fetchProject()
                    toast.success('Scenes generated! You can now generate the video.')
                }
            } else {
                toast.error(data.error || 'Failed to send message')
            }
        } catch {
            toast.error('Failed to send message')
        } finally {
            setSending(false)
        }
    }

    const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || [])
        if (!files.length) return
        setUploading(true)
        try {
            for (const file of files) {
                const formData = new FormData()
                formData.append('file', file)
                const res = await fetch(`/api/motion-graphics/${projectId}/upload`, { method: 'POST', body: formData })
                const data = await res.json()
                if (data.url) {
                    setUploadedImages(prev => [...prev, { url: data.url, name: file.name, description: data.description }])
                    toast.success(`Image uploaded: ${file.name}`)
                }
            }
        } catch {
            toast.error('Image upload failed')
        } finally {
            setUploading(false)
            if (imageInputRef.current) imageInputRef.current.value = ''
        }
    }

    /** Read a video file's real duration in the browser (used to size the scene). */
    const readVideoDuration = (file: File): Promise<number> =>
        new Promise((resolve) => {
            const video = document.createElement('video')
            video.preload = 'metadata'
            video.onloadedmetadata = () => {
                URL.revokeObjectURL(video.src)
                resolve(video.duration || 5)
            }
            video.onerror = () => resolve(5)
            video.src = URL.createObjectURL(file)
        })

    const openSceneAssetPicker = (sceneIndex: number) => {
        sceneAssetTargetIndex.current = sceneIndex
        sceneAssetInputRef.current?.click()
    }

    const handleSceneAssetUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        const sceneIndex = sceneAssetTargetIndex.current
        if (!file || sceneIndex == null) return

        setAssetUploadingIndex(sceneIndex)
        try {
            const formData = new FormData()
            formData.append('file', file)
            formData.append('sceneIndex', String(sceneIndex))
            if (file.type.startsWith('video/')) {
                const duration = await readVideoDuration(file)
                formData.append('durationSec', String(Math.round(duration)))
            }
            const res = await fetch(`/api/motion-graphics/${projectId}/scene-asset`, { method: 'POST', body: formData })
            const data = await res.json()
            if (data.success) {
                toast.success(`Scene ${sceneIndex + 1}: ${data.assetType} attached`)
                await fetchProject()
            } else {
                toast.error(data.error || 'Attach failed')
            }
        } catch {
            toast.error('Attach failed')
        } finally {
            setAssetUploadingIndex(null)
            sceneAssetTargetIndex.current = null
            if (sceneAssetInputRef.current) sceneAssetInputRef.current.value = ''
        }
    }

    const handleRemoveSceneAsset = async (sceneIndex: number) => {
        setAssetUploadingIndex(sceneIndex)
        try {
            const res = await fetch(`/api/motion-graphics/${projectId}/scene-asset?sceneIndex=${sceneIndex}`, { method: 'DELETE' })
            const data = await res.json()
            if (data.success) {
                toast.success('Asset removed')
                await fetchProject()
            } else {
                toast.error(data.error || 'Remove failed')
            }
        } catch {
            toast.error('Remove failed')
        } finally {
            setAssetUploadingIndex(null)
        }
    }

    const handleSceneColorChange = async (sceneIndex: number, theme: MotionGraphicTheme) => {
        setColorSavingIndex(sceneIndex)
        try {
            const res = await fetch(`/api/motion-graphics/${projectId}/scene-color`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sceneIndex, colors: theme.resolved }),
            })
            const data = await res.json()
            if (data.success) {
                await fetchProject()
            } else {
                toast.error(data.error || 'Failed to update scene colors')
            }
        } catch {
            toast.error('Failed to update scene colors')
        } finally {
            setColorSavingIndex(null)
        }
    }

    const handleResetSceneColor = async (sceneIndex: number) => {
        setColorSavingIndex(sceneIndex)
        try {
            const res = await fetch(`/api/motion-graphics/${projectId}/scene-color?sceneIndex=${sceneIndex}`, { method: 'DELETE' })
            const data = await res.json()
            if (data.success) {
                toast.success('Reset to theme')
                setColorPickerIndex(null)
                await fetchProject()
            } else {
                toast.error(data.error || 'Reset failed')
            }
        } catch {
            toast.error('Reset failed')
        } finally {
            setColorSavingIndex(null)
        }
    }

    const handleSendWithImages = async () => {
        const userText = chatInput.trim()
        if (!userText && uploadedImages.length === 0) return

        // Build internal image context (sent to AI only, never shown to user)
        let imageContext = ''
        if (uploadedImages.length > 0) {
            imageContext = uploadedImages.map(img => `[UPLOADED IMAGE: ${img.name} — URL: ${img.url} — DESCRIPTION: ${img.description || 'Reference Image'}]`).join(' ')
        }

        // Display message: clean user text + image count indicator
        const displayText = userText || `📎 Uploaded ${uploadedImages.length} image(s)`
        const imageIndicator = uploadedImages.length > 0 ? ` 📎 ${uploadedImages.length} image(s) attached` : ''

        setChatInput('')
        setUploadedImages([])
        setSending(true)
        const tempMsg: Message = { id: Date.now(), role: 'user', content: displayText + imageIndicator, createdAt: new Date().toISOString() }
        setMessages(prev => [...prev, tempMsg])
        try {
            // Assets are already stored in DB by the upload endpoint.
            // Just send the user's text — the chat API reads assets from DB separately.
            const messageForAI = userText || `I've uploaded ${uploadedImages.length} reference image(s). Please use them in the most relevant scenes.`;

            // Resolve the explicit chat mode from the scene selector. Only meaningful
            // once scenes exist; the first prompt always runs in 'create' mode.
            const scenesExist = ((project?.sceneData as any[] | undefined)?.length || 0) > 0
            const mode = !scenesExist ? 'create' : (sceneTarget === 'add' ? 'add' : 'edit')
            const targetSceneIndex = mode === 'edit' ? (sceneTarget as number) : undefined

            const res = await fetch(`/api/motion-graphics/${projectId}/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: messageForAI, mode, targetSceneIndex }),
            })
            const data = await res.json()
            if (data.success) {
                const aiMsg: Message = { id: Date.now() + 1, role: 'assistant', content: data.reply, metadata: data.scenesData ? { type: 'scene_update', sceneData: data.scenesData } : null, createdAt: new Date().toISOString() }
                setMessages(prev => [...prev, aiMsg])
                if (data.scenesData?.scenes) { fetchProject(); setSceneTarget('add'); toast.success(mode === 'edit' ? 'Scene updated!' : mode === 'add' ? 'Scene added!' : 'Scenes generated!') }
            } else { toast.error(data.error || 'Failed') }
        } catch { toast.error('Failed to send') } finally { setSending(false) }
    }

    // Enhance the current chat input into a structured, component-aware prompt.
    // Fills the input box for the user to review/edit — does NOT auto-send.
    const handleEnhancePrompt = async () => {
        const raw = chatInput.trim()
        if (!raw || enhancing || sending || isGenerating) return
        const scenesExist = ((project?.sceneData as any[] | undefined)?.length || 0) > 0
        const mode = !scenesExist ? 'create' : (sceneTarget === 'add' ? 'add' : 'edit')
        const targetSceneIndex = mode === 'edit' ? (sceneTarget as number) : undefined
        setEnhancing(true)
        try {
            const res = await fetch(`/api/motion-graphics/${projectId}/enhance-prompt`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: raw, mode, targetSceneIndex }),
            })
            const data = await res.json()
            if (data.success && data.enhanced) {
                setChatInput(data.enhanced)
                toast.success('Prompt enhanced — review and send')
            } else {
                toast.error(data.error || 'Could not enhance prompt')
            }
        } catch { toast.error('Could not enhance prompt') } finally { setEnhancing(false) }
    }

    const handleGenerate = async () => {
        if (generating) return
        setGenerating(true)
        try {
            const res = await fetch(`/api/motion-graphics/${projectId}/generate`, { method: 'POST' })
            const data = await res.json()
            if (data.success) {
                toast.success('Generation started!')
                fetchProject()
            } else {
                toast.error(data.error || 'Failed to start generation')
            }
        } catch {
            toast.error('Failed to start generation')
        } finally {
            setGenerating(false)
        }
    }

    // Renders the CURRENT remotionProps (theme + per-scene colors, live-edited
    // for free in the browser preview) into a real MP4 — skips scene/asset/
    // voiceover generation entirely since none of that changed.
    const handleExport = async () => {
        if (isExporting || project?.status === 'generating:video') return
        setIsExporting(true)
        try {
            const res = await fetch(`/api/motion-graphics/${projectId}/retry-render`, { method: 'POST' })
            const data = await res.json()
            if (res.ok && data.success) {
                toast.success('Rendering your video with the latest colors...')
                fetchProject()
            } else {
                toast.error(data.error || 'Failed to start export')
            }
        } catch {
            toast.error('Failed to start export')
        } finally {
            setIsExporting(false)
        }
    }

    const handleThemeChange = async (theme: MotionGraphicTheme) => {
        try {
            const res = await fetch(`/api/motion-graphics/${projectId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ theme }),
            })
            const data = await res.json()
            if (data.success) {
                setProject(data.project)
                toast.success('Theme updated')
            }
        } catch {
            toast.error('Failed to update theme')
        }
    }

    const handleCancelGeneration = async () => {
        try {
            setProject(prev => prev ? { ...prev, status: 'draft' } : null)
            await fetch(`/api/motion-graphics/${projectId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: 'draft' }),
            })
            toast.success('Generation cancelled')
        } catch {
            toast.error('Failed to cancel')
        }
    }

    const handleStartFromScratch = async () => {
        if (!confirm('Start from scratch? This will clear all scenes, messages, and generated video for this project.')) return
        try {
            const res = await fetch(`/api/motion-graphics/${projectId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reset: true }),
            })
            const data = await res.json()
            if (data.success) {
                // Reset all local state so the auto-send fires again with the project prompt
                autoSentRef.current = false
                setMessages([])
                setProject(data.project)
                setActiveTab('chat')
                toast.success('Project reset! Describe your new scene vision below.')
            } else {
                toast.error(data.error || 'Failed to reset project')
            }
        } catch {
            toast.error('Failed to reset project')
        }
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-muted/20">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
        )
    }

    if (!project) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen bg-muted/20 gap-4">
                <p className="text-muted-foreground">Project not found</p>
                <Link href="/motion-graphics" className="text-primary hover:underline text-sm font-medium">← Back to projects</Link>
            </div>
        )
    }

    // Fresh project, no theme confirmed yet: show the full-screen theme picker
    // before anything else. The extra sceneData/videoUrl check means adding
    // this column doesn't re-show the gate for any project that already has
    // content (existing rows get themeConfirmed=0 backfilled by default).
    if (!project.themeConfirmed && !project.sceneData?.length && !project.videoUrl) {
        return (
            <ThemeGateScreen
                prompt={project.prompt}
                onConfirm={async (theme) => {
                    const res = await fetch(`/api/motion-graphics/${projectId}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ theme, themeConfirmed: true }),
                    })
                    const data = await res.json()
                    if (data.success) setProject(data.project)
                    else toast.error(data.error || 'Failed to save theme')
                }}
            />
        )
    }

    const isGenerating = project.status?.startsWith('generating')
    // remotionProps is saved as soon as scenes/assets/voiceover finish — well
    // before the actual MP4 render completes. From that point on we can show
    // a live in-browser preview instead of blocking on the render.
    const hasRemotionProps = !!project.remotionProps
    const isFirstTimeGenerating = isGenerating && !hasRemotionProps
    const isRenderInProgress = project.status === 'generating:video'
    const isDirty = exportedFingerprint !== null && colorFingerprint(project) !== exportedFingerprint
    // Show the real exported MP4 only once it exists, nothing has changed
    // since it was rendered, and no new render is currently in flight.
    const showFinalPlayer = hasRemotionProps && !!project.videoUrl && !isDirty && !isRenderInProgress
    const isCompleted = project.status === 'completed' && project.remotionProps
    const hasScenes = project.sceneData && (project.sceneData as any[]).length > 0

    return (
        <div className="flex flex-col h-screen bg-muted/20">
            {/* ─── Top Bar ────────────────────────────────────────── */}
            <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-white/80 backdrop-blur-sm shrink-0 shadow-sm">
                {/* Left: back arrow */}
                <Link href="/motion-graphics" className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer flex-shrink-0">
                    <ArrowLeft className="w-4 h-4" />
                </Link>

                {/* Center: project title + meta */}
                <div className="flex-1 min-w-0 text-center">
                    <h1 className="text-sm font-bold text-foreground truncate">
                        {project.prompt.substring(0, 60)}{project.prompt.length > 60 ? '...' : ''}
                    </h1>
                    <div className="flex items-center justify-center gap-2 text-[11px] text-muted-foreground">
                        <span>{project.duration}s</span>
                        <span className="text-border">·</span>
                        <span>{project.aspectRatio}</span>
                        <span className="text-border">·</span>
                        <span>{project.voiceoverEnabled ? '🎙️ Voice' : '🔇 No voice'}</span>
                        {isCompleted && (
                            <span className="ml-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-600 border border-emerald-200 flex items-center gap-1">
                                <CheckCircle2 className="w-2.5 h-2.5" /> Ready
                            </span>
                        )}
                    </div>
                </div>

                {/* Right: User Avatar */}
                <div className="flex items-center flex-shrink-0">
                    <UserButton afterSignOutUrl="/" />
                </div>
            </div>

            {/* ─── Main Content ────────────────────────────────────── */}
            <div className="flex-1 flex min-h-0">
                {/* Left Panel */}
                <div className="w-full md:w-[420px] lg:w-[460px] flex flex-col border-r border-border bg-white/60 overflow-x-hidden">
                    {/* Tabs */}
                    <div className="flex border-b border-border shrink-0">
                        <button
                            onClick={() => setActiveTab('chat')}
                            className={`flex-1 py-3 text-sm font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer border-b-2
                                ${activeTab === 'chat'
                                    ? 'border-primary text-primary'
                                    : 'border-transparent text-muted-foreground hover:text-foreground'
                                }
                            `}
                        >
                            <MessageSquare className="w-4 h-4" /> Chat
                        </button>
                        <button
                            onClick={() => setActiveTab('theme')}
                            className={`flex-1 py-3 text-sm font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer border-b-2
                                ${activeTab === 'theme'
                                    ? 'border-primary text-primary'
                                    : 'border-transparent text-muted-foreground hover:text-foreground'
                                }
                            `}
                        >
                            <Palette className="w-4 h-4" /> Theme
                        </button>
                    </div>

                    {activeTab === 'chat' ? (
                        <>
                            {/* Messages */}
                            <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 space-y-4">
                                {messages.filter(m => m.role !== 'system').length === 0 && (
                                    <div className="text-center py-8">
                                        <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center mx-auto mb-3">
                                            <Bot className="w-6 h-6 text-muted-foreground" />
                                        </div>
                                        <h3 className="font-bold text-foreground mb-1">Let&apos;s create something amazing!</h3>
                                        <p className="text-sm text-muted-foreground max-w-[280px] mx-auto">
                                            Describe your vision and I&apos;ll generate animated scenes.
                                        </p>
                                    </div>
                                )}

                                {messages.filter(m => m.role !== 'system').map((msg) => (
                                    <div key={msg.id} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                        {msg.role === 'assistant' && (
                                            <div className="shrink-0 w-8 h-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center mt-0.5">
                                                <Bot className="w-4 h-4 text-primary" />
                                            </div>
                                        )}
                                        <div className={`max-w-[80%] px-4 py-3 rounded-2xl text-sm leading-relaxed break-words shadow-sm
                                            ${msg.role === 'user'
                                                ? 'bg-gradient-to-r from-primary to-accent text-white rounded-tr-md shadow-md shadow-primary/10'
                                                : 'bg-white text-foreground border border-border rounded-tl-md shadow-sm'
                                            }
                                        `}>
                                            {(() => {
                                                // Strip [UPLOADED IMAGE: ...] blocks from display
                                                const cleaned = msg.content.replace(/\[UPLOADED IMAGE:[\s\S]*?\]/g, '').trim()
                                                const hadImages = cleaned !== msg.content.trim()

                                                // Detect a numbered scene spec (e.g. "1. logo_reveal ... 24. call_to_action")
                                                // These are always user-sent and look terrible as raw text
                                                const sceneNums = [...cleaned.matchAll(/^(\d+)\./gm)].map(m => parseInt(m[1], 10))
                                                const isSceneSpec = sceneNums.length > 3
                                                const sceneCount = isSceneSpec ? Math.max(...sceneNums) : 0

                                                // Very long messages get truncated with a "show more" style collapse
                                                const MAX_CHARS = 200
                                                const displayText = isSceneSpec
                                                    ? cleaned.split('\n')[0]?.substring(0, 120) || 'Scene specification'
                                                    : cleaned.length > MAX_CHARS
                                                        ? cleaned.substring(0, MAX_CHARS) + '…'
                                                        : cleaned

                                                return (
                                                    <>
                                                        {displayText || 'Sent reference images'}
                                                        {isSceneSpec && (
                                                            <span className={`block mt-1.5 text-[11px] font-semibold ${msg.role === 'user' ? 'text-white/80' : 'text-primary'} flex items-center gap-1`}>
                                                                📋 {sceneCount} scenes specified
                                                            </span>
                                                        )}
                                                        {hadImages && (
                                                            <span className={`block mt-1 text-[11px] ${msg.role === 'user' ? 'text-white/70' : 'text-muted-foreground'}`}>
                                                                📎 Images attached
                                                            </span>
                                                        )}
                                                    </>
                                                )
                                            })()}
                                            {msg.metadata?.type === 'scene_update' && (
                                                <div className="mt-2 flex items-center gap-1.5 text-[11px] text-primary bg-primary/10 px-2 py-1 rounded-lg">
                                                    <Sparkles className="w-3 h-3" />
                                                    {msg.metadata.sceneData?.scenes?.length || 0} scenes generated
                                                </div>
                                            )}
                                        </div>
                                        {msg.role === 'user' && (
                                            <div className="shrink-0 w-8 h-8 rounded-full bg-muted flex items-center justify-center mt-0.5">
                                                <User className="w-4 h-4 text-muted-foreground" />
                                            </div>
                                        )}
                                    </div>
                                ))}

                                {sending && (
                                    <div className="flex gap-3">
                                        <div className="shrink-0 w-8 h-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center">
                                            <Bot className="w-4 h-4 text-primary" />
                                        </div>
                                        <div className="bg-white border border-border rounded-2xl rounded-tl-md px-4 py-3 shadow-sm">
                                            <div className="flex gap-1.5">
                                                <div className="w-2 h-2 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: '0ms' }} />
                                                <div className="w-2 h-2 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: '150ms' }} />
                                                <div className="w-2 h-2 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: '300ms' }} />
                                            </div>
                                        </div>
                                    </div>
                                )}
                                <div ref={messagesEndRef} />
                            </div>

                            {/* Image previews */}
                            {uploadedImages.length > 0 && (
                                <div className="flex gap-2 px-4 pt-3 flex-wrap">
                                    {uploadedImages.map((img, i) => (
                                        <div key={i} className="relative group">
                                            <img src={img.url} alt={img.name} className="w-14 h-14 object-cover rounded-lg border border-border shadow-sm" />
                                            <button onClick={() => setUploadedImages(prev => prev.filter((_, j) => j !== i))} className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-destructive text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
                                                <X className="w-3 h-3" />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                            {/* Input */}
                            {(() => {
                                const scenesArr = (project?.sceneData as any[]) || []
                                const hasScenesInput = scenesArr.length > 0
                                const targetType = typeof sceneTarget === 'number' ? (scenesArr[sceneTarget]?.type || 'scene').replace(/_/g, ' ') : ''
                                const dynamicPlaceholder = !hasScenesInput
                                    ? 'Describe your vision...'
                                    : sceneTarget === 'add'
                                        ? `Describe Scene ${scenesArr.length + 1} to add...`
                                        : `Describe changes to Scene ${(sceneTarget as number) + 1} (${targetType})...`
                                return (
                            <div className="p-4 border-t border-border shrink-0 bg-white/80">
                                {/* Scene targeting selector — only after the first prompt has created scenes */}
                                {hasScenesInput && (
                                    <div className="flex items-center gap-2 mb-2">
                                        <select
                                            value={sceneTarget === 'add' ? 'add' : String(sceneTarget)}
                                            onChange={(e) => setSceneTarget(e.target.value === 'add' ? 'add' : Number(e.target.value))}
                                            disabled={sending || isGenerating}
                                            title="Choose which scene to edit, or add a new one"
                                            className="flex-1 text-xs rounded-lg border border-border bg-muted/40 px-2.5 py-2 text-foreground focus:ring-2 focus:ring-primary/20 disabled:opacity-50 cursor-pointer"
                                        >
                                            <option value="add">➕ Add New Scene (Scene {scenesArr.length + 1})</option>
                                            {scenesArr.map((s: any, i: number) => (
                                                <option key={i} value={i}>✏️ Edit Scene {i + 1} — {(s.type || 'scene').replace(/_/g, ' ')}</option>
                                            ))}
                                        </select>
                                    </div>
                                )}
                                <div className="flex gap-2">
                                    <input ref={imageInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleImageUpload} />
                                    <button
                                        onClick={() => imageInputRef.current?.click()}
                                        disabled={uploading}
                                        title="Upload reference images"
                                        className="p-2.5 rounded-xl border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors cursor-pointer disabled:opacity-50 shrink-0 self-end"
                                    >
                                        {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImagePlus className="w-4 h-4" />}
                                    </button>
                                    <button
                                        onClick={handleEnhancePrompt}
                                        disabled={!chatInput.trim() || enhancing || sending || isGenerating}
                                        title="Enhance prompt with AI (fills the box for you to review)"
                                        className="p-2.5 rounded-xl border border-primary/40 text-primary hover:bg-primary/10 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shrink-0 self-end"
                                    >
                                        {enhancing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                                    </button>
                                    <textarea
                                        id="chat-input"
                                        ref={textareaRef}
                                        value={chatInput}
                                        onChange={(e) => setChatInput(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' && !e.shiftKey) {
                                                e.preventDefault()
                                                handleSendWithImages()
                                            }
                                        }}
                                        placeholder={dynamicPlaceholder}
                                        disabled={sending || isGenerating}
                                        rows={1}
                                        className="flex-1 px-4 py-2.5 rounded-xl bg-muted/40 border border-border text-foreground placeholder:text-muted-foreground/50 text-sm focus:ring-2 focus:ring-primary/20 disabled:opacity-50 resize-none min-h-[42px] max-h-48 overflow-y-auto"
                                    />
                                    <button
                                        id="send-btn"
                                        onClick={handleSendWithImages}
                                        disabled={(!chatInput.trim() && uploadedImages.length === 0) || sending || isGenerating}
                                        className="p-2.5 rounded-xl bg-primary text-white hover:bg-primary/90 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-sm self-end"
                                    >
                                        <Send className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>
                                )
                            })()}
                        </>
                    ) : (
                        /* Theme Panel */
                        <div className="flex-1 overflow-y-auto p-4 space-y-6">
                            <div>
                                <h3 className="text-sm font-bold text-foreground mb-3">Color Palette</h3>
                                <PalettePicker value={project.theme} onChange={handleThemeChange} compact />
                            </div>

                            {hasScenes && (
                                <div>
                                    <h3 className="text-sm font-bold text-foreground mb-3">
                                        Scene Breakdown ({(project.sceneData as any[]).length} scenes)
                                    </h3>
                                    <div className="space-y-2">
                                        {(project.sceneData as any[]).map((scene: any, i: number) => (
                                            <div key={i} className="p-3 rounded-xl bg-white border border-border/50 text-xs shadow-sm">
                                                <div className="flex items-center gap-2 mb-1">
                                                    <span className="px-1.5 py-0.5 rounded-md bg-primary/10 text-primary font-bold text-[10px] uppercase">
                                                        {scene.type?.replace('_', ' ')}
                                                    </span>
                                                    <span className="text-muted-foreground">{scene.durationSec || 5}s</span>
                                                </div>
                                                <p className="text-foreground/80 line-clamp-2">
                                                    {scene.headline || scene.content || scene.subtext || '—'}
                                                </p>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Right Panel: Preview */}
                <div className="flex-1 flex flex-col items-center justify-center p-6 min-h-0">
                    {isFirstTimeGenerating ? (
                        <div className="text-center max-w-sm">
                            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary to-accent flex items-center justify-center mb-6 mx-auto shadow-lg shadow-primary/20 animate-pulse">
                                <Wand2 className="w-8 h-8 text-white" />
                            </div>
                            <h3 className="text-lg font-bold text-foreground mb-2">Generating Your Video</h3>
                            <p className="text-sm text-muted-foreground mb-8">This may take a few minutes...</p>

                            <div className="space-y-3 text-left">
                                {STATUS_STEPS.map((step, i) => {
                                    const currentStatus = project.status || ''
                                    const currentIdx = STATUS_STEPS.findIndex(s => currentStatus.includes(s.key.split(':')[1]))
                                    const isDone = i < currentIdx
                                    const isActive = currentStatus.includes(step.key.split(':')[1])

                                    return (
                                        <div key={step.key} className={`flex items-center gap-3 p-3 rounded-xl border transition-all
                                            ${isActive
                                                ? 'bg-primary/5 border-primary/20 text-primary'
                                                : isDone
                                                    ? 'bg-emerald-50 border-emerald-200 text-emerald-600'
                                                    : 'bg-white border-border/50 text-muted-foreground'
                                            }
                                        `}>
                                            {isDone ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : isActive ? <Loader2 className="w-4 h-4 animate-spin" /> : step.icon}
                                            <span className="text-sm font-medium">{step.label}</span>
                                            {isActive && <span className="text-[10px] ml-auto opacity-60">In progress...</span>}
                                        </div>
                                    )
                                })}
                            </div>

                            <button
                                onClick={handleCancelGeneration}
                                className="mt-8 px-6 py-2 rounded-xl border border-border text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors cursor-pointer"
                            >
                                Cancel & Go Back
                            </button>
                        </div>
                    ) : hasRemotionProps ? (
                        <div className="w-full max-w-2xl mx-auto">
                            {/* Large renders (≥44 MB) are chunked into Appwrite and stored as JSON
                                metadata, not a playable URL — stream those through the reassembly
                                endpoint. Direct single-file URLs play as-is. */}
                            {(() => {
                                const isChunked = !!project.videoUrl && (project.videoUrl.trim().startsWith('{') || project.videoUrl.includes('"chunked"'))
                                const playbackUrl = project.videoUrl
                                    ? (isChunked ? `/api/motion-graphics/${project.projectId}/stream` : project.videoUrl)
                                    : null
                                return (
                                <>
                                    {showFinalPlayer && playbackUrl ? (
                                        /* Nothing has changed since the last render — show the real
                                           delivered MP4 (lighter weight than a live composition). */
                                        <ChapteredVideoPlayer
                                            src={playbackUrl}
                                            scenes={(project.sceneData as any[]) || []}
                                            aspectRatio={project.aspectRatio}
                                        />
                                    ) : (
                                        <>
                                            {/* Live in-browser preview — reflects theme/color edits
                                                instantly, no re-render needed to see them. */}
                                            <LiveMotionGraphicPlayer
                                                remotionProps={project.remotionProps}
                                                aspectRatio={project.aspectRatio}
                                            />
                                            {isRenderInProgress && (
                                                <div className="flex items-center justify-center gap-2 mb-3 -mt-1 text-xs font-semibold text-primary">
                                                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> Rendering final video in the background — keep previewing, it'll swap in automatically
                                                </div>
                                            )}
                                            {!isRenderInProgress && isDirty && (
                                                <p className="text-center text-[11px] text-amber-600 font-medium mb-3 -mt-1">
                                                    Unsaved color changes — export to bake them into the downloadable video
                                                </p>
                                            )}
                                        </>
                                    )}
                                    <div className="flex items-center justify-center gap-3 flex-wrap">
                                        {playbackUrl && (
                                            <a
                                                href={playbackUrl}
                                                download={`motion-graphic-${project.projectId}.mp4`}
                                                className="group relative px-6 py-2.5 rounded-xl bg-gradient-to-r from-primary to-accent text-white text-sm font-bold transition-all hover:shadow-lg hover:shadow-primary/20 flex items-center gap-2 overflow-hidden"
                                            >
                                                <div className="absolute inset-0 bg-white/20 translate-y-[-100%] group-hover:translate-y-[100%] transition-transform duration-700 pointer-events-none" />
                                                <Download className="w-4 h-4" /> Download Video
                                            </a>
                                        )}
                                        <button
                                            onClick={handleExport}
                                            disabled={isExporting || isRenderInProgress}
                                            className="px-4 py-2.5 rounded-xl border border-primary/40 text-sm text-primary hover:bg-primary/10 transition-colors cursor-pointer flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            {isExporting || isRenderInProgress ? <Loader2 className="w-4 h-4 animate-spin" /> : <Rocket className="w-4 h-4" />}
                                            {playbackUrl ? 'Export Video' : 'Render Video'}
                                        </button>
                                        <button
                                            onClick={() => setProject(prev => prev ? { ...prev, status: 'draft', remotionProps: null, videoUrl: null } : prev)}
                                            className="px-4 py-2.5 rounded-xl border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors cursor-pointer flex items-center gap-2"
                                        >
                                            <RefreshCw className="w-4 h-4" /> Regenerate
                                        </button>
                                        <button
                                            onClick={handleStartFromScratch}
                                            className="px-4 py-2.5 rounded-xl border border-destructive/40 text-sm text-destructive hover:bg-destructive/5 transition-colors cursor-pointer flex items-center gap-2"
                                        >
                                            <RotateCcw className="w-4 h-4" /> Start from Scratch
                                        </button>
                                    </div>
                                </>
                                )
                            })()}
                        </div>
                    ) : hasScenes ? (
                        <div className="w-full max-w-lg mx-auto">
                            <div className="text-center mb-6">
                                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary to-accent flex items-center justify-center mx-auto mb-4 shadow-lg shadow-primary/20">
                                    <Sparkles className="w-7 h-7 text-white" />
                                </div>
                                <h3 className="text-lg font-bold text-foreground mb-1">
                                    {(project.sceneData as any[]).length} Scenes Ready
                                </h3>
                                <p className="text-xs text-muted-foreground">
                                    Review below, pick a theme, then generate.
                                </p>
                            </div>

                            {/* Scene Cards */}
                            <input ref={sceneAssetInputRef} type="file" accept="image/*,video/*" className="hidden" onChange={handleSceneAssetUpload} />
                            <div className="space-y-3 mb-6 max-h-[380px] overflow-y-auto pr-1">
                                {(project.sceneData as any[]).map((scene: any, i: number) => (
                                    <div key={i} className="flex gap-3 p-4 rounded-2xl bg-white border border-border/50 shadow-sm hover:shadow-md transition-shadow">
                                        <div className="shrink-0 w-9 h-9 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center text-white text-sm font-bold shadow-sm">
                                            {i + 1}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 mb-1">
                                                <span className="px-1.5 py-0.5 rounded-md bg-primary/10 text-primary font-bold text-[10px] uppercase">
                                                    {scene.type?.replace(/_/g, ' ') || 'scene'}
                                                </span>
                                                <span className="text-[10px] text-muted-foreground">{scene.durationSec || 5}s</span>
                                            </div>
                                            <p className="text-sm font-semibold text-foreground leading-snug truncate capitalize">
                                                {scene.headline || scene.title || scene.content || scene.text ||
                                                 (scene.stat?.value ? `${scene.stat.prefix || ''}${scene.stat.value}${scene.stat.suffix || ''} ${scene.stat.label || ''}` : null) ||
                                                 (scene.type === 'search_reveal' ? 'Search Animation' : null) ||
                                                 (scene.type === 'feature_list' ? 'Feature List' : null) ||
                                                 scene.type.replace(/_/g, ' ')}
                                            </p>
                                            {(scene.subtext || scene.description || (scene.items && scene.items.length > 0)) && (
                                                <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2 mt-0.5">
                                                    {scene.subtext || scene.description || (scene.items ? scene.items.map((i: any) => i.label || i.value || i.text).filter(Boolean).join(' • ') : '')}
                                                </p>
                                            )}
                                            {scene.voiceoverLine && (
                                                <p className="text-[11px] text-primary/70 mt-1 flex items-center gap-1">
                                                    <Mic className="w-3 h-3" /> {scene.voiceoverLine.substring(0, 60)}...
                                                </p>
                                            )}
                                            {/* Per-scene asset attach */}
                                            <div className="mt-2">
                                                {scene.userAsset ? (
                                                    <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-primary/10 border border-primary/20">
                                                        {scene.assetType === 'video'
                                                            ? <Play className="w-3 h-3 text-primary" />
                                                            : <ImagePlus className="w-3 h-3 text-primary" />}
                                                        <span className="text-[10px] font-semibold text-primary">
                                                            {scene.assetType === 'video' ? 'Video attached' : 'Image attached'}
                                                        </span>
                                                        <button
                                                            onClick={() => handleRemoveSceneAsset(i)}
                                                            disabled={assetUploadingIndex === i}
                                                            className="ml-1 text-primary/60 hover:text-destructive transition-colors cursor-pointer disabled:opacity-50"
                                                            title="Remove attached asset"
                                                        >
                                                            {assetUploadingIndex === i ? <Loader2 className="w-3 h-3 animate-spin" /> : <X className="w-3 h-3" />}
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <button
                                                        onClick={() => openSceneAssetPicker(i)}
                                                        disabled={assetUploadingIndex === i}
                                                        className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg border border-border/50 text-[10px] font-semibold text-muted-foreground hover:text-primary hover:border-primary/30 hover:bg-primary/5 transition-colors cursor-pointer disabled:opacity-50"
                                                    >
                                                        {assetUploadingIndex === i ? <Loader2 className="w-3 h-3 animate-spin" /> : <ImagePlus className="w-3 h-3" />}
                                                        Attach image/video
                                                    </button>
                                                )}
                                            </div>
                                            {/* Per-scene color override */}
                                            <div className="mt-2 relative">
                                                {scene.customColors ? (
                                                    <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-primary/10 border border-primary/20">
                                                        <div className="flex gap-0.5">
                                                            {[scene.colors?.bg, scene.colors?.accent, scene.colors?.secondary].filter(Boolean).map((c: string, ci: number) => (
                                                                <div key={ci} className="w-3 h-3 rounded-full border border-white/40" style={{ background: c }} />
                                                            ))}
                                                        </div>
                                                        <span className="text-[10px] font-semibold text-primary">Custom colors</span>
                                                        <button
                                                            onClick={() => handleResetSceneColor(i)}
                                                            disabled={colorSavingIndex === i}
                                                            className="ml-1 text-primary/60 hover:text-destructive transition-colors cursor-pointer disabled:opacity-50"
                                                            title="Reset to theme"
                                                        >
                                                            {colorSavingIndex === i ? <Loader2 className="w-3 h-3 animate-spin" /> : <X className="w-3 h-3" />}
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <button
                                                        onClick={() => setColorPickerIndex(colorPickerIndex === i ? null : i)}
                                                        disabled={colorSavingIndex === i}
                                                        className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg border border-border/50 text-[10px] font-semibold text-muted-foreground hover:text-primary hover:border-primary/30 hover:bg-primary/5 transition-colors cursor-pointer disabled:opacity-50"
                                                    >
                                                        {colorSavingIndex === i ? <Loader2 className="w-3 h-3 animate-spin" /> : <Palette className="w-3 h-3" />}
                                                        Customize colors
                                                    </button>
                                                )}
                                                {colorPickerIndex === i && (
                                                    <div className="absolute z-20 top-full left-0 mt-2 p-4 rounded-xl bg-white border border-border shadow-xl w-80">
                                                        <PalettePicker
                                                            value={null}
                                                            onChange={(theme) => handleSceneColorChange(i, theme)}
                                                            compact
                                                        />
                                                        <button
                                                            onClick={() => setColorPickerIndex(null)}
                                                            className="mt-3 w-full py-1.5 rounded-lg border border-border text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors cursor-pointer"
                                                        >
                                                            Done
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            <button
                                onClick={handleGenerate}
                                disabled={generating}
                                className="group relative w-full py-3.5 rounded-2xl text-sm font-bold bg-gradient-to-r from-primary to-accent text-white hover:shadow-xl hover:shadow-primary/20 transition-all cursor-pointer flex items-center justify-center gap-2 overflow-hidden"
                            >
                                <div className="absolute inset-0 bg-white/20 translate-y-[-100%] group-hover:translate-y-[100%] transition-transform duration-700 pointer-events-none" />
                                {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                                Generate Video
                            </button>
                            <button
                                onClick={handleStartFromScratch}
                                className="w-full py-2.5 rounded-2xl border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors cursor-pointer flex items-center justify-center gap-2 mt-2"
                            >
                                <RotateCcw className="w-3.5 h-3.5" /> Start from Scratch
                            </button>
                            <p className="text-center text-[11px] text-muted-foreground/60 mt-2">
                                You can keep chatting to refine scenes before generating
                            </p>
                        </div>
                    ) : (
                        <div className="text-center max-w-sm">
                            <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center mx-auto mb-4">
                                <MessageSquare className="w-7 h-7 text-muted-foreground" />
                            </div>
                            <h3 className="text-lg font-bold text-foreground mb-2">Start a Conversation</h3>
                            <p className="text-sm text-muted-foreground max-w-[280px] mx-auto">
                                Chat with the AI on the left to describe your motion graphic. It will generate animated scenes for your video.
                            </p>
                            <div className="mt-6 flex items-center gap-2 text-xs text-muted-foreground/60 justify-center">
                                <ChevronRight className="w-3 h-3" />
                                <span>Try typing your initial prompt in the chat</span>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
