"use client"
import { AnimatePresence, motion } from 'framer-motion'
import { Loader2, Sparkles, ChevronDown, ChevronUp, Image as ImageIcon, PenLine, RefreshCw, RotateCcw } from 'lucide-react'
import { useState, useRef, useEffect } from 'react'

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
    scene: Scene
    index: number
    isEdited: boolean
    onNarrationChange: (i: number, val: string) => void
    onRegenerate: (i: number) => void
    isRegenerating: boolean
    docImages: string[]
    onEnhance?: (i: number, instruction: string) => Promise<void>
}

const CATEGORY_BADGE: Record<string, { label: string; cls: string }> = {
    real_entity:  { label: "📸 Real entity",  cls: "bg-amber-50 text-amber-700 border-amber-200"   },
    living_thing: { label: "🐾 Living thing", cls: "bg-blue-50 text-blue-700 border-blue-200"     },
    general:      { label: "🎨 Abstract",      cls: "bg-muted text-muted-foreground border-border/50" },
    doc_image:    { label: "📊 Doc chart",     cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
}

const CATEGORY_ICON_CLS: Record<string, string> = {
    real_entity:  "from-amber-400 to-orange-400",
    living_thing: "from-blue-400 to-cyan-400",
    general:      "from-muted-foreground to-slate-500",
    doc_image:    "from-emerald-400 to-green-500",
}

export default function SceneScriptRow({ scene, index, isEdited, onNarrationChange, onRegenerate, isRegenerating, docImages, onEnhance }: Props) {
    const [expanded, setExpanded] = useState(false)
    const [origText]              = useState(scene.narration)
    const [showAI, setShowAI]     = useState(false)
    const [aiPrompt, setAIPrompt] = useState("")
    const [isEnhancing, setIsEnhancing] = useState(false)
    const inputRef    = useRef<HTMLInputElement>(null)
    const textareaRef = useRef<HTMLTextAreaElement>(null)

    // Auto-resize textarea whenever narration content changes
    useEffect(() => {
        const el = textareaRef.current
        if (!el) return
        el.style.height = 'auto'           // reset first so shrinking works
        el.style.height = `${el.scrollHeight}px`
    }, [scene.narration])

    const words    = scene.narration.split(/\s+/).filter(Boolean).length
    const duration = Math.round(words / 2.5)

    const badge    = CATEGORY_BADGE[scene.sceneCategory] ?? CATEGORY_BADGE.general
    const iconCls  = CATEGORY_ICON_CLS[scene.sceneCategory] ?? CATEGORY_ICON_CLS.general

    return (
        <motion.div
            layout
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05, duration: 0.35 }}
            className={`rounded-xl border transition-all duration-300 overflow-hidden ${
                isEdited
                    ? 'border-primary/30 bg-primary/5 shadow-sm'
                    : 'border-border/50 bg-white/60'
            }`}
        >
            {/* Header row */}
            <div className="flex items-center gap-3 px-4 py-3">
                <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${iconCls} flex items-center justify-center shrink-0 shadow-sm`}>
                    <span className="text-sm font-black text-white">{index + 1}</span>
                </div>

                <div className="flex items-center gap-2 flex-1 min-w-0">
                    <span className={`text-xs border px-2.5 py-0.5 rounded-full font-medium shrink-0 ${badge.cls}`}>
                        {badge.label}
                    </span>
                    {isEdited && (
                        <motion.span
                            initial={{ scale: 0, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            className="text-xs bg-primary/10 text-primary border border-primary/20 px-2 py-0.5 rounded-full font-semibold flex items-center gap-1 shrink-0"
                        >
                            <PenLine className="w-3 h-3" />
                            Edited
                        </motion.span>
                    )}
                </div>

                <span className="text-xs text-muted-foreground shrink-0">{words}w · ~{duration}s</span>

                <button
                    onClick={() => setExpanded(v => !v)}
                    className="w-8 h-8 rounded-lg bg-muted/60 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-all cursor-pointer"
                >
                    {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>
            </div>

            {/* Narration textarea — auto-resizes to show full content */}
            <div className="px-4 pb-3 relative group">
                <textarea
                    ref={textareaRef}
                    value={scene.narration}
                    onChange={e => onNarrationChange(index, e.target.value)}
                    rows={3}
                    style={{ overflow: 'hidden', minHeight: '80px' }}
                    className={`w-full px-4 py-3 rounded-2xl text-base leading-relaxed resize-y focus:outline-none transition-all duration-300 shadow-inner ${
                        isEdited
                            ? 'bg-primary/5 border border-primary/20 text-foreground focus:border-primary/40 focus:ring-2 focus:ring-primary/10'
                            : 'bg-muted/30 border border-border/50 text-foreground focus:border-primary/30 focus:ring-2 focus:ring-primary/10'
                    }`}
                />

                {/* Floating AI Trigger */}
                <div className={`absolute right-6 bottom-6 transition-all duration-300 ${showAI ? 'opacity-0 pointer-events-none translate-y-2' : 'opacity-0 group-hover:opacity-100 translate-y-0'}`}>
                    <button
                        onClick={() => { setShowAI(true); setTimeout(() => inputRef.current?.focus(), 100) }}
                        className="flex items-center justify-center p-2 rounded-full bg-white shadow-md border border-primary/20 hover:scale-110 hover:shadow-lg hover:border-primary/40 text-primary transition-all cursor-pointer group/ai"
                        title="AI Rewrite"
                    >
                        <Sparkles className="w-4 h-4 group-hover/ai:text-fuchsia-500 transition-colors" />
                    </button>
                </div>

                {/* Elegant Pill AI Input */}
                <AnimatePresence>
                    {showAI && (
                        <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
                            className="overflow-hidden mt-3"
                        >
                            <div className="flex items-center gap-2 p-1.5 rounded-full bg-gradient-to-r from-primary/10 via-fuchsia-500/10 to-cyan-500/10 border border-primary/30 shadow-inner shadow-primary/5 relative">
                                <div className="p-1.5 rounded-full bg-white shadow-sm shrink-0 border border-primary/10">
                                    <Sparkles className="w-3.5 h-3.5 text-primary" />
                                </div>
                                <input
                                    ref={inputRef}
                                    value={aiPrompt}
                                    onChange={e => setAIPrompt(e.target.value)}
                                    placeholder="Tell AI how to rewrite this scene..."
                                    className="flex-1 bg-transparent border-none text-xs font-medium outline-none text-foreground placeholder:text-muted-foreground/70 focus:ring-0 min-w-0"
                                    disabled={isEnhancing}
                                    onKeyDown={async e => {
                                        if (e.key === 'Enter' && aiPrompt.trim() && !isEnhancing && onEnhance) {
                                            setIsEnhancing(true)
                                            try {
                                                await onEnhance(index, aiPrompt.trim())
                                                setShowAI(false)
                                                setAIPrompt("")
                                            } catch (err) {
                                                // parent shows toast, we just prevent stuck state
                                            } finally {
                                                setIsEnhancing(false)
                                            }
                                        }
                                        if (e.key === 'Escape' && !isEnhancing) {
                                            setShowAI(false)
                                        }
                                    }}
                                />

                                {isEnhancing ? (
                                    <div className="px-4 py-1.5 shrink-0 flex items-center justify-center">
                                        <Loader2 className="w-4 h-4 text-primary animate-spin" />
                                    </div>
                                ) : (
                                    <button
                                        disabled={!aiPrompt.trim()}
                                        onClick={async () => {
                                            if (!aiPrompt.trim() || !onEnhance) return
                                            setIsEnhancing(true)
                                            try {
                                                await onEnhance(index, aiPrompt.trim())
                                                setShowAI(false)
                                                setAIPrompt("")
                                            } catch (err) {
                                                // parent shows toast, we just prevent stuck state
                                            } finally {
                                                setIsEnhancing(false)
                                            }
                                        }}
                                        className="text-[10px] font-bold uppercase tracking-wider bg-white shadow-sm border border-border/80 hover:border-primary/50 text-foreground hover:text-primary px-4 py-1.5 rounded-full transition-all duration-300 disabled:opacity-40 disabled:pointer-events-none shrink-0 cursor-pointer"
                                    >
                                        Rewrite
                                    </button>
                                )}
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {/* Expanded details */}
            <AnimatePresence>
                {expanded && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.28 }}
                        className="overflow-hidden border-t border-border/30"
                    >
                        <div className="px-4 py-3 space-y-3">
                            {scene.imagePrompt && scene.sceneCategory !== "general" && (
                                <div>
                                    <div className="flex items-center gap-1.5 mb-1">
                                        <ImageIcon className="w-3 h-3 text-amber-500" />
                                        <span className="text-[10px] font-semibold text-amber-600 uppercase tracking-wider">Image Prompt</span>
                                    </div>
                                    <p className="text-xs text-muted-foreground leading-relaxed bg-amber-50/60 border border-amber-100 rounded-lg px-3 py-2">
                                        {scene.imagePrompt}
                                    </p>
                                </div>
                            )}

                            <div>
                                <span className="text-[10px] font-semibold text-cyan-600 uppercase tracking-wider block mb-1">🎬 Video Prompt</span>
                                <p className="text-xs text-muted-foreground leading-relaxed bg-cyan-50/60 border border-cyan-100 rounded-lg px-3 py-2">
                                    {scene.videoPrompt}
                                </p>
                            </div>

                            {docImages.length > 0 && (
                                <div>
                                    <p className="text-[10px] font-semibold text-emerald-600 uppercase tracking-wider mb-2">📊 Use Doc Chart</p>
                                    <div className="flex gap-2 flex-wrap">
                                        {docImages.slice(0, 4).map((url, i) => (
                                            // eslint-disable-next-line @next/next/no-img-element
                                            <img
                                                key={i}
                                                src={url}
                                                alt={`chart ${i + 1}`}
                                                className={`w-16 h-16 object-cover rounded-lg border-2 cursor-pointer transition-all ${
                                                    scene.asset_url === url
                                                        ? 'border-emerald-400 scale-105 shadow-md'
                                                        : 'border-border hover:border-emerald-300'
                                                }`}
                                            />
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Actions */}
                            <div className="flex items-center gap-2 pt-1">
                                <button
                                    onClick={() => onRegenerate(index)}
                                    disabled={isRegenerating}
                                    className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/70 disabled:opacity-50 transition-colors cursor-pointer"
                                >
                                    {isRegenerating
                                        ? <><RefreshCw className="w-3 h-3 animate-spin" /> Regenerating…</>
                                        : <><RefreshCw className="w-3 h-3" /> Regenerate scene</>
                                    }
                                </button>
                                {isEdited && (
                                    <button
                                        onClick={() => onNarrationChange(index, origText)}
                                        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors ml-auto cursor-pointer"
                                    >
                                        <RotateCcw className="w-3 h-3" /> Reset
                                    </button>
                                )}
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    )
}
