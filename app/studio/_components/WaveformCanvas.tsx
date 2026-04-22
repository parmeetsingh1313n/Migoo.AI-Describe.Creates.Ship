"use client"
import { useCallback, useEffect, useRef, useState } from 'react'

/* ── Helpers ───────────────────────────────────────────────────────────── */

export async function extractPeaks(base64Audio: string, barCount = 200): Promise<number[]> {
    const binaryString = atob(base64Audio)
    const len = binaryString.length
    const bytes = new Uint8Array(len)
    for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i)

    const buffer = bytes.buffer.slice(0) // copy so decodeAudioData doesn't detach

    const ctx = new AudioContext()
    try {
        const audioBuffer = await ctx.decodeAudioData(buffer)
        const channel = audioBuffer.getChannelData(0)

        const step = Math.max(1, Math.floor(channel.length / barCount))
        const peaks: number[] = []
        for (let i = 0; i < barCount; i++) {
            let sum = 0
            const start = i * step
            const end = Math.min(start + step, channel.length)
            for (let j = start; j < end; j++) sum += Math.abs(channel[j])
            peaks.push(sum / (end - start || 1))
        }

        const max = Math.max(...peaks, 0.001)
        return peaks.map(v => v / max)
    } finally {
        await ctx.close()
    }
}

export function getWavDuration(base64Audio: string): number {
    try {
        const binaryString = atob(base64Audio)
        const bytes = new Uint8Array(binaryString.length)
        for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i)

        const view = new DataView(bytes.buffer)
        const sampleRate = view.getUint32(24, true)
        const bitsPerSample = view.getUint16(34, true)
        const channels = view.getUint16(22, true)
        const dataSize = bytes.length - 44
        return dataSize / (sampleRate * (bitsPerSample / 8) * channels)
    } catch {
        return 0
    }
}

export function mergeWavBase64ToBlob(audios: string[]): Blob {
    if (audios.length === 0) return new Blob()

    const buffers = audios.map(b64 => {
        const binary = atob(b64)
        const bytes = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
        return bytes
    })

    const pcmChunks = buffers.map(b => b.slice(44))
    const totalPcm = pcmChunks.reduce((s, c) => s + c.length, 0)

    const header = new Uint8Array(44)
    header.set(buffers[0].slice(0, 44))
    const view = new DataView(header.buffer)
    view.setUint32(4, totalPcm + 36, true)
    view.setUint32(40, totalPcm, true)

    const merged = new Uint8Array(44 + totalPcm)
    merged.set(header)
    let offset = 44
    for (const chunk of pcmChunks) {
        merged.set(chunk, offset)
        offset += chunk.length
    }

    return new Blob([merged], { type: 'audio/wav' })
}

/* ── Component ─────────────────────────────────────────────────────────── */

interface WaveformCanvasProps {
    peaks: number[]
    progress: number            // 0-1
    onSeek?: (progress: number) => void
    height?: number
    barColor?: string
    progressColor?: string
    cursorColor?: string
    sceneMarkers?: number[]     // positions 0-1 where scene boundaries are
    className?: string
}

export default function WaveformCanvas({
    peaks,
    progress,
    onSeek,
    height = 48,
    barColor = 'rgba(148, 163, 184, 0.35)',
    progressColor = 'rgba(139, 92, 246, 0.9)',
    cursorColor = 'rgba(0, 0, 0, 0.75)',
    sceneMarkers,
    className = '',
}: WaveformCanvasProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const [canvasWidth, setCanvasWidth] = useState(0)

    // Observe container width
    useEffect(() => {
        const el = containerRef.current
        if (!el) return
        const ro = new ResizeObserver(entries => {
            for (const entry of entries) setCanvasWidth(entry.contentRect.width)
        })
        ro.observe(el)
        setCanvasWidth(el.clientWidth)
        return () => ro.disconnect()
    }, [])

    // Draw waveform
    useEffect(() => {
        const canvas = canvasRef.current
        if (!canvas || peaks.length === 0 || canvasWidth === 0) return

        const ctx = canvas.getContext('2d')
        if (!ctx) return

        const dpr = window.devicePixelRatio || 1
        canvas.width = canvasWidth * dpr
        canvas.height = height * dpr
        ctx.scale(dpr, dpr)
        ctx.clearRect(0, 0, canvasWidth, height)

        const barCount = peaks.length
        const gap = canvasWidth / barCount
        const barWidth = Math.max(1.5, gap * 0.6)
        const progressX = progress * canvasWidth
        const halfH = height / 2

        for (let i = 0; i < barCount; i++) {
            const x = i * gap + (gap - barWidth) / 2
            const barH = Math.max(2, peaks[i] * height * 0.82)
            const y = halfH - barH / 2

            ctx.fillStyle = (x + barWidth) <= progressX ? progressColor : barColor
            ctx.beginPath()
            ctx.roundRect(x, y, barWidth, barH, barWidth / 2)
            ctx.fill()
        }

        // Scene boundary markers
        if (sceneMarkers) {
            ctx.strokeStyle = 'rgba(99, 102, 241, 0.25)'
            ctx.lineWidth = 1
            ctx.setLineDash([2, 4])
            for (const pos of sceneMarkers) {
                const x = pos * canvasWidth
                ctx.beginPath()
                ctx.moveTo(x, 4)
                ctx.lineTo(x, height - 4)
                ctx.stroke()
            }
            ctx.setLineDash([])
        }

        // Playback cursor
        if (progress > 0.001 && progress < 0.999) {
            ctx.fillStyle = cursorColor
            ctx.beginPath()
            ctx.roundRect(progressX - 1, 0, 2, height, 1)
            ctx.fill()
        }
    }, [peaks, progress, canvasWidth, height, barColor, progressColor, cursorColor, sceneMarkers])

    const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        if (!onSeek || !canvasRef.current) return
        const rect = canvasRef.current.getBoundingClientRect()
        const x = e.clientX - rect.left
        onSeek(Math.max(0, Math.min(1, x / rect.width)))
    }, [onSeek])

    return (
        <div ref={containerRef} className={`w-full relative ${className}`} style={{ height }}>
            <canvas
                ref={canvasRef}
                onClick={handleClick}
                className="absolute inset-0"
                style={{ width: '100%', height: '100%', cursor: onSeek ? 'pointer' : 'default' }}
            />
        </div>
    )
}
