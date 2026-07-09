"use client"
import { useUser } from '@clerk/nextjs'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, ArrowRight, Loader2 } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { WebSource } from '@/lib/web-search'
import { SceneAssets, makeDefaultSceneAssets } from '../_components/SceneAssetBox'
import StudioStageAssets from '../_components/StudioStageAssets'
import StudioStageConfirm from '../_components/StudioStageConfirm'
import StudioStageScript from '../_components/StudioStageScript'
import StudioStageSource from '../_components/StudioStageSource'
import StudioStageStyle from '../_components/StudioStageStyle'
import StudioStageVoice, { SceneAudioData } from '../_components/StudioStageVoice'
import StudioStepper from '../_components/StudioStepper'
import DrawOutlineButton from '@/components/ui/DrawOutlineButton'



interface Series {
    seriesId: string
    title: string
    niche: string
    language: string
    voice: string
    music: string
    captionStyle: string
}

async function getOrCreateStudioSeries(userId: string): Promise<string> {
    const res = await fetch(`/api/short-series?userId=${encodeURIComponent(userId)}`)
    const data = await res.json()
    if (data.success && data.series?.length > 0) return data.series[0].seriesId
    const createRes = await fetch('/api/create-short-series', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            niche: 'general', language: 'en-IN', voice: 'priya',
            music: 'cinematic', videoStyle: 'cinematic', captionStyle: 'hormozi',
            title: 'Studio Originals', duration: '60-90', platform: 'youtube',
            publishTime: new Date(Date.now() + 86400000).toISOString(),
        }),
    })
    const createData = await createRes.json()
    if (!createData.seriesId) throw new Error('Failed to create Studio Originals series')
    return createData.seriesId
}

function StudioCreateWizard() {
    const { user } = useUser()
    const router = useRouter()
    const params = useSearchParams()

    const userId = user?.primaryEmailAddress?.emailAddress ?? ''
    const preSeriesId = params.get('seriesId') ?? ''

    const [seriesId, setSeriesId] = useState(preSeriesId)
    const [seriesDefaults, setSeriesDefaults] = useState<Series | null>(null)
    const [allSeries, setAllSeries] = useState<Series[]>([])
    const [stage, setStage] = useState(0)

    const [topic, setTopic] = useState('')
    const [instruction, setInstruction] = useState('')
    const [contextMarkdown, setContextMarkdown] = useState('')
    const [docImages, setDocImages] = useState<string[]>([])

    const [scriptData, setScriptData] = useState<any>(null)
    const [isGenerating, setIsGenerating] = useState(false)
    const [webSources, setWebSources] = useState<WebSource[]>([])

    const makeDefaultAssets = (count = 6): SceneAssets[] =>
        Array(count).fill(null).map(() => makeDefaultSceneAssets())

    const [sceneAssets, setSceneAssets] = useState<SceneAssets[]>(makeDefaultAssets())

    // Legacy derived arrays for StudioStageConfirm (keeps confirm stage working)
    const sceneAssetTypes = sceneAssets.map(a => a.type)
    const sceneCustomUrls = sceneAssets.map(a => {
        if (a.type === "user_upload") return a.files[0]?.url ?? null
        if (a.type === "doc_image") return a.docImageUrl
        return null
    })

    const [voice, setVoice] = useState('priya')
    const [captionStyle, setCaptionStyle] = useState('hormozi')
    const [music, setMusic] = useState('cinematic')
    const [language, setLanguage] = useState('en-IN')
    const [isLaunching, setIsLaunching] = useState(false)

    // Voice stage audio data
    const [sceneAudios, setSceneAudios] = useState<(SceneAudioData | null)[]>([])

    useEffect(() => {
        if (!userId) return
        const fetchDefaults = async () => {
            try {
                const res = await fetch(`/api/short-series?userId=${encodeURIComponent(userId)}`)
                const data = await res.json()
                if (data.success && data.series?.length > 0) {
                    setAllSeries(data.series)
                    const s: Series = data.series.find((x: Series) => x.seriesId === seriesId) || data.series[0]
                    setSeriesDefaults(s)
                    if (!seriesId) setSeriesId(s.seriesId)
                    setVoice(s.voice || 'priya')
                    setMusic(s.music || 'cinematic')
                    setCaptionStyle(s.captionStyle || 'hormozi')
                    setLanguage(s.language || 'en-IN')
                }
            } catch { /* use defaults */ }
        }
        fetchDefaults()
    }, [userId, seriesId])

    const generateScript = useCallback(async () => {
        setIsGenerating(true)
        try {
            const res = await fetch('/api/studio/generate-script', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    topic: topic || undefined, instruction,
                    contextMarkdown: contextMarkdown || undefined,
                    docImages: docImages.length > 0 ? docImages : undefined,
                    language, seriesNiche: seriesDefaults?.niche || 'general',
                }),
            })
            const data = await res.json()
            if (!res.ok || !data.scriptData) throw new Error(data.error || 'Script generation failed')
            setScriptData(data.scriptData)
            setWebSources(data.webSources || [])
            const count = data.scriptData.scenes?.length || 6
            setSceneAssets(makeDefaultAssets(count))
            setSceneAudios(Array(count).fill(null))
        } catch (err: any) {
            toast.error(err.message || 'Failed to generate script. Please try again.')
            return false
        } finally {
            setIsGenerating(false)
        }
        return true
    }, [topic, instruction, contextMarkdown, docImages, language, seriesDefaults])

    const handleNext = async () => {
        if (stage === 0) {
            setStage(1)
            generateScript()
            return
        }
        if (stage === 1 && !scriptData && !isGenerating) {
            toast.error('Please wait for the script to generate')
            return
        }
        setStage(s => Math.min(s + 1, 5))
    }

    const handleBack = () => setStage(s => Math.max(s - 1, 0))

    const handleAssetChange = (i: number, updated: SceneAssets | ((prev: SceneAssets) => SceneAssets)) => {
        setSceneAssets(prev => {
            const arr = [...prev]
            arr[i] = typeof updated === "function" ? updated(arr[i]) : updated
            return arr
        })
    }

    const handleLaunch = async () => {
        if (isLaunching || !scriptData) return
        setIsLaunching(true)
        try {
            let targetSeriesId = seriesId
            if (!targetSeriesId) {
                targetSeriesId = await getOrCreateStudioSeries(userId)
                setSeriesId(targetSeriesId)
            }
            const sceneVoiceConfigs = sceneAudios.map(a => ({
                pace: a?.pace ?? 1.05,
                temperature: a?.temperature ?? 0.7
            }))

            const res = await fetch('/api/short-series/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    seriesId: targetSeriesId,
                    studioPayload: { 
                        scriptData, sceneAssets, captionStyle, voice, music, language, 
                        contextMarkdown: contextMarkdown || undefined,
                        sceneVoiceConfigs 
                    },
                }),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || 'Launch failed')
            toast.success('🚀 Production launched! Redirecting...')
            router.push(`/short-generator/${targetSeriesId}`)
        } catch (err: any) {
            toast.error(err.message || 'Failed to launch production')
            setIsLaunching(false)
        }
    }

    const canNext = !(stage === 1 && (isGenerating || !scriptData))

    return (
        <div className="relative min-h-screen overflow-hidden">
            {/* Gradient orbs */}
            <div className="absolute -bottom-40 -left-40 h-[500px] w-[500px] bg-purple-400/20 blur-[120px] rounded-full pointer-events-none" />
            <div className="absolute top-20 left-1/3 bottom-[-200px] h-[500px] w-[500px] bg-pink-400/20 blur-[120px] rounded-full pointer-events-none" />
            <div className="absolute bottom-[-200px] left-1/3 h-[500px] w-[500px] bg-blue-400/20 blur-[120px] rounded-full pointer-events-none" />
            <div className="absolute top-[200px] left-1/2 h-[500px] w-[500px] bg-sky-400/20 blur-[120px] rounded-full pointer-events-none" />

            <div className="relative z-10 max-w-6xl mx-auto px-4 pt-0 pb-8 text-lg">
                {/* Back link */}
                <button
                    onClick={() => router.push('/studio')}
                    className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-3 cursor-pointer"
                >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    Back to Studio
                </button>

                {/* Stepper */}
                <StudioStepper current={stage} onGoTo={(i) => { if (i < stage) setStage(i) }} />

                {/* Stage card */}
                <div className="bg-white/70 backdrop-blur-sm border border-border/40 rounded-2xl shadow-sm p-6 md:p-8 mb-6 min-h-[480px]">
                    <AnimatePresence mode="wait">
                        {stage === 0 && (
                            <motion.div key="s0" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.28 }}>
                                <StudioStageSource
                                    seriesList={allSeries}
                                    seriesId={seriesId}
                                    setSeriesId={setSeriesId}
                                    niche={seriesDefaults?.niche || 'general'}
                                    language={language}
                                    topic={topic} setTopic={setTopic}
                                    instruction={instruction} setInstruction={setInstruction}
                                    contextMarkdown={contextMarkdown} setContextMarkdown={setContextMarkdown}
                                    docImages={docImages} setDocImages={setDocImages}
                                />
                            </motion.div>
                        )}
                        {stage === 1 && (
                            <motion.div key="s1" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.28 }}>
                                <StudioStageScript
                                    scriptData={scriptData} setScriptData={setScriptData}
                                    topic={topic} language={language}
                                    seriesNiche={seriesDefaults?.niche || 'general'}
                                    contextMarkdown={contextMarkdown} docImages={docImages}
                                    instruction={instruction} isGenerating={isGenerating}
                                    webSources={webSources}
                                />
                            </motion.div>
                        )}
                        {stage === 2 && (
                            <motion.div key="s2" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.28 }}>
                                <StudioStageAssets
                                    scenes={scriptData?.scenes || []}
                                    seriesId={seriesId} docImages={docImages}
                                    sceneAssets={sceneAssets}
                                    onAssetChange={handleAssetChange}
                                />
                            </motion.div>
                        )}
                        {stage === 3 && (
                            <motion.div key="s3" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.28 }}>
                                <StudioStageVoice
                                    scriptData={scriptData}
                                    voice={voice}
                                    setVoice={setVoice}
                                    language={language}
                                    sceneAudios={sceneAudios}
                                    setSceneAudios={setSceneAudios}
                                />
                            </motion.div>
                        )}
                        {stage === 4 && (
                            <motion.div key="s4" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.28 }}>
                                <StudioStageStyle
                                    captionStyle={captionStyle} setCaptionStyle={setCaptionStyle}
                                    music={music} setMusic={setMusic}
                                />
                            </motion.div>
                        )}
                        {stage === 5 && (
                            <motion.div key="s5" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.28 }}>
                                <StudioStageConfirm
                                    topic={topic} scriptData={scriptData}
                                    sceneAssetTypes={sceneAssetTypes} voice={voice}
                                    captionStyle={captionStyle} music={music}
                                    language={language} contextMarkdown={contextMarkdown}
                                    isLaunching={isLaunching} onLaunch={handleLaunch}
                                    webSourceCount={webSources.length}
                                />
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>

                {/* Bottom nav */}
                {stage < 5 && (
                    <div className="flex items-center justify-between gap-4">
                        <button
                            onClick={handleBack}
                            disabled={stage === 0}
                            className="flex items-center gap-2 px-5 py-2.5 rounded-xl border border-border/50 text-muted-foreground hover:text-foreground hover:bg-muted/40 text-sm font-medium transition-all disabled:opacity-0 disabled:pointer-events-none cursor-pointer"
                        >
                            <ArrowLeft className="w-4 h-4" />
                            Back
                        </button>

                        <DrawOutlineButton
                            onClick={handleNext}
                            disabled={!canNext}
                            fullWidth={false}
                            className={`text-sm font-semibold ${canNext ? 'border border-primary/30' : ''}`}
                        >
                            {isGenerating ? (
                                <><Loader2 className="w-4 h-4 animate-spin" /> Generating Script…</>
                            ) : stage === 4 ? 'Review & Launch' : 'Continue'}
                            {!isGenerating && <ArrowRight className="w-4 h-4" />}
                        </DrawOutlineButton>
                    </div>
                )}
            </div>
        </div>
    )
}

export default function StudioCreatePage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen bg-background/80 flex items-center justify-center">
                <div className="w-8 h-8 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
            </div>
        }>
            <StudioCreateWizard />
        </Suspense>
    )
}
