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
} from 'lucide-react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

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
    theme: any
    sceneData: any[]
    voiceoverScript: string | null
    audioUrl: string | null
    remotionProps: any
    videoUrl: string | null
    status: string
    createdAt: string
}

// ─── Theme Palettes ──────────────────────────────────────────────────────────

const THEME_PALETTES = [
    { id: 'midnight', name: 'Midnight',  colors: ['#0a0a0f', '#6366f1', '#818cf8'] },
    { id: 'sunset',   name: 'Sunset',    colors: ['#1a0a0a', '#f97316', '#fb923c'] },
    { id: 'ocean',    name: 'Ocean',     colors: ['#0a1628', '#06b6d4', '#22d3ee'] },
    { id: 'emerald',  name: 'Emerald',   colors: ['#0a1a0a', '#10b981', '#34d399'] },
    { id: 'rose',     name: 'Rose',      colors: ['#1a0a14', '#f43f5e', '#fb7185'] },
    { id: 'neon',     name: 'Neon',      colors: ['#000000', '#a855f7', '#c084fc'] },
]

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

    // Auto-send the project prompt as the first chat message
    useEffect(() => {
        // Only user/assistant messages count — system messages are inserted on creation
        const hasUserMessages = messages.some(m => m.role === 'user' || m.role === 'assistant')
        if (
            !loading &&
            project &&
            project.prompt &&
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
            // Send to API: user text + image context combined internally
            const messageForAI = imageContext
                ? `${userText}\n\n${imageContext}`
                : userText || `I've uploaded reference images. Please use them in relevant scenes.`

            const res = await fetch(`/api/motion-graphics/${projectId}/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: messageForAI }),
            })
            const data = await res.json()
            if (data.success) {
                const aiMsg: Message = { id: Date.now() + 1, role: 'assistant', content: data.reply, metadata: data.scenesData ? { type: 'scene_update', sceneData: data.scenesData } : null, createdAt: new Date().toISOString() }
                setMessages(prev => [...prev, aiMsg])
                if (data.scenesData?.scenes) { fetchProject(); toast.success('Scenes generated!') }
            } else { toast.error(data.error || 'Failed') }
        } catch { toast.error('Failed to send') } finally { setSending(false) }
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

    const handleThemeChange = async (palette: string) => {
        try {
            const res = await fetch(`/api/motion-graphics/${projectId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ theme: { ...project?.theme, palette } }),
            })
            const data = await res.json()
            if (data.success) {
                setProject(data.project)
                toast.success(`Theme set to ${palette}`)
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

    const isGenerating = project.status?.startsWith('generating')
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
                                                return (
                                                    <>
                                                        {cleaned || 'Sent reference images'}
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
                            <div className="p-4 border-t border-border shrink-0 bg-white/80">
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
                                        placeholder="Describe your vision..."
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
                        </>
                    ) : (
                        /* Theme Panel */
                        <div className="flex-1 overflow-y-auto p-4 space-y-6">
                            <div>
                                <h3 className="text-sm font-bold text-foreground mb-3">Color Palette</h3>
                                <div className="grid grid-cols-2 gap-3">
                                    {THEME_PALETTES.map((palette) => {
                                        const isActive = project.theme?.palette === palette.id
                                        return (
                                            <button
                                                key={palette.id}
                                                onClick={() => handleThemeChange(palette.id)}
                                                className={`p-3 rounded-xl border transition-all cursor-pointer text-left
                                                    ${isActive
                                                        ? 'border-primary/40 bg-primary/5 shadow-sm'
                                                        : 'border-border/50 bg-white/60 hover:bg-muted/30 hover:border-border'
                                                    }
                                                `}
                                            >
                                                <div className="flex gap-1.5 mb-2">
                                                    {palette.colors.map((c, i) => (
                                                        <div key={i} className="w-6 h-6 rounded-full border border-border/30 shadow-sm" style={{ background: c }} />
                                                    ))}
                                                </div>
                                                <span className={`text-xs font-semibold ${isActive ? 'text-primary' : 'text-foreground'}`}>{palette.name}</span>
                                            </button>
                                        )
                                    })}
                                </div>
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
                    {isGenerating ? (
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
                    ) : isCompleted ? (
                        <div className="w-full max-w-2xl mx-auto">
                            {project.videoUrl ? (
                                <>
                                    {/* Real video player */}
                                    <div className="rounded-2xl overflow-hidden bg-black border border-border shadow-xl mb-4"
                                        style={{
                                            aspectRatio: project.aspectRatio === '9:16' ? '9/16' : project.aspectRatio === '1:1' ? '1/1' : '16/9',
                                            maxHeight: '500px',
                                        }}
                                    >
                                        <video
                                            src={project.videoUrl}
                                            controls
                                            autoPlay
                                            loop
                                            className="w-full h-full object-contain"
                                        />
                                    </div>
                                    <div className="flex items-center justify-center gap-3">
                                        <a
                                            href={project.videoUrl}
                                            download={`motion-graphic-${project.projectId}.mp4`}
                                            className="group relative px-6 py-2.5 rounded-xl bg-gradient-to-r from-primary to-accent text-white text-sm font-bold transition-all hover:shadow-lg hover:shadow-primary/20 flex items-center gap-2 overflow-hidden"
                                        >
                                            <div className="absolute inset-0 bg-white/20 translate-y-[-100%] group-hover:translate-y-[100%] transition-transform duration-700 pointer-events-none" />
                                            <Download className="w-4 h-4" /> Download Video
                                        </a>
                                        <button
                                            onClick={() => setProject(prev => prev ? { ...prev, status: 'draft', remotionProps: null, videoUrl: null } : prev)}
                                            className="px-4 py-2.5 rounded-xl border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors cursor-pointer flex items-center gap-2"
                                        >
                                            <RefreshCw className="w-4 h-4" /> Regenerate
                                        </button>
                                    </div>
                                </>
                            ) : (
                                /* remotionProps saved but video still being finalized */
                                <div className="text-center py-12">
                                    <div className="w-14 h-14 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center justify-center mx-auto mb-4">
                                        <CheckCircle2 className="w-7 h-7 text-emerald-500" />
                                    </div>
                                    <h3 className="text-lg font-bold text-foreground mb-1">Video Ready!</h3>
                                    <p className="text-sm text-muted-foreground">Your motion graphic has been generated.</p>
                                </div>
                            )}
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
