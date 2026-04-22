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

// Animated preview for each caption style
function CaptionPreview({ styleId, isSelected }: { styleId: string; isSelected: boolean }) {
    const style = captionStyles.find(s => s.id === styleId)!
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
            tick = tick % cycleTicks + 1
            setCharIndex(Math.min(tick, totalChars))
        }, 80)
        return () => clearInterval(interval)
    }, [styleId])

    // Karaoke word highlighting
    useEffect(() => {
        if (styleId !== 'karaoke') return
        const interval = setInterval(() => {
            setWordIndex(prev => (prev + 1) % (previewWords.length + 1))
        }, 600)
        return () => clearInterval(interval)
    }, [styleId])

    // Neon glow pulsing
    useEffect(() => {
        if (styleId !== 'neon-glow') return
        const interval = setInterval(() => setGlowPhase(prev => !prev), 800)
        return () => clearInterval(interval)
    }, [styleId])

    return (
        <div className="flex items-center justify-center h-full px-4">
            {/* Bold Pop */}
            {styleId === 'bold-pop' && (
                <motion.span
                    key={isSelected ? 'sel' : 'unsel'}
                    initial={{ scale: 0, rotateX: 90 }}
                    animate={{ scale: 1, rotateX: 0 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 12 }}
                    className="text-white font-black text-xl uppercase text-center leading-tight"
                    style={{
                        WebkitTextStroke: '1px black',
                        textShadow: '2px 2px 4px rgba(0,0,0,0.8)',
                    }}
                >
                    {previewText}
                </motion.span>
            )}

            {/* Karaoke */}
            {styleId === 'karaoke' && (
                <span className="text-lg font-extrabold text-center leading-tight">
                    {previewWords.map((word, i) => (
                        <span
                            key={i}
                            className="transition-colors duration-200"
                            style={{
                                color: i < wordIndex ? '#00E5FF' : '#FFFFFF',
                                textShadow: i < wordIndex
                                    ? '0 0 8px rgba(0,229,255,0.6)'
                                    : '1px 1px 3px rgba(0,0,0,0.7)',
                            }}
                        >
                            {word}{' '}
                        </span>
                    ))}
                </span>
            )}

            {/* Typewriter */}
            {styleId === 'typewriter' && (
                <span
                    className="text-lg font-bold text-center leading-tight"
                    style={{
                        fontFamily: 'monospace',
                        color: '#00FF88',
                        backgroundColor: 'rgba(0,0,0,0.6)',
                        padding: '4px 10px',
                        borderRadius: '6px',
                        textShadow: '0 0 8px rgba(0,255,136,0.4)',
                    }}
                >
                    {previewText.slice(0, charIndex)}
                    <motion.span
                        animate={{ opacity: [1, 0] }}
                        transition={{ repeat: Infinity, duration: 0.6 }}
                        className="inline-block w-[2px] h-[1em] bg-green-400 ml-[2px] align-text-bottom"
                    />
                </span>
            )}

            {/* Neon Glow */}
            {styleId === 'neon-glow' && (
                <span
                    className="text-lg font-bold uppercase text-center leading-tight transition-all duration-700"
                    style={{
                        fontFamily: "'Orbitron', sans-serif",
                        color: '#FF00FF',
                        textShadow: glowPhase
                            ? '0 0 8px #FF00FF, 0 0 16px #FF00FF, 0 0 32px #FF00FF'
                            : '0 0 4px #FF00FF, 0 0 8px #FF00FF',
                    }}
                >
                    {previewText}
                </span>
            )}

            {/* Bounce Box */}
            {styleId === 'bounce-box' && (
                <motion.span
                    key={isSelected ? 'sel' : 'unsel'}
                    initial={{ y: 40, scale: 0.5, opacity: 0 }}
                    animate={{ y: 0, scale: 1, opacity: 1 }}
                    transition={{ type: 'spring', stiffness: 300, damping: 15 }}
                    className="text-white font-extrabold text-base uppercase text-center leading-tight"
                    style={{
                        backgroundColor: '#FF3366',
                        padding: '6px 14px',
                        borderRadius: '10px',
                    }}
                >
                    {previewText}
                </motion.span>
            )}

            {/* Cinematic Fade */}
            {styleId === 'cinematic-fade' && (
                <motion.span
                    key={isSelected ? 'sel' : 'unsel'}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 1.2, ease: 'easeOut' }}
                    className="text-white font-bold text-xl text-center leading-tight italic"
                    style={{
                        fontFamily: "'Playfair Display', serif",
                        textShadow: '2px 2px 6px rgba(0,0,0,0.9)',
                    }}
                >
                    {previewText}
                </motion.span>
            )}
        </div>
    )
}

function SelectCaptionStyle({ selected, onSelect }: Props) {
    return (
        <div>
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
