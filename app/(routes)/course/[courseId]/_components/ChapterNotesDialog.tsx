"use client"
import React, { useRef, useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X, Download, Loader2, Check, FileText, Sparkles, BookOpen, RotateCw, Trash2, LayoutGrid, Table, Clock, Radar } from 'lucide-react'
import jsPDF from 'jspdf'
import { toPng } from 'html-to-image'
import axios from 'axios'
import { toast } from 'sonner'
import DrawOutlineButton from '@/components/ui/DrawOutlineButton'

type DesignKey = 'abstractPastel' | 'geoPebbles' | 'botanical' | 'elegantLeaf'
const DESIGNS: Record<DesignKey, { label: string; img: string; pageBg: string; accent: string; accentLight: string; accentBorder: string; text: string; muted: string; headerGrad: string }> = {
  abstractPastel: { label: 'Abstract Pastel', img: '/notes-design/d1.jpg', pageBg: '#ffffff', accent: '#c06080', accentLight: '#fdf2f6', accentBorder: '#e8a0b8', text: '#3d3040', muted: '#8a7a8a', headerGrad: 'linear-gradient(135deg,#c06080,#a0508a)' },
  geoPebbles: { label: 'Geo Pebbles', img: '/notes-design/d2.png', pageBg: '#ffffff', accent: '#2b7a78', accentLight: '#e6f4f4', accentBorder: '#7ac0be', text: '#2d3748', muted: '#718096', headerGrad: 'linear-gradient(135deg,#2b7a78,#3d5a80)' },
  botanical: { label: 'Botanical', img: '/notes-design/d3.png', pageBg: '#f5f0e8', accent: '#5a6b4f', accentLight: '#eee9df', accentBorder: '#a3b096', text: '#3a3f32', muted: '#6b7c60', headerGrad: 'linear-gradient(135deg,#7a8f6e,#5a6b4f)' },
  elegantLeaf: { label: 'Elegant Leaf', img: '/notes-design/d4.png', pageBg: '#fdfcf9', accent: '#4a6274', accentLight: '#edf1f5', accentBorder: '#93a8b8', text: '#2c3e50', muted: '#6b7b8d', headerGrad: 'linear-gradient(135deg,#4a6274,#34495e)' },
}
const DESIGN_KEYS = Object.keys(DESIGNS) as DesignKey[]

const A4_W = 794, A4_H = 1123, PAD = 55

function imgToDataUrl(src: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image(); img.crossOrigin = 'anonymous'
    img.onload = () => { const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext('2d')!.drawImage(img, 0, 0); resolve(c.toDataURL('image/png')) }
    img.onerror = reject; img.src = src
  })
}

// ── Render a single section based on type ────────────────────────────────────
function NoteSection({ section, index, d }: { section: any; index: number; d: typeof DESIGNS.botanical }) {
  const type = section.type || 'bullets'
  return (
    <div style={{ marginBottom: 16, pageBreakInside: 'avoid' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
        <div style={{ width: 22, height: 22, borderRadius: '50%', background: d.headerGrad, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 9, flexShrink: 0 }}>{index + 1}</div>
        <h3 style={{ margin: 0, fontSize: 12, fontWeight: 700, color: d.text, fontFamily: 'Georgia,serif' }}>{section.heading || section.title}</h3>
      </div>
      <div style={{ marginLeft: 30 }}>
        {(type === 'bullets' || type === 'numbered') && (
          <ul style={{ margin: 0, paddingLeft: type === 'numbered' ? 14 : 0, listStyle: type === 'numbered' ? 'decimal' : 'none' }}>
            {(section.bullets || section.points || []).map((b: string, i: number) => (
              <li key={i} style={{ fontSize: 9.5, color: d.text, lineHeight: 1.5, marginBottom: 2.5, display: type === 'bullets' ? 'flex' : 'list-item', alignItems: 'flex-start', gap: 5 }}>
                {type === 'bullets' && <span style={{ width: 4, height: 4, borderRadius: '50%', background: d.accent, marginTop: 4.5, flexShrink: 0 }} />}
                {b}
              </li>
            ))}
          </ul>
        )}
        {type === 'table' && section.table && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 8.5, marginTop: 4 }}>
            <thead><tr>{(section.table.headers || []).map((h: string, i: number) => (
              <th key={i} style={{ padding: '4px 6px', background: d.accentLight, border: `1px solid ${d.accentBorder}`, color: d.text, fontWeight: 700, textAlign: 'left' }}>{h}</th>
            ))}</tr></thead>
            <tbody>{(section.table.rows || []).map((row: string[], ri: number) => (
              <tr key={ri}>{row.map((cell: string, ci: number) => (
                <td key={ci} style={{ padding: '3px 6px', border: `1px solid ${d.accentBorder}`, color: d.text }}>{cell}</td>
              ))}</tr>
            ))}</tbody>
          </table>
        )}
        {type === 'callout' && <div style={{ background: d.accentLight, borderLeft: `3px solid ${d.accent}`, borderRadius: '0 6px 6px 0', padding: '6px 9px', marginTop: 4 }}><p style={{ margin: 0, fontSize: 9.5, color: d.text, fontStyle: 'italic', lineHeight: 1.4 }}>💡 {section.calloutText}</p></div>}
        {type === 'highlight' && <div style={{ background: d.accentLight, border: `1px solid ${d.accentBorder}`, borderRadius: 8, padding: '7px 9px', marginTop: 4 }}><strong style={{ fontSize: 10, color: d.accent }}>{section.highlightTitle}</strong><p style={{ margin: '2px 0 0', fontSize: 9.5, color: d.text, lineHeight: 1.4 }}>{section.highlightBody}</p></div>}
        {(type === 'cards' || type === 'numbered-grid') && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 5, marginTop: 4 }}>
            {(section.cards || section.items || []).map((c: any, i: number) => (
              <div key={i} style={{ background: d.accentLight, border: `1px solid ${d.accentBorder}`, borderRadius: 7, padding: '5px 7px' }}>
                <strong style={{ fontSize: 9, color: d.accent }}>{c.title || c.label}</strong>
                <p style={{ margin: '1px 0 0', fontSize: 8.5, color: d.text, lineHeight: 1.4 }}>{c.description || c.detail}</p>
              </div>
            ))}
          </div>
        )}
        {(type === 'flowchart' || type === 'horizontal-flowchart' || type === 'step-cards') && (
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginTop: 12, position: 'relative', padding: '10px 0' }}>
            {(section.steps || []).map((s: any, i: number) => {
              const stepLetter = String.fromCharCode(65 + i) // A, B, C...
              const icons = ['💼', '💻', '🎯', '🚀', '🧠', '📊']
              const icon = s.icon || icons[i % icons.length]
              const colors = [
                'linear-gradient(135deg, #a3e635, #65a30d)', // Greenish
                'linear-gradient(135deg, #34d399, #059669)', // Teal
                'linear-gradient(135deg, #60a5fa, #2563eb)', // Blue
                'linear-gradient(135deg, #c084fc, #7c3aed)'  // Purple
              ]
              const grad = colors[i % colors.length]

              return (
                <div key={i} style={{ 
                  flex: 1, 
                  display: 'flex', 
                  flexDirection: 'column', 
                  alignItems: 'center', 
                  position: 'relative', 
                  textAlign: 'center'
                }}>
                  {/* Connecting Line to next step */}
                  {i < (section.steps || []).length - 1 && (
                    <div style={{ 
                      position: 'absolute', 
                      top: 23, 
                      left: 'calc(50% + 26px)', 
                      right: 'calc(-50% + 26px)', 
                      height: 1, 
                      background: d.accentBorder, 
                      zIndex: 1 
                    }} />
                  )}

                  {/* Circular Step Badge */}
                  <div style={{ 
                    width: 46, 
                    height: 46, 
                    borderRadius: '50%', 
                    background: grad, 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'center', 
                    fontSize: 18, 
                    color: '#fff',
                    position: 'relative', 
                    boxShadow: '0 4px 10px rgba(0,0,0,0.15)',
                    zIndex: 2
                  }}>
                    {icon}
                    {/* Step Indicator Letter (A, B, C...) */}
                    <div style={{ 
                      position: 'absolute', 
                      top: -2, 
                      right: -2, 
                      width: 14, 
                      height: 14, 
                      borderRadius: '50%', 
                      background: '#fff', 
                      border: `1.5px solid ${d.accentBorder}`, 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'center', 
                      fontSize: 7.5, 
                      fontWeight: 900, 
                      color: d.text 
                    }}>
                      {stepLetter}
                    </div>
                  </div>

                  {/* Text Details */}
                  <div style={{ marginTop: 10, padding: '0 4px' }}>
                    <strong style={{ 
                      fontSize: 8.5, 
                      fontWeight: 800, 
                      color: d.text, 
                      textTransform: 'uppercase', 
                      letterSpacing: 0.3,
                      display: 'block'
                    }}>
                      {s.label || s.title}
                    </strong>
                    <span style={{ 
                      fontSize: 7.5, 
                      color: d.muted, 
                      lineHeight: 1.3, 
                      display: 'block', 
                      marginTop: 4 
                    }}>
                      {s.detail || s.description}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
        {(type === 'circular-map' || type === 'radial-list') && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 8, position: 'relative' }}>
            {/* Left Circular Badge */}
            <div style={{ 
              width: 80, 
              height: 80, 
              borderRadius: '50%', 
              border: `2px solid ${d.accent}`, 
              background: d.accentLight, 
              display: 'flex', 
              flexDirection: 'column',
              alignItems: 'center', 
              justifyContent: 'center', 
              textAlign: 'center', 
              padding: 6,
              boxShadow: `0 0 0 3px #fff, 0 4px 15px rgba(0,0,0,0.06)`,
              flexShrink: 0,
              position: 'relative'
            }}>
              <span style={{ fontSize: 8, fontWeight: 900, color: d.accent, textTransform: 'uppercase', letterSpacing: 0.5, lineHeight: 1.2 }}>
                {section.centerLabel || 'Key Takeaways'}
              </span>
            </div>

            {/* Connector Dots & Lines */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20, position: 'absolute', left: 88, top: '50%', transform: 'translateY(-50%)', zIndex: 1 }}>
              {(section.items || []).slice(0, 3).map((_: any, i: number) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <div style={{ width: 14, height: 1, background: d.accentBorder }} />
                  <div style={{ width: 4, height: 4, borderRadius: '50%', background: d.accent }} />
                </div>
              ))}
            </div>

            {/* Right Cards List */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6, paddingLeft: 18 }}>
              {(section.items || []).map((it: any, i: number) => {
                const icons = ['💼', '💻', '🎯', '🚀', '🧠', '📊']
                const icon = it.icon || icons[i % icons.length]
                return (
                  <div key={i} style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: 10, 
                    background: d.accentLight, 
                    border: `1px solid ${d.accentBorder}`, 
                    borderRadius: 12, 
                    padding: '6px 12px',
                    boxShadow: '0 2px 6px rgba(0,0,0,0.02)'
                  }}>
                    <div style={{ 
                      width: 24, 
                      height: 24, 
                      borderRadius: 8, 
                      background: d.headerGrad, 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'center', 
                      fontSize: 11,
                      color: '#fff',
                      flexShrink: 0
                    }}>
                      {icon}
                    </div>
                    <div>
                      <strong style={{ fontSize: 9, color: d.text, display: 'block' }}>{it.title}</strong>
                      <span style={{ fontSize: 8, color: d.muted, lineHeight: 1.3, display: 'block', marginTop: 1 }}>{it.description}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
        {type === 'quote-cards' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 4, marginTop: 4 }}>
            {(section.quotes || []).map((q: any, i: number) => (
              <div key={i} style={{ background: d.accentLight, borderTop: `3px solid ${d.accent}`, borderRadius: 7, padding: '5px 7px' }}>
                <strong style={{ fontSize: 8.5, color: d.accent }}>{q.title}</strong>
                <p style={{ margin: '2px 0 0', fontSize: 8.5, color: d.text, fontStyle: 'italic', lineHeight: 1.35 }}>"{q.text}"</p>
              </div>
            ))}
          </div>
        )}

        {/* ── Timeline ── */}
        {type === 'timeline' && (
          <div style={{ marginTop: 4, position: 'relative', paddingLeft: 18 }}>
            <div style={{ position: 'absolute', left: 5, top: 2, bottom: 2, width: 2, background: d.accentBorder, borderRadius: 2 }} />
            {(section.events || []).map((ev: any, i: number) => (
              <div key={i} style={{ position: 'relative', marginBottom: 8, paddingLeft: 10 }}>
                <div style={{ position: 'absolute', left: -17, top: 3, width: 10, height: 10, borderRadius: '50%', background: d.headerGrad, border: `2px solid ${d.accentLight}`, boxShadow: `0 0 0 2px ${d.accentBorder}` }} />
                <div style={{ fontSize: 7.5, fontWeight: 700, color: d.accent, textTransform: 'uppercase', letterSpacing: 0.5 }}>{ev.date}</div>
                <div style={{ fontSize: 9.5, fontWeight: 700, color: d.text, marginTop: 1 }}>{ev.title}</div>
                <div style={{ fontSize: 8.5, color: d.muted, lineHeight: 1.4, marginTop: 1 }}>{ev.description}</div>
              </div>
            ))}
          </div>
        )}

        {/* ── Comparison (VS) ── */}
        {type === 'comparison' && (
          <div style={{ marginTop: 4 }}>
            <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
              <div style={{ flex: 1, background: d.headerGrad, color: '#fff', fontSize: 9, fontWeight: 700, padding: '3px 8px', borderRadius: '8px 0 0 8px', textAlign: 'center' }}>{section.leftLabel || 'Option A'}</div>
              <div style={{ width: 22, background: d.accentLight, border: `1px solid ${d.accentBorder}`, borderRadius: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 7, fontWeight: 800, color: d.accent }}>VS</div>
              <div style={{ flex: 1, background: d.accent, color: '#fff', fontSize: 9, fontWeight: 700, padding: '3px 8px', borderRadius: '0 8px 8px 0', textAlign: 'center' }}>{section.rightLabel || 'Option B'}</div>
            </div>
            {(section.points || []).map((p: any, i: number) => (
              <div key={i} style={{ display: 'flex', gap: 4, marginBottom: 3 }}>
                <div style={{ flex: 1, background: d.accentLight, border: `1px solid ${d.accentBorder}`, borderRadius: 6, padding: '3px 6px', fontSize: 8, color: d.text, lineHeight: 1.35 }}>{p.left}</div>
                <div style={{ width: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 7, color: d.muted, fontWeight: 600, flexShrink: 0 }}>{p.aspect}</div>
                <div style={{ flex: 1, background: d.accentLight, border: `1px solid ${d.accentBorder}`, borderRadius: 6, padding: '3px 6px', fontSize: 8, color: d.text, lineHeight: 1.35 }}>{p.right}</div>
              </div>
            ))}
          </div>
        )}

        {/* ── Stats Row ── */}
        {type === 'stats-row' && (
          <div style={{ display: 'flex', gap: 5, marginTop: 4 }}>
            {(section.stats || []).map((st: any, i: number) => (
              <div key={i} style={{ flex: 1, background: d.accentLight, border: `1px solid ${d.accentBorder}`, borderRadius: 10, padding: '8px 6px', textAlign: 'center' }}>
                <div style={{ fontSize: 14 }}>{st.icon || '📊'}</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: d.accent, lineHeight: 1.2, marginTop: 2 }}>{st.value}</div>
                <div style={{ fontSize: 7.5, color: d.muted, marginTop: 2, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.3 }}>{st.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* ── Definition List ── */}
        {type === 'definition-list' && (
          <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {(section.definitions || []).map((def: any, i: number) => (
              <div key={i} style={{ display: 'flex', gap: 0, borderRadius: 7, overflow: 'hidden', border: `1px solid ${d.accentBorder}` }}>
                <div style={{ width: 4, background: d.headerGrad, flexShrink: 0 }} />
                <div style={{ padding: '4px 8px', background: d.accentLight, flex: 1 }}>
                  <strong style={{ fontSize: 9.5, color: d.accent }}>{def.term}</strong>
                  <p style={{ margin: '1px 0 0', fontSize: 8.5, color: d.text, lineHeight: 1.4 }}>{def.meaning}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Checklist ── */}
        {type === 'checklist' && (
          <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 3 }}>
            {(section.items || []).map((it: any, i: number) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 8px', borderRadius: 6, background: it.checked ? d.accentLight : 'transparent', border: `1px solid ${it.checked ? d.accentBorder : 'transparent'}` }}>
                <div style={{ width: 14, height: 14, borderRadius: 4, border: `2px solid ${it.checked ? d.accent : d.accentBorder}`, background: it.checked ? d.accent : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  {it.checked && <span style={{ color: '#fff', fontSize: 8, fontWeight: 800 }}>✓</span>}
                </div>
                <span style={{ fontSize: 9, color: d.text, lineHeight: 1.4, textDecoration: it.checked ? 'none' : 'none' }}>{it.text}</span>
              </div>
            ))}
          </div>
        )}

        {/* ── Gradient Banner ── */}
        {type === 'gradient-banner' && (
          <div style={{ marginTop: 4, background: d.headerGrad, borderRadius: 10, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 20, flexShrink: 0 }}>{section.emoji || '🎯'}</span>
            <div>
              <div style={{ fontSize: 10.5, fontWeight: 800, color: '#fff', lineHeight: 1.3 }}>{section.bannerText}</div>
              {section.subText && <div style={{ fontSize: 8.5, color: 'rgba(255,255,255,0.75)', marginTop: 2, lineHeight: 1.3 }}>{section.subText}</div>}
            </div>
          </div>
        )}

        {/* ── Matrix (2×2 Quadrant) ── */}
        {type === 'matrix' && (
          <div style={{ marginTop: 4, display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 4 }}>
            {(section.quadrants || []).slice(0, 4).map((q: any, i: number) => {
              const colors = [d.headerGrad, d.accent, d.accent, d.headerGrad]
              return (
                <div key={i} style={{ background: d.accentLight, border: `1px solid ${d.accentBorder}`, borderRadius: 8, padding: '5px 7px', borderTop: `3px solid ${d.accent}` }}>
                  <div style={{ fontSize: 8.5, fontWeight: 800, color: d.accent, marginBottom: 3, textTransform: 'uppercase', letterSpacing: 0.3 }}>{q.label}</div>
                  {(q.items || []).map((item: string, j: number) => (
                    <div key={j} style={{ fontSize: 8, color: d.text, lineHeight: 1.4, display: 'flex', alignItems: 'flex-start', gap: 4, marginBottom: 1 }}>
                      <span style={{ width: 3, height: 3, borderRadius: '50%', background: d.accent, marginTop: 3.5, flexShrink: 0 }} />
                      {item}
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        )}

        {/* ── Icon List ── */}
        {type === 'icon-list' && (
          <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {(section.listItems || []).map((it: any, i: number) => (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '4px 8px', background: i % 2 === 0 ? d.accentLight : 'transparent', borderRadius: 7 }}>
                <span style={{ fontSize: 12, flexShrink: 0, marginTop: 0 }}>{it.emoji || '🔹'}</span>
                <div>
                  <strong style={{ fontSize: 9, color: d.accent }}>{it.title}</strong>
                  <p style={{ margin: '1px 0 0', fontSize: 8.5, color: d.text, lineHeight: 1.4 }}>{it.detail}</p>
                </div>
              </div>
            ))}
          </div>
        )}
        {/* ── AI-Generated Image (4 rotating styles from notes module) ── */}
        {type === 'ai-image' && section.imageUrl && (() => {
          const pat = section.imageStyle ?? (index % 4)
          const src = section.imageUrl
          const caption = section.prompt?.slice(0, 80) || 'AI Illustration'

          // STYLE 0: Polaroid with Washi Tape
          if (pat === 0) return (
            <figure style={{ margin: '8px auto 4px', width: '92%', background: '#fff', padding: '8px 8px 32px', boxShadow: '0 18px 50px rgba(0,0,0,0.15)', border: '1px solid rgba(0,0,0,0.06)', transform: 'rotate(-1deg)', position: 'relative' }}>
              <div style={{ position: 'absolute', top: -12, left: '50%', transform: 'translateX(-50%) rotate(3deg)', width: 70, height: 20, background: d.accentLight, opacity: 0.75, border: `1.5px dashed ${d.accent}`, zIndex: 10 }} />
              <div style={{ overflow: 'hidden', borderRadius: 2, border: '1px solid rgba(0,0,0,0.04)' }}>
                <img src={src} alt={caption} crossOrigin="anonymous" style={{ width: '100%', aspectRatio: '16/9', objectFit: 'cover', display: 'block', background: '#fafafa' }} />
              </div>
              <figcaption style={{ position: 'absolute', bottom: 8, left: 10, right: 10, textAlign: 'center', fontSize: 8, color: '#666', fontStyle: 'italic' }}>Illustration: {caption}</figcaption>
            </figure>
          )

          // STYLE 1: Tech/Modern with Glassmorphism Badge + Accent Corner
          if (pat === 1) return (
            <figure style={{ margin: '8px auto 4px', width: '94%', position: 'relative', padding: 8 }}>
              <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(135deg, ${d.accentLight} 0%, transparent 100%)`, borderRadius: 16, transform: 'scale(1.03) rotate(0.5deg)', opacity: 0.25, zIndex: 1 }} />
              <div style={{ position: 'relative', background: '#fff', borderRadius: 14, padding: 4, border: `2px solid ${d.accentBorder}`, boxShadow: `0 10px 35px rgba(0,0,0,0.1)`, zIndex: 2, overflow: 'hidden' }}>
                <img src={src} alt={caption} crossOrigin="anonymous" style={{ width: '100%', aspectRatio: '16/9', objectFit: 'cover', display: 'block', borderRadius: 10, background: '#fafafa' }} />
                <div style={{ position: 'absolute', bottom: 8, right: 8, background: 'rgba(255,255,255,0.75)', backdropFilter: 'blur(10px)', padding: '3px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.4)', fontSize: 8, fontWeight: 900, color: d.accent, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Visual Context</div>
              </div>
              <div style={{ position: 'absolute', top: 0, left: 0, width: 35, height: 35, borderTop: `4px solid ${d.accent}`, borderLeft: `4px solid ${d.accent}`, zIndex: 3 }} />
            </figure>
          )

          // STYLE 2: Notebook Sketch with Dashed Border
          if (pat === 2) return (
            <figure style={{ margin: '8px auto 4px', width: '92%', background: '#fdfbf7', padding: 12, border: '1px solid #d8d3c9', boxShadow: '2px 4px 12px rgba(0,0,0,0.08)', position: 'relative', backgroundImage: 'radial-gradient(#d1d1d1 1px, transparent 0)', backgroundSize: '16px 16px' }}>
              <div style={{ position: 'absolute', inset: 5, border: '1.5px dashed #aaa', borderRadius: 4, pointerEvents: 'none' }} />
              <div style={{ position: 'relative', zIndex: 2, borderRadius: 4, overflow: 'hidden', border: '1px solid #eee' }}>
                <img src={src} alt={caption} crossOrigin="anonymous" style={{ width: '100%', aspectRatio: '16/9', objectFit: 'cover', display: 'block', filter: 'contrast(1.05) saturate(0.9)', background: '#fafafa' }} />
              </div>
              <figcaption style={{ marginTop: 8, fontSize: 8, color: '#666', fontStyle: 'italic', textAlign: 'right', paddingRight: 8 }}>Illustration: {caption}</figcaption>
            </figure>
          )

          // STYLE 3: Dual-border with Comparative View badge
          return (
            <figure style={{ margin: '8px auto 4px', width: '94%', position: 'relative', padding: 8, transform: 'rotate(0.5deg)' }}>
              <div style={{ position: 'relative', background: '#fff', borderRadius: 14, padding: 4, border: `2px solid ${d.accentBorder}`, boxShadow: '0 15px 45px rgba(0,0,0,0.12)', overflow: 'hidden' }}>
                <img src={src} alt={caption} crossOrigin="anonymous" style={{ width: '100%', aspectRatio: '16/9', objectFit: 'cover', display: 'block', borderRadius: 10, background: '#fafafa' }} />
                <div style={{ position: 'absolute', top: 8, right: 8, background: d.headerGrad, padding: '3px 10px', borderRadius: 8, fontSize: 8, fontWeight: 900, color: '#fff', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Comparative View</div>
              </div>
              <figcaption style={{ marginTop: 6, fontSize: 8, color: d.muted, fontStyle: 'italic', textAlign: 'center' }}>— {caption} —</figcaption>
            </figure>
          )
        })()}
      </div>
    </div>
  )
}

// ── Paginate sections into A4 pages ──────────────────────────────────────────
function paginateSections(sections: any[]) {
  // First page loses space to header + summary; subsequent pages just have a small top margin
  const FIRST = A4_H - PAD * 2 - 200, REST = A4_H - PAD * 2 - 40
  const est = (s: any) => {
    const t = s.type || 'bullets'
    const HEAD = 45 // section heading + margin
    const items = (s.bullets || s.points || s.cards || s.items || s.steps || s.quotes || s.events || s.definitions || s.listItems || s.stats || []).length
    // Grid-based types: 2 columns, so rows = ceil(items/2)
    const gridRows = Math.ceil(Math.max(items, 1) / 2)
    if (t === 'ai-image') return 300 // image frame + heading + caption
    if (t === 'gradient-banner') return HEAD + 60
    if (t === 'callout') return HEAD + 50
    if (t === 'highlight') return HEAD + 65
    if (t === 'comparison') return HEAD + 35 + (s.points?.length || 3) * 28
    if (t === 'matrix') return HEAD + gridRows * 80
    if (t === 'stats-row') return HEAD + 85
    if (t === 'table') return HEAD + ((s.table?.rows?.length || 3) + 1) * 24 + 10
    if (t === 'timeline') return HEAD + items * 50
    if (t === 'cards' || t === 'numbered-grid') return HEAD + gridRows * 55
    if (t === 'circular-map' || t === 'radial-list') return HEAD + 15 + items * 42
    if (t === 'flowchart' || t === 'horizontal-flowchart' || t === 'step-cards') return HEAD + 115
    if (t === 'quote-cards') return HEAD + Math.ceil(items / 3) * 60
    if (t === 'checklist') return HEAD + items * 26
    if (t === 'definition-list') return HEAD + items * 40
    if (t === 'icon-list') return HEAD + items * 36
    // bullets / numbered — each item can wrap to 2+ lines
    return HEAD + Math.max(items, 1) * 28
  }
  const pages: number[][] = [[]]; let used = 0, pi = 0
  sections.forEach((s: any, i: number) => {
    const h = est(s), avail = pi === 0 ? FIRST : REST
    if (used + h > avail && pages[pi].length > 0) { pi++; pages.push([i]); used = h } else { pages[pi].push(i); used += h }
  })
  return pages
}

// ── Notes Page ───────────────────────────────────────────────────────────────
function NotesPageRender({ sections, startIdx, bgDataUrl, d, title, pageNum, totalPages, summary }:
  { sections: any[]; startIdx: number; bgDataUrl: string; d: typeof DESIGNS.botanical; title: string; pageNum: number; totalPages: number; summary?: string }) {
  return (
    <div style={{ position: 'relative', width: A4_W, height: A4_H, background: d.pageBg, overflow: 'hidden', fontFamily: 'system-ui,sans-serif' }}>
      {bgDataUrl && <img src={bgDataUrl} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', zIndex: 0 }} />}
      <div style={{ position: 'relative', zIndex: 1, padding: PAD, height: '100%', display: 'flex', flexDirection: 'column' }}>
        {pageNum === 1 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ marginBottom: 10, paddingBottom: 8, borderBottom: `2px solid ${d.accentBorder}` }}>
              <div style={{ display: 'inline-block', background: d.headerGrad, color: '#fff', fontSize: 7.5, fontWeight: 700, padding: '2px 10px', borderRadius: 20, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 }}>Chapter Notes</div>
              <h1 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: d.text, fontFamily: 'Georgia,serif' }}>{title}</h1>
              <p style={{ margin: '2px 0 0', fontSize: 8, color: d.muted }}>{new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
            </div>
            {summary && (
              <div style={{ background: d.accentLight, border: `1px solid ${d.accentBorder}`, borderLeft: `4px solid ${d.accent}`, borderRadius: '0 8px 8px 0', padding: '7px 10px' }}>
                <div style={{ fontSize: 7.5, fontWeight: 700, color: d.accent, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 }}>📋 Chapter Summary</div>
                <p style={{ margin: 0, fontSize: 9, color: d.text, lineHeight: 1.5, fontStyle: 'italic' }}>{summary}</p>
              </div>
            )}
          </div>
        )}
        <div style={{ flex: 1, overflow: 'hidden' }}>
          {sections.map((s, i) => <NoteSection key={i} section={s} index={startIdx + i} d={d} />)}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, paddingTop: 6, borderTop: `1px solid ${d.accentBorder}`, opacity: 0.5 }}>
          <span style={{ fontSize: 7, color: d.muted }}>Generated by Migoo.AI</span>
          <span style={{ fontSize: 7, color: d.muted }}>Page {pageNum} / {totalPages}</span>
        </div>
      </div>
    </div>
  )
}

// ── Key Terms Glossary Page ──────────────────────────────────────────────────
function KeyTermsPage({ keyTerms, bgDataUrl, d, pageNum, totalPages }:
  { keyTerms: any[]; bgDataUrl: string; d: typeof DESIGNS.botanical; pageNum: number; totalPages: number }) {
  if (!keyTerms?.length) return null
  return (
    <div style={{ position: 'relative', width: A4_W, height: A4_H, background: d.pageBg, overflow: 'hidden', fontFamily: 'system-ui,sans-serif' }}>
      {bgDataUrl && <img src={bgDataUrl} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', zIndex: 0 }} />}
      <div style={{ position: 'relative', zIndex: 1, padding: PAD, height: '100%', display: 'flex', flexDirection: 'column' }}>
        <div style={{ marginBottom: 16, paddingBottom: 8, borderBottom: `2px solid ${d.accentBorder}` }}>
          <div style={{ display: 'inline-block', background: d.headerGrad, color: '#fff', fontSize: 7.5, fontWeight: 700, padding: '2px 10px', borderRadius: 20, letterSpacing: 1, textTransform: 'uppercase' }}>📚 Key Terms Glossary</div>
        </div>
        <div style={{ flex: 1, overflow: 'hidden', display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 8, alignContent: 'start' }}>
          {keyTerms.map((kt: any, i: number) => (
            <div key={i} style={{ display: 'flex', gap: 0, borderRadius: 8, overflow: 'hidden', border: `1px solid ${d.accentBorder}` }}>
              <div style={{ width: 4, background: d.headerGrad, flexShrink: 0 }} />
              <div style={{ padding: '6px 8px', background: d.accentLight, flex: 1 }}>
                <strong style={{ fontSize: 9.5, color: d.accent, display: 'block' }}>{kt.term}</strong>
                <p style={{ margin: '2px 0 0', fontSize: 8.5, color: d.text, lineHeight: 1.4 }}>{kt.definition}</p>
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, paddingTop: 6, borderTop: `1px solid ${d.accentBorder}`, opacity: 0.5 }}>
          <span style={{ fontSize: 7, color: d.muted }}>Generated by Migoo.AI</span>
          <span style={{ fontSize: 7, color: d.muted }}>Page {pageNum} / {totalPages}</span>
        </div>
      </div>
    </div>
  )
}



// ── Intro / Empty state ──────────────────────────────────────────────────────
function NotesIntro({ slideCount }: { slideCount: number; chapterTitle: string }) {
  const features = [
    { icon: LayoutGrid, label: 'Bento grids', tint: '#a78bfa' },
    { icon: Table, label: 'Comparison tables', tint: '#2dd4bf' },
    { icon: Clock, label: 'Timelines', tint: '#38bdf8' },
    { icon: Radar, label: 'Radial maps', tint: '#f59e0b' },
  ]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      {/* Faux document preview — layered, tilted pages */}
      <div style={{ position: 'relative', height: 168, display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 4 }}>
        {/* dotted texture backdrop */}
        <div style={{ position: 'absolute', inset: '-24px -24px 0', backgroundImage: 'radial-gradient(rgba(255,255,255,0.05) 1px, transparent 0)', backgroundSize: '14px 14px', maskImage: 'radial-gradient(ellipse 70% 80% at 50% 40%, #000 40%, transparent 100%)', WebkitMaskImage: 'radial-gradient(ellipse 70% 80% at 50% 40%, #000 40%, transparent 100%)' }} />
        {/* back page */}
        <div style={{ position: 'absolute', width: 118, height: 150, background: '#141b28', borderRadius: 8, border: '1px solid rgba(255,255,255,0.06)', transform: 'rotate(-9deg) translateX(-46px)', boxShadow: '0 12px 28px rgba(0,0,0,0.45)' }} />
        <div style={{ position: 'absolute', width: 118, height: 150, background: '#182031', borderRadius: 8, border: '1px solid rgba(255,255,255,0.07)', transform: 'rotate(7deg) translateX(46px)', boxShadow: '0 12px 28px rgba(0,0,0,0.45)' }} />
        {/* front page with real-looking content */}
        <div style={{ position: 'relative', width: 128, height: 162, background: 'linear-gradient(160deg,#20293b,#161d2b)', borderRadius: 10, border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 20px 45px rgba(0,0,0,0.6)', padding: '12px 12px 0', overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 9 }}>
            <div style={{ width: 16, height: 16, borderRadius: 5, background: 'linear-gradient(135deg,#f59e0b,#d97706)' }} />
            <div style={{ flex: 1, height: 5, borderRadius: 3, background: 'rgba(255,255,255,0.18)' }} />
            <div style={{ width: 18, height: 5, borderRadius: 3, background: 'rgba(245,158,11,0.5)' }} />
          </div>
          {[92, 78, 85].map((w, i) => <div key={i} style={{ height: 3.5, width: `${w}%`, borderRadius: 2, background: 'rgba(255,255,255,0.09)', marginBottom: 5 }} />)}
          {/* mini bento */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, margin: '9px 0' }}>
            <div style={{ height: 22, borderRadius: 5, background: 'rgba(167,139,250,0.16)', border: '1px solid rgba(167,139,250,0.25)' }} />
            <div style={{ height: 22, borderRadius: 5, background: 'rgba(45,212,191,0.14)', border: '1px solid rgba(45,212,191,0.22)' }} />
          </div>
          {/* mini table lines */}
          {[0, 1, 2].map((i) => (
            <div key={i} style={{ display: 'flex', gap: 4, marginBottom: 3 }}>
              <div style={{ flex: 1, height: 3, borderRadius: 2, background: i === 0 ? 'rgba(56,189,248,0.4)' : 'rgba(255,255,255,0.08)' }} />
              <div style={{ flex: 1, height: 3, borderRadius: 2, background: i === 0 ? 'rgba(56,189,248,0.4)' : 'rgba(255,255,255,0.08)' }} />
            </div>
          ))}
        </div>
      </div>

      {/* Headline block — left-aligned, editorial */}
      <div>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#f59e0b', boxShadow: '0 0 8px rgba(245,158,11,0.7)' }} />
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', color: '#f59e0b' }}>Study Dossier</span>
        </div>
        <h4 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 700, color: '#f8fafc', letterSpacing: '-0.02em', lineHeight: 1.25 }}>
          The whole chapter, distilled onto&nbsp;paper.
        </h4>
        <p style={{ margin: 0, fontSize: 12.5, color: '#8a96a8', lineHeight: 1.6 }}>
          Migoo reads every slide and rebuilds them as a printable set of notes — structured, cross-referenced, and ready to revise from.
        </p>
      </div>

      {/* Feature grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 8 }}>
        {features.map(({ icon: Icon, label, tint }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 11px', borderRadius: 12, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ width: 26, height: 26, borderRadius: 8, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: `${tint}1f`, border: `1px solid ${tint}40` }}>
              <Icon size={14} color={tint} />
            </div>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#cbd5e1' }}>{label}</span>
          </div>
        ))}
      </div>

      {/* Meta footer */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 4, fontSize: 11, color: '#64748b' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 9px', borderRadius: 20, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <FileText size={11} color="#94a3b8" /> {slideCount} slide{slideCount === 1 ? '' : 's'}
        </span>
        <span style={{ opacity: 0.6 }}>→</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 9px', borderRadius: 20, background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.15)', color: '#f59e0b', fontWeight: 600 }}>
          <BookOpen size={11} /> multi-page notes
        </span>
      </div>
    </div>
  )
}

// ── Main Dialog ──────────────────────────────────────────────────────────────
interface Props { open: boolean; onClose: () => void; chapterTitle: string; slides: any[]; courseId: string; chapterId: string }

export function ChapterNotesDialog({ open, onClose, chapterTitle, slides, courseId, chapterId }: Props) {
  const [selected, setSelected] = useState<DesignKey>('botanical')
  const [exporting, setExporting] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [notesData, setNotesData] = useState<any>(null)
  const [bgDataUrl, setBgDataUrl] = useState('')
  const hiddenRef = useRef<HTMLDivElement>(null)
  const [mounted, setMounted] = useState(false)

  // Cache key for localStorage persistence
  const cacheKey = `migoo_notes_${chapterId}`

  useEffect(() => { setMounted(true); return () => setMounted(false) }, [])
  useEffect(() => { if (!open) return; setBgDataUrl(''); imgToDataUrl(DESIGNS[selected].img).then(setBgDataUrl).catch(() => setBgDataUrl('')) }, [selected, open])

  // Load cached notes on open
  useEffect(() => {
    if (!open || notesData) return
    try {
      const cached = localStorage.getItem(cacheKey)
      if (cached) {
        const parsed = JSON.parse(cached)
        if (parsed?.mainNotes?.length) {
          setNotesData(parsed)
          toast.info('📄 Loaded previously generated notes')
        }
      }
    } catch {}
  }, [open])

  if (!open || !mounted) return null
  const d = DESIGNS[selected]

  const handleGenerate = async () => {
    setGenerating(true)
    try {
      toast.info('🧠 Generating rich study notes via Migoo AI…')
      const res = await axios.post('/api/course-notes/generate', { courseId, chapterId, chapterTitle })
      setNotesData(res.data.generatedData)
      // Persist to localStorage for instant reload
      try { localStorage.setItem(cacheKey, JSON.stringify(res.data.generatedData)) } catch {}
      toast.success('✅ Study notes generated successfully!')
    } catch (err: any) {
      console.error('Notes generation failed', err)
      toast.error(err.response?.data?.error || 'Notes generation failed')
    } finally { setGenerating(false) }
  }

  const handleExport = async () => {
    setExporting(true)
    try {
      let bg = bgDataUrl; if (!bg) try { bg = await imgToDataUrl(d.img) } catch {}
      const pageEls = Array.from(hiddenRef.current?.querySelectorAll('[data-notes-page]') || []) as HTMLElement[]
      if (!pageEls.length) { toast.error('No pages to export'); setExporting(false); return }
      const pdf = new jsPDF('p', 'mm', 'a4')
      for (let i = 0; i < pageEls.length; i++) {
        const dataUrl = await toPng(pageEls[i], { width: A4_W, height: A4_H, pixelRatio: 2, backgroundColor: d.pageBg, skipFonts: true, filter: (n: any) => { if (n.tagName === 'LINK') return false; if (n.tagName === 'STYLE' && n.textContent?.includes('@import')) return false; return true } })
        if (i > 0) pdf.addPage()
        pdf.addImage(dataUrl, 'PNG', 0, 0, 210, 297)
      }
      pdf.save(`${chapterTitle.replace(/[^a-z0-9]/gi, '_')}_notes.pdf`)
      toast.success(`✅ PDF exported (${pageEls.length} pages)`)
    } catch (err) { console.error('PDF export failed', err); toast.error('PDF export failed') }
    finally { setExporting(false) }
  }

  const handleRemoveNotes = () => {
    try {
      localStorage.removeItem(cacheKey)
      setNotesData(null)
      toast.success('🗑️ Notes cleared from local storage')
    } catch {
      toast.error('Failed to clear notes')
    }
  }


  const sections = notesData?.mainNotes || []
  const pages = paginateSections(sections)

  return createPortal(
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 9998, backdropFilter: 'blur(4px)' }} />
      
      <div style={{ 
        position: 'fixed', 
        top: '50%', 
        left: '50%', 
        transform: 'translate(-50%, -50%)', 
        zIndex: 9999, 
        width: notesData ? 980 : 540, 
        background: '#090d16', 
        borderRadius: 24, 
        border: '1px solid rgba(255,255,255,0.08)', 
        boxShadow: '0 25px 80px rgba(0,0,0,0.8)', 
        overflow: 'hidden',
        transition: 'width 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
        display: 'flex',
        flexDirection: 'column',
        maxHeight: '90vh'
      }}>
        {/* Header */}
        <div style={{ padding: '20px 24px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: 'linear-gradient(135deg,#f59e0b,#d97706)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 12px rgba(245,158,11,0.2)' }}>
              <BookOpen size={20} color="#fff" />
            </div>
            <div>
              <p style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#f8fafc', letterSpacing: '-0.02em' }}>Deep Study Notes</p>
              <p style={{ margin: 0, fontSize: 11, color: '#64748b' }}>{chapterTitle} • {slides.length} Slides</p>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {notesData && (
              <>
                <button 
                  onClick={handleGenerate} 
                  disabled={generating} 
                  title="Regenerate study notes"
                  style={{ background: 'rgba(255,255,255,0.03)', border: 'none', cursor: generating ? 'wait' : 'pointer', color: '#94a3b8', padding: 6, borderRadius: 10, display: 'flex', transition: 'background 0.2s', alignItems: 'center' }}
                >
                  {generating ? <Loader2 size={14} className="animate-spin" /> : <RotateCw size={14} />}
                </button>
                <button 
                  onClick={handleRemoveNotes} 
                  title="Remove study notes"
                  style={{ background: 'rgba(239,68,68,0.08)', border: 'none', cursor: 'pointer', color: '#f87171', padding: 6, borderRadius: 10, display: 'flex', transition: 'background 0.2s', alignItems: 'center' }}
                >
                  <Trash2 size={14} />
                </button>
              </>
            )}
            <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.03)', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: 6, borderRadius: 10, display: 'flex', transition: 'background 0.2s' }}><X size={18} /></button>
          </div>
        </div>

        {/* Content Area */}
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          
          {/* Controls Column */}
          <div style={{ width: notesData ? 360 : '100%', padding: 24, borderRight: notesData ? '1px solid rgba(255,255,255,0.06)' : 'none', display: 'flex', flexDirection: 'column', gap: 20, overflowY: 'auto' }}>
            
            {!notesData ? (
              <NotesIntro slideCount={slides.length} chapterTitle={chapterTitle} />
            ) : (
              <div>
                <p style={{ margin: '0 0 12px', fontSize: 11, color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>Note Template</p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 10 }}>
                  {DESIGN_KEYS.map(key => {
                    const isSel = selected === key
                    return (
                      <button key={key} onClick={() => setSelected(key)} style={{ background: '#111827', border: '1px solid rgba(255,255,255,0.05)', cursor: 'pointer', padding: 0, borderRadius: 12, overflow: 'hidden', position: 'relative', outline: isSel ? '2px solid #f59e0b' : 'none', transition: 'transform 0.2s' }}>
                        <img src={DESIGNS[key].img} alt={DESIGNS[key].label} style={{ width: '100%', aspectRatio: '1.4', objectFit: 'cover', display: 'block', opacity: isSel ? 1 : 0.65 }} />
                        {isSel && <div style={{ position: 'absolute', top: 6, right: 6, width: 18, height: 18, borderRadius: '50%', background: '#f59e0b', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Check size={10} color="#fff" strokeWidth={3} /></div>}
                        <div style={{ padding: '6px 8px', background: '#090d16', textAlign: 'left' }}>
                          <p style={{ margin: 0, fontSize: 10, color: isSel ? '#f59e0b' : '#94a3b8', fontWeight: 600 }}>{DESIGNS[key].label}</p>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {generating && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 16, background: 'rgba(245,158,11,0.03)', borderRadius: 16, border: '1px solid rgba(245,158,11,0.1)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Loader2 size={16} className="animate-spin text-amber-500" />
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#f59e0b' }}>Migoo AI is thinking...</span>
                </div>
                <p style={{ margin: 0, fontSize: 11, color: '#64748b', lineHeight: 1.5 }}>Migoo AI is examining slide elements, generating tables for comparisons, creating interactive timelines, and building a professional Cornell template structure.</p>
              </div>
            )}

            {notesData && (
              <div style={{ padding: 16, background: 'rgba(255,255,255,0.02)', borderRadius: 16, border: '1px solid rgba(255,255,255,0.05)', fontSize: 11, color: '#94a3b8', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <p style={{ margin: 0, fontWeight: 600, color: '#f1f5f9' }}>📊 Generation Details</p>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Total Sections:</span><span style={{ color: '#f59e0b', fontWeight: 700 }}>{sections.length}</span></div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Key Concepts:</span><span style={{ color: '#f59e0b', fontWeight: 700 }}>{notesData.keyTerms?.length || 0}</span></div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Page Count:</span><span style={{ color: '#fff', fontWeight: 700 }}>{pages.length + (notesData.keyTerms?.length ? 1 : 0)} Pages</span></div>
              </div>
            )}

            {/* Actions Panel inside Controls */}
            <div style={{ marginTop: 'auto', display: 'flex', gap: 10, flexShrink: 0 }}>
              <button onClick={onClose} style={{ flex: 1, padding: '10px 16px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.08)', background: 'none', color: '#94a3b8', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
              {!notesData ? (
                <DrawOutlineButton onClick={handleGenerate} disabled={generating} variant="dark" accentColor="#f59e0b" className="flex-2 text-xs">
                  {generating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                  {generating ? 'Generating…' : 'Generate Notes'}
                </DrawOutlineButton>
              ) : (
                <DrawOutlineButton onClick={handleExport} disabled={exporting || !bgDataUrl} variant="dark" accentColor="#ec4899" className="flex-2 text-xs">
                  {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                  {exporting ? 'Exporting…' : !bgDataUrl ? 'Loading…' : 'Download PDF'}
                </DrawOutlineButton>
              )}
            </div>

          </div>

          {/* Right Live Preview Column */}
          {notesData && (
            <div style={{ flex: 1, background: '#05070c', padding: 24, display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto', maxHeight: '100%' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 11, color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>Live Document Preview</span>
                <span style={{ fontSize: 10, color: '#f59e0b', background: 'rgba(245,158,11,0.08)', padding: '2px 8px', borderRadius: 6, fontWeight: 600 }}>A4 Format</span>
              </div>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: 24, alignItems: 'center', paddingBottom: 20 }}>
                {pages.map((idxs, pi) => {
                  const scale = 0.65
                  const tp = pages.length + (notesData.keyTerms?.length ? 1 : 0)
                  return (
                    <div key={pi} style={{ position: 'relative', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, boxShadow: '0 10px 30px rgba(0,0,0,0.5)', overflow: 'hidden', width: A4_W * scale, height: A4_H * scale }}>
                      <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left', width: A4_W, height: A4_H, pointerEvents: 'none' }}>
                        <NotesPageRender sections={idxs.map(i => sections[i])} startIdx={idxs[0]} bgDataUrl={bgDataUrl} d={d} title={notesData.title || chapterTitle} pageNum={pi + 1} totalPages={tp} summary={pi === 0 ? notesData.summary : undefined} />
                      </div>
                    </div>
                  )
                })}
                {/* Key Terms Glossary preview */}
                {notesData.keyTerms?.length > 0 && (() => {
                  const scale = 0.65;
                  const tp = pages.length + 1
                  return (
                    <div key="key-terms-preview" style={{ position: 'relative', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, boxShadow: '0 10px 30px rgba(0,0,0,0.5)', overflow: 'hidden', width: A4_W * scale, height: A4_H * scale }}>
                      <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left', width: A4_W, height: A4_H, pointerEvents: 'none' }}>
                        <KeyTermsPage keyTerms={notesData.keyTerms} bgDataUrl={bgDataUrl} d={d} pageNum={tp} totalPages={tp} />
                      </div>
                    </div>
                  )
                })()}
              </div>
            </div>
          )}

        </div>
      </div>

      {/* Hidden render for high-quality snapshotting */}
      {notesData && bgDataUrl && (
        <div ref={hiddenRef} aria-hidden style={{ position: 'fixed', top: 0, left: '-9999px', zIndex: -1, pointerEvents: 'none' }}>
          {(() => {
            const tp = pages.length + (notesData.keyTerms?.length ? 1 : 0);
            return pages.map((idxs, pi) => (
              <div key={pi} data-notes-page>
                <NotesPageRender sections={idxs.map(i => sections[i])} startIdx={idxs[0]} bgDataUrl={bgDataUrl} d={d} title={notesData.title || chapterTitle} pageNum={pi + 1} totalPages={tp} summary={pi === 0 ? notesData.summary : undefined} />
              </div>
            ));
          })()}
          {notesData.keyTerms?.length > 0 && (
            <div data-notes-page>
              <KeyTermsPage keyTerms={notesData.keyTerms} bgDataUrl={bgDataUrl} d={d} pageNum={pages.length + 1} totalPages={pages.length + 1} />
            </div>
          )}
        </div>
      )}
    </>,
    document.body
  )
}
