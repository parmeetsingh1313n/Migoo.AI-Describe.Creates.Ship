/**
 * MotionGraphicComposition — Remotion composition for AI motion graphic videos.
 * Supports 35 scene types (title_reveal, search_reveal, comparison, phone_mockup,
 * code_terminal, metric_dashboard, floating_cards, timeline_reveal, particle_text,
 * card_stack_3d, chart_race, ui_showcase, text_mask_reveal, big_number,
 * pricing_table, map_reveal, …) dispatched by SceneRenderer.
 *
 * Shared animation vocabulary and ambient effect layers live in ./lib/motion.
 * This composition reads structured scene data from AI and renders animated scenes
 * with professional transitions, text animations, and optional voiceover/music.
 */

import React, { useMemo } from 'react';
import * as LucideIcons from 'lucide-react';
import {
    AbsoluteFill,
    Audio,
    Img as RemotionImg,
    Video,
    OffthreadVideo,
    Sequence,
    interpolate,
    spring,
    staticFile,
    useCurrentFrame,
    useVideoConfig,
} from 'remotion';
import {
    getEntrance,
    getCharStagger,
    seededRandom,
    toText,
    parseNum,
    Grain,
    ParticleField,
    FloatingShapes,
    Spotlight,
    VignetteGlow,
    GradientMesh,
    KenBurns,
    ParallaxLayer,
    MeshBg,
    OrbBg,
    DottedGlobe,
    CITY_COORDS,
    type GlobePin,
} from './lib/motion';

// ─── Smart Icon Component ────────────────────────────────────────────────────
// Handles both Emojis and dynamic Lucide icons with a premium glow effect.
const toPascalCase = (str: string) => {
    if (!str) return '';
    return str
        .split(/[-_\s]+/)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join('');
};

const SmartIcon: React.FC<{ name?: string; color?: string; size?: number; style?: React.CSSProperties }> = ({ name, color = '#fff', size = 64, style }) => {
    const cleanName = (name || '').trim();
    if (!cleanName) {
        return <LucideIcons.Sparkles color={color} size={size} style={{ filter: `drop-shadow(0 0 15px ${color}80)`, ...style }} />;
    }
    
    // Check if it's an emoji
    const isEmoji = /\p{Emoji}/u.test(cleanName) && cleanName.length <= 4;
    if (isEmoji) {
        return <span style={{ fontSize: size, filter: `drop-shadow(0 0 20px ${color}40)`, ...style }}>{cleanName}</span>;
    }

    // Try to find Lucide icon (e.g. "mouse-pointer" -> "MousePointer")
    const pascalName = toPascalCase(cleanName);
    const IconComponent = (LucideIcons as any)[pascalName] || (LucideIcons as any)[cleanName] || LucideIcons.Sparkles;

    // Safety: if for some reason IconComponent is not a function/component, fallback to Sparkles
    const ValidIcon = typeof IconComponent === 'function' || (typeof IconComponent === 'object' && IconComponent !== null) 
        ? IconComponent 
        : LucideIcons.Sparkles;

    return <ValidIcon color={color} size={size} strokeWidth={1.5} style={{ filter: `drop-shadow(0 0 15px ${color}80)`, ...style }} />;
};

// ─── Asset URL Resolver ─────────────────────────────────────────────────────
// Relative paths (e.g. "tmp/assets_mg_.../scene_0.mp4") are stored in props
// so they are port-agnostic. staticFile() maps them to the correct URL in
// both browser preview and npx remotion render.
const resolveAssetUrl = (url: string): string => {
    if (!url) return '';

    // Pre-formed absolute URL — sanitize /public/ prefix and return.
    // Remotion on Windows sometimes generates http://localhost:PORT/public/tmp/...
    // but Next.js serves public/ files at the root (no /public/ prefix in the URL).
    if (url.startsWith('http') || url.startsWith('https') || url.startsWith('file:') || url.startsWith('blob:')) {
        return url.replace(/\/public\//g, '/');
    }

    // Relative path — strip leading slash and any public/ prefix.
    // staticFile() expects paths relative to the public/ directory, not including it.
    let clean = url.replace(/^\//, '');
    if (clean.startsWith('public/')) clean = clean.slice('public/'.length);

    // staticFile() on Windows returns "http://localhost:PORT/public/tmp/..."
    // Strip /public/ from the resolved URL so the correct path is used.
    const resolved = staticFile(clean);
    return resolved.replace(/\/public\//g, '/');
};


// ─── Smart Media Component ───────────────────────────────────────────────────
const Img: React.FC<React.ComponentProps<typeof RemotionImg>> = (props) => {
    const raw = props.src as string;
    const src = resolveAssetUrl(raw);
    if (!src) return null;
    const isVideo = src.endsWith('.mp4') || src.endsWith('.webm') || src.includes('video-files');
    if (isVideo) {
        // Block raw Kling/fal CDN URLs that haven't been transcoded
        const isRawKling = src.includes('fal.media') || src.includes('klingai.com') || src.includes('klingai');
        if (isRawKling) {
            console.warn('[Remotion] Blocked raw Kling HEVC URL:', src);
            return null;
        }
        // file:/// URLs: use Chromium's Video component (--disable-web-security allows local file access).
        // OffthreadVideo (Rust compositor) ONLY accepts http/https and rejects file:/// URLs.
        if (src.startsWith('file:///')) {
            return <Video {...(props as any)} src={src} loop style={{ width: '100%', height: '100%', objectFit: 'cover', ...(props.style as any) }} />;
        }

        // Localhost URLs: use native Video component. 
        // OffthreadVideo's Rust proxy sometimes fails to connect to the local dev server on Windows.
        if (src.includes('localhost') || src.includes('127.0.0.1')) {
            return <Video {...(props as any)} src={src} loop style={{ width: '100%', height: '100%', objectFit: 'cover', ...(props.style as any) }} />;
        }

        // Remote http/https MP4s: use OffthreadVideo for reliable frame extraction
        return <OffthreadVideo {...(props as any)} src={src} loop />;
    }
    return <RemotionImg {...props} />;
};

// ─── Types ───────────────────────────────────────────────────────────────────

export interface MotionGraphicScene {
    type: 'title_reveal' | 'kinetic_text' | 'stat_counter' | 'icon_grid' | 'comparison' | 'image_showcase' | 'call_to_action' | 'logo_reveal' | 'search_reveal' | 'feature_list' | 'split_hero' | 'neon_glow' | 'gradient_burst' | 'floating_cards' | 'timeline_reveal' | 'bento_grid' | 'video_hero' | 'phone_mockup' | 'browser_mockup' | 'timeline' | 'testimonial' | 'metric_dashboard' | 'process_steps' | 'notification_stack' | 'code_terminal' | 'glass_card' | 'quote_reveal' | 'particle_text' | 'card_stack_3d' | 'chart_race' | 'ui_showcase' | 'text_mask_reveal' | 'big_number' | 'pricing_table' | 'map_reveal' | string;
    headline?: string;
    subtext?: string;
    content?: string;
    query?: string;
    items?: Array<{ icon?: string; label?: string; value?: string; year?: string }>;
    stat?: { value: number | string; suffix?: string; prefix?: string; label?: string };
    imageUrl?: string;
    imageStyle?: 'full_bleed' | 'polaroid' | 'tilted' | 'frame' | 'hexagon';
    animation?: string;
    durationSec?: number;
    colors?: { bg?: string; text?: string; accent?: string; secondary?: string };
    // When true, `colors` above overrides the global theme palette for THIS
    // scene only. When false/absent, the scene follows theme.resolved like
    // every other non-customized scene.
    customColors?: boolean;
    voiceoverLine?: string;
}

export interface MotionGraphicTheme {
    mode?: 'preset' | 'custom';
    palette?: string;
    customColors?: string[];
    // Single source of truth every scene's palette resolves from — see the
    // `palette` const in MotionGraphicComposition below.
    resolved?: { bg: string; text: string; accent: string; secondary: string; gradient: string };
    font?: string;
    animationStyle?: string;
}

export interface MotionGraphicCompositionProps {
    scenes: MotionGraphicScene[];
    theme: MotionGraphicTheme;
    durationInFrames: number;
    fps: number;
    width: number;
    height: number;
    musicUrl?: string;
    audioUrl?: string;
    audioDuration?: number;
    voiceoverEnabled?: boolean;
}

// ─── Color Palettes ──────────────────────────────────────────────────────────

const PALETTES: Record<string, { bg: string; text: string; accent: string; secondary: string; gradient: string }> = {
    midnight: {
        bg: '#0a0a0f',
        text: '#ffffff',
        accent: '#6366f1',
        secondary: '#818cf8',
        gradient: 'linear-gradient(135deg, #0a0a0f 0%, #1e1b4b 50%, #0a0a0f 100%)',
    },
    sunset: {
        bg: '#1a0a0a',
        text: '#ffffff',
        accent: '#f97316',
        secondary: '#fb923c',
        gradient: 'linear-gradient(135deg, #1a0a0a 0%, #7c2d12 50%, #1a0a0a 100%)',
    },
    ocean: {
        bg: '#0a1628',
        text: '#ffffff',
        accent: '#06b6d4',
        secondary: '#22d3ee',
        gradient: 'linear-gradient(135deg, #0a1628 0%, #164e63 50%, #0a1628 100%)',
    },
    emerald: {
        bg: '#0a1a0a',
        text: '#ffffff',
        accent: '#10b981',
        secondary: '#34d399',
        gradient: 'linear-gradient(135deg, #0a1a0a 0%, #064e3b 50%, #0a1a0a 100%)',
    },
    rose: {
        bg: '#1a0a14',
        text: '#ffffff',
        accent: '#f43f5e',
        secondary: '#fb7185',
        gradient: 'linear-gradient(135deg, #1a0a14 0%, #881337 50%, #1a0a14 100%)',
    },
    neon: {
        bg: '#000000',
        text: '#ffffff',
        accent: '#a855f7',
        secondary: '#c084fc',
        gradient: 'linear-gradient(135deg, #000000 0%, #3b0764 50%, #000000 100%)',
    },
};

// ─── Animation helpers & shared backgrounds ──────────────────────────────────
// getEntrance / getExit / getCharStagger and the ambient effect layers
// (Grain, ParticleField, FloatingShapes, Spotlight, VignetteGlow, GradientMesh,
// KenBurns, ParallaxLayer, MeshBg, OrbBg) now live in ./lib/motion and are
// imported at the top of this file — shared by every scene below.

// ─── Scene Components ────────────────────────────────────────────────────────

const TitleRevealScene: React.FC<{ scene: MotionGraphicScene; palette: typeof PALETTES.midnight }> = ({ scene, palette }) => {
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();
    // Per-scene colors only apply when explicitly customized (scene.customColors)
    // — otherwise every scene follows the project's global theme palette.
    const colors = scene.customColors ? { ...palette, ...scene.colors } : palette;
    const subtextAnim = getEntrance(frame, fps, 'slide-up', 0.7);
    const lineWidth = interpolate(frame, [fps * 0.4, fps * 1.5], [0, 320], { extrapolateRight: 'clamp' });
    // Per-character kinetic reveal of the headline (falls back gracefully for long strings).
    const headline = scene.headline || '';
    const useCharStagger = headline.length > 0 && headline.length <= 42;
    const headlineAnim = getEntrance(frame, fps, scene.animation || 'blur-in', 0.2);
    return (
        <AbsoluteFill style={{ background: colors.bg || palette.bg, overflow: 'hidden' }}>
            <GradientMesh color={colors.accent} secondary={colors.secondary || colors.accent} bg={colors.bg || palette.bg} />
            <FloatingShapes color={colors.accent} secondary={colors.secondary || colors.accent} seed={4} />
            <OrbBg color={colors.accent} secondary={colors.secondary || colors.accent} frame={frame} fps={fps} />
            <MeshBg color={colors.accent} />
            {scene.imageUrl && (
                <KenBurns durationSec={(scene.durationSec || 5) + 1}>
                    <Img src={scene.imageUrl} style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'brightness(0.2) blur(4px)' }} />
                </KenBurns>
            )}
            <ParticleField color={colors.secondary || colors.accent} count={22} seed={9} />
            <div style={{ position: 'relative', zIndex: 2, textAlign: 'center', padding: '10%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                {scene.subtext && <div style={{ ...getEntrance(frame, fps, 'fade', 0.1), fontSize: 22, fontWeight: 600, letterSpacing: 8, textTransform: 'uppercase', color: colors.accent, marginBottom: 28 }}>{scene.subtext}</div>}
                <div style={{ ...(useCharStagger ? {} : headlineAnim), fontSize: 96, fontWeight: 900, color: colors.text, lineHeight: 1.0, letterSpacing: '-3px', textShadow: `0 0 80px ${colors.accent}40` }}>
                    {useCharStagger
                        ? headline.split('').map((ch, i) => (
                            <span key={i} style={getCharStagger(frame, fps, i, 0.2)}>{ch === ' ' ? ' ' : ch}</span>
                          ))
                        : headline}
                </div>
                <div style={{ width: lineWidth, height: 5, background: `linear-gradient(90deg, transparent, ${colors.accent}, ${colors.secondary || colors.accent}, transparent)`, margin: '36px auto', borderRadius: 3 }} />
                <div style={{ ...subtextAnim, fontSize: 28, color: `${colors.text}88`, fontWeight: 400 }}>{scene.content || ''}</div>
            </div>
            <VignetteGlow color={colors.accent} />
            <Grain />
        </AbsoluteFill>
    );
};

const KineticTextScene: React.FC<{ scene: MotionGraphicScene; palette: typeof PALETTES.midnight }> = ({
    scene, palette
}) => {
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();
    // Per-scene colors only apply when explicitly customized (scene.customColors)
    // — otherwise every scene follows the project's global theme palette.
    const colors = scene.customColors ? { ...palette, ...scene.colors } : palette;
    const words = (scene.headline || scene.content || '').split(' ');

    return (
        <AbsoluteFill style={{ background: colors.bg || palette.gradient, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '16px 24px', padding: '10%', maxWidth: '85%' }}>
                {words.map((word, i) => {
                    const wordAnim = getEntrance(frame, fps, 'slide-up', 0.15 + i * 0.12);
                    const isAccent = i % 4 === 2;
                    return (
                        <span key={i} style={{
                            ...wordAnim,
                            fontSize: 72,
                            fontWeight: isAccent ? 900 : 700,
                            color: isAccent ? colors.accent : colors.text,
                            display: 'inline-block',
                        }}>
                            {word}
                        </span>
                    );
                })}
            </div>
        </AbsoluteFill>
    );
};

const SearchRevealScene: React.FC<{ scene: MotionGraphicScene; palette: typeof PALETTES.midnight }> = ({ scene, palette }) => {
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();
    // Per-scene colors only apply when explicitly customized (scene.customColors)
    // — otherwise every scene follows the project's global theme palette.
    const colors = scene.customColors ? { ...palette, ...scene.colors } : palette;
    const query = scene.query || scene.headline || 'AI Video Generation';
    const typingDuration = fps * 1.8;
    const charsToShow = Math.floor(interpolate(frame, [10, 10 + typingDuration], [0, query.length], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }));
    const isTypingDone = frame > (10 + typingDuration);
    const showResults = frame > fps * 2.8;
    const barTop = showResults ? '18%' : '50%';
    const resultsAnim = getEntrance(frame, fps, 'scale', 2.8);
    return (
        <AbsoluteFill style={{ background: colors.bg || palette.bg, overflow: 'hidden' }}>
            <OrbBg color={colors.accent} secondary={colors.secondary || colors.accent} frame={frame} fps={fps} />
            <MeshBg color={colors.accent} />
            {/* Floating search bar */}
            <div style={{ position: 'absolute', top: barTop, left: '50%', transform: 'translate(-50%, -50%)', width: '65%', transition: 'top 0.7s cubic-bezier(0.34, 1.56, 0.64, 1)', zIndex: 2 }}>
                <div style={{ background: 'rgba(255,255,255,0.97)', borderRadius: 60, padding: '22px 40px', display: 'flex', alignItems: 'center', gap: 20, boxShadow: `0 30px 60px rgba(0,0,0,0.4), 0 0 0 3px ${colors.accent}50` }}>
                    <span style={{ fontSize: 36 }}>🔍</span>
                    <span style={{ fontSize: 38, color: '#1a1a1a', fontWeight: 600, flex: 1 }}>
                        {query.substring(0, charsToShow)}
                        {!isTypingDone && <span style={{ opacity: frame % 18 < 9 ? 1 : 0, color: colors.accent }}>|</span>}
                    </span>
                    {isTypingDone && <div style={{ background: colors.accent, color: '#fff', borderRadius: 30, padding: '8px 20px', fontSize: 22, fontWeight: 700, whiteSpace: 'nowrap' }}>Search</div>}
                </div>
            </div>
            {/* Results */}
            {showResults && (
                <div style={{ ...resultsAnim, position: 'absolute', top: '38%', left: '50%', transform: 'translateX(-50%)', width: '80%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 32, zIndex: 2 }}>
                    <div style={{ fontSize: 60, fontWeight: 900, color: colors.text, textAlign: 'center', textShadow: `0 0 40px ${colors.accent}60` }}>
                        {scene.subtext || scene.headline || 'Result'}
                    </div>
                    {scene.imageUrl && (
                        <div style={{ width: '100%', height: 420, borderRadius: 32, overflow: 'hidden', boxShadow: `0 40px 80px ${colors.accent}50`, border: `3px solid ${colors.accent}40` }}>
                            <Img src={scene.imageUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        </div>
                    )}
                </div>
            )}
        </AbsoluteFill>
    );
};

const FeatureListScene: React.FC<{ scene: MotionGraphicScene; palette: typeof PALETTES.midnight }> = ({
    scene, palette
}) => {
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();
    // Per-scene colors only apply when explicitly customized (scene.customColors)
    // — otherwise every scene follows the project's global theme palette.
    const colors = scene.customColors ? { ...palette, ...scene.colors } : palette;
    const items = scene.items && scene.items.length > 0 ? scene.items : (
        scene.headline ? [
            { icon: '✦', label: scene.headline },
            ...(scene.subtext ? [{ icon: '→', label: scene.subtext }] : []),
            ...(scene.content ? [{ icon: '◆', label: scene.content }] : []),
        ] : [{ icon: '✦', label: 'Key Highlights' }]
    );
    const titleAnim = getEntrance(frame, fps, 'fade', 0.1);
    
    // Mouse cursor animation steps down the list
    const activeIndex = Math.floor(interpolate(frame, [fps * 1.5, fps * 4], [0, items.length], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }));

    return (
        <AbsoluteFill style={{ background: colors.bg || palette.gradient, padding: '8%', display: 'flex', flexDirection: scene.imageUrl ? 'row' : 'column', alignItems: 'center', justifyContent: 'center', gap: scene.imageUrl ? '5%' : 0 }}>
            {/* Background Glow */}
            <div style={{ position: 'absolute', width: '100%', height: '100%', background: `radial-gradient(circle at 50% 50%, ${colors.accent}15 0%, transparent 60%)`, zIndex: 0 }} />
            
            <div style={{ flex: scene.imageUrl ? 1 : 'none', display: 'flex', flexDirection: 'column', alignItems: scene.imageUrl ? 'flex-start' : 'center', width: scene.imageUrl ? 'auto' : '60%', zIndex: 1 }}>
                {scene.headline && (
                    <div style={{ ...titleAnim, fontSize: 52, fontWeight: 800, color: colors.accent, marginBottom: 40, textAlign: scene.imageUrl ? 'left' : 'center', textShadow: `0 4px 20px ${colors.accent}40` }}>
                        {scene.headline}
                    </div>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 24, width: '100%', position: 'relative' }}>
                    {items.map((item, i) => {
                        const itemAnim = getEntrance(frame, fps, 'slide-left', 0.3 + i * 0.15);
                        const isActive = i === activeIndex && frame > fps * 1.5;
                        
                        return (
                            <div key={i} style={{ ...itemAnim, 
                                background: isActive ? `${colors.accent}20` : 'rgba(255,255,255,0.05)', 
                                border: `2px solid ${isActive ? colors.accent : 'rgba(255,255,255,0.1)'}`,
                                padding: '24px 32px', borderRadius: 24, display: 'flex', alignItems: 'center', gap: 24,
                                transform: `scale(${isActive ? 1.05 : 1})`, transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                                boxShadow: isActive ? `0 20px 40px ${colors.accent}40` : 'none',
                                backdropFilter: 'blur(10px)'
                            }}>
                                <SmartIcon name={item.icon} color={isActive ? colors.accent : '#fff'} size={40} />
                                <div style={{ fontSize: 32, fontWeight: 600, color: '#fff', opacity: isActive ? 1 : 0.9 }}>{item.label}</div>
                            </div>
                        );
                    })}
                    
                    {/* Animated Mouse Cursor */}
                    {frame > fps * 1.0 && (
                        <div style={{
                            position: 'absolute',
                            left: scene.imageUrl ? '110%' : '60%',
                            top: Math.min(activeIndex, items.length - 1) * 115 + 40,
                            width: 50, height: 50,
                            zIndex: 10,
                            transform: `translate(${Math.sin(frame / 15) * 15}px, ${Math.cos(frame / 15) * 15}px)`,
                            transition: 'top 0.4s cubic-bezier(0.4, 0, 0.2, 1)'
                        }}>
                            <svg viewBox="0 0 24 24" fill="white" stroke="black" strokeWidth="1" style={{ width: '100%', height: '100%', filter: 'drop-shadow(0 8px 12px rgba(0,0,0,0.5))' }}>
                                <path d="M5.5 3.21V20.8c0 .45.54.67.85.35l4.86-4.86a.5.5 0 0 1 .35-.15h6.87a.5.5 0 0 0 .35-.85L5.5 3.21z" />
                            </svg>
                        </div>
                    )}
                </div>
            </div>

            {/* Right side image showcase if available */}
            {scene.imageUrl && (
                <div style={{ flex: 1, height: '80%', zIndex: 1, ...getEntrance(frame, fps, 'scale', 0.6) }}>
                    <div style={{ width: '100%', height: '100%', borderRadius: 40, overflow: 'hidden', boxShadow: `0 40px 80px ${colors.accent}50`, border: `4px solid ${colors.accent}30` }}>
                        <Img src={scene.imageUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    </div>
                </div>
            )}
        </AbsoluteFill>
    );
};

const StatCounterScene: React.FC<{ scene: MotionGraphicScene; palette: typeof PALETTES.midnight }> = ({ scene, palette }) => {
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();
    // Per-scene colors only apply when explicitly customized (scene.customColors)
    // — otherwise every scene follows the project's global theme palette.
    const colors = scene.customColors ? { ...palette, ...scene.colors } : palette;
    const stat: any = scene.stat || scene.items?.[0] || { value: 0, suffix: '', prefix: '', label: '' };
    
    // Robustly parse the stat value from any format (100, "10K", "1,000+", etc.)
    const rawVal = (stat as any).value ?? (stat as any).count ?? 0;
    const numStr = String(rawVal).replace(/[^0-9.]/g, '');
    let targetValue = parseFloat(numStr);
    if (isNaN(targetValue) || targetValue === 0) {
        const fromHeadline = String(scene.headline || '').replace(/[^0-9.]/g, '');
        targetValue = parseFloat(fromHeadline) || 1000;
    }

    const countDuration = fps * 2;
    const progress = interpolate(frame, [fps * 0.3, fps * 0.3 + countDuration], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
    const currentValue = Math.round(targetValue * progress);
    const containerAnim = getEntrance(frame, fps, 'scale', 0.1);
    const labelAnim = getEntrance(frame, fps, 'slide-up', 0.8);

    // Circular progress ring
    const circumference = 2 * Math.PI * 120;
    const strokeDashoffset = circumference * (1 - progress);

    // Animated bar chart data
    const bars = [0.65, 0.45, 0.8, 0.55, 0.9, 0.7, 1.0];
    const barLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

    // Animated line graph points
    const linePoints = [0.3, 0.5, 0.4, 0.7, 0.6, 0.85, 0.75, 1.0];

    return (
        <AbsoluteFill style={{ background: colors.bg || palette.gradient, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
            {scene.imageUrl && (
                <div style={{ position: 'absolute', width: '100%', height: '100%', zIndex: 0 }}>
                    <Img src={scene.imageUrl} style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'brightness(0.15) blur(10px)' }} />
                    <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(to top, ${colors.bg}ee, ${colors.bg}88)` }} />
                </div>
            )}
            <MeshBg color={colors.accent} />
            <FloatingShapes color={colors.accent} secondary={colors.secondary || colors.accent} seed={11} count={3} />
            <div style={{ position: 'relative', zIndex: 2, width: '90%', display: 'flex', gap: 60, alignItems: 'center', justifyContent: 'center' }}>
                {/* Left: Circular progress + stat */}
                <div style={{ ...containerAnim, display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
                    <div style={{ position: 'relative', width: 280, height: 280 }}>
                        <svg viewBox="0 0 260 260" style={{ width: '100%', height: '100%', transform: 'rotate(-90deg)' }}>
                            <circle cx="130" cy="130" r="120" stroke={`${colors.accent}20`} strokeWidth="8" fill="none" />
                            <circle cx="130" cy="130" r="120" stroke={colors.accent} strokeWidth="10" fill="none"
                                strokeDasharray={circumference} strokeDashoffset={strokeDashoffset}
                                strokeLinecap="round" style={{ filter: `drop-shadow(0 0 12px ${colors.accent})` }} />
                        </svg>
                        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                            <div style={{ fontSize: 72, fontWeight: 900, color: colors.accent, fontVariantNumeric: 'tabular-nums', textShadow: `0 0 40px ${colors.accent}60` }}>
                                {stat.prefix || ''}{currentValue.toLocaleString()}{stat.suffix || ''}
                            </div>
                        </div>
                    </div>
                    <div style={{ ...labelAnim, fontSize: 32, color: `${colors.text}cc`, fontWeight: 600, marginTop: 20, textAlign: 'center' }}>
                        {stat.label || scene.subtext || scene.headline || ''}
                    </div>
                </div>

                {/* Right: Bar chart + mini line graph */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 32 }}>
                    {/* Bar chart */}
                    <div style={{ ...getEntrance(frame, fps, 'slide-left', 0.4), background: 'rgba(255,255,255,0.03)', borderRadius: 24, padding: '28px 32px', border: `1px solid ${colors.accent}20` }}>
                        <div style={{ fontSize: 18, color: `${colors.text}88`, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 2, marginBottom: 20 }}>Weekly Performance</div>
                        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, height: 160 }}>
                            {bars.map((h, i) => {
                                const barProgress = interpolate(frame, [fps * 0.5 + i * 4, fps * 1.5 + i * 4], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
                                const barH = h * barProgress * 140;
                                const isHighest = h === 1.0;
                                return (
                                    <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                                        <div style={{ width: '100%', height: barH, borderRadius: 8, background: isHighest
                                            ? `linear-gradient(to top, ${colors.accent}, ${colors.secondary || colors.accent})`
                                            : `linear-gradient(to top, ${colors.accent}60, ${colors.accent}30)`,
                                            boxShadow: isHighest ? `0 0 20px ${colors.accent}60` : 'none',
                                            transition: 'height 0.3s ease' }} />
                                        <div style={{ fontSize: 12, color: `${colors.text}66`, fontWeight: 500 }}>{barLabels[i]}</div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                    {/* Mini line graph */}
                    <div style={{ ...getEntrance(frame, fps, 'slide-left', 0.7), background: 'rgba(255,255,255,0.03)', borderRadius: 24, padding: '28px 32px', border: `1px solid ${colors.accent}20` }}>
                        <div style={{ fontSize: 18, color: `${colors.text}88`, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 2, marginBottom: 16 }}>Growth Trend</div>
                        <svg viewBox="0 0 400 100" style={{ width: '100%', height: 100 }}>
                            <defs>
                                <linearGradient id="lineGrad" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor={colors.accent} stopOpacity="0.3" />
                                    <stop offset="100%" stopColor={colors.accent} stopOpacity="0" />
                                </linearGradient>
                            </defs>
                            {/* Area fill */}
                            <path d={`M0,100 ${linePoints.map((p, i) => {
                                const x = (i / (linePoints.length - 1)) * 400;
                                const y = 100 - p * progress * 90;
                                return `L${x},${y}`;
                            }).join(' ')} L400,100 Z`} fill="url(#lineGrad)" />
                            {/* Line */}
                            <path d={`M${linePoints.map((p, i) => {
                                const x = (i / (linePoints.length - 1)) * 400;
                                const y = 100 - p * progress * 90;
                                return `${x},${y}`;
                            }).join(' L')}`} fill="none" stroke={colors.accent} strokeWidth="3" strokeLinecap="round" />
                            {/* Dots */}
                            {linePoints.map((p, i) => {
                                const x = (i / (linePoints.length - 1)) * 400;
                                const y = 100 - p * progress * 90;
                                const dotAnim = interpolate(frame, [fps * 0.8 + i * 3, fps * 1.2 + i * 3], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
                                return <circle key={i} cx={x} cy={y} r={dotAnim * 5} fill={colors.accent} style={{ filter: `drop-shadow(0 0 4px ${colors.accent})` }} />;
                            })}
                        </svg>
                    </div>
                </div>
            </div>
            <Grain opacity={0.05} />
        </AbsoluteFill>
    );
};

const IconGridScene: React.FC<{ scene: MotionGraphicScene; palette: typeof PALETTES.midnight }> = ({
    scene, palette
}) => {
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();
    // Per-scene colors only apply when explicitly customized (scene.customColors)
    // — otherwise every scene follows the project's global theme palette.
    const colors = scene.customColors ? { ...palette, ...scene.colors } : palette;
    const items = scene.items || [];
    const titleAnim = getEntrance(frame, fps, 'fade', 0.1);

    return (
        <AbsoluteFill style={{ background: colors.bg || palette.gradient, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '8%' }}>
            {scene.headline && (
                <div style={{ ...titleAnim, fontSize: 48, fontWeight: 800, color: colors.text, marginBottom: 60, textAlign: 'center' }}>
                    {scene.headline}
                </div>
            )}
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 40 }}>
                {items.map((item, i) => {
                    const itemAnim = getEntrance(frame, fps, 'bounce', 0.3 + i * 0.15);
                    return (
                        <div key={i} style={{
                            ...itemAnim,
                            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16,
                            padding: '32px 40px', borderRadius: 24,
                            background: `${colors.accent}15`, border: `2px solid ${colors.accent}30`,
                            boxShadow: `0 10px 30px rgba(0,0,0,0.2)`
                        }}>
                            <SmartIcon name={item.icon} color={colors.accent} size={64} />
                            <span style={{ fontSize: 24, color: colors.text, fontWeight: 600 }}>{item.label || ''}</span>
                        </div>
                    );
                })}
            </div>
        </AbsoluteFill>
    );
};

const ComparisonScene: React.FC<{ scene: MotionGraphicScene; palette: typeof PALETTES.midnight }> = ({
    scene, palette
}) => {
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();
    // Per-scene colors only apply when explicitly customized (scene.customColors)
    // — otherwise every scene follows the project's global theme palette.
    const colors = scene.customColors ? { ...palette, ...scene.colors } : palette;
    const items = scene.items || [{ label: 'Before', value: 'The old way' }, { label: 'After', value: 'The new way' }];

    const titleAnim = getEntrance(frame, fps, 'slide-up', 0.1);
    const leftAnim = getEntrance(frame, fps, 'slide-left', 0.3);
    const rightAnim = getEntrance(frame, fps, 'slide-left', 0.6);
    const vsAnim = getEntrance(frame, fps, 'scale', 0.45);

    const beforeItem = items[0] || { label: 'Before', value: 'Traditional approach' };
    const afterItem = items[1] || { label: 'After', value: 'The new way' };

    // Parse description text — split by commas or bullet points for list display
    // (toText coerces number/object/array values to string; imported from ./lib/motion)
    const beforePoints = toText(beforeItem.value).split(/[,•·]/).map(s => s.trim()).filter(Boolean);
    const afterPoints = toText(afterItem.value).split(/[,•·]/).map(s => s.trim()).filter(Boolean);

    return (
        <AbsoluteFill style={{ background: colors.bg || palette.gradient, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', padding: '4% 5%' }}>
            <FloatingShapes color={colors.accent} secondary={colors.secondary || colors.accent} seed={6} count={4} />
            <MeshBg color={colors.accent} />

            {/* Title */}
            {scene.headline && (
                <div style={{ ...titleAnim, fontSize: 42, fontWeight: 800, color: colors.text, textAlign: 'center', marginBottom: 40, zIndex: 2, letterSpacing: '-0.02em' }}>
                    {scene.headline}
                </div>
            )}

            {/* Comparison Cards */}
            <div style={{ display: 'flex', width: '95%', maxWidth: 1600, gap: 60, zIndex: 2, height: '65%' }}>
                {/* Left: Before */}
                <div style={{
                    ...leftAnim, flex: 1, borderRadius: 40,
                    background: 'rgba(255,107,107,0.08)', border: '2px solid rgba(255,107,107,0.3)',
                    padding: '60px 50px', display: 'flex', flexDirection: 'column',
                    boxShadow: '0 20px 50px rgba(255,107,107,0.1)'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginBottom: 40 }}>
                        <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'rgba(255,107,107,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32 }}>❌</div>
                        <div style={{ fontSize: 48, fontWeight: 800, color: '#ff6b6b' }}>{beforeItem.label || 'Before'}</div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                        {beforePoints.length > 0 ? beforePoints.map((pt, i) => {
                            const ptAnim = getEntrance(frame, fps, 'slide-up', 0.5 + i * 0.15);
                            return (
                                <div key={i} style={{ ...ptAnim, display: 'flex', alignItems: 'center', gap: 20 }}>
                                    <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#ff6b6b80', flexShrink: 0 }} />
                                    <div style={{ fontSize: 28, color: '#e2e8f0', lineHeight: 1.4, fontWeight: 500, opacity: 0.85 }}>{pt}</div>
                                </div>
                            );
                        }) : (
                            <div style={{ fontSize: 28, color: '#e2e8f0', lineHeight: 1.6, opacity: 0.8 }}>{beforeItem.value}</div>
                        )}
                    </div>
                </div>

                {/* VS Divider */}
                <div style={{ ...vsAnim, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <div style={{
                        width: 100, height: 100, borderRadius: '50%',
                        background: `linear-gradient(135deg, ${colors.accent}, ${colors.secondary || colors.accent})`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 32, fontWeight: 900, color: '#fff',
                        boxShadow: `0 0 60px ${colors.accent}bb`,
                        border: '4px solid rgba(255,255,255,0.3)',
                    }}>VS</div>
                </div>

                {/* Right: After */}
                <div style={{
                    ...rightAnim, flex: 1, borderRadius: 40,
                    background: `${colors.accent}12`, border: `2px solid ${colors.accent}40`,
                    padding: '60px 50px', display: 'flex', flexDirection: 'column',
                    boxShadow: `0 20px 50px ${colors.accent}15`
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginBottom: 40 }}>
                        <div style={{ width: 64, height: 64, borderRadius: '50%', background: `${colors.accent}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32 }}>✅</div>
                        <div style={{ fontSize: 48, fontWeight: 800, color: colors.accent }}>{afterItem.label || 'After'}</div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                        {afterPoints.length > 0 ? afterPoints.map((pt, i) => {
                            const ptAnim = getEntrance(frame, fps, 'slide-up', 0.7 + i * 0.15);
                            return (
                                <div key={i} style={{ ...ptAnim, display: 'flex', alignItems: 'center', gap: 20 }}>
                                    <div style={{ width: 12, height: 12, borderRadius: '50%', background: `${colors.accent}`, flexShrink: 0 }} />
                                    <div style={{ fontSize: 28, color: colors.text, lineHeight: 1.4, fontWeight: 600 }}>{pt}</div>
                                </div>
                            );
                        }) : (
                            <div style={{ fontSize: 28, color: colors.text, lineHeight: 1.6, fontWeight: 600 }}>{afterItem.value}</div>
                        )}
                    </div>
                </div>
            </div>

            {/* Subtext */}
            {scene.subtext && (
                <div style={{ ...getEntrance(frame, fps, 'slide-up', 1.2), fontSize: 20, color: `${colors.text}66`, textAlign: 'center', marginTop: 36, zIndex: 2 }}>
                    {scene.subtext}
                </div>
            )}
            <VignetteGlow color={colors.accent} />
            <Grain />
        </AbsoluteFill>
    );
};

const ImageShowcaseScene: React.FC<{ scene: MotionGraphicScene; palette: typeof PALETTES.midnight }> = ({
    scene, palette
}) => {
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();
    // Per-scene colors only apply when explicitly customized (scene.customColors)
    // — otherwise every scene follows the project's global theme palette.
    const colors = scene.customColors ? { ...palette, ...scene.colors } : palette;
    const imgAnim = getEntrance(frame, fps, 'scale', 0.1);
    const textAnim = getEntrance(frame, fps, 'slide-up', 0.5);

    const zoom = interpolate(frame, [0, fps * 4], [1, 1.1], { extrapolateRight: 'clamp' });

    return (
        <AbsoluteFill style={{ background: colors.bg || palette.gradient, overflow: 'hidden' }}>
            {scene.imageUrl ? (
                <div style={{ ...imgAnim, position: 'absolute', inset: 0, overflow: 'hidden' }}>
                    <Img src={scene.imageUrl} style={{
                        width: '100%', height: '100%', objectFit: 'cover',
                        transform: `scale(${zoom})`, opacity: 0.8,
                    }} />
                    <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.4) 50%, transparent 100%)' }} />
                </div>
            ) : (
                 <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(circle, ${colors.accent}30 0%, transparent 80%)`, filter: 'blur(100px)' }} />
            )}
            
            <div style={{ position: 'absolute', bottom: '15%', left: '10%', right: '10%', zIndex: 1 }}>
                <div style={{ ...textAnim, padding: '40px', background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(16px)', borderRadius: 32, border: '1px solid rgba(255,255,255,0.1)' }}>
                    <div style={{ fontSize: 56, fontWeight: 800, color: '#ffffff', lineHeight: 1.2 }}>
                        {scene.headline || ''}
                    </div>
                    {scene.subtext && (
                        <div style={{ fontSize: 28, color: `rgba(255,255,255,0.8)`, marginTop: 16 }}>{scene.subtext}</div>
                    )}
                </div>
            </div>
        </AbsoluteFill>
    );
};

const CallToActionScene: React.FC<{ scene: MotionGraphicScene; palette: typeof PALETTES.midnight }> = ({
    scene, palette
}) => {
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();
    // Per-scene colors only apply when explicitly customized (scene.customColors)
    // — otherwise every scene follows the project's global theme palette.
    const colors = scene.customColors ? { ...palette, ...scene.colors } : palette;
    const headlineAnim = getEntrance(frame, fps, 'scale', 0.2);
    const btnAnim = getEntrance(frame, fps, 'bounce', 0.6);

    const pulse = interpolate(frame % (fps * 1.5), [0, fps * 0.75, fps * 1.5], [1, 1.08, 1]);

    return (
        <AbsoluteFill style={{ background: colors.bg || palette.gradient, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ position: 'absolute', width: '60%', height: '60%', background: `radial-gradient(circle, ${colors.accent}40 0%, transparent 70%)`, borderRadius: '50%', filter: 'blur(120px)' }} />
            <div style={{ textAlign: 'center', zIndex: 1, padding: '10%' }}>
                <div style={{ ...headlineAnim, fontSize: 72, fontWeight: 900, color: colors.text, lineHeight: 1.2, textShadow: `0 4px 20px ${colors.accent}40` }}>
                    {scene.headline || 'Get Started Now'}
                </div>
                <div style={{ ...btnAnim, marginTop: 60, display: 'inline-block', transform: `scale(${pulse})` }}>
                    <div style={{
                        padding: '24px 64px', borderRadius: 60, fontSize: 32, fontWeight: 800,
                        background: `linear-gradient(135deg, ${colors.accent}, ${colors.secondary || colors.accent})`,
                        color: '#ffffff', boxShadow: `0 10px 40px ${colors.accent}60`,
                        border: '2px solid rgba(255,255,255,0.2)'
                    }}>
                        {scene.subtext || 'Learn More →'}
                    </div>
                </div>
            </div>
        </AbsoluteFill>
    );
};

const LogoRevealScene: React.FC<{ scene: MotionGraphicScene; palette: typeof PALETTES.midnight }> = ({
    scene, palette
}) => {
    const frame = useCurrentFrame();
    const { fps, width, height } = useVideoConfig();
    // Per-scene colors only apply when explicitly customized (scene.customColors)
    // — otherwise every scene follows the project's global theme palette.
    const colors = scene.customColors ? { ...palette, ...scene.colors } : palette;
    const accent = colors.accent || '#a855f7';

    // ── Core timing ──────────────────────────────────────────────────────────
    const logoScale  = spring({ frame, fps, config: { damping: 14, stiffness: 70 } });
    const logoOpacity = interpolate(frame, [0, fps * 0.3], [0, 1], { extrapolateRight: 'clamp' });

    // ── Background breathing glow ─────────────────────────────────────────────
    const bgGlow = 0.6 + Math.sin(frame * 0.06) * 0.25;
    const bgScale = 1 + Math.sin(frame * 0.04) * 0.08;

    // ── Shimmer sweep across the logo ─────────────────────────────────────────
    const shimmerX = interpolate(frame, [fps * 0.5, fps * 1.5], [-600, 1200], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

    // ── 5 expanding rings ─────────────────────────────────────────────────────
    const rings = [0, 0.4, 0.8, 1.2, 1.6].map((delay, idx) => {
        const ringFrame = Math.max(0, frame - delay * fps);
        const ringScale  = spring({ frame: ringFrame, fps, config: { damping: 18, stiffness: 40 } });
        const ringOpacity = interpolate(ringFrame, [0, fps * 0.5, fps * 2], [0, 0.6 - idx * 0.1, 0], { extrapolateRight: 'clamp' });
        return { scale: ringScale, opacity: ringOpacity, size: 420 + idx * 120 };
    });

    // ── 8 orbiting particles ──────────────────────────────────────────────────
    const orbitRadius = 320;
    const particles = Array.from({ length: 8 }, (_, i) => {
        const angle = (i / 8) * Math.PI * 2 + frame * 0.025;
        const particleOpacity = interpolate(frame, [fps * 0.8, fps * 1.4], [0, 1], { extrapolateRight: 'clamp' });
        const pulse = 0.6 + Math.sin(frame * 0.1 + i) * 0.4;
        return {
            x: Math.cos(angle) * orbitRadius,
            y: Math.sin(angle) * orbitRadius,
            opacity: particleOpacity * pulse,
            size: 6 + (i % 3) * 4,
        };
    });

    // ── Subtext ───────────────────────────────────────────────────────────────
    const subtextOpacity   = interpolate(frame, [fps * 1.2, fps * 1.8], [0, 1], { extrapolateRight: 'clamp' });
    const subtextTranslate = interpolate(frame, [fps * 1.2, fps * 1.8], [30, 0], { extrapolateRight: 'clamp' });

    return (
        <AbsoluteFill style={{ background: colors.bg || '#050510', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>

            {/* Deep background ambient glow */}
            <div style={{ position: 'absolute', width: '90%', height: '90%', background: `radial-gradient(circle, ${accent}${Math.round(bgGlow * 40).toString(16).padStart(2,'0')} 0%, transparent 65%)`, filter: 'blur(120px)', transform: `scale(${bgScale})` }} />

            {/* 5 expanding rings */}
            {rings.map((ring, i) => (
                <div key={i} style={{ position: 'absolute', width: ring.size, height: ring.size, borderRadius: '50%', border: `${2 - i * 0.3}px solid ${accent}`, opacity: ring.opacity, transform: `scale(${ring.scale})` }} />
            ))}

            {/* 8 orbiting particles */}
            {particles.map((p, i) => (
                <div key={i} style={{ position: 'absolute', width: p.size, height: p.size, borderRadius: '50%', background: i % 2 === 0 ? accent : `${accent}80`, opacity: p.opacity, transform: `translate(${p.x}px, ${p.y}px)`, boxShadow: `0 0 ${p.size * 3}px ${accent}80` }} />
            ))}

            {/* Logo image — pixel-perfect, zero Wan distortion */}
            <div style={{ position: 'relative', zIndex: 2, transform: `scale(${logoScale})`, opacity: logoOpacity, overflow: 'hidden' }}>

                {/* Shimmer sweep */}
                <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(105deg, transparent 30%, rgba(255,255,255,0.25) 50%, transparent 70%)`, transform: `translateX(${shimmerX}px)`, pointerEvents: 'none', zIndex: 10 }} />

                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <div style={{
                        width: 520, height: 340,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        filter: `drop-shadow(0 0 50px ${accent}90) drop-shadow(0 0 100px ${accent}50)`,
                    }}>
                        {scene.imageUrl ? (
                            <Img src={scene.imageUrl} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                        ) : (
                            <div style={{ fontSize: 120, fontWeight: 900, color: colors.text || '#fff', letterSpacing: '-4px', textShadow: `0 0 60px ${accent}80` }}>
                                {scene.headline || '✦'}
                            </div>
                        )}
                    </div>

                    {/* Subtext with slide-up */}
                    {scene.subtext && (
                        <div style={{ opacity: subtextOpacity, transform: `translateY(${subtextTranslate}px)`, fontSize: 32, color: `${colors.text || '#fff'}cc`, marginTop: 28, fontWeight: 600, letterSpacing: 6, textTransform: 'uppercase' }}>
                            {scene.subtext}
                        </div>
                    )}
                </div>
            </div>

            {/* Inner glow ring tightly around logo */}
            <div style={{ position: 'absolute', width: 560, height: 380, borderRadius: 32, border: `1px solid ${accent}50`, opacity: 0.4 + Math.sin(frame * 0.08) * 0.2, zIndex: 1 }} />
        </AbsoluteFill>
    );
};


// ─── New Scene Types ─────────────────────────────────────────────────────────

const SplitHeroScene: React.FC<{ scene: MotionGraphicScene; palette: typeof PALETTES.midnight }> = ({ scene, palette }) => {
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();
    // Per-scene colors only apply when explicitly customized (scene.customColors)
    // — otherwise every scene follows the project's global theme palette.
    const colors = scene.customColors ? { ...palette, ...scene.colors } : palette;
    const leftAnim = { opacity: interpolate(frame, [0, fps * 0.6], [0, 1], { extrapolateRight: 'clamp' }), transform: `translateX(${interpolate(frame, [0, fps * 0.6], [-80, 0], { extrapolateRight: 'clamp' })}px)` };
    const rightAnim = { opacity: interpolate(frame, [fps * 0.3, fps * 0.9], [0, 1], { extrapolateRight: 'clamp' }), transform: `translateX(${interpolate(frame, [fps * 0.3, fps * 0.9], [80, 0], { extrapolateRight: 'clamp' })}px)` };
    const lineH = interpolate(frame, [fps * 0.5, fps * 1.5], [0, 100], { extrapolateRight: 'clamp' });
    return (
        <AbsoluteFill style={{ background: colors.bg || palette.bg, display: 'flex', flexDirection: 'row', overflow: 'hidden' }}>
            <div style={{ ...leftAnim, flex: 1, position: 'relative', overflow: 'hidden' }}>
                {scene.imageUrl
                    ? <><Img src={scene.imageUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /><div style={{ position: 'absolute', inset: 0, background: `linear-gradient(to right, transparent 60%, ${colors.bg} 100%)` }} /></>
                    : <div style={{ width: '100%', height: '100%', background: `linear-gradient(135deg, ${colors.accent}40, ${colors.secondary || colors.accent}25)` }} />
                }
            </div>
            <div style={{ ...rightAnim, flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '8%', position: 'relative' }}>
                <div style={{ position: 'absolute', left: 0, top: '10%', width: 4, height: `${lineH}%`, background: `linear-gradient(to bottom, transparent, ${colors.accent}, transparent)`, borderRadius: 2 }} />
                {scene.subtext && <div style={{ fontSize: 20, letterSpacing: 5, textTransform: 'uppercase', color: colors.accent, marginBottom: 24, fontWeight: 600 }}>{scene.subtext}</div>}
                <div style={{ fontSize: 68, fontWeight: 900, color: colors.text, lineHeight: 1.1, letterSpacing: '-2px' }}>{scene.headline || ''}</div>
                {scene.content && <div style={{ fontSize: 26, color: '#fff', opacity: 0.75, marginTop: 28, lineHeight: 1.6 }}>{scene.content}</div>}
                {scene.items && scene.items.length > 0 && (
                    <div style={{ display: 'flex', gap: 16, marginTop: 40, flexWrap: 'wrap' }}>
                        {scene.items.map((item, i) => (
                            <div key={i} style={{ padding: '12px 24px', borderRadius: 50, background: `${colors.accent}20`, border: `1px solid ${colors.accent}40`, color: colors.accent, fontWeight: 700, fontSize: 22 }}>
                                {item.icon && <SmartIcon name={item.icon} size={24} color={colors.accent} style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 8 }} />}{item.label}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </AbsoluteFill>
    );
};

const NeonGlowScene: React.FC<{ scene: MotionGraphicScene; palette: typeof PALETTES.midnight }> = ({ scene, palette }) => {
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();
    // Per-scene colors only apply when explicitly customized (scene.customColors)
    // — otherwise every scene follows the project's global theme palette.
    const colors = scene.customColors ? { ...palette, ...scene.colors } : palette;
    const flicker = 0.85 + Math.sin(frame * 0.7) * 0.08 + Math.sin(frame * 1.3) * 0.07;
    const headlineAnim = getEntrance(frame, fps, 'scale', 0.2);
    const subtextAnim = getEntrance(frame, fps, 'slide-up', 0.8);
    const scanY = ((frame * 2) % 1200) - 100;
    return (
        <AbsoluteFill style={{ background: '#000000', overflow: 'hidden' }}>
            {scene.imageUrl && <div style={{ position: 'absolute', inset: 0 }}><Img src={scene.imageUrl} style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'brightness(0.15) saturate(2)', mixBlendMode: 'screen' }} /></div>}
            <div style={{ position: 'absolute', inset: 0, backgroundImage: `repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(0,255,200,0.03) 4px)` }} />
            <div style={{ position: 'absolute', left: 0, right: 0, top: scanY, height: 2, background: `linear-gradient(to right, transparent, ${colors.accent}80, transparent)`, filter: `blur(2px)` }} />
            <div style={{ position: 'relative', zIndex: 2, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', textAlign: 'center', padding: '10%' }}>
                <div style={{ ...headlineAnim, fontSize: 88, fontWeight: 900, color: colors.accent, opacity: flicker, letterSpacing: '4px', textShadow: `0 0 20px ${colors.accent}, 0 0 60px ${colors.accent}80, 0 0 120px ${colors.accent}40` }}>
                    {scene.headline || ''}
                </div>
                {scene.subtext && <div style={{ ...subtextAnim, fontSize: 32, color: '#ffffff99', marginTop: 32, fontWeight: 400, letterSpacing: 2, textShadow: `0 0 10px ${colors.accent}50` }}>{scene.subtext}</div>}
            </div>
        </AbsoluteFill>
    );
};

const GradientBurstScene: React.FC<{ scene: MotionGraphicScene; palette: typeof PALETTES.midnight }> = ({ scene, palette }) => {
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();
    // Per-scene colors only apply when explicitly customized (scene.customColors)
    // — otherwise every scene follows the project's global theme palette.
    const colors = scene.customColors ? { ...palette, ...scene.colors } : palette;
    const burst = spring({ frame, fps, config: { damping: 15, stiffness: 50 } });
    const headlineAnim = getEntrance(frame, fps, 'scale', 0.3);
    return (
        <AbsoluteFill style={{ background: colors.bg || palette.bg, overflow: 'hidden' }}>
            <div style={{ position: 'absolute', inset: 0, background: `conic-gradient(from ${frame * 0.3}deg at 50% 50%, ${colors.bg} 0deg, ${colors.accent}35 90deg, ${colors.secondary || colors.accent}20 180deg, ${colors.bg} 270deg, ${colors.accent}20 340deg, ${colors.bg} 360deg)`, transform: `scale(${burst * 1.3})` }} />
            {scene.imageUrl && <div style={{ position: 'absolute', inset: 0 }}><Img src={scene.imageUrl} style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'brightness(0.2)', mixBlendMode: 'luminosity' }} /></div>}
            <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(circle at 50% 50%, ${colors.accent}30 0%, transparent 65%)` }} />
            <div style={{ position: 'relative', zIndex: 2, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', textAlign: 'center', padding: '12%' }}>
                <div style={{ ...headlineAnim, fontSize: 90, fontWeight: 900, color: colors.text, lineHeight: 1.05, letterSpacing: '-2px', textShadow: `0 0 60px ${colors.accent}80` }}>{scene.headline || ''}</div>
                {scene.subtext && <div style={{ ...getEntrance(frame, fps, 'slide-up', 0.8), fontSize: 36, color: colors.accent, marginTop: 32, fontWeight: 600 }}>{scene.subtext}</div>}
            </div>
        </AbsoluteFill>
    );
};

const BentoGridScene: React.FC<{ scene: MotionGraphicScene; palette: typeof PALETTES.midnight }> = ({ scene, palette }) => {
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();
    // Per-scene colors only apply when explicitly customized (scene.customColors)
    // — otherwise every scene follows the project's global theme palette.
    const colors = scene.customColors ? { ...palette, ...scene.colors } : palette;
    const items = scene.items && scene.items.length >= 3 ? scene.items : [
        { label: 'Cinematic', value: '100%' },
        { label: 'Quality', value: '8K' },
        { label: 'Speed', value: 'Ultra' }
    ];
    
    return (
        <AbsoluteFill style={{ background: colors.bg || palette.bg, padding: '5%', display: 'flex', flexDirection: 'column' }}>
            <GradientMesh color={colors.accent} secondary={colors.secondary || colors.accent} bg={colors.bg || palette.bg} />
            <FloatingShapes color={colors.accent} secondary={colors.secondary || colors.accent} seed={8} count={3} />
            {scene.headline && (
                <div style={{ ...getEntrance(frame, fps, 'slide-up', 0.1), fontSize: 64, fontWeight: 900, color: colors.text, marginBottom: 40, textAlign: 'center', zIndex: 2 }}>
                    {scene.headline}
                </div>
            )}
            <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gridTemplateRows: 'repeat(2, 1fr)', gap: 32, position: 'relative', zIndex: 2 }}>
                {/* Main large cell */}
                <div style={{ ...getEntrance(frame, fps, 'scale', 0.2), gridColumn: '1 / 3', gridRow: '1 / 3', background: `${colors.accent}15`, borderRadius: 40, padding: 50, position: 'relative', overflow: 'hidden', border: `2px solid ${colors.accent}40`, boxShadow: `0 30px 60px rgba(0,0,0,0.4)` }}>
                    {scene.imageUrl && <div style={{ position: 'absolute', inset: 0 }}><Img src={scene.imageUrl} style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.6 }} /></div>}
                    <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(to top, ${colors.bg} 0%, transparent 100%)` }} />
                    <div style={{ position: 'absolute', bottom: 50, left: 50, right: 50, zIndex: 2 }}>
                        <div style={{ fontSize: 56, fontWeight: 900, color: colors.text, marginBottom: 20, letterSpacing: '-0.03em' }}>{scene.subtext || 'Premium Experience'}</div>
                        <div style={{ fontSize: 28, color: `#fff`, opacity: 0.8, lineHeight: 1.4 }}>{scene.content || 'Engineered for high-performance production.'}</div>
                    </div>
                </div>
                {/* Smaller cells */}
                {items.slice(0, 2).map((item, i) => (
                    <div key={i} style={{ ...getEntrance(frame, fps, 'slide-left', 0.4 + i * 0.2), background: `rgba(255,255,255,0.04)`, borderRadius: 40, padding: 40, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', border: `2px solid rgba(255,255,255,0.08)`, backdropFilter: 'blur(20px)', boxShadow: '0 20px 40px rgba(0,0,0,0.2)' }}>
                        <div style={{ marginBottom: 24, padding: 24, borderRadius: '50%', background: `${colors.accent}20`, border: `1px solid ${colors.accent}40` }}>
                            <SmartIcon name={item.icon || item.value} color={colors.accent} size={64} />
                        </div>
                        <div style={{ fontSize: 24, color: `#fff`, opacity: 0.7, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 3, textAlign: 'center' }}>{item.label}</div>
                        {item.value && <div style={{ fontSize: 32, color: colors.accent, fontWeight: 900, marginTop: 12 }}>{item.value}</div>}
                    </div>
                ))}
            </div>
        </AbsoluteFill>
    );
};

const VideoHeroScene: React.FC<{ scene: MotionGraphicScene; palette: typeof PALETTES.midnight }> = ({ scene, palette }) => {
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();
    // Per-scene colors only apply when explicitly customized (scene.customColors)
    // — otherwise every scene follows the project's global theme palette.
    const colors = scene.customColors ? { ...palette, ...scene.colors } : palette;
    return (
        <AbsoluteFill style={{ background: '#000', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', inset: 0 }}>
                {scene.imageUrl ? <Img src={scene.imageUrl} style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'brightness(0.4)' }} /> : <div style={{ width: '100%', height: '100%', background: `radial-gradient(circle, ${colors.accent}40 0%, #000 80%)` }} />}
            </div>
            <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', textAlign: 'center', padding: '10%' }}>
                <div style={{ ...getEntrance(frame, fps, 'scale', 0.3), fontSize: 110, fontWeight: 900, color: '#fff', lineHeight: 1.1, letterSpacing: '-4px', textShadow: `0 20px 60px ${colors.accent}80` }}>
                    {scene.headline}
                </div>
                {scene.subtext && <div style={{ ...getEntrance(frame, fps, 'slide-up', 0.8), fontSize: 36, color: 'rgba(255,255,255,0.8)', marginTop: 40, maxWidth: '80%' }}>{scene.subtext}</div>}
            </div>
        </AbsoluteFill>
    );
};

const PhoneMockupScene: React.FC<{ scene: MotionGraphicScene; palette: typeof PALETTES.midnight }> = ({ scene, palette }) => {
    const frame = useCurrentFrame(); const { fps } = useVideoConfig(); const colors = { ...palette, ...scene.colors };
    const phoneAnim = getEntrance(frame, fps, 'slide-up', 0.2);
    const screenGlow = interpolate(frame, [fps * 0.8, fps * 2], [0, 1], { extrapolateRight: 'clamp' });
    return (
        <AbsoluteFill style={{ background: colors.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
            <GradientMesh color={colors.accent} secondary={colors.secondary || colors.accent} bg={colors.bg} />
            <OrbBg color={colors.accent} secondary={colors.secondary || colors.accent} frame={frame} fps={fps} />
            <ParticleField color={colors.secondary || colors.accent} count={18} seed={12} />
            <ParallaxLayer depth={1.2} style={{ ...phoneAnim, width: 380, height: 780, borderRadius: 50, border: `4px solid rgba(255,255,255,0.2)`, background: '#111', padding: 12, boxShadow: `0 40px 100px ${colors.accent}40, 0 0 0 1px rgba(255,255,255,0.05)`, position: 'relative', zIndex: 2 }}>
                <div style={{ width: '100%', height: '100%', borderRadius: 38, overflow: 'hidden', position: 'relative' }}>
                    {scene.imageUrl ? <Img src={scene.imageUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <div style={{ width: '100%', height: '100%', background: `linear-gradient(180deg, ${colors.accent}30, ${colors.bg})`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><div style={{ fontSize: 48, fontWeight: 800, color: colors.text, textAlign: 'center', padding: 32 }}>{scene.headline}</div></div>}
                </div>
                <div style={{ position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)', width: 120, height: 28, borderRadius: 20, background: '#000' }} />
                {/* Screen glow */}
                <div style={{ position: 'absolute', inset: 12, borderRadius: 38, boxShadow: `inset 0 0 60px ${colors.accent}${Math.round(screenGlow * 40).toString(16).padStart(2, '0')}`, pointerEvents: 'none' }} />
            </ParallaxLayer>
            {scene.subtext && <div style={{ position: 'absolute', bottom: '12%', textAlign: 'center', zIndex: 3, ...getEntrance(frame, fps, 'fade', 1.2) }}><div style={{ fontSize: 36, fontWeight: 700, color: colors.text }}>{scene.subtext}</div></div>}
            <VignetteGlow color={colors.accent} />
            <Grain />
        </AbsoluteFill>
    );
};

const BrowserMockupScene: React.FC<{ scene: MotionGraphicScene; palette: typeof PALETTES.midnight }> = ({ scene, palette }) => {
    const frame = useCurrentFrame(); const { fps } = useVideoConfig(); const colors = { ...palette, ...scene.colors };
    const browserAnim = getEntrance(frame, fps, 'scale', 0.2);
    return (
        <AbsoluteFill style={{ background: colors.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '8%', overflow: 'hidden' }}>
            <MeshBg color={colors.accent} />
            <div style={{ ...browserAnim, width: '90%', maxHeight: '80%', borderRadius: 20, overflow: 'hidden', boxShadow: `0 40px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.1)` }}>
                <div style={{ background: '#1a1a1a', padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ display: 'flex', gap: 8 }}>{['#ff5f57','#febc2e','#28c840'].map((c,i) => <div key={i} style={{ width: 14, height: 14, borderRadius: '50%', background: c }} />)}</div>
                    <div style={{ flex: 1, background: '#2a2a2a', borderRadius: 8, padding: '8px 16px', fontSize: 16, color: '#888', marginLeft: 12 }}>{scene.query || scene.headline || 'app.migoo.ai'}</div>
                </div>
                <div style={{ background: '#0d0d0d', minHeight: 500, position: 'relative' }}>
                    {scene.imageUrl ? <Img src={scene.imageUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <div style={{ padding: '10%', textAlign: 'center' }}><div style={{ fontSize: 56, fontWeight: 900, color: colors.text }}>{scene.headline}</div>{scene.subtext && <div style={{ fontSize: 28, color: colors.accent, marginTop: 20 }}>{scene.subtext}</div>}</div>}
                </div>
            </div>
        </AbsoluteFill>
    );
};

const TimelineScene: React.FC<{ scene: MotionGraphicScene; palette: typeof PALETTES.midnight }> = ({ scene, palette }) => {
    const frame = useCurrentFrame(); const { fps } = useVideoConfig(); const colors = { ...palette, ...scene.colors };
    const items = scene.items?.length ? scene.items : [{ label: 'Step 1', value: 'Launch' }, { label: 'Step 2', value: 'Grow' }, { label: 'Step 3', value: 'Scale' }];
    const lineProgress = interpolate(frame, [fps * 0.3, fps * 3], [0, 100], { extrapolateRight: 'clamp' });
    return (
        <AbsoluteFill style={{ background: colors.bg, padding: '8%', display: 'flex', flexDirection: 'column', justifyContent: 'center', overflow: 'hidden' }}>
            {scene.headline && <div style={{ ...getEntrance(frame, fps, 'fade', 0.1), fontSize: 52, fontWeight: 800, color: colors.text, textAlign: 'center', marginBottom: 60 }}>{scene.headline}</div>}
            <div style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 5%' }}>
                <div style={{ position: 'absolute', top: '50%', left: '5%', right: '5%', height: 4, background: `${colors.accent}20` }}><div style={{ height: '100%', width: `${lineProgress}%`, background: `linear-gradient(90deg, ${colors.accent}, ${colors.secondary || colors.accent})`, borderRadius: 2 }} /></div>
                {items.map((item, i) => { const dotAnim = getEntrance(frame, fps, 'scale', 0.5 + i * 0.4); return (
                    <div key={i} style={{ ...dotAnim, textAlign: 'center', zIndex: 1, flex: 1 }}>
                        <div style={{ width: 60, height: 60, borderRadius: '50%', background: `linear-gradient(135deg, ${colors.accent}, ${colors.secondary || colors.accent})`, margin: '0 auto 20px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 0 30px ${colors.accent}60` }}>
                            <SmartIcon name={item.icon} color="#fff" size={28} />
                        </div>
                        <div style={{ fontSize: 28, fontWeight: 700, color: colors.text }}>{item.label}</div>
                        {item.value && <div style={{ fontSize: 18, color: `${colors.text}88`, marginTop: 8 }}>{item.value}</div>}
                    </div>
                ); })}
            </div>
        </AbsoluteFill>
    );
};

const TestimonialScene: React.FC<{ scene: MotionGraphicScene; palette: typeof PALETTES.midnight }> = ({ scene, palette }) => {
    const frame = useCurrentFrame(); const { fps } = useVideoConfig(); const colors = { ...palette, ...scene.colors };
    const cardAnim = getEntrance(frame, fps, 'scale', 0.2);
    return (
        <AbsoluteFill style={{ background: colors.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
            <OrbBg color={colors.accent} secondary={colors.secondary || colors.accent} frame={frame} fps={fps} />
            <div style={{ ...cardAnim, maxWidth: '75%', padding: 60, borderRadius: 40, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', backdropFilter: 'blur(20px)', zIndex: 1 }}>
                <div style={{ fontSize: 80, color: colors.accent, lineHeight: 0.5, marginBottom: 20 }}>"</div>
                <div style={{ fontSize: 38, fontWeight: 600, color: colors.text, lineHeight: 1.6, fontStyle: 'italic' }}>{scene.content || scene.headline || 'This product changed everything for us.'}</div>
                <div style={{ marginTop: 32, display: 'flex', alignItems: 'center', gap: 20 }}>
                    {scene.imageUrl && <div style={{ width: 64, height: 64, borderRadius: '50%', overflow: 'hidden', border: `3px solid ${colors.accent}` }}><Img src={scene.imageUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /></div>}
                    <div><div style={{ fontSize: 24, fontWeight: 700, color: colors.accent }}>{scene.subtext || 'Happy Customer'}</div><div style={{ fontSize: 18, color: `${colors.text}88` }}>{scene.headline || ''}</div></div>
                </div>
            </div>
        </AbsoluteFill>
    );
};

const MetricDashboardScene: React.FC<{ scene: MotionGraphicScene; palette: typeof PALETTES.midnight }> = ({ scene, palette }) => {
    const frame = useCurrentFrame(); const { fps } = useVideoConfig(); const colors = { ...palette, ...scene.colors };
    const items = scene.items?.length ? scene.items : [{ icon: '📈', label: 'Revenue', value: '$2.4M' }, { icon: '👥', label: 'Users', value: '150K' }, { icon: '⭐', label: 'Rating', value: '4.9' }, { icon: '🚀', label: 'Growth', value: '+340%' }];

    // Percentage values for donut charts (derived from item index for visual variety)
    const percents = [0.78, 0.92, 0.65, 0.88];

    return (
        <AbsoluteFill style={{ background: colors.bg, padding: '5%', display: 'flex', flexDirection: 'column', justifyContent: 'center', overflow: 'hidden' }}>
            <MeshBg color={colors.accent} />
            <OrbBg color={colors.accent} secondary={colors.secondary || colors.accent} frame={frame} fps={fps} />
            {scene.headline && <div style={{ ...getEntrance(frame, fps, 'slide-up', 0.1), fontSize: 48, fontWeight: 800, color: colors.text, textAlign: 'center', marginBottom: 48, zIndex: 1 }}>{scene.headline}</div>}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 28, zIndex: 1 }}>
                {items.map((item, i) => {
                    const a = getEntrance(frame, fps, 'scale', 0.3 + i * 0.15);
                    const pct = percents[i % percents.length];
                    const animPct = interpolate(frame, [fps * (0.5 + i * 0.2), fps * (1.5 + i * 0.2)], [0, pct], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
                    const circ = 2 * Math.PI * 36;
                    const offset = circ * (1 - animPct);
                    // Mini sparkline data
                    const sparkData = [0.3, 0.5, 0.4, 0.7, 0.6, 0.8, 0.75, 1.0].map(v => v * animPct);

                    return (
                        <div key={i} style={{ ...a, background: 'rgba(255,255,255,0.03)', border: `1px solid ${colors.accent}15`, borderRadius: 28, padding: '28px 32px', backdropFilter: 'blur(10px)', display: 'flex', gap: 24, alignItems: 'center' }}>
                            {/* Mini donut chart */}
                            <div style={{ position: 'relative', width: 90, height: 90, flexShrink: 0 }}>
                                <svg viewBox="0 0 80 80" style={{ width: '100%', height: '100%', transform: 'rotate(-90deg)' }}>
                                    <circle cx="40" cy="40" r="36" stroke={`${colors.accent}15`} strokeWidth="6" fill="none" />
                                    <circle cx="40" cy="40" r="36" stroke={colors.accent} strokeWidth="7" fill="none"
                                        strokeDasharray={circ} strokeDashoffset={offset}
                                        strokeLinecap="round" style={{ filter: `drop-shadow(0 0 6px ${colors.accent})` }} />
                                </svg>
                                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    <SmartIcon name={item.icon} color={colors.accent} size={32} />
                                </div>
                            </div>
                            {/* Info + sparkline */}
                            <div style={{ flex: 1 }}>
                                <div style={{ fontSize: 42, fontWeight: 900, color: colors.accent, marginBottom: 4 }}>{item.value}</div>
                                <div style={{ fontSize: 16, color: `${colors.text}77`, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 2, marginBottom: 12 }}>{item.label}</div>
                                {/* Mini sparkline */}
                                <svg viewBox="0 0 200 40" style={{ width: '100%', height: 32 }}>
                                    <defs>
                                        <linearGradient id={`spark${i}`} x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="0%" stopColor={colors.accent} stopOpacity="0.2" />
                                            <stop offset="100%" stopColor={colors.accent} stopOpacity="0" />
                                        </linearGradient>
                                    </defs>
                                    <path d={`M0,40 ${sparkData.map((v, j) => `L${(j / (sparkData.length - 1)) * 200},${40 - v * 35}`).join(' ')} L200,40 Z`} fill={`url(#spark${i})`} />
                                    <path d={`M${sparkData.map((v, j) => `${(j / (sparkData.length - 1)) * 200},${40 - v * 35}`).join(' L')}`} fill="none" stroke={colors.accent} strokeWidth="2" strokeLinecap="round" />
                                </svg>
                                {/* Progress bar */}
                                <div style={{ height: 6, borderRadius: 3, background: `${colors.accent}15`, marginTop: 4 }}>
                                    <div style={{ height: '100%', width: `${animPct * 100}%`, borderRadius: 3, background: `linear-gradient(90deg, ${colors.accent}, ${colors.secondary || colors.accent})`, boxShadow: `0 0 8px ${colors.accent}40` }} />
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
            <Grain opacity={0.05} />
        </AbsoluteFill>
    );
};

const ProcessStepsScene: React.FC<{ scene: MotionGraphicScene; palette: typeof PALETTES.midnight }> = ({ scene, palette }) => {
    const frame = useCurrentFrame(); const { fps } = useVideoConfig(); const colors = { ...palette, ...scene.colors };
    const items = scene.items?.length ? scene.items : [{ label: 'Upload', icon: '📤' }, { label: 'Process', icon: '⚙️' }, { label: 'Export', icon: '🎬' }];
    const activeStep = Math.floor(interpolate(frame, [fps * 0.5, fps * 3.5], [0, items.length], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }));
    return (
        <AbsoluteFill style={{ background: colors.bg, padding: '8%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
            {scene.headline && <div style={{ ...getEntrance(frame, fps, 'fade', 0.1), fontSize: 52, fontWeight: 800, color: colors.text, marginBottom: 60 }}>{scene.headline}</div>}
            <div style={{ display: 'flex', gap: 32, alignItems: 'center' }}>
                {items.map((item, i) => { const isActive = i <= activeStep; return (
                    <React.Fragment key={i}>
                        <div style={{ ...getEntrance(frame, fps, 'bounce', 0.4 + i * 0.3), width: 200, padding: 32, borderRadius: 28, background: isActive ? `${colors.accent}20` : 'rgba(255,255,255,0.03)', border: `2px solid ${isActive ? colors.accent : 'rgba(255,255,255,0.08)'}`, textAlign: 'center', transition: 'all 0.3s', boxShadow: isActive ? `0 20px 40px ${colors.accent}30` : 'none' }}>
                            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
                                <SmartIcon name={item.icon} color={isActive ? colors.accent : '#fff'} size={48} />
                            </div>
                            <div style={{ fontSize: 22, fontWeight: 700, color: isActive ? colors.accent : `${colors.text}88` }}>{item.label}</div>
                        </div>
                        {i < items.length - 1 && <div style={{ fontSize: 32, color: isActive ? colors.accent : `${colors.text}30`, fontWeight: 900 }}>→</div>}
                    </React.Fragment>
                ); })}
            </div>
        </AbsoluteFill>
    );
};

const NotificationStackScene: React.FC<{ scene: MotionGraphicScene; palette: typeof PALETTES.midnight }> = ({ scene, palette }) => {
    const frame = useCurrentFrame(); const { fps } = useVideoConfig(); const colors = { ...palette, ...scene.colors };
    const items = scene.items?.length ? scene.items : [{ icon: '🔔', label: 'New user signed up' }, { icon: '💰', label: 'Payment received: $499' }, { icon: '📈', label: 'Views increased by 200%' }];
    return (
        <AbsoluteFill style={{ background: colors.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
            <OrbBg color={colors.accent} secondary={colors.secondary || colors.accent} frame={frame} fps={fps} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20, width: '60%', zIndex: 1 }}>
                {items.map((item, i) => { const slideIn = getEntrance(frame, fps, 'slide-left', 0.3 + i * 0.4); return (
                    <div key={i} style={{ ...slideIn, display: 'flex', alignItems: 'center', gap: 20, padding: '24px 32px', borderRadius: 20, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', backdropFilter: 'blur(16px)' }}>
                        <div style={{ width: 56, height: 56, borderRadius: 16, background: `${colors.accent}20`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <SmartIcon name={item.icon} color={colors.accent} size={28} />
                        </div>
                        <div style={{ fontSize: 26, fontWeight: 600, color: colors.text, flex: 1 }}>{item.label}</div>
                        <div style={{ fontSize: 16, color: `${colors.text}60` }}>just now</div>
                    </div>
                ); })}
            </div>
        </AbsoluteFill>
    );
};

const CodeTerminalScene: React.FC<{ scene: MotionGraphicScene; palette: typeof PALETTES.midnight }> = ({ scene, palette }) => {
    const frame = useCurrentFrame(); const { fps } = useVideoConfig(); const colors = { ...palette, ...scene.colors };
    const code = scene.content || 'npx create-migoo-app ./my-project\n> Installing dependencies...\n> ✅ Project created successfully!\n> 🚀 Run: npm run dev';
    const lines = code.split('\n');
    const charsPerSec = 30; const totalChars = code.length;
    const currentChars = Math.floor(interpolate(frame, [fps * 0.5, fps * 0.5 + (totalChars / charsPerSec) * fps], [0, totalChars], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }));
    let charCount = 0; const visibleLines = lines.map(line => { const start = charCount; charCount += line.length + 1; const visible = Math.max(0, Math.min(line.length, currentChars - start)); return line.substring(0, visible); });
    return (
        <AbsoluteFill style={{ background: colors.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '8%', overflow: 'hidden' }}>
            <GradientMesh color={colors.accent} secondary={colors.secondary || colors.accent} bg={colors.bg} />
            <FloatingShapes color={colors.accent} secondary={colors.secondary || colors.accent} seed={15} count={3} />
            <div style={{ ...getEntrance(frame, fps, 'flip-3d', 0.1), width: '90%', borderRadius: 20, overflow: 'hidden', boxShadow: `0 40px 80px rgba(0,0,0,0.5), 0 0 60px ${colors.accent}20`, border: '1px solid rgba(255,255,255,0.1)', zIndex: 2 }}>
                <div style={{ background: '#1e1e1e', padding: '14px 20px', display: 'flex', gap: 8 }}>{['#ff5f57','#febc2e','#28c840'].map((c,i) => <div key={i} style={{ width: 14, height: 14, borderRadius: '50%', background: c }} />)}</div>
                <div style={{ background: '#0d0d0d', padding: 36, fontFamily: "'Fira Code', 'Courier New', monospace", fontSize: 24, lineHeight: 2, minHeight: 300 }}>
                    {visibleLines.map((line, i) => <div key={i} style={{ color: line.startsWith('>') ? colors.accent : line.includes('✅') ? '#28c840' : '#e0e0e0' }}><span style={{ color: '#666', marginRight: 16 }}>$</span>{line}</div>)}
                    <span style={{ display: 'inline-block', width: 12, height: 24, background: colors.accent, opacity: frame % 30 < 15 ? 1 : 0 }} />
                </div>
            </div>
            <Grain opacity={0.05} />
        </AbsoluteFill>
    );
};

const GlassCardScene: React.FC<{ scene: MotionGraphicScene; palette: typeof PALETTES.midnight }> = ({ scene, palette }) => {
    const frame = useCurrentFrame(); const { fps } = useVideoConfig(); const colors = { ...palette, ...scene.colors };
    const cardRotateY = interpolate(frame, [0, fps * 2], [-8, 0], { extrapolateRight: 'clamp' });
    return (
        <AbsoluteFill style={{ background: colors.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', perspective: '1200px' }}>
            <OrbBg color={colors.accent} secondary={colors.secondary || colors.accent} frame={frame} fps={fps} />
            <div style={{ ...getEntrance(frame, fps, 'scale', 0.2), width: '55%', padding: 56, borderRadius: 36, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)', backdropFilter: 'blur(24px)', boxShadow: `0 40px 80px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.1)`, transform: `rotateY(${cardRotateY}deg)`, zIndex: 1 }}>
                {scene.imageUrl && <div style={{ width: 80, height: 80, borderRadius: 20, overflow: 'hidden', marginBottom: 28 }}><Img src={scene.imageUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /></div>}
                <div style={{ fontSize: 52, fontWeight: 800, color: colors.text, marginBottom: 16 }}>{scene.headline || 'Premium Feature'}</div>
                <div style={{ fontSize: 26, color: '#fff', opacity: 0.75, lineHeight: 1.6 }}>{scene.content || scene.subtext || ''}</div>
                {scene.items && <div style={{ display: 'flex', gap: 16, marginTop: 32, flexWrap: 'wrap' }}>{scene.items.map((item, i) => <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 20px', borderRadius: 50, background: `${colors.accent}15`, border: `1px solid ${colors.accent}30`, color: colors.accent, fontSize: 18, fontWeight: 600 }}>
                    <SmartIcon name={item.icon} color={colors.accent} size={20} />
                    {item.label}
                </div>)}</div>}
            </div>
        </AbsoluteFill>
    );
};

const QuoteRevealScene: React.FC<{ scene: MotionGraphicScene; palette: typeof PALETTES.midnight }> = ({ scene, palette }) => {
    const frame = useCurrentFrame(); const { fps } = useVideoConfig(); const colors = { ...palette, ...scene.colors };
    const lineW = interpolate(frame, [fps * 0.3, fps * 1.5], [0, 6], { extrapolateRight: 'clamp' });
    return (
        <AbsoluteFill style={{ background: colors.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '12%', overflow: 'hidden' }}>
            <MeshBg color={colors.accent} />
            <div style={{ zIndex: 1, display: 'flex', gap: 40 }}>
                <div style={{ width: lineW, background: `linear-gradient(to bottom, ${colors.accent}, ${colors.secondary || colors.accent})`, borderRadius: 4, flexShrink: 0 }} />
                <div style={{ ...getEntrance(frame, fps, 'slide-left', 0.3) }}>
                    <div style={{ fontSize: 48, fontWeight: 700, color: colors.text, lineHeight: 1.5, fontStyle: 'italic' }}>{scene.content || scene.headline || '"Innovation distinguishes between a leader and a follower."'}</div>
                    <div style={{ ...getEntrance(frame, fps, 'fade', 1.2), fontSize: 28, color: colors.accent, marginTop: 32, fontWeight: 600 }}>— {scene.subtext || 'Steve Jobs'}</div>
                </div>
            </div>
        </AbsoluteFill>
    );
};

// ─── Filled + New Scene Types ────────────────────────────────────────────────

// floating_cards — cards drifting in 3D space with parallax depth (previously
// fell back to title_reveal).
const FloatingCardsScene: React.FC<{ scene: MotionGraphicScene; palette: typeof PALETTES.midnight }> = ({ scene, palette }) => {
    const frame = useCurrentFrame(); const { fps } = useVideoConfig(); const colors = { ...palette, ...scene.colors };
    const items = scene.items?.length ? scene.items : [
        { icon: 'Zap', label: 'Fast', value: 'Instant renders' },
        { icon: 'Sparkles', label: 'Smart', value: 'AI-driven scenes' },
        { icon: 'Layers', label: 'Flexible', value: 'Endless styles' },
    ];
    return (
        <AbsoluteFill style={{ background: colors.bg || palette.gradient, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', perspective: '1400px' }}>
            <GradientMesh color={colors.accent} secondary={colors.secondary || colors.accent} bg={colors.bg || palette.bg} />
            <FloatingShapes color={colors.accent} secondary={colors.secondary || colors.accent} seed={5} />
            {scene.headline && <div style={{ ...getEntrance(frame, fps, 'blur-in', 0.1), fontSize: 60, fontWeight: 900, color: colors.text, marginBottom: 56, textAlign: 'center', zIndex: 3, letterSpacing: '-0.02em' }}>{scene.headline}</div>}
            <div style={{ display: 'flex', gap: 40, zIndex: 2 }}>
                {items.slice(0, 4).map((item, i) => {
                    const a = getEntrance(frame, fps, 'flip-3d', 0.3 + i * 0.2);
                    const floatY = Math.sin(frame * 0.04 + i * 1.5) * 18;
                    const tilt = Math.sin(frame * 0.03 + i) * 4;
                    return (
                        <div key={i} style={{ ...a, transform: `${a.transform || ''} translateY(${floatY}px) rotateZ(${tilt}deg)`, width: 300, padding: '44px 36px', borderRadius: 32, background: 'rgba(255,255,255,0.06)', border: `1px solid ${colors.accent}40`, backdropFilter: 'blur(20px)', boxShadow: `0 30px 60px rgba(0,0,0,0.4), 0 0 40px ${colors.accent}20`, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20, textAlign: 'center' }}>
                            <div style={{ padding: 20, borderRadius: '50%', background: `${colors.accent}20`, border: `1px solid ${colors.accent}40` }}>
                                <SmartIcon name={item.icon} color={colors.accent} size={48} />
                            </div>
                            <div style={{ fontSize: 30, fontWeight: 800, color: colors.text }}>{item.label}</div>
                            {item.value && <div style={{ fontSize: 20, color: `${colors.text}99`, lineHeight: 1.4 }}>{toText(item.value)}</div>}
                        </div>
                    );
                })}
            </div>
            <VignetteGlow color={colors.accent} />
            <Grain />
        </AbsoluteFill>
    );
};

// timeline_reveal — vertical chronological reveal with a growing spine (previously
// fell back to title_reveal).
const TimelineRevealScene: React.FC<{ scene: MotionGraphicScene; palette: typeof PALETTES.midnight }> = ({ scene, palette }) => {
    const frame = useCurrentFrame(); const { fps } = useVideoConfig(); const colors = { ...palette, ...scene.colors };
    const items = scene.items?.length ? scene.items : [
        { year: '2023', label: 'Founded', value: 'The idea was born' },
        { year: '2024', label: 'Launch', value: 'First 10K users' },
        { year: '2025', label: 'Scale', value: 'Global expansion' },
    ];
    const spineH = interpolate(frame, [fps * 0.3, fps * 3], [0, 100], { extrapolateRight: 'clamp' });
    return (
        <AbsoluteFill style={{ background: colors.bg || palette.bg, padding: '7% 12%', display: 'flex', flexDirection: 'column', justifyContent: 'center', overflow: 'hidden' }}>
            <GradientMesh color={colors.accent} secondary={colors.secondary || colors.accent} bg={colors.bg || palette.bg} />
            {scene.headline && <div style={{ ...getEntrance(frame, fps, 'slide-up', 0.1), fontSize: 56, fontWeight: 900, color: colors.text, marginBottom: 48, zIndex: 2 }}>{scene.headline}</div>}
            <div style={{ position: 'relative', zIndex: 2 }}>
                {/* Growing vertical spine (centered under the dots) */}
                <div style={{ position: 'absolute', left: 17, top: 12, bottom: 12, width: 4, background: `${colors.accent}20`, borderRadius: 2 }}>
                    <div style={{ width: '100%', height: `${spineH}%`, background: `linear-gradient(to bottom, ${colors.accent}, ${colors.secondary || colors.accent})`, borderRadius: 2, boxShadow: `0 0 16px ${colors.accent}` }} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 40 }}>
                    {items.map((item, i) => {
                        const a = getEntrance(frame, fps, 'slide-left', 0.5 + i * 0.4);
                        return (
                            // Row reserves the left gutter (paddingLeft) so the dot never overlaps text.
                            <div key={i} style={{ ...a, position: 'relative', paddingLeft: 72 }}>
                                <div style={{ position: 'absolute', left: 5, top: 6, width: 28, height: 28, borderRadius: '50%', background: `linear-gradient(135deg, ${colors.accent}, ${colors.secondary || colors.accent})`, border: `4px solid ${colors.bg || palette.bg}`, boxShadow: `0 0 20px ${colors.accent}` }} />
                                {item.year && <div style={{ fontSize: 22, fontWeight: 800, color: colors.accent, letterSpacing: 2 }}>{item.year}</div>}
                                <div style={{ fontSize: 36, fontWeight: 800, color: colors.text, lineHeight: 1.1 }}>{item.label}</div>
                                {item.value && <div style={{ fontSize: 22, color: `${colors.text}88`, marginTop: 4 }}>{toText(item.value)}</div>}
                            </div>
                        );
                    })}
                </div>
            </div>
            <Grain opacity={0.05} />
        </AbsoluteFill>
    );
};

// particle_text — headline that assembles from a burst of particles (kinetic typography).
const ParticleTextScene: React.FC<{ scene: MotionGraphicScene; palette: typeof PALETTES.midnight }> = ({ scene, palette }) => {
    const frame = useCurrentFrame(); const { fps } = useVideoConfig(); const colors = { ...palette, ...scene.colors };
    const headline = scene.headline || 'Imagine More';
    const assemble = spring({ frame, fps, config: { damping: 16, stiffness: 60 } });
    return (
        <AbsoluteFill style={{ background: colors.bg || '#050510', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
            <GradientMesh color={colors.accent} secondary={colors.secondary || colors.accent} bg={colors.bg || '#050510'} />
            <ParticleField color={colors.accent} count={60} seed={21} />
            <FloatingShapes color={colors.accent} secondary={colors.secondary || colors.accent} seed={2} count={4} />
            <div style={{ position: 'relative', zIndex: 2, textAlign: 'center', padding: '10%' }}>
                <div style={{ fontSize: 100, fontWeight: 900, color: colors.text, letterSpacing: '-3px', lineHeight: 1.0, textShadow: `0 0 80px ${colors.accent}60` }}>
                    {headline.split('').map((ch, i) => {
                        const r = seededRandom(i * 3.7);
                        const px = (r - 0.5) * 600 * (1 - assemble);
                        const py = (seededRandom(i * 1.9) - 0.5) * 400 * (1 - assemble);
                        return (
                            <span key={i} style={{ display: 'inline-block', opacity: interpolate(frame, [i * 1.5, i * 1.5 + fps * 0.5], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }), transform: `translate(${px}px, ${py}px) scale(${0.5 + assemble * 0.5})`, filter: `blur(${(1 - assemble) * 8}px)`, color: i % 5 === 0 ? colors.accent : colors.text }}>
                                {ch === ' ' ? ' ' : ch}
                            </span>
                        );
                    })}
                </div>
                {scene.subtext && <div style={{ ...getEntrance(frame, fps, 'fade', 1.4), fontSize: 32, color: colors.accent, marginTop: 32, fontWeight: 600, letterSpacing: 4 }}>{scene.subtext}</div>}
            </div>
            <VignetteGlow color={colors.accent} />
            <Grain />
        </AbsoluteFill>
    );
};

// card_stack_3d — a fanned stack of 3D cards that spreads out to showcase features.
const CardStack3DScene: React.FC<{ scene: MotionGraphicScene; palette: typeof PALETTES.midnight }> = ({ scene, palette }) => {
    const frame = useCurrentFrame(); const { fps } = useVideoConfig(); const colors = { ...palette, ...scene.colors };
    const items = scene.items?.length ? scene.items : [
        { icon: 'Wand2', label: 'Create', value: 'Describe your idea' },
        { icon: 'Film', label: 'Generate', value: 'AI builds the scenes' },
        { icon: 'Share2', label: 'Share', value: 'Publish anywhere' },
    ];
    const spread = spring({ frame, fps, config: { damping: 15, stiffness: 55 } });
    const n = items.length;
    return (
        <AbsoluteFill style={{ background: colors.bg || palette.bg, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', perspective: '1600px' }}>
            <GradientMesh color={colors.accent} secondary={colors.secondary || colors.accent} bg={colors.bg || palette.bg} />
            <Spotlight color={colors.accent} />
            {scene.headline && <div style={{ ...getEntrance(frame, fps, 'slide-up', 0.1), fontSize: 58, fontWeight: 900, color: colors.text, marginBottom: 70, zIndex: 3, textAlign: 'center', letterSpacing: '-0.02em' }}>{scene.headline}</div>}
            <div style={{ position: 'relative', width: 340, height: 460, zIndex: 2, transformStyle: 'preserve-3d' }}>
                {items.slice(0, 5).map((item, i) => {
                    const center = (n - 1) / 2;
                    const offset = (i - center);
                    // Wide step (≈ card width) so cards fan out with only a small overlap — no clipped text.
                    const x = offset * spread * 320;
                    const rot = offset * spread * 10;
                    const z = -Math.abs(offset) * 70;
                    const a = interpolate(frame, [fps * 0.2 + i * 3, fps * 0.9 + i * 3], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
                    const cardBg = colors.bg || palette.bg || '#0a0a14';
                    return (
                        // Opaque card background so back cards don't bleed through the front ones.
                        <div key={i} style={{ position: 'absolute', inset: 0, opacity: a, transform: `translateX(${x}px) translateZ(${z}px) rotateY(${rot}deg) rotateZ(${rot * 0.25}deg)`, transformOrigin: 'center bottom', borderRadius: 32, background: `linear-gradient(160deg, ${colors.accent}33, ${cardBg}fa)`, border: `1.5px solid ${colors.accent}66`, boxShadow: `0 40px 80px rgba(0,0,0,0.6)`, padding: 40, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', overflow: 'hidden' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <div style={{ padding: 16, borderRadius: 18, background: `${colors.accent}30` }}>
                                    <SmartIcon name={item.icon} color={colors.text} size={40} />
                                </div>
                                <div style={{ fontSize: 44, fontWeight: 900, color: `${colors.accent}55`, lineHeight: 1 }}>{i + 1}</div>
                            </div>
                            <div>
                                <div style={{ fontSize: 38, fontWeight: 900, color: colors.text, marginBottom: 10 }}>{item.label}</div>
                                <div style={{ fontSize: 23, color: `${colors.text}cc`, lineHeight: 1.35 }}>{toText(item.value)}</div>
                            </div>
                        </div>
                    );
                })}
            </div>
            <VignetteGlow color={colors.accent} />
            <Grain />
        </AbsoluteFill>
    );
};

// chart_race — animated ranked horizontal bars that grow and reorder-in (data reveal).
const ChartRaceScene: React.FC<{ scene: MotionGraphicScene; palette: typeof PALETTES.midnight }> = ({ scene, palette }) => {
    const frame = useCurrentFrame(); const { fps } = useVideoConfig(); const colors = { ...palette, ...scene.colors };
    const raw = scene.items?.length ? scene.items : [
        { label: 'Migoo AI', value: '95' }, { label: 'Legacy Tools', value: '62' },
        { label: 'Manual Editing', value: '38' }, { label: 'Templates', value: '21' },
    ];
    const parsed = raw.map((it, i) => ({ label: it.label || `Item ${i + 1}`, num: parseNum(it.value, 10 + i), icon: it.icon }));
    const max = Math.max(...parsed.map(p => p.num), 1);
    return (
        <AbsoluteFill style={{ background: colors.bg || palette.bg, padding: '7% 9%', display: 'flex', flexDirection: 'column', justifyContent: 'center', overflow: 'hidden' }}>
            <GradientMesh color={colors.accent} secondary={colors.secondary || colors.accent} bg={colors.bg || palette.bg} />
            {scene.headline && <div style={{ ...getEntrance(frame, fps, 'slide-up', 0.1), fontSize: 54, fontWeight: 900, color: colors.text, marginBottom: 48, zIndex: 2 }}>{scene.headline}</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 26, zIndex: 2 }}>
                {parsed.map((p, i) => {
                    const grow = interpolate(frame, [fps * 0.4 + i * 5, fps * 1.8 + i * 5], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
                    const widthPct = (p.num / max) * 100 * grow;
                    const shownVal = Math.round(p.num * grow);
                    const isLeader = i === 0;
                    return (
                        <div key={i} style={{ ...getEntrance(frame, fps, 'slide-left', 0.3 + i * 0.15), display: 'flex', alignItems: 'center', gap: 24 }}>
                            <div style={{ width: 260, fontSize: 28, fontWeight: 700, color: colors.text, textAlign: 'right', flexShrink: 0 }}>{p.label}</div>
                            <div style={{ flex: 1, height: 56, borderRadius: 14, background: 'rgba(255,255,255,0.05)', position: 'relative', overflow: 'hidden' }}>
                                <div style={{ height: '100%', width: `${widthPct}%`, borderRadius: 14, background: isLeader ? `linear-gradient(90deg, ${colors.accent}, ${colors.secondary || colors.accent})` : `${colors.accent}70`, boxShadow: isLeader ? `0 0 24px ${colors.accent}80` : 'none', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: 18, transition: 'width 0.2s' }}>
                                    <span style={{ fontSize: 26, fontWeight: 900, color: '#fff' }}>{shownVal}</span>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
            <Grain opacity={0.05} />
        </AbsoluteFill>
    );
};

// ui_showcase — UI-style overlay: a main screen with animated floating panels around it.
const UIShowcaseScene: React.FC<{ scene: MotionGraphicScene; palette: typeof PALETTES.midnight }> = ({ scene, palette }) => {
    const frame = useCurrentFrame(); const { fps } = useVideoConfig(); const colors = { ...palette, ...scene.colors };
    const chips = scene.items?.length ? scene.items : [
        { icon: 'CheckCircle', label: 'Task done' }, { icon: 'TrendingUp', label: '+240%' }, { icon: 'Users', label: '12K online' },
    ];
    const screenAnim = getEntrance(frame, fps, 'scale', 0.2);
    return (
        <AbsoluteFill style={{ background: colors.bg || palette.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', perspective: '1400px' }}>
            <GradientMesh color={colors.accent} secondary={colors.secondary || colors.accent} bg={colors.bg || palette.bg} />
            <FloatingShapes color={colors.accent} secondary={colors.secondary || colors.accent} seed={14} count={4} />
            {/* Main app window */}
            <div style={{ ...screenAnim, width: '62%', height: '72%', borderRadius: 28, overflow: 'hidden', boxShadow: `0 50px 100px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.1)`, transform: `${screenAnim.transform || ''} rotateY(${interpolate(frame, [0, fps * 2], [8, 0], { extrapolateRight: 'clamp' })}deg)`, zIndex: 2, position: 'relative' }}>
                <div style={{ background: '#161616', padding: '14px 20px', display: 'flex', gap: 8, alignItems: 'center' }}>
                    {['#ff5f57', '#febc2e', '#28c840'].map((c, i) => <div key={i} style={{ width: 13, height: 13, borderRadius: '50%', background: c }} />)}
                    <div style={{ flex: 1, marginLeft: 12, background: '#242424', borderRadius: 8, padding: '7px 14px', fontSize: 14, color: '#999' }}>{scene.query || 'app.migoo.ai/studio'}</div>
                </div>
                <div style={{ height: '100%', position: 'relative', background: '#0d0d0d' }}>
                    {scene.imageUrl
                        ? <Img src={scene.imageUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        : <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 40, textAlign: 'center' }}><div style={{ fontSize: 54, fontWeight: 900, color: colors.text }}>{scene.headline}</div>{scene.subtext && <div style={{ fontSize: 26, color: colors.accent, marginTop: 18 }}>{scene.subtext}</div>}</div>}
                </div>
            </div>
            {/* Floating UI chips */}
            {chips.slice(0, 3).map((chip, i) => {
                const positions = [{ top: '18%', left: '12%' }, { bottom: '20%', left: '9%' }, { top: '24%', right: '11%' }];
                const pos = positions[i % positions.length];
                const a = getEntrance(frame, fps, 'spring-pop', 0.8 + i * 0.25);
                const floatY = Math.sin(frame * 0.05 + i * 2) * 12;
                return (
                    <div key={i} style={{ position: 'absolute', ...pos, ...a, transform: `${a.transform || ''} translateY(${floatY}px)`, zIndex: 3, display: 'flex', alignItems: 'center', gap: 14, padding: '18px 26px', borderRadius: 20, background: 'rgba(255,255,255,0.08)', border: `1px solid ${colors.accent}50`, backdropFilter: 'blur(20px)', boxShadow: `0 20px 40px rgba(0,0,0,0.4)` }}>
                        <SmartIcon name={chip.icon} color={colors.accent} size={30} />
                        <span style={{ fontSize: 24, fontWeight: 700, color: colors.text }}>{chip.label}</span>
                    </div>
                );
            })}
            <VignetteGlow color={colors.accent} />
            <Grain />
        </AbsoluteFill>
    );
};

// text_mask_reveal — headline text clipped over a moving image/video (mixed media).
const TextMaskRevealScene: React.FC<{ scene: MotionGraphicScene; palette: typeof PALETTES.midnight }> = ({ scene, palette }) => {
    const frame = useCurrentFrame(); const { fps } = useVideoConfig(); const colors = { ...palette, ...scene.colors };
    const headline = scene.headline || 'CREATE';
    const wipe = interpolate(frame, [fps * 0.2, fps * 1.4], [100, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
    return (
        <AbsoluteFill style={{ background: colors.bg || '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
            {/* The media that shows THROUGH the text */}
            <div style={{ position: 'absolute', inset: 0 }}>
                {scene.imageUrl
                    ? <KenBurns durationSec={(scene.durationSec || 5) + 1} zoom={1.2}><Img src={scene.imageUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /></KenBurns>
                    : <div style={{ width: '100%', height: '100%', background: `linear-gradient(135deg, ${colors.accent}, ${colors.secondary || colors.accent})` }} />}
            </div>
            <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.35)' }} />
            {/* Huge masked headline: text is transparent windows onto the media */}
            <div style={{ position: 'relative', zIndex: 2, textAlign: 'center', clipPath: `inset(0 0 ${wipe}% 0)` }}>
                <div style={{ fontSize: 200, fontWeight: 900, letterSpacing: '-6px', lineHeight: 0.95, color: '#fff', mixBlendMode: 'overlay', textTransform: 'uppercase', WebkitTextStroke: `2px ${colors.text}` }}>
                    {headline}
                </div>
            </div>
            {scene.subtext && <div style={{ position: 'absolute', bottom: '14%', zIndex: 3, ...getEntrance(frame, fps, 'slide-up', 1.4), fontSize: 34, fontWeight: 600, color: '#fff', letterSpacing: 4, textShadow: '0 4px 20px rgba(0,0,0,0.6)' }}>{scene.subtext}</div>}
            <VignetteGlow color={colors.accent} strength={0.65} />
            <Grain />
        </AbsoluteFill>
    );
};

// big_number — a single huge editorial statistic with kinetic emphasis.
const BigNumberScene: React.FC<{ scene: MotionGraphicScene; palette: typeof PALETTES.midnight }> = ({ scene, palette }) => {
    const frame = useCurrentFrame(); const { fps } = useVideoConfig(); const colors = { ...palette, ...scene.colors };
    const stat: any = scene.stat || {};
    const target = parseNum(stat.value ?? scene.headline, 100);
    const progress = interpolate(frame, [fps * 0.3, fps * 2.2], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
    const current = Math.round(target * progress);
    const pop = spring({ frame, fps, config: { damping: 12, stiffness: 90 } });
    return (
        <AbsoluteFill style={{ background: colors.bg || '#050510', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
            <GradientMesh color={colors.accent} secondary={colors.secondary || colors.accent} bg={colors.bg || '#050510'} />
            <ParticleField color={colors.accent} count={40} seed={31} />
            <Spotlight color={colors.accent} />
            {(stat.label || scene.subtext) && <div style={{ ...getEntrance(frame, fps, 'slide-up', 0.2), fontSize: 30, fontWeight: 700, letterSpacing: 8, textTransform: 'uppercase', color: colors.accent, marginBottom: 20, zIndex: 2 }}>{stat.label || scene.subtext}</div>}
            <div style={{ zIndex: 2, fontSize: 300, fontWeight: 900, color: colors.text, lineHeight: 0.9, letterSpacing: '-10px', transform: `scale(${0.7 + pop * 0.3})`, textShadow: `0 0 120px ${colors.accent}80`, fontVariantNumeric: 'tabular-nums' }}>
                {stat.prefix || ''}{current.toLocaleString()}{stat.suffix || ''}
            </div>
            {scene.content && <div style={{ ...getEntrance(frame, fps, 'fade', 1.6), fontSize: 34, color: `${colors.text}aa`, marginTop: 28, zIndex: 2, maxWidth: '70%', textAlign: 'center' }}>{scene.content}</div>}
            <VignetteGlow color={colors.accent} />
            <Grain />
        </AbsoluteFill>
    );
};

// pricing_table — animated plan cards with a highlighted "featured" tier.
const PricingTableScene: React.FC<{ scene: MotionGraphicScene; palette: typeof PALETTES.midnight }> = ({ scene, palette }) => {
    const frame = useCurrentFrame(); const { fps } = useVideoConfig(); const colors = { ...palette, ...scene.colors };
    const plans = scene.items?.length ? scene.items : [
        { label: 'Starter', value: '$0' }, { label: 'Pro', value: '$29' }, { label: 'Studio', value: '$99' },
    ];
    return (
        <AbsoluteFill style={{ background: colors.bg || palette.bg, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', padding: '5%' }}>
            <GradientMesh color={colors.accent} secondary={colors.secondary || colors.accent} bg={colors.bg || palette.bg} />
            {scene.headline && <div style={{ ...getEntrance(frame, fps, 'slide-up', 0.1), fontSize: 58, fontWeight: 900, color: colors.text, marginBottom: 50, zIndex: 2, textAlign: 'center' }}>{scene.headline}</div>}
            <div style={{ display: 'flex', gap: 32, zIndex: 2, alignItems: 'stretch' }}>
                {plans.slice(0, 4).map((plan, i) => {
                    const featured = i === Math.floor(plans.length / 2);
                    const a = getEntrance(frame, fps, 'spring-pop', 0.3 + i * 0.18);
                    return (
                        <div key={i} style={{ ...a, transform: `${a.transform || ''} ${featured ? 'scale(1.06)' : ''}`, width: 300, padding: '48px 36px', borderRadius: 32, background: featured ? `linear-gradient(160deg, ${colors.accent}30, rgba(255,255,255,0.04))` : 'rgba(255,255,255,0.04)', border: `2px solid ${featured ? colors.accent : 'rgba(255,255,255,0.1)'}`, boxShadow: featured ? `0 30px 70px ${colors.accent}40` : '0 20px 40px rgba(0,0,0,0.3)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, position: 'relative' }}>
                            {featured && <div style={{ position: 'absolute', top: -16, background: colors.accent, color: '#fff', fontSize: 15, fontWeight: 800, padding: '6px 18px', borderRadius: 20, letterSpacing: 1, textTransform: 'uppercase' }}>Popular</div>}
                            <div style={{ fontSize: 26, fontWeight: 700, color: `${colors.text}cc`, textTransform: 'uppercase', letterSpacing: 2 }}>{plan.label}</div>
                            <div style={{ fontSize: 68, fontWeight: 900, color: featured ? colors.accent : colors.text }}>{toText(plan.value)}</div>
                            {plan.icon && <SmartIcon name={plan.icon} color={colors.accent} size={40} />}
                            <div style={{ marginTop: 'auto', padding: '14px 40px', borderRadius: 40, background: featured ? `linear-gradient(135deg, ${colors.accent}, ${colors.secondary || colors.accent})` : `${colors.accent}20`, color: featured ? '#fff' : colors.accent, fontWeight: 800, fontSize: 20 }}>Choose</div>
                        </div>
                    );
                })}
            </div>
            <Grain opacity={0.05} />
        </AbsoluteFill>
    );
};

// map_reveal — a rotating dotted globe with location pins plotted at real
// coordinates ("global reach"). Renders in Remotion via useCurrentFrame math.
const MapRevealScene: React.FC<{ scene: MotionGraphicScene; palette: typeof PALETTES.midnight }> = ({ scene, palette }) => {
    const frame = useCurrentFrame(); const { fps } = useVideoConfig(); const colors = { ...palette, ...scene.colors };
    const rawPins = scene.items?.length ? scene.items : [
        { label: 'New York', value: '1.2M' }, { label: 'London', value: '860K' }, { label: 'Mumbai', value: '740K' }, { label: 'Tokyo', value: '610K' }, { label: 'São Paulo', value: '430K' }, { label: 'Sydney', value: '210K' },
    ];
    // Resolve each pin to lon/lat: known city → real coords; otherwise a deterministic
    // point spread around the globe so unknown labels still land somewhere sensible.
    const pins: GlobePin[] = rawPins.slice(0, 8).map((p, i) => {
        const coord = CITY_COORDS[(p.label || '').trim().toLowerCase()];
        const lon = coord ? coord[0] : -160 + seededRandom(i * 4.4) * 320;
        const lat = coord ? coord[1] : -30 + seededRandom(i * 8.1) * 80;
        return { label: p.label, value: p.value != null ? toText(p.value) : undefined, lon, lat };
    });
    const globeIn = getEntrance(frame, fps, 'scale', 0.15);
    return (
        <AbsoluteFill style={{ background: colors.bg || palette.bg, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
            <GradientMesh color={colors.accent} secondary={colors.secondary || colors.accent} bg={colors.bg || palette.bg} />
            <FloatingShapes color={colors.accent} secondary={colors.secondary || colors.accent} seed={19} count={4} />
            {scene.headline && <div style={{ ...getEntrance(frame, fps, 'slide-up', 0.1), fontSize: 54, fontWeight: 900, color: colors.text, position: 'absolute', top: '8%', zIndex: 4, textAlign: 'center', width: '100%' }}>{scene.headline}</div>}
            <div style={{ ...globeIn, position: 'absolute', top: '54%', left: '50%', width: 860, height: 860, transform: `translate(-50%, -50%) ${globeIn.transform || ''}`, zIndex: 2 }}>
                <DottedGlobe color={colors.accent} secondary={colors.secondary || colors.accent} pins={pins} frame={frame} fps={fps} />
            </div>
            <VignetteGlow color={colors.accent} />
            <Grain opacity={0.05} />
        </AbsoluteFill>
    );
};

// ─── Scene Renderer ──────────────────────────────────────────────────────────

const SceneRenderer: React.FC<{ scene: MotionGraphicScene; palette: typeof PALETTES.midnight }> = ({ scene, palette }) => {
    switch (scene.type) {
        case 'title_reveal': return <TitleRevealScene scene={scene} palette={palette} />;
        case 'search_reveal': return <SearchRevealScene scene={scene} palette={palette} />;
        case 'feature_list': return <FeatureListScene scene={scene} palette={palette} />;
        case 'kinetic_text': return <KineticTextScene scene={scene} palette={palette} />;
        case 'stat_counter': return <StatCounterScene scene={scene} palette={palette} />;
        case 'icon_grid': return <IconGridScene scene={scene} palette={palette} />;
        case 'comparison': return <ComparisonScene scene={scene} palette={palette} />;
        case 'image_showcase': return <ImageShowcaseScene scene={scene} palette={palette} />;
        case 'call_to_action': return <CallToActionScene scene={scene} palette={palette} />;
        case 'logo_reveal': return <LogoRevealScene scene={scene} palette={palette} />;
        case 'split_hero': return <SplitHeroScene scene={scene} palette={palette} />;
        case 'neon_glow': return <NeonGlowScene scene={scene} palette={palette} />;
        case 'gradient_burst': return <GradientBurstScene scene={scene} palette={palette} />;
        case 'bento_grid': return <BentoGridScene scene={scene} palette={palette} />;
        case 'video_hero': return <VideoHeroScene scene={scene} palette={palette} />;
        case 'phone_mockup': return <PhoneMockupScene scene={scene} palette={palette} />;
        case 'browser_mockup': return <BrowserMockupScene scene={scene} palette={palette} />;
        case 'timeline': return <TimelineScene scene={scene} palette={palette} />;
        case 'testimonial': return <TestimonialScene scene={scene} palette={palette} />;
        case 'metric_dashboard': return <MetricDashboardScene scene={scene} palette={palette} />;
        case 'process_steps': return <ProcessStepsScene scene={scene} palette={palette} />;
        case 'notification_stack': return <NotificationStackScene scene={scene} palette={palette} />;
        case 'code_terminal': return <CodeTerminalScene scene={scene} palette={palette} />;
        case 'glass_card': return <GlassCardScene scene={scene} palette={palette} />;
        case 'quote_reveal': return <QuoteRevealScene scene={scene} palette={palette} />;
        case 'floating_cards': return <FloatingCardsScene scene={scene} palette={palette} />;
        case 'timeline_reveal': return <TimelineRevealScene scene={scene} palette={palette} />;
        case 'particle_text': return <ParticleTextScene scene={scene} palette={palette} />;
        case 'card_stack_3d': return <CardStack3DScene scene={scene} palette={palette} />;
        case 'chart_race': return <ChartRaceScene scene={scene} palette={palette} />;
        case 'ui_showcase': return <UIShowcaseScene scene={scene} palette={palette} />;
        case 'text_mask_reveal': return <TextMaskRevealScene scene={scene} palette={palette} />;
        case 'big_number': return <BigNumberScene scene={scene} palette={palette} />;
        case 'pricing_table': return <PricingTableScene scene={scene} palette={palette} />;
        case 'map_reveal': return <MapRevealScene scene={scene} palette={palette} />;
        default: return <TitleRevealScene scene={scene} palette={palette} />;
    }
};

import { resolveLocalUrl } from './Composition';

// ─── Main Composition ────────────────────────────────────────────────────────

export const MotionGraphicComposition: React.FC<MotionGraphicCompositionProps> = (props) => {
    const { scenes, theme, durationInFrames, musicUrl, audioUrl, voiceoverEnabled } = props;
    const { fps } = useVideoConfig();

    // `theme.resolved` is the single source of truth (set for both preset and
    // custom themes when the user confirms one) — fall back to the legacy
    // PALETTES[theme.palette] lookup for old rows saved before this existed.
    const palette = theme?.resolved || PALETTES[theme?.palette || ''] || PALETTES.midnight;

    // Calculate frame distribution per scene
    const sceneTimings = useMemo(() => {
        const totalDurationSec = scenes.reduce((sum, s) => sum + (s.durationSec || 5), 0);
        let frameOffset = 0;

        return scenes.map((scene) => {
            const sceneDurationSec = scene.durationSec || 5;
            const sceneFrames = Math.round((sceneDurationSec / totalDurationSec) * durationInFrames);
            const timing = { from: frameOffset, durationInFrames: sceneFrames };
            frameOffset += sceneFrames;
            return timing;
        });
    }, [scenes, durationInFrames]);

    const resolvedMusicUrl = useMemo(() => resolveLocalUrl(musicUrl), [musicUrl]);
    const resolvedAudioUrl = useMemo(() => resolveLocalUrl(audioUrl), [audioUrl]);

    // Apply resolveLocalUrl to scene images
    const resolvedScenes = useMemo(() => {
        return scenes.map(scene => ({
            ...scene,
            imageUrl: scene.imageUrl ? resolveLocalUrl(scene.imageUrl) : scene.imageUrl
        }));
    }, [scenes]);

    return (
        <AbsoluteFill style={{ background: palette.bg, fontFamily: "'Outfit', sans-serif" }}>
            {/* Load Outfit font */}
            <style>
                {`@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800;900&display=swap');`}
            </style>
            
            {/* Render each scene as a Sequence */}
            {resolvedScenes.map((scene, i) => (
                <Sequence
                    key={i}
                    from={sceneTimings[i]?.from || 0}
                    durationInFrames={sceneTimings[i]?.durationInFrames || fps * 5}
                >
                    <SceneRenderer scene={scene} palette={palette} />
                </Sequence>
            ))}

            {/* Background music */}
            {resolvedMusicUrl && (
                <Audio src={resolvedMusicUrl} volume={voiceoverEnabled ? 0.15 : 0.4} loop />
            )}

            {/* Voiceover audio */}
            {voiceoverEnabled && resolvedAudioUrl && (
                <Audio src={resolvedAudioUrl} volume={0.9} />
            )}
        </AbsoluteFill>
    );
};
