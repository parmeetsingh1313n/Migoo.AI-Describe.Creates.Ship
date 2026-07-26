/**
 * Notes icon resolver — maps whatever icon hint the LLM emits ("icon-windows",
 * "terminal", "🚀", "play-circle") to a REAL outlined lucide-react icon.
 *
 * Why this exists: the notes model outputs icon *names* as strings, and the
 * renderer used to print them literally — badges showed the raw text
 * "icon-windows" instead of a Windows glyph. This module guarantees every hint
 * resolves to a drawn SVG icon: exact key → keyword scan → semantic fallback
 * chain, never text.
 *
 * All icons are lucide outlined style (stroke-based, no fills) so they read as
 * one coherent design language across every notes template.
 */
import React from 'react';
import {
    // OS / platforms / devices
    Monitor, Apple, Terminal, TerminalSquare, Laptop, Smartphone, Keyboard, MousePointer, Cpu, HardDrive, Server, Cloud, Globe, Network, Wifi, Signal,
    // Code / dev
    Code2, Braces, Binary, FileJson, GitBranch, Bug, Wrench, Settings, Cog, Package, Box, Boxes, Blocks, Component, Database, Variable, FunctionSquare, Hash, Type, Regex,
    // Actions / flow
    Play, PlayCircle, Power, Plug, RefreshCw, Repeat, LogOut, LogIn, Download, Upload, Save, Search, Filter, Shuffle, Share2, Send, ArrowRight, ChevronRight, CornerDownRight, Undo2, Redo2, Split, Workflow, Milestone, Flag, Rocket,
    // Learning / thinking
    Lightbulb, Brain, GraduationCap, BookOpen, Notebook, PenTool, Pencil, ClipboardList, ListChecks, List, Quote, Languages, HelpCircle, Puzzle, Target, Focus, Eye, Glasses,
    // Data / math / science
    BarChart3, LineChart, PieChart, TrendingUp, TrendingDown, Calculator, Sigma, Infinity as InfinityIcon, Percent, Scale, Gauge, Activity, Table2, Grid3x3, Columns, FlaskConical, Microscope, Atom, Orbit, Dna,
    // Status / feedback
    Check, CheckCircle2, XCircle, AlertTriangle, AlertCircle, Info, MinusCircle, PlusCircle, BadgeCheck, Star, Award, Trophy, Crown, Gem, Sparkles, Zap, Flame, Bell,
    // Objects / concepts
    Key, Lock, Shield, Clock, Timer, AlarmClock, Hourglass, History, Calendar, CalendarClock, Map, MapPin, Compass, Navigation, Home, Building2, Briefcase, ShoppingCart, CreditCard, DollarSign, Coins, PiggyBank, Banknote,
    // People / communication
    User, Users, MessageSquare, Mail, Phone, Mic, Headphones, Volume2, Camera, Film, Video, Image as ImageIcon, Palette,
    // Nature / misc
    Sun, MoonStar, Stars, Sunrise, CloudRain, CloudLightning, Rainbow, Snowflake, Wind, Droplets, Waves, Mountain, Trees, Leaf, Sprout, Recycle, Anchor, Ship, Plane, Truck, Car, Bike, Footprints,
    // Fun / rewards
    Gift, PartyPopper, Gamepad2, Dices, Coffee, Pizza, Utensils, Bookmark, Link2, Archive, FolderOpen, FileText, Layers, CircleDot, Hexagon, Bone, Egg,
    type LucideIcon,
} from 'lucide-react';

// ── Exact-key registry ────────────────────────────────────────────────────────
// Keys the prompt vocabulary teaches the model. Lowercase, no "icon-" prefix.
const ICON_REGISTRY: Record<string, LucideIcon> = {
    // OS / platforms
    windows: Monitor, macos: Apple, apple: Apple, linux: Terminal, ubuntu: Terminal, unix: Terminal,
    terminal: TerminalSquare, shell: TerminalSquare, cli: TerminalSquare, console: TerminalSquare, commandline: TerminalSquare, repl: TerminalSquare,
    desktop: Monitor, laptop: Laptop, mobile: Smartphone, phone: Phone, keyboard: Keyboard, mouse: MousePointer,
    cpu: Cpu, processor: Cpu, memory: Cpu, disk: HardDrive, storage: HardDrive, server: Server,
    cloud: Cloud, web: Globe, internet: Globe, network: Network, wifi: Wifi, signal: Signal,
    // Code / dev
    code: Code2, coding: Code2, snippet: Code2, syntax: Braces, braces: Braces, json: FileJson,
    binary: Binary, git: GitBranch, branch: GitBranch, version: GitBranch, bug: Bug, debug: Bug, error: Bug,
    tool: Wrench, tools: Wrench, fix: Wrench, config: Settings, settings: Settings, setup: Cog, gear: Cog,
    package: Package, module: Box, library: Boxes, block: Blocks, component: Component,
    database: Database, sql: Database, data: Database, variable: Variable, underscore: Variable,
    function: FunctionSquare, method: FunctionSquare, hash: Hash, string: Type, text: Type, type: Type, regex: Regex,
    // Actions / flow
    play: Play, run: PlayCircle, execute: PlayCircle, start: Play, launch: Rocket, rocket: Rocket, deploy: Rocket,
    power: Power, plug: Plug, install: Download, download: Download, upload: Upload, save: Save,
    loop: RefreshCw, repeat: Repeat, iterate: RefreshCw, refresh: RefreshCw, cycle: RefreshCw,
    exit: LogOut, quit: LogOut, logout: LogOut, login: LogIn, enter: LogIn,
    search: Search, find: Search, filter: Filter, sort: Shuffle, shuffle: Shuffle,
    share: Share2, send: Send, next: ArrowRight, arrow: ArrowRight, step: ChevronRight, indent: CornerDownRight,
    undo: Undo2, redo: Redo2, split: Split, flow: Workflow, workflow: Workflow, pipeline: Workflow,
    milestone: Milestone, flag: Flag, goal: Target, target: Target, checkpoint: Milestone,
    // Learning / thinking
    idea: Lightbulb, tip: Lightbulb, insight: Lightbulb, hint: Lightbulb, bulb: Lightbulb,
    brain: Brain, think: Brain, logic: Brain, mind: Brain, memory2: Brain,
    learn: GraduationCap, study: GraduationCap, course: GraduationCap, education: GraduationCap,
    book: BookOpen, read: BookOpen, docs: BookOpen, documentation: BookOpen, notes: Notebook, notebook: Notebook,
    write: PenTool, pen: PenTool, edit: Pencil, pencil: Pencil,
    checklist: ListChecks, tasks: ClipboardList, clipboard: ClipboardList, list: List, quote: Quote,
    language: Languages, question: HelpCircle, help: HelpCircle, faq: HelpCircle,
    puzzle: Puzzle, problem: Puzzle, focus: Focus, eye: Eye, view: Eye, watch: Eye, review: Glasses,
    // Data / math / science
    chart: BarChart3, bar: BarChart3, graph: LineChart, line: LineChart, pie: PieChart, stats: BarChart3,
    trend: TrendingUp, growth: TrendingUp, increase: TrendingUp, decrease: TrendingDown, decline: TrendingDown,
    math: Calculator, calculate: Calculator, calculator: Calculator, sum: Sigma, sigma: Sigma,
    infinity: InfinityIcon, percent: Percent, scale: Scale, balance: Scale, compare: Scale,
    gauge: Gauge, speed: Gauge, meter: Gauge, performance: Activity, activity: Activity, pulse: Activity,
    table: Table2, grid: Grid3x3, matrix: Grid3x3, columns: Columns,
    science: FlaskConical, experiment: FlaskConical, lab: FlaskConical, test: FlaskConical,
    microscope: Microscope, atom: Atom, physics: Atom, orbit: Orbit, dna: Dna, biology: Dna,
    // Status / feedback
    check: Check, done: CheckCircle2, success: CheckCircle2, correct: CheckCircle2, verify: BadgeCheck, verified: BadgeCheck, verification: BadgeCheck, validate: BadgeCheck,
    wrong: XCircle, fail: XCircle, cancel: XCircle, warning: AlertTriangle, caution: AlertTriangle, alert: AlertCircle,
    info: Info, note: Info, minus: MinusCircle, plus: PlusCircle, add: PlusCircle,
    star: Star, favorite: Star, award: Award, badge: Award, trophy: Trophy, win: Trophy, winner: Trophy,
    crown: Crown, best: Crown, gem: Gem, diamond: Gem, sparkle: Sparkles, magic: Sparkles, new: Sparkles,
    fast: Zap, zap: Zap, lightning: Zap, energy: Zap, fire: Flame, hot: Flame, popular: Flame, bell: Bell, notify: Bell,
    // Objects / concepts
    key: Key, password: Key, secret: Key, lock: Lock, secure: Lock, security: Shield, shield: Shield, protect: Shield,
    time: Clock, clock: Clock, timer: Timer, duration: Timer, alarm: AlarmClock, hourglass: Hourglass, wait: Hourglass,
    history: History, past: History, calendar: Calendar, date: Calendar, schedule: CalendarClock,
    map: Map, location: MapPin, pin: MapPin, compass: Compass, direction: Navigation, navigate: Navigation,
    home: Home, house: Home, building: Building2, company: Building2, office: Briefcase, work: Briefcase, business: Briefcase,
    cart: ShoppingCart, shop: ShoppingCart, payment: CreditCard, card: CreditCard,
    money: DollarSign, dollar: DollarSign, price: DollarSign, cost: Coins, coins: Coins, savings: PiggyBank, bank: Banknote,
    // People / communication
    user: User, person: User, profile: User, users: Users, team: Users, group: Users, community: Users,
    chat: MessageSquare, message: MessageSquare, comment: MessageSquare, discuss: MessageSquare,
    mail: Mail, email: Mail, call: Phone, mic: Mic, voice: Mic, audio: Headphones, sound: Volume2, volume: Volume2,
    camera: Camera, photo: Camera, film: Film, movie: Film, video: Video, image: ImageIcon, picture: ImageIcon,
    design: Palette, color: Palette, art: Palette, palette: Palette,
    // Nature / misc
    sun: Sun, day: Sun, moon: MoonStar, night: MoonStar, stars: Stars, sunrise: Sunrise,
    rain: CloudRain, storm: CloudLightning, rainbow: Rainbow, snow: Snowflake, wind: Wind,
    water: Droplets, drop: Droplets, wave: Waves, ocean: Waves, mountain: Mountain, peak: Mountain,
    tree: Trees, forest: Trees, leaf: Leaf, nature: Leaf, plant: Sprout, grow: Sprout, seed: Sprout,
    recycle: Recycle, reuse: Recycle, anchor: Anchor, ship: Ship, plane: Plane, travel: Plane,
    truck: Truck, delivery: Truck, car: Car, bike: Bike, walk: Footprints, path: Footprints,
    // Fun / rewards
    gift: Gift, reward: Gift, party: PartyPopper, celebrate: PartyPopper, game: Gamepad2, gaming: Gamepad2,
    dice: Dices, random: Dices, coffee: Coffee, break: Coffee, food: Utensils, pizza: Pizza,
    bookmark: Bookmark, link: Link2, url: Link2, archive: Archive, folder: FolderOpen, file: FileText, document: FileText,
    layers: Layers, stack: Layers, dot: CircleDot, point: CircleDot, hexagon: Hexagon, shape: Hexagon,
    bone: Bone, egg: Egg,
};

// ── Emoji → icon bridge (legacy notes emit emoji hints like "📊") ─────────────
const EMOJI_MAP: Record<string, LucideIcon> = {
    '💼': Briefcase, '💻': Laptop, '🎯': Target, '🚀': Rocket, '🧠': Brain, '📊': BarChart3,
    '📈': TrendingUp, '📉': TrendingDown, '💡': Lightbulb, '🔑': Key, '🔒': Lock, '🛡️': Shield,
    '⚡': Zap, '🔥': Flame, '⭐': Star, '🏆': Trophy, '👑': Crown, '💎': Gem, '✨': Sparkles,
    '✅': CheckCircle2, '❌': XCircle, '⚠️': AlertTriangle, 'ℹ️': Info, '❓': HelpCircle,
    '📚': BookOpen, '📖': BookOpen, '📝': Pencil, '✏️': Pencil, '📋': ClipboardList, '🔍': Search,
    '⏰': AlarmClock, '⏱️': Timer, '🕐': Clock, '📅': Calendar, '🗓️': Calendar,
    '🌍': Globe, '🌐': Globe, '☁️': Cloud, '🖥️': Monitor, '📱': Smartphone, '⌨️': Keyboard,
    '🖱️': MousePointer, '💾': Save, '📁': FolderOpen, '📄': FileText, '🗄️': Database,
    '🔧': Wrench, '⚙️': Settings, '🔨': Wrench, '🧩': Puzzle, '🎨': Palette, '🎮': Gamepad2,
    '🎲': Dices, '🎁': Gift, '🎉': PartyPopper, '☕': Coffee, '🍕': Pizza,
    '👤': User, '👥': Users, '💬': MessageSquare, '📧': Mail, '📞': Phone, '🎤': Mic,
    '🎧': Headphones, '🔊': Volume2, '📷': Camera, '🎬': Film, '🎥': Video, '🖼️': ImageIcon,
    '☀️': Sun, '🌙': MoonStar, '🌟': Stars, '🌈': Rainbow, '❄️': Snowflake, '💧': Droplets,
    '🌊': Waves, '⛰️': Mountain, '🌳': Trees, '🍃': Leaf, '🌱': Sprout, '♻️': Recycle,
    '⚓': Anchor, '🚢': Ship, '✈️': Plane, '🚚': Truck, '🚗': Car, '🚲': Bike, '👣': Footprints,
    '💰': DollarSign, '💵': Banknote, '🪙': Coins, '🏦': Building2, '🏠': Home, '🏢': Building2,
    '🛒': ShoppingCart, '💳': CreditCard, '🧪': FlaskConical, '🔬': Microscope, '⚛️': Atom,
    '🧬': Dna, '🔢': Calculator, '➗': Calculator, '♾️': InfinityIcon, '⚖️': Scale,
    '🔗': Link2, '📌': MapPin, '🗺️': Map, '🧭': Compass, '🏁': Flag, '🚩': Flag,
    '🔹': CircleDot, '🔸': CircleDot, '▪️': CircleDot, '•': CircleDot,
};

// ── Semantic fallback chain ───────────────────────────────────────────────────
// When nothing matches, rotate through these instead of always the same glyph,
// so a run of unmatched items still looks intentional.
const FALLBACK_CYCLE: LucideIcon[] = [Lightbulb, Target, Layers, Compass, Zap, BookOpen, Puzzle, Star];

/**
 * Resolve any icon hint to a Lucide component. Never returns null — an
 * unmatched hint falls back to a deterministic rotation keyed on the hint text
 * (same hint → same fallback, so re-renders are stable).
 */
export function resolveNoteIcon(hint: unknown, ordinal = 0): LucideIcon {
    if (typeof hint === 'string' && hint.trim()) {
        const raw = hint.trim();
        // 1. Emoji bridge
        if (EMOJI_MAP[raw]) return EMOJI_MAP[raw];
        // Strip variation selectors and try again (⚙︎ vs ⚙️)
        const bare = raw.replace(/[︀-️]/g, '');
        if (EMOJI_MAP[bare]) return EMOJI_MAP[bare];
        // 2. Normalize: "icon-windows" → "windows", "Icon_Play" → "play"
        const norm = raw.toLowerCase().replace(/^icon[-_\s]*/i, '').replace(/[-_\s]+/g, '');
        if (ICON_REGISTRY[norm]) return ICON_REGISTRY[norm];
        // 3. Keyword scan: any registry key contained in the hint (longest first
        //    so "checklist" beats "check", "database" beats "data").
        const keys = Object.keys(ICON_REGISTRY).sort((a, b) => b.length - a.length);
        for (const k of keys) {
            if (k.length >= 3 && norm.includes(k)) return ICON_REGISTRY[k];
        }
        // 4. Deterministic fallback keyed on the hint so it's stable per item.
        let h = 0;
        for (let i = 0; i < norm.length; i++) h = (h * 31 + norm.charCodeAt(i)) | 0;
        return FALLBACK_CYCLE[Math.abs(h) % FALLBACK_CYCLE.length];
    }
    return FALLBACK_CYCLE[ordinal % FALLBACK_CYCLE.length];
}

/**
 * Drop-in visual: a resolved outlined icon inside the note's accent-colored
 * badge. Replaces every place the renderer used to print the raw hint text.
 */
export function NoteIcon({ hint, ordinal = 0, size = 13, color = '#fff', strokeWidth = 2.2 }: {
    hint: unknown; ordinal?: number; size?: number; color?: string; strokeWidth?: number;
}) {
    const Icon = resolveNoteIcon(hint, ordinal);
    return <Icon size={size} color={color} strokeWidth={strokeWidth} aria-hidden />;
}
