"use client"

import { useUser } from '@clerk/nextjs'
import {
    BookOpen,
    Brain,
    Clock,
    FileText,
    GraduationCap,
    Grid3X3,
    ImagePlus,
    LayoutGrid,
    Loader2,
    PenTool,
    Sparkles,
    Trash2,
    Type,
    Upload,
    X,
    Paintbrush,
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from '@/components/ui/dialog'

// ─── Types ───────────────────────────────────────────────────
interface NoteProject {
    id: number
    noteId: string
    title: string
    sourceType: string
    noteStyle: string
    pageDesign: string
    theme: string
    status: string
    generatedData: any
    thumbnailUrl: string | null
    createdAt: string
}

// ─── Style Options ───────────────────────────────────────────
const NOTE_STYLES = [
    { value: 'cornell',      label: 'Cornell',      icon: <BookOpen className="w-4 h-4" />,      desc: 'Classic two-column study notes',     color: 'from-violet-500 to-purple-500' },
    { value: 'mindmap',      label: 'Mind Map',     icon: <Brain className="w-4 h-4" />,         desc: 'Visual hierarchical layout',         color: 'from-cyan-500 to-blue-500' },
    { value: 'flashcard',    label: 'Flashcards',   icon: <Grid3X3 className="w-4 h-4" />,       desc: 'Term → definition cards',            color: 'from-amber-500 to-orange-500' },
    { value: 'infographic',  label: 'Infographic',  icon: <LayoutGrid className="w-4 h-4" />,    desc: 'Visual summary with stats & icons',  color: 'from-emerald-500 to-green-500' },
    { value: 'cheatsheet',   label: 'Cheat Sheet',  icon: <FileText className="w-4 h-4" />,      desc: 'Dense reference with code blocks',   color: 'from-rose-500 to-pink-500' },
    { value: 'timeline',     label: 'Timeline',     icon: <Clock className="w-4 h-4" />,         desc: 'Chronological event layout',         color: 'from-indigo-500 to-violet-500' },
]

const PAGE_DESIGNS = [
    { value: 'botanical',      label: 'Botanical',       img: '/notes-design/d3.png',  desc: 'Sage green organic blobs, leaves & rings' },
    { value: 'abstractPastel',  label: 'Abstract Pastel', img: '/notes-design/d1.jpg',  desc: 'Pink blobs, dots, dashes & flower shapes' },
    { value: 'geoPebbles',      label: 'Geo Pebbles',     img: '/notes-design/d2.png',  desc: 'Colorful hand-drawn pebble border' },
    { value: 'elegantLeaf',     label: 'Elegant Leaf',    img: '/notes-design/d4.png',  desc: 'Gold framed with navy blue leaf accents' },
]

const SOURCE_TYPES = [
    { value: 'topic',    label: 'Topic / Heading',  icon: <Type className="w-4 h-4" />,       desc: 'Just provide a topic — AI generates everything' },
    { value: 'text',     label: 'Paste Content',    icon: <PenTool className="w-4 h-4" />,    desc: 'Paste your raw notes, articles, or text' },
    { value: 'document', label: 'Upload Document',  icon: <Upload className="w-4 h-4" />,     desc: 'Upload PDF, images — Vision AI extracts content' },
]

export default function NotesPage() {
    const { isSignedIn } = useUser()
    const router = useRouter()

    // Form state
    const [title, setTitle] = useState('')
    const [sourceContent, setSourceContent] = useState('')
    const [noteStyle, setNoteStyle] = useState('cornell')
    const [pageDesign, setPageDesign] = useState('botanical')
    const [designDialogOpen, setDesignDialogOpen] = useState(false)
    const [isCreating, setIsCreating] = useState(false)
    const [uploadedAssets, setUploadedAssets] = useState<Array<{ file: File; preview: string; name: string }>>([])
    const assetInputRef = useRef<HTMLInputElement>(null)

    // Auto-detect source type based on what user provides
    const getSourceType = () => {
        if (tempNoteId && extractedContent) return 'document'
        if (uploadedAssets.some(a => a.file.type.includes('pdf') || a.file.type.startsWith('image/'))) return 'document'
        if (sourceContent.trim().length > 20) return 'text'
        return 'topic'
    }

    // Sarvam extraction state
    const [processingDoc, setProcessingDoc] = useState(false)
    const [extractedContent, setExtractedContent] = useState('')
    const [tempNoteId, setTempNoteId] = useState<string | null>(null)

    // Projects
    const [projects, setProjects] = useState<NoteProject[]>([])
    const [loadingProjects, setLoadingProjects] = useState(true)

    const fetchProjects = useCallback(async () => {
        try {
            const res = await fetch('/api/notes')
            const data = await res.json()
            if (data.success) setProjects(data.projects || [])
        } catch {
            console.error('Failed to fetch notes')
        } finally {
            setLoadingProjects(false)
        }
    }, [])

    useEffect(() => {
        if (isSignedIn) fetchProjects()
    }, [isSignedIn, fetchProjects])

    // Immediately process document with Sarvam on upload
    const handleAssetSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || [])
        if (!files.length) return
        const newAssets = files.map(file => ({
            file,
            preview: URL.createObjectURL(file),
            name: file.name,
        }))
        setUploadedAssets(prev => [...prev, ...newAssets])
        if (assetInputRef.current) assetInputRef.current.value = ''

        // Auto-process documents (PDF/image) with Sarvam/Groq
        const docFile = files.find(f => f.type.includes('pdf') || f.type.startsWith('image/'))
        if (docFile) {

            setProcessingDoc(true)
            setExtractedContent('')
            toast.info('📄 Processing document with Sarvam Vision...')

            try {
                // Auto-set title from filename if empty
                if (!title.trim()) {
                    const cleanName = docFile.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ')
                    setTitle(cleanName)
                }

                // Step 1: Create a temp project
                const projectTitle = title.trim() || docFile.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ')
                const createRes = await fetch('/api/notes', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        title: projectTitle,
                        sourceType: 'document',
                        sourceContent: null,
                        noteStyle,
                        pageDesign,
                    }),
                })
                const createData = await createRes.json()
                if (!createData.success || !createData.noteId) {
                    throw new Error(createData.error || 'Failed to create project')
                }
                setTempNoteId(createData.noteId)

                // Step 2: Send file as raw binary to our API (server proxies to Azure — no CORS)
                toast.info('⬆️ Uploading & processing with Sarvam Vision...')
                const procRes = await fetch(`/api/notes/${createData.noteId}/process-doc`, {
                    method: 'POST',
                    headers: {
                        'x-filename': docFile.name,
                        'x-content-type': docFile.type || 'application/pdf',
                    },
                    body: docFile,   // Raw File object as binary body
                })
                const procData = await procRes.json()

                if (procData.success && procData.extractedText) {
                    setExtractedContent(procData.extractedText)
                    toast.success(`✅ Document extracted! (${procData.charCount?.toLocaleString()} chars)`)
                } else {
                    toast.error(`Sarvam processing failed: ${procData.error || 'Unknown error'}`)
                }
            } catch (err: any) {
                toast.error(`Document processing failed: ${err.message}`)
                console.error(err)
            } finally {
                setProcessingDoc(false)
            }
        }
    }

    const removeAsset = (index: number) => {
        setUploadedAssets(prev => {
            const removed = prev[index]
            if (removed?.preview) URL.revokeObjectURL(removed.preview)
            return prev.filter((_, i) => i !== index)
        })
        // Clear extracted content if removing the document
        if (getSourceType() === 'document' && uploadedAssets.length <= 1) {
            setExtractedContent('')
            setTempNoteId(null)
        }
    }

    const handleCreate = async () => {
        if (!title.trim() || title.trim().length < 2) {
            toast.error('Please enter a title (at least 2 characters)')
            return
        }
        setIsCreating(true)
        try {
            // If document was already processed, use the existing project
            const sourceType = getSourceType()
            if (tempNoteId && sourceType === 'document' && extractedContent) {
                // Upload any image assets FIRST (so they appear in the notes)
                if (uploadedAssets.length > 0) {
                    toast.info(`Uploading ${uploadedAssets.length} asset(s)...`)
                    for (const asset of uploadedAssets) {
                        try {
                            const formData = new FormData()
                            formData.append('file', asset.file)
                            await fetch(`/api/notes/${tempNoteId}/upload`, { method: 'POST', body: formData })
                        } catch {}
                    }
                }

                toast.info('🧠 Generating notes from extracted content...')

                // Update pageDesign/noteStyle on the temp project (user may have changed after upload)
                await fetch(`/api/notes/${tempNoteId}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ pageDesign, noteStyle }),
                })

                const genRes = await fetch(`/api/notes/${tempNoteId}/generate`, { method: 'POST' })
                const genData = await genRes.json()
                if (genData.success) {
                    toast.success('Notes generated!')
                } else {
                    toast.error('Generation had issues, but your project is saved')
                }
                router.push(`/notes/${tempNoteId}`)
                return
            }

            // 1. Create the project
            const detectedSourceType = getSourceType()
            const res = await fetch('/api/notes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: title.trim(),
                    sourceType: detectedSourceType,
                    sourceContent: sourceContent.trim() || null,
                    noteStyle,
                    pageDesign,
                }),
            })
            const data = await res.json()

            if (data.success && data.noteId) {
                // 2. Upload image assets if any (non-document mode)
                if (uploadedAssets.length > 0) {
                    toast.info(`Uploading ${uploadedAssets.length} asset(s)...`)
                    for (const asset of uploadedAssets) {
                        try {
                            const formData = new FormData()
                            formData.append('file', asset.file)
                            await fetch(`/api/notes/${data.noteId}/upload`, { method: 'POST', body: formData })
                        } catch {}
                    }
                }

                // 3. Generate notes directly (text/topic mode)
                toast.info('🧠 Generating notes with AI...')
                const genRes = await fetch(`/api/notes/${data.noteId}/generate`, { method: 'POST' })
                const genData = await genRes.json()

                if (genData.success) {
                    toast.success('Notes generated!')
                } else {
                    toast.error('Generation had issues, but your project is saved')
                }

                router.push(`/notes/${data.noteId}`)
            } else {
                toast.error(data.error || 'Failed to create notes')
            }
        } catch {
            toast.error('Something went wrong')
        } finally {
            setIsCreating(false)
        }
    }

    const handleDelete = async (noteId: string, e: React.MouseEvent) => {
        e.preventDefault()
        e.stopPropagation()
        if (!confirm('Delete this note?')) return
        try {
            await fetch(`/api/notes/${noteId}`, { method: 'DELETE' })
            setProjects(prev => prev.filter(p => p.noteId !== noteId))
            toast.success('Note deleted')
        } catch {
            toast.error('Failed to delete')
        }
    }

    const getStatusBadge = (status: string) => {
        if (status === 'completed') return { text: 'Ready', cls: 'bg-emerald-50 text-emerald-600 border-emerald-200' }
        if (status === 'failed') return { text: 'Failed', cls: 'bg-red-50 text-red-600 border-red-200' }
        if (status === 'generating') return { text: 'Generating', cls: 'bg-amber-50 text-amber-600 border-amber-200' }
        return { text: 'Draft', cls: 'bg-blue-50 text-blue-600 border-blue-200' }
    }

    const getStyleIcon = (style: string) => {
        const found = NOTE_STYLES.find(s => s.value === style)
        return found?.icon || <BookOpen className="w-4 h-4" />
    }

    const getStyleColor = (style: string) => {
        const found = NOTE_STYLES.find(s => s.value === style)
        return found?.color || 'from-violet-500 to-purple-500'
    }

    return (
        <div className="relative min-h-screen bg-muted/20 pb-20">
            <div className="relative z-10 max-w-5xl mx-auto px-6 pt-0 pb-16 -mt-4 md:-mt-6">

                {/* ─── Header ────────────────────────────────────── */}
                <div className="text-center mb-10">
                    <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white border border-border mb-5 shadow-sm">
                        <GraduationCap className="w-4 h-4 text-primary" />
                        <span className="text-sm font-medium text-foreground">Notes Generator</span>
                    </div>
                    <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-4 leading-tight text-foreground">
                        Smart Notes,{" "}
                        <span className="text-primary border-b border-primary/30">
                            Beautifully Crafted.
                        </span>
                    </h1>
                    <p className="text-muted-foreground max-w-lg mx-auto leading-relaxed">
                        Paste content, upload documents, or just give a topic — AI generates
                        stunning, exportable study notes in seconds.
                    </p>
                </div>

                {/* ─── Creator Card ──────────────────────────────── */}
                <div className="relative max-w-4xl mx-auto rounded-2xl border border-border/50 bg-white/70 backdrop-blur-sm p-7 md:p-8 shadow-[0_2px_10px_-3px_rgba(0,0,0,0.05)] hover:shadow-lg hover:shadow-black/5 transition-all duration-300 overflow-hidden">
                    <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-primary/5 to-accent/5 opacity-0 hover:opacity-100 transition-opacity duration-500 pointer-events-none" />

                    <div className="relative z-10 space-y-6">
                        {/* Title */}
                        <div>
                            <label className="text-sm font-bold text-foreground mb-2 block">
                                Note Title / Topic
                            </label>
                            <input
                                type="text"
                                value={title}
                                onChange={(e) => setTitle(e.target.value)}
                                placeholder="e.g. Machine Learning Fundamentals, React Hooks Guide, World War II Timeline..."
                                className="w-full px-4 py-3 rounded-xl bg-muted/40 border border-border text-foreground placeholder:text-muted-foreground/50 focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-all text-[15px]"
                            />
                        </div>

                        {/* Content Input (always visible) */}
                        <div>
                            <label className="text-sm font-bold text-foreground mb-2 block">
                                Content <span className="text-xs font-normal text-muted-foreground/70">(optional — leave empty to generate from topic)</span>
                            </label>
                            <textarea
                                value={sourceContent}
                                onChange={(e) => setSourceContent(e.target.value)}
                                placeholder="Paste your raw notes, article text, lecture transcript... or leave empty and AI will generate from the topic title above."
                                rows={4}
                                className="w-full px-4 py-3 rounded-xl bg-muted/40 border border-border text-foreground placeholder:text-muted-foreground/50 focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-all resize-none text-[14px] leading-relaxed"
                            />
                        </div>

                        {/* Upload Assets (for all source types) */}
                        <div>
                            <label className="text-sm font-bold text-foreground mb-2.5 flex items-center gap-2">
                                <ImagePlus className="w-4 h-4 text-muted-foreground" /> Upload Assets
                                <span className="text-xs font-normal text-muted-foreground/70">(Charts, screenshots, diagrams, PDFs — Vision AI will analyze & embed them)</span>
                            </label>
                            <input
                                ref={assetInputRef}
                                type="file"
                                accept="image/*,.pdf"
                                multiple
                                className="hidden"
                                onChange={handleAssetSelect}
                            />
                            {uploadedAssets.length > 0 ? (
                                <div className="flex flex-wrap gap-3 mb-3">
                                    {uploadedAssets.map((asset, i) => (
                                        <div key={i} className="relative group">
                                            <div className="w-20 h-20 rounded-xl overflow-hidden border-2 border-border/50 shadow-sm hover:border-primary/30 transition-colors">
                                                {asset.file.type.startsWith('image/') ? (
                                                    <img src={asset.preview} alt={asset.name} className="w-full h-full object-cover" />
                                                ) : (
                                                    <div className="w-full h-full bg-muted/60 flex items-center justify-center">
                                                        <FileText className="w-6 h-6 text-muted-foreground" />
                                                    </div>
                                                )}
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
                                        <Upload className="w-5 h-5" />
                                    </div>
                                    <div className="text-left">
                                        <p className="text-sm font-semibold">Upload charts, images, screenshots, or PDFs</p>
                                        <p className="text-xs opacity-70">Vision AI will analyze and embed them into your notes</p>
                                    </div>
                                </button>
                            )}
                        </div>

                        {/* Sarvam Processing Status & Extracted Content */}
                        {processingDoc && (
                            <div className="rounded-xl border border-primary/20 bg-primary/5 p-5 animate-pulse">
                                <div className="flex items-center gap-3">
                                    <Loader2 className="w-5 h-5 text-primary animate-spin" />
                                    <div>
                                        <p className="text-sm font-bold text-foreground">Sarvam Vision is analyzing your document...</p>
                                        <p className="text-xs text-muted-foreground mt-0.5">This may take 15-60 seconds depending on document size</p>
                                    </div>
                                </div>
                            </div>
                        )}

                        {extractedContent && !processingDoc && (
                            <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-5 space-y-3">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <div className="w-7 h-7 rounded-lg bg-emerald-500/20 flex items-center justify-center">
                                            <FileText className="w-4 h-4 text-emerald-600" />
                                        </div>
                                        <div>
                                            <p className="text-sm font-bold text-emerald-800">📄 Sarvam Vision — Extracted Content</p>
                                            <p className="text-[10px] text-emerald-600">{extractedContent.length.toLocaleString()} characters extracted</p>
                                        </div>
                                    </div>
                                    <span className="text-[10px] font-bold text-emerald-600 bg-emerald-100 px-2 py-1 rounded-full">✅ Ready</span>
                                </div>
                                <div className="max-h-[300px] overflow-y-auto rounded-lg bg-white border border-emerald-200 p-4">
                                    <pre className="text-xs text-gray-800 font-mono whitespace-pre-wrap leading-relaxed">
                                        {extractedContent}
                                    </pre>
                                </div>
                                <p className="text-[10px] text-emerald-600/80">
                                    ↑ Review the extracted text above. When ready, select a style and click <strong>Generate Notes</strong>.
                                </p>
                            </div>
                        )}

                        {/* Note Style */}
                        <div>
                            <label className="text-sm font-bold text-foreground mb-2.5 block">
                                Note Style
                            </label>
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                                {NOTE_STYLES.map(style => (
                                    <button
                                        key={style.value}
                                        onClick={() => setNoteStyle(style.value)}
                                        className={`p-3 rounded-xl text-left transition-all cursor-pointer border
                                            ${noteStyle === style.value
                                                ? 'bg-primary/10 border-primary/25 text-primary shadow-sm'
                                                : 'bg-muted/30 border-border/50 text-muted-foreground hover:bg-muted/50 hover:border-border'
                                            }
                                        `}
                                    >
                                        <div className="flex items-center gap-2 mb-0.5">
                                            <div className={`w-6 h-6 rounded-lg bg-gradient-to-br ${style.color} flex items-center justify-center text-white`}>
                                                {style.icon}
                                            </div>
                                            <span className="text-xs font-bold">{style.label}</span>
                                        </div>
                                        <p className="text-[10px] opacity-60 leading-snug pl-8">{style.desc}</p>
                                    </button>
                                ))}
                            </div>
                        </div>



                        {/* Page Design */}
                        <div>
                            <label className="text-sm font-bold text-foreground mb-2.5 flex items-center gap-2">
                                <Paintbrush className="w-4 h-4 text-muted-foreground" /> Page Design
                            </label>
                            <button
                                type="button"
                                onClick={() => setDesignDialogOpen(true)}
                                className="w-full flex items-center gap-4 p-3 rounded-xl border border-border/50 hover:border-primary/30 hover:shadow-md transition-all cursor-pointer bg-muted/20 group"
                            >
                                {/* Selected design mini preview */}
                                <div className="w-16 h-20 rounded-lg overflow-hidden border border-border/50 shrink-0 shadow-sm group-hover:shadow-md transition-shadow">
                                    <img
                                        src={PAGE_DESIGNS.find(d => d.value === pageDesign)?.img || PAGE_DESIGNS[0].img}
                                        alt={PAGE_DESIGNS.find(d => d.value === pageDesign)?.label || 'Botanical'}
                                        className="w-full h-full object-cover"
                                    />
                                </div>
                                <div className="flex-1 text-left">
                                    <p className="text-sm font-bold text-foreground">
                                        {PAGE_DESIGNS.find(d => d.value === pageDesign)?.label || 'Botanical'}
                                    </p>
                                    <p className="text-[11px] text-muted-foreground">
                                        {PAGE_DESIGNS.find(d => d.value === pageDesign)?.desc || ''}
                                    </p>
                                </div>
                                <span className="text-xs font-semibold text-primary px-3 py-1.5 rounded-lg bg-primary/10 shrink-0">
                                    Change
                                </span>
                            </button>
                        </div>

                        {/* Page Design Dialog */}
                        <Dialog open={designDialogOpen} onOpenChange={setDesignDialogOpen}>
                            <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-hidden flex flex-col">
                                <DialogHeader className="shrink-0">
                                    <DialogTitle className="flex items-center gap-2 text-base">
                                        <Paintbrush className="w-4.5 h-4.5 text-primary" />
                                        Select Page Design
                                    </DialogTitle>
                                    <DialogDescription className="text-xs">
                                        Choose a decorative style for your note pages
                                    </DialogDescription>
                                </DialogHeader>
                                <div className="overflow-y-auto flex-1 -mx-2 px-2 pb-1">
                                    <div className="grid grid-cols-2 gap-3">
                                        {PAGE_DESIGNS.map(d => (
                                            <button
                                                key={d.value}
                                                onClick={() => {
                                                    setPageDesign(d.value)
                                                    setDesignDialogOpen(false)
                                                }}
                                                className={`group relative rounded-xl overflow-hidden border-2 transition-all cursor-pointer
                                                    ${pageDesign === d.value
                                                        ? 'border-primary ring-2 ring-primary/20 shadow-lg'
                                                        : 'border-border/50 hover:border-primary/30 hover:shadow-md'
                                                    }
                                                `}
                                            >
                                                <div className="h-36 relative overflow-hidden bg-muted/10">
                                                    <img
                                                        src={d.img}
                                                        alt={d.label}
                                                        className="w-full h-full object-cover object-top group-hover:scale-105 transition-transform duration-300"
                                                    />
                                                    {pageDesign === d.value && (
                                                        <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-primary flex items-center justify-center shadow-md">
                                                            <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                                            </svg>
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="px-2.5 py-2 bg-background text-center">
                                                    <p className={`text-xs font-bold ${pageDesign === d.value ? 'text-primary' : 'text-foreground'}`}>{d.label}</p>
                                                    <p className="text-[9px] text-muted-foreground leading-snug mt-0.5">{d.desc}</p>
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </DialogContent>
                        </Dialog>

                        {/* Create Button */}
                        <button
                            onClick={handleCreate}
                            disabled={isCreating || !title.trim()}
                            className={`group relative w-full py-3.5 rounded-2xl text-base font-bold transition-all cursor-pointer flex items-center justify-center gap-2.5 overflow-hidden
                                ${!title.trim() || isCreating
                                    ? 'bg-muted text-muted-foreground cursor-not-allowed'
                                    : 'bg-gradient-to-r from-primary to-accent text-white hover:shadow-xl hover:shadow-primary/20 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.99]'
                                }
                            `}
                        >
                            <div className="absolute inset-0 bg-white/20 translate-y-[-100%] group-hover:translate-y-[100%] transition-transform duration-700 ease-in-out pointer-events-none" />
                            {isCreating ? (
                                <><Loader2 className="w-5 h-5 animate-spin" /> Generating notes...</>
                            ) : (
                                <><Sparkles className="w-5 h-5" /> Generate Notes</>
                            )}
                        </button>
                    </div>
                </div>

                {/* ─── Your Notes ────────────────────────────────── */}
                <div className="mt-14">
                    <div className="flex items-center justify-between mb-6">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-md">
                                <BookOpen className="w-5 h-5 text-white" />
                            </div>
                            <div>
                                <h2 className="text-lg font-bold text-foreground">Your Notes</h2>
                                <p className="text-xs text-muted-foreground">{projects.length} note{projects.length !== 1 ? 's' : ''}</p>
                            </div>
                        </div>
                    </div>

                    {loadingProjects ? (
                        <div className="flex items-center justify-center py-16">
                            <Loader2 className="w-6 h-6 animate-spin text-primary" />
                        </div>
                    ) : projects.length === 0 ? (
                        <div className="text-center py-16 rounded-2xl bg-white/60 border border-dashed border-border">
                            <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center mx-auto mb-4">
                                <GraduationCap className="w-7 h-7 text-muted-foreground" />
                            </div>
                            <h3 className="text-base font-bold text-foreground mb-1">No notes yet</h3>
                            <p className="text-sm text-muted-foreground">Create your first beautiful notes above!</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                            {projects.map((project) => {
                                const badge = getStatusBadge(project.status)
                                return (
                                    <Link
                                        key={project.noteId}
                                        href={`/notes/${project.noteId}`}
                                        className="group relative rounded-2xl bg-white/80 backdrop-blur-md border border-white/40 hover:border-primary/20 overflow-hidden shadow-[0_2px_10px_-3px_rgba(0,0,0,0.05)] hover:shadow-[0_8px_30px_-4px_rgba(0,0,0,0.1)] hover:-translate-y-1 transition-all duration-300"
                                    >
                                        {/* Page Design Preview Thumbnail */}
                                        <div className="h-36 relative overflow-hidden bg-gray-50" style={{ borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
                                            {/* Design background image */}
                                            {(() => {
                                                const design = PAGE_DESIGNS.find(d => d.value === project.pageDesign) || PAGE_DESIGNS[0]
                                                const data = project.generatedData
                                                const sections = data?.mainNotes || data?.sections || []
                                                const firstSection = sections[0]
                                                return (
                                                    <>
                                                        {/* Background image */}
                                                        <img
                                                            src={design.img}
                                                            alt=""
                                                            className="absolute inset-0 w-full h-full object-cover pointer-events-none"
                                                        />
                                                        {/* Migoo watermark */}
                                                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ zIndex: 1 }}>
                                                            <img src="/logo-transparent.png" alt="" style={{ width: '80px', opacity: 0.07, transform: 'rotate(-45deg)' }} />
                                                        </div>
                                                        {/* Mini content overlay */}
                                                        <div className="absolute inset-0 p-3 flex flex-col" style={{ zIndex: 2 }}>
                                                            {/* Title */}
                                                            <p className="text-[10px] font-black text-gray-800 leading-tight line-clamp-1 mb-1.5" style={{ fontFamily: 'Georgia, serif' }}>
                                                                {project.title}
                                                            </p>
                                                            {/* Horizontal rule */}
                                                            <div className="w-full h-px bg-gray-300/60 mb-1.5" />
                                                            {/* First section */}
                                                            {firstSection && (
                                                                <div>
                                                                    <p className="text-[8px] font-bold text-gray-600 uppercase tracking-wide mb-1">{firstSection.heading || firstSection.title || ''}</p>
                                                                    {(firstSection.bullets || firstSection.points || []).slice(0, 3).map((b: string, bi: number) => (
                                                                        <div key={bi} className="flex items-start gap-1 mb-0.5">
                                                                            <div className="w-1 h-1 rounded-full bg-gray-400 mt-1 shrink-0" />
                                                                            <p className="text-[7px] text-gray-600 leading-tight line-clamp-1">{b}</p>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            )}
                                                            {/* Fake lines if no content yet */}
                                                            {!firstSection && (
                                                                <div className="space-y-1.5 mt-1">
                                                                    {[70, 90, 55, 80].map((w, i) => (
                                                                        <div key={i} className="h-1.5 rounded-full bg-gray-300/70" style={{ width: `${w}%` }} />
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </div>
                                                    </>
                                                )
                                            })()}
                                            {/* Status badge */}
                                            <div className={`absolute top-2 right-2 px-2 py-0.5 rounded-full text-[10px] font-bold border ${badge.cls}`} style={{ zIndex: 3 }}>
                                                {badge.text}
                                            </div>
                                        </div>

                                        <div className="p-4">
                                            <p className="text-sm font-bold text-foreground line-clamp-2 leading-snug mb-2">
                                                {project.title}
                                            </p>
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-[10px] text-muted-foreground px-1.5 py-0.5 rounded bg-muted/50 capitalize">
                                                        {project.noteStyle}
                                                    </span>
                                                    <span className="text-[10px] text-muted-foreground px-1.5 py-0.5 rounded bg-muted/50 capitalize">
                                                        {project.theme}
                                                    </span>
                                                </div>
                                                <button
                                                    onClick={(e) => handleDelete(project.noteId, e)}
                                                    className="p-1.5 rounded-lg hover:bg-red-50 text-muted-foreground hover:text-red-500 transition-colors cursor-pointer"
                                                >
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                </button>
                                            </div>
                                            <span className="text-[10px] text-muted-foreground/70 mt-1.5 block">
                                                {new Date(project.createdAt).toLocaleDateString()}
                                            </span>
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
