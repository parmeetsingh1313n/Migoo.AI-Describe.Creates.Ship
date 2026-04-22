"use client"
import { AnimatePresence, motion } from 'framer-motion'
import { BookOpen, ChevronDown, MessageSquare, Sparkles, Wand2 } from 'lucide-react'
import { useState, useEffect } from 'react'
import DocumentUploadZone from './DocumentUploadZone'

interface Props {
    seriesList: { seriesId: string, title: string }[]
    seriesId: string
    setSeriesId: (id: string) => void
    niche: string
    language: string
    topic: string
    setTopic: (v: string) => void
    instruction: string
    setInstruction: (v: string) => void
    contextMarkdown: string
    setContextMarkdown: (v: string) => void
    docImages: string[]
    setDocImages: (v: string[]) => void
}

const DEFAULT_ANGLES = [
    "🔥 Hidden truth no one talks about",
    "⚡ Future prediction that sounds crazy",
    "🤯 Jaw-dropping perspective shift",
    "🕵️ Untold origin story",
    "💡 Secret technique most miss",
    "⚔️ Debunking a popular myth",
    "📊 A number that changes everything",
    "🌍 Bizarre connection between two things",
]

export default function StudioStageSource({ seriesList, seriesId, setSeriesId, niche, language, topic, setTopic, instruction, setInstruction, contextMarkdown, setContextMarkdown, docImages, setDocImages }: Props) {
    const [tab, setTab]         = useState<"ai" | "custom">("ai")
    const [showDoc, setShowDoc] = useState(false)
    const [viralAngles, setViralAngles] = useState<string[]>(DEFAULT_ANGLES)
    const [loadingAngles, setLoadingAngles] = useState(false)

    const seriesTitle = seriesList.find(s => s.seriesId === seriesId)?.title || niche?.replace("custom:", "").trim() || "Your Niche"

    useEffect(() => {
        if (!niche || tab !== "ai") return
        const fetchAngles = async () => {
            setLoadingAngles(true)
            try {
                const res = await fetch("/api/studio/generate-angles", {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ niche, seriesTitle }),
                })
                const data = await res.json()
                if (data.angles && data.angles.length > 0) {
                    const icons = ["🔥", "⚡", "🤯", "🕵️", "💡", "⚔️", "📊", "🌍"]
                    setViralAngles(data.angles.map((a: string, i: number) => `${icons[i % icons.length]} ${a}`))
                }
            } catch (err) {
                console.error("Failed to fetch viral angles:", err)
            } finally {
                setLoadingAngles(false)
            }
        }
        const timeout = setTimeout(fetchAngles, 400);
        return () => clearTimeout(timeout)
    }, [niche, tab, seriesTitle])

    return (
        <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
            className="space-y-6 flex flex-col h-full"
        >
            {/* Heading & Target Series */}
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                <div>
                    <h2 className="text-xl font-bold text-foreground mb-1">What's the video about?</h2>
                    <p className="text-sm text-muted-foreground">Let AI surprise you, or take full control of the topic</p>
                </div>
                <div className="relative shrink-0 mt-1 sm:mt-0">
                    <select
                        value={seriesId}
                        onChange={e => setSeriesId(e.target.value)}
                        className="appearance-none bg-muted/40 hover:bg-muted/60 w-full sm:w-[180px] pr-8 pl-3 py-2 rounded-lg border border-border/80 text-xs font-semibold focus:outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition-all cursor-pointer text-foreground truncate shadow-sm"
                    >
                        <option value="">✨ Start a New Series</option>
                        {seriesList.map(s => (
                            <option key={s.seriesId} value={s.seriesId}>{s.title}</option>
                        ))}
                    </select>
                    <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                </div>
                {/* Language badge */}
                <span className={`shrink-0 text-[10px] font-bold px-2.5 py-1 rounded-full border ${
                    language === 'hi-IN' 
                        ? 'bg-orange-50 text-orange-700 border-orange-200' 
                        : 'bg-blue-50 text-blue-700 border-blue-200'
                }`}>
                    {language === 'hi-IN' ? '🇮🇳 हिन्दी' : '🌐 English'}
                </span>
            </div>

            {/* Mode tabs */}
            <div className="flex gap-2 p-1 rounded-xl bg-muted/60 border border-border/40">
                <button
                    onClick={() => setTab("ai")}
                    className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-all duration-200 cursor-pointer ${
                        tab === "ai"
                            ? 'bg-white shadow-sm text-foreground border border-border/50'
                            : 'text-muted-foreground hover:text-foreground'
                    }`}
                >
                    <Wand2 className="w-4 h-4" />
                    Smart Auto-Pilot
                </button>
                <button
                    onClick={() => setTab("custom")}
                    className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-all duration-200 cursor-pointer ${
                        tab === "custom"
                            ? 'bg-white shadow-sm text-foreground border border-border/50'
                            : 'text-muted-foreground hover:text-foreground'
                    }`}
                >
                    <MessageSquare className="w-4 h-4" />
                    My Own Topic
                </button>
            </div>

            <AnimatePresence mode="wait">
                {tab === "ai" ? (
                    <motion.div
                        key="ai"
                        initial={{ opacity: 0, x: -16 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 16 }}
                        transition={{ duration: 0.25 }}
                        className="space-y-4"
                    >
                        <div className="rounded-xl border border-primary/15 bg-primary/5 p-5">
                            <p className="text-base font-semibold text-foreground mb-4 capitalize">
                                📌 {seriesTitle}
                            </p>
                            <p className="text-[11px] text-muted-foreground font-semibold uppercase tracking-wider mb-3">
                                Click a topic to write your script
                            </p>
                            <div className="grid grid-cols-2 gap-2 relative">
                                {loadingAngles && (
                                    <div className="absolute inset-0 bg-white/60 backdrop-blur-[2px] z-10 flex items-center justify-center rounded-lg">
                                        <div className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                                    </div>
                                )}
                                {viralAngles.map((angle, i) => (
                                    <button
                                        key={i}
                                        title={angle}
                                        onClick={() => {
                                            setTopic(angle.slice(2).trim());
                                            setTab("custom");
                                        }}
                                        className="text-left text-xs text-muted-foreground bg-white/80 hover:bg-white hover:text-primary hover:border-primary/40 rounded-lg px-3 py-2.5 border border-border/40 truncate cursor-pointer transition-all shadow-sm"
                                    >
                                        {angle}
                                    </button>
                                ))}
                            </div>
                        </div>
                        {topic && (
                            <button onClick={() => setTopic("")} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
                                Clear custom topic
                            </button>
                        )}
                    </motion.div>
                ) : (
                    <motion.div
                        key="custom"
                        initial={{ opacity: 0, x: 16 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -16 }}
                        transition={{ duration: 0.25 }}
                        className="space-y-4"
                    >
                        {/* Topic */}
                        <div>
                            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                                Video Topic <span className="text-destructive">*</span>
                            </label>
                            <textarea
                                value={topic}
                                onChange={e => setTopic(e.target.value)}
                                placeholder={`e.g. "Why India's fintech is beating the US" or "Top 5 myths about intermittent fasting"`}
                                className="w-full px-4 py-3 rounded-xl bg-muted/40 border border-border/60 text-foreground placeholder:text-muted-foreground/50 text-sm focus:outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition-all resize-none"
                                rows={2}
                            />
                        </div>

                        {/* Direction */}
                        <div>
                            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                                Creative Direction <span className="font-normal normal-case text-muted-foreground/50">(optional)</span>
                            </label>
                            <input
                                value={instruction}
                                onChange={e => setInstruction(e.target.value)}
                                placeholder={`e.g. "Focus on shocking statistics" or "Make it controversial"`}
                                className="w-full px-4 py-3 rounded-xl bg-muted/40 border border-border/60 text-foreground placeholder:text-muted-foreground/50 text-sm focus:outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition-all"
                            />
                        </div>

                        {/* Document upload dropdown */}
                        <div className="rounded-xl border border-border bg-muted/20 overflow-hidden">
                            <button
                                onClick={() => setShowDoc(v => !v)}
                                className="w-full flex items-center justify-between px-4 py-3.5 text-left cursor-pointer hover:bg-muted/40 transition-colors"
                            >
                                <div className="flex items-center gap-2.5">
                                    <BookOpen className="w-4 h-4 text-primary" />
                                    <span className="text-sm font-semibold text-foreground">Upload Reference Files</span>
                                    <span className="text-[10px] bg-primary/10 text-primary border border-primary/20 px-1.5 py-0.5 rounded-full font-semibold">
                                        Migoo Engine
                                    </span>
                                    {(contextMarkdown || docImages.length > 0) && (
                                        <span className="text-[10px] bg-emerald-100 text-emerald-700 border border-emerald-200 px-1.5 py-0.5 rounded-full font-semibold">
                                            ✓ Ready
                                        </span>
                                    )}
                                </div>
                                <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform duration-300 ${showDoc ? 'rotate-180' : ''}`} />
                            </button>

                            <AnimatePresence>
                                {showDoc && (
                                    <motion.div
                                        initial={{ height: 0, opacity: 0 }}
                                        animate={{ height: "auto", opacity: 1 }}
                                        exit={{ height: 0, opacity: 0 }}
                                        transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
                                        className="overflow-hidden"
                                    >
                                        <div className="px-4 pb-4 pt-1 border-t border-border/50">
                                            <p className="text-xs text-muted-foreground mb-4">
                                                Upload PDFs, ZIPs, or native images. Migoo Engine extracts structured data from your documents to write a fact-based script.
                                            </p>
                                            <DocumentUploadZone
                                                onResult={r => {
                                                    setContextMarkdown(r.markdown)
                                                    setDocImages(r.images)
                                                }}
                                            />
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    )
}
