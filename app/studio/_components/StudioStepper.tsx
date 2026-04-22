"use client"
import { motion } from 'framer-motion'
import { AudioWaveform, BookOpen, Check, Clapperboard, Film, Layers, Mic2 } from 'lucide-react'

const STAGES = [
    { id: 0, label: "Source",  icon: BookOpen,       activeColor: "from-amber-500 to-orange-400"   },
    { id: 1, label: "Script",  icon: Layers,         activeColor: "from-primary to-accent"         },
    { id: 2, label: "Assets",  icon: Film,           activeColor: "from-pink-500 to-rose-400"      },
    { id: 3, label: "Voice",   icon: AudioWaveform,  activeColor: "from-violet-500 to-purple-400"  },
    { id: 4, label: "Style",   icon: Mic2,           activeColor: "from-cyan-500 to-blue-400"      },
    { id: 5, label: "Launch",  icon: Clapperboard,   activeColor: "from-emerald-500 to-green-400"  },
]

const TOTAL_STEPS = STAGES.length - 1 // 5

interface Props {
    current: number
    onGoTo?: (i: number) => void
}

export default function StudioStepper({ current, onGoTo }: Props) {
    return (
        <div className="relative flex items-center justify-between mb-10 px-2 select-none">
            {/* Track */}
            <div className="absolute left-0 right-0 top-5 h-px bg-border/60 mx-8 rounded-full" />

            {/* Progress fill */}
            <motion.div
                className="absolute left-0 top-5 h-px bg-gradient-to-r from-primary to-accent rounded-full origin-left mx-8"
                style={{ right: `${((TOTAL_STEPS - current) / TOTAL_STEPS) * 100}%` }}
                layout
                transition={{ type: "spring", stiffness: 200, damping: 30 }}
            />

            {STAGES.map((stage, i) => {
                const done     = i < current
                const active   = i === current
                const clickable = i < current

                return (
                    <button
                        key={stage.id}
                        onClick={() => clickable && onGoTo?.(i)}
                        disabled={!clickable}
                        className={`relative z-10 flex flex-col items-center gap-2 group ${clickable ? 'cursor-pointer' : 'cursor-default'}`}
                    >
                        <motion.div
                            animate={active ? { scale: [1, 1.1, 1] } : { scale: 1 }}
                            transition={{ repeat: active ? Infinity : 0, duration: 2.5, ease: "easeInOut" }}
                            className={`
                                w-10 h-10 rounded-2xl flex items-center justify-center transition-all duration-300 shadow-sm
                                ${done
                                    ? 'bg-gradient-to-br from-emerald-400 to-green-500 shadow-green-200'
                                    : active
                                        ? `bg-gradient-to-br ${stage.activeColor} shadow-primary/20`
                                        : 'bg-muted border border-border/60'
                                }
                            `}
                        >
                            {done ? (
                                <Check className="w-4 h-4 text-white" strokeWidth={3} />
                            ) : (
                                <stage.icon className={`w-4 h-4 ${active ? 'text-white' : 'text-muted-foreground'}`} />
                            )}
                        </motion.div>

                        <span className={`text-[10px] font-semibold uppercase tracking-wider transition-colors duration-300 ${
                            done ? 'text-emerald-500' : active ? 'text-foreground' : 'text-muted-foreground/60'
                        }`}>
                            {stage.label}
                        </span>
                    </button>
                )
            })}
        </div>
    )
}
