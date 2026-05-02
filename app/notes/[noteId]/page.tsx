"use client"
import { useParams, useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
    ArrowLeft,
    BookOpen,
    Brain,
    Check,
    Clock,
    Download,
    FileText,
    Grid3X3,
    LayoutGrid,
    Loader2,
    RefreshCw,
    Sparkles,
} from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'
import jsPDF from 'jspdf'
import html2canvas from 'html2canvas-pro'
import { UserButton } from '@clerk/nextjs'
import { NoteDesignBg, getDesignConfig, getDesignPageBg, type NoteDesignKey, type DesignConfig } from './NoteDesigns'

// ─── FA6 Icon Imports & Mapping ──────────────────────────────
import {
    FaChartLine, FaChartBar, FaChartPie, FaChartColumn, FaChartArea,
    FaGlobe, FaEarthAmericas, FaEarthAsia,
    FaCode, FaLaptopCode, FaTerminal, FaDatabase, FaServer,
    FaBook, FaBookOpen, FaGraduationCap, FaSchool, FaPencil,
    FaBrain, FaLightbulb, FaAtom, FaFlask, FaMicroscope, FaDna,
    FaGears, FaGear, FaWrench, FaScrewdriverWrench,
    FaBriefcase, FaBuilding, FaBuildingColumns, FaIndustry,
    FaUsers, FaUserGraduate, FaUserDoctor, FaPeopleGroup,
    FaHeart, FaHeartPulse, FaStethoscope, FaHospital,
    FaShieldHalved, FaLock, FaKey, FaFingerprint,
    FaRocket, FaBolt, FaStar, FaFire,
    FaMoneyBillTrendUp, FaCoins, FaSackDollar, FaWallet,
    FaClock, FaCalendar, FaTimeline,
    FaNetworkWired, FaWifi, FaCloud, FaSatelliteDish,
    FaLeaf, FaSeedling, FaSolarPanel, FaRecycle,
    FaPaintbrush, FaPalette, FaCamera, FaFilm,
    FaMusic, FaHeadphones, FaMicrophone,
    FaTruck, FaPlane, FaShip, FaTrainSubway,
    FaScaleBalanced, FaGavel, FaLandmarkDome,
    FaNewspaper, FaEnvelope, FaComments, FaBullhorn,
    FaPuzzlePiece, FaCubesStacked, FaDiagramProject,
    FaCircleNodes, FaHexagonNodes, FaArrowTrendUp,
} from 'react-icons/fa6'
import type { IconType } from 'react-icons'

/** Curated FA6 icon map — keys match what the AI generates */
const FA6_ICON_MAP: Record<string, IconType> = {
    // Charts & Data
    'chart-line': FaChartLine, 'chart-bar': FaChartBar, 'chart-pie': FaChartPie,
    'chart-column': FaChartColumn, 'chart-area': FaChartArea, 'trend-up': FaArrowTrendUp,
    // Globe & Geography
    'globe': FaGlobe, 'earth': FaEarthAmericas, 'earth-asia': FaEarthAsia,
    // Tech & Code
    'code': FaCode, 'laptop-code': FaLaptopCode, 'terminal': FaTerminal,
    'database': FaDatabase, 'server': FaServer,
    // Education
    'book': FaBook, 'book-open': FaBookOpen, 'graduation-cap': FaGraduationCap,
    'school': FaSchool, 'pencil': FaPencil, 'user-graduate': FaUserGraduate,
    // Science & Research
    'brain': FaBrain, 'lightbulb': FaLightbulb, 'atom': FaAtom,
    'flask': FaFlask, 'microscope': FaMicroscope, 'dna': FaDna,
    // Engineering & Tools
    'gears': FaGears, 'gear': FaGear, 'wrench': FaWrench, 'tools': FaScrewdriverWrench,
    // Business
    'briefcase': FaBriefcase, 'building': FaBuilding, 'bank': FaBuildingColumns,
    'industry': FaIndustry, 'money': FaMoneyBillTrendUp, 'coins': FaCoins,
    'sack-dollar': FaSackDollar, 'wallet': FaWallet,
    // People
    'users': FaUsers, 'people-group': FaPeopleGroup, 'user-doctor': FaUserDoctor,
    // Health
    'heart': FaHeart, 'heartbeat': FaHeartPulse, 'stethoscope': FaStethoscope,
    'hospital': FaHospital,
    // Security
    'shield': FaShieldHalved, 'lock': FaLock, 'key': FaKey, 'fingerprint': FaFingerprint,
    // Energy & Innovation
    'rocket': FaRocket, 'bolt': FaBolt, 'star': FaStar, 'fire': FaFire,
    // Time
    'clock': FaClock, 'calendar': FaCalendar, 'timeline': FaTimeline,
    // Network & Cloud
    'network': FaNetworkWired, 'wifi': FaWifi, 'cloud': FaCloud, 'satellite': FaSatelliteDish,
    // Environment
    'leaf': FaLeaf, 'seedling': FaSeedling, 'solar-panel': FaSolarPanel, 'recycle': FaRecycle,
    // Creative
    'paintbrush': FaPaintbrush, 'palette': FaPalette, 'camera': FaCamera, 'film': FaFilm,
    // Media
    'music': FaMusic, 'headphones': FaHeadphones, 'microphone': FaMicrophone,
    // Transport
    'truck': FaTruck, 'plane': FaPlane, 'ship': FaShip, 'train': FaTrainSubway,
    // Law & Government
    'scale': FaScaleBalanced, 'gavel': FaGavel, 'landmark': FaLandmarkDome,
    // Communication
    'newspaper': FaNewspaper, 'envelope': FaEnvelope, 'comments': FaComments, 'bullhorn': FaBullhorn,
    // Abstract / Structure
    'puzzle': FaPuzzlePiece, 'cubes': FaCubesStacked, 'diagram': FaDiagramProject,
    'nodes': FaCircleNodes, 'hexagon-nodes': FaHexagonNodes,
}

/** Title-to-icon keyword hints for inferring icons from card titles */
const TITLE_KEYWORD_MAP: Array<[string[], IconType]> = [
    [['gdp', 'growth', 'economy', 'economic', 'output'], FaChartLine],
    [['gva', 'gross value', 'production', 'value added'], FaChartBar],
    [['inflation', 'price', 'cpi', 'deflation'], FaArrowTrendUp],
    [['unemployment', 'employment', 'jobs', 'labour', 'labor', 'workforce'], FaUsers],
    [['interest rate', 'monetary', 'central bank', 'reserve'], FaMoneyBillTrendUp],
    [['tax', 'fiscal', 'government', 'spending', 'budget', 'deficit'], FaBuildingColumns],
    [['trade', 'export', 'import', 'balance', 'tariff'], FaGlobe],
    [['investment', 'capital', 'stock', 'market', 'finance', 'fund'], FaCoins],
    [['technology', 'tech', 'digital', 'software', 'ai', 'computer'], FaCode],
    [['data', 'database', 'analytics', 'analysis', 'statistics'], FaDatabase],
    [['network', 'internet', 'web', 'cloud', 'server'], FaNetworkWired],
    [['security', 'cyber', 'protection', 'privacy', 'encryption'], FaShieldHalved],
    [['health', 'medical', 'hospital', 'disease', 'medicine', 'patient'], FaHospital],
    [['environment', 'climate', 'carbon', 'green', 'sustainability', 'energy'], FaLeaf],
    [['education', 'learning', 'school', 'university', 'training', 'course'], FaGraduationCap],
    [['research', 'science', 'experiment', 'lab', 'study'], FaMicroscope],
    [['business', 'company', 'corporate', 'enterprise', 'industry'], FaBriefcase],
    [['law', 'legal', 'policy', 'regulation', 'compliance', 'governance'], FaScaleBalanced],
    [['transport', 'logistics', 'supply chain', 'shipping', 'distribution'], FaTruck],
    [['communication', 'media', 'social', 'broadcast', 'marketing'], FaBullhorn],
    [['brain', 'cognitive', 'mental', 'psychology', 'intelligence'], FaBrain],
    [['innovation', 'startup', 'entrepreneurship', 'disrupt'], FaRocket],
    [['agriculture', 'food', 'farming', 'crop', 'land'], FaSeedling],
    [['energy', 'power', 'electricity', 'solar', 'renewable'], FaBolt],
    [['process', 'workflow', 'procedure', 'system', 'pipeline'], FaGears],
    [['time', 'schedule', 'deadline', 'history', 'timeline'], FaClock],
]

/** Resolve an AI-generated icon key OR card title to a FA6 component. */
function resolveCardIcon(iconKey: string | undefined, title?: string): IconType {
    // 1. Try direct key match
    if (iconKey) {
        const lower = iconKey.toLowerCase().trim()
        if (FA6_ICON_MAP[lower]) return FA6_ICON_MAP[lower]
        // 2. Try fuzzy key match (handles partial matches)
        for (const [key, icon] of Object.entries(FA6_ICON_MAP)) {
            if (lower.includes(key) || key.includes(lower)) return icon
        }
    }
    // 3. Fall back to title-based keyword inference
    if (title) {
        const titleLower = title.toLowerCase()
        for (const [keywords, icon] of TITLE_KEYWORD_MAP) {
            if (keywords.some(kw => titleLower.includes(kw))) return icon
        }
    }
    // 4. Last resort fallback
    return FaChartBar
}

// ─── Types ───────────────────────────────────────────────────
interface NoteProject {
    noteId: string
    title: string
    sourceType: string
    sourceContent: string | null
    extractedContent: string | null
    noteStyle: string
    pageDesign: string | null
    status: string
    generatedData: any
    uploadedAssets: any[] | null
}

// ─── Colors are now derived from the chosen page design (NoteDesigns.tsx) ──
// No separate theme picker — each design image dictates its own color palette.

// ─── Cornell Template ────────────────────────────────────────
function CornellTemplate({ data, colors, assets }: { data: any; colors: DesignConfig['colors']; assets: any[] }) {
    const imageAssets = assets.filter((a: any) => a.type?.startsWith('image/'))
    const imgPos = data.imagePosition ?? 2

    return (
        <div>
            {/* Document Title */}
            <div className="text-center mb-10 pt-4">
                <h1 className={`text-4xl font-black ${colors.text} tracking-tight leading-tight`} style={{ fontFamily: 'Georgia, serif' }}>
                    {data.title}
                </h1>
                <p className={`text-right mt-3 text-sm ${colors.muted}`}>
                    {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
                </p>
            </div>

            {/* Zig-Zag Content Sections */}
            <div className="space-y-8">
                {(data.mainNotes || data.sections || []).map((section: any, i: number) => {
                    const sectionType = section.type || 'bullets'
                    const isEven = i % 2 === 0

                    return (
                        <div key={i}>
                            <div
                                className="pb-4"
                                style={{
                                    breakInside: 'avoid',
                                    marginLeft: isEven ? '0' : '60px',
                                    marginRight: isEven ? '60px' : '0',
                                }}
                            >
                                <h2 className={`text-lg font-bold ${colors.text} mb-3 flex items-center gap-3`}>
                                    <span className={`w-7 h-7 rounded-full ${colors.circleBg} flex items-center justify-center text-[11px] font-black text-white shadow-lg shrink-0`}>{i + 1}</span>
                                    <span style={{ fontFamily: 'Georgia, serif' }}>{section.heading || section.title}</span>
                                </h2>

                                {(sectionType === 'bullets' || sectionType === 'numbered') && (
                                    <ul className="space-y-2 ml-10">
                                        {(section.bullets || section.points || []).map((bullet: string, j: number) => (
                                            <li key={j} className={`flex items-start gap-3 text-[13px] ${colors.text} leading-relaxed`}>
                                                {sectionType === 'numbered'
                                                    ? <span className={`text-xs font-bold ${colors.accent} mt-0.5 w-5 shrink-0`}>{j + 1}.</span>
                                                    : <span className={`w-1.5 h-1.5 rounded-full ${colors.bulletColor} mt-2 shrink-0`} />
                                                }
                                                {bullet}
                                            </li>
                                        ))}
                                    </ul>
                                )}

                                {sectionType === 'table' && section.table && (
                                    <div className={`ml-10 overflow-hidden rounded-lg border ${colors.border}`} style={{ backgroundColor: '#fff', position: 'relative', zIndex: 3 }}>
                                        <table className="w-full text-[12px]">
                                            <thead>
                                                <tr className={colors.accentBg}>
                                                    {(section.table.headers || []).map((h: string, hi: number) => (
                                                        <th key={hi} className={`px-3 py-2 text-left font-bold ${colors.text} border-b ${colors.border}`}>{h}</th>
                                                    ))}
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {(section.table.rows || []).map((row: string[], ri: number) => (
                                                    <tr key={ri} className={ri % 2 === 0 ? '' : colors.accentBg}>
                                                        {row.map((cell: string, ci: number) => (
                                                            <td key={ci} className={`px-3 py-2 ${colors.text} border-b ${colors.border}`}>{cell}</td>
                                                        ))}
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}

                                {sectionType === 'callout' && (
                                    <div className={`ml-10 ${colors.accentBg} rounded-lg p-4 border-l-4 ${colors.border}`}>
                                        <p className={`text-[13px] ${colors.text} italic leading-relaxed`}>
                                            💡 &ldquo;{section.calloutText || section.bullets?.[0] || ''}&rdquo;
                                        </p>
                                    </div>
                                )}

                                {sectionType === 'highlight' && (
                                    <div className={`ml-10 ${colors.codeBg} rounded-lg p-4 border ${colors.border}`}>
                                        <p className={`text-xs font-black uppercase tracking-wider ${colors.accent} mb-2`}>
                                            ⭐ {section.highlightTitle || 'Key Takeaway'}
                                        </p>
                                        <p className={`text-[13px] ${colors.text} leading-relaxed`}>
                                            {section.highlightBody || section.bullets?.[0] || ''}
                                        </p>
                                    </div>
                                )}

                                {!['bullets', 'numbered', 'table', 'callout', 'highlight'].includes(sectionType) && (
                                    <ul className="space-y-2 ml-10">
                                        {(section.bullets || section.points || []).map((bullet: string, j: number) => (
                                            <li key={j} className={`flex items-start gap-3 text-[13px] ${colors.text} leading-relaxed`}>
                                                <span className={`w-1.5 h-1.5 rounded-full ${colors.bulletColor} mt-2 shrink-0`} />
                                                {bullet}
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>

                            {i === imgPos && imageAssets.map((asset: any, ai: number) => (
                                <figure key={`asset-${ai}`} className="rounded-lg overflow-hidden border border-gray-200 my-6 mx-auto" style={{ breakInside: 'avoid', maxWidth: '85%', backgroundColor: '#fff', position: 'relative', zIndex: 3 }}>
                                    <img src={asset.url} alt={asset.name || `Figure ${ai + 1}`}
                                        className="w-full object-contain p-3" crossOrigin="anonymous" style={{ maxHeight: '400px' }} />
                                </figure>
                            ))}
                        </div>
                    )
                })}
            </div>

            {/* Summary */}
            {data.summary && (
                <div className={`${colors.accentBg} rounded-lg p-5 mt-8 border-l-4 ${colors.border}`} style={{ breakInside: 'avoid' }}>
                    <h3 className={`text-[10px] font-black uppercase tracking-[0.2em] ${colors.accent} mb-2`}>Summary</h3>
                    <p className={`text-sm ${colors.text} leading-relaxed italic`}>{data.summary}</p>
                </div>
            )}
        </div>
    )
}

// ─── Flashcard Template ──────────────────────────────────────
function FlashcardTemplate({ data, colors, assets }: { data: any; colors: DesignConfig['colors']; assets: any[] }) {
    const cards = data.cards || []
    return (
        <div className="space-y-6">
            <div className={`${colors.card} rounded-2xl p-6 ${colors.border} border text-center`}>
                <h1 className={`text-3xl font-black ${colors.text} mb-1`}>{data.title}</h1>
                <p className={`text-sm ${colors.muted}`}>{cards.length} flashcards</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
                {cards.map((card: any, i: number) => {
                    const diffColors: Record<string, string> = {
                        easy: 'border-l-emerald-500',
                        medium: 'border-l-amber-500',
                        hard: 'border-l-red-500',
                    }
                    return (
                        <div key={i} className={`${colors.card} rounded-xl p-5 ${colors.border} border border-l-4 ${diffColors[card.difficulty] || 'border-l-violet-500'}`}>
                            <p className={`text-xs font-bold uppercase tracking-wider ${colors.accent} mb-2`}>{card.category || `Card ${i + 1}`}</p>
                            <p className={`text-base font-bold ${colors.text} mb-3`}>{card.front}</p>
                            <div className={`w-full h-px ${colors.border} my-3`} />
                            <p className={`text-sm ${colors.muted} leading-relaxed`}>{card.back}</p>
                        </div>
                    )
                })}
            </div>
        </div>
    )
}

// ─── Infographic Template ────────────────────────────────────
function InfographicTemplate({ data, colors, assets }: { data: any; colors: DesignConfig['colors']; assets: any[] }) {
    return (
        <div className="space-y-6">
            {/* Hero */}
            <div className={`${colors.card} rounded-2xl p-8 ${colors.border} border text-center`}>
                <h1 className={`text-4xl font-black ${colors.text} mb-2`}>{data.headline || data.title}</h1>
                {data.subtitle && <p className={`text-base ${colors.muted}`}>{data.subtitle}</p>}
            </div>

            {/* Stats Row */}
            {data.stats && data.stats.length > 0 && (
                <div className="grid grid-cols-3 gap-4">
                    {data.stats.map((stat: any, i: number) => (
                        <div key={i} className={`${colors.card} rounded-xl p-5 ${colors.border} border text-center`}>
                            <div className="text-3xl mb-2">{stat.icon || '📊'}</div>
                            <p className={`text-2xl font-black ${colors.accent}`}>{stat.value}</p>
                            <p className={`text-xs ${colors.muted} mt-1`}>{stat.label}</p>
                        </div>
                    ))}
                </div>
            )}

            {/* Sections */}
            {(data.sections || []).map((section: any, i: number) => (
                <div key={i} className={`${colors.card} rounded-xl p-5 ${colors.border} border`}>
                    <div className="flex items-center gap-3 mb-3">
                        <span className="text-2xl">{section.icon || '✦'}</span>
                        <h2 className={`text-lg font-bold ${colors.text}`}>{section.title}</h2>
                    </div>
                    <ul className="space-y-2 pl-10">
                        {(section.points || []).map((pt: string, j: number) => (
                            <li key={j} className={`text-sm ${colors.text} leading-relaxed flex items-start gap-2`}>
                                <span className="text-violet-500 mt-0.5">→</span> {pt}
                            </li>
                        ))}
                    </ul>
                </div>
            ))}

            {/* Embedded Assets */}
            {assets.length > 0 && (
                <div className="grid grid-cols-2 gap-4">
                    {assets.map((asset: any, i: number) => (
                        <div key={i} className={`${colors.card} rounded-xl overflow-hidden ${colors.border} border`}>
                            <img src={asset.url} alt={asset.name} className="w-full h-40 object-cover" />
                            <p className={`text-xs ${colors.muted} p-3`}>{asset.name}</p>
                        </div>
                    ))}
                </div>
            )}

            {/* Highlight */}
            {data.highlight && (
                <div className={`${colors.card} rounded-xl p-6 ${colors.border} border border-l-4 border-l-amber-500 text-center`}>
                    <p className={`text-lg font-bold ${colors.text} italic`}>💡 "{data.highlight}"</p>
                </div>
            )}
        </div>
    )
}

// ─── Cheat Sheet Template ────────────────────────────────────
function CheatSheetTemplate({ data, colors, assets }: { data: any; colors: DesignConfig['colors']; assets: any[] }) {
    return (
        <div className="space-y-5">
            <div className={`${colors.card} rounded-2xl p-5 ${colors.border} border`}>
                <h1 className={`text-2xl font-black ${colors.text} font-mono`}>{data.title}</h1>
            </div>

            {/* Columns */}
            <div className="grid grid-cols-2 gap-4">
                {(data.columns || []).map((col: any, i: number) => (
                    <div key={i} className={`${colors.card} rounded-xl p-4 ${colors.border} border`}>
                        <h3 className={`text-sm font-bold ${colors.accent} mb-3 uppercase tracking-wider`}>{col.heading}</h3>
                        <div className="space-y-2">
                            {(col.items || []).map((item: any, j: number) => (
                                <div key={j} className={`flex justify-between items-start gap-2 text-xs ${colors.text} py-1 ${j < col.items.length - 1 ? `border-b ${colors.border}` : ''}`}>
                                    <span className="font-semibold shrink-0">{item.label}</span>
                                    <span className={`${colors.muted} text-right`}>{item.value}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>

            {/* Code Blocks */}
            {(data.codeBlocks || []).map((block: any, i: number) => (
                <div key={i} className={`${colors.codeBg} rounded-xl p-4 ${colors.border} border`}>
                    <div className="flex items-center justify-between mb-2">
                        <span className={`text-xs font-bold ${colors.accent}`}>{block.title}</span>
                        <span className={`text-[10px] ${colors.muted} px-2 py-0.5 rounded ${colors.card}`}>{block.language}</span>
                    </div>
                    <pre className={`text-xs ${colors.text} font-mono overflow-x-auto whitespace-pre-wrap leading-relaxed`}>{block.code}</pre>
                </div>
            ))}

            {/* Warnings */}
            {(data.warnings || []).length > 0 && (
                <div className={`${colors.card} rounded-xl p-4 ${colors.border} border border-l-4 border-l-amber-500`}>
                    <h3 className={`text-xs font-bold uppercase tracking-wider text-amber-400 mb-2`}>⚠️ Watch Out</h3>
                    <ul className="space-y-1.5">
                        {data.warnings.map((w: string, i: number) => (
                            <li key={i} className={`text-xs ${colors.text} flex items-start gap-2`}>
                                <span className="text-amber-400">•</span> {w}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    )
}

// ─── Timeline Template ───────────────────────────────────────
function TimelineTemplate({ data, colors, assets }: { data: any; colors: DesignConfig['colors']; assets: any[] }) {
    return (
        <div className="space-y-6">
            <div className={`${colors.card} rounded-2xl p-6 ${colors.border} border text-center`}>
                <h1 className={`text-3xl font-black ${colors.text}`}>{data.title}</h1>
                {data.summary && <p className={`text-sm ${colors.muted} mt-2 max-w-lg mx-auto`}>{data.summary}</p>}
            </div>

            <div className="relative pl-8">
                {/* Vertical line */}
                <div className={`absolute left-3 top-0 bottom-0 w-0.5 ${colors.border} bg-current opacity-20`} />

                <div className="space-y-6">
                    {(data.events || []).map((event: any, i: number) => {
                        const importanceColors: Record<string, string> = {
                            high: 'bg-red-500', medium: 'bg-amber-500', low: 'bg-blue-500',
                        }
                        return (
                            <div key={i} className="relative">
                                <div className={`absolute -left-5 top-3 w-4 h-4 rounded-full ${importanceColors[event.importance] || 'bg-violet-500'} ring-4 ring-opacity-20 ${colors.bg}`} />
                                <div className={`${colors.card} rounded-xl p-5 ${colors.border} border ml-4`}>
                                    <div className="flex items-center gap-2 mb-2">
                                        <span className="text-lg">{event.icon || '📌'}</span>
                                        <span className={`text-xs font-bold ${colors.accent} px-2 py-0.5 rounded ${colors.codeBg}`}>{event.date}</span>
                                    </div>
                                    <h3 className={`text-base font-bold ${colors.text} mb-1`}>{event.title}</h3>
                                    <p className={`text-sm ${colors.muted} leading-relaxed`}>{event.description}</p>
                                </div>
                            </div>
                        )
                    })}
                </div>
            </div>
        </div>
    )
}

// ─── Mind Map Template ───────────────────────────────────────
function MindMapTemplate({ data, colors, assets }: { data: any; colors: DesignConfig['colors']; assets: any[] }) {
    const branchColors = ['from-violet-500 to-purple-500', 'from-cyan-500 to-blue-500', 'from-amber-500 to-orange-500', 'from-emerald-500 to-green-500', 'from-rose-500 to-pink-500', 'from-indigo-500 to-violet-500']
    return (
        <div className="space-y-6">
            {/* Central Topic */}
            <div className={`${colors.card} rounded-2xl p-8 ${colors.border} border text-center`}>
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500 to-purple-500 flex items-center justify-center mx-auto mb-4 shadow-lg">
                    <Brain className="w-8 h-8 text-white" />
                </div>
                <h1 className={`text-3xl font-black ${colors.text}`}>{data.centralTopic || data.title}</h1>
            </div>

            {/* Branches */}
            <div className="grid grid-cols-2 gap-4">
                {(data.branches || []).map((branch: any, i: number) => (
                    <div key={i} className={`${colors.card} rounded-xl p-5 ${colors.border} border`}>
                        <div className="flex items-center gap-3 mb-3">
                            <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${branchColors[i % branchColors.length]} flex items-center justify-center text-white text-xs font-bold shadow-md`}>
                                {i + 1}
                            </div>
                            <h2 className={`text-base font-bold ${colors.text}`}>{branch.label}</h2>
                        </div>
                        <div className="space-y-2 pl-11">
                            {(branch.children || []).map((child: any, j: number) => (
                                <div key={j} className={`text-sm ${colors.text} py-1.5 ${j < branch.children.length - 1 ? `border-b ${colors.border}` : ''}`}>
                                    <span className="font-semibold">{child.label}</span>
                                    {child.detail && <p className={`text-xs ${colors.muted} mt-0.5`}>{child.detail}</p>}
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    )
}

// ─── Note Viewer Page ────────────────────────────────────────
export default function NoteViewerPage() {
    const params = useParams()
    const router = useRouter()
    const noteId = params.noteId as string

    const [project, setProject] = useState<NoteProject | null>(null)
    const [loading, setLoading] = useState(true)
    const [regenerating, setRegenerating] = useState(false)
    const [exporting, setExporting] = useState(false)
    const noteRef = useRef<HTMLDivElement>(null)
    const [pageCount, setPageCount] = useState(1)
    const measureRef = useRef<HTMLDivElement>(null)
    const PAGE_HEIGHT = 1050
    const [pageAssignments, setPageAssignments] = useState<number[][]>([[]])

    const fetchProject = useCallback(async () => {
        try {
            const res = await fetch(`/api/notes/${noteId}`)
            const data = await res.json()
            if (data.success) setProject(data.project)
        } catch {
            toast.error('Failed to load note')
        } finally {
            setLoading(false)
        }
    }, [noteId])

    useEffect(() => {
        fetchProject()
    }, [fetchProject])

    // Measure content blocks and assign to pages
    useEffect(() => {
        setTimeout(() => {
            if (!measureRef.current) return
            const items = measureRef.current.querySelectorAll('[data-block]')
            if (!items.length) return

            const pages: number[][] = [[]]
            let currentPage = 0
            let currentH = 0

            items.forEach((el, i) => {
                const h = (el as HTMLElement).offsetHeight + 24
                if (currentH + h > PAGE_HEIGHT && pages[currentPage].length > 0) {
                    currentPage++
                    pages.push([i])
                    currentH = h
                } else {
                    pages[currentPage].push(i)
                    currentH += h
                }
            })

            setPageAssignments(pages)
            setPageCount(pages.length)
        }, 300)
    }, [project?.generatedData])

    const handleRegenerate = async () => {
        setRegenerating(true)
        try {
            const res = await fetch(`/api/notes/${noteId}/generate`, { method: 'POST' })
            const data = await res.json()
            if (data.success) {
                toast.success('Notes regenerated!')
                fetchProject()
            } else {
                toast.error(data.error || 'Regeneration failed')
            }
        } catch {
            toast.error('Something went wrong')
        } finally {
            setRegenerating(false)
        }
    }

    const handleExportPDF = async () => {
        if (!noteRef.current) return
        setExporting(true)
        toast.info('📄 Generating multi-page PDF...')
        try {
            const canvas = await html2canvas(noteRef.current, {
                scale: 2,
                useCORS: true,
                backgroundColor: getDesignPageBg(project?.pageDesign),
                logging: false,
            })

            const imgWidth = 210 // A4 width in mm
            const pageHeight = 297 // A4 height in mm
            const imgHeight = (canvas.height * imgWidth) / canvas.width
            const pdf = new jsPDF('p', 'mm', 'a4')

            let heightLeft = imgHeight
            let position = 0
            const imgData = canvas.toDataURL('image/jpeg', 0.95)

            // First page
            pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight)
            heightLeft -= pageHeight

            // Additional pages
            while (heightLeft > 0) {
                position -= pageHeight
                pdf.addPage()
                pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight)
                heightLeft -= pageHeight
            }

            pdf.save(`${project?.title || 'notes'}.pdf`)
            toast.success(`✅ Exported as PDF (${pdf.getNumberOfPages()} pages)`)
        } catch (err) {
            toast.error('PDF export failed')
            console.error(err)
        } finally {
            setExporting(false)
        }
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-screen">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
        )
    }

    if (!project) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen gap-4">
                <p className="text-muted-foreground">Note not found</p>
                <Link href="/notes" className="text-primary underline">Back to Notes</Link>
            </div>
        )
    }

    const designConfig = getDesignConfig(project.pageDesign)
    const colors = designConfig.colors
    const data = project.generatedData
    const assets = (project.uploadedAssets || []) as any[]

    const renderTemplate = () => {
        if (!data) {
            return (
                <div className="space-y-6">
                    {/* Show extracted content from Sarvam if available */}
                    {project.extractedContent && (
                        <div className={`${colors.card} rounded-2xl p-6 ${colors.border} border`}>
                            <div className="flex items-center gap-2 mb-4">
                                <FileText className={`w-5 h-5 ${colors.accent}`} />
                                <h3 className={`text-lg font-bold ${colors.text}`}>📄 Extracted Document Content (Sarvam Vision)</h3>
                            </div>
                            <div className={`${colors.codeBg} rounded-xl p-4 max-h-[500px] overflow-y-auto`}>
                                <pre className={`text-xs ${colors.text} font-mono whitespace-pre-wrap leading-relaxed`}>
                                    {project.extractedContent}
                                </pre>
                            </div>
                            <p className={`text-xs ${colors.muted} mt-3`}>✅ {project.extractedContent.length.toLocaleString()} characters extracted · Review the content above, then generate notes</p>
                        </div>
                    )}

                    <div className={`${colors.card} rounded-2xl p-12 ${colors.border} border text-center`}>
                        <Sparkles className={`w-12 h-12 ${colors.muted} mx-auto mb-4`} />
                        <h2 className={`text-xl font-bold ${colors.text} mb-2`}>
                            {project.extractedContent ? 'Ready to Generate Notes' : 'No notes generated yet'}
                        </h2>
                        <p className={`text-sm ${colors.muted} mb-6`}>
                            {project.extractedContent
                                ? 'Content has been extracted from your document. Click below to create beautiful structured notes.'
                                : 'Click "Generate" to create your notes'
                            }
                        </p>
                        <button onClick={handleRegenerate} disabled={regenerating}
                            className="px-6 py-2.5 rounded-xl bg-violet-600 text-white font-bold text-sm hover:bg-violet-700 transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-2 mx-auto">
                            {regenerating ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating...</> : <><Sparkles className="w-4 h-4" /> Generate Notes</>}
                        </button>
                    </div>
                </div>
            )
        }

        switch (project.noteStyle) {
            case 'cornell': return <CornellTemplate data={data} colors={colors} assets={assets} />
            case 'flashcard': return <FlashcardTemplate data={data} colors={colors} assets={assets} />
            case 'infographic': return <InfographicTemplate data={data} colors={colors} assets={assets} />
            case 'cheatsheet': return <CheatSheetTemplate data={data} colors={colors} assets={assets} />
            case 'timeline': return <TimelineTemplate data={data} colors={colors} assets={assets} />
            case 'mindmap': return <MindMapTemplate data={data} colors={colors} assets={assets} />
            default: return <CornellTemplate data={data} colors={colors} assets={assets} />
        }
    }

    const designKey = (project.pageDesign || 'botanical') as NoteDesignKey
    const designPageBg = getDesignPageBg(designKey)

    // ── Build content blocks for pagination ──
    const allSections = data ? (data.mainNotes || data.sections || []) : []
    const imageAssets = assets.filter((a: any) => a.type?.startsWith('image/'))
    const imgPos = data?.imagePosition ?? 2

    // Each "block" is: title | section | image | ai-image | summary
    type Block = { type: 'title' } | { type: 'section'; idx: number; section: any } | { type: 'image'; asset: any; assetIdx: number } | { type: 'ai-image'; imageUrl: string; prompt: string } | { type: 'summary' }
    const contentBlocks: Block[] = []
    contentBlocks.push({ type: 'title' })

    // AI-generated page images
    const pageImages: Array<{ pageIndex: number; imageUrl: string; prompt: string }> = data?.pageImages || []
    // Build a map: sectionIdx → ai-images for that page
    const SECTIONS_PER_PAGE = 4
    const aiImagesBySectionIdx = new Map<number, Array<{ imageUrl: string; prompt: string }>>()
    pageImages.forEach((pi) => {
        // Place AI image after the last section of that page
        const sectionIdx = Math.min((pi.pageIndex + 1) * SECTIONS_PER_PAGE - 1, allSections.length - 1)
        if (!aiImagesBySectionIdx.has(sectionIdx)) aiImagesBySectionIdx.set(sectionIdx, [])
        aiImagesBySectionIdx.get(sectionIdx)!.push({ imageUrl: pi.imageUrl, prompt: pi.prompt || '' })
    })

    allSections.forEach((section: any, i: number) => {
        contentBlocks.push({ type: 'section', idx: i, section })
        // Insert user-uploaded images at imgPos
        if (i === imgPos) {
            imageAssets.forEach((asset: any, ai: number) => {
                contentBlocks.push({ type: 'image', asset, assetIdx: ai })
            })
        }
        // Insert AI-generated images after this section
        if (aiImagesBySectionIdx.has(i)) {
            aiImagesBySectionIdx.get(i)!.forEach((aiImg) => {
                contentBlocks.push({ type: 'ai-image', imageUrl: aiImg.imageUrl, prompt: aiImg.prompt })
            })
        }
    })
    // If uploaded images weren't placed (imgPos >= sections length), add at end
    if (imgPos >= allSections.length) {
        imageAssets.forEach((asset: any, ai: number) => {
            contentBlocks.push({ type: 'image', asset, assetIdx: ai })
        })
    }
    if (data?.summary) contentBlocks.push({ type: 'summary' })



    // ── Render a single content block ──
    const renderBlock = (block: Block) => {
        if (block.type === 'title') {
            return (
                <div className="text-center mb-8 pt-4">
                    <h1 className={`text-4xl font-black ${colors.text} tracking-tight leading-tight`} style={{ fontFamily: 'Georgia, serif' }}>
                        {data?.title || project.title}
                    </h1>
                    <p className={`text-right mt-3 text-sm ${colors.muted}`}>
                        {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
                    </p>
                </div>
            )
        }

        if (block.type === 'section') {
            const section = block.section
            const i = block.idx
            const sectionType = section.type || 'bullets'
            const isEven = i % 2 === 0
            const hex = designConfig.hex

            // ── CARDS layout (icon cards in a 3-col grid) ──────────────
            if (sectionType === 'cards') {
                const items: Array<{ icon?: string; title: string; description: string }> = section.cards || section.items || []
                return (
                    <div className="pb-4">
                        <h2 className={`text-base font-bold ${colors.text} mb-3 flex items-center gap-2`} style={{ fontFamily: 'Georgia, serif' }}>
                            <span className={`w-6 h-6 rounded-full ${colors.circleBg} flex items-center justify-center text-[10px] font-black text-white shadow shrink-0`}>{i + 1}</span>
                            {section.heading || section.title}
                        </h2>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
                            {items.map((item: any, j: number) => {
                                const IconComp = resolveCardIcon(item.icon, item.title)
                                return (
                                    <div key={j} style={{
                                        background: `linear-gradient(135deg, ${hex.accentLight} 0%, ${hex.accentLighter} 100%)`,
                                        borderRadius: '12px',
                                        padding: '14px 12px',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: '8px',
                                        border: `1px solid ${hex.accentBorder}`,
                                    }}>
                                        <div style={{
                                            width: '36px', height: '36px', borderRadius: '50%',
                                            background: hex.circle,
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            flexShrink: 0,
                                        }}>
                                            <IconComp style={{ color: '#fff', fontSize: '16px' }} />
                                        </div>
                                        <p className="font-bold text-[12px]" style={{ color: hex.text, lineHeight: 1.2 }}>{item.title}</p>
                                        <p className="text-[11px]" style={{ color: hex.muted, lineHeight: 1.4 }}>{item.description}</p>
                                    </div>
                                )
                            })}
                        </div>
                    </div>
                )
            }

            // ── NUMBERED-GRID layout (01/02 2-column with divider lines) ─
            if (sectionType === 'numbered-grid') {
                const items: Array<{ title: string; description: string }> = section.items || section.bullets?.map((b: string) => ({ title: b.split(':')[0] || b, description: b.split(':').slice(1).join(':').trim() || b })) || []
                return (
                    <div className="pb-4">
                        <h2 className={`text-base font-bold ${colors.text} mb-3 flex items-center gap-2`} style={{ fontFamily: 'Georgia, serif' }}>
                            <span className={`w-6 h-6 rounded-full ${colors.circleBg} flex items-center justify-center text-[10px] font-black text-white shadow shrink-0`}>{i + 1}</span>
                            {section.heading || section.title}
                        </h2>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0' }}>
                            {items.map((item: any, j: number) => (
                                <div key={j} style={{
                                    padding: '10px 14px',
                                    borderBottom: `1px solid ${hex.accentBorder}`,
                                    borderRight: j % 2 === 0 ? `1px solid ${hex.accentBorder}` : 'none',
                                }}>
                                    <div style={{ fontSize: '10px', color: hex.line, fontWeight: 600, marginBottom: '4px', letterSpacing: '0.05em' }}>
                                        {String(j + 1).padStart(2, '0')}
                                    </div>
                                    <div style={{ height: '1px', background: hex.accent, marginBottom: '6px', width: '32px' }} />
                                    <p className="font-bold text-[12px]" style={{ color: hex.text, marginBottom: '3px' }}>{item.title}</p>
                                    <p className="text-[11px]" style={{ color: hex.muted, lineHeight: 1.4 }}>{item.description}</p>
                                </div>
                            ))}
                        </div>
                    </div>
                )
            }

            // ── CIRCULAR-MAP layout (flower petals around a center) ────
            if (sectionType === 'circular-map') {
                const items: Array<{ title: string; description: string }> = section.items || section.bullets?.map((b: string) => ({ title: b.split(':')[0] || b, description: b.split(':').slice(1).join(':').trim() || b })) || []
                const count = Math.min(items.length, 8)
                const centerTitle = section.centerLabel || section.heading || section.title
                return (
                    <div className="pb-4">
                        <h2 className={`text-base font-bold ${colors.text} mb-3 flex items-center gap-2`} style={{ fontFamily: 'Georgia, serif' }}>
                            <span className={`w-6 h-6 rounded-full ${colors.circleBg} flex items-center justify-center text-[10px] font-black text-white shadow shrink-0`}>{i + 1}</span>
                            {centerTitle}
                        </h2>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '20px', background: `linear-gradient(135deg, ${hex.accentLight} 0%, ${hex.accentLighter} 100%)`, borderRadius: '12px', padding: '16px 20px', minHeight: '180px' }}>
                            {/* Left labels */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', flex: 1, textAlign: 'right' }}>
                                {items.slice(0, Math.ceil(count / 2)).map((item: any, j: number) => (
                                    <div key={j}>
                                        <p className="font-bold text-[11px]" style={{ color: hex.text }}>{item.title}</p>
                                        <p className="text-[10px]" style={{ color: hex.muted, lineHeight: 1.3 }}>{item.description}</p>
                                    </div>
                                ))}
                            </div>
                            {/* Center circle with petals */}
                            <div style={{ position: 'relative', width: '100px', height: '100px', flexShrink: 0 }}>
                                {/* Petals */}
                                {Array.from({ length: count }).map((_, k) => {
                                    const angle = (k / count) * 360 - 90
                                    const rad = (angle * Math.PI) / 180
                                    const x = 50 + 34 * Math.cos(rad)
                                    const y = 50 + 34 * Math.sin(rad)
                                    return (
                                        <div key={k} style={{
                                            position: 'absolute',
                                            left: `${x}%`, top: `${y}%`,
                                            transform: 'translate(-50%,-50%)',
                                            width: '22px', height: '22px',
                                            borderRadius: '50%',
                                            background: hex.accentLight,
                                            border: `2px solid ${hex.line}`,
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            fontSize: '8px', fontWeight: 800, color: hex.accent,
                                        }}>{k + 1}</div>
                                    )
                                })}
                                {/* Center */}
                                <div style={{
                                    position: 'absolute', left: '50%', top: '50%',
                                    transform: 'translate(-50%,-50%)',
                                    width: '30px', height: '30px', borderRadius: '50%',
                                    background: hex.accentLight, border: `2px solid ${hex.line}`,
                                }} />
                            </div>
                            {/* Right labels */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', flex: 1, textAlign: 'left' }}>
                                {items.slice(Math.ceil(count / 2)).map((item: any, j: number) => (
                                    <div key={j}>
                                        <p className="font-bold text-[11px]" style={{ color: hex.text }}>{item.title}</p>
                                        <p className="text-[10px]" style={{ color: hex.muted, lineHeight: 1.3 }}>{item.description}</p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )
            }

            // ── QUOTE-CARDS layout (big quote marks) ──────────────────
            if (sectionType === 'quote-cards') {
                const quotes: Array<{ title: string; text: string }> = section.quotes || section.bullets?.map((b: string, k: number) => ({ title: `Insight ${k + 1}`, text: b })) || []
                return (
                    <div className="pb-4">
                        <h2 className={`text-base font-bold ${colors.text} mb-3 flex items-center gap-2`} style={{ fontFamily: 'Georgia, serif' }}>
                            <span className={`w-6 h-6 rounded-full ${colors.circleBg} flex items-center justify-center text-[10px] font-black text-white shadow shrink-0`}>{i + 1}</span>
                            {section.heading || section.title}
                        </h2>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }}>
                            {quotes.map((q: any, j: number) => (
                                <div key={j} style={{
                                    background: `linear-gradient(135deg, ${hex.accentLight} 0%, ${hex.accentLighter} 100%)`,
                                    borderRadius: '12px',
                                    padding: '14px 14px 18px',
                                    border: `1px solid ${hex.accentBorder}`,
                                    position: 'relative',
                                }}>
                                    <div style={{ fontSize: '28px', color: hex.quoteMark, lineHeight: 1, fontFamily: 'Georgia, serif', fontWeight: 900, marginBottom: '6px', opacity: 0.7 }}>&ldquo;</div>
                                    <p className="font-bold text-[12px]" style={{ color: hex.text, marginBottom: '6px', lineHeight: 1.3 }}>{q.title}</p>
                                    <p className="text-[11px]" style={{ color: hex.muted, lineHeight: 1.5 }}>{q.text}</p>
                                    <div style={{ position: 'absolute', bottom: '8px', right: '12px', fontSize: '28px', color: hex.quoteMark, lineHeight: 1, fontFamily: 'Georgia, serif', fontWeight: 900, opacity: 0.7 }}>&rdquo;</div>
                                </div>
                            ))}
                        </div>
                    </div>
                )
            }

            // ── FLOWCHART layout (vertical step flow) ───────────────
            if (sectionType === 'flowchart') {
                const steps: Array<{ label: string; detail?: string }> = section.steps || section.bullets?.map((b: string) => ({ label: b.split(':')[0] || b, detail: b.split(':').slice(1).join(':').trim() })) || []
                return (
                    <div className="pb-4">
                        <h2 className={`text-base font-bold ${colors.text} mb-3 flex items-center gap-2`} style={{ fontFamily: 'Georgia, serif' }}>
                            <span className={`w-6 h-6 rounded-full ${colors.circleBg} flex items-center justify-center text-[10px] font-black text-white shadow shrink-0`}>{i + 1}</span>
                            {section.heading || section.title}
                        </h2>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
                            {steps.map((step: any, j: number) => (
                                <div key={j} style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                                    {/* Connector column */}
                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '28px', flexShrink: 0 }}>
                                        <div style={{
                                            width: '28px', height: '28px', borderRadius: '50%',
                                            background: hex.circle,
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            fontSize: '11px', color: '#fff', fontWeight: 800, flexShrink: 0,
                                        }}>{j + 1}</div>
                                        {j < steps.length - 1 && (
                                            <div style={{ width: '2px', flex: 1, minHeight: '16px', background: hex.line, marginTop: '2px', marginBottom: '2px' }} />
                                        )}
                                    </div>
                                    {/* Content */}
                                    <div style={{ paddingBottom: j < steps.length - 1 ? '10px' : '0', paddingTop: '4px' }}>
                                        <p className="font-bold text-[12px]" style={{ color: hex.text, marginBottom: '2px' }}>{step.label}</p>
                                        {step.detail && <p className="text-[11px]" style={{ color: hex.muted, lineHeight: 1.4 }}>{step.detail}</p>}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )
            }

            // ── HORIZONTAL-FLOWCHART layout (circular bubble infographic) ─
            if (sectionType === 'horizontal-flowchart') {
                const steps: Array<{ label: string; detail?: string; icon?: string }> =
                    section.steps ||
                    section.items ||
                    section.bullets?.map((b: string) => ({ label: b.split(':')[0] || b, detail: b.split(':').slice(1).join(':').trim() })) ||
                    []

                // Color palette cycling green → teal → sky → blue (matches the reference image)
                const bubblePalettes = [
                    { bg: 'linear-gradient(145deg, #7ec84a 0%, #5aaa28 100%)', shadow: 'rgba(94,170,40,0.35)' },
                    { bg: 'linear-gradient(145deg, #3ec9a7 0%, #22a880 100%)', shadow: 'rgba(34,168,128,0.35)' },
                    { bg: 'linear-gradient(145deg, #35b8d4 0%, #1a96b8 100%)', shadow: 'rgba(26,150,184,0.35)' },
                    { bg: 'linear-gradient(145deg, #3a87d4 0%, #2066b8 100%)', shadow: 'rgba(32,102,184,0.35)' },
                ]
                const letters = ['A','B','C','D','E','F','G','H']

                return (
                    <div className="pb-4">
                        <h2 className={`text-base font-bold ${colors.text} mb-4 flex items-center gap-2`} style={{ fontFamily: 'Georgia, serif' }}>
                            <span className={`w-6 h-6 rounded-full ${colors.circleBg} flex items-center justify-center text-[10px] font-black text-white shadow shrink-0`}>{i + 1}</span>
                            {section.heading || section.title}
                        </h2>

                        {/* Horizontal row of bubbles */}
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0', overflowX: 'auto', paddingBottom: '6px' }}>
                            {steps.slice(0, 8).map((step: any, j: number) => {
                                const palette = bubblePalettes[j % bubblePalettes.length]
                                const letter = letters[j] || String(j + 1)
                                const IconComp = resolveCardIcon(step.icon, step.label)
                                return (
                                    <div key={j} style={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 0 }}>
                                        {/* Bubble + label column */}
                                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1, minWidth: 0 }}>
                                            {/* Circle bubble */}
                                            <div style={{
                                                position: 'relative',
                                                width: '110px',
                                                height: '110px',
                                                borderRadius: '50%',
                                                background: palette.bg,
                                                boxShadow: `0 8px 24px ${palette.shadow}, 0 2px 8px rgba(0,0,0,0.12)`,
                                                flexShrink: 0,
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                            }}>
                                                {/* Letter badge — top-left */}
                                                <div style={{
                                                    position: 'absolute',
                                                    top: '8px',
                                                    left: '10px',
                                                    width: '22px',
                                                    height: '22px',
                                                    borderRadius: '50%',
                                                    background: 'rgba(255,255,255,0.30)',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    fontSize: '10px',
                                                    fontWeight: 900,
                                                    color: '#fff',
                                                    letterSpacing: '0.02em',
                                                }}>{letter}</div>

                                                {/* Icon — centered-right area */}
                                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', marginLeft: '14px' }}>
                                                    <IconComp style={{ fontSize: '26px', color: 'rgba(255,255,255,0.92)' }} />
                                                </div>

                                                {/* Subtle inner shadow on bottom half */}
                                                <div style={{
                                                    position: 'absolute',
                                                    bottom: 0,
                                                    left: 0,
                                                    right: 0,
                                                    height: '55%',
                                                    borderRadius: '0 0 50% 50%',
                                                    background: 'rgba(0,0,0,0.12)',
                                                    pointerEvents: 'none',
                                                }} />

                                                {/* Arrow pointer on right edge */}
                                                {j < steps.slice(0, 8).length - 1 && (
                                                    <div style={{
                                                        position: 'absolute',
                                                        right: '-10px',
                                                        top: '50%',
                                                        transform: 'translateY(-50%)',
                                                        width: 0,
                                                        height: 0,
                                                        borderTop: '10px solid transparent',
                                                        borderBottom: '10px solid transparent',
                                                        borderLeft: `10px solid ${palette.bg.includes('7ec') ? '#5aaa28' : palette.bg.includes('3ec') ? '#22a880' : palette.bg.includes('35b') ? '#1a96b8' : '#2066b8'}`,
                                                        zIndex: 2,
                                                    }} />
                                                )}
                                            </div>

                                            {/* Text below bubble */}
                                            <div style={{ textAlign: 'center', marginTop: '10px', padding: '0 4px', maxWidth: '120px' }}>
                                                <p style={{ fontSize: '11px', fontWeight: 800, color: hex.text, lineHeight: 1.2, marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{step.label}</p>
                                                {step.detail && (
                                                    <p style={{ fontSize: '9.5px', color: hex.muted, lineHeight: 1.4 }}>{step.detail}</p>
                                                )}
                                            </div>
                                        </div>

                                        {/* Horizontal connector line between bubbles (hidden on last) */}
                                        {j < steps.slice(0, 8).length - 1 && (
                                            <div style={{ width: '18px', height: '2px', background: `linear-gradient(90deg, ${hex.line}, ${hex.accentBorder})`, flexShrink: 0, marginTop: '-40px', opacity: 0.5 }} />
                                        )}
                                    </div>
                                )
                            })}
                        </div>
                    </div>
                )
            }

            // ── RADIAL-LIST layout (center circle with lines to hexagon items) ──
            if (sectionType === 'radial-list') {
                const items: Array<{ icon?: string; title: string; description: string }> =
                    section.items ||
                    section.cards ||
                    section.bullets?.map((b: string) => ({ title: b.split(':')[0] || b, description: b.split(':').slice(1).join(':').trim() || b })) ||
                    []

                const centerLabel = section.centerLabel || section.heading || section.title
                return (
                    <div className="pb-4">
                        <h2 className={`text-base font-bold ${colors.text} mb-4 flex items-center gap-2`} style={{ fontFamily: 'Georgia, serif' }}>
                            <span className={`w-6 h-6 rounded-full ${colors.circleBg} flex items-center justify-center text-[10px] font-black text-white shadow shrink-0`}>{i + 1}</span>
                            {section.heading || section.title}
                        </h2>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '0', minHeight: '160px' }}>
                            {/* Center circle */}
                            <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', marginRight: '0' }}>
                                <div style={{
                                    width: '90px', height: '90px', borderRadius: '50%',
                                    background: `linear-gradient(135deg, ${hex.accentLight}, ${hex.accentLighter})`,
                                    border: `3px solid ${hex.accentBorder}`,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    boxShadow: `0 4px 16px ${hex.accentBorder}`,
                                    padding: '10px', textAlign: 'center',
                                }}>
                                    <p style={{ fontSize: '10px', fontWeight: 800, color: hex.accent, lineHeight: 1.3, textTransform: 'uppercase', letterSpacing: '0.03em' }}>{centerLabel}</p>
                                </div>
                            </div>

                            {/* Connector + items */}
                            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                {items.slice(0, 5).map((item: any, j: number) => {
                                    const IconComp = resolveCardIcon(item.icon, item.title)
                                    return (
                                        <div key={j} style={{ display: 'flex', alignItems: 'center', gap: '0' }}>
                                            {/* Horizontal connector line */}
                                            <div style={{ width: '40px', height: '1.5px', background: `linear-gradient(90deg, ${hex.accentBorder}, ${hex.line})`, flexShrink: 0 }} />
                                            {/* Horizontal tick */}
                                            <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: hex.accent, flexShrink: 0, marginRight: '10px' }} />
                                            {/* Hexagon-framed card */}
                                            <div style={{
                                                flex: 1,
                                                background: `linear-gradient(135deg, ${hex.accentLight} 0%, ${hex.accentLighter} 100%)`,
                                                border: `1.5px solid ${hex.accentBorder}`,
                                                borderRadius: '10px',
                                                padding: '8px 12px',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '10px',
                                            }}>
                                                <div style={{
                                                    width: '32px', height: '32px', borderRadius: '8px',
                                                    background: hex.circle,
                                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                    flexShrink: 0,
                                                }}>
                                                    <IconComp style={{ fontSize: '14px', color: '#fff' }} />
                                                </div>
                                                <div>
                                                    <p style={{ fontSize: '11px', fontWeight: 800, color: hex.text, marginBottom: '2px', lineHeight: 1.2 }}>{item.title}</p>
                                                    <p style={{ fontSize: '9.5px', color: hex.muted, lineHeight: 1.4 }}>{item.description}</p>
                                                </div>
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        </div>
                    </div>
                )
            }

            // ── STEP-CARDS layout (horizontal cards with STEP 01/02 tab badges) ─
            if (sectionType === 'step-cards') {
                const steps: Array<{ label: string; detail?: string; icon?: string }> =
                    section.steps ||
                    section.items ||
                    section.bullets?.map((b: string) => ({ label: b.split(':')[0] || b, detail: b.split(':').slice(1).join(':').trim() })) ||
                    []

                // Alternating muted step-card color palette (blue-grey shades like image 2)
                const stepAccents = [hex.accent, '#4a7fa5', '#5b6e7c', '#3d7a8a', '#5a5fa5']

                return (
                    <div className="pb-4">
                        <h2 className={`text-base font-bold ${colors.text} mb-4 flex items-center gap-2`} style={{ fontFamily: 'Georgia, serif' }}>
                            <span className={`w-6 h-6 rounded-full ${colors.circleBg} flex items-center justify-center text-[10px] font-black text-white shadow shrink-0`}>{i + 1}</span>
                            {section.heading || section.title}
                        </h2>

                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                            {steps.slice(0, 6).map((step: any, j: number) => {
                                const IconComp = resolveCardIcon(step.icon, step.label)
                                const accentColor = stepAccents[j % stepAccents.length]
                                return (
                                    <div key={j} style={{
                                        flex: '1 1 140px',
                                        minWidth: '130px',
                                        maxWidth: '180px',
                                        border: `1.5px solid ${hex.accentBorder}`,
                                        borderRadius: '10px',
                                        overflow: 'hidden',
                                        background: '#fff',
                                        boxShadow: `0 2px 8px rgba(0,0,0,0.06)`,
                                    }}>
                                        {/* Step badge tab */}
                                        <div style={{
                                            background: accentColor,
                                            padding: '6px 10px',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'space-between',
                                        }}>
                                            <span style={{ fontSize: '11px', fontWeight: 900, color: '#fff', letterSpacing: '0.05em' }}>
                                                STEP {String(j + 1).padStart(2, '0')}
                                            </span>
                                            <IconComp style={{ fontSize: '13px', color: 'rgba(255,255,255,0.8)' }} />
                                        </div>
                                        {/* Card body */}
                                        <div style={{ padding: '10px 10px 12px' }}>
                                            <p style={{ fontSize: '11px', fontWeight: 800, color: hex.text, marginBottom: '4px', lineHeight: 1.2 }}>{step.label}</p>
                                            {step.detail && (
                                                <p style={{ fontSize: '9.5px', color: hex.muted, lineHeight: 1.45 }}>{step.detail}</p>
                                            )}
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    </div>
                )
            }

            // ── DEFAULT section (bullets / numbered / table / callout / highlight) ─
            return (
                <div
                    className="pb-4"
                    style={{ marginLeft: isEven ? '0' : '48px', marginRight: isEven ? '48px' : '0' }}
                >
                    <h2 className={`text-lg font-bold ${colors.text} mb-3 flex items-center gap-3`}>
                        <span className={`w-7 h-7 rounded-full ${colors.circleBg} flex items-center justify-center text-[11px] font-black text-white shadow-lg shrink-0`}>{i + 1}</span>
                        <span style={{ fontFamily: 'Georgia, serif' }}>{section.heading || section.title}</span>
                    </h2>

                    {(sectionType === 'bullets' || sectionType === 'numbered') && (
                        <ul className="space-y-2 ml-10">
                            {(section.bullets || section.points || []).map((bullet: string, j: number) => (
                                <li key={j} className={`flex items-start gap-3 text-[13px] ${colors.text} leading-relaxed`}>
                                    {sectionType === 'numbered'
                                        ? <span className={`text-xs font-bold ${colors.accent} mt-0.5 w-5 shrink-0`}>{j + 1}.</span>
                                        : <span className={`w-1.5 h-1.5 rounded-full ${colors.bulletColor} mt-2 shrink-0`} />
                                    }
                                    {bullet}
                                </li>
                            ))}
                        </ul>
                    )}

                    {sectionType === 'table' && section.table && (
                        <div className={`ml-10 overflow-hidden rounded-lg border ${colors.border}`} style={{ backgroundColor: '#fff', position: 'relative', zIndex: 3 }}>
                            <table className="w-full text-[12px]">
                                <thead>
                                    <tr className={colors.accentBg}>
                                        {(section.table.headers || []).map((h: string, hi: number) => (
                                            <th key={hi} className={`px-3 py-2 text-left font-bold ${colors.text} border-b ${colors.border}`}>{h}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {(section.table.rows || []).map((row: string[], ri: number) => (
                                        <tr key={ri} className={ri % 2 === 0 ? '' : colors.accentBg}>
                                            {row.map((cell: string, ci: number) => (
                                                <td key={ci} className={`px-3 py-2 ${colors.text} border-b ${colors.border}`}>{cell}</td>
                                            ))}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {sectionType === 'callout' && (
                        <div className={`ml-10 ${colors.accentBg} rounded-lg p-4 border-l-4 ${colors.border}`}>
                            <p className={`text-[13px] ${colors.text} italic leading-relaxed`}>
                                💡 &ldquo;{section.calloutText || section.bullets?.[0] || ''}&rdquo;
                            </p>
                        </div>
                    )}

                    {sectionType === 'highlight' && (
                        <div className={`ml-10 ${colors.codeBg} rounded-lg p-4 border ${colors.border}`}>
                            <p className={`text-xs font-black uppercase tracking-wider ${colors.accent} mb-2`}>
                                ⭐ {section.highlightTitle || 'Key Takeaway'}
                            </p>
                            <p className={`text-[13px] ${colors.text} leading-relaxed`}>
                                {section.highlightBody || section.bullets?.[0] || ''}
                            </p>
                        </div>
                    )}

                    {!['bullets', 'numbered', 'table', 'callout', 'highlight'].includes(sectionType) && (
                        <ul className="space-y-2 ml-10">
                            {(section.bullets || section.points || []).map((bullet: string, j: number) => (
                                <li key={j} className={`flex items-start gap-3 text-[13px] ${colors.text} leading-relaxed`}>
                                    <span className={`w-1.5 h-1.5 rounded-full ${colors.bulletColor} mt-2 shrink-0`} />
                                    {bullet}
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )
        }

        if (block.type === 'image') {
            const h = designConfig.hex
            const pat = (block.assetIdx ?? 0) % 3
            const src = block.asset?.url
            const caption = block.asset?.name || `Figure ${(block.assetIdx ?? 0) + 1}`
            if (!src) return null
            if (pat === 0) return (
                <figure style={{ background: '#fff', padding: '8px 8px 26px', boxShadow: `0 6px 20px rgba(0,0,0,0.10), 0 0 0 1px ${h.accentBorder}`, borderRadius: '3px', position: 'relative', zIndex: 3, margin: '6px 0' }}>
                    <img src={src} alt={caption} crossOrigin="anonymous" style={{ width: '100%', height: '230px', objectFit: 'contain', display: 'block' }} />
                    <figcaption style={{ textAlign: 'center', fontSize: '10px', color: h.muted, marginTop: '6px', fontStyle: 'italic' }}>{caption}</figcaption>
                </figure>
            )
            if (pat === 1) return (
                <figure style={{ background: '#fff', borderRadius: '10px', overflow: 'hidden', boxShadow: `0 2px 12px rgba(0,0,0,0.08)`, borderTop: `3px solid ${h.accent}`, position: 'relative', zIndex: 3, margin: '6px 0' }}>
                    <img src={src} alt={caption} crossOrigin="anonymous" style={{ width: '100%', height: '230px', objectFit: 'contain', display: 'block', background: '#fafafa' }} />
                    <figcaption style={{ fontSize: '10px', color: h.muted, padding: '5px 10px', background: h.accentLight, fontStyle: 'italic' }}>{caption}</figcaption>
                </figure>
            )
            return (
                <figure style={{ background: `linear-gradient(135deg, ${h.accentLight}, ${h.accentLighter})`, borderRadius: '14px', padding: '6px', border: `1px solid ${h.accentBorder}`, position: 'relative', zIndex: 3, margin: '6px 0' }}>
                    <img src={src} alt={caption} crossOrigin="anonymous" style={{ width: '100%', height: '220px', objectFit: 'contain', display: 'block', borderRadius: '10px', background: '#fff' }} />
                    <figcaption style={{ textAlign: 'center', fontSize: '10px', color: h.muted, marginTop: '3px', fontStyle: 'italic', paddingBottom: '3px' }}>{caption}</figcaption>
                </figure>
            )
        }

        if (block.type === 'ai-image') {
            const h = designConfig.hex
            const pat = (block.prompt?.length ?? 0) % 3
            const src = block.imageUrl
            const alt = block.prompt ? block.prompt.slice(0, 80) : 'AI Illustration'
            if (!src) return null
            if (pat === 0) return (
                <figure style={{ background: 'transparent', padding: '8px', boxShadow: `0 6px 20px rgba(0,0,0,0.10), 0 0 0 1px ${h.accentBorder}`, borderRadius: '3px', position: 'relative', zIndex: 3, margin: '6px auto', maxWidth: '75%' }}>
                    <img src={src} alt={alt} crossOrigin="anonymous" style={{ width: '100%', height: 'auto', maxHeight: '300px', objectFit: 'contain', display: 'block', border: `2px solid ${h.accentBorder}`, borderRadius: '6px', padding: '3px' }} />
                </figure>
            )
            if (pat === 1) return (
                <figure style={{ background: 'transparent', borderRadius: '10px', overflow: 'hidden', boxShadow: `0 2px 12px rgba(0,0,0,0.08)`, borderTop: `3px solid ${h.accent}`, position: 'relative', zIndex: 3, margin: '6px auto', maxWidth: '75%' }}>
                    <img src={src} alt={alt} crossOrigin="anonymous" style={{ width: '100%', height: 'auto', maxHeight: '300px', objectFit: 'contain', display: 'block' }} />
                </figure>
            )
            return (
                <figure style={{ background: `linear-gradient(135deg, ${h.accentLight}, ${h.accentLighter})`, borderRadius: '14px', padding: '6px', border: `1px solid ${h.accentBorder}`, position: 'relative', zIndex: 3, margin: '6px auto', maxWidth: '75%' }}>
                    <img src={src} alt={alt} crossOrigin="anonymous" style={{ width: '100%', height: 'auto', maxHeight: '300px', objectFit: 'contain', display: 'block', borderRadius: '10px', border: `2px solid ${h.accentBorder}`, padding: '3px' }} />
                </figure>
            )
        }

        if (block.type === 'summary') {
            return (
                <div className={`${colors.accentBg} rounded-lg p-5 mt-4 border-l-4 ${colors.border}`}>
                    <h3 className={`text-[10px] font-black uppercase tracking-[0.2em] ${colors.accent} mb-2`}>Summary</h3>
                    <p className={`text-sm ${colors.text} leading-relaxed italic`}>{data?.summary}</p>
                </div>
            )
        }

        return null
    }

    return (
        <div className="min-h-screen bg-muted/30">
            {/* ─── Top Bar ─────────────────────────────────────────────── */}
            <div className="sticky top-0 z-50 bg-background/90 backdrop-blur-md border-b border-border">
                <div className="px-6 py-3.5 flex items-center justify-between">
                    {/* LEFT: back + title + page count */}
                    <div className="flex items-center gap-3">
                        <Link href="/notes" className="p-1.5 rounded-lg hover:bg-muted transition-colors">
                            <ArrowLeft className="w-4 h-4 text-muted-foreground" />
                        </Link>
                        <div>
                            <h1 className="text-sm font-bold text-foreground leading-tight">{project.title}</h1>
                            <p className="text-[11px] text-muted-foreground">
                                {pageCount} page{pageCount > 1 ? 's' : ''}
                            </p>
                        </div>
                    </div>
                    {/* RIGHT: Regenerate + Export PDF + Clerk */}
                    <div className="flex items-center gap-2">
                        <button
                            onClick={handleRegenerate}
                            disabled={regenerating}
                            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-muted hover:bg-muted/80 text-foreground transition-all cursor-pointer disabled:opacity-50"
                        >
                            {regenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                            Regenerate
                        </button>
                        <button
                            onClick={handleExportPDF}
                            disabled={exporting || !data}
                            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold bg-primary text-white hover:bg-primary/90 transition-all cursor-pointer disabled:opacity-50"
                        >
                            {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                            Export PDF
                        </button>
                        <div className="ml-1">
                            <UserButton afterSignOutUrl="/" />
                        </div>
                    </div>
                </div>
            </div>

            {/* Hidden div for PDF export */}
            <div style={{ position: 'absolute', left: '-9999px', top: 0 }}>
                <div ref={noteRef} style={{ width: '210mm', backgroundColor: designPageBg }}>
                    <NoteDesignBg design={designKey} />
                    <div className="relative" style={{ zIndex: 1, padding: '40px 48px 60px' }}>
                        <div className="space-y-6">
                            {contentBlocks.map((block, i) => (
                                <div key={`export-${i}`}>{renderBlock(block)}</div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            {/* Hidden measurement div — measures each block */}
            <div style={{ position: 'absolute', left: '-9999px', top: 0, width: '700px' }}>
                <div ref={measureRef} style={{ padding: '40px 48px 60px' }}>
                    {contentBlocks.map((block, i) => (
                        <div key={`measure-${i}`} data-block={i} style={{ marginBottom: '24px' }}>
                            {renderBlock(block)}
                        </div>
                    ))}
                </div>
            </div>

            {/* ═══ VISIBLE MULTI-PAGE DOCUMENT ═══ */}
            <div className="flex flex-col items-center gap-10 pt-4 pb-10 px-6" style={{ background: '#d1d5db' }}>
                {pageAssignments.map((blockIndices, pageIdx) => (
                    <div
                        key={pageIdx}
                        className="relative flex flex-col"
                        style={{
                            width: '210mm',
                            height: '297mm',
                            backgroundColor: designPageBg,
                            boxShadow: '0 4px 60px rgba(0,0,0,0.25), 0 0 0 1px rgba(0,0,0,0.08)',
                            borderRadius: '2px',
                            overflow: 'hidden',
                        }}
                    >
                        {/* Decorations on every page */}
                        <NoteDesignBg design={designKey} />

                        {/* Migoo watermark — centred, 45° slant, very faint */}
                        <div
                            className="absolute inset-0 flex items-center justify-center pointer-events-none"
                            style={{ zIndex: 1 }}
                        >
                            <img
                                src="/logo-transparent.png"
                                alt=""
                                style={{
                                    width: '320px',
                                    opacity: 0.06,
                                    transform: 'rotate(-45deg)',
                                    userSelect: 'none',
                                    filter: 'grayscale(30%)',
                                }}
                            />
                        </div>

                        {/* Page content — only this page's blocks */}
                        <div className="relative flex-1 space-y-4" style={{ zIndex: 2, padding: `${pageIdx === 0 ? 40 : 85}px 48px 24px` }}>
                            {(() => {
                                const isImg = (b: any) => b?.type === 'image' || b?.type === 'ai-image'
                                const groups: number[][] = []
                                let gi = 0
                                while (gi < blockIndices.length) {
                                    const idx = blockIndices[gi]
                                    const nIdx = gi + 1 < blockIndices.length ? blockIndices[gi + 1] : null
                                    if (isImg(contentBlocks[idx]) && nIdx !== null && isImg(contentBlocks[nIdx])) {
                                        groups.push([idx, nIdx])
                                        gi += 2
                                    } else {
                                        groups.push([idx])
                                        gi += 1
                                    }
                                }
                                return groups.map((grp, gIdx) => {
                                    if (grp.length === 2) {
                                        return (
                                            <div key={`pg${pageIdx}-grp${gIdx}`} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                                                <div style={{ flex: 1, minWidth: 0 }}>{renderBlock(contentBlocks[grp[0]])}</div>
                                                <div style={{ flex: 1, minWidth: 0 }}>{renderBlock(contentBlocks[grp[1]])}</div>
                                            </div>
                                        )
                                    }
                                    return (
                                        <div key={`pg${pageIdx}-grp${gIdx}`}>
                                            {contentBlocks[grp[0]] && renderBlock(contentBlocks[grp[0]])}
                                        </div>
                                    )
                                })
                            })()}
                        </div>

                        {/* Page footer — always at bottom */}
                        <div
                            className={`mx-12 flex justify-between items-center text-[10px] ${colors.muted} border-t ${colors.border} pt-3`}
                            style={{ zIndex: 2, marginTop: 'auto', paddingBottom: '20px', flexShrink: 0 }}
                        >
                            <span>Generated by Migoo Notes</span>
                            <span className="font-semibold">Page {pageIdx + 1} of {pageAssignments.length}</span>
                            <span>{project.title}</span>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    )
}
