"use client"
import { captionStyles } from '@/lib/caption-styles'
import { motion } from 'framer-motion'
import { useEffect, useState } from 'react'

interface Props {
    selected: string
    onSelect: (style: string) => void
}

const previewText = "Create amazing videos"
const previewWords = previewText.split(' ')

function scaleTextStroke(stroke: string | undefined): string | undefined {
    if (!stroke || stroke === 'none') return stroke
    return stroke.replace(/([0-9.]+)\s*px/, (_, val) => {
        const num = parseFloat(val)
        return `${Math.max(0.4, num * 0.2)}px`
    })
}

function scaleTextShadow(shadow: string | undefined): string | undefined {
    if (!shadow || shadow === 'none') return shadow
    return shadow.replace(/(-?[0-9.]+)\s*px/g, (_, val) => {
        const num = parseFloat(val)
        return `${num * 0.25}px`
    })
}

// Animated preview for each caption style
function CaptionPreview({ styleId, isSelected }: { styleId: string; isSelected: boolean }) {
    const style = captionStyles.find(s => s.id === styleId)
    const [charIndex, setCharIndex] = useState(0)
    const [wordIndex, setWordIndex] = useState(0)
    const [glowPhase, setGlowPhase] = useState(false)

    // Typewriter effect
    useEffect(() => {
        if (styleId !== 'typewriter') return
        setCharIndex(1)
        let tick = 1
        const totalChars = previewText.length
        const pauseTicks = 12
        const cycleTicks = totalChars + pauseTicks
        const interval = setInterval(() => {
            tick = (tick % cycleTicks) + 1
            setCharIndex(Math.min(tick, totalChars))
        }, 80)
        return () => clearInterval(interval)
    }, [styleId])

    // Karaoke / active word highlight cycle
    useEffect(() => {
        if (!style) return
        const isWordAnim = ['karaoke', 'word-pop', 'word-box', 'word-bounce', 'bounce', 'pop', 'single-word'].includes(style.animation)
        if (!isWordAnim) return

        const interval = setInterval(() => {
            setWordIndex(prev => (prev + 1) % (previewWords.length + 1))
        }, 600)
        return () => clearInterval(interval)
    }, [style])

    // Neon glow pulsing
    useEffect(() => {
        if (!style || style.animation !== 'glow') return
        const interval = setInterval(() => setGlowPhase(prev => !prev), 800)
        return () => clearInterval(interval)
    }, [style])

    if (!style) return null

    // 1. Typewriter Animation
    if (style.animation === 'typewriter') {
        return (
            <span
                className="text-lg font-bold text-center leading-tight"
                style={{
                    fontFamily: style.fontFamily,
                    color: style.color,
                    backgroundColor: style.backgroundColor,
                    padding: style.padding || '4px 10px',
                    borderRadius: `${style.borderRadius}px`,
                    textShadow: scaleTextShadow(style.textShadow),
                    letterSpacing: style.letterSpacing,
                }}
            >
                {previewText.slice(0, charIndex)}
                <motion.span
                    animate={{ opacity: [1, 0] }}
                    transition={{ repeat: Infinity, duration: 0.6 }}
                    className="inline-block w-[2px] h-[1em] bg-current ml-[2px] align-text-bottom"
                />
            </span>
        )
    }

    // 2. Glow Animation
    if (style.animation === 'glow') {
        const baseShadow = scaleTextShadow(style.textShadow) || `0 0 4px ${style.color}`
        const textShadowValue = glowPhase
            ? `${baseShadow}, 0 0 8px ${style.color}`
            : baseShadow
        return (
            <span
                className="text-lg font-bold uppercase text-center leading-tight transition-all duration-700"
                style={{
                    fontFamily: style.fontFamily,
                    color: style.color,
                    WebkitTextStroke: scaleTextStroke(style.textStroke),
                    textShadow: textShadowValue,
                    letterSpacing: style.letterSpacing,
                }}
            >
                {previewText}
            </span>
        )
    }

    // 3a. SINGLE-WORD (MrBeast): one giant word at a time with a spring pop
    if (style.animation === 'single-word') {
        const wordIdxMod = wordIndex % previewWords.length
        const displayWord = style.textTransform === 'uppercase'
            ? previewWords[wordIdxMod].toUpperCase()
            : previewWords[wordIdxMod]
        return (
            <motion.span
                key={wordIdxMod}
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: [0.5, 1.2, 0.95, 1.0], opacity: 1 }}
                transition={{ duration: 0.25, ease: 'easeOut' }}
                className="text-center"
                style={{
                    fontFamily: style.fontFamily,
                    fontWeight: style.fontWeight,
                    color: style.color,
                    WebkitTextStroke: scaleTextStroke(style.textStroke),
                    textShadow: scaleTextShadow(style.textShadow),
                    letterSpacing: style.letterSpacing,
                    fontSize: '1.6rem',  // large — only one word fits
                    lineHeight: 1,
                }}
            >
                {displayWord}
            </motion.span>
        )
    }

    // 3b. Word-by-Word Active Highlights (Hormozi, Karaoke, Boxed, Bounce)
    const isWordAnim = ['karaoke', 'word-pop', 'word-box', 'word-bounce', 'bounce', 'pop'].includes(style.animation)
    if (isWordAnim) {
        return (
            <span
                className="text-center leading-tight flex flex-wrap justify-center gap-x-2 gap-y-1"
                style={{
                    fontFamily: style.fontFamily,
                    fontWeight: style.fontWeight,
                    letterSpacing: style.letterSpacing,
                    textTransform: style.textTransform as any,
                    WebkitTextStroke: scaleTextStroke(style.textStroke),
                    textShadow: scaleTextShadow(style.textShadow),
                }}
            >
                {previewWords.map((word, i) => {
                    const wordIdxMod = wordIndex % (previewWords.length + 1)
                    const isActive = i === wordIdxMod
                    const isPassed = i < wordIdxMod

                    // Start with base word styles — inherit font from wrapper
                    let wordStyle: React.CSSProperties = {
                        color: style.color,
                        backgroundColor: style.backgroundColor !== 'transparent' ? style.backgroundColor : undefined,
                        borderRadius: style.borderRadius > 0 ? `${style.borderRadius}px` : undefined,
                        padding: style.padding && style.padding !== '0' ? style.padding : undefined,
                        transition: 'all 0.2s ease',
                    }

                    // Per-animation highlight logic
                    if (style.animation === 'karaoke') {
                        // karaoke: already-passed words glow in highlight, future stay dim
                        wordStyle.color = isPassed ? style.highlightColor : style.color
                    } else if (style.animation === 'word-box') {
                        if (isActive) {
                            wordStyle.backgroundColor = style.highlightColor
                            wordStyle.padding = '2px 6px'
                            wordStyle.borderRadius = '4px'
                        }
                    } else if (style.animation === 'word-pop') {
                        // Only the active (current) word switches to highlight colour
                        if (isActive) {
                            wordStyle.color = style.highlightColor
                        }
                    }

                    // Overlay activeWordStyle on the current word only
                    if (isActive && style.activeWordStyle) {
                        const scaled = { ...style.activeWordStyle }
                        if (scaled.textShadow) scaled.textShadow = scaleTextShadow(scaled.textShadow)
                        if ((scaled as any).WebkitTextStroke) (scaled as any).WebkitTextStroke = scaleTextStroke((scaled as any).WebkitTextStroke)
                        wordStyle = { ...wordStyle, ...scaled }
                    }

                    return (
                        <motion.span
                            key={i}
                            animate={
                                isActive && (style.animation === 'word-pop')
                                    ? { scale: [1, 1.3, 1] }
                                    : isActive && (style.animation === 'word-bounce' || style.animation === 'bounce')
                                    ? { scale: [1, 1.2, 1], y: [0, -5, 0] }
                                    : { scale: 1, y: 0 }
                            }
                            transition={{ duration: 0.25, ease: 'easeOut' }}
                            className="inline-block"
                            style={wordStyle}
                        >
                            {word}
                        </motion.span>
                    )
                })}
            </span>
        )
    }

    // 4. Default / Fade / Generic style
    const isUppercase = style.textTransform === 'uppercase'
    return (
        <motion.span
            key={isSelected ? 'sel' : 'unsel'}
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            className="text-center leading-tight text-lg"
            style={{
                fontFamily: style.fontFamily,
                color: style.color,
                fontWeight: style.fontWeight,
                WebkitTextStroke: scaleTextStroke(style.textStroke),
                textShadow: scaleTextShadow(style.textShadow),
                letterSpacing: style.letterSpacing,
            }}
        >
            {isUppercase ? previewText.toUpperCase() : previewText}
        </motion.span>
    )
}

function SelectCaptionStyle({ selected, onSelect }: Props) {
    return (
        <div>
            {/* Load Google Fonts for Caption Previews */}
            <link 
                href="https://fonts.googleapis.com/css2?family=Montserrat:ital,wght@0,600;0,700;0,800;0,900;1,700&family=Orbitron:wght@700;800;900&family=Playfair+Display:ital,wght@0,700;1,700&family=Space+Mono:wght@700&family=Poppins:wght@800&family=Inter:wght@600;700;800;900&display=swap" 
                rel="stylesheet" 
            />

            <h2 className="text-2xl font-bold mb-1">Caption Style</h2>
            <p className="text-muted-foreground mb-6">Choose how captions appear on your videos</p>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {captionStyles.map((style, index) => {
                    const isSelected = selected === style.id
                    return (
                        <motion.button
                            key={style.id}
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: index * 0.06, duration: 0.4 }}
                            onClick={() => onSelect(style.id)}
                            className={`
                                group relative overflow-hidden rounded-2xl border-2 transition-all duration-300 cursor-pointer text-left
                                ${isSelected
                                    ? 'border-primary shadow-xl scale-[1.02]'
                                    : 'border-border/30 hover:border-primary/30 hover:shadow-lg'
                                }
                            `}
                        >
                            {/* Dark phone-like preview area */}
                            <div className="relative h-36 bg-gradient-to-b from-gray-900 to-gray-800 flex items-center justify-center overflow-hidden">
                                {/* Subtle grid pattern */}
                                <div className="absolute inset-0 opacity-10"
                                    style={{
                                        backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.15) 1px, transparent 1px)',
                                        backgroundSize: '16px 16px',
                                    }}
                                />
                                <CaptionPreview styleId={style.id} isSelected={isSelected} />
                            </div>

                            {/* Info section */}
                            <div className={`p-3.5 ${isSelected ? 'bg-primary/5' : 'bg-white/80'}`}>
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="font-bold text-sm">{style.label}</p>
                                        <p className="text-[11px] text-muted-foreground mt-0.5">{style.description}</p>
                                    </div>
                                    {isSelected && (
                                        <motion.div
                                            initial={{ scale: 0 }}
                                            animate={{ scale: 1 }}
                                            className="w-6 h-6 bg-primary rounded-full flex items-center justify-center flex-shrink-0"
                                        >
                                            <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                            </svg>
                                        </motion.div>
                                    )}
                                </div>
                            </div>
                        </motion.button>
                    )
                })}
            </div>
        </div>
    )
}

export default SelectCaptionStyle
