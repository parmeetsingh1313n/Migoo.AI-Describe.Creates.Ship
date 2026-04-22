"use client"
import { motion } from 'framer-motion'
import { Check, Crown, Music, Subtitles } from 'lucide-react'
import React, { useEffect, useState } from 'react'

// ═══════════════════════════════════════════════════════════════════════════════
// CAPTION STYLE DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════════

interface CaptionStyleDef {
    id: string
    label: string
    desc: string
    trending?: boolean
    accentColor: string
    preview: {
        words: string[]
        bg: string
        baseStyle: React.CSSProperties
        activeOverride: React.CSSProperties
        activeScale?: number
        activeY?: number
    }
}

const CAPTION_STYLES: CaptionStyleDef[] = [
    {
        id: "hormozi",
        label: "Hormozi",
        desc: "Bold yellow, word-by-word pop • ALL CAPS",
        trending: true,
        accentColor: "#FACC15",
        preview: {
            words: ["THIS", "IS", "HOW", "YOU", "WIN"],
            bg: "linear-gradient(160deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)",
            activeScale: 1.22,
            baseStyle: {
                fontFamily: "'Montserrat', 'Arial Black', sans-serif",
                fontWeight: 900,
                fontSize: "12px",
                textTransform: "uppercase",
                color: "#FFFFFF",
                textShadow: "1px 1px 0 #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000",
                letterSpacing: "0.05em",
            },
            activeOverride: {
                color: "#FACC15",
            }
        }
    },
    {
        id: "mrbeast",
        label: "MrBeast",
        desc: "Giant text, thick black stroke",
        trending: true,
        accentColor: "#FFD700",
        preview: {
            words: ["OH", "MY", "GOD"],
            bg: "linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%)",
            activeScale: 1.28,
            baseStyle: {
                fontFamily: "'Impact', 'Arial Black', sans-serif",
                fontWeight: 900,
                fontSize: "18px",
                textTransform: "uppercase",
                color: "#FFFFFF",
                textShadow: "2px 2px 0 #000, -2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 0 2px 0 #000, 0 -2px 0 #000",
                letterSpacing: "0.04em",
            },
            activeOverride: {
                color: "#FFD700",
                textShadow: "2px 2px 0 #000, -2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 0 0 16px rgba(255,215,0,0.45)",
            }
        }
    },
    {
        id: "minimal",
        label: "Minimal",
        desc: "Clean white, gentle fade",
        accentColor: "#94A3B8",
        preview: {
            words: ["less", "is", "more"],
            bg: "linear-gradient(180deg, #1e1e1e 0%, #2a2a2a 100%)",
            activeScale: 1.05,
            baseStyle: {
                fontFamily: "'Inter', 'Helvetica Neue', sans-serif",
                fontWeight: 400,
                fontSize: "14px",
                color: "rgba(255,255,255,0.4)",
                letterSpacing: "0.02em",
            },
            activeOverride: {
                color: "#FFFFFF",
                fontWeight: 500,
            }
        }
    },
    {
        id: "karaoke",
        label: "Karaoke",
        desc: "Highlighted word as spoken",
        accentColor: "#22D3EE",
        preview: {
            words: ["follow", "the", "beat", "now"],
            bg: "linear-gradient(160deg, #0c1220 0%, #1a2332 100%)",
            activeScale: 1.12,
            baseStyle: {
                fontFamily: "'Inter', sans-serif",
                fontWeight: 700,
                fontSize: "13px",
                color: "rgba(255,255,255,0.35)",
            },
            activeOverride: {
                color: "#22D3EE",
            }
        }
    },
    {
        id: "boxed",
        label: "Boxed",
        desc: "Dark background, high contrast",
        accentColor: "#6366F1",
        preview: {
            words: ["clean", "and", "readable"],
            bg: "linear-gradient(180deg, #374151 0%, #1f2937 100%)",
            activeScale: 1.05,
            baseStyle: {
                fontFamily: "'Inter', sans-serif",
                fontWeight: 700,
                fontSize: "12px",
                color: "#FFFFFF",
                backgroundColor: "rgba(0,0,0,0.6)",
                padding: "2px 6px",
                borderRadius: "4px",
            },
            activeOverride: {
                backgroundColor: "rgba(99,102,241,0.85)",
            }
        }
    },
    {
        id: "neon",
        label: "Neon Glow",
        desc: "Vibrant glowing neon effect",
        trending: true,
        accentColor: "#E879F9",
        preview: {
            words: ["feel", "the", "glow"],
            bg: "linear-gradient(180deg, #0a0a0a 0%, #111 100%)",
            activeScale: 1.15,
            baseStyle: {
                fontFamily: "'Inter', sans-serif",
                fontWeight: 800,
                fontSize: "14px",
                color: "#D946EF",
                textShadow: "0 0 7px rgba(217,70,239,0.35), 0 0 14px rgba(217,70,239,0.15)",
                letterSpacing: "0.03em",
            },
            activeOverride: {
                color: "#F0ABFC",
                textShadow: "0 0 10px rgba(240,171,252,0.7), 0 0 22px rgba(217,70,239,0.5), 0 0 44px rgba(217,70,239,0.25)",
            }
        }
    },
    {
        id: "typewriter",
        label: "Typewriter",
        desc: "Monospace, letter-by-letter feel",
        accentColor: "#4ADE80",
        preview: {
            words: ["generating", "caption", "..."],
            bg: "linear-gradient(180deg, #0d1117 0%, #161b22 100%)",
            activeScale: 1.0,
            baseStyle: {
                fontFamily: "'JetBrains Mono', 'Courier New', monospace",
                fontWeight: 500,
                fontSize: "11px",
                color: "rgba(74,222,128,0.35)",
                letterSpacing: "0.02em",
            },
            activeOverride: {
                color: "#4ADE80",
                textShadow: "0 0 8px rgba(74,222,128,0.3)",
            }
        }
    },
    {
        id: "ali-abdaal",
        label: "Ali Abdaal",
        desc: "Clean modern, pastel highlight",
        accentColor: "#86EFAC",
        preview: {
            words: ["learn", "something", "new"],
            bg: "linear-gradient(180deg, #1c1917 0%, #292524 100%)",
            activeScale: 1.08,
            baseStyle: {
                fontFamily: "'Inter', sans-serif",
                fontWeight: 600,
                fontSize: "13px",
                color: "rgba(255,255,255,0.5)",
                letterSpacing: "0.01em",
                padding: "1px 4px",
                borderBottom: "2px solid transparent",
            },
            activeOverride: {
                color: "#FFFFFF",
                backgroundColor: "rgba(134,239,172,0.18)",
                borderBottom: "2px solid #86EFAC",
            }
        }
    },
    {
        id: "gradient",
        label: "Gradient Pop",
        desc: "Colorful gradient text effect",
        accentColor: "#A855F7",
        preview: {
            words: ["stand", "out", "always"],
            bg: "linear-gradient(135deg, #1e1b4b 0%, #312e81 100%)",
            activeScale: 1.18,
            baseStyle: {
                fontFamily: "'Inter', 'Arial Black', sans-serif",
                fontWeight: 800,
                fontSize: "14px",
                color: "#C084FC",
                letterSpacing: "0.03em",
            },
            activeOverride: {
                color: "#E879F9",
                textShadow: "0 0 14px rgba(168,85,247,0.5)",
            }
        }
    },
    {
        id: "bounce",
        label: "Bounce",
        desc: "Energetic bouncing words",
        accentColor: "#FB923C",
        preview: {
            words: ["words", "come", "alive"],
            bg: "linear-gradient(160deg, #1a1a1a 0%, #2d1f1f 100%)",
            activeScale: 1.32,
            activeY: -5,
            baseStyle: {
                fontFamily: "'Inter', sans-serif",
                fontWeight: 800,
                fontSize: "14px",
                color: "rgba(255,255,255,0.4)",
                textTransform: "uppercase",
            },
            activeOverride: {
                color: "#FB923C",
            }
        }
    },
    {
        id: "classic",
        label: "Classic",
        desc: "Traditional white subtitles",
        accentColor: "#E2E8F0",
        preview: {
            words: ["the", "classic", "look"],
            bg: "linear-gradient(180deg, #111827 0%, #1f2937 100%)",
            activeScale: 1.0,
            baseStyle: {
                fontFamily: "'Georgia', 'Times New Roman', serif",
                fontWeight: 400,
                fontSize: "13px",
                color: "#FFFFFF",
                textShadow: "1px 1px 3px rgba(0,0,0,0.8)",
                letterSpacing: "0.01em",
            },
            activeOverride: {
                fontWeight: 700,
            }
        }
    },
    {
        id: "outline",
        label: "Outline",
        desc: "Stroke-only with color fill",
        accentColor: "#38BDF8",
        preview: {
            words: ["BOLD", "AND", "CLEAR"],
            bg: "linear-gradient(180deg, #0f172a 0%, #1e293b 100%)",
            activeScale: 1.15,
            baseStyle: {
                fontFamily: "'Inter', 'Arial Black', sans-serif",
                fontWeight: 900,
                fontSize: "14px",
                color: "transparent",
                WebkitTextStroke: "1.2px rgba(255,255,255,0.5)",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
            },
            activeOverride: {
                color: "#38BDF8",
                WebkitTextStroke: "1.2px #38BDF8",
                textShadow: "0 0 12px rgba(56,189,248,0.4)",
            }
        }
    },
]

// ═══════════════════════════════════════════════════════════════════════════════
// MUSIC GENRES
// ═══════════════════════════════════════════════════════════════════════════════

const MUSIC_GENRES = [
    { id: "cinematic", label: "Cinematic", emoji: "🎬" },
    { id: "lofi",      label: "Lo-Fi",     emoji: "☕" },
    { id: "epic",      label: "Epic",      emoji: "⚡" },
    { id: "ambient",   label: "Ambient",   emoji: "🌊" },
    { id: "upbeat",    label: "Upbeat",    emoji: "🔥" },
    { id: "none",      label: "No Music",  emoji: "🔇" },
]

// ═══════════════════════════════════════════════════════════════════════════════
// PROPS (voice & language removed — handled in Voice stage)
// ═══════════════════════════════════════════════════════════════════════════════

interface Props {
    captionStyle: string
    setCaptionStyle: (v: string) => void
    music: string
    setMusic: (v: string) => void
}

// ═══════════════════════════════════════════════════════════════════════════════
// ANIMATED CAPTION PREVIEW CARD
// ═══════════════════════════════════════════════════════════════════════════════

function CaptionPreviewCard({
    style,
    selected,
    onClick,
    cardIndex,
}: {
    style: CaptionStyleDef
    selected: boolean
    onClick: () => void
    cardIndex: number
}) {
    const [activeWord, setActiveWord] = useState(0)

    useEffect(() => {
        const interval = setInterval(() => {
            setActiveWord(i => (i + 1) % style.preview.words.length)
        }, 520 + cardIndex * 45)
        return () => clearInterval(interval)
    }, [style.preview.words.length, cardIndex])

    return (
        <motion.button
            onClick={onClick}
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.97 }}
            className={`relative flex flex-col rounded-2xl border-2 overflow-hidden text-left transition-all duration-300 cursor-pointer group ${
                selected
                    ? 'shadow-lg ring-1'
                    : 'border-border/40 hover:border-border/70 shadow-sm hover:shadow-md'
            }`}
            style={selected ? {
                borderColor: style.accentColor,
                boxShadow: `0 0 24px ${style.accentColor}20, 0 4px 16px rgba(0,0,0,0.08)`,
                // @ts-ignore ring color
                '--tw-ring-color': `${style.accentColor}30`,
            } as React.CSSProperties : undefined}
        >
            {/* ── Video preview frame ─────────────────────────────── */}
            <div
                className="relative w-full flex items-center justify-center overflow-hidden"
                style={{
                    background: style.preview.bg,
                    aspectRatio: "16 / 9",
                    minHeight: "90px",
                }}
            >
                {/* Subtle scanline overlay */}
                <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{
                    backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,0.08) 2px, rgba(255,255,255,0.08) 4px)",
                }} />

                {/* Play button hint on hover */}
                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none z-20">
                    <div className="w-7 h-7 rounded-full bg-white/10 backdrop-blur-sm flex items-center justify-center">
                        <div className="w-0 h-0 border-t-[5px] border-t-transparent border-b-[5px] border-b-transparent border-l-[8px] border-l-white/60 ml-0.5" />
                    </div>
                </div>

                {/* Caption text */}
                <div className="relative z-10 flex flex-wrap items-center justify-center gap-x-[5px] gap-y-[2px] px-3">
                    {style.preview.words.map((word, i) => {
                        const isActive = i === activeWord
                        return (
                            <motion.span
                                key={i}
                                animate={{
                                    scale: isActive ? (style.preview.activeScale ?? 1.1) : 1,
                                    y: isActive ? (style.preview.activeY ?? 0) : 0,
                                }}
                                transition={{ type: "spring", stiffness: 500, damping: 22 }}
                                style={{
                                    ...style.preview.baseStyle,
                                    ...(isActive ? style.preview.activeOverride : {}),
                                    display: "inline-block",
                                    whiteSpace: "nowrap",
                                    lineHeight: 1.4,
                                }}
                            >
                                {word}
                            </motion.span>
                        )
                    })}
                </div>

                {/* Typewriter blinking cursor */}
                {style.id === "typewriter" && (
                    <motion.span
                        animate={{ opacity: [1, 0] }}
                        transition={{ repeat: Infinity, repeatType: "reverse", duration: 0.55 }}
                        className="absolute z-10"
                        style={{
                            bottom: "38%",
                            right: "18%",
                            width: "2px",
                            height: "13px",
                            backgroundColor: "#4ADE80",
                        }}
                    />
                )}
            </div>

            {/* ── Label area ──────────────────────────────────────── */}
            <div className="px-3 py-2.5 bg-white border-t border-border/20">
                <div className="flex items-center gap-1.5">
                    <span
                        className="text-xs font-bold"
                        style={selected ? { color: style.accentColor } : { color: 'var(--foreground, #111)' }}
                    >
                        {style.label}
                    </span>
                    {style.trending && (
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-[1px] rounded-full bg-amber-50 text-[9px] font-bold text-amber-600 border border-amber-200/60">
                            <Crown className="w-2.5 h-2.5" />
                            HOT
                        </span>
                    )}
                </div>
                <p className="text-[10px] text-muted-foreground leading-tight mt-0.5 truncate">{style.desc}</p>
            </div>

            {/* ── Selection checkmark ─────────────────────────────── */}
            {selected && (
                <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", stiffness: 500, damping: 20 }}
                    className="absolute top-2 right-2 w-5 h-5 rounded-full flex items-center justify-center shadow-lg z-20"
                    style={{ backgroundColor: style.accentColor }}
                >
                    <Check className="w-3 h-3 text-white" strokeWidth={3} />
                </motion.div>
            )}
        </motion.button>
    )
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION HELPER
// ═══════════════════════════════════════════════════════════════════════════════

function Section({ icon, title, badge, children }: { icon: React.ReactNode; title: string; badge?: string; children: React.ReactNode }) {
    return (
        <div className="space-y-3">
            <div className="flex items-center gap-2">
                {icon}
                <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{title}</span>
                {badge && (
                    <span className="px-2 py-0.5 rounded-full bg-pink-50 text-[10px] font-bold text-pink-600 border border-pink-200/50">
                        {badge}
                    </span>
                )}
            </div>
            {children}
        </div>
    )
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

export default function StudioStageStyle({ captionStyle, setCaptionStyle, music, setMusic }: Props) {
    return (
        <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
            className="space-y-7"
        >
            {/* Header */}
            <div>
                <h2 className="text-xl font-bold text-foreground mb-1">Visual Style</h2>
                <p className="text-sm text-muted-foreground">Choose how your captions look and what music plays</p>
            </div>

            {/* ── Caption Style ───────────────────────────────────── */}
            <Section
                icon={<Subtitles className="w-4 h-4 text-pink-500" />}
                title="Caption Style"
                badge={`${CAPTION_STYLES.length} styles`}
            >
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                    {CAPTION_STYLES.map((cs, index) => (
                        <CaptionPreviewCard
                            key={cs.id}
                            style={cs}
                            selected={captionStyle === cs.id}
                            onClick={() => setCaptionStyle(cs.id)}
                            cardIndex={index}
                        />
                    ))}
                </div>
            </Section>

            {/* ── Background Music ────────────────────────────────── */}
            <Section icon={<Music className="w-4 h-4 text-emerald-500" />} title="Background Music">
                <div className="grid grid-cols-3 gap-2">
                    {MUSIC_GENRES.map(mg => (
                        <button
                            key={mg.id}
                            onClick={() => setMusic(mg.id)}
                            className={`relative flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
                                music === mg.id
                                    ? 'bg-emerald-50 border-emerald-200 text-emerald-700 shadow-sm'
                                    : 'bg-muted/40 border-border/50 text-muted-foreground hover:text-foreground hover:bg-muted/70'
                            }`}
                        >
                            <span>{mg.emoji}</span>
                            {mg.label}
                            {music === mg.id && (
                                <div className="absolute top-1.5 right-1.5 w-3.5 h-3.5 rounded-full bg-emerald-500 flex items-center justify-center">
                                    <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />
                                </div>
                            )}
                        </button>
                    ))}
                </div>
            </Section>
        </motion.div>
    )
}
