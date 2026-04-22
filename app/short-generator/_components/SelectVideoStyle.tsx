"use client"
import { motion } from 'framer-motion'
import Image from 'next/image'

interface Props {
    selected: string
    onSelect: (style: string) => void
}

const videoStyles = [
    { id: '3d-render', label: '3D Render', image: '/video-style/3d-render.png' },
    { id: 'realistic', label: 'Realistic', image: '/video-style/realistic.png' },
    { id: 'cyberpunk', label: 'Cyberpunk', image: '/video-style/cyberpunk.png' },
    { id: 'cinematic', label: 'Cinematic', image: '/video-style/cinematic.png' },
    { id: 'anime', label: 'Anime', image: '/video-style/anime.png' },
    { id: 'gta', label: 'GTA Style', image: '/video-style/gta.png' },
]

function SelectVideoStyle({ selected, onSelect }: Props) {
    return (
        <div>
            <h2 className="text-2xl font-bold mb-1">Video Style</h2>
            <p className="text-muted-foreground mb-6">Pick the visual aesthetic for your short video series</p>

            {/* Horizontal scrollable list */}
            <div className="flex gap-5 overflow-x-auto pb-4 -mx-2 px-2 snap-x snap-mandatory scrollbar-thin scrollbar-thumb-primary/20 scrollbar-track-transparent">
                {videoStyles.map((style, index) => (
                    <motion.button
                        key={style.id}
                        initial={{ opacity: 0, x: 40 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: index * 0.08, duration: 0.4 }}
                        onClick={() => onSelect(style.id)}
                        className={`
                            group relative flex-shrink-0 snap-center rounded-2xl overflow-hidden cursor-pointer
                            transition-all duration-300
                            ${selected === style.id
                                ? 'ring-4 ring-primary shadow-2xl shadow-primary/30 scale-[1.02]'
                                : 'ring-1 ring-border/30 hover:ring-2 hover:ring-primary/40 hover:shadow-xl hover:scale-[1.01]'
                            }
                        `}
                        style={{ width: '200px' }}
                    >
                        {/* 9:16 image container */}
                        <div className="relative w-[200px] h-[356px]">
                            <Image
                                src={style.image}
                                alt={style.label}
                                fill
                                className="object-cover"
                                sizes="200px"
                            />

                            {/* Bottom gradient overlay with label */}
                            <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/80 via-black/40 to-transparent" />

                            <div className="absolute bottom-0 inset-x-0 p-3">
                                <p className="text-white font-bold text-sm text-center drop-shadow-lg">{style.label}</p>
                            </div>

                            {/* Selected checkmark */}
                            {selected === style.id && (
                                <motion.div
                                    initial={{ scale: 0 }}
                                    animate={{ scale: 1 }}
                                    className="absolute top-3 right-3 w-7 h-7 bg-primary rounded-full flex items-center justify-center shadow-lg"
                                >
                                    <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                    </svg>
                                </motion.div>
                            )}

                            {/* Hover shimmer */}
                            <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500">
                                <div className="absolute inset-0 bg-gradient-to-b from-white/10 via-transparent to-transparent" />
                            </div>
                        </div>
                    </motion.button>
                ))}
            </div>
        </div>
    )
}

export default SelectVideoStyle
