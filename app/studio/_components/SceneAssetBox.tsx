"use client"
import { AnimatePresence, motion } from 'framer-motion'
import {
    AlertTriangle, Bot, Check, Film, GripVertical, Image as ImageIcon, Loader2,
    Play, SplitSquareHorizontal, Upload, Video, Wand2, X,
    Sparkles, Link2, Maximize2, Smartphone, Monitor, MoveHorizontal
} from 'lucide-react'
import { useRef, useState, useCallback, useEffect } from 'react'
import { toast } from 'sonner'
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable'

// ─── Types ────────────────────────────────────────────────────────────────────

export type AssetType = "ai" | "user_upload" | "doc_image"

export interface UploadedFile {
    url:               string
    fileId:            string
    isVideo:           boolean
    isImgToVideo?:     boolean        // converted via Kling
    mimeType:          string
    converting?:       boolean
    convertedVideoUrl?: string
    originalImageUrl?: string         // original before conversion
}

/** A pair of fileIds to be composed as split-screen */
export type SplitPair = [string, string]

export interface SceneAssets {
    type:               AssetType
    files:              UploadedFile[]
    imgToVideoEnabled:  boolean       // kept for legacy compat; per-file converting tracked in files[]
    splitScreenEnabled: boolean       // true if at least one pair exists
    splitPairs:         SplitPair[]   // explicit pair selections
    docImageUrl:        string | null
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
    sceneIndex:      number
    seriesId:        string
    sceneNarration:  string
    sceneCategory:   string
    sceneAssets:     SceneAssets
    docImages:       string[]
    onAssetsChange: (i: number, updated: SceneAssets | ((prev: SceneAssets) => SceneAssets)) => void
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MAX_IMAGES = 5
const MAX_VIDEOS = 2

export function makeDefaultSceneAssets(): SceneAssets {
    return {
        type: "ai", files: [], imgToVideoEnabled: false,
        splitScreenEnabled: false, splitPairs: [], docImageUrl: null
    }
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function SceneAssetBox({
    sceneIndex, seriesId, sceneNarration, sceneCategory,
    sceneAssets, docImages, onAssetsChange
}: Props) {
    const fileRef   = useRef<HTMLInputElement>(null)
    const [uploading, setUploading] = useState(false)
    // Split-screen pair picker state: null = idle, string = fileId of first pick
    const [pairPicking, setPairPicking] = useState<string | null>(null)
    // Preview modal state
    const [previewUrl, setPreviewUrl] = useState<string | null>(null)
    const [previewIsVideo, setPreviewIsVideo] = useState(false)
    // Shorts preview: true = phone 9:16,  false = landscape 16:9
    const [shortsMode, setShortsMode] = useState(true)

    // ── Drag state (reorder only) ──────────────────────────────────────────────
    const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
    const [dragSrcIndex,  setDragSrcIndex]  = useState<number | null>(null)
    const dragSrcRef = useRef<number | null>(null)
    const filesRef = useRef(sceneAssets.files)
    const sceneAssetsRef = useRef(sceneAssets)
    useEffect(() => { filesRef.current = sceneAssets.files }, [sceneAssets.files])
    useEffect(() => { sceneAssetsRef.current = sceneAssets }, [sceneAssets])

    // ── Merge selection mode (button-driven) ──────────────────────────────────
    const [mergeSelecting, setMergeSelecting] = useState(false)
    const [mergeFirstPick, setMergeFirstPick] = useState<UploadedFile | null>(null)
    // Pending split-merge confirmation: holds the two UploadedFile objects to confirm
    const [pendingMerge, setPendingMerge] = useState<[UploadedFile, UploadedFile] | null>(null)

    const update = useCallback((patch: Partial<SceneAssets>) =>
        onAssetsChange(sceneIndex, { ...sceneAssets, ...patch }),
    [onAssetsChange, sceneIndex, sceneAssets])

    // ── Derived ───────────────────────────────────────────────────────────────
    const images     = sceneAssets.files.filter(f => !f.isVideo && !f.converting)
    const realVideos = sceneAssets.files.filter(f => f.isVideo && !f.isImgToVideo)
    const allVideos  = sceneAssets.files.filter(f => f.isVideo)
    const hasFiles   = sceneAssets.files.length > 0
    const canAddImg  = images.length < MAX_IMAGES
    const canAddVid  = realVideos.length < MAX_VIDEOS
    const anyConverting = sceneAssets.files.some(f => f.converting)

    // ── Upload ────────────────────────────────────────────────────────────────
    const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const chosen = Array.from(e.target.files || [])
        if (!chosen.length) return

        const newImages = chosen.filter(f => f.type.startsWith("image/"))
        const newVideos = chosen.filter(f => f.type.startsWith("video/"))
        if (images.length + newImages.length > MAX_IMAGES) {
            toast.error(`Max ${MAX_IMAGES} images per scene`); e.target.value = ""; return
        }
        if (realVideos.length + newVideos.length > MAX_VIDEOS) {
            toast.error(`Max ${MAX_VIDEOS} videos per scene`); e.target.value = ""; return
        }

        setUploading(true)
        try {
            const form = new FormData()
            chosen.forEach(f => form.append("files", f))
            form.append("sceneIndex", String(sceneIndex))
            form.append("seriesId",   seriesId)

            const res  = await fetch("/api/studio/upload-scene-asset", { method: "POST", body: form })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || "Upload failed")

            const newFiles: UploadedFile[] = (data.files || []).map((f: any) => ({
                url: f.url, fileId: f.fileId, isVideo: f.isVideo, mimeType: f.mimeType,
            }))
            update({ files: [...sceneAssets.files, ...newFiles], type: "user_upload" })
            toast.success(`${chosen.length} file${chosen.length > 1 ? "s" : ""} uploaded!`)
        } catch (err: any) {
            toast.error(err.message || "Upload failed")
        }
        setUploading(false)
        e.target.value = ""
    }

    // ── Remove file ───────────────────────────────────────────────────────────
    const removeFile = (idx: number) => {
        const removed = sceneAssets.files[idx]
        const files = sceneAssets.files.filter((_, i) => i !== idx)
        const patch: Partial<SceneAssets> = { files }
        if (files.length === 0) patch.type = "ai"
        // Clean up any pairs that reference removed file
        if (removed?.fileId) {
            patch.splitPairs = (sceneAssets.splitPairs || []).filter(
                ([a, b]) => a !== removed.fileId && b !== removed.fileId
            )
            patch.splitScreenEnabled = (patch.splitPairs!.length > 0)
        }
        if (!files.some(f => !f.isVideo && !f.isImgToVideo)) patch.imgToVideoEnabled = false
        update(patch)
        if (pairPicking === removed?.fileId) setPairPicking(null)
    }

    // ── Per-image animate (Kling) ─────────────────────────────────────────────
    const animateImage = async (file: UploadedFile) => {
        // Mark as converting
        onAssetsChange(sceneIndex, (prev: SceneAssets): SceneAssets => ({
            ...prev,
            imgToVideoEnabled: true,
            files: prev.files.map(f =>
                f.fileId === file.fileId ? { ...f, converting: true } : f
            )
        }))

        try {
            const res = await fetch("/api/studio/img-to-video", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    imageUrl: file.url,
                    sceneNarration: sceneNarration.slice(0, 500),
                    sceneIndex,
                    duration: 5,
                    forceShorts: true,
                }),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || "Conversion failed")

            onAssetsChange(sceneIndex, (prev: SceneAssets): SceneAssets => ({
                ...prev,
                files: prev.files.map(f =>
                    f.fileId === file.fileId
                        ? {
                            ...f,
                            isVideo:           true,
                            isImgToVideo:      true,
                            convertedVideoUrl: data.videoUrl,
                            originalImageUrl:  f.url,
                            url:               data.videoUrl,
                            converting:        false,
                          }
                        : f
                ),
            }))
            toast.success(`Scene ${sceneIndex + 1}: Image animated! ${data.isKlingFallback ? "(preview link)" : ""}`)
        } catch (err: any) {
            onAssetsChange(sceneIndex, (prev: SceneAssets): SceneAssets => ({
                ...prev,
                files: prev.files.map(f =>
                    f.fileId === file.fileId ? { ...f, converting: false } : f
                ),
            }))
            toast.error(`Animation failed: ${err.message?.slice(0, 80)}`)
        }
    }

    // ── Revert animated image ─────────────────────────────────────────────────
    const revertAnimation = (file: UploadedFile) => {
        onAssetsChange(sceneIndex, (prev: SceneAssets): SceneAssets => {
            const files = prev.files.map(f =>
                f.fileId === file.fileId
                    ? {
                        ...f,
                        isVideo:           false,
                        isImgToVideo:      false,
                        convertedVideoUrl: undefined,
                        url:               f.originalImageUrl || f.url,
                        originalImageUrl:  undefined,
                      }
                    : f
            )
            const stillHasAnimated = files.some(f => f.isImgToVideo)
            return { ...prev, files, imgToVideoEnabled: stillHasAnimated }
        })
    }

    // ── Split-screen pair picker ───────────────────────────────────────────────
    const handlePairPick = (fileId: string) => {
        if (pairPicking === null) {
            setPairPicking(fileId)
        } else if (pairPicking === fileId) {
            setPairPicking(null)
        } else {
            const newPair: SplitPair = [pairPicking, fileId]
            const exists = (sceneAssets.splitPairs || []).some(
                ([a, b]) => (a === newPair[0] && b === newPair[1]) || (a === newPair[1] && b === newPair[0])
            )
            if (!exists) {
                const splitPairs = [...(sceneAssets.splitPairs || []), newPair]
                update({ splitPairs, splitScreenEnabled: true })
                toast.success(`Split-screen pair ${splitPairs.length} created!`)
            } else {
                toast.info("This pair already exists")
            }
            setPairPicking(null)
        }
    }

    const removePair = (idx: number) => {
        const splitPairs = (sceneAssets.splitPairs || []).filter((_, i) => i !== idx)
        update({ splitPairs, splitScreenEnabled: splitPairs.length > 0 })
    }

    // ── Drag-and-Drop reorder ONLY ─────────────────────────────────────────────
    const handleDragStart = useCallback((e: React.DragEvent, idx: number) => {
        e.dataTransfer.effectAllowed = "move"
        e.dataTransfer.setData("application/x-file-index", String(idx))
        dragSrcRef.current = idx
        setDragSrcIndex(idx)
        setDragOverIndex(null)
    }, [])

    const handleDragOver = useCallback((e: React.DragEvent, idx: number) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = "move"
        const srcIdx = dragSrcRef.current
        if (srcIdx === null || srcIdx === idx) { setDragOverIndex(null); return }
        setDragOverIndex(idx)
    }, [])

    const handleDrop = useCallback((e: React.DragEvent, dropIdx: number) => {
        e.preventDefault()
        const raw = e.dataTransfer.getData("application/x-file-index")
        const srcIdx = raw !== "" ? parseInt(raw, 10) : dragSrcRef.current
        dragSrcRef.current = null
        setDragSrcIndex(null)
        setDragOverIndex(null)
        if (srcIdx === null || isNaN(srcIdx as number) || srcIdx === dropIdx) return

        const currentFiles = filesRef.current
        const currentAssets = sceneAssetsRef.current
        const files = [...currentFiles]
        const [moved] = files.splice(srcIdx, 1)
        files.splice(dropIdx, 0, moved)
        onAssetsChange(sceneIndex, { ...currentAssets, files })
    }, [sceneIndex, onAssetsChange])

    const handleDragEnd = useCallback(() => {
        dragSrcRef.current = null
        setDragSrcIndex(null)
        setDragOverIndex(null)
    }, [])

    // ── Merge selection flow (button-driven) ──────────────────────────────────
    const startMergeSelect = useCallback(() => {
        setMergeSelecting(true)
        setMergeFirstPick(null)
        setPairPicking(null) // cancel any active pair picking
    }, [])

    const cancelMergeSelect = useCallback(() => {
        setMergeSelecting(false)
        setMergeFirstPick(null)
    }, [])

    const handleMergeClick = useCallback((file: UploadedFile) => {
        if (!mergeSelecting || !file.isVideo) return
        if (!mergeFirstPick) {
            // First pick
            setMergeFirstPick(file)
        } else if (mergeFirstPick.fileId === file.fileId) {
            // Deselect
            setMergeFirstPick(null)
        } else {
            // Second pick — check for duplicate pair, then show modal
            const currentAssets = sceneAssetsRef.current
            const alreadyPaired = (currentAssets.splitPairs || []).some(
                ([a, b]) =>
                    (a === mergeFirstPick.fileId && b === file.fileId) ||
                    (a === file.fileId && b === mergeFirstPick.fileId)
            )
            if (alreadyPaired) {
                toast.info("This split-screen pair already exists")
                cancelMergeSelect()
                return
            }
            setPendingMerge([mergeFirstPick, file])
            setMergeSelecting(false)
            setMergeFirstPick(null)
        }
    }, [mergeSelecting, mergeFirstPick, cancelMergeSelect])

    // ── Split-merge confirmation actions ──────────────────────────────────────
    const confirmSplitMerge = useCallback(() => {
        if (!pendingMerge) return
        const [src, dst] = pendingMerge
        const newPair: SplitPair = [src.fileId, dst.fileId]
        const currentAssets = sceneAssetsRef.current
        const splitPairs = [...(currentAssets.splitPairs || []), newPair]
        onAssetsChange(sceneIndex, { ...currentAssets, splitPairs, splitScreenEnabled: true })
        toast.success('\u2726 Split-screen pair created! Two videos will play side-by-side.')
        setPendingMerge(null)
    }, [pendingMerge, sceneIndex, onAssetsChange])

    const cancelSplitMerge = useCallback(() => {
        setPendingMerge(null)
    }, [])

    // Escape key cancels merge selection or closes the merge modal
    useEffect(() => {
        if (!mergeSelecting && !pendingMerge && !previewUrl) return
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                if (previewUrl) { setPreviewUrl(null); setPreviewIsVideo(false); }
                else if (pendingMerge) setPendingMerge(null)
                else if (mergeSelecting) { setMergeSelecting(false); setMergeFirstPick(null) }
            }
        }
        window.addEventListener('keydown', handler)
        return () => window.removeEventListener('keydown', handler)
    }, [mergeSelecting, pendingMerge, previewUrl])

    // ── Pill helper ───────────────────────────────────────────────────────────
    const pill = (active: boolean, activeClass: string) =>
        `flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium transition-all cursor-pointer ${
            active ? activeClass : "bg-transparent text-muted-foreground hover:bg-muted/70"
        }`

    return (
        <motion.div
            layout
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: sceneIndex * 0.04, duration: 0.3 }}
            className="flex flex-col p-2 transition-colors hover:bg-white/60 group relative"
        >
            {/* Scene header */}
            <div className="flex items-center gap-3 px-3 py-2.5">
                <div className="w-6 h-6 rounded-md bg-muted/80 flex items-center justify-center shrink-0">
                    <span className="text-[10px] font-bold text-muted-foreground">{sceneIndex + 1}</span>
                </div>
                <p className="text-sm font-medium text-foreground/80 truncate flex-1">{sceneNarration.slice(0, 100)}…</p>

                {/* Badges */}
                {hasFiles && (
                    <div className="shrink-0 flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-[11px] text-emerald-700 font-semibold">
                        {images.length > 0 && <><ImageIcon className="w-3 h-3" />{images.length}</>}
                        {realVideos.length > 0 && <><Video className="w-3 h-3 ml-1" />{realVideos.length}</>}
                        {sceneAssets.files.filter(f => f.isImgToVideo).length > 0 &&
                            <><Wand2 className="w-3 h-3 ml-1 text-violet-600" /><span className="text-violet-600">{sceneAssets.files.filter(f => f.isImgToVideo).length}</span></>
                        }
                        {(sceneAssets.splitPairs?.length || 0) > 0 && (
                            <><SplitSquareHorizontal className="w-3 h-3 ml-1 text-blue-600" /><span className="text-blue-600">{sceneAssets.splitPairs.length}p</span></>
                        )}
                    </div>
                )}
            </div>

            {/* Mode pills */}
            <div className="flex flex-wrap gap-1.5 px-3 py-1 mb-2">
                <button onClick={() => update({ type: "ai", files: [], imgToVideoEnabled: false, splitScreenEnabled: false, splitPairs: [] })}
                    className={pill(sceneAssets.type === "ai", "bg-primary/15 text-primary")}>
                    <Bot className="w-3.5 h-3.5" /> Auto-Generate
                    {sceneAssets.type === "ai" && <Check className="w-3 h-3" />}
                </button>

                <button onClick={() => fileRef.current?.click()}
                    disabled={uploading || anyConverting || (!canAddImg && !canAddVid)}
                    className={pill(sceneAssets.type === "user_upload", "bg-emerald-600 text-white shadow-sm") +
                        " disabled:opacity-50 disabled:cursor-not-allowed"}>
                    {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                    {uploading ? "Uploading…" : canAddImg || canAddVid ? "Add Media" : "Limit reached"}
                    {sceneAssets.type === "user_upload" && !uploading && <Check className="w-3 h-3" />}
                </button>

                {docImages.length > 0 && (
                    <button onClick={() => update({ type: "doc_image", docImageUrl: docImages[0] })}
                        className={pill(sceneAssets.type === "doc_image", "bg-amber-500 text-white shadow-sm")}>
                        <ImageIcon className="w-3.5 h-3.5" /> Doc Chart
                        {sceneAssets.type === "doc_image" && <Check className="w-3 h-3" />}
                    </button>
                )}

                <input
                    ref={fileRef}
                    type="file"
                    multiple
                    accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm"
                    className="hidden"
                    onChange={handleUpload}
                />
            </div>

            {/* ── Content area + Inline Preview ─────────────────────────────────── */}
            <ResizablePanelGroup orientation="horizontal" className={`relative w-full rounded-2xl border border-border/40 overflow-hidden bg-white/50 ${previewUrl || pendingMerge ? 'min-h-[480px]' : ''}`}>
                <ResizablePanel defaultSize={previewUrl || pendingMerge ? "60%" : "100%"} minSize={previewUrl || pendingMerge ? "30%" : "100%"} maxSize="100%" className="relative flex flex-col h-full">
                    <div className="flex-1 overflow-y-auto">
                        <AnimatePresence mode="popLayout">
                            {/* AI mode */}
                            {sceneAssets.type === "ai" && (
                                <motion.div key="ai-preview" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
                            )}

                {/* User upload mode */}
                {sceneAssets.type === "user_upload" && (
                    <motion.div key="upload-area" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        className="mx-3 mb-2 space-y-3">

                        {/* Empty drop zone */}
                        {!hasFiles && !uploading && (
                            <button onClick={() => fileRef.current?.click()}
                                className="w-full py-8 rounded-xl border-2 border-dashed border-border/40 flex flex-col items-center gap-2 text-muted-foreground hover:border-primary/40 hover:bg-primary/5 transition-all cursor-pointer">
                                <Upload className="w-6 h-6" />
                                <span className="text-sm font-medium">Upload images or videos</span>
                                <span className="text-xs opacity-60">Up to {MAX_IMAGES} images · {MAX_VIDEOS} videos · 50 MB each</span>
                            </button>
                        )}

                        {uploading && (
                            <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-primary/5 border border-primary/20">
                                <Loader2 className="w-4 h-4 animate-spin text-primary" />
                                <span className="text-sm text-primary font-medium">Uploading files…</span>
                            </div>
                        )}

                        {/* ── Drag hint + Merge button ────────────────────────── */}
                        {hasFiles && !uploading && (
                            <div className="flex items-center gap-2">
                                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-50/80 border border-slate-200/80 text-[11px] text-slate-500 flex-1">
                                    <GripVertical className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                    <span>
                                        <strong className="font-semibold text-slate-600">Drag</strong> to reorder assets.
                                    </span>
                                </div>
                                {allVideos.length >= 2 && !mergeSelecting && (
                                    <button
                                        onClick={startMergeSelect}
                                        className="shrink-0 flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[11px] font-bold text-white transition-all cursor-pointer hover:scale-[1.03] active:scale-[0.97] shadow-md hover:shadow-lg"
                                        style={{
                                            background: 'linear-gradient(135deg, #2563eb 0%, #7c3aed 100%)',
                                            boxShadow: '0 2px 12px rgba(37,99,235,0.35)'
                                        }}
                                    >
                                        <SplitSquareHorizontal className="w-3.5 h-3.5" />
                                        Merge Split-Screen
                                    </button>
                                )}
                            </div>
                        )}

                        {/* ── Active merge selection banner ───────────────────── */}
                        {mergeSelecting && (
                            <motion.div
                                initial={{ opacity: 0, y: -8 }}
                                animate={{ opacity: 1, y: 0 }}
                                className="flex items-center gap-3 px-4 py-2.5 rounded-xl border-2 border-blue-400/60 text-[12px]"
                                style={{ background: 'linear-gradient(135deg, rgba(37,99,235,0.08), rgba(124,58,237,0.06))' }}
                            >
                                <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                                    style={{ background: 'linear-gradient(135deg, #2563eb, #7c3aed)' }}>
                                    <SplitSquareHorizontal className="w-3.5 h-3.5 text-white" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    {!mergeFirstPick ? (
                                        <span className="text-blue-700 font-semibold">
                                            ✦ Click the <strong>first video</strong> for the top video
                                        </span>
                                    ) : (
                                        <span className="text-violet-700 font-semibold">
                                            ✦ Now click the <strong>second video</strong> for the bottom video
                                        </span>
                                    )}
                                </div>
                                <button
                                    onClick={cancelMergeSelect}
                                    className="shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium text-slate-500 hover:text-red-600 hover:bg-red-50 border border-slate-200 hover:border-red-200 transition-all cursor-pointer"
                                >
                                    <X className="w-3 h-3" />
                                    Cancel
                                </button>
                            </motion.div>
                        )}

                        {/* ── Draggable file grid ────────────────────────────────── */}
                        {hasFiles && (
                            <div className={`grid gap-2 ${previewUrl || pendingMerge ? 'grid-cols-[repeat(auto-fill,minmax(120px,1fr))]' : 'grid-cols-3'}`}>
                                {sceneAssets.files.map((file, fi) => {
                                    // Compute merge state for this card
                                    let mergeState: 'none' | 'first' | 'available-first' | 'available-second' | 'disabled' = 'none'
                                    if (mergeSelecting) {
                                        if (mergeFirstPick?.fileId === file.fileId) {
                                            mergeState = 'first'
                                        } else if (file.isVideo && !file.converting) {
                                            mergeState = !mergeFirstPick ? 'available-first' : 'available-second'
                                        } else {
                                            mergeState = 'disabled'
                                        }
                                    }
                                    return (
                                        <FileCard
                                            key={file.fileId || fi}
                                            file={file}
                                            index={fi}
                                            pairPicking={pairPicking}
                                            splitPairs={sceneAssets.splitPairs || []}
                                            isDragSource={dragSrcIndex === fi}
                                            isDragOver={dragOverIndex === fi}
                                            mergeState={mergeState}
                                            onRemove={() => removeFile(fi)}
                                            onAnimate={() => animateImage(file)}
                                            onRevert={() => revertAnimation(file)}
                                            onPairPick={() => handlePairPick(file.fileId)}
                                            onPreview={() => { setPreviewUrl(file.url); setPreviewIsVideo(!!file.isVideo); }}
                                            onMergeClick={() => handleMergeClick(file)}
                                            onDragStart={(e) => handleDragStart(e, fi)}
                                            onDragOver={(e) => handleDragOver(e, fi)}
                                            onDrop={(e) => handleDrop(e, fi)}
                                            onDragEnd={handleDragEnd}
                                        />
                                    )
                                })}

                                {/* Add more slot */}
                                {(canAddImg || canAddVid) && !uploading && !mergeSelecting && (
                                    <button onClick={() => fileRef.current?.click()}
                                        className="w-full aspect-video rounded-lg border-2 border-dashed border-border/50 flex flex-col items-center justify-center gap-1 text-muted-foreground hover:border-primary/40 hover:text-primary transition-all cursor-pointer bg-muted/20">
                                        <Upload className="w-4 h-4" />
                                        <span className="text-[10px] font-medium">
                                            {canAddImg && canAddVid ? "Add more" : canAddImg ? `+${MAX_IMAGES - images.length} imgs` : `+${MAX_VIDEOS - realVideos.length} vids`}
                                        </span>
                                    </button>
                                )}
                            </div>
                        )}

                        {/* ── Split-screen pair section (videos only) ──────────────
                              NOTE: Images are NEVER shown here — only realVideos    */}
                        {realVideos.length >= 2 && (
                            <SplitScreenPairSection
                                realVideos={realVideos}
                                splitPairs={sceneAssets.splitPairs || []}
                                pairPicking={pairPicking}
                                onPairPick={handlePairPick}
                                onRemovePair={removePair}
                                onCancelPick={() => setPairPicking(null)}
                            />
                        )}

                        {/* Conversion status */}
                        {anyConverting && (
                            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-violet-50 border border-violet-200">
                                <Loader2 className="w-3.5 h-3.5 animate-spin text-violet-600" />
                                <span className="text-xs text-violet-700 font-medium">
                                    ✦ <span className="font-black bg-linear-to-r from-violet-600 to-fuchsia-500 bg-clip-text text-transparent">Migoo Cinema</span> is weaving motion magic…
                                </span>
                            </div>
                        )}

                        {/* Limit badges */}
                        <div className="flex flex-wrap gap-1.5">
                            {images.length >= MAX_IMAGES && (
                                <span className="text-[11px] text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                                    Max {MAX_IMAGES} images
                                </span>
                            )}
                            {realVideos.length >= MAX_VIDEOS && (
                                <span className="text-[11px] text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                                    Max {MAX_VIDEOS} videos
                                </span>
                            )}
                        </div>
                    </motion.div>
                )}

                {/* Doc image mode */}
                {sceneAssets.type === "doc_image" && (
                    <motion.div key="doc-preview" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
                        className="mx-3 mb-2">
                        <div className="flex gap-2 flex-wrap">
                            {docImages.map((url, di) => (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                    key={di}
                                    src={url}
                                    alt={`doc chart ${di + 1}`}
                                    onClick={() => update({ docImageUrl: url })}
                                    className={`w-24 h-16 object-cover rounded-md cursor-pointer transition-all ${
                                        sceneAssets.docImageUrl === url
                                            ? "ring-2 ring-amber-500 ring-offset-2 opacity-100"
                                            : "opacity-60 hover:opacity-100 ring-1 ring-border"
                                    }`}
                                />
                            ))}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
                    </div>
                </ResizablePanel>

                {/* ── Inline Right Panel (Preview / Merge) ── */}
                {(previewUrl || pendingMerge) && (
                    <>
                        <ResizableHandle withHandle className="bg-border/40 z-20" />
                        <ResizablePanel defaultSize="40%" minSize="20%" maxSize="70%" className="bg-[#0b0c10] relative flex flex-col items-center justify-center overflow-hidden border-l border-border/40">
                            {previewUrl && (
                                <InlineSinglePreview url={previewUrl} isVideo={previewIsVideo} sceneIndex={sceneIndex} shortsMode={shortsMode} setShortsMode={setShortsMode} onClose={() => { setPreviewUrl(null); setPreviewIsVideo(false); }} />
                            )}
                            {pendingMerge && (
                                <InlineMergePreview 
                                    videoA={pendingMerge[0]} 
                                    videoB={pendingMerge[1]} 
                                    sceneIndex={sceneIndex} 
                                    onConfirm={confirmSplitMerge} 
                                    onCancel={cancelSplitMerge} 
                                />
                            )}
                        </ResizablePanel>
                    </>
                )}
            </ResizablePanelGroup>
        </motion.div>
    )
}

// ─── FileCard ─────────────────────────────────────────────────────────────────

function FileCard({
    file, index, pairPicking, splitPairs,
    isDragSource, isDragOver,
    mergeState, onMergeClick,
    onRemove, onAnimate, onRevert, onPairPick, onPreview,
    onDragStart, onDragOver, onDrop, onDragEnd
}: {
    file:               UploadedFile
    index:              number
    pairPicking:        string | null
    splitPairs:         SplitPair[]
    isDragSource:       boolean
    isDragOver:         boolean
    mergeState:         'none' | 'first' | 'available-first' | 'available-second' | 'disabled'
    onMergeClick:       () => void
    onRemove:           () => void
    onAnimate:          () => void
    onRevert:           () => void
    onPairPick:         () => void
    onPreview:          () => void
    onDragStart:        (e: React.DragEvent) => void
    onDragOver:         (e: React.DragEvent) => void
    onDrop:             (e: React.DragEvent) => void
    onDragEnd:          () => void
}) {
    const isImgToVideo = !!file.isImgToVideo
    const isRealVideo  = file.isVideo && !isImgToVideo
    const isAnyVideo   = !!file.isVideo
    const isImage      = !file.isVideo && !file.converting

    // Pair state
    const isFirstPick  = pairPicking === file.fileId
    const pairIndex    = splitPairs.findIndex(([a, b]) => a === file.fileId || b === file.fileId)
    const isInPair     = pairIndex >= 0
    const canBePaired  = isRealVideo && pairPicking !== null && pairPicking !== file.fileId

    // Merge selection mode active?
    const isMerging = mergeState !== 'none'

    // ── Border / ring classes ─────────────────────────────────────────────────
    let borderClass = "border-border/30"
    let ringClass   = ""
    let dragClass   = ""
    let extraClass  = ""

    if (mergeState === 'first') {
        borderClass = "border-blue-500 border-2"
        ringClass   = "ring-2 ring-blue-400/60 ring-offset-1"
        extraClass  = "shadow-lg shadow-blue-500/30"
    } else if (mergeState.startsWith('available')) {
        borderClass = "border-violet-400/60 border-2 hover:border-violet-500"
        ringClass   = "ring-1 ring-violet-300/40 ring-offset-1"
        extraClass  = "cursor-pointer hover:shadow-md hover:shadow-violet-400/20 hover:scale-[1.02]"
    } else if (mergeState === 'disabled') {
        extraClass  = "opacity-35 pointer-events-none"
    } else if (isDragOver) {
        borderClass = "border-primary/60 border-2"
        ringClass   = "ring-2 ring-primary/40 ring-offset-1"
        dragClass   = "scale-[1.02]"
    } else if (isDragSource) {
        dragClass   = "opacity-40 scale-95"
    } else if (isFirstPick) {
        borderClass = "border-blue-400 shadow-blue-200 shadow-md"
        ringClass   = "ring-2 ring-blue-500 ring-offset-1"
    } else if (isInPair) {
        borderClass = "border-emerald-400"
        ringClass   = "ring-2 ring-emerald-500 ring-offset-1"
    } else if (canBePaired) {
        borderClass = "border-blue-300 hover:border-blue-500"
        ringClass   = "ring-2 ring-dashed ring-blue-400 ring-offset-1 cursor-pointer"
    }

    // Handle click during merge mode
    const handleCardClick = () => {
        if (isMerging && mergeState !== 'disabled') {
            onMergeClick()
        }
    }

    return (
        <div
            draggable={!file.converting && !isMerging}
            onDragStart={isMerging ? undefined : onDragStart}
            onDragOver={isMerging ? undefined : onDragOver}
            onDrop={isMerging ? undefined : onDrop}
            onDragEnd={isMerging ? undefined : onDragEnd}
            onClick={isMerging ? handleCardClick : undefined}
            className={`relative rounded-lg overflow-hidden group/card border bg-muted/20 aspect-video transition-all duration-200 select-none
                ${borderClass} ${ringClass} ${dragClass} ${extraClass}
                ${!file.converting && !isMerging ? "cursor-grab active:cursor-grabbing" : ""}
            `}
        >
            {/* ── Drag handle grip (top-left, fades in on hover) ────────────── */}
            {!file.converting && !isMerging && (
                <div className="absolute top-1 left-1 z-20 opacity-0 group-hover/card:opacity-100 transition-opacity pointer-events-none">
                    <div className="w-5 h-5 rounded bg-black/40 backdrop-blur-sm flex items-center justify-center">
                        <GripVertical className="w-3 h-3 text-white/70" />
                    </div>
                </div>
            )}

            {/* ── Merge selection overlays ──────────────────────────────────── */}
            {mergeState === 'first' && (
                <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-1 pointer-events-none"
                    style={{ background: 'linear-gradient(135deg, rgba(37,99,235,0.25), rgba(124,58,237,0.18))' }}>
                    <div className="w-8 h-8 rounded-full flex items-center justify-center shadow-lg"
                        style={{ background: 'linear-gradient(135deg, #2563eb, #7c3aed)' }}>
                        <span className="text-[11px] font-black text-white">A</span>
                    </div>
                    <span className="text-[9px] font-bold text-white tracking-wide drop-shadow-lg">Top Video</span>
                </div>
            )}
            {mergeState === 'available-first' && (
                <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-1 opacity-0 group-hover/card:opacity-100 transition-all duration-200 pointer-events-none"
                    style={{ background: 'linear-gradient(135deg, rgba(37,99,235,0.2), rgba(124,58,237,0.15))' }}>
                    <div className="w-8 h-8 rounded-full flex items-center justify-center shadow-lg border-2 border-white/30"
                        style={{ background: 'linear-gradient(135deg, #2563eb, #7c3aed)' }}>
                        <span className="text-[11px] font-black text-white">A</span>
                    </div>
                    <span className="text-[9px] font-bold text-white tracking-wide drop-shadow-lg">Top Video</span>
                </div>
            )}
            {mergeState === 'available-second' && (
                <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-1 opacity-0 group-hover/card:opacity-100 transition-all duration-200 pointer-events-none"
                    style={{ background: 'linear-gradient(135deg, rgba(124,58,237,0.2), rgba(37,99,235,0.15))' }}>
                    <div className="w-8 h-8 rounded-full flex items-center justify-center shadow-lg border-2 border-white/30"
                        style={{ background: 'linear-gradient(135deg, #7c3aed, #2563eb)' }}>
                        <span className="text-[11px] font-black text-white">B</span>
                    </div>
                    <span className="text-[9px] font-bold text-white tracking-wide drop-shadow-lg">Bottom Video</span>
                </div>
            )}

            {/* ── Reorder indicator overlay ─────────────────────────────────── */}
            {isDragOver && !isMerging && (
                <div className="absolute inset-0 z-30 flex items-center justify-center bg-primary/20 backdrop-blur-[1px] pointer-events-none">
                    <div className="w-1 h-8 rounded-full bg-primary shadow-lg" />
                </div>
            )}

            {/* Main content */}
            {file.converting ? (
                <div className="w-full h-full flex flex-col items-center justify-center gap-1.5 bg-violet-50">
                    <Loader2 className="w-5 h-5 animate-spin text-violet-600" />
                    <span className="text-[10px] text-violet-600 font-medium">Animating…</span>
                </div>
            ) : isRealVideo ? (
                // Real user-uploaded video — show actual preview
                <div
                    className={`relative w-full h-full ${canBePaired && !isMerging ? "cursor-pointer" : ""}`}
                    onClick={!isMerging && canBePaired ? onPairPick : undefined}
                >
                    <video
                        src={file.url}
                        muted
                        loop
                        playsInline
                        preload="metadata"
                        className="w-full h-full object-cover pointer-events-none"
                        onMouseEnter={e => (e.currentTarget as HTMLVideoElement).play().catch(() => {})}
                        onMouseLeave={e => { const v = e.currentTarget as HTMLVideoElement; v.pause(); v.currentTime = 0; }}
                    />
                    {isInPair && !isMerging && (
                        <span className="absolute bottom-5 left-1/2 -translate-x-1/2 text-[9px] font-bold bg-emerald-500 text-white px-1.5 rounded-full">
                            Pair {pairIndex + 1}
                        </span>
                    )}
                    {isFirstPick && !isMerging && (
                        <span className="absolute bottom-5 left-1/2 -translate-x-1/2 text-[9px] font-bold bg-blue-500 text-white px-1.5 rounded-full animate-pulse">
                            Pick 2nd…
                        </span>
                    )}
                    {/* play hint overlay — only the button is clickable so drag still works */}
                    {!isMerging && (
                        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/card:opacity-100 transition-opacity pointer-events-none">
                            {canBePaired || isFirstPick ? (
                                <div className="w-7 h-7 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center">
                                    <Play className="w-3.5 h-3.5 text-white" />
                                </div>
                            ) : (
                                <button
                                    type="button"
                                    className="w-8 h-8 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center pointer-events-auto cursor-pointer z-10 hover:bg-black/70 hover:scale-110 transition-all shadow-lg"
                                    onClick={(e) => { e.stopPropagation(); e.preventDefault(); onPreview(); }}
                                    onMouseDown={(e) => e.stopPropagation()}
                                    onDragStart={(e) => e.stopPropagation()}
                                >
                                    <Play className="w-3.5 h-3.5 text-white" />
                                </button>
                            )}
                        </div>
                    )}
                </div>
            ) : isImgToVideo ? (
                // Migoo Cinema animated clip — hover-play thumbnail + click to open modal
                <div
                    className={`relative w-full h-full ${!isMerging ? 'cursor-pointer' : ''}`}
                    onClick={!isMerging ? onPreview : undefined}
                >
                    <video
                        src={file.url}
                        muted
                        loop
                        playsInline
                        preload="metadata"
                        className="w-full h-full object-cover pointer-events-none"
                        onMouseEnter={e => (e.currentTarget as HTMLVideoElement).play().catch(() => {})}
                        onMouseLeave={e => { const v = e.currentTarget as HTMLVideoElement; v.pause(); v.currentTime = 0; }}
                    />
                    {/* Migoo cinema expand hint on hover */}
                    {!isMerging && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 opacity-0 group-hover/card:opacity-100 transition-all duration-200 pointer-events-none bg-black/30 backdrop-blur-[1px]">
                            <div className="w-8 h-8 rounded-full bg-violet-600/80 backdrop-blur-sm flex items-center justify-center shadow-lg shadow-violet-500/60 ring-2 ring-white/30">
                                <Maximize2 className="w-3.5 h-3.5 text-white" />
                            </div>
                            <span className="text-[9px] font-bold text-white/90 tracking-widest uppercase">Preview</span>
                        </div>
                    )}
                </div>
            ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={file.url} alt="asset" className={`w-full h-full object-cover ${!isMerging ? 'cursor-pointer' : 'pointer-events-none'}`} onClick={!isMerging ? onPreview : undefined} />
            )}

            {/* Type badge */}
            {isImgToVideo ? (
                <div className="absolute top-1 left-1 flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[9px] font-bold tracking-wide bg-linear-to-r from-violet-600 to-fuchsia-600 text-white shadow shadow-violet-500/40">
                    ✦ Migoo
                </div>
            ) : (
                <div className={`absolute top-1 left-6 px-1.5 py-0.5 rounded text-[9px] font-bold ${
                    isRealVideo ? "bg-emerald-600 text-white" : "bg-black/50 text-white"
                }`}>
                    {isRealVideo ? "Video" : "Image"}
                </div>
            )}

            {/* Remove button */}
            {!file.converting && !isMerging && (
                <button onClick={onRemove}
                    className="absolute top-1 right-1 w-5 h-5 rounded bg-black/50 backdrop-blur-sm flex items-center justify-center text-white opacity-0 group-hover/card:opacity-100 hover:bg-destructive transition-all cursor-pointer z-10">
                    <X className="w-3 h-3" />
                </button>
            )}

            {/* ── Bottom action bar (hidden during merge selection) ──── */}
            {!file.converting && !isMerging && (
                <div className="absolute bottom-0 left-0 right-0 opacity-0 group-hover/card:opacity-100 transition-opacity rounded-b-lg overflow-hidden">
                    {isImage && (
                        <button
                            onClick={onAnimate}
                            className="w-full flex items-center justify-center gap-1 py-1 bg-violet-600/90 backdrop-blur-sm text-white text-[10px] font-semibold hover:bg-violet-700 transition-colors cursor-pointer"
                        >
                            <Sparkles className="w-3 h-3" />
                            Animate
                        </button>
                    )}
                    {isImgToVideo && (
                        <button
                            onClick={onRevert}
                            className="w-full flex items-center justify-center gap-1 py-1 bg-slate-600/90 backdrop-blur-sm text-white text-[10px] font-semibold hover:bg-slate-700 transition-colors cursor-pointer"
                        >
                            <X className="w-3 h-3" />
                            Revert
                        </button>
                    )}
                    {/* Split-screen actions — ONLY for real videos, images are excluded */}
                    {isRealVideo && !isInPair && !isFirstPick && pairPicking === null && (
                        <button
                            onClick={onPairPick}
                            className="w-full flex items-center justify-center gap-1 py-1 bg-blue-600/90 backdrop-blur-sm text-white text-[10px] font-semibold hover:bg-blue-700 transition-colors cursor-pointer"
                        >
                            <SplitSquareHorizontal className="w-3 h-3" />
                            Split Pair
                        </button>
                    )}
                    {isRealVideo && isFirstPick && (
                        <div className="w-full flex items-center justify-center gap-1 py-1 bg-blue-500/90 backdrop-blur-sm text-white text-[10px] font-semibold">
                            <Link2 className="w-3 h-3" />
                            Pick 2nd video…
                        </div>
                    )}
                    {isRealVideo && canBePaired && (
                        <button
                            onClick={onPairPick}
                            className="w-full flex items-center justify-center gap-1 py-1 bg-emerald-600/90 backdrop-blur-sm text-white text-[10px] font-semibold hover:bg-emerald-700 transition-colors cursor-pointer"
                        >
                            <Link2 className="w-3 h-3" />
                            Pair with this
                        </button>
                    )}
                    {/* Images: show "No Split" hint if split-picking is active (to clarify exclusion) */}
                    {isImage && pairPicking !== null && (
                        <div className="w-full flex items-center justify-center gap-1 py-1 bg-slate-500/80 backdrop-blur-sm text-white/70 text-[9px] font-medium cursor-default">
                            Images can't split-screen
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}

// ─── Split Screen Pair Section ────────────────────────────────────────────────
// NOTE: Only realVideos are passed here — images are NEVER shown in this section

function SplitScreenPairSection({
    realVideos, splitPairs, pairPicking, onPairPick, onRemovePair, onCancelPick
}: {
    realVideos:   UploadedFile[]
    splitPairs:   SplitPair[]
    pairPicking:  string | null
    onPairPick:   (fileId: string) => void
    onRemovePair: (idx: number) => void
    onCancelPick: () => void
}) {
    const getVideo = (fileId: string) => realVideos.find(v => v.fileId === fileId)

    return (
        <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-3 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                    <SplitSquareHorizontal className="w-4 h-4 text-blue-600" />
                    <span className="text-[13px] font-semibold text-blue-800">Split-Screen Pairs</span>
                    <span className="text-[10px] text-blue-400 font-medium">(videos only)</span>
                </div>
                {pairPicking ? (
                    <button
                        onClick={onCancelPick}
                        className="text-[11px] text-muted-foreground hover:text-destructive flex items-center gap-1 cursor-pointer"
                    >
                        <X className="w-3 h-3" /> Cancel
                    </button>
                ) : (
                    <span className="text-[11px] text-blue-600">
                        {splitPairs.length} pair{splitPairs.length !== 1 ? "s" : ""}
                    </span>
                )}
            </div>

            {/* Instructions */}
            <p className="text-[11px] text-blue-700/80 leading-relaxed">
                {pairPicking
                    ? "✦ Now click a second video card (or hover + click \"Pair with this\") to complete the pair."
                    : `Drag one video onto another, or hover a video card → \"Split Pair\" to select 2 videos for side-by-side split-screen.`
                }
            </p>

            {/* Existing pairs */}
            {splitPairs.length > 0 && (
                <div className="space-y-1.5">
                    {splitPairs.map(([aId, bId], idx) => {
                        const a = getVideo(aId)
                        const b = getVideo(bId)
                        return (
                            <div key={idx} className="flex items-center gap-2 bg-white rounded-lg px-2.5 py-1.5 border border-blue-200 shadow-sm">
                                <span className="text-[10px] font-bold text-blue-600 bg-blue-100 px-1.5 py-0.5 rounded">
                                    Pair {idx + 1}
                                </span>
                                <Film className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                                <span className="text-[11px] text-muted-foreground truncate flex-1">
                                    {a ? `Video ${realVideos.indexOf(a) + 1}` : "Video A"}
                                </span>
                                <SplitSquareHorizontal className="w-3 h-3 text-blue-400 shrink-0" />
                                <span className="text-[11px] text-muted-foreground truncate flex-1">
                                    {b ? `Video ${realVideos.indexOf(b) + 1}` : "Video B"}
                                </span>
                                <button
                                    onClick={() => onRemovePair(idx)}
                                    className="w-5 h-5 rounded flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors cursor-pointer ml-auto"
                                >
                                    <X className="w-3 h-3" />
                                </button>
                            </div>
                        )
                    })}
                </div>
            )}

            {/* Add pair CTA */}
            {!pairPicking && splitPairs.length < Math.floor(realVideos.length / 2) && (
                <button
                    onClick={() => onPairPick(realVideos[0].fileId)}
                    className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg border border-dashed border-blue-300 text-[12px] text-blue-600 hover:bg-blue-100 transition-colors cursor-pointer font-medium"
                >
                    <Link2 className="w-3.5 h-3.5" />
                    + Add another pair
                </button>
            )}
        </div>
    )
}

// ─── Inline Single Preview (right resizable panel) ────────────────────────────

function InlineSinglePreview({
    url, isVideo, sceneIndex, shortsMode, setShortsMode, onClose
}: {
    url: string
    isVideo: boolean
    sceneIndex: number
    shortsMode: boolean
    setShortsMode: (v: boolean) => void
    onClose: () => void
}) {
    return (
        <div className="flex flex-col w-full h-full">
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2.5 border-b border-white/10 shrink-0">
                <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-lg flex items-center justify-center"
                        style={{ background: 'linear-gradient(135deg, rgba(139,92,246,0.3), rgba(99,102,241,0.3))', border: '1px solid rgba(139,92,246,0.25)' }}>
                        {isVideo ? <Film className="w-3 h-3 text-violet-300" /> : <ImageIcon className="w-3 h-3 text-violet-300" />}
                    </div>
                    <span className="text-[11px] font-bold text-white/60">Scene {sceneIndex + 1}</span>
                </div>
                <div className="flex items-center gap-1.5">
                    <button onClick={() => setShortsMode(true)}
                        className={`flex items-center gap-1 px-2 py-1 rounded-md text-[9px] font-bold transition-all cursor-pointer ${shortsMode ? 'bg-violet-600 text-white shadow-md shadow-violet-500/40' : 'bg-white/[0.06] text-white/40 hover:text-white/60 hover:bg-white/[0.1]'}`}>
                        <Smartphone className="w-3 h-3" /> 9:16
                    </button>
                    <button onClick={() => setShortsMode(false)}
                        className={`flex items-center gap-1 px-2 py-1 rounded-md text-[9px] font-bold transition-all cursor-pointer ${!shortsMode ? 'bg-violet-600 text-white shadow-md shadow-violet-500/40' : 'bg-white/[0.06] text-white/40 hover:text-white/60 hover:bg-white/[0.1]'}`}>
                        <Monitor className="w-3 h-3" /> 16:9
                    </button>
                    <button onClick={onClose}
                        className="w-6 h-6 rounded-full flex items-center justify-center bg-white/[0.06] hover:bg-white/[0.12] transition-colors cursor-pointer ml-1"
                        title="Close preview (Esc)">
                        <X className="w-3 h-3 text-white/50" />
                    </button>
                </div>
            </div>

            {/* Preview content */}
            <div className="flex-1 flex items-center justify-center overflow-hidden bg-black">
                {shortsMode ? (
                    /* ── Shorts mode: phone-frame 9:16 centered ── */
                    <div className="p-4 h-full flex items-center justify-center">
                        <div
                            className="relative rounded-2xl overflow-hidden max-w-[260px] w-full"
                            style={{
                                aspectRatio: '9/16',
                                maxHeight: '100%',
                                border: '2px solid rgba(139,92,246,0.25)',
                                boxShadow: '0 0 40px rgba(139,92,246,0.12), inset 0 0 0 1px rgba(255,255,255,0.04)',
                                background: '#000',
                            }}
                        >
                            {isVideo ? (
                                <video src={url} autoPlay muted loop playsInline className="w-full h-full object-cover" />
                            ) : (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={url} alt="preview" className="w-full h-full object-cover" />
                            )}
                            {/* Phone frame elements */}
                            <div className="absolute top-2 left-1/2 -translate-x-1/2 w-14 h-3.5 rounded-full bg-black/60 z-30 border border-white/10" />
                            <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 w-12 h-1 rounded-full bg-white/15 z-30" />
                            {/* Bottom gradient */}
                            <div className="absolute bottom-0 left-0 right-0 h-10 pointer-events-none"
                                style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.4), transparent)' }}>
                                <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1">
                                    <Sparkles className="w-2.5 h-2.5 text-fuchsia-400" style={{ opacity: 0.6 }} />
                                    <span className="text-[8px] font-bold text-white/30 tracking-wider uppercase">Migoo Preview</span>
                                </div>
                            </div>
                        </div>
                    </div>
                ) : (
                    /* ── Landscape mode: full-screen cinema with 9:16 video letterboxed ── */
                    <div className="relative w-full h-full flex items-center justify-center">
                        {/* Full black background is the parent bg-black */}
                        <div className="relative h-full" style={{ aspectRatio: '9/16', maxWidth: '100%' }}>
                            {isVideo ? (
                                <video src={url} autoPlay muted loop playsInline className="w-full h-full object-cover" />
                            ) : (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={url} alt="preview" className="w-full h-full object-cover" />
                            )}
                        </div>
                        {/* Cinema label */}
                        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-3 py-1 rounded-full bg-black/50 backdrop-blur-sm border border-white/10">
                            <Sparkles className="w-2.5 h-2.5 text-fuchsia-400" style={{ opacity: 0.6 }} />
                            <span className="text-[8px] font-bold text-white/30 tracking-wider uppercase">Full Screen · 9:16</span>
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}

// ─── Inline Merge Preview (right panel, resizable vertical split) ─────────────

function InlineMergePreview({
    videoA, videoB, sceneIndex, onConfirm, onCancel
}: {
    videoA: UploadedFile
    videoB: UploadedFile
    sceneIndex: number
    onConfirm: () => void
    onCancel: () => void
}) {
    const videoARef = useRef<HTMLVideoElement>(null)
    const videoBRef = useRef<HTMLVideoElement>(null)
    const [isPlaying, setIsPlaying] = useState(true)

    const togglePlayback = useCallback(() => {
        const vA = videoARef.current
        const vB = videoBRef.current
        if (!vA || !vB) return
        if (isPlaying) { vA.pause(); vB.pause() }
        else { vA.play().catch(() => {}); vB.play().catch(() => {}) }
        setIsPlaying(!isPlaying)
    }, [isPlaying])

    return (
        <div className="flex flex-col w-full h-full">
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2.5 border-b border-white/10 shrink-0">
                <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-lg flex items-center justify-center"
                        style={{ background: 'linear-gradient(135deg, rgba(37,99,235,0.3), rgba(124,58,237,0.3))', border: '1px solid rgba(139,92,246,0.25)' }}>
                        <SplitSquareHorizontal className="w-3 h-3 text-violet-300" />
                    </div>
                    <div className="flex flex-col">
                        <span className="text-[11px] font-bold text-white/60">Split-Screen</span>
                        <span className="text-[9px] text-white/25">Scene {sceneIndex + 1} · Vertical</span>
                    </div>
                </div>
                <div className="flex items-center gap-1.5">
                    <button onClick={togglePlayback}
                        className="flex items-center gap-1 px-2 py-1 rounded-md text-[9px] font-bold transition-all cursor-pointer bg-white/[0.06] text-white/40 hover:text-white/60 hover:bg-white/[0.1]">
                        {isPlaying ? <><span style={{ fontSize: 9 }}>⏸</span> Pause</> : <><Play className="w-3 h-3" /> Play</>}
                    </button>
                    <button onClick={onCancel}
                        className="w-6 h-6 rounded-full flex items-center justify-center bg-white/[0.06] hover:bg-white/[0.12] transition-colors cursor-pointer"
                        title="Close (Esc)">
                        <X className="w-3 h-3 text-white/50" />
                    </button>
                </div>
            </div>

            {/* Vertical split preview inside 9:16 phone frame */}
            <div className="flex-1 flex items-center justify-center overflow-hidden bg-black p-4">
                <div
                    className="relative rounded-2xl overflow-hidden max-w-[260px] w-full flex flex-col"
                    style={{
                        aspectRatio: '9/16',
                        maxHeight: '100%',
                        border: '2px solid rgba(139,92,246,0.25)',
                        boxShadow: '0 0 40px rgba(139,92,246,0.12), inset 0 0 0 1px rgba(255,255,255,0.04)',
                        background: '#000',
                    }}
                >
                    {/* Top half */}
                    <div className="relative flex-1 min-h-0 overflow-hidden">
                        <video
                            ref={videoARef}
                            src={videoA.url}
                            autoPlay muted loop playsInline
                            className="w-full h-full"
                            style={{ objectFit: 'cover' }}
                        />
                    </div>

                    {/* Divider */}
                    <div className="h-[3px] bg-violet-500/60 shrink-0" />

                    {/* Bottom half */}
                    <div className="relative flex-1 min-h-0 overflow-hidden">
                        <video
                            ref={videoBRef}
                            src={videoB.url}
                            autoPlay muted loop playsInline
                            className="w-full h-full"
                            style={{ objectFit: 'cover' }}
                        />
                    </div>

                    {/* Phone frame elements */}
                    <div className="absolute top-2 left-1/2 -translate-x-1/2 w-14 h-3.5 rounded-full bg-black/60 z-30 border border-white/10" />
                    <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 w-12 h-1 rounded-full bg-white/15 z-30" />

                    {/* Bottom gradient with branding */}
                    <div className="absolute bottom-0 left-0 right-0 h-10 pointer-events-none z-20"
                        style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.4), transparent)' }}>
                        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1">
                            <Sparkles className="w-2.5 h-2.5 text-fuchsia-400" style={{ opacity: 0.6 }} />
                            <span className="text-[8px] font-bold text-white/30 tracking-wider uppercase">Split Preview</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Info + Actions */}
            <div className="px-3 pb-3 space-y-2 shrink-0">
                <div className="flex items-center justify-center gap-1.5 text-[9px] text-white/25">
                    <span>Final render: 50/50 vertical split</span>
                </div>
                <div className="flex gap-2">
                    <button onClick={onCancel}
                        className="flex-1 py-2 rounded-xl text-[11px] font-semibold transition-all cursor-pointer hover:bg-white/[0.08]"
                        style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.45)' }}>
                        Keep Separate
                    </button>
                    <button onClick={onConfirm}
                        className="flex-1 py-2 rounded-xl text-[11px] font-black text-white transition-all cursor-pointer hover:shadow-lg hover:shadow-violet-500/30"
                        style={{ background: 'linear-gradient(135deg, #1d4ed8 0%, #6d28d9 100%)' }}>
                        <span className="flex items-center justify-center gap-1.5">
                            <SplitSquareHorizontal className="w-3.5 h-3.5" />
                            Confirm Merge
                        </span>
                    </button>
                </div>
            </div>
        </div>
    )
}

// ─── Split-Screen Merge Confirmation Modal with LIVE Preview ──────────────────
// Vertical split (top/bottom) · Shorts 9:16 only

function SplitMergeConfirmModal({
    videoA, videoB, sceneIndex, onConfirm, onCancel
}: {
    videoA:      UploadedFile
    videoB:      UploadedFile
    sceneIndex:  number
    onConfirm:   () => void
    onCancel:    () => void
}) {
    const videoARef = useRef<HTMLVideoElement>(null)
    const videoBRef = useRef<HTMLVideoElement>(null)
    const [isPlaying, setIsPlaying] = useState(true)
    const [loadedCount, setLoadedCount] = useState(0)

    // Sync both videos to start together
    const handleVideoLoaded = useCallback(() => {
        setLoadedCount(prev => {
            const next = prev + 1
            if (next >= 2) {
                setTimeout(() => {
                    videoARef.current?.play().catch(() => {})
                    videoBRef.current?.play().catch(() => {})
                }, 50)
            }
            return next
        })
    }, [])

    // Playback toggle
    const togglePlayback = useCallback(() => {
        const vA = videoARef.current
        const vB = videoBRef.current
        if (!vA || !vB) return
        if (isPlaying) {
            vA.pause(); vB.pause()
        } else {
            vA.play().catch(() => {}); vB.play().catch(() => {})
        }
        setIsPlaying(!isPlaying)
    }, [isPlaying])

    return (
        <motion.div
            key="split-merge-confirm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
            style={{ backdropFilter: 'blur(18px)', backgroundColor: 'rgba(0,0,0,0.88)' }}
            onClick={onCancel}
        >
            <motion.div
                initial={{ opacity: 0, scale: 0.86, y: 28 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.90, y: 16 }}
                transition={{ type: 'spring', stiffness: 360, damping: 30 }}
                onClick={e => e.stopPropagation()}
                className="relative w-full rounded-3xl overflow-hidden shadow-2xl"
                style={{
                    maxWidth: 420,
                    background: 'linear-gradient(145deg, #0d0b1e 0%, #130f2e 50%, #1a1040 100%)',
                    boxShadow: '0 0 0 1px rgba(139,92,246,0.35), 0 48px 120px rgba(88,28,220,0.55)'
                }}
            >
                {/* Decorative glow */}
                <div className="absolute -top-24 -left-24 w-72 h-72 rounded-full pointer-events-none"
                    style={{ background: 'radial-gradient(circle, rgba(99,102,241,0.22) 0%, transparent 70%)' }} />
                <div className="absolute -bottom-24 -right-24 w-72 h-72 rounded-full pointer-events-none"
                    style={{ background: 'radial-gradient(circle, rgba(37,99,235,0.18) 0%, transparent 70%)' }} />

                {/* ── Header ──────────────────────────────────────────── */}
                <div className="relative px-6 pt-5 pb-3 flex items-start gap-3">
                    <div className="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0"
                        style={{ background: 'linear-gradient(135deg, rgba(37,99,235,0.3), rgba(124,58,237,0.3))', border: '1px solid rgba(139,92,246,0.3)' }}>
                        <SplitSquareHorizontal className="w-5 h-5 text-violet-300" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <h2 className="text-[16px] font-black text-white tracking-tight leading-tight">
                            Split-Screen Merge Preview
                        </h2>
                        <p className="text-[11px] text-white/40 mt-0.5 leading-snug">
                            Scene {sceneIndex + 1} · Shorts 9:16 · Vertical split
                        </p>
                    </div>
                    <button
                        onClick={onCancel}
                        className="w-8 h-8 rounded-full flex items-center justify-center transition-colors cursor-pointer shrink-0"
                        style={{ background: 'rgba(255,255,255,0.08)' }}
                        onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.15)')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')}
                    >
                        <X className="w-3.5 h-3.5 text-white/50" />
                    </button>
                </div>

                {/* ── Play/Pause ──────────────────────────────────────── */}
                <div className="relative px-6 pb-3 flex items-center gap-2">
                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold"
                        style={{ background: 'linear-gradient(135deg, #7c3aed, #6d28d9)', color: '#fff', boxShadow: '0 2px 12px rgba(124,58,237,0.5)' }}>
                        <Smartphone className="w-3 h-3" />
                        Shorts 9:16
                    </div>
                    <button
                        onClick={togglePlayback}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-all cursor-pointer ml-auto"
                        style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.6)' }}
                        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.14)'; e.currentTarget.style.color = '#fff' }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; e.currentTarget.style.color = 'rgba(255,255,255,0.6)' }}
                    >
                        {isPlaying ? <><span style={{ fontSize: 10 }}>⏸</span> Pause</> : <><Play className="w-3 h-3" /> Play</>}
                    </button>
                </div>

                {/* ── LIVE VERTICAL SPLIT-SCREEN PREVIEW ──────────────── */}
                <div className="px-6 pb-3">
                    <div
                        className="relative mx-auto rounded-2xl overflow-hidden"
                        style={{
                            width: 260,
                            height: 462,
                            border: '2px solid rgba(139,92,246,0.35)',
                            boxShadow: '0 0 40px rgba(139,92,246,0.2), inset 0 0 0 1px rgba(255,255,255,0.05)',
                            background: '#000',
                        }}
                    >
                        {/* Loading overlay */}
                        {loadedCount < 2 && (
                            <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-2 bg-black/90">
                                <Loader2 className="w-6 h-6 animate-spin text-violet-400" />
                                <span className="text-[11px] text-white/40 font-medium">Loading videos…</span>
                            </div>
                        )}

                        {/* ── Vertical split: Video A on top, Video B on bottom ── */}
                        <div className="absolute inset-0 flex flex-col" style={{ gap: 0 }}>
                            {/* Top half — Video A */}
                            <div className="relative overflow-hidden" style={{ height: 'calc(50% - 1.5px)', width: '100%' }}>
                                <video
                                    ref={videoARef}
                                    src={videoA.url}
                                    autoPlay muted loop playsInline
                                    preload="auto"
                                    onLoadedData={handleVideoLoaded}
                                    className="absolute inset-0 w-full h-full"
                                    style={{ objectFit: 'cover', objectPosition: 'center' }}
                                />
                                {/* A label */}
                                <div className="absolute top-2 left-2 z-20 w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-black text-white shadow-lg"
                                    style={{ background: 'linear-gradient(135deg, rgba(37,99,235,0.85), rgba(124,58,237,0.85))' }}>
                                    A
                                </div>
                                {/* Top edge subtle blue tint */}
                                <div className="absolute inset-0 pointer-events-none" style={{ background: 'linear-gradient(to bottom, rgba(37,99,235,0.06), transparent 35%)' }} />
                            </div>

                            {/* Horizontal glowing divider */}
                            <div className="relative shrink-0" style={{ height: 3, width: '100%' }}>
                                <div className="absolute inset-0" style={{
                                    background: 'linear-gradient(to right, rgba(139,92,246,0), rgba(99,102,241,1) 15%, rgba(139,92,246,1) 50%, rgba(99,102,241,1) 85%, rgba(139,92,246,0))',
                                }} />
                                <div className="absolute inset-0" style={{
                                    boxShadow: '0 0 12px 3px rgba(139,92,246,0.5), 0 0 30px 6px rgba(99,102,241,0.2)',
                                }} />
                            </div>

                            {/* Bottom half — Video B */}
                            <div className="relative overflow-hidden" style={{ height: 'calc(50% - 1.5px)', width: '100%' }}>
                                <video
                                    ref={videoBRef}
                                    src={videoB.url}
                                    autoPlay muted loop playsInline
                                    preload="auto"
                                    onLoadedData={handleVideoLoaded}
                                    className="absolute inset-0 w-full h-full"
                                    style={{ objectFit: 'cover', objectPosition: 'center' }}
                                />
                                {/* B label */}
                                <div className="absolute top-2 left-2 z-20 w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-black text-white shadow-lg"
                                    style={{ background: 'linear-gradient(135deg, rgba(5,150,105,0.85), rgba(52,211,153,0.85))' }}>
                                    B
                                </div>
                                {/* Bottom edge subtle emerald tint */}
                                <div className="absolute inset-0 pointer-events-none" style={{ background: 'linear-gradient(to top, rgba(5,150,105,0.06), transparent 35%)' }} />
                            </div>
                        </div>

                        {/* ── Bottom gradient overlay ────────────────────────── */}
                        <div className="absolute bottom-0 left-0 right-0 h-12 z-20 pointer-events-none"
                            style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.5), transparent)' }}>
                            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1.5">
                                <Sparkles className="w-2.5 h-2.5 text-fuchsia-400" style={{ opacity: 0.7 }} />
                                <span className="text-[9px] font-bold text-white/40 tracking-wider uppercase">
                                    Vertical Split Preview
                                </span>
                            </div>
                        </div>

                        {/* Phone frame elements */}
                        <div className="absolute top-2 left-1/2 -translate-x-1/2 w-16 h-4 rounded-full bg-black/70 z-30 border border-white/10" />
                        <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 w-14 h-1 rounded-full bg-white/20 z-30" />

                        {/* LIVE badge */}
                        <div className="absolute top-2.5 right-2.5 z-30 flex items-center gap-1 px-2 py-0.5 rounded-full text-[8px] font-black tracking-wider bg-black/50 backdrop-blur-sm border border-white/10"
                            style={{ color: 'rgba(255,255,255,0.5)' }}>
                            <Sparkles className="w-2.5 h-2.5 text-fuchsia-400" />
                            LIVE
                        </div>
                    </div>
                </div>

                {/* ── Source labels ───────────────────────────────────── */}
                <div className="px-6 pb-3">
                    <div className="flex gap-3 items-center justify-center">
                        <div className="flex items-center gap-1.5">
                            <span className="w-4 h-4 rounded flex items-center justify-center text-[8px] font-black text-blue-200"
                                style={{ background: 'rgba(37,99,235,0.3)', border: '1px solid rgba(37,99,235,0.4)' }}>A</span>
                            <span className="text-[10px] text-white/30 font-medium">Top panel</span>
                        </div>
                        <div className="flex items-center gap-1">
                            <div className="w-3 h-px" style={{ background: 'rgba(139,92,246,0.4)' }} />
                            <MoveHorizontal className="w-3 h-3 text-violet-400/50" style={{ transform: 'rotate(90deg)' }} />
                            <div className="w-3 h-px" style={{ background: 'rgba(139,92,246,0.4)' }} />
                        </div>
                        <div className="flex items-center gap-1.5">
                            <span className="w-4 h-4 rounded flex items-center justify-center text-[8px] font-black text-emerald-200"
                                style={{ background: 'rgba(5,150,105,0.3)', border: '1px solid rgba(52,211,153,0.4)' }}>B</span>
                            <span className="text-[10px] text-white/30 font-medium">Bottom panel</span>
                        </div>
                    </div>
                </div>

                {/* ── Action buttons ──────────────────────────────────── */}
                <div className="px-6 pb-5 flex gap-3">
                    <button
                        onClick={onCancel}
                        className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all cursor-pointer"
                        style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.55)' }}
                        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.11)'; (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.8)' }}
                        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.06)'; (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.55)' }}
                    >
                        Keep Separate
                    </button>
                    <button
                        onClick={onConfirm}
                        className="flex-1 py-2.5 rounded-xl text-sm font-black text-white transition-all cursor-pointer relative overflow-hidden group"
                        style={{ background: 'linear-gradient(135deg, #1d4ed8 0%, #6d28d9 100%)' }}
                    >
                        <span className="relative z-10 flex items-center justify-center gap-2">
                            <SplitSquareHorizontal className="w-4 h-4" />
                            Confirm Merge
                        </span>
                        <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
                            style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.12), rgba(255,255,255,0.02))' }} />
                        <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity"
                            style={{ boxShadow: '0 0 30px rgba(124,58,237,0.6)' }} />
                    </button>
                </div>

                {/* Escape hint */}
                <div className="pb-3 text-center">
                    <span className="text-[10px]" style={{ color: 'rgba(255,255,255,0.18)' }}>
                        Press{' '}
                        <kbd className="px-1.5 py-0.5 rounded font-mono text-[9px]"
                            style={{ background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.28)', border: '1px solid rgba(255,255,255,0.1)' }}>Esc</kbd>
                        {' '}or click outside to cancel
                    </span>
                </div>
            </motion.div>
        </motion.div>
    )
}

