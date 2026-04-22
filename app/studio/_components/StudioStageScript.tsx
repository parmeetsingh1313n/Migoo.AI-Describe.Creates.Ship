"use client"
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown, Download, ExternalLink, Globe, Loader2, PenLine, RefreshCw, Sparkles, Upload } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { WebSource } from '@/lib/web-search'
import SceneScriptRow from './SceneScriptRow'
import ScriptGeneratingLoader from './ScriptGeneratingLoader'
function getWordEditDistance(str1: string, str2: string) {
    const a = str1.toLowerCase().split(/\s+/).filter(Boolean)
    const b = str2.toLowerCase().split(/\s+/).filter(Boolean)
    if (a.length === 0) return b.length
    if (b.length === 0) return a.length
    let prev = Array.from({length: b.length + 1}, (_, i) => i)
    let curr = new Array(b.length + 1)
    for (let i = 1; i <= a.length; i++) {
        curr[0] = i
        for (let j = 1; j <= b.length; j++) {
            curr[j] = a[i-1] === b[j-1] ? prev[j-1] : 1 + Math.min(prev[j-1], prev[j], curr[j-1])
        }
        const temp = prev
        prev = curr
        curr = temp
    }
    return prev[b.length]
}

interface Scene {
    narration: string
    imagePrompt: string
    videoPrompt: string
    sceneCategory: string
    asset_url?: string | null
    duration: number
    wordCount: number
    sceneNumber: number
}

interface Props {
    scriptData: { videoTitle: string; scenes: Scene[]; thumbnailPrompt?: string } | null
    setScriptData: (d: any) => void
    topic: string
    language: string
    seriesNiche: string
    contextMarkdown: string
    docImages: string[]
    instruction: string
    isGenerating: boolean
    webSources?: WebSource[]
}

export default function StudioStageScript({ scriptData, setScriptData, topic, language, seriesNiche, contextMarkdown, docImages, instruction, isGenerating, webSources = [] }: Props) {
    const [regenIndex, setRegenIndex] = useState<number | null>(null)
    const fileInputRef = useRef<HTMLInputElement>(null)
    const [editedSet, setEditedSet] = useState<Set<number>>(new Set())
    const [origNarrations, setOrigNarrations] = useState<string[]>([])
    const [showSources, setShowSources] = useState(false)

    const totalWords   = scriptData?.scenes.reduce((s, sc) => s + (sc.narration?.split(/\s+/).filter(Boolean).length || 0), 0) ?? 0
    const estimatedSec = Math.round(totalWords / 2.5)
    const mins = Math.floor(estimatedSec / 60)
    const secs = estimatedSec % 60

    // Capture original narrations exactly once when scriptData has scenes
    if (scriptData?.scenes && scriptData.scenes.length > 0 && origNarrations.length === 0 && !isGenerating) {
        setOrigNarrations(scriptData.scenes.map((s: Scene) => s.narration))
    }

    const handleNarrationChange = useCallback((i: number, val: string) => {
        if (!scriptData) return
        const updated = [...scriptData.scenes]
        updated[i] = { ...updated[i], narration: val }
        setScriptData({ ...scriptData, scenes: updated })
        setEditedSet(prev => new Set(prev).add(i))
    }, [scriptData, setScriptData])

    const handleRegenScene = async (i: number) => {
        if (!scriptData) return
        setRegenIndex(i)
        try {
            const res = await fetch("/api/studio/generate-script", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    topic: `Rewrite only scene ${i + 1}. Context: ${topic || seriesNiche}`,
                    language, seriesNiche, contextMarkdown,
                }),
            })
            const data = await res.json()
            if (data.scriptData?.scenes?.[0]) {
                const updated = [...scriptData.scenes]
                updated[i] = {
                    ...updated[i],
                    narration:   data.scriptData.scenes[0].narration,
                    imagePrompt: data.scriptData.scenes[0].imagePrompt || updated[i].imagePrompt,
                    videoPrompt: data.scriptData.scenes[0].videoPrompt || updated[i].videoPrompt,
                }
                setScriptData({ ...scriptData, scenes: updated })
                toast.success(`Scene ${i + 1} regenerated!`)
            }
        } catch { toast.error("Regeneration failed") }
        setRegenIndex(null)
    }

    const handleEnhanceScene = async (i: number, instruction: string) => {
        if (!scriptData) return
        try {
            const prevNarration = i > 0 ? (scriptData.scenes[i - 1]?.narration || "") : ""
            const nextNarration = i < scriptData.scenes.length - 1 ? (scriptData.scenes[i + 1]?.narration || "") : ""
            const res = await fetch("/api/studio/enhance-scene", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    currentNarration: scriptData.scenes[i].narration,
                    instruction,
                    prevNarration,
                    nextNarration,
                    sceneIndex: i,
                    totalScenes: scriptData.scenes.length,
                }),
            })
            const data = await res.json()
            console.log("🎬 enhance-scene client response:", {
                status: res.status,
                narrationLength: data.narration?.length,
                narrationPreview: data.narration?.slice(0, 200),
                error: data.error,
            })
            if (data.narration) {
                const updated = [...scriptData.scenes]
                updated[i] = { ...updated[i], narration: data.narration }
                setScriptData({ ...scriptData, scenes: updated })
                // Giving human touch credit because user prompted AI
                setEditedSet(prev => new Set(prev).add(i)) 
                toast.success(`Scene ${i + 1} enhanced!`)
            } else {
                toast.error(data.error || "Enhancement failed")
                throw new Error(data.error || "Invalid response")
            }
        } catch (err: any) {
            if (!err.message || err.message === "Invalid response") {
                toast.error("Failed to enhance scene")
            }
            throw err
        }
    }

    const handleExport = () => {
        if (!scriptData) return
        const text = scriptData.scenes.map((s, i) => `Scene ${i + 1}:\n${s.narration}`).join("\n\n---\n\n")
        const blob = new Blob([text], { type: "text/plain" })
        const url  = URL.createObjectURL(blob)
        const a    = document.createElement("a")
        a.href = url; a.download = "studio_script.txt"; a.click()
        URL.revokeObjectURL(url)
    }

    const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file || !scriptData) return
        const reader = new FileReader()
        reader.onload = () => {
            const text   = reader.result as string
            const blocks = text.split(/---\n?/).filter(Boolean)
            const scenes = blocks.length === scriptData.scenes.length ? blocks : text.split(/\n{2,}/).filter(Boolean)
            const updated = scriptData.scenes.map((s, i) => ({
                ...s,
                narration: (scenes[i] || "").replace(/^Scene \d+:?\s*/i, "").trim() || s.narration
            }))
            setScriptData({ ...scriptData, scenes: updated })
            toast.success("Script imported!")
        }
        reader.readAsText(file)
        e.target.value = ""
    }

    // ── Loading state ─────────────────────────────────────────────────────────
    if (isGenerating) {
        return <ScriptGeneratingLoader hasDocument={!!contextMarkdown} hasTopic={!!topic} />
    }

    if (!scriptData) return null

    // Compute realistic organic edit score using word-level Levenshtein distance
    let totalOrigWords = 1 // avoid div-by-zero
    let totalEditedWords = 0
    if (origNarrations.length > 0) {
        totalOrigWords = 0
        scriptData.scenes.forEach((scene, i) => {
            const orig = origNarrations[i] || ""
            const curr = scene.narration
            const origLen = orig.split(/\s+/).filter(Boolean).length
            totalOrigWords += origLen
            if (orig !== curr) {
                totalEditedWords += getWordEditDistance(orig, curr)
            }
        })
    }
    
    // Multiplier: Changing 40% of the words yields 100% human touch score
    const score = Math.min(100, Math.round((totalEditedWords / Math.max(1, totalOrigWords)) * 2.5 * 100))
    const isCreatorMode = score >= 50

    return (
        <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="space-y-5"
        >
            {/* Header */}
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h2 className="text-lg font-bold text-foreground leading-tight">{scriptData.videoTitle}</h2>
                    <div className="flex items-center gap-2.5 mt-1">
                        <span className="text-xs text-muted-foreground">{totalWords} words</span>
                        <span className="text-muted-foreground/40">·</span>
                        <span className="text-xs text-muted-foreground">~{mins}:{secs.toString().padStart(2, "0")}</span>
                        <span className="text-muted-foreground/40">·</span>
                        <span className="text-xs text-muted-foreground">{scriptData.scenes.length} scenes</span>
                    </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    <button
                        onClick={handleExport}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-muted/60 border border-border/50 text-muted-foreground hover:text-foreground text-xs transition-colors cursor-pointer"
                    >
                        <Download className="w-3 h-3" /> Export
                    </button>
                    <button
                        onClick={() => fileInputRef.current?.click()}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-muted/60 border border-border/50 text-muted-foreground hover:text-foreground text-xs transition-colors cursor-pointer"
                    >
                        <Upload className="w-3 h-3" /> Import
                    </button>
                    <input ref={fileInputRef} type="file" accept=".txt" className="hidden" onChange={handleImport} />
                </div>
            </div>

            {/* Web Sources Researched */}
            {webSources.length > 0 && (
                <div className="rounded-xl border border-border/40 bg-white/90 overflow-hidden">
                    <button
                        onClick={() => setShowSources(v => !v)}
                        className="w-full flex items-center justify-between px-4 py-3 text-left cursor-pointer hover:bg-muted/30 transition-colors"
                    >
                        <div className="flex items-center gap-2">
                            <Globe className="w-3.5 h-3.5" style={{ color: '#646CD1' }} />
                            <span className="text-xs font-semibold text-foreground">Sources Researched</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold" style={{ background: 'rgba(100,108,209,0.08)', color: '#646CD1', border: '1px solid rgba(100,108,209,0.15)' }}>
                                {webSources.length} sources
                            </span>
                        </div>
                        <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform duration-300 ${showSources ? 'rotate-180' : ''}`} />
                    </button>
                    <AnimatePresence>
                        {showSources && (
                            <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
                                className="overflow-hidden"
                            >
                                <div className="px-4 pb-3 pt-1 border-t border-border/30 space-y-1.5">
                                    <p className="text-[11px] text-muted-foreground/60 mb-2">
                                        Facts from these sources were used to write the script
                                    </p>
                                    {webSources.map((src, i) => {
                                        let domain = ''
                                        try { domain = new URL(src.url).hostname.replace('www.', '') } catch { domain = src.url }
                                        return (
                                            <a
                                                key={i}
                                                href={src.url}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-muted/40 transition-colors group"
                                            >
                                                <img
                                                    src={`https://www.google.com/s2/favicons?domain=${domain}&sz=32`}
                                                    alt=""
                                                    className="w-4 h-4 rounded-sm shrink-0"
                                                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                                                />
                                                <div className="min-w-0 flex-1">
                                                    <p className="text-xs font-medium text-foreground truncate">{src.title}</p>
                                                    <p className="text-[10px] text-muted-foreground/50">{domain}</p>
                                                </div>
                                                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0" style={{
                                                    background: src.source === 'wikipedia' ? 'rgba(16,185,129,0.08)' : 'rgba(100,108,209,0.08)',
                                                    color: src.source === 'wikipedia' ? '#10b981' : '#646CD1',
                                                    border: `1px solid ${src.source === 'wikipedia' ? 'rgba(16,185,129,0.15)' : 'rgba(100,108,209,0.15)'}`,
                                                }}>
                                                    {src.source === 'wikipedia' ? 'Wiki' : 'Web'}
                                                </span>
                                                <ExternalLink className="w-3 h-3 text-muted-foreground/30 group-hover:text-muted-foreground/60 transition-colors shrink-0" />
                                            </a>
                                        )
                                    })}
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            )}

            {/* Human Touch Score */}
            <div className={`rounded-xl border p-4 transition-all duration-500 bg-white shadow-sm ${
                isCreatorMode ? 'border-primary/50' : 'border-border/60'
            }`}>
                <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-foreground">✍️ Human Touch Score</span>
                        <AnimatePresence>
                            {isCreatorMode && (
                                <motion.span
                                    initial={{ scale: 0 }}
                                    animate={{ scale: 1 }}
                                    className="text-[10px] bg-primary/10 text-primary border border-primary/20 px-2 py-0.5 rounded-full font-bold"
                                >
                                    Creator Mode ✅
                                </motion.span>
                            )}
                        </AnimatePresence>
                    </div>
                    <span className={`text-sm font-bold ${isCreatorMode ? 'text-primary' : 'text-muted-foreground'}`}>
                        {score}%
                    </span>
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <motion.div
                        className={`h-full rounded-full ${isCreatorMode ? 'bg-primary' : 'bg-primary/50'}`}
                        animate={{ width: `${score}%` }}
                        transition={{ type: "spring", stiffness: 100, damping: 20 }}
                    />
                </div>
                <p className="text-[11px] text-muted-foreground mt-2">
                    {score === 0
                        ? "Edit at least one scene narration to start building human touch"
                        : isCreatorMode
                            ? "Strong human influence — harder for AI detectors to flag"
                            : "Keep editing scenes to reach Creator Mode (50%+)"}
                </p>
            </div>

            {/* Scene rows */}
            <div className="space-y-3">
                <div className="flex items-center gap-2">
                    <PenLine className="w-4 h-4 text-primary" />
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        Edit Your Script — Every Change Adds Human Touch
                    </span>
                </div>
                {scriptData.scenes.map((scene, i) => (
                    <SceneScriptRow
                        key={i}
                        scene={scene}
                        index={i}
                        isEdited={editedSet.has(i)}
                        onNarrationChange={handleNarrationChange}
                        onRegenerate={handleRegenScene}
                        onEnhance={handleEnhanceScene}
                        isRegenerating={regenIndex === i}
                        docImages={docImages}
                    />
                ))}
            </div>
        </motion.div>
    )
}
