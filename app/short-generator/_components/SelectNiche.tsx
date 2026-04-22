"use client"
import { motion } from 'framer-motion'
import {
    BookOpen,
    Brain,
    Briefcase,
    Camera,
    Cpu,
    DollarSign,
    Dumbbell,
    Gamepad2,
    Globe,
    GraduationCap,
    Heart,
    Lightbulb,
    Music,
    Palette,
    PenLine,
    Plane,
    Rocket,
    Sparkles,
    Utensils
} from 'lucide-react'
import { useState } from 'react'

interface Props {
    selected: string
    onSelect: (niche: string) => void
}

const niches = [
    { id: 'tech', label: 'Technology', icon: <Cpu className="w-5 h-5" />, color: 'from-blue-500/20 to-cyan-500/20', border: 'border-blue-500/30' },
    { id: 'finance', label: 'Finance', icon: <DollarSign className="w-5 h-5" />, color: 'from-green-500/20 to-emerald-500/20', border: 'border-green-500/30' },
    { id: 'health', label: 'Health', icon: <Heart className="w-5 h-5" />, color: 'from-red-500/20 to-pink-500/20', border: 'border-red-500/30' },
    { id: 'education', label: 'Education', icon: <GraduationCap className="w-5 h-5" />, color: 'from-purple-500/20 to-violet-500/20', border: 'border-purple-500/30' },
    { id: 'food', label: 'Food & Cooking', icon: <Utensils className="w-5 h-5" />, color: 'from-orange-500/20 to-amber-500/20', border: 'border-orange-500/30' },
    { id: 'fitness', label: 'Fitness', icon: <Dumbbell className="w-5 h-5" />, color: 'from-lime-500/20 to-green-500/20', border: 'border-lime-500/30' },
    { id: 'business', label: 'Business', icon: <Briefcase className="w-5 h-5" />, color: 'from-slate-500/20 to-gray-500/20', border: 'border-slate-500/30' },
    { id: 'design', label: 'Design & Art', icon: <Palette className="w-5 h-5" />, color: 'from-pink-500/20 to-fuchsia-500/20', border: 'border-pink-500/30' },
    { id: 'gaming', label: 'Gaming', icon: <Gamepad2 className="w-5 h-5" />, color: 'from-indigo-500/20 to-purple-500/20', border: 'border-indigo-500/30' },
    { id: 'travel', label: 'Travel', icon: <Plane className="w-5 h-5" />, color: 'from-sky-500/20 to-blue-500/20', border: 'border-sky-500/30' },
    { id: 'music', label: 'Music', icon: <Music className="w-5 h-5" />, color: 'from-violet-500/20 to-purple-500/20', border: 'border-violet-500/30' },
    { id: 'photography', label: 'Photography', icon: <Camera className="w-5 h-5" />, color: 'from-amber-500/20 to-yellow-500/20', border: 'border-amber-500/30' },
    { id: 'selfhelp', label: 'Self Help', icon: <BookOpen className="w-5 h-5" />, color: 'from-teal-500/20 to-cyan-500/20', border: 'border-teal-500/30' },
    { id: 'startup', label: 'Startups', icon: <Rocket className="w-5 h-5" />, color: 'from-rose-500/20 to-red-500/20', border: 'border-rose-500/30' },
    { id: 'ai', label: 'AI & ML', icon: <Brain className="w-5 h-5" />, color: 'from-cyan-500/20 to-blue-500/20', border: 'border-cyan-500/30' },
    { id: 'motivation', label: 'Motivation', icon: <Sparkles className="w-5 h-5" />, color: 'from-yellow-500/20 to-orange-500/20', border: 'border-yellow-500/30' },
    { id: 'productivity', label: 'Productivity', icon: <Lightbulb className="w-5 h-5" />, color: 'from-emerald-500/20 to-teal-500/20', border: 'border-emerald-500/30' },
    { id: 'world', label: 'General Knowledge', icon: <Globe className="w-5 h-5" />, color: 'from-blue-500/20 to-indigo-500/20', border: 'border-blue-500/30' },
]

function SelectNiche({ selected, onSelect }: Props) {
    const [isCustom, setIsCustom] = useState(false)
    const [customNiche, setCustomNiche] = useState('')

    const handleToggle = (custom: boolean) => {
        setIsCustom(custom)
        if (!custom) {
            // Switching to predefined — clear custom text, keep selection if it was a predefined one
            setCustomNiche('')
        } else {
            // Switching to custom — clear predefined selection
            onSelect('')
        }
    }

    const handleCustomChange = (value: string) => {
        setCustomNiche(value)
        onSelect(`custom:${value}`)
    }

    return (
        <div>
            <h2 className="text-2xl font-bold mb-1">Select Your Niche</h2>
            <p className="text-muted-foreground mb-5">Choose the category that fits your short video series</p>

            {/* Toggle: Predefined / Custom */}
            <div className="flex items-center gap-1 p-1 rounded-xl bg-muted/50 border border-border/50 w-fit mb-6">
                <button
                    onClick={() => handleToggle(false)}
                    className={`
                        px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 cursor-pointer
                        ${!isCustom
                            ? 'bg-white text-foreground shadow-sm'
                            : 'text-muted-foreground hover:text-foreground'
                        }
                    `}
                >
                    📋 Predefined
                </button>
                <button
                    onClick={() => handleToggle(true)}
                    className={`
                        flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 cursor-pointer
                        ${isCustom
                            ? 'bg-white text-foreground shadow-sm'
                            : 'text-muted-foreground hover:text-foreground'
                        }
                    `}
                >
                    <PenLine className="w-3.5 h-3.5" />
                    Custom
                </button>
            </div>

            {isCustom ? (
                /* Custom Niche Input */
                <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3 }}
                    className="max-w-xl"
                >
                    <label className="text-sm font-semibold mb-2 block">Enter Your Custom Niche</label>
                    <input
                        type="text"
                        value={customNiche}
                        onChange={(e) => handleCustomChange(e.target.value)}
                        placeholder="e.g., Crypto Trading Tips, DIY Home Decor, Pet Care..."
                        className="w-full px-4 py-3.5 rounded-xl border-2 border-border/50 bg-white/60 backdrop-blur-sm
                            focus:border-primary focus:ring-2 focus:ring-primary/10 outline-none transition-all duration-200
                            text-sm placeholder:text-muted-foreground/50"
                        autoFocus
                    />
                    <p className="text-xs text-muted-foreground mt-2">
                        Type any niche you want — our AI will tailor the series content to match
                    </p>

                    {customNiche && (
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            className="mt-4 p-3 rounded-xl bg-gradient-to-r from-primary/5 to-accent/5 border border-primary/10"
                        >
                            <p className="text-sm">
                                Your niche: <span className="font-bold text-primary">{customNiche}</span>
                            </p>
                        </motion.div>
                    )}
                </motion.div>
            ) : (
                /* Predefined Niche Grid */
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                    {niches.map((niche, index) => (
                        <motion.button
                            key={niche.id}
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: index * 0.03, duration: 0.3 }}
                            onClick={() => onSelect(niche.id)}
                            className={`
                                group relative flex flex-col items-center gap-2 p-4 rounded-2xl border-2
                                transition-all duration-300 cursor-pointer
                                ${selected === niche.id
                                    ? `bg-gradient-to-br ${niche.color} ${niche.border} shadow-lg scale-[1.02]`
                                    : 'bg-white/60 border-border/50 hover:border-primary/30 hover:bg-white/80 hover:shadow-md'
                                }
                            `}
                        >
                            <div className={`
                                p-2.5 rounded-xl transition-all duration-300
                                ${selected === niche.id
                                    ? `bg-gradient-to-br ${niche.color}`
                                    : 'bg-muted/50 group-hover:bg-primary/10'
                                }
                            `}>
                                {niche.icon}
                            </div>
                            <span className="text-sm font-medium text-center leading-tight">{niche.label}</span>

                            {selected === niche.id && (
                                <motion.div
                                    initial={{ scale: 0 }}
                                    animate={{ scale: 1 }}
                                    className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-primary rounded-full flex items-center justify-center"
                                >
                                    <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                    </svg>
                                </motion.div>
                            )}
                        </motion.button>
                    ))}
                </div>
            )}
        </div>
    )
}

export default SelectNiche
