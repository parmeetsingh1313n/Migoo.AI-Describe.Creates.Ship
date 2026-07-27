"use client"
import React, { useRef, useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X, Download, Loader2, Check, FileText, Sparkles, BookOpen, RotateCw, Trash2, LayoutGrid, Table, Clock, Radar } from 'lucide-react'
import jsPDF from 'jspdf'
import { toPng } from 'html-to-image'
import axios from 'axios'
import { toast } from 'sonner'
import DrawOutlineButton from '@/components/ui/DrawOutlineButton'
import { NoteIcon } from '@/lib/notes-icons'

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
        {type === 'callout' && (
          <div style={{ background: d.accentLight, borderLeft: `3px solid ${d.accent}`, borderRadius: '0 6px 6px 0', padding: '6px 9px', marginTop: 4, display: 'flex', gap: 7, alignItems: 'flex-start' }}>
            <div style={{ width: 18, height: 18, borderRadius: 6, background: d.headerGrad, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
              <NoteIcon hint="idea" size={10} strokeWidth={2.4} />
            </div>
            <p style={{ margin: 0, fontSize: 9.5, color: d.text, fontStyle: 'italic', lineHeight: 1.4 }}>{section.calloutText}</p>
          </div>
        )}
        {type === 'highlight' && <div style={{ background: d.accentLight, border: `1px solid ${d.accentBorder}`, borderRadius: 8, padding: '7px 9px', marginTop: 4 }}><strong style={{ fontSize: 10, color: d.accent }}>{section.highlightTitle}</strong><p style={{ margin: '2px 0 0', fontSize: 9.5, color: d.text, lineHeight: 1.4 }}>{section.highlightBody}</p></div>}
        {(type === 'cards' || type === 'numbered-grid') && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 5, marginTop: 4 }}>
            {(section.cards || section.items || []).map((c: any, i: number) => (
              <div key={i} style={{ background: d.accentLight, border: `1px solid ${d.accentBorder}`, borderRadius: 7, padding: '5px 7px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <div style={{ width: 16, height: 16, borderRadius: 5, background: d.headerGrad, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <NoteIcon hint={c.icon || c.title || c.label} ordinal={i} size={9} strokeWidth={2.4} />
                  </div>
                  <strong style={{ fontSize: 9, color: d.accent }}>{c.title || c.label}</strong>
                </div>
                <p style={{ margin: '2px 0 0', fontSize: 8.5, color: d.text, lineHeight: 1.4 }}>{c.description || c.detail}</p>
              </div>
            ))}
          </div>
        )}
        {(type === 'flowchart' || type === 'horizontal-flowchart' || type === 'step-cards') && (
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginTop: 12, position: 'relative', padding: '10px 0' }}>
            {(section.steps || []).map((s: any, i: number) => {
              const stepLetter = String.fromCharCode(65 + i) // A, B, C...
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

                  {/* Circular Step Badge — real outlined icon resolved from the
                      model's hint (was printing the raw "icon-…" text) */}
                  <div style={{
                    width: 46,
                    height: 46,
                    borderRadius: '50%',
                    background: grad,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    position: 'relative',
                    boxShadow: '0 4px 10px rgba(0,0,0,0.15)',
                    zIndex: 2
                  }}>
                    <NoteIcon hint={s.icon || s.label || s.title} ordinal={i} size={20} strokeWidth={2} />
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
              {(section.items || []).map((it: any, i: number) => (
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
                    flexShrink: 0
                  }}>
                    <NoteIcon hint={it.icon || it.title} ordinal={i} size={13} strokeWidth={2.2} />
                  </div>
                  <div>
                    <strong style={{ fontSize: 9, color: d.text, display: 'block' }}>{it.title}</strong>
                    <span style={{ fontSize: 8, color: d.muted, lineHeight: 1.3, display: 'block', marginTop: 1 }}>{it.description}</span>
                  </div>
                </div>
              ))}
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
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  <div style={{ width: 22, height: 22, borderRadius: 7, background: d.headerGrad, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <NoteIcon hint={st.icon || st.label} ordinal={i} size={12} strokeWidth={2.2} />
                  </div>
                </div>
                <div style={{ fontSize: 16, fontWeight: 800, color: d.accent, lineHeight: 1.2, marginTop: 3 }}>{st.value}</div>
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
            <div style={{ width: 30, height: 30, borderRadius: 9, background: 'rgba(255,255,255,0.18)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <NoteIcon hint={section.emoji || section.bannerText} ordinal={index} size={16} strokeWidth={2} />
            </div>
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
                <div style={{ width: 20, height: 20, borderRadius: 6, background: d.headerGrad, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
                  <NoteIcon hint={it.emoji || it.icon || it.title} ordinal={i} size={11} strokeWidth={2.2} />
                </div>
                <div>
                  <strong style={{ fontSize: 9, color: d.accent }}>{it.title}</strong>
                  <p style={{ margin: '1px 0 0', fontSize: 8.5, color: d.text, lineHeight: 1.4 }}>{it.detail}</p>
                </div>
              </div>
            ))}
          </div>
        )}
        {/* ── Code Block — real mono code card with editor chrome ── */}
        {type === 'code-block' && section.code && (
          <div style={{ marginTop: 4, borderRadius: 10, overflow: 'hidden', border: `1px solid ${d.accentBorder}`, boxShadow: '0 4px 14px rgba(0,0,0,0.08)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', background: '#2d3446' }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#ff5f56' }} />
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#ffbd2e' }} />
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#27c93f' }} />
              <span style={{ marginLeft: 6, fontSize: 7.5, color: 'rgba(255,255,255,0.6)', fontFamily: 'monospace', fontWeight: 600 }}>{section.filename || section.language || 'code'}</span>
            </div>
            <pre style={{ margin: 0, padding: '8px 12px', background: '#1e2432', color: '#dbe4f5', fontSize: 8.5, lineHeight: 1.55, fontFamily: 'Consolas, Menlo, monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{section.code}</pre>
            {section.output && (
              <div style={{ padding: '5px 12px', background: '#141926', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                <span style={{ fontSize: 7, color: '#7dd3a8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Output</span>
                <pre style={{ margin: '2px 0 0', fontSize: 8, color: '#9fb3ce', fontFamily: 'Consolas, Menlo, monospace', whiteSpace: 'pre-wrap' }}>{section.output}</pre>
              </div>
            )}
            {section.explanation && <p style={{ margin: 0, padding: '5px 10px', background: d.accentLight, fontSize: 8.5, color: d.text, lineHeight: 1.4, fontStyle: 'italic' }}>{section.explanation}</p>}
          </div>
        )}

        {/* ── Q&A Cards — exam-style question with worked answer ── */}
        {type === 'qa-cards' && (
          <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {(section.questions || []).map((q: any, i: number) => (
              <div key={i} style={{ borderRadius: 9, overflow: 'hidden', border: `1px solid ${d.accentBorder}` }}>
                <div style={{ display: 'flex', gap: 7, alignItems: 'flex-start', padding: '6px 9px', background: d.headerGrad }}>
                  <div style={{ width: 16, height: 16, borderRadius: '50%', background: 'rgba(255,255,255,0.22)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: '#fff', fontSize: 8, fontWeight: 800 }}>Q</div>
                  <p style={{ margin: 0, fontSize: 9, color: '#fff', fontWeight: 700, lineHeight: 1.4 }}>{q.question}</p>
                </div>
                <div style={{ display: 'flex', gap: 7, alignItems: 'flex-start', padding: '6px 9px', background: d.accentLight }}>
                  <div style={{ width: 16, height: 16, borderRadius: '50%', background: d.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: '#fff', fontSize: 8, fontWeight: 800 }}>A</div>
                  <p style={{ margin: 0, fontSize: 8.5, color: d.text, lineHeight: 1.45 }}>{q.answer}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Mnemonic — memory device with letter chips ── */}
        {type === 'mnemonic' && (
          <div style={{ marginTop: 4, background: d.accentLight, border: `1.5px dashed ${d.accent}`, borderRadius: 10, padding: '8px 11px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
              <div style={{ width: 18, height: 18, borderRadius: 6, background: d.headerGrad, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <NoteIcon hint="brain" size={10} strokeWidth={2.4} />
              </div>
              <span style={{ fontSize: 8, fontWeight: 800, color: d.accent, textTransform: 'uppercase', letterSpacing: 0.6 }}>Memory Trick</span>
            </div>
            <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginBottom: 5 }}>
              {String(section.phrase || '').split(' ').map((word: string, i: number) => (
                <span key={i} style={{ padding: '2px 6px', borderRadius: 5, background: '#fff', border: `1px solid ${d.accentBorder}`, fontSize: 8.5, color: d.text }}>
                  <strong style={{ color: d.accent, fontSize: 10 }}>{word.charAt(0)}</strong>{word.slice(1)}
                </span>
              ))}
            </div>
            <p style={{ margin: 0, fontSize: 8.5, color: d.muted, lineHeight: 1.4, fontStyle: 'italic' }}>{section.meaning}</p>
          </div>
        )}

        {/* ── Formula Card — centered expression with legend ── */}
        {type === 'formula' && (
          <div style={{ marginTop: 4, borderRadius: 10, border: `1px solid ${d.accentBorder}`, overflow: 'hidden' }}>
            <div style={{ padding: '10px 12px', background: d.accentLight, textAlign: 'center' }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: d.text, fontFamily: 'Georgia, serif', fontStyle: 'italic', letterSpacing: 0.5 }}>{section.expression}</span>
            </div>
            {(section.legend || []).length > 0 && (
              <div style={{ padding: '5px 10px', display: 'flex', flexWrap: 'wrap', gap: '3px 12px', background: '#fff' }}>
                {(section.legend || []).map((l: any, i: number) => (
                  <span key={i} style={{ fontSize: 8, color: d.muted }}>
                    <strong style={{ color: d.accent, fontFamily: 'Georgia, serif', fontStyle: 'italic' }}>{l.symbol}</strong> = {l.meaning}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Pyramid — stacked hierarchy tiers, wide base to narrow peak ── */}
        {type === 'pyramid' && (
          <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
            {(section.tiers || []).map((t: any, i: number) => {
              const n = (section.tiers || []).length
              const width = 45 + ((i + 1) / n) * 55 // top narrow → bottom wide
              return (
                <div key={i} style={{ width: `${width}%`, background: i === 0 ? d.headerGrad : d.accentLight, border: i === 0 ? 'none' : `1px solid ${d.accentBorder}`, borderRadius: 7, padding: '4px 10px', textAlign: 'center' }}>
                  <strong style={{ fontSize: 8.5, color: i === 0 ? '#fff' : d.accent, display: 'block' }}>{t.label}</strong>
                  {t.detail && <span style={{ fontSize: 7.5, color: i === 0 ? 'rgba(255,255,255,0.8)' : d.muted, lineHeight: 1.3 }}>{t.detail}</span>}
                </div>
              )
            })}
          </div>
        )}

        {/* ── Venn — two overlapping concept circles + shared middle ── */}
        {type === 'venn' && (
          <div style={{ marginTop: 4 }}>
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', position: 'relative', height: 96 }}>
              <div style={{ width: 150, height: 88, borderRadius: '50%', background: 'rgba(96,165,250,0.14)', border: '1.5px solid rgba(96,165,250,0.5)', marginRight: -44, display: 'flex', alignItems: 'center', paddingLeft: 14 }}>
                <span style={{ fontSize: 8.5, fontWeight: 800, color: '#2563eb', width: 62, lineHeight: 1.25 }}>{section.leftLabel}</span>
              </div>
              <div style={{ width: 150, height: 88, borderRadius: '50%', background: 'rgba(192,132,252,0.14)', border: '1.5px solid rgba(192,132,252,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: 14 }}>
                <span style={{ fontSize: 8.5, fontWeight: 800, color: '#7c3aed', width: 62, textAlign: 'right', lineHeight: 1.25 }}>{section.rightLabel}</span>
              </div>
              <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', width: 58, textAlign: 'center' }}>
                <span style={{ fontSize: 7.5, fontWeight: 800, color: d.text, lineHeight: 1.2, display: 'block' }}>{section.sharedLabel || 'Both'}</span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 5, marginTop: 4 }}>
              <div style={{ flex: 1, background: 'rgba(96,165,250,0.09)', borderRadius: 7, padding: '4px 7px' }}>
                {(section.leftItems || []).map((x: string, i: number) => <div key={i} style={{ fontSize: 7.5, color: d.text, lineHeight: 1.5 }}>• {x}</div>)}
              </div>
              <div style={{ flex: 1, background: d.accentLight, border: `1px solid ${d.accentBorder}`, borderRadius: 7, padding: '4px 7px' }}>
                {(section.sharedItems || []).map((x: string, i: number) => <div key={i} style={{ fontSize: 7.5, color: d.text, lineHeight: 1.5, fontWeight: 600 }}>• {x}</div>)}
              </div>
              <div style={{ flex: 1, background: 'rgba(192,132,252,0.09)', borderRadius: 7, padding: '4px 7px' }}>
                {(section.rightItems || []).map((x: string, i: number) => <div key={i} style={{ fontSize: 7.5, color: d.text, lineHeight: 1.5 }}>• {x}</div>)}
              </div>
            </div>
          </div>
        )}

        {/* ── Do / Don't — green vs red guidance columns ── */}
        {type === 'do-dont' && (
          <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
            <div style={{ flex: 1, borderRadius: 9, overflow: 'hidden', border: '1px solid rgba(47,169,140,0.35)' }}>
              <div style={{ padding: '4px 8px', background: 'rgba(47,169,140,0.14)', display: 'flex', alignItems: 'center', gap: 5 }}>
                <div style={{ width: 14, height: 14, borderRadius: '50%', background: '#2FA98C', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><NoteIcon hint="check" size={8} strokeWidth={3} /></div>
                <span style={{ fontSize: 8.5, fontWeight: 800, color: '#1d7a63' }}>DO</span>
              </div>
              <div style={{ padding: '4px 8px' }}>
                {(section.dos || []).map((x: string, i: number) => <div key={i} style={{ fontSize: 8, color: d.text, lineHeight: 1.5, display: 'flex', gap: 4 }}><span style={{ color: '#2FA98C', fontWeight: 800 }}>✓</span>{x}</div>)}
              </div>
            </div>
            <div style={{ flex: 1, borderRadius: 9, overflow: 'hidden', border: '1px solid rgba(224,101,58,0.35)' }}>
              <div style={{ padding: '4px 8px', background: 'rgba(224,101,58,0.12)', display: 'flex', alignItems: 'center', gap: 5 }}>
                <div style={{ width: 14, height: 14, borderRadius: '50%', background: '#E0653A', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><NoteIcon hint="wrong" size={8} strokeWidth={3} /></div>
                <span style={{ fontSize: 8.5, fontWeight: 800, color: '#b34a24' }}>DON'T</span>
              </div>
              <div style={{ padding: '4px 8px' }}>
                {(section.donts || []).map((x: string, i: number) => <div key={i} style={{ fontSize: 8, color: d.text, lineHeight: 1.5, display: 'flex', gap: 4 }}><span style={{ color: '#E0653A', fontWeight: 800 }}>✗</span>{x}</div>)}
              </div>
            </div>
          </div>
        )}

        {/* ── Big Fact — one huge memorable takeaway ── */}
        {type === 'big-fact' && (
          <div style={{ marginTop: 4, borderRadius: 12, border: `1px solid ${d.accentBorder}`, background: d.accentLight, padding: '12px 14px', textAlign: 'center', position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', top: -14, right: -14, width: 64, height: 64, borderRadius: '50%', background: d.headerGrad, opacity: 0.1 }} />
            <div style={{ fontSize: 24, fontWeight: 900, background: d.headerGrad, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', lineHeight: 1.1 }}>{section.fact}</div>
            <p style={{ margin: '4px 0 0', fontSize: 9, color: d.text, lineHeight: 1.4 }}>{section.context}</p>
          </div>
        )}

        {/* ── Progress Bars — labelled mastery/percentage bars ── */}
        {type === 'progress-bars' && (
          <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {(section.bars || []).map((b: any, i: number) => {
              const pct = Math.max(4, Math.min(100, parseInt(String(b.percent ?? b.value ?? 50), 10) || 50))
              return (
                <div key={i}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                    <span style={{ fontSize: 8.5, fontWeight: 700, color: d.text }}>{b.label}</span>
                    <span style={{ fontSize: 8.5, fontWeight: 800, color: d.accent }}>{pct}%</span>
                  </div>
                  <div style={{ height: 7, borderRadius: 4, background: d.accentLight, border: `1px solid ${d.accentBorder}`, overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: d.headerGrad, borderRadius: 4 }} />
                  </div>
                  {b.detail && <p style={{ margin: '2px 0 0', fontSize: 7.5, color: d.muted, lineHeight: 1.3 }}>{b.detail}</p>}
                </div>
              )
            })}
          </div>
        )}

        {/* ── Roadmap — vertical milestone path with icon nodes ── */}
        {type === 'roadmap' && (
          <div style={{ marginTop: 4, position: 'relative', paddingLeft: 22 }}>
            <div style={{ position: 'absolute', left: 9, top: 6, bottom: 6, width: 2, background: `linear-gradient(180deg, ${d.accent}, ${d.accentBorder})`, borderRadius: 2 }} />
            {(section.milestones || []).map((m: any, i: number) => (
              <div key={i} style={{ position: 'relative', marginBottom: 8, paddingLeft: 8 }}>
                <div style={{ position: 'absolute', left: -20, top: 0, width: 18, height: 18, borderRadius: 6, background: d.headerGrad, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 0 0 2.5px ${d.accentLight}` }}>
                  <NoteIcon hint={m.icon || m.label} ordinal={i} size={10} strokeWidth={2.4} />
                </div>
                <div style={{ background: i === (section.milestones || []).length - 1 ? d.accentLight : 'transparent', borderRadius: 7, padding: i === (section.milestones || []).length - 1 ? '3px 7px' : 0 }}>
                  <strong style={{ fontSize: 9, color: d.text, display: 'block' }}>{m.label}</strong>
                  <span style={{ fontSize: 8, color: d.muted, lineHeight: 1.35, display: 'block' }}>{m.detail}</span>
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
    const items = (s.bullets || s.points || s.cards || s.items || s.steps || s.quotes || s.events || s.definitions || s.listItems || s.stats || s.questions || s.tiers || s.bars || s.milestones || []).length
    // Grid-based types: 2 columns, so rows = ceil(items/2)
    const gridRows = Math.ceil(Math.max(items, 1) / 2)
    if (t === 'ai-image') return 300 // image frame + heading + caption
    if (t === 'gradient-banner') return HEAD + 60
    if (t === 'callout') return HEAD + 50
    if (t === 'highlight') return HEAD + 65
    if (t === 'comparison') return HEAD + 35 + (s.points?.length || 3) * 28
    if (t === 'matrix') return HEAD + gridRows * 80
    if (t === 'stats-row') return HEAD + 95
    if (t === 'table') return HEAD + ((s.table?.rows?.length || 3) + 1) * 24 + 10
    if (t === 'timeline') return HEAD + items * 50
    if (t === 'cards' || t === 'numbered-grid') return HEAD + gridRows * 60
    if (t === 'circular-map' || t === 'radial-list') return HEAD + 15 + items * 42
    if (t === 'flowchart' || t === 'horizontal-flowchart' || t === 'step-cards') return HEAD + 125
    if (t === 'quote-cards') return HEAD + Math.ceil(items / 3) * 60
    if (t === 'checklist') return HEAD + items * 26
    if (t === 'definition-list') return HEAD + items * 40
    if (t === 'icon-list') return HEAD + items * 38
    // New components
    if (t === 'code-block') return HEAD + 40 + String(s.code || '').split('\n').length * 14 + (s.output ? 40 : 0) + (s.explanation ? 26 : 0)
    if (t === 'qa-cards') return HEAD + items * 78
    if (t === 'mnemonic') return HEAD + 82
    if (t === 'formula') return HEAD + 62 + ((s.legend?.length || 0) > 0 ? 24 : 0)
    if (t === 'pyramid') return HEAD + items * 34
    if (t === 'venn') return HEAD + 108 + Math.max(s.leftItems?.length || 0, s.sharedItems?.length || 0, s.rightItems?.length || 0) * 13
    if (t === 'do-dont') return HEAD + 28 + Math.max(s.dos?.length || 0, s.donts?.length || 0) * 15
    if (t === 'big-fact') return HEAD + 82
    if (t === 'progress-bars') return HEAD + items * 34
    if (t === 'roadmap') return HEAD + items * 44
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
    { icon: LayoutGrid, label: 'Code blocks & Q&A drills', tint: '#a78bfa' },
    { icon: Table, label: 'Tables, Venn & pyramids', tint: '#2dd4bf' },
    { icon: Clock, label: 'Timelines & roadmaps', tint: '#38bdf8' },
    { icon: Radar, label: 'Mnemonics & formulas', tint: '#8B7FE8' },
  ]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      {/* Faux document preview — layered, tilted pages */}
      <div style={{ position: 'relative', height: 168, display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 4 }}>
        {/* dotted texture backdrop */}
        <div style={{ position: 'absolute', inset: '-24px -24px 0', backgroundImage: 'radial-gradient(rgba(15,23,42,0.06) 1px, transparent 0)', backgroundSize: '14px 14px', maskImage: 'radial-gradient(ellipse 70% 80% at 50% 40%, #000 40%, transparent 100%)', WebkitMaskImage: 'radial-gradient(ellipse 70% 80% at 50% 40%, #000 40%, transparent 100%)' }} />
        {/* back page */}
        <div style={{ position: 'absolute', width: 118, height: 150, background: '#eef1f6', borderRadius: 8, border: '1px solid rgba(15,23,42,0.06)', transform: 'rotate(-9deg) translateX(-46px)', boxShadow: '0 12px 28px rgba(15,23,42,0.12)' }} />
        <div style={{ position: 'absolute', width: 118, height: 150, background: '#f4f6fa', borderRadius: 8, border: '1px solid rgba(15,23,42,0.06)', transform: 'rotate(7deg) translateX(46px)', boxShadow: '0 12px 28px rgba(15,23,42,0.12)' }} />
        {/* front page with real-looking content */}
        <div style={{ position: 'relative', width: 128, height: 162, background: 'linear-gradient(160deg,#ffffff,#f7f8fc)', borderRadius: 10, border: '1px solid rgba(15,23,42,0.08)', boxShadow: '0 20px 45px rgba(15,23,42,0.16)', padding: '12px 12px 0', overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 9 }}>
            <div style={{ width: 16, height: 16, borderRadius: 5, background: 'linear-gradient(135deg,#3EA5D6 0%,#3363AD 50%,#6D5BD3 100%)' }} />
            <div style={{ flex: 1, height: 5, borderRadius: 3, background: 'rgba(15,23,42,0.1)' }} />
            <div style={{ width: 18, height: 5, borderRadius: 3, background: 'rgba(109,91,211,0.35)' }} />
          </div>
          {[92, 78, 85].map((w, i) => <div key={i} style={{ height: 3.5, width: `${w}%`, borderRadius: 2, background: 'rgba(15,23,42,0.07)', marginBottom: 5 }} />)}
          {/* mini bento */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, margin: '9px 0' }}>
            <div style={{ height: 22, borderRadius: 5, background: 'rgba(167,139,250,0.14)', border: '1px solid rgba(167,139,250,0.3)' }} />
            <div style={{ height: 22, borderRadius: 5, background: 'rgba(45,212,191,0.12)', border: '1px solid rgba(45,212,191,0.28)' }} />
          </div>
          {/* mini table lines */}
          {[0, 1, 2].map((i) => (
            <div key={i} style={{ display: 'flex', gap: 4, marginBottom: 3 }}>
              <div style={{ flex: 1, height: 3, borderRadius: 2, background: i === 0 ? 'rgba(51,99,173,0.45)' : 'rgba(15,23,42,0.06)' }} />
              <div style={{ flex: 1, height: 3, borderRadius: 2, background: i === 0 ? 'rgba(51,99,173,0.45)' : 'rgba(15,23,42,0.06)' }} />
            </div>
          ))}
        </div>
      </div>

      {/* Headline block — left-aligned, editorial */}
      <div>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#6D5BD3', boxShadow: '0 0 8px rgba(109,91,211,0.5)' }} />
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', color: '#6D5BD3' }}>Study Dossier</span>
        </div>
        <h4 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 700, color: '#0f172a', letterSpacing: '-0.02em', lineHeight: 1.25 }}>
          The whole chapter, distilled onto&nbsp;paper.
        </h4>
        <p style={{ margin: 0, fontSize: 12.5, color: '#64748b', lineHeight: 1.6 }}>
          Migoo reads every slide and rebuilds them as a printable set of notes — structured, cross-referenced, and ready to revise from.
        </p>
      </div>

      {/* Feature grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 8 }}>
        {features.map(({ icon: Icon, label, tint }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 11px', borderRadius: 12, background: '#f8fafc', border: '1px solid rgba(15,23,42,0.06)' }}>
            <div style={{ width: 26, height: 26, borderRadius: 8, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: `${tint}1f`, border: `1px solid ${tint}40` }}>
              <Icon size={14} color={tint} />
            </div>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#334155' }}>{label}</span>
          </div>
        ))}
      </div>

      {/* Meta footer */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 4, fontSize: 11, color: '#64748b' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 9px', borderRadius: 20, background: '#f8fafc', border: '1px solid rgba(15,23,42,0.06)' }}>
          <FileText size={11} color="#94a3b8" /> {slideCount} slide{slideCount === 1 ? '' : 's'}
        </span>
        <span style={{ opacity: 0.6 }}>→</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 9px', borderRadius: 20, background: 'rgba(109,91,211,0.08)', border: '1px solid rgba(109,91,211,0.18)', color: '#6D5BD3', fontWeight: 600 }}>
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

  // Lock the page behind the dialog while it is open. Without this, once the
  // dialog's inner scroller hits its top/bottom, further wheel/touch scrolling
  // chains to the document and the course page scrolls underneath the modal.
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open])

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
        background: '#ffffff',
        borderRadius: 24,
        border: '1px solid rgba(15,23,42,0.08)',
        boxShadow: '0 25px 80px rgba(15,23,42,0.25)',
        overflow: 'hidden',
        transition: 'width 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
        display: 'flex',
        flexDirection: 'column',
        maxHeight: '90vh'
      }}>
        {/* Header */}
        <div style={{ padding: '20px 24px', borderBottom: '1px solid rgba(15,23,42,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: 'linear-gradient(135deg,#3EA5D6 0%,#3363AD 50%,#6D5BD3 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 12px rgba(109,91,211,0.2)' }}>
              <BookOpen size={20} color="#fff" />
            </div>
            <div>
              <p style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#0f172a', letterSpacing: '-0.02em' }}>Deep Study Notes</p>
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
                  style={{ background: '#f1f5f9', border: 'none', cursor: generating ? 'wait' : 'pointer', color: '#64748b', padding: 6, borderRadius: 10, display: 'flex', transition: 'background 0.2s', alignItems: 'center' }}
                >
                  {generating ? <Loader2 size={14} className="animate-spin" /> : <RotateCw size={14} />}
                </button>
                <button
                  onClick={handleRemoveNotes}
                  title="Remove study notes"
                  style={{ background: 'rgba(239,68,68,0.08)', border: 'none', cursor: 'pointer', color: '#ef4444', padding: 6, borderRadius: 10, display: 'flex', transition: 'background 0.2s', alignItems: 'center' }}
                >
                  <Trash2 size={14} />
                </button>
              </>
            )}
            <button onClick={onClose} style={{ background: '#f1f5f9', border: 'none', cursor: 'pointer', color: '#64748b', padding: 6, borderRadius: 10, display: 'flex', transition: 'background 0.2s' }}><X size={18} /></button>
          </div>
        </div>

        {/* Content Area */}
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          
          {/* Controls Column */}
          <div className="notes-scroll" style={{ width: notesData ? 360 : '100%', padding: 24, borderRight: notesData ? '1px solid rgba(15,23,42,0.06)' : 'none', display: 'flex', flexDirection: 'column', gap: 20, overflowY: 'auto', overscrollBehavior: 'contain' }}>

            {!notesData ? (
              <NotesIntro slideCount={slides.length} chapterTitle={chapterTitle} />
            ) : (
              <div>
                <p style={{ margin: '0 0 12px', fontSize: 11, color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>Note Template</p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 10 }}>
                  {DESIGN_KEYS.map(key => {
                    const isSel = selected === key
                    return (
                      <button key={key} onClick={() => setSelected(key)} style={{ background: '#ffffff', border: '1px solid rgba(15,23,42,0.08)', cursor: 'pointer', padding: 0, borderRadius: 12, overflow: 'hidden', position: 'relative', outline: isSel ? '2px solid #6D5BD3' : 'none', transition: 'transform 0.2s' }}>
                        <img src={DESIGNS[key].img} alt={DESIGNS[key].label} style={{ width: '100%', aspectRatio: '1.4', objectFit: 'cover', display: 'block', opacity: isSel ? 1 : 0.75 }} />
                        {isSel && <div style={{ position: 'absolute', top: 6, right: 6, width: 18, height: 18, borderRadius: '50%', background: '#6D5BD3', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Check size={10} color="#fff" strokeWidth={3} /></div>}
                        <div style={{ padding: '6px 8px', background: '#f8fafc', textAlign: 'left' }}>
                          <p style={{ margin: 0, fontSize: 10, color: isSel ? '#6D5BD3' : '#64748b', fontWeight: 600 }}>{DESIGNS[key].label}</p>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {generating && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 16, background: 'rgba(109,91,211,0.05)', borderRadius: 16, border: '1px solid rgba(109,91,211,0.15)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Loader2 size={16} className="animate-spin text-[#6D5BD3]" />
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#6D5BD3' }}>Migoo AI is thinking...</span>
                </div>
                <p style={{ margin: 0, fontSize: 11, color: '#64748b', lineHeight: 1.5 }}>Migoo AI is examining slide elements, generating tables for comparisons, creating interactive timelines, and building a professional Cornell template structure.</p>
              </div>
            )}

            {notesData && (
              <div style={{ padding: 16, background: '#f8fafc', borderRadius: 16, border: '1px solid rgba(15,23,42,0.06)', fontSize: 11, color: '#64748b', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <p style={{ margin: 0, fontWeight: 600, color: '#0f172a' }}>📊 Generation Details</p>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Total Sections:</span><span style={{ color: '#6D5BD3', fontWeight: 700 }}>{sections.length}</span></div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Key Concepts:</span><span style={{ color: '#6D5BD3', fontWeight: 700 }}>{notesData.keyTerms?.length || 0}</span></div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Page Count:</span><span style={{ color: '#0f172a', fontWeight: 700 }}>{pages.length + (notesData.keyTerms?.length ? 1 : 0)} Pages</span></div>
              </div>
            )}

            {/* Actions Panel inside Controls */}
            <div style={{ marginTop: 'auto', display: 'flex', gap: 10, flexShrink: 0 }}>
              <button onClick={onClose} style={{ flex: 1, padding: '10px 16px', borderRadius: 12, border: '1px solid rgba(15,23,42,0.1)', background: 'none', color: '#64748b', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
              {!notesData ? (
                <DrawOutlineButton onClick={handleGenerate} disabled={generating} variant="light" accentColor="#6D5BD3" className="flex-2 text-xs">
                  {generating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                  {generating ? 'Generating…' : 'Generate Notes'}
                </DrawOutlineButton>
              ) : (
                <DrawOutlineButton onClick={handleExport} disabled={exporting || !bgDataUrl} variant="light" accentColor="#ec4899" className="flex-2 text-xs">
                  {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                  {exporting ? 'Exporting…' : !bgDataUrl ? 'Loading…' : 'Download PDF'}
                </DrawOutlineButton>
              )}
            </div>

          </div>

          {/* Right Live Preview Column */}
          {notesData && (
            <div className="notes-scroll" style={{ flex: 1, background: '#f1f5f9', padding: 24, display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto', maxHeight: '100%', overscrollBehavior: 'contain' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 11, color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>Live Document Preview</span>
                <span style={{ fontSize: 10, color: '#6D5BD3', background: 'rgba(109,91,211,0.1)', padding: '2px 8px', borderRadius: 6, fontWeight: 600 }}>A4 Format</span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 24, alignItems: 'center', paddingBottom: 20 }}>
                {pages.map((idxs, pi) => {
                  const scale = 0.65
                  const tp = pages.length + (notesData.keyTerms?.length ? 1 : 0)
                  return (
                    <div key={pi} style={{ position: 'relative', border: '1px solid rgba(15,23,42,0.08)', borderRadius: 12, boxShadow: '0 10px 30px rgba(15,23,42,0.15)', overflow: 'hidden', width: A4_W * scale, height: A4_H * scale }}>
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
                    <div key="key-terms-preview" style={{ position: 'relative', border: '1px solid rgba(15,23,42,0.08)', borderRadius: 12, boxShadow: '0 10px 30px rgba(15,23,42,0.15)', overflow: 'hidden', width: A4_W * scale, height: A4_H * scale }}>
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
