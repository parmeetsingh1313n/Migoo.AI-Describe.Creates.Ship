"use client"
import { motion } from 'framer-motion'
import { Film, SplitSquareHorizontal, Wand2 } from 'lucide-react'
import SceneAssetBox, { SceneAssets, makeDefaultSceneAssets } from './SceneAssetBox'

interface Scene {
    narration: string
    sceneCategory: string
}

interface Props {
    scenes: Scene[]
    seriesId: string
    docImages: string[]
    sceneAssets: SceneAssets[]
    onAssetChange: (i: number, updated: SceneAssets | ((prev: SceneAssets) => SceneAssets)) => void
}

export default function StudioStageAssets({ scenes, seriesId, docImages, sceneAssets, onAssetChange }: Props) {
    const customCount   = sceneAssets.filter(a => a.type !== "ai").length
    const imgToVidCount = sceneAssets.filter(a => a.files.some(f => f.isImgToVideo)).length
    const splitCount    = sceneAssets.filter(a => (a.splitPairs?.length || 0) > 0).length

    return (
        <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
            className="space-y-5"
        >
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h2 className="text-xl font-bold text-foreground mb-1">Scene Asset Manager</h2>
                    <p className="text-sm text-muted-foreground">
                        Upload up to 3 images + 2 videos per scene. Animate images with AI or enable split-screen for paired videos.
                    </p>
                </div>
                {customCount > 0 && (
                    <motion.div
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-bold"
                    >
                        <Film className="w-3.5 h-3.5" />
                        {customCount} custom asset{customCount > 1 ? "s" : ""}
                    </motion.div>
                )}
            </div>

            {/* Feature badges */}
            {(imgToVidCount > 0 || splitCount > 0) && (
                <div className="flex flex-wrap gap-2">
                    {imgToVidCount > 0 && (
                        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-violet-50 border border-violet-200 text-violet-700 text-xs font-semibold">
                            <Wand2 className="w-3.5 h-3.5" />
                            {imgToVidCount} scene{imgToVidCount > 1 ? "s" : ""} with AI animation
                        </div>
                    )}
                    {splitCount > 0 && (
                        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-blue-50 border border-blue-200 text-blue-700 text-xs font-semibold">
                            <SplitSquareHorizontal className="w-3.5 h-3.5" />
                            {splitCount} split-screen scene{splitCount > 1 ? "s" : ""}
                        </div>
                    )}
                </div>
            )}

            {/* Info banner */}
            <div className="flex items-start gap-3 p-3.5 rounded-xl bg-white border border-border/60 shadow-sm">
                <Wand2 className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                <p className="text-xs text-muted-foreground leading-relaxed">
                    All scenes default to{" "}
                    <span className="text-primary font-semibold">Migoo Engine video generation</span>.{" "}
                    Upload your own footage to make the video uniquely yours — critical for avoiding YouTube AI content flags.
                </p>
            </div>

            {/* Scene list */}
            <div className="flex flex-col border border-border/40 rounded-2xl bg-white/40 overflow-hidden divide-y divide-border/40">
                {scenes.map((scene, i) => (
                    <SceneAssetBox
                        key={i}
                        sceneIndex={i}
                        seriesId={seriesId}
                        sceneNarration={scene.narration}
                        sceneCategory={scene.sceneCategory}
                        sceneAssets={sceneAssets[i] ?? makeDefaultSceneAssets()}
                        docImages={docImages}
                        onAssetsChange={onAssetChange}
                    />
                ))}
            </div>
        </motion.div>
    )
}
