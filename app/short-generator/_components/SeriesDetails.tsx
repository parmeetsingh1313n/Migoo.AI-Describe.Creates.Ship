"use client"
import { motion } from 'framer-motion'
import { CalendarClock, Clock, Globe, Info, Type } from 'lucide-react'
import Image from 'next/image'

export interface SeriesData {
    title: string
    duration: string
    platform: string
    publishTime: string
}

interface Props {
    data: SeriesData
    onChange: (data: SeriesData) => void
}

const durationOptions = [
    { id: '30-50', label: '30 – 50 sec', description: 'Quick & snappy' },
    { id: '60-70', label: '60 – 70 sec', description: 'Detailed story' },
]

const platformOptions = [
    { id: 'youtube', label: 'YouTube Shorts', icon: '/youtube.png' },
    { id: 'instagram', label: 'Instagram Reels', icon: '/instagram.png' },
    { id: 'email', label: 'Email Campaign', icon: '/gmail.png' },
]

const inputClass = `w-full px-4 py-3 rounded-xl border-2 border-border/50 bg-white/60 backdrop-blur-sm
    focus:border-primary focus:ring-2 focus:ring-primary/10 outline-none transition-all duration-200
    text-sm placeholder:text-muted-foreground/50 cursor-pointer`

function SeriesDetails({ data, onChange }: Props) {
    return (
        <div>
            <h2 className="text-2xl font-bold mb-1">Series Details</h2>
            <p className="text-muted-foreground mb-6">Final configuration before scheduling your series</p>

            <div className="max-w-2xl space-y-6">
                {/* Series Name */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.05 }}
                >
                    <label className="flex items-center gap-2 text-sm font-semibold mb-2">
                        <Type className="w-4 h-4 text-primary" />
                        Series Name
                    </label>
                    <input
                        type="text"
                        value={data.title}
                        onChange={(e) => onChange({ ...data, title: e.target.value })}
                        placeholder="e.g., AI Facts You Didn't Know"
                        className={`${inputClass} cursor-text`}
                    />
                </motion.div>

                {/* Video Duration */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                >
                    <label className="flex items-center gap-2 text-sm font-semibold mb-2">
                        <Clock className="w-4 h-4 text-primary" />
                        Video Duration
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                        {durationOptions.map((opt) => (
                            <button
                                key={opt.id}
                                onClick={() => onChange({ ...data, duration: opt.id })}
                                className={`
                                    p-4 rounded-xl border-2 text-left transition-all duration-200 cursor-pointer
                                    ${data.duration === opt.id
                                        ? 'border-primary bg-primary/5 shadow-md'
                                        : 'border-border/50 bg-white/60 hover:border-primary/30 hover:bg-white/80'
                                    }
                                `}
                            >
                                <p className="font-bold text-sm">{opt.label}</p>
                                <p className="text-xs text-muted-foreground mt-0.5">{opt.description}</p>
                            </button>
                        ))}
                    </div>
                </motion.div>

                {/* Platform */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.15 }}
                >
                    <label className="flex items-center gap-2 text-sm font-semibold mb-2">
                        <Globe className="w-4 h-4 text-primary" />
                        Platform
                    </label>
                    <div className="grid grid-cols-3 gap-3">
                        {platformOptions.map((opt) => (
                            <button
                                key={opt.id}
                                onClick={() => onChange({ ...data, platform: opt.id })}
                                className={`
                                    p-4 rounded-xl border-2 text-center transition-all duration-200 cursor-pointer
                                    ${data.platform === opt.id
                                        ? 'border-primary bg-primary/5 shadow-md'
                                        : 'border-border/50 bg-white/60 hover:border-primary/30 hover:bg-white/80'
                                    }
                                `}
                            >
                                <Image src={opt.icon} alt={opt.label} width={32} height={32} className="mx-auto mb-1" />
                                <p className="font-semibold text-xs">{opt.label}</p>
                            </button>
                        ))}
                    </div>
                </motion.div>

                {/* Publish Time */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                >
                    <label className="flex items-center gap-2 text-sm font-semibold mb-2">
                        <CalendarClock className="w-4 h-4 text-primary" />
                        Time to Publish
                    </label>
                    <input
                        type="datetime-local"
                        value={data.publishTime}
                        onChange={(e) => onChange({ ...data, publishTime: e.target.value })}
                        min={new Date().toISOString().slice(0, 16)}
                        className={inputClass}
                    />

                    {/* Note */}
                    <div className="flex items-start gap-2 mt-3 p-3 rounded-xl bg-amber-50 border border-amber-200">
                        <Info className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                        <p className="text-xs text-amber-700">
                            Video will be generated <span className="font-bold">3–6 hours before</span> the scheduled publish time to ensure quality and processing.
                        </p>
                    </div>
                </motion.div>


            </div>
        </div>
    )
}

export default SeriesDetails
