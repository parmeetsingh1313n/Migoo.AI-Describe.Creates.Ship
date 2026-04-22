"use client"
import { motion } from 'framer-motion'
import { Volume2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'

interface Props {
    selectedLanguage: string
    selectedVoice: string
    onSelectLanguage: (lang: string) => void
    onSelectVoice: (voice: string) => void
}

const languages = [
    { id: 'en-IN', label: 'English (India)', flag: '🇮🇳' },
    { id: 'hi-IN', label: 'Hindi', flag: '🇮🇳' },
    { id: 'bn-IN', label: 'Bengali', flag: '🇮🇳' },
    { id: 'ta-IN', label: 'Tamil', flag: '🇮🇳' },
    { id: 'te-IN', label: 'Telugu', flag: '🇮🇳' },
    { id: 'gu-IN', label: 'Gujarati', flag: '🇮🇳' },
    { id: 'kn-IN', label: 'Kannada', flag: '🇮🇳' },
    { id: 'ml-IN', label: 'Malayalam', flag: '🇮🇳' },
    { id: 'mr-IN', label: 'Marathi', flag: '🇮🇳' },
    { id: 'pa-IN', label: 'Punjabi', flag: '🇮🇳' },
    { id: 'od-IN', label: 'Odia', flag: '🇮🇳' },
]

// Sarvam Bulbul v3 speakers with gender info
const speakers = [
    { id: 'shubh', label: 'Shubh', type: 'Male', mood: 'Default · Clear' },
    { id: 'aditya', label: 'Aditya', type: 'Male', mood: 'Professional' },
    { id: 'ritu', label: 'Ritu', type: 'Female', mood: 'Warm' },
    { id: 'priya', label: 'Priya', type: 'Female', mood: 'Friendly' },
    { id: 'neha', label: 'Neha', type: 'Female', mood: 'Soft' },
    { id: 'rahul', label: 'Rahul', type: 'Male', mood: 'Energetic' },
    { id: 'pooja', label: 'Pooja', type: 'Female', mood: 'Calm' },
    { id: 'rohan', label: 'Rohan', type: 'Male', mood: 'Casual' },
    { id: 'simran', label: 'Simran', type: 'Female', mood: 'Cheerful' },
    { id: 'kavya', label: 'Kavya', type: 'Female', mood: 'Expressive' },
    { id: 'amit', label: 'Amit', type: 'Male', mood: 'Firm' },
    { id: 'dev', label: 'Dev', type: 'Male', mood: 'Deep' },
    { id: 'ishita', label: 'Ishita', type: 'Female', mood: 'Lively' },
    { id: 'shreya', label: 'Shreya', type: 'Female', mood: 'Bright' },
    { id: 'kabir', label: 'Kabir', type: 'Male', mood: 'Confident' },
    { id: 'anand', label: 'Anand', type: 'Male', mood: 'Pleasant' },
    { id: 'roopa', label: 'Roopa', type: 'Female', mood: 'Gentle' },
    { id: 'varun', label: 'Varun', type: 'Male', mood: 'Dynamic' },
    { id: 'tanya', label: 'Tanya', type: 'Female', mood: 'Bold' },
    { id: 'sunny', label: 'Sunny', type: 'Male', mood: 'Upbeat' },
    { id: 'shruti', label: 'Shruti', type: 'Female', mood: 'Melodic' },
    { id: 'mohit', label: 'Mohit', type: 'Male', mood: 'Smooth' },
    { id: 'rupali', label: 'Rupali', type: 'Female', mood: 'Graceful' },
    { id: 'sophia', label: 'Sophia', type: 'Female', mood: 'Modern' },
]

// Preview texts by language — beautiful Migoo-themed lines
const previewTexts: Record<string, string> = {
    'en-IN': 'Welcome to Migoo! Your stories deserve to be seen by the world.',
    'hi-IN': 'मिगू में आपका स्वागत है! आपकी कहानियाँ दुनिया के सामने आने के काबिल हैं।',
    'bn-IN': 'মিগুতে আপনাকে স্বাগতম! আপনার গল্পগুলো বিশ্বের কাছে পৌঁছানোর যোগ্য।',
    'ta-IN': 'மிகூவிற்கு வரவேற்கிறோம்! உங்கள் கதைகள் உலகை சென்றடைய வேண்டும்.',
    'te-IN': 'మిగూకి స్వాగతం! మీ కథలు ప్రపంచానికి చేరాలి.',
    'gu-IN': 'મિગુમાં તમારું સ્વાગત છે! તમારી વાર્તાઓ દુનિયા સુધી પહોંચવી જોઈએ.',
    'kn-IN': 'ಮಿಗೂಗೆ ಸ್ವಾಗತ! ನಿಮ್ಮ ಕಥೆಗಳು ಜಗತ್ತಿನ ಮುಂದೆ ಬರಬೇಕು.',
    'ml-IN': 'മിഗൂവിലേക്ക് സ്വാഗതം! നിങ്ങളുടെ കഥകൾ ലോകത്തിന് മുന്നിൽ എത്തണം.',
    'mr-IN': 'मिगूमध्ये आपले स्वागत आहे! तुमच्या कथा जगासमोर यायला हव्यात.',
    'pa-IN': 'ਮਿਗੂ ਵਿੱਚ ਤੁਹਾਡਾ ਸਵਾਗਤ ਹੈ! ਤੁਹਾਡੀਆਂ ਕਹਾਣੀਆਂ ਦੁਨੀਆ ਤੱਕ ਪਹੁੰਚਣੀਆਂ ਚਾਹੀਦੀਆਂ ਹਨ।',
    'od-IN': 'ମିଗୁକୁ ଆପଣଙ୍କ ସ୍ୱାଗତ! ଆପଣଙ୍କ କାହାଣୀ ଦୁନିଆ ଆଗରେ ଆସିବା ଉଚିତ।',
}

function SelectVoice({ selectedLanguage, selectedVoice, onSelectLanguage, onSelectVoice }: Props) {
    const [playingVoice, setPlayingVoice] = useState<string | null>(null)
    const audioRef = useRef<HTMLAudioElement | null>(null)

    const handlePreview = async (speakerId: string) => {
        // Stop currently playing audio
        if (audioRef.current) {
            audioRef.current.pause()
            audioRef.current = null
        }

        if (playingVoice === speakerId) {
            setPlayingVoice(null)
            return
        }

        setPlayingVoice(speakerId)

        try {
            const previewText = previewTexts[selectedLanguage] || previewTexts['en-IN']

            const response = await fetch('/api/tts-preview', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: previewText,
                    speaker: speakerId,
                    language: selectedLanguage,
                }),
            })

            if (!response.ok) {
                throw new Error('Preview failed')
            }

            const { audio } = await response.json()

            // Convert base64 to audio and play
            const audioBlob = new Blob(
                [Uint8Array.from(atob(audio), c => c.charCodeAt(0))],
                { type: 'audio/wav' }
            )
            const audioUrl = URL.createObjectURL(audioBlob)
            const audioElement = new Audio(audioUrl)
            audioRef.current = audioElement

            audioElement.onended = () => {
                setPlayingVoice(null)
                URL.revokeObjectURL(audioUrl)
            }

            audioElement.onerror = () => {
                setPlayingVoice(null)
                toast.error('Audio playback failed')
            }

            await audioElement.play()
        } catch (error) {
            setPlayingVoice(null)
            toast.error('Voice preview unavailable right now')
            console.error('TTS Preview error:', error)
        }
    }

    return (
        <div>
            <h2 className="text-2xl font-bold mb-1">Language & Voice</h2>
            <p className="text-muted-foreground mb-6">Choose the language and narrator voice for your series</p>

            {/* Language Selection */}
            <div className="mb-8">
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Language</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                    {languages.map((lang, index) => (
                        <motion.button
                            key={lang.id}
                            initial={{ opacity: 0, x: -20 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: index * 0.03, duration: 0.3 }}
                            onClick={() => onSelectLanguage(lang.id)}
                            className={`
                                flex items-center gap-3 p-3 rounded-xl border-2 transition-all duration-200 cursor-pointer
                                ${selectedLanguage === lang.id
                                    ? 'border-primary bg-primary/5 shadow-md'
                                    : 'border-border/50 bg-white/60 hover:border-primary/30 hover:bg-white/80'
                                }
                            `}
                        >
                            <span className="text-2xl">{lang.flag}</span>
                            <span className="text-sm font-medium">{lang.label}</span>
                        </motion.button>
                    ))}
                </div>
            </div>

            {/* Voice Selection */}
            <div>
                <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                        Narrator Voice <span className="normal-case font-normal">— powered by AI</span>
                    </h3>
                    <span className="text-xs text-muted-foreground/60">Click 🔊 to preview</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {speakers.map((voice, index) => {
                        const isPlaying = playingVoice === voice.id
                        return (
                            <motion.div
                                key={voice.id}
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: index * 0.03, duration: 0.3 }}
                                className={`
                                    group flex items-center gap-4 p-4 rounded-2xl border-2 transition-all duration-200
                                    ${selectedVoice === voice.id
                                        ? 'border-primary bg-gradient-to-r from-primary/10 to-accent/5 shadow-md'
                                        : 'border-border/50 bg-white/60 hover:border-primary/30 hover:bg-white/80'
                                    }
                                `}
                            >
                                {/* Clickable avatar area — selects the voice */}
                                <button
                                    onClick={() => onSelectVoice(voice.id)}
                                    className="flex items-center gap-4 flex-1 min-w-0 text-left cursor-pointer"
                                >
                                    <div className={`
                                        w-11 h-11 rounded-full flex items-center justify-center text-lg font-bold flex-shrink-0
                                        ${selectedVoice === voice.id
                                            ? 'bg-primary text-white'
                                            : 'bg-muted text-muted-foreground group-hover:bg-primary/10'
                                        }
                                    `}>
                                        {voice.label.charAt(0)}
                                    </div>
                                    <div className="min-w-0">
                                        <p className="font-semibold truncate">{voice.label}</p>
                                        <p className="text-xs text-muted-foreground">{voice.type} · {voice.mood}</p>
                                    </div>
                                </button>

                                {/* Preview button — plays audio */}
                                <button
                                    onClick={() => handlePreview(voice.id)}
                                    className={`
                                        p-2.5 rounded-xl transition-all duration-200 flex-shrink-0 cursor-pointer relative
                                        ${isPlaying
                                            ? 'bg-primary text-white shadow-lg shadow-primary/25 scale-110'
                                            : 'text-muted-foreground/50 hover:text-primary hover:bg-primary/10'
                                        }
                                    `}
                                    title={`Preview ${voice.label}'s voice`}
                                >
                                    <Volume2 className={`w-4 h-4 ${isPlaying ? 'animate-pulse' : ''}`} />
                                    {isPlaying && (
                                        <span className="absolute inset-0 rounded-xl animate-ping bg-primary/20" />
                                    )}
                                </button>
                            </motion.div>
                        )
                    })}
                </div>
            </div>
        </div>
    )
}

export default SelectVoice
