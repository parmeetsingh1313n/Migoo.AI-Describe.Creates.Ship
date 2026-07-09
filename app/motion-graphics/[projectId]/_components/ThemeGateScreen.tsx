"use client"

/**
 * ThemeGateScreen — full-screen "choose your theme first" step shown between
 * project creation and the chat/theme interface. A sensible default palette
 * is pre-selected so "Start Creating" is immediately clickable; users can
 * also switch to a preset or build a custom palette first.
 *
 * On confirm, the parent PATCHes { theme, themeConfirmed: true } and the gate
 * clears (see app/motion-graphics/[projectId]/page.tsx).
 */

import { useState } from 'react'
import { Loader2, Sparkles } from 'lucide-react'
import PalettePicker from './PalettePicker'
import DrawOutlineButton from '@/components/ui/DrawOutlineButton'
import { themeFromPreset, type MotionGraphicTheme } from '@/lib/theme-palette'

interface ThemeGateScreenProps {
    prompt: string
    onConfirm: (theme: MotionGraphicTheme) => Promise<void>
}

export default function ThemeGateScreen({ prompt, onConfirm }: ThemeGateScreenProps) {
    const [theme, setTheme] = useState<MotionGraphicTheme>(themeFromPreset('midnight'))
    const [starting, setStarting] = useState(false)

    const handleStart = async () => {
        setStarting(true)
        try {
            await onConfirm(theme)
        } finally {
            setStarting(false)
        }
    }

    return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-muted/20 p-6">
            <div className="w-full max-w-xl bg-white border border-border rounded-2xl shadow-xl p-8">
                <div className="text-center mb-6">
                    <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary to-accent flex items-center justify-center mx-auto mb-4 shadow-lg shadow-primary/20">
                        <Sparkles className="w-7 h-7 text-white" />
                    </div>
                    <h1 className="text-lg font-bold text-foreground mb-1">Choose a Theme</h1>
                    <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                        Pick a color palette for your video — every scene will follow it automatically. You can customize it further, or per-scene, at any time.
                    </p>
                    {prompt && (
                        <p className="text-xs text-muted-foreground/70 mt-3 italic line-clamp-2">"{prompt}"</p>
                    )}
                </div>

                <PalettePicker value={theme} onChange={setTheme} />

                <DrawOutlineButton
                    onClick={handleStart}
                    disabled={starting}
                    className="mt-6 text-sm font-bold border border-primary/30"
                >
                    {starting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                    Start Creating
                </DrawOutlineButton>
            </div>
        </div>
    )
}
