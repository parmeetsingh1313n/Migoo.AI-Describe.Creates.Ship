/**
 * Shared mapping of music style IDs → audio URLs.
 * Used by both the SelectMusic UI component and the Remotion rendering pipeline.
 */
export const MUSIC_URLS: Record<string, string> = {
    lofi: 'https://ik.imagekit.io/parmeet/background-music/chill.mp3',
    cinematic: 'https://ik.imagekit.io/parmeet/background-music/cinematic-trailer.mp3',
    upbeat: 'https://ik.imagekit.io/parmeet/background-music/upbeat.mp3',
    corporate: 'https://ik.imagekit.io/parmeet/background-music/coporate.mp3',
    ambient: 'https://ik.imagekit.io/parmeet/background-music/ambient.mp3',
    technology: 'https://ik.imagekit.io/parmeet/background-music/technology.mp3',
    acoustic: 'https://ik.imagekit.io/parmeet/background-music/acoustic.mp3',
    hiphop: 'https://ik.imagekit.io/parmeet/background-music/hip-hop.mp3',
};

/**
 * Resolves a music style ID (from DB) to its audio URL.
 * Returns empty string for 'none' or unrecognized IDs.
 */
export function getMusicUrl(musicId: string): string {
    if (!musicId || musicId === 'none') return '';
    return MUSIC_URLS[musicId] || '';
}
