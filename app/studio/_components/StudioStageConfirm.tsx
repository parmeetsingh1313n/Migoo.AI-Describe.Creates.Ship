"use client"
import { AnimatePresence, motion, useMotionValue, useTransform } from 'framer-motion'
import { Check, Loader2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

type AssetType = "ai" | "user_upload" | "doc_image"

interface Scene {
    narration: string
    imagePrompt: string
    videoPrompt: string
    sceneCategory: string
    duration: number
    wordCount: number
    sceneNumber: number
}

interface Props {
    topic: string
    scriptData: { videoTitle: string; scenes: Scene[] } | null
    sceneAssetTypes: AssetType[]
    voice: string
    captionStyle: string
    music: string
    language: string
    contextMarkdown: string
    isLaunching: boolean
    onLaunch: () => void
    webSourceCount?: number
}

const GRADIENT = 'linear-gradient(135deg, #529EDC 0%, #646CD1 50%, #8552DD 100%)'

// ─── Swipe-to-Launch ──────────────────────────────────────────────────────────

function SwipeLauncher({ onLaunch, isLaunching }: { onLaunch: () => void; isLaunching: boolean }) {
    const containerRef = useRef<HTMLDivElement>(null)
    const [containerWidth, setContainerWidth] = useState(0)
    const [launched, setLaunched] = useState(false)
    const thumbSize = 52
    const maxDrag = Math.max(0, containerWidth - thumbSize - 8)

    useEffect(() => {
        if (!containerRef.current) return
        setContainerWidth(containerRef.current.offsetWidth)
        const obs = new ResizeObserver(entries => {
            for (const e of entries) setContainerWidth(e.contentRect.width)
        })
        obs.observe(containerRef.current)
        return () => obs.disconnect()
    }, [])

    const x = useMotionValue(0)
    const fill = useTransform(x, [0, maxDrag], ['0%', '100%'])
    const labelOpacity = useTransform(x, [0, maxDrag * 0.2], [1, 0])

    const handleDragEnd = useCallback(() => {
        if (x.get() > maxDrag * 0.7) {
            setLaunched(true)
            x.set(maxDrag)
            setTimeout(onLaunch, 350)
        } else {
            x.set(0)
        }
    }, [maxDrag, onLaunch, x])

    if (isLaunching || launched) {
        return (
            <motion.div
                initial={{ opacity: 0.9 }}
                animate={{ opacity: 1 }}
                className="relative w-full h-[56px] rounded-2xl overflow-hidden"
                style={{ background: GRADIENT }}
            >
                <div className="absolute inset-0 flex items-center justify-center gap-2.5">
                    <Loader2 className="w-4 h-4 text-white/80 animate-spin" />
                    <span className="text-white font-semibold text-sm">Launching production…</span>
                </div>
                <motion.div
                    className="absolute inset-0 pointer-events-none"
                    style={{
                        background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.12), transparent)',
                        backgroundSize: '200% 100%',
                    }}
                    animate={{ backgroundPosition: ['200% 0', '-200% 0'] }}
                    transition={{ duration: 1.8, repeat: Infinity, ease: 'linear' }}
                />
            </motion.div>
        )
    }

    return (
        <div
            ref={containerRef}
            className="relative w-full h-[56px] rounded-2xl overflow-hidden select-none"
            style={{
                background: 'linear-gradient(135deg, rgba(82,158,220,0.08), rgba(100,108,209,0.06), rgba(133,82,221,0.08))',
                border: '1.5px solid rgba(100,108,209,0.15)',
            }}
        >
            {/* Progress fill */}
            <motion.div
                className="absolute inset-y-0 left-0 rounded-2xl pointer-events-none"
                style={{
                    width: fill,
                    background: 'linear-gradient(135deg, rgba(82,158,220,0.12), rgba(100,108,209,0.10), rgba(133,82,221,0.12))',
                }}
            />

            {/* Label */}
            <motion.div
                className="absolute inset-0 flex items-center justify-center pointer-events-none gap-2"
                style={{ opacity: labelOpacity }}
            >
                <span className="text-[13px] font-medium" style={{ color: 'rgba(100,108,209,0.55)' }}>
                    Slide to launch production
                </span>
                <motion.span
                    animate={{ x: [0, 5, 0] }}
                    transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
                    style={{ color: 'rgba(100,108,209,0.4)' }}
                >
                    →
                </motion.span>
            </motion.div>

            {/* Thumb */}
            <motion.div
                drag="x"
                dragConstraints={{ left: 0, right: maxDrag }}
                dragElastic={0.03}
                dragMomentum={false}
                onDragEnd={handleDragEnd}
                style={{ x }}
                className="absolute top-[4px] left-[4px] w-[48px] h-[48px] rounded-xl cursor-grab active:cursor-grabbing z-10"
            >
                <div
                    className="w-full h-full rounded-xl flex items-center justify-center"
                    style={{
                        background: GRADIENT,
                        boxShadow: '0 4px 16px rgba(100,108,209,0.3)',
                    }}
                >
                    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                        <path d="M4 9h10M10 5l4 4-4 4" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                </div>
            </motion.div>
        </div>
    )
}

// ─── Animated gradient text ───────────────────────────────────────────────────

function GradientText({ children, className = '' }: { children: React.ReactNode; className?: string }) {
    return (
        <span
            className={className}
            style={{
                backgroundImage: GRADIENT,
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
            }}
        >
            {children}
        </span>
    )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function StudioStageConfirm({
    topic, scriptData, sceneAssetTypes, voice, captionStyle,
    music, language, contextMarkdown, isLaunching, onLaunch, webSourceCount = 0
}: Props) {
    if (!scriptData) return null

    const totalWords   = scriptData.scenes.reduce((s: number, sc: Scene) => s + (sc.narration?.split(/\s+/).filter(Boolean).length || 0), 0)
    const estimatedSec = Math.round(totalWords / 2.5)
    const mins = Math.floor(estimatedSec / 60)
    const secs = estimatedSec % 60

    const userUploadCount = sceneAssetTypes.filter(t => t === "user_upload").length
    const docImageCount   = sceneAssetTypes.filter(t => t === "doc_image").length
    const aiCount         = sceneAssetTypes.filter(t => t === "ai").length
    const renderMins      = Math.ceil((scriptData.scenes.length * 2.5) + 3)

    const configRows: [string, string][] = [
        ['Voice',    voice],
        ['Music',    music],
        ['Language', language],
        ['Captions', captionStyle],
        ...(contextMarkdown ? [['Context', 'Document loaded'] as [string, string]] : []),
        ...(webSourceCount > 0 ? [[`Sources`, `${webSourceCount} web references`] as [string, string]] : []),
    ]

    return (
        <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
            className="space-y-6"
        >
            {/* ── Header ── */}
            <div>
                <h2 className="text-xl font-bold text-foreground mb-1">Review &amp; Launch</h2>
                <p className="text-sm text-muted-foreground">Everything's set — take one last look, then launch</p>
            </div>

            {/* ── Title + Stats hero ── */}
            <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.08, duration: 0.4 }}
                className="rounded-2xl overflow-hidden"
                style={{
                    background: GRADIENT,
                    padding: '2px',  // gradient border trick
                }}
            >
                <div className="rounded-[14px] bg-white p-5">
                    <p className="text-[10px] font-bold uppercase tracking-[0.14em] mb-2" style={{ color: '#646CD1' }}>
                        Video Title
                    </p>
                    <h3 className="text-lg font-bold text-foreground leading-snug mb-4">
                        {scriptData.videoTitle}
                    </h3>
                    {topic && topic !== scriptData.videoTitle && (
                        <p className="text-xs text-muted-foreground/60 mb-4">{topic.slice(0, 90)}</p>
                    )}

                    {/* Stats row */}
                    <div className="flex items-center gap-5 flex-wrap">
                        {[
                            { value: `${mins}:${secs.toString().padStart(2, '0')}`, label: 'duration' },
                            { value: `${scriptData.scenes.length}`, label: 'scenes' },
                            { value: `${totalWords}`, label: 'words' },
                            { value: `${aiCount}`, label: 'AI generated' },
                            ...((userUploadCount + docImageCount) > 0
                                ? [{ value: `${userUploadCount + docImageCount}`, label: 'your media' }]
                                : []),
                        ].map((stat, i) => (
                            <motion.div
                                key={i}
                                initial={{ opacity: 0, y: 6 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.15 + i * 0.04 }}
                                className="flex items-baseline gap-1.5"
                            >
                                <GradientText className="text-xl font-black tabular-nums tracking-tight">
                                    {stat.value}
                                </GradientText>
                                <span className="text-[11px] text-muted-foreground/60 font-medium">{stat.label}</span>
                            </motion.div>
                        ))}
                    </div>
                </div>
            </motion.div>

            {/* ── Configuration summary ── */}
            <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2, duration: 0.4 }}
                className="rounded-xl border border-border/40 bg-white/90 overflow-hidden"
            >
                <div className="px-4 py-3 border-b border-border/30">
                    <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">Production Config</p>
                </div>
                <div className="divide-y divide-border/20">
                    {configRows.map(([key, val], i) => (
                        <motion.div
                            key={key}
                            initial={{ opacity: 0, x: -8 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: 0.25 + i * 0.04 }}
                            className="flex items-center justify-between px-4 py-2.5"
                        >
                            <span className="text-[13px] text-muted-foreground">{key}</span>
                            <div className="flex items-center gap-2">
                                <span className="text-[13px] font-semibold text-foreground capitalize">{val}</span>
                                <div className="w-4 h-4 rounded-full flex items-center justify-center" style={{ background: 'rgba(100,108,209,0.1)' }}>
                                    <Check className="w-2.5 h-2.5" style={{ color: '#646CD1' }} strokeWidth={3} />
                                </div>
                            </div>
                        </motion.div>
                    ))}
                </div>
            </motion.div>

            {/* ── Render time ── */}
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.4 }}
                className="flex items-center gap-3 px-4 py-3 rounded-xl"
                style={{
                    background: 'linear-gradient(135deg, rgba(82,158,220,0.06), rgba(133,82,221,0.04))',
                    border: '1px solid rgba(100,108,209,0.08)',
                }}
            >
                <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: '#646CD1' }} />
                <p className="text-xs text-muted-foreground leading-relaxed">
                    Estimated render: <span className="font-semibold text-foreground">{renderMins}–{renderMins + 5} min</span>
                    <span className="mx-1.5 text-border">·</span>
                    You can navigate away while it processes
                </p>
            </motion.div>

            {/* ── Swipe Launcher ── */}
            <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5, duration: 0.4 }}
            >
                <SwipeLauncher onLaunch={onLaunch} isLaunching={isLaunching} />
                <p className="text-center text-[11px] text-muted-foreground/50 mt-3">
                    You'll be redirected to watch generation progress
                </p>
            </motion.div>
        </motion.div>
    )
}
