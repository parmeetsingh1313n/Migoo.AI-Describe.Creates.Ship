/**
 * motion.tsx — Shared animation & effects engine for MotionGraphicComposition.
 *
 * Central toolkit so every scene can dynamically use a rich set of Remotion
 * motions (entrances, exits, char-stagger) and reusable ambient effect layers
 * (particles, grain, spotlight, parallax, Ken Burns, vignette, gradient mesh)
 * instead of each scene hand-rolling its own interpolate/spring math.
 *
 * All helpers are frame-driven and deterministic (no Math.random / Date) so
 * renders are reproducible across the Remotion render farm.
 */

import React from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';

// ─── Deterministic pseudo-random ─────────────────────────────────────────────
// Seeded by an integer so particle/shape layouts are stable frame-to-frame and
// identical across every render worker. NEVER use Math.random in a composition.
export const seededRandom = (seed: number): number => {
    const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
    return x - Math.floor(x);
};

// ─── Entrance animations ─────────────────────────────────────────────────────
// Superset of the original getEntrance vocabulary. Same signature, so existing
// scenes keep working; new types add depth, blur and physics.
export type EntranceType =
    | 'fade' | 'slide-up' | 'slide-left' | 'slide-right' | 'scale' | 'bounce'
    | 'typewriter' | 'glitch' | 'blur-in' | 'rotate-in' | 'flip-3d'
    | 'mask-wipe' | 'spring-pop' | 'zoom-blur' | 'char-stagger';

export function getEntrance(
    frame: number,
    fps: number,
    type: string = 'fade',
    delay: number = 0,
): React.CSSProperties {
    const f = Math.max(0, frame - delay * fps);
    const duration = fps * 0.8;
    const p = interpolate(f, [0, duration], [0, 1], { extrapolateRight: 'clamp' });

    switch (type) {
        case 'slide-up':
            return { opacity: p, transform: `translateY(${interpolate(f, [0, duration], [60, 0], { extrapolateRight: 'clamp' })}px)` };
        case 'slide-left':
            return { opacity: p, transform: `translateX(${interpolate(f, [0, duration], [80, 0], { extrapolateRight: 'clamp' })}px)` };
        case 'slide-right':
            return { opacity: p, transform: `translateX(${interpolate(f, [0, duration], [-80, 0], { extrapolateRight: 'clamp' })}px)` };
        case 'scale':
            return { opacity: p, transform: `scale(${interpolate(f, [0, duration], [0.6, 1], { extrapolateRight: 'clamp' })})` };
        case 'bounce': {
            const s = spring({ frame: f, fps, config: { damping: 8, stiffness: 120 } });
            return { opacity: interpolate(f, [0, duration * 0.3], [0, 1], { extrapolateRight: 'clamp' }), transform: `scale(${s})` };
        }
        case 'spring-pop': {
            const s = spring({ frame: f, fps, config: { damping: 11, stiffness: 180, mass: 0.7 } });
            return { opacity: interpolate(f, [0, duration * 0.25], [0, 1], { extrapolateRight: 'clamp' }), transform: `scale(${s})` };
        }
        case 'typewriter':
            return { opacity: 1, clipPath: `inset(0 ${interpolate(f, [0, duration * 1.5], [100, 0], { extrapolateRight: 'clamp' })}% 0 0)` };
        case 'mask-wipe':
            return { opacity: 1, clipPath: `inset(0 0 ${interpolate(f, [0, duration], [100, 0], { extrapolateRight: 'clamp' })}% 0)` };
        case 'glitch': {
            const glitchX = f < duration * 0.5 ? Math.sin(f * 2) * 5 : 0;
            return { opacity: interpolate(f, [0, duration * 0.3], [0, 1], { extrapolateRight: 'clamp' }), transform: `translateX(${glitchX}px)` };
        }
        case 'blur-in':
            return {
                opacity: p,
                filter: `blur(${interpolate(f, [0, duration], [20, 0], { extrapolateRight: 'clamp' })}px)`,
                transform: `scale(${interpolate(f, [0, duration], [1.08, 1], { extrapolateRight: 'clamp' })})`,
            };
        case 'zoom-blur':
            return {
                opacity: p,
                filter: `blur(${interpolate(f, [0, duration * 0.7], [16, 0], { extrapolateRight: 'clamp' })}px)`,
                transform: `scale(${interpolate(f, [0, duration], [1.4, 1], { extrapolateRight: 'clamp' })})`,
            };
        case 'rotate-in': {
            const s = spring({ frame: f, fps, config: { damping: 12, stiffness: 90 } });
            return { opacity: p, transform: `rotate(${interpolate(s, [0, 1], [-12, 0])}deg) scale(${interpolate(s, [0, 1], [0.85, 1])})` };
        }
        case 'flip-3d': {
            const s = spring({ frame: f, fps, config: { damping: 14, stiffness: 80 } });
            return { opacity: interpolate(f, [0, duration * 0.4], [0, 1], { extrapolateRight: 'clamp' }), transform: `perspective(1000px) rotateY(${interpolate(s, [0, 1], [70, 0])}deg)`, transformOrigin: 'center' };
        }
        case 'char-stagger': // per-char handled by getCharStagger; whole-block falls back to slide-up
            return { opacity: p, transform: `translateY(${interpolate(f, [0, duration], [40, 0], { extrapolateRight: 'clamp' })}px)` };
        default: // fade
            return { opacity: p, transform: 'none' };
    }
}

// Per-character stagger — returns a style for character index `i`.
export function getCharStagger(frame: number, fps: number, i: number, delay = 0): React.CSSProperties {
    const start = delay * fps + i * (fps * 0.03);
    const f = frame - start;
    const s = spring({ frame: Math.max(0, f), fps, config: { damping: 12, stiffness: 160, mass: 0.6 } });
    return {
        display: 'inline-block',
        opacity: interpolate(f, [0, fps * 0.2], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
        transform: `translateY(${interpolate(s, [0, 1], [24, 0])}px)`,
    };
}

// ─── Exit animations ─────────────────────────────────────────────────────────
// Applied in the tail of a scene so sequences cross-fade instead of hard-cutting.
// endFrame = the scene's durationInFrames; pass useCurrentFrame() as `frame`.
export function getExit(frame: number, fps: number, type = 'fade', endFrame = 150): React.CSSProperties {
    const out = fps * 0.5;
    const start = endFrame - out;
    if (frame < start) return {};
    const p = interpolate(frame, [start, endFrame], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
    switch (type) {
        case 'slide-up':
            return { opacity: p, transform: `translateY(${interpolate(frame, [start, endFrame], [0, -50], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })}px)` };
        case 'scale':
            return { opacity: p, transform: `scale(${interpolate(frame, [start, endFrame], [1, 1.15], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })})` };
        case 'zoom-blur':
            return { opacity: p, filter: `blur(${interpolate(frame, [start, endFrame], [0, 12], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })}px)`, transform: `scale(${interpolate(frame, [start, endFrame], [1, 1.1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })})` };
        default:
            return { opacity: p };
    }
}

// ─── Ambient effect layers ───────────────────────────────────────────────────
// All absolutely-positioned, low z-index; drop them behind scene content for depth.

// Film-grain / noise overlay for texture (2026 "authentic/handmade" trend).
export const Grain: React.FC<{ opacity?: number }> = ({ opacity = 0.06 }) => {
    const frame = useCurrentFrame();
    const shift = (frame % 6) * 13; // jitter the noise so it feels alive
    return (
        <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity, zIndex: 1, mixBlendMode: 'overlay', pointerEvents: 'none' }}>
            <filter id="mg-grain">
                <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed={2 + (frame % 4)} stitchTiles="stitch" />
                <feColorMatrix type="saturate" values="0" />
            </filter>
            <rect width="100%" height="100%" filter="url(#mg-grain)" transform={`translate(${shift} 0)`} />
        </svg>
    );
};

// Drifting particle field — soft points floating upward with parallax depth.
export const ParticleField: React.FC<{ color: string; count?: number; seed?: number }> = ({ color, count = 26, seed = 7 }) => {
    const frame = useCurrentFrame();
    const { height, width } = useVideoConfig();
    return (
        <div style={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none', overflow: 'hidden' }}>
            {Array.from({ length: count }, (_, i) => {
                const r1 = seededRandom(seed + i * 3.1);
                const r2 = seededRandom(seed + i * 7.7);
                const r3 = seededRandom(seed + i * 1.3);
                const size = 2 + r3 * 6;
                const speed = 0.15 + r2 * 0.5;
                const x = r1 * width;
                const drift = Math.sin((frame * 0.02) + i) * 30;
                const y = (height - ((frame * speed + r2 * height) % (height + 100)));
                const twinkle = 0.3 + Math.abs(Math.sin(frame * 0.05 + i)) * 0.6;
                return (
                    <div key={i} style={{ position: 'absolute', left: x + drift, top: y, width: size, height: size, borderRadius: '50%', background: color, opacity: twinkle * (0.3 + r3 * 0.5), boxShadow: `0 0 ${size * 2}px ${color}` }} />
                );
            })}
        </div>
    );
};

// Large blurred geometric shapes drifting slowly — abstract depth background.
export const FloatingShapes: React.FC<{ color: string; secondary?: string; count?: number; seed?: number }> = ({ color, secondary, count = 5, seed = 3 }) => {
    const frame = useCurrentFrame();
    const sec = secondary || color;
    return (
        <div style={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none', overflow: 'hidden' }}>
            {Array.from({ length: count }, (_, i) => {
                const r1 = seededRandom(seed + i * 5.5);
                const r2 = seededRandom(seed + i * 2.2);
                const size = 180 + r1 * 320;
                const left = `${r1 * 90 - 5}%`;
                const top = `${r2 * 90 - 5}%`;
                const floatX = Math.sin(frame * 0.01 + i) * 40;
                const floatY = Math.cos(frame * 0.012 + i * 1.7) * 40;
                const rot = frame * (0.05 + r2 * 0.1) + i * 40;
                const isCircle = i % 2 === 0;
                return (
                    <div key={i} style={{ position: 'absolute', left, top, width: size, height: size, borderRadius: isCircle ? '50%' : '30%', background: `radial-gradient(circle, ${i % 2 ? sec : color}22 0%, transparent 70%)`, filter: 'blur(50px)', transform: `translate(${floatX}px, ${floatY}px) rotate(${rot}deg)` }} />
                );
            })}
        </div>
    );
};

// Moving spotlight — a soft radial light that sweeps across the frame.
export const Spotlight: React.FC<{ color: string }> = ({ color }) => {
    const frame = useCurrentFrame();
    const x = 50 + Math.sin(frame * 0.02) * 30;
    const y = 40 + Math.cos(frame * 0.015) * 20;
    return <div style={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none', background: `radial-gradient(circle at ${x}% ${y}%, ${color}22 0%, transparent 45%)` }} />;
};

// Edge vignette + subtle breathing accent glow around the frame.
export const VignetteGlow: React.FC<{ color: string; strength?: number }> = ({ color, strength = 0.55 }) => {
    const frame = useCurrentFrame();
    const breathe = strength + Math.sin(frame * 0.05) * 0.1;
    return (
        <>
            <div style={{ position: 'absolute', inset: 0, zIndex: 1, pointerEvents: 'none', boxShadow: `inset 0 0 300px rgba(0,0,0,${breathe})` }} />
            <div style={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none', boxShadow: `inset 0 0 160px ${color}22` }} />
        </>
    );
};

// Animated multi-blob gradient mesh — richer replacement for a flat background.
export const GradientMesh: React.FC<{ color: string; secondary?: string; bg?: string }> = ({ color, secondary, bg = '#0a0a0f' }) => {
    const frame = useCurrentFrame();
    const sec = secondary || color;
    const a = 30 + Math.sin(frame * 0.02) * 15;
    const b = 70 + Math.cos(frame * 0.017) * 15;
    const c = 50 + Math.sin(frame * 0.013) * 20;
    return (
        <div style={{
            position: 'absolute', inset: 0, zIndex: 0,
            background: `radial-gradient(circle at ${a}% 30%, ${color}33 0%, transparent 45%),
                         radial-gradient(circle at ${b}% 70%, ${sec}2b 0%, transparent 45%),
                         radial-gradient(circle at ${c}% ${a}%, ${color}22 0%, transparent 40%),
                         ${bg}`,
        }} />
    );
};

// Ken Burns wrapper — slow cinematic zoom + pan applied to children (usually an image).
export const KenBurns: React.FC<{ children: React.ReactNode; durationSec?: number; zoom?: number; style?: React.CSSProperties }> = ({ children, durationSec = 6, zoom = 1.15, style }) => {
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();
    const s = interpolate(frame, [0, durationSec * fps], [1, zoom], { extrapolateRight: 'clamp' });
    const panX = interpolate(frame, [0, durationSec * fps], [0, -3], { extrapolateRight: 'clamp' });
    const panY = interpolate(frame, [0, durationSec * fps], [0, -2], { extrapolateRight: 'clamp' });
    return <div style={{ position: 'absolute', inset: 0, transform: `scale(${s}) translate(${panX}%, ${panY}%)`, ...style }}>{children}</div>;
};

// Parallax wrapper — offsets children slightly by a depth factor for layered motion.
export const ParallaxLayer: React.FC<{ children: React.ReactNode; depth?: number; style?: React.CSSProperties }> = ({ children, depth = 1, style }) => {
    const frame = useCurrentFrame();
    const x = Math.sin(frame * 0.015) * 10 * depth;
    const y = Math.cos(frame * 0.012) * 8 * depth;
    return <div style={{ transform: `translate(${x}px, ${y}px)`, ...style }}>{children}</div>;
};

// Legacy shared backgrounds (kept here so scenes can import a single module).
export const MeshBg: React.FC<{ color: string }> = ({ color }) => (
    <div style={{ position: 'absolute', inset: 0, backgroundImage: `linear-gradient(${color}12 1px, transparent 1px), linear-gradient(90deg, ${color}12 1px, transparent 1px)`, backgroundSize: '80px 80px', zIndex: 0 }} />
);

export const OrbBg: React.FC<{ color: string; secondary: string; frame: number; fps: number }> = ({ color, secondary, frame, fps }) => {
    const pulse = interpolate(frame, [0, fps * 2], [1, 1.2], { extrapolateRight: 'clamp' });
    return (
        <>
            <div style={{ position: 'absolute', width: '50%', height: '50%', top: '25%', left: '25%', background: `radial-gradient(circle, ${color}25 0%, transparent 70%)`, filter: 'blur(80px)', transform: `scale(${pulse})`, zIndex: 0 }} />
            <div style={{ position: 'absolute', width: '30%', height: '30%', top: '10%', right: '15%', background: `radial-gradient(circle, ${secondary}20 0%, transparent 70%)`, filter: 'blur(60px)', zIndex: 0 }} />
            <div style={{ position: 'absolute', width: '25%', height: '25%', bottom: '15%', left: '10%', background: `radial-gradient(circle, ${color}15 0%, transparent 70%)`, filter: 'blur(50px)', zIndex: 0 }} />
        </>
    );
};

// Small string→text coercion used by data scenes before .split/.map (guards the
// class of crash where an upstream value arrives as a number/object/array).
export const toText = (v: unknown): string => {
    if (v == null) return '';
    if (Array.isArray(v)) return v.map(toText).join(', ');
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    return '';
};

// Parse a numeric value out of any format ("10K", "1,000+", 42, etc.).
export const parseNum = (v: unknown, fallback = 0): number => {
    const n = parseFloat(String(v ?? '').replace(/[^0-9.]/g, ''));
    return isNaN(n) ? fallback : n;
};
