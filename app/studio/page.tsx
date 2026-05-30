"use client"
import { useUser } from '@clerk/nextjs'
import { motion } from 'framer-motion'
import { ArrowRight, BookOpen, Brain, Clapperboard, Film, Layers, Mic2, Music, Sparkles, Wand2, Zap } from 'lucide-react'
import Link from 'next/link'
import SplittingText from './_components/SplittingText'
import StudioFeatureCard from './_components/StudioFeatureCard'
const features = [
    { icon: BookOpen,    label: "Document Source",       desc: "Upload PDFs, ZIPs, or Images",    color: "from-amber-400 to-orange-400" },
    { icon: Film,        label: "Scene Asset Manager",   desc: "Inject your photos & clips",     color: "from-pink-400 to-rose-400"   },
    { icon: Brain,       label: "Human Touch Score",     desc: "Gamified script editor",          color: "from-primary to-accent"      },
    { icon: Mic2,        label: "Voice & Captions",      desc: "Hormozi-style dynamic captions", color: "from-cyan-400 to-blue-400"   },
    { icon: Music,       label: "Music & SFX",           desc: "Smart sound design per scene",   color: "from-emerald-400 to-green-400"},
    { icon: Layers,      label: "Mixed Media",           desc: "Generated video + your footage", color: "from-secondary to-pink-400"  },
]
export default function StudioPage() {
    const { user } = useUser()

    return (
        <div className="relative min-h-screen bg-muted/20">
            <div className="relative z-10 max-w-5xl mx-auto px-6 pt-0 pb-16 -mt-4 md:-mt-6">

                {/* Header */}
                <motion.div
                    initial={{ opacity: 0, y: -20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, ease: [0.23, 1, 0.32, 1] }}
                    className="text-center mb-12"
                >
                    <h1 
                      className="text-4xl md:text-5xl text-center mb-4 flex items-center justify-center gap-x-2.5 flex-wrap text-foreground"
                      style={{
                        fontFamily: "'Instrument Serif', serif",
                        fontStyle: 'italic',
                        fontWeight: 700,
                        letterSpacing: '-0.3px',
                        lineHeight: '1.25',
                        minHeight: '60px'
                      }}
                    >
                        <SplittingText
                          text="You're the"
                          className="text-foreground"
                          stagger={0.04}
                        />
                        <span className="text-primary border-b border-primary/30 shrink-0">
                            <SplittingText
                              text="Director."
                              className="text-primary"
                              stagger={0.04}
                              delay={0.35}
                            />
                        </span>
                    </h1>
                    <p className="text-muted-foreground max-w-lg mx-auto leading-relaxed">
                        The platform operates as your production crew. You fully control the script, assets, and styling.
                        Platforms reward{" "}
                        <span className="text-foreground font-semibold">human-touched content</span> — this is how you win.
                    </p>
                </motion.div>

                {/* Path cards */}
                <div className="grid md:grid-cols-2 gap-5 mb-12">
                    {/* AI Auto-Pilot */}
                    <motion.div
                        initial={{ opacity: 0, x: -24, scale: 0.97 }}
                        animate={{ opacity: 1, x: 0, scale: 1 }}
                        transition={{ delay: 0.15, duration: 0.5, ease: [0.23, 1, 0.32, 1] }}
                    >
                        <Link href="/short-generator" className="group block h-full">
                            <div className="relative h-full rounded-2xl border border-border/50 bg-white/70 backdrop-blur-sm p-7 hover:border-border hover:shadow-lg hover:shadow-black/5 transition-all duration-300 overflow-hidden">
                                <div className="w-12 h-12 rounded-2xl bg-muted flex items-center justify-center mb-5 group-hover:scale-105 transition-transform duration-300 shadow-sm">
                                    <Zap className="w-6 h-6 text-muted-foreground" />
                                </div>
                                <div className="inline-flex items-center px-2.5 py-1 rounded-full bg-muted border border-border/50 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                                    Quick Mode
                                </div>
                                <h2 className="text-xl font-bold text-foreground mb-2">Smart Auto-Pilot</h2>
                                <p className="text-muted-foreground text-sm leading-relaxed mb-5">
                                    The platform picks the topic, writes the script, and sources the visuals.
                                    1-click generation for your recurring niche series.
                                </p>
                                <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground group-hover:text-foreground transition-colors">
                                    Go to Series <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                                </div>
                            </div>
                        </Link>
                    </motion.div>

                    {/* Director's Chair */}
                    <motion.div
                        initial={{ opacity: 0, x: 24, scale: 0.97 }}
                        animate={{ opacity: 1, x: 0, scale: 1 }}
                        transition={{ delay: 0.22, duration: 0.5, ease: [0.23, 1, 0.32, 1] }}
                    >
                        <Link href="/studio/create" className="group block h-full">
                            <div className="relative h-full rounded-2xl border border-primary/25 bg-gradient-to-br from-primary/8 via-accent/5 to-secondary/5 p-7 hover:border-primary/40 hover:shadow-xl hover:shadow-primary/8 transition-all duration-300 overflow-hidden">
                                {/* Subtle glow on hover */}
                                <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-primary/10 to-accent/10 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none blur-2xl" />
                                <div className="relative z-10">
                                    <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary to-accent flex items-center justify-center mb-5 group-hover:scale-105 transition-transform duration-300 shadow-lg shadow-primary/20">
                                        <Clapperboard className="w-6 h-6 text-white" />
                                    </div>
                                    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/10 border border-primary/20 text-[11px] font-semibold text-primary uppercase tracking-wider mb-3">
                                        ⭐ Migoo Studio
                                    </div>
                                    <h2 className="text-xl font-bold text-foreground mb-2">Full Creative Studio</h2>
                                    <p className="text-muted-foreground text-sm leading-relaxed mb-5">
                                        Upload PDFs, inject your own footage, edit every script line.
                                        Human-touched content that{" "}
                                        <span className="text-primary font-semibold">survives demonetization.</span>
                                    </p>
                                    <div className="flex items-center gap-1.5 text-sm font-semibold text-primary group-hover:text-primary/80 transition-colors">
                                        Open Studio <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                                    </div>
                                </div>
                            </div>
                        </Link>
                    </motion.div>
                </div>

                {/* Features grid */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.4, duration: 0.5 }}
                >
                    <p className="text-center text-sm font-bold text-muted-foreground/80 uppercase tracking-[0.2em] mb-8">
                        What makes Migoo Studio different
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-12 pt-4">
                        {features.map((f, i) => (
                            <motion.div
                                key={f.label}
                                initial={{ opacity: 0, scale: 0.92, y: 10 }}
                                animate={{ opacity: 1, scale: 1, y: 0 }}
                                transition={{ delay: 0.45 + i * 0.08, duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
                            >
                                <StudioFeatureCard
                                    label={f.label}
                                    desc={f.desc}
                                    color={f.color}
                                    icon={f.icon}
                                />
                            </motion.div>
                        ))}
                    </div>
                </motion.div>

                {/* Bottom CTA */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.9, duration: 0.6, ease: [0.23, 1, 0.32, 1] }}
                    className="text-center mt-16 relative"
                >
                    <div className="absolute inset-0 -z-10 bg-primary/10 blur-[100px] rounded-full w-[300px] h-[100px] mx-auto top-1/2 -translate-y-1/2 pointer-events-none" />
                    <Link
                        href="/studio/create"
                        className="group relative inline-flex items-center gap-3 px-8 py-4 rounded-2xl bg-gradient-to-r from-primary to-accent text-white font-bold text-base hover:shadow-xl hover:shadow-primary/30 transition-all duration-300 hover:-translate-y-0.5 active:translate-y-0 active:scale-95 overflow-hidden"
                    >
                        <div className="absolute inset-0 bg-white/20 translate-y-[-100%] group-hover:translate-y-[100%] transition-transform duration-700 ease-in-out pointer-events-none" />
                        <Wand2 className="w-5 h-5 group-hover:rotate-12 transition-transform duration-300" />
                        <span>Enter Migoo Studio</span>
                        <div className="bg-white/20 p-1.5 rounded-lg group-hover:bg-white/30 transition-colors">
                            <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                        </div>
                    </Link>
                    <p className="text-sm font-medium text-muted-foreground mt-5 opacity-80">
                        No credit card required <span className="mx-2 text-border">•</span> Uses your existing series
                    </p>
                </motion.div>
            </div>
        </div>
    )
}
