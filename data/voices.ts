/**
 * Shared Sarvam Bulbul v3 voice catalog.
 *
 * Single source of truth for the course generator's voice picker. The
 * short-generator / studio / motion-graphics modules keep their own copies
 * (they work as-is); this file exists so the course generator doesn't add
 * yet another inline copy.
 */

export interface SarvamVoice {
    id: string
    label: string
    gender: 'M' | 'F'
    desc: string
}

export const SARVAM_VOICES: SarvamVoice[] = [
    // Female voices
    { id: 'priya',   label: 'Priya',   gender: 'F', desc: 'Warm & expressive' },
    { id: 'ishita',  label: 'Ishita',  gender: 'F', desc: 'Clear & professional' },
    { id: 'ritu',    label: 'Ritu',    gender: 'F', desc: 'Calm narrator' },
    { id: 'neha',    label: 'Neha',    gender: 'F', desc: 'Friendly & engaging' },
    { id: 'roopa',   label: 'Roopa',   gender: 'F', desc: 'Soothing storyteller' },
    { id: 'pooja',   label: 'Pooja',   gender: 'F', desc: 'Calm & clear' },
    { id: 'simran',  label: 'Simran',  gender: 'F', desc: 'Cheerful & bright' },
    { id: 'kavya',   label: 'Kavya',   gender: 'F', desc: 'Expressive narrator' },
    { id: 'tanya',   label: 'Tanya',   gender: 'F', desc: 'Bold & confident' },
    { id: 'shruti',  label: 'Shruti',  gender: 'F', desc: 'Melodic delivery' },
    { id: 'rupali',  label: 'Rupali',  gender: 'F', desc: 'Graceful tone' },
    { id: 'sophia',  label: 'Sophia',  gender: 'F', desc: 'Modern & polished' },
    { id: 'shreya',  label: 'Shreya',  gender: 'F', desc: 'Energetic & bright' },
    // Male voices
    { id: 'kabir',   label: 'Kabir',   gender: 'M', desc: 'Calm storyteller' },
    { id: 'shubh',   label: 'Shubh',   gender: 'M', desc: 'Natural & balanced' },
    { id: 'aditya',  label: 'Aditya',  gender: 'M', desc: 'Professional tone' },
    { id: 'rahul',   label: 'Rahul',   gender: 'M', desc: 'Energetic & lively' },
    { id: 'rohan',   label: 'Rohan',   gender: 'M', desc: 'Casual & relaxed' },
    { id: 'amit',    label: 'Amit',    gender: 'M', desc: 'Firm & direct' },
    { id: 'dev',     label: 'Dev',     gender: 'M', desc: 'Deep & resonant' },
    { id: 'anand',   label: 'Anand',   gender: 'M', desc: 'Pleasant narrator' },
    { id: 'varun',   label: 'Varun',   gender: 'M', desc: 'Dramatic & intense' },
    { id: 'sunny',   label: 'Sunny',   gender: 'M', desc: 'Upbeat & cheerful' },
    { id: 'mohit',   label: 'Mohit',   gender: 'M', desc: 'Smooth delivery' },
]

/** Matches the current hardcoded course-narration speaker, so defaults are unchanged. */
export const DEFAULT_VOICE_ID = 'kabir'

export const femaleVoices = () => SARVAM_VOICES.filter(v => v.gender === 'F')
export const maleVoices = () => SARVAM_VOICES.filter(v => v.gender === 'M')
