"use client"
import { motion } from 'framer-motion'
import { Volume2, VolumeX } from 'lucide-react'
import { useRef, useState } from 'react'
import { MUSIC_URLS } from '@/lib/music-urls'

interface Props {
    selected: string
    onSelect: (music: string) => void
}

const musicStyles = [
    { id: 'none', label: 'No Music', description: 'Voice only, no background music', emoji: '🔇', color: 'from-gray-400/20 to-gray-500/20', audioUrl: '' },
    { id: 'lofi', label: 'Lo-Fi Chill', description: 'Relaxed lo-fi beats, study vibes', emoji: '🎧', color: 'from-purple-400/20 to-indigo-500/20', audioUrl: MUSIC_URLS['lofi'] },
    { id: 'cinematic', label: 'Cinematic', description: 'Epic orchestral & dramatic', emoji: '🎬', color: 'from-amber-400/20 to-orange-500/20', audioUrl: MUSIC_URLS['cinematic'] },
    { id: 'upbeat', label: 'Upbeat Pop', description: 'Energetic & catchy vibes', emoji: '🎵', color: 'from-pink-400/20 to-rose-500/20', audioUrl: MUSIC_URLS['upbeat'] },
    { id: 'corporate', label: 'Corporate', description: 'Professional & clean', emoji: '💼', color: 'from-blue-400/20 to-cyan-500/20', audioUrl: MUSIC_URLS['corporate'] },
    { id: 'ambient', label: 'Ambient', description: 'Atmospheric & dreamy', emoji: '🌙', color: 'from-teal-400/20 to-emerald-500/20', audioUrl: MUSIC_URLS['ambient'] },
    { id: 'technology', label: 'Technology', description: 'Futuristic & digital beats', emoji: '⚡', color: 'from-violet-400/20 to-purple-500/20', audioUrl: MUSIC_URLS['technology'] },
    { id: 'acoustic', label: 'Acoustic', description: 'Warm guitar & natural sounds', emoji: '🎸', color: 'from-yellow-400/20 to-amber-500/20', audioUrl: MUSIC_URLS['acoustic'] },
    { id: 'hiphop', label: 'Hip Hop', description: 'Modern trap & hip hop beats', emoji: '🎤', color: 'from-red-400/20 to-rose-500/20', audioUrl: MUSIC_URLS['hiphop'] },
]

function SelectMusic({ selected, onSelect }: Props) {
    const [playingId, setPlayingId] = useState<string | null>(null)
    const audioRef = useRef<HTMLAudioElement | null>(null)

    const handlePlay = (styleId: string, audioUrl: string) => {
        // Stop current audio
        if (audioRef.current) {
            audioRef.current.pause()
            audioRef.current.currentTime = 0
            audioRef.current = null
        }

        // If same track, just stop
        if (playingId === styleId) {
            setPlayingId(null)
            return
        }

        if (!audioUrl) {
            setPlayingId(null)
            return
        }

        const audio = new Audio(audioUrl)
        audioRef.current = audio
        setPlayingId(styleId)

        audio.onended = () => setPlayingId(null)
        audio.onerror = () => setPlayingId(null)
        audio.play()
    }

    return (
        <div>
            <h2 className="text-2xl font-bold mb-1">Background Music</h2>
            <p className="text-muted-foreground mb-6">Set the mood with background music for your series. Click 🔊 to preview.</p>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {musicStyles.map((style, index) => {
                    const isPlaying = playingId === style.id
                    return (
                        <motion.div
                            key={style.id}
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ delay: index * 0.04, duration: 0.3 }}
                            className={`
                                group relative flex items-start gap-4 p-4 rounded-2xl border-2 text-left
                                transition-all duration-300 overflow-hidden
                                ${selected === style.id
                                    ? `bg-gradient-to-br ${style.color} border-primary/40 shadow-lg`
                                    : 'bg-white/60 border-border/50 hover:border-primary/20 hover:bg-white/80 hover:shadow-md'
                                }
                            `}
                        >
                            {/* Animated music waves when playing */}
                            {isPlaying && (
                                <div className="absolute top-2 right-2 flex gap-0.5 items-end h-4">
                                    {[1, 2, 3, 4].map((i) => (
                                        <motion.div
                                            key={i}
                                            className="w-1 bg-primary/60 rounded-full"
                                            animate={{ height: ['4px', '16px', '8px', '14px', '4px'] }}
                                            transition={{ repeat: Infinity, duration: 1.2, delay: i * 0.15 }}
                                        />
                                    ))}
                                </div>
                            )}

                            {/* Clickable area — selects the music */}
                            <button
                                onClick={() => onSelect(style.id)}
                                className="flex items-start gap-4 flex-1 min-w-0 text-left cursor-pointer"
                            >
                                <span className="text-3xl flex-shrink-0">{style.emoji}</span>
                                <div>
                                    <p className="font-semibold">{style.label}</p>
                                    <p className="text-xs text-muted-foreground mt-0.5">{style.description}</p>
                                </div>
                            </button>

                            {/* Preview play button */}
                            {style.audioUrl && (
                                <button
                                    onClick={() => handlePlay(style.id, style.audioUrl)}
                                    className={`
                                        p-2.5 rounded-xl transition-all duration-200 flex-shrink-0 cursor-pointer relative self-center mr-7
                                        ${isPlaying
                                            ? 'bg-primary text-white shadow-lg shadow-primary/25 scale-110'
                                            : 'text-muted-foreground/50 hover:text-primary hover:bg-primary/10'
                                        }
                                    `}
                                    title={isPlaying ? `Stop ${style.label}` : `Preview ${style.label}`}
                                >
                                    {isPlaying ? (
                                        <VolumeX className="w-4 h-4" />
                                    ) : (
                                        <Volume2 className="w-4 h-4" />
                                    )}
                                    {isPlaying && (
                                        <span className="absolute inset-0 rounded-xl animate-ping bg-primary/20" />
                                    )}
                                </button>
                            )}

                            {selected === style.id && (
                                <motion.div
                                    initial={{ scale: 0 }}
                                    animate={{ scale: 1 }}
                                    className="absolute -bottom-1 -right-1 w-6 h-6 bg-primary rounded-full flex items-center justify-center"
                                >
                                    <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                    </svg>
                                </motion.div>
                            )}
                        </motion.div>
                    )
                })}
            </div>
        </div>
    )
}

export default SelectMusic
