"use client"
import { AnimatePresence, motion } from 'framer-motion'
import {
    AudioWaveform, ChevronDown, ChevronUp, Gauge, Loader2,
    Mic2, Pause, Play, RefreshCw, Settings2, Sparkles, Volume2
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
    Select, SelectContent, SelectGroup, SelectItem, SelectLabel,
    SelectTrigger, SelectValue
} from '@/components/ui/select'
import WaveformCanvas, { extractPeaks, getWavDuration, mergeWavBase64ToBlob } from './WaveformCanvas'

/* ── Types ─────────────────────────────────────────────────────────────── */

export interface SceneAudioData {
    base64: string
    duration: number
    pace: number
    temperature: number
}

interface Scene {
    narration: string
    sceneNumber: number
    [key: string]: any
}

interface Props {
    scriptData: { videoTitle: string; scenes: Scene[] } | null
    voice: string
    setVoice: (v: string) => void
    language: string
    sceneAudios: (SceneAudioData | null)[]
    setSceneAudios: (audios: (SceneAudioData | null)[]) => void
}

/* ── Official Sarvam v3 Voices ─────────────────────────────────────────── */

const VOICES_EN = [
    // Female voices
    { id: "priya",     label: "Priya",     desc: "Warm & expressive",     gender: "F" },
    { id: "ishita",    label: "Ishita",    desc: "Clear & professional",  gender: "F" },
    { id: "ritu",      label: "Ritu",      desc: "Calm narrator",         gender: "F" },
    { id: "neha",      label: "Neha",      desc: "Friendly & engaging",   gender: "F" },
    { id: "roopa",     label: "Roopa",     desc: "Soothing storyteller",  gender: "F" },
    { id: "suhani",    label: "Suhani",    desc: "Youthful & bright",     gender: "F" },
    { id: "shreya",    label: "Shreya",    desc: "Energetic & dynamic",   gender: "F" },
    { id: "pooja",     label: "Pooja",     desc: "Calm & clear",          gender: "F" },
    { id: "simran",    label: "Simran",    desc: "Cheerful & bright",     gender: "F" },
    { id: "kavya",     label: "Kavya",     desc: "Expressive narrator",   gender: "F" },
    { id: "tanya",     label: "Tanya",     desc: "Bold & confident",      gender: "F" },
    { id: "shruti",    label: "Shruti",    desc: "Melodic delivery",      gender: "F" },
    { id: "rupali",    label: "Rupali",    desc: "Graceful tone",         gender: "F" },
    { id: "sophia",    label: "Sophia",    desc: "Modern & polished",     gender: "F" },
    // Male voices
    { id: "shubh",     label: "Shubh",     desc: "Natural & balanced",    gender: "M" },
    { id: "ratan",     label: "Ratan",     desc: "Deep & authoritative",  gender: "M" },
    { id: "mani",      label: "Mani",      desc: "Bold presenter",        gender: "M" },
    { id: "kabir",     label: "Kabir",     desc: "Calm storyteller",      gender: "M" },
    { id: "ashutosh",  label: "Ashutosh",  desc: "Steady & reliable",     gender: "M" },
    { id: "rehan",     label: "Rehan",     desc: "Energetic delivery",    gender: "M" },
    { id: "varun",     label: "Varun",     desc: "Dramatic & intense",    gender: "M" },
    { id: "aditya",    label: "Aditya",    desc: "Professional tone",     gender: "M" },
    { id: "rahul",     label: "Rahul",     desc: "Energetic & lively",    gender: "M" },
    { id: "rohan",     label: "Rohan",     desc: "Casual & relaxed",      gender: "M" },
    { id: "amit",      label: "Amit",      desc: "Firm & direct",         gender: "M" },
    { id: "dev",       label: "Dev",       desc: "Deep & resonant",       gender: "M" },
    { id: "anand",     label: "Anand",     desc: "Pleasant narrator",     gender: "M" },
    { id: "sunny",     label: "Sunny",     desc: "Upbeat & cheerful",     gender: "M" },
    { id: "mohit",     label: "Mohit",     desc: "Smooth delivery",       gender: "M" },
]

const VOICES_HI = [
    { id: "priya",     label: "Priya",     desc: "हिन्दी · Expressive",  gender: "F" },
    { id: "suhani",    label: "Suhani",    desc: "हिन्दी · Warm",        gender: "F" },
    { id: "ritu",      label: "Ritu",      desc: "हिन्दी · Calm",        gender: "F" },
    { id: "pooja",     label: "Pooja",     desc: "हिन्दी · Clear",       gender: "F" },
    { id: "simran",    label: "Simran",    desc: "हिन्दी · Cheerful",    gender: "F" },
    { id: "kavya",     label: "Kavya",     desc: "हिन्दी · Expressive",  gender: "F" },
    { id: "tanya",     label: "Tanya",     desc: "हिन्दी · Bold",        gender: "F" },
    { id: "shruti",    label: "Shruti",    desc: "हिन्दी · Melodic",     gender: "F" },
    { id: "rupali",    label: "Rupali",    desc: "हिन्दी · Graceful",    gender: "F" },
    { id: "sophia",    label: "Sophia",    desc: "हिन्दी · Modern",      gender: "F" },
    { id: "ishita",    label: "Ishita",    desc: "हिन्दी · Lively",      gender: "F" },
    { id: "shreya",    label: "Shreya",    desc: "हिन्दी · Bright",      gender: "F" },
    { id: "neha",      label: "Neha",      desc: "हिन्दी · Soft",        gender: "F" },
    { id: "roopa",     label: "Roopa",     desc: "हिन्दी · Gentle",      gender: "F" },
    { id: "shubh",     label: "Shubh",     desc: "हिन्दी · Natural",     gender: "M" },
    { id: "ashutosh",  label: "Ashutosh",  desc: "हिन्दी · Steady",      gender: "M" },
    { id: "ratan",     label: "Ratan",     desc: "हिन्दी · Deep",        gender: "M" },
    { id: "mani",      label: "Mani",      desc: "हिन्दी · Bold",        gender: "M" },
    { id: "aditya",    label: "Aditya",    desc: "हिन्दी · Professional",gender: "M" },
    { id: "rahul",     label: "Rahul",     desc: "हिन्दी · Energetic",   gender: "M" },
    { id: "rohan",     label: "Rohan",     desc: "हिन्दी · Casual",      gender: "M" },
    { id: "kabir",     label: "Kabir",     desc: "हिन्दी · Confident",   gender: "M" },
    { id: "amit",      label: "Amit",      desc: "हिन्दी · Firm",        gender: "M" },
    { id: "dev",       label: "Dev",       desc: "हिन्दी · Deep",        gender: "M" },
    { id: "anand",     label: "Anand",     desc: "हिन्दी · Pleasant",    gender: "M" },
    { id: "varun",     label: "Varun",     desc: "हिन्दी · Dynamic",     gender: "M" },
    { id: "sunny",     label: "Sunny",     desc: "हिन्दी · Upbeat",      gender: "M" },
    { id: "mohit",     label: "Mohit",     desc: "हिन्दी · Smooth",      gender: "M" },
    { id: "rehan",     label: "Rehan",     desc: "हिन्दी · Energetic",   gender: "M" },
]

/* ── Gradient ──────────────────────────────────────────────────────────── */
const GRADIENT_STYLE = 'linear-gradient(135deg, #529EDC 0%, #646CD1 50%, #8552DD 100%)'

/* ── Word Highlight Component ──────────────────────────────────────────── */

function WordHighlightCaption({
    text, progress, isPlaying
}: { text: string; progress: number; isPlaying: boolean }) {
    const words = useMemo(() => text.split(/\s+/).filter(Boolean), [text])
    const activeIdx = Math.min(Math.floor(progress * words.length), words.length - 1)

    return (
        <div className="leading-[1.8]">
            {words.map((word, i) => {
                const isActive = isPlaying && i === activeIdx
                const isPast   = isPlaying && i < activeIdx

                return (
                    <span
                        key={i}
                        className="inline-block mr-1.5 text-[13.5px] transition-colors duration-100"
                        style={{
                            ...(isActive
                                ? {
                                    backgroundImage: GRADIENT_STYLE,
                                    WebkitBackgroundClip: 'text',
                                    WebkitTextFillColor: 'transparent',
                                    fontWeight: 700,
                                }
                                : isPast
                                    ? { color: 'var(--foreground)', fontWeight: 500, opacity: 0.85 }
                                    : { color: 'var(--foreground)', fontWeight: 400, opacity: 0.65 }
                            ),
                        }}
                    >
                        {word}
                    </span>
                )
            })}
        </div>
    )
}

/* ── Main Component ────────────────────────────────────────────────────── */

export default function StudioStageVoice({
    scriptData, voice, setVoice, language, sceneAudios, setSceneAudios,
}: Props) {
    const scenes = scriptData?.scenes || []

    const [scenePeaks, setScenePeaks]         = useState<(number[] | null)[]>([])
    const [generatingIdx, setGeneratingIdx]   = useState<number | null>(null)
    const [generatingAll, setGeneratingAll]   = useState(false)
    const [genProgress, setGenProgress]       = useState(0)
    const [expandedIdx, setExpandedIdx]       = useState<number | null>(null)

    const [pendingPace, setPendingPace]       = useState<Record<number, number>>({})
    const [pendingTemp, setPendingTemp]       = useState<Record<number, number>>({})

    const [playingIdx, setPlayingIdx]         = useState<number | null>(null)
    const [sceneProgress, setSceneProgress]   = useState<Record<number, number>>({})
    const sceneAudioRefs                      = useRef<(HTMLAudioElement | null)[]>([])
    const sceneRafRef                         = useRef<number>(0)

    const [combinedPlaying, setCombinedPlaying]   = useState(false)
    const [combinedProgress, setCombinedProgress] = useState(0)
    const combinedAudioRef                        = useRef<HTMLAudioElement | null>(null)
    const combinedBlobUrlRef                      = useRef<string>('')
    const combinedRafRef                          = useRef<number>(0)

    const visibleVoices = language.startsWith("hi") ? VOICES_HI : VOICES_EN
    const selectedVoice = visibleVoices.find(v => v.id === voice) || visibleVoices[0]

    const allGenerated  = sceneAudios.length === scenes.length && sceneAudios.every(Boolean)
    const anyGenerated  = sceneAudios.some(Boolean)

    /* ── Extract peaks ──────────────────────────────────────────────────── */
    useEffect(() => {
        const compute = async () => {
            const newPeaks: (number[] | null)[] = []
            for (const audio of sceneAudios) {
                if (audio?.base64) {
                    try { newPeaks.push(await extractPeaks(audio.base64, 150)) }
                    catch { newPeaks.push(null) }
                } else { newPeaks.push(null) }
            }
            setScenePeaks(newPeaks)
        }
        compute()
    }, [sceneAudios])

    /* ── Combined waveform data ─────────────────────────────────────────── */
    const combinedPeaks = useMemo(() => {
        const all: number[] = []
        for (const p of scenePeaks) {
            if (p) all.push(...p)
            else all.push(...Array(150).fill(0.05))
        }
        const max = Math.max(...all, 0.001)
        return all.map(v => v / max)
    }, [scenePeaks])

    const totalDuration = useMemo(
        () => sceneAudios.reduce((s, a) => s + (a?.duration || 0), 0),
        [sceneAudios]
    )

    const sceneMarkers = useMemo(() => {
        if (totalDuration === 0) return []
        const markers: number[] = []
        let cum = 0
        for (let i = 0; i < sceneAudios.length - 1; i++) {
            cum += sceneAudios[i]?.duration || 0
            markers.push(cum / totalDuration)
        }
        return markers
    }, [sceneAudios, totalDuration])

    /* ── Combined audio blob ────────────────────────────────────────────── */
    useEffect(() => {
        if (combinedBlobUrlRef.current) URL.revokeObjectURL(combinedBlobUrlRef.current)
        if (!allGenerated) { combinedBlobUrlRef.current = ''; return }
        const bases = sceneAudios.filter(Boolean).map(a => a!.base64)
        const blob = mergeWavBase64ToBlob(bases)
        combinedBlobUrlRef.current = URL.createObjectURL(blob)
        return () => { if (combinedBlobUrlRef.current) URL.revokeObjectURL(combinedBlobUrlRef.current) }
    }, [sceneAudios, allGenerated])

    /* ── Generate single scene ──────────────────────────────────────────── */
    const generateScene = useCallback(async (idx: number) => {
        const scene = scenes[idx]
        if (!scene) return
        const pace = pendingPace[idx] ?? sceneAudios[idx]?.pace ?? 1.05
        const temp = pendingTemp[idx] ?? sceneAudios[idx]?.temperature ?? 0.7

        setGeneratingIdx(idx)
        try {
            const res = await fetch('/api/tts-preview', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: scene.narration, speaker: voice, language, pace, temperature: temp }),
            })
            const data = await res.json()
            if (!res.ok || !data.audio) throw new Error(data.error || 'TTS failed')

            const duration = getWavDuration(data.audio)
            const updated = [...sceneAudios]
            updated[idx] = { base64: data.audio, duration, pace, temperature: temp }
            setSceneAudios(updated)
        } catch (err: any) {
            toast.error(`Scene ${idx + 1}: ${err.message || 'Voice generation failed'}`)
        } finally { setGeneratingIdx(null) }
    }, [scenes, voice, language, sceneAudios, setSceneAudios, pendingPace, pendingTemp])

    /* ── Generate all scenes ────────────────────────────────────────────── */
    const generateAll = useCallback(async () => {
        setGeneratingAll(true)
        setGenProgress(0)
        
        // If everything is already generated, user clicked "Regenerate All", so we force regenerate everything.
        // Otherwise, we only generate the missing ones.
        const shouldForceRegen = sceneAudios.length === scenes.length && sceneAudios.every(Boolean)
        const updated: (SceneAudioData | null)[] = [...sceneAudios]

        for (let i = 0; i < scenes.length; i++) {
            // Skip if already generated and we aren't forcing a full regenerate
            if (updated[i] && !shouldForceRegen) {
                // Still push state so the waveform for this already-generated scene
                // appears immediately while other scenes are still being generated
                setSceneAudios([...updated])
                continue
            }

            const pace = pendingPace[i] ?? 1.05
            const temp = pendingTemp[i] ?? 0.7
            setGeneratingIdx(i)
            setGenProgress(i)

            try {
                const res = await fetch('/api/tts-preview', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text: scenes[i].narration, speaker: voice, language, pace, temperature: temp }),
                })
                const data = await res.json()
                if (!res.ok || !data.audio) throw new Error(data.error || 'TTS failed')
                updated[i] = { base64: data.audio, duration: getWavDuration(data.audio), pace, temperature: temp }
            } catch (err: any) { toast.error(`Scene ${i + 1}: ${err.message || 'Failed'}`) }

            // Update state after each scene so waveforms appear progressively
            setSceneAudios([...updated])

            if (i < scenes.length - 1) await new Promise(r => setTimeout(r, 800))
        }

        setSceneAudios([...updated])
        setGeneratingIdx(null)
        setGeneratingAll(false)
        setGenProgress(0)
        toast.success(shouldForceRegen ? 'All scenes regenerated!' : 'Missing scenes generated!')
    }, [scenes, voice, language, pendingPace, pendingTemp, sceneAudios, setSceneAudios])

    /* ── Per-scene playback ──────────────────────────────────────────────── */
    const playScene = useCallback((idx: number) => {
        if (playingIdx !== null && playingIdx !== idx) sceneAudioRefs.current[playingIdx]?.pause()
        stopCombined()
        const audio = sceneAudios[idx]
        if (!audio) return

        if (!sceneAudioRefs.current[idx])
            sceneAudioRefs.current[idx] = new Audio(`data:audio/wav;base64,${audio.base64}`)

        const el = sceneAudioRefs.current[idx]!
        if (playingIdx === idx) {
            el.pause()
            cancelAnimationFrame(sceneRafRef.current)
            setPlayingIdx(null)
            return
        }

        el.currentTime = (sceneProgress[idx] || 0) * (el.duration || 0)
        el.play()
        setPlayingIdx(idx)

        const tick = () => {
            if (el.duration > 0) setSceneProgress(prev => ({ ...prev, [idx]: el.currentTime / el.duration }))
            sceneRafRef.current = requestAnimationFrame(tick)
        }
        sceneRafRef.current = requestAnimationFrame(tick)

        el.onended = () => {
            cancelAnimationFrame(sceneRafRef.current)
            setPlayingIdx(null)
            setSceneProgress(prev => ({ ...prev, [idx]: 0 }))
        }
    }, [playingIdx, sceneAudios, sceneProgress])

    const seekScene = useCallback((idx: number, prog: number) => {
        setSceneProgress(prev => ({ ...prev, [idx]: prog }))
        const el = sceneAudioRefs.current[idx]
        if (el && el.duration) el.currentTime = prog * el.duration
    }, [])

    /* ── Combined playback ───────────────────────────────────────────────── */
    const stopCombined = useCallback(() => {
        combinedAudioRef.current?.pause()
        cancelAnimationFrame(combinedRafRef.current)
        setCombinedPlaying(false)
    }, [])

    const toggleCombined = useCallback(() => {
        if (!allGenerated || !combinedBlobUrlRef.current) return
        if (playingIdx !== null) {
            sceneAudioRefs.current[playingIdx]?.pause()
            cancelAnimationFrame(sceneRafRef.current)
            setPlayingIdx(null)
        }
        if (combinedPlaying) { stopCombined(); return }

        if (!combinedAudioRef.current) combinedAudioRef.current = new Audio(combinedBlobUrlRef.current)
        else combinedAudioRef.current.src = combinedBlobUrlRef.current

        const el = combinedAudioRef.current
        el.currentTime = combinedProgress * (el.duration || totalDuration)
        el.play()
        setCombinedPlaying(true)

        const tick = () => {
            if (el.duration > 0) setCombinedProgress(el.currentTime / el.duration)
            combinedRafRef.current = requestAnimationFrame(tick)
        }
        combinedRafRef.current = requestAnimationFrame(tick)
        el.onended = () => { cancelAnimationFrame(combinedRafRef.current); setCombinedPlaying(false); setCombinedProgress(0) }
    }, [allGenerated, combinedPlaying, combinedProgress, totalDuration, playingIdx, stopCombined])

    const seekCombined = useCallback((prog: number) => {
        setCombinedProgress(prog)
        if (combinedAudioRef.current?.duration) combinedAudioRef.current.currentTime = prog * combinedAudioRef.current.duration
    }, [])

    // Cleanup
    useEffect(() => () => {
        cancelAnimationFrame(sceneRafRef.current)
        cancelAnimationFrame(combinedRafRef.current)
        sceneAudioRefs.current.forEach(a => a?.pause())
        combinedAudioRef.current?.pause()
    }, [])

    useEffect(() => {
        sceneAudioRefs.current = sceneAudioRefs.current.slice(0, scenes.length)
        for (let i = 0; i < scenes.length; i++) {
            if (sceneAudios[i]) sceneAudioRefs.current[i] = null
        }
    }, [sceneAudios, scenes.length])

    if (!scriptData) return null

    /* ── Render ─────────────────────────────────────────────────────────── */
    return (
        <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
            className="space-y-6"
        >
            {/* ── Header row ─────────────────────────────────────────────── */}
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h2 className="text-xl font-bold text-foreground mb-1 flex items-center gap-2">
                        <span className="w-7 h-7 rounded-lg flex items-center justify-center text-white shadow-md" style={{ background: GRADIENT_STYLE }}>
                            <AudioWaveform className="w-4 h-4" />
                        </span>
                        Voice & Narration
                    </h2>
                    <p className="text-sm text-muted-foreground">
                        Generate AI voiceover, preview each scene, and fine-tune delivery
                    </p>
                </div>

                {/* Generate All — right side */}
                <motion.button
                    onClick={generateAll}
                    disabled={generatingAll || scenes.length === 0}
                    whileHover={generatingAll ? {} : { scale: 1.02 }}
                    whileTap={generatingAll ? {} : { scale: 0.98 }}
                    className="shrink-0 flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-sm text-white transition-all cursor-pointer shadow-lg disabled:opacity-60"
                    style={{ background: GRADIENT_STYLE, boxShadow: '0 8px 24px rgba(100, 108, 209, 0.3)' }}
                >
                    {generatingAll ? (
                        <><Loader2 className="w-4 h-4 animate-spin" /> Scene {genProgress + 1}/{scenes.length}</>
                    ) : anyGenerated && !allGenerated ? (
                        <><Sparkles className="w-4 h-4" /> Generate Missing</>
                    ) : allGenerated ? (
                        <><RefreshCw className="w-4 h-4" /> Regenerate All</>
                    ) : (
                        <><Sparkles className="w-4 h-4" /> Generate All</>
                    )}
                </motion.button>
            </div>

            {/* ── Progress bar ────────────────────────────────────────────── */}
            <AnimatePresence>
                {generatingAll && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                        <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
                            <motion.div
                                className="h-full rounded-full"
                                style={{ background: GRADIENT_STYLE }}
                                animate={{ width: `${((genProgress + 1) / scenes.length) * 100}%` }}
                                transition={{ type: 'spring', stiffness: 100, damping: 20 }}
                            />
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* ── Voice selector — ShadCN Select ─────────────────────────── */}
            <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 shrink-0">
                    <Mic2 className="w-4 h-4" style={{ color: '#646CD1' }} />
                    <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Voice</span>
                </div>
                <Select value={voice} onValueChange={setVoice}>
                    <SelectTrigger className="w-[260px] bg-white border-border/60 rounded-xl h-10 cursor-pointer">
                        <SelectValue>
                            <span className="flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full" style={{ background: GRADIENT_STYLE }} />
                                <span className="font-semibold text-foreground">{selectedVoice.label}</span>
                                <span className="text-muted-foreground text-xs">— {selectedVoice.desc}</span>
                            </span>
                        </SelectValue>
                    </SelectTrigger>
                    <SelectContent className="rounded-xl">
                        <SelectGroup>
                            <SelectLabel>♀ Female Voices</SelectLabel>
                            {visibleVoices.filter(v => v.gender === 'F').map(v => (
                                <SelectItem key={v.id} value={v.id} className="cursor-pointer">
                                    <span className="flex items-center gap-2">
                                        <span className="font-semibold">{v.label}</span>
                                        <span className="text-muted-foreground text-xs">— {v.desc}</span>
                                    </span>
                                </SelectItem>
                            ))}
                        </SelectGroup>
                        <SelectGroup>
                            <SelectLabel>♂ Male Voices</SelectLabel>
                            {visibleVoices.filter(v => v.gender === 'M').map(v => (
                                <SelectItem key={v.id} value={v.id} className="cursor-pointer">
                                    <span className="flex items-center gap-2">
                                        <span className="font-semibold">{v.label}</span>
                                        <span className="text-muted-foreground text-xs">— {v.desc}</span>
                                    </span>
                                </SelectItem>
                            ))}
                        </SelectGroup>
                    </SelectContent>
                </Select>
            </div>

            {/* ── Scene cards ─────────────────────────────────────────────── */}
            <div className="space-y-3">
                <div className="flex items-center gap-2">
                    <Volume2 className="w-4 h-4" style={{ color: '#8552DD' }} />
                    <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                        Scene Audio — {scenes.length} Scenes
                    </span>
                </div>

                {scenes.map((scene, i) => {
                    const audio      = sceneAudios[i]
                    const peaks      = scenePeaks[i]
                    const isGen      = generatingIdx === i
                    const isPlaying  = playingIdx === i
                    const isExpanded = expandedIdx === i
                    const curPace    = pendingPace[i] ?? audio?.pace ?? 1.05
                    const curTemp    = pendingTemp[i] ?? audio?.temperature ?? 0.7
                    const progress   = sceneProgress[i] ?? 0
                    
                    const isTuningChanged = !!audio && (audio.pace !== curPace || audio.temperature !== curTemp)

                    return (
                        <motion.div
                            key={i}
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: i * 0.04 }}
                            className={`rounded-xl border p-5 transition-all ${
                                isGen ? 'border-[#646CD1]/40 bg-[#646CD1]/5' : 'border-border/40 bg-white/90'
                            }`}
                        >
                            {/* ── Two-column layout ── */}
                            <div className="flex gap-5">
                                {/* LEFT: Content */}
                                <div className="flex-1 min-w-0">
                                    {/* Scene badge */}
                                    <div className="flex items-center gap-2 mb-3">
                                        <span
                                            className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-[11px] font-bold text-white shadow-sm"
                                            style={{ background: GRADIENT_STYLE }}
                                        >
                                            {i + 1}
                                        </span>
                                        <span className="text-sm font-semibold text-foreground">Scene {i + 1}</span>
                                        {audio && (
                                            <span className="text-[11px] font-mono text-muted-foreground ml-auto">
                                                {Math.floor(audio.duration / 60)}:{String(Math.floor(audio.duration % 60)).padStart(2, '0')}
                                            </span>
                                        )}
                                    </div>

                                    {/* Narration with word-by-word highlighting — stable layout */}
                                    <div className="min-h-[60px]">
                                        <WordHighlightCaption
                                            text={scene.narration}
                                            progress={progress}
                                            isPlaying={isPlaying}
                                        />
                                    </div>
                                </div>

                                {/* RIGHT: Waveform + controls — vertically centered */}
                                <div className="w-[280px] shrink-0 flex flex-col justify-center gap-2.5">
                                    {/* Play button + waveform */}
                                    <div className="flex items-center gap-2.5">
                                        <button
                                            onClick={() => {
                                                if (isTuningChanged) generateScene(i)
                                                else playScene(i)
                                            }}
                                            disabled={(!audio && !isTuningChanged) || isGen}
                                            className="shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-all cursor-pointer shadow-sm relative overflow-hidden"
                                            style={
                                                audio || isTuningChanged
                                                    ? isPlaying
                                                        ? { background: GRADIENT_STYLE, color: 'white', boxShadow: '0 4px 16px rgba(100,108,209,0.35)' }
                                                        : { background: 'rgba(100,108,209,0.1)', color: '#646CD1' }
                                                    : { background: 'rgba(0,0,0,0.04)', color: 'rgba(0,0,0,0.2)' }
                                            }
                                        >
                                            {isGen ? (
                                                <Loader2 className="w-4 h-4 animate-spin" />
                                            ) : isPlaying ? (
                                                <Pause className="w-3.5 h-3.5" fill="currentColor" />
                                            ) : isTuningChanged ? (
                                                <RefreshCw className="w-4 h-4" /> // Show regenerate icon if tuned
                                            ) : (
                                                <Play className="w-3.5 h-3.5 ml-0.5" fill="currentColor" />
                                            )}
                                            {isTuningChanged && !isGen && (
                                                <motion.div 
                                                    initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                                                    className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-[#8552DD] rounded-full border-2 border-white"
                                                />
                                            )}
                                        </button>

                                        <div className="flex-1">
                                            {peaks && peaks.length > 0 ? (
                                                <div className="relative">
                                                    <WaveformCanvas
                                                        peaks={peaks}
                                                        progress={progress}
                                                        onSeek={(p) => seekScene(i, p)}
                                                        height={40}
                                                        progressColor="#646CD1"
                                                        barColor="rgba(100, 108, 209, 0.2)"
                                                        cursorColor="#8552DD"
                                                    />
                                                    {isTuningChanged && (
                                                        <div className="absolute inset-0 bg-white/40 flex items-center justify-center backdrop-blur-[1px] rounded-md transition-all">
                                                            <span className="text-[10px] font-bold text-[#646CD1] bg-white/90 px-2 py-0.5 rounded shadow-sm border border-[#646CD1]/20">
                                                                Settings modified — Regenerate to apply
                                                            </span>
                                                        </div>
                                                    )}
                                                </div>
                                            ) : isGen ? (
                                                <div className="h-10 flex items-center justify-center">
                                                    <div className="flex items-center gap-2 text-xs" style={{ color: '#646CD1' }}>
                                                        <Loader2 className="w-3 h-3 animate-spin" /> Generating…
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="h-10 rounded-lg bg-muted/30 flex items-center justify-center">
                                                    <span className="text-[10px] text-muted-foreground/50">No audio yet</span>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Tune + Re-generate */}
                                    <div className="flex items-center justify-between">
                                        <button
                                            onClick={() => setExpandedIdx(isExpanded ? null : i)}
                                            className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer relative"
                                        >
                                            <Settings2 className="w-3 h-3" /> Tune
                                            {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                                            {isTuningChanged && <span className="absolute -right-3 top-0 w-1.5 h-1.5 bg-[#8552DD] rounded-full" />}
                                        </button>
                                        <button
                                            onClick={() => generateScene(i)}
                                            disabled={isGen || generatingAll}
                                            className="flex items-center gap-1.5 text-[11px] font-semibold disabled:opacity-30 transition-colors cursor-pointer"
                                            style={{ color: '#8552DD' }}
                                        >
                                            <RefreshCw className={`w-3 h-3 ${isGen ? 'animate-spin' : ''}`} />
                                            {audio ? (isTuningChanged ? 'Apply Changes' : 'Re-generate') : 'Generate'}
                                        </button>
                                    </div>

                                    {/* Tuning panel — expands in right column */}
                                    <AnimatePresence>
                                        {isExpanded && (
                                            <motion.div
                                                initial={{ opacity: 0, height: 0 }}
                                                animate={{ opacity: 1, height: 'auto' }}
                                                exit={{ opacity: 0, height: 0 }}
                                                transition={{ duration: 0.2 }}
                                                className="overflow-hidden"
                                            >
                                                <div className="pt-2 border-t border-border/30 space-y-3">
                                                    {/* Pace */}
                                                    <div className="space-y-1">
                                                        <div className="flex items-center justify-between">
                                                            <label className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
                                                                <Gauge className="w-3 h-3" /> Speed
                                                            </label>
                                                            <span className="text-[11px] font-mono font-bold" style={{ color: '#646CD1' }}>{curPace.toFixed(2)}×</span>
                                                        </div>
                                                        <input
                                                            type="range" min={0.5} max={2.0} step={0.05} value={curPace}
                                                            onChange={(e) => setPendingPace(prev => ({ ...prev, [i]: parseFloat(e.target.value) }))}
                                                            className="w-full h-1.5 rounded-full appearance-none bg-gray-200 cursor-pointer"
                                                            style={{ accentColor: '#646CD1' }}
                                                        />
                                                        <div className="flex justify-between text-[9px] text-muted-foreground/50">
                                                            <span>Slow</span><span>Normal</span><span>Fast</span>
                                                        </div>
                                                    </div>
                                                    {/* Temperature */}
                                                    <div className="space-y-1">
                                                        <div className="flex items-center justify-between">
                                                            <label className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
                                                                <Sparkles className="w-3 h-3" /> Expressiveness
                                                            </label>
                                                            <span className="text-[11px] font-mono font-bold" style={{ color: '#8552DD' }}>{curTemp.toFixed(2)}</span>
                                                        </div>
                                                        <input
                                                            type="range" min={0.1} max={1.0} step={0.05} value={curTemp}
                                                            onChange={(e) => setPendingTemp(prev => ({ ...prev, [i]: parseFloat(e.target.value) }))}
                                                            className="w-full h-1.5 rounded-full appearance-none bg-gray-200 cursor-pointer"
                                                            style={{ accentColor: '#8552DD' }}
                                                        />
                                                        <div className="flex justify-between text-[9px] text-muted-foreground/50">
                                                            <span>Steady</span><span>Balanced</span><span>Expressive</span>
                                                        </div>
                                                    </div>
                                                </div>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </div>
                            </div>
                        </motion.div>
                    )
                })}
            </div>

            {/* ── Combined waveform bar ───────────────────────────────────── */}
            {anyGenerated && (
                <motion.div
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="rounded-2xl border p-4 space-y-2 shadow-sm"
                    style={{ borderColor: 'rgba(100,108,209,0.25)', background: 'linear-gradient(135deg, rgba(82,158,220,0.06), rgba(133,82,221,0.08))' }}
                >
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <AudioWaveform className="w-4 h-4" style={{ color: '#646CD1' }} />
                            <span className="text-xs font-bold" style={{ color: '#646CD1' }}>Full Video Audio</span>
                        </div>
                        <span className="text-[11px] font-mono text-muted-foreground">
                            {totalDuration > 0
                                ? `${Math.floor(totalDuration / 60)}:${String(Math.floor(totalDuration % 60)).padStart(2, '0')}`
                                : '--:--'}
                        </span>
                    </div>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={toggleCombined}
                            disabled={!allGenerated}
                            className="shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-all cursor-pointer"
                            style={
                                allGenerated
                                    ? combinedPlaying
                                        ? { background: GRADIENT_STYLE, color: 'white', boxShadow: '0 4px 16px rgba(100,108,209,0.35)' }
                                        : { background: 'rgba(100,108,209,0.12)', color: '#646CD1' }
                                    : { background: 'rgba(0,0,0,0.04)', color: 'rgba(0,0,0,0.2)' }
                            }
                        >
                            {combinedPlaying ? <Pause className="w-4 h-4" fill="currentColor" /> : <Play className="w-4 h-4 ml-0.5" fill="currentColor" />}
                        </button>
                        <WaveformCanvas
                            peaks={combinedPeaks}
                            progress={combinedProgress}
                            onSeek={allGenerated ? seekCombined : undefined}
                            height={52}
                            barColor="rgba(100, 108, 209, 0.15)"
                            progressColor="#646CD1"
                            cursorColor="#8552DD"
                            sceneMarkers={sceneMarkers}
                            className="flex-1"
                        />
                    </div>
                    {!allGenerated && (
                        <p className="text-[10px] text-center" style={{ color: 'rgba(100,108,209,0.5)' }}>
                            Generate all scenes to enable combined playback
                        </p>
                    )}
                </motion.div>
            )}
        </motion.div>
    )
}
