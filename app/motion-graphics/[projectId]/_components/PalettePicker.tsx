"use client"

/**
 * PalettePicker — pick a preset theme palette, or build a fully custom one
 * from any number of freeform color swatches. Reused by both the Theme tab
 * (app/motion-graphics/[projectId]/page.tsx) and the pre-chat theme gate
 * (ThemeGateScreen.tsx).
 *
 * Emits a full MotionGraphicTheme (mode + palette/customColors + resolved)
 * via onChange every time the selection changes — the parent decides whether
 * to autosave (Theme tab, PATCH per click) or wait for an explicit confirm
 * button (the gate screen).
 */

import { useMemo, useState } from 'react'
import { Plus, X } from 'lucide-react'
import {
    PRESET_LIST,
    PRESET_PALETTES,
    deriveRolesFromSwatches,
    themeFromPreset,
    themeFromCustomSwatches,
    type MotionGraphicTheme,
} from '@/lib/theme-palette'

interface PalettePickerProps {
    value: MotionGraphicTheme | null | undefined
    onChange: (theme: MotionGraphicTheme) => void
    compact?: boolean
}

const DEFAULT_CUSTOM_SWATCHES = ['#0a0a0f', '#6366f1', '#818cf8']

export default function PalettePicker({ value, onChange, compact }: PalettePickerProps) {
    const [mode, setMode] = useState<'preset' | 'custom'>(value?.mode === 'custom' ? 'custom' : 'preset')
    const [swatches, setSwatches] = useState<string[]>(
        value?.mode === 'custom' && value.customColors?.length ? value.customColors : DEFAULT_CUSTOM_SWATCHES
    )
    const [pickerColor, setPickerColor] = useState('#a855f7')

    const resolved = useMemo(() => deriveRolesFromSwatches(swatches), [swatches])

    const selectPreset = (id: string) => {
        setMode('preset')
        onChange(themeFromPreset(id))
    }

    const applyCustom = (next: string[]) => {
        setSwatches(next)
        onChange(themeFromCustomSwatches(next))
    }

    const addSwatch = () => {
        if (swatches.length >= 12) return
        applyCustom([...swatches, pickerColor])
    }

    const removeSwatch = (i: number) => {
        if (swatches.length <= 1) return
        applyCustom(swatches.filter((_, idx) => idx !== i))
    }

    const updateSwatch = (i: number, hex: string) => {
        applyCustom(swatches.map((c, idx) => (idx === i ? hex : c)))
    }

    const swatchSize = compact ? 24 : 32

    return (
        <div>
            {/* Mode toggle */}
            <div className="flex gap-1 p-1 rounded-xl bg-muted/40 border border-border/50 mb-4 w-fit">
                {(['preset', 'custom'] as const).map((m) => (
                    <button
                        key={m}
                        onClick={() => {
                            setMode(m)
                            if (m === 'custom') applyCustom(swatches)
                        }}
                        className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer capitalize ${
                            mode === m ? 'bg-white text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground'
                        }`}
                    >
                        {m === 'preset' ? 'Presets' : 'Custom'}
                    </button>
                ))}
            </div>

            {mode === 'preset' ? (
                <div className={`grid ${compact ? 'grid-cols-2' : 'grid-cols-3'} gap-3`}>
                    {PRESET_LIST.map((p) => {
                        const isActive = value?.mode !== 'custom' && value?.palette === p.id
                        const pal = PRESET_PALETTES[p.id]
                        return (
                            <button
                                key={p.id}
                                onClick={() => selectPreset(p.id)}
                                className={`p-3 rounded-xl border transition-all cursor-pointer text-left ${
                                    isActive ? 'border-primary/40 bg-primary/5 shadow-sm' : 'border-border/50 bg-white/60 hover:bg-muted/30 hover:border-border'
                                }`}
                            >
                                <div className="flex gap-1.5 mb-2">
                                    {[pal.bg, pal.accent, pal.secondary].map((c, i) => (
                                        <div key={i} className="rounded-full border border-border/30 shadow-sm" style={{ background: c, width: swatchSize, height: swatchSize }} />
                                    ))}
                                </div>
                                <span className={`text-xs font-semibold ${isActive ? 'text-primary' : 'text-foreground'}`}>{p.name}</span>
                            </button>
                        )
                    })}
                </div>
            ) : (
                <div>
                    {/* Live gradient preview */}
                    <div className="w-full h-14 rounded-xl border border-border/50 mb-4 shadow-sm" style={{ background: resolved.gradient }} />

                    {/* Freeform swatch list */}
                    <div className="flex flex-wrap gap-2 mb-3">
                        {swatches.map((c, i) => (
                            <div key={i} className="relative group">
                                <input
                                    type="color"
                                    value={c}
                                    onChange={(e) => updateSwatch(i, e.target.value)}
                                    className="rounded-lg border border-border/50 cursor-pointer"
                                    style={{ width: swatchSize + 12, height: swatchSize + 12, padding: 0 }}
                                    title={c}
                                />
                                {swatches.length > 1 && (
                                    <button
                                        onClick={() => removeSwatch(i)}
                                        className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-destructive text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                                    >
                                        <X className="w-2.5 h-2.5" />
                                    </button>
                                )}
                            </div>
                        ))}
                        <div className="flex items-center gap-1.5">
                            <input
                                type="color"
                                value={pickerColor}
                                onChange={(e) => setPickerColor(e.target.value)}
                                className="rounded-lg border border-border/50 cursor-pointer"
                                style={{ width: swatchSize, height: swatchSize, padding: 0 }}
                            />
                            <button
                                onClick={addSwatch}
                                disabled={swatches.length >= 12}
                                className="flex items-center justify-center rounded-lg border border-dashed border-border text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors cursor-pointer disabled:opacity-40"
                                style={{ width: swatchSize + 12, height: swatchSize + 12 }}
                                title="Add color"
                            >
                                <Plus className="w-4 h-4" />
                            </button>
                        </div>
                    </div>

                    {/* Derived role legend */}
                    <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                        {([
                            ['Background', resolved.bg],
                            ['Text', resolved.text],
                            ['Accent', resolved.accent],
                            ['Secondary', resolved.secondary],
                        ] as const).map(([label, hex]) => (
                            <div key={label} className="flex items-center gap-1.5">
                                <div className="w-3 h-3 rounded-full border border-border/40" style={{ background: hex }} />
                                <span>{label}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    )
}
