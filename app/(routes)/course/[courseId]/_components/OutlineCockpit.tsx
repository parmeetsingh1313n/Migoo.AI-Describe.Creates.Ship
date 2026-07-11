"use client";

/**
 * OutlineCockpit — an editorial "storyboard studio" for a chapter's outline points
 * (the `subContent` bullets that each become one generated slide).
 *
 * Design concept: asymmetric two-column layout. A left "poster" column carries the
 * chapter title in the brand's Instrument Serif display face plus a live film-strip
 * meter (which points become slides); a right "reel" column threads the points along
 * a vertical storyboard spine. Uses the app's semantic theme tokens so it matches the
 * surrounding light/dark theme. Not boxy, not a wizard, not a card grid.
 *
 * Per point: hover reveals ✎ edit and – remove. Editing opens an inline textarea with
 * a ✨ Enhance button (LLM polish → text morphs in place → ↩ undo). A ghost "+ Add"
 * row appends new points.
 */

import { AnimatePresence, motion } from "framer-motion";
import {
    ArrowRight, Check, Film, Loader2, Minus, Pencil, Plus, Sparkles, Undo2, X,
} from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import axios from "axios";

/* ── Brand gradient (matches --migoo-grad) ──────────────────────────────── */
const BRAND_GRAD = "linear-gradient(135deg, #3EA5D6 0%, #3363AD 50%, #6D5BD3 100%)";
const SERIF = "var(--font-instrument), Georgia, 'Times New Roman', serif";
const MAX_SLIDES = 15;
const MAX_POINTS = 15;
const MAX_LEN = 200;

interface Props {
    open: boolean;
    onClose: () => void;
    courseId: string;
    chapterId: string;
    chapterTitle: string;
    chapterIndex: number;
    initialPoints: string[];
    onSaved: (points: string[]) => void;
    onSaveAndGenerate: (points: string[]) => void;
}

interface Row { id: string; text: string; }
let _rid = 0;
const makeRow = (text: string): Row => ({ id: `row-${_rid++}`, text });

/* ── Morphing cloud node ─────────────────────────────────────────────────
 * Several cloud silhouettes that share an identical path structure
 * (M + 6 cubic segments + Z) so framer-motion can interpolate `d` smoothly
 * from one design to the next. Each node cycles through the set on a loop,
 * offset per-index so neighbouring nodes never morph in lock-step.
 */
const CLOUD_SHAPES = [
    // classic puffy — solid, filled through the centre
    "M6,20 C1,20 1,14 6,14 C4,8 12,5 15,10 C17,3 27,3 28,10 C34,6 40,13 34,15 C39,16 37,20 31,20 C22,20 14,20 6,20 Z",
    // wide & low bumps
    "M7,20 C2,20 1,15 6,15 C5,10 11,8 14,12 C15,6 27,5 27,12 C32,9 38,14 34,16 C38,17 37,20 32,20 C23,20 15,20 7,20 Z",
    // tall central peak
    "M6,20 C2,20 2,13 7,13 C4,7 13,4 15,9 C18,2 26,2 27,9 C33,5 38,12 33,14 C38,17 36,20 30,20 C22,20 14,20 6,20 Z",
    // rolling twin hump
    "M8,20 C3,20 2,15 6,14 C3,10 10,7 13,11 C14,5 26,5 27,11 C31,8 39,12 34,15 C38,16 37,20 32,20 C23,20 15,20 8,20 Z",
];

function MorphingCloud({ index, active }: { index: number; active: boolean }) {
    const rawId = useId();
    const gradId = `cloud-${rawId.replace(/:/g, "")}`;

    // Rotate the shape order per node, then loop back to the first for a seamless cycle.
    const seq = useMemo(() => {
        const rot = index % CLOUD_SHAPES.length;
        const arr = [...CLOUD_SHAPES.slice(rot), ...CLOUD_SHAPES.slice(0, rot)];
        return [...arr, arr[0]];
    }, [index]);

    return (
        <svg viewBox="0 0 40 26" className="h-full w-full overflow-visible" aria-hidden>
            <defs>
                <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="#3EA5D6" />
                    <stop offset="50%" stopColor="#3363AD" />
                    <stop offset="100%" stopColor="#6D5BD3" />
                </linearGradient>
            </defs>
            <motion.path
                initial={false}
                animate={{ d: seq }}
                transition={{
                    duration: 9,
                    ease: "easeInOut",
                    repeat: Infinity,
                    delay: index * 0.6,
                }}
                fill={active ? `url(#${gradId})` : "var(--muted)"}
                stroke={active ? "none" : "var(--border)"}
                strokeWidth={active ? 0 : 1}
            />
        </svg>
    );
}

/** A node on the storyboard spine: a morphing cloud with the slide number on top. */
function CloudNode({ index, active }: { index: number; active: boolean }) {
    return (
        <motion.div
            whileHover={{ scale: 1.12, rotate: -2 }}
            transition={{ type: "spring", stiffness: 300, damping: 18 }}
            className="relative flex h-9 w-11 items-center justify-center drop-shadow-sm"
        >
            <MorphingCloud index={index} active={active} />
            <span
                className={`absolute inset-0 flex items-center justify-center text-[12px] font-extrabold ${
                    active ? "text-white" : "text-muted-foreground"
                }`}
                style={active ? { textShadow: "0 1px 3px rgba(0,0,0,0.35)" } : undefined}
            >
                {index + 1}
            </span>
        </motion.div>
    );
}

export default function OutlineCockpit({
    open, onClose, courseId, chapterId, chapterTitle, chapterIndex,
    initialPoints, onSaved, onSaveAndGenerate,
}: Props) {
    const [rows, setRows] = useState<Row[]>([]);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [draft, setDraft] = useState("");
    const [preEnhance, setPreEnhance] = useState<Record<string, string>>({});
    const [enhancingId, setEnhancingId] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [mounted, setMounted] = useState(false);

    const draftRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        if (open) {
            setRows((initialPoints.length ? initialPoints : [""]).map(makeRow));
            setEditingId(null);
            setDraft("");
            setPreEnhance({});
        }
    }, [open, initialPoints]);

    useEffect(() => setMounted(true), []);

    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape" && !editingId) onClose();
        };
        window.addEventListener("keydown", onKey);
        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        return () => {
            window.removeEventListener("keydown", onKey);
            document.body.style.overflow = prevOverflow;
        };
    }, [open, editingId, onClose]);

    useEffect(() => {
        if (editingId) {
            const t = setTimeout(() => {
                draftRef.current?.focus();
                draftRef.current?.setSelectionRange(draft.length, draft.length);
            }, 60);
            return () => clearTimeout(t);
        }
    }, [editingId]); // eslint-disable-line react-hooks/exhaustive-deps

    const cleanPoints = useMemo(
        () => rows.map((r) => r.text.trim()).filter(Boolean),
        [rows]
    );
    const slideCount = Math.min(cleanPoints.length, MAX_SLIDES);

    /* ── Row ops ─────────────────────────────────────────────────────────── */
    const startEdit = (row: Row) => { setEditingId(row.id); setDraft(row.text); };

    const commitEdit = () => {
        if (!editingId) return;
        const value = draft.trim();
        setRows((prev) => prev.map((r) => (r.id === editingId ? { ...r, text: value } : r)));
        setEditingId(null); setDraft("");
    };

    const cancelEdit = () => {
        setRows((prev) => prev.filter((r) => !(r.id === editingId && !r.text.trim())));
        setEditingId(null); setDraft("");
    };

    const removeRow = (id: string) => {
        setRows((prev) => prev.filter((r) => r.id !== id));
        if (editingId === id) { setEditingId(null); setDraft(""); }
    };

    const addRow = () => {
        if (rows.length >= MAX_POINTS) {
            toast.info(`A chapter can have at most ${MAX_POINTS} points.`);
            return;
        }
        const row = makeRow("");
        setRows((prev) => [...prev, row]);
        setEditingId(row.id); setDraft("");
    };

    /* ── ✨ Enhance ──────────────────────────────────────────────────────── */
    const enhance = async () => {
        const text = draft.trim();
        if (!text || !editingId) { toast.info("Write a point first, then enhance it."); return; }
        setEnhancingId(editingId);
        const idBeingEnhanced = editingId;
        try {
            const contextPoints = rows
                .filter((r) => r.id !== idBeingEnhanced && r.text.trim())
                .map((r) => r.text.trim());
            const res = await axios.post("/api/enhance-point", { text, chapterTitle, contextPoints });
            const polished: string = res.data?.text?.trim();
            if (!polished) throw new Error("Empty response");
            setPreEnhance((p) => ({ ...p, [idBeingEnhanced]: text }));
            setDraft(polished);
        } catch (err: any) {
            toast.error(err?.response?.data?.error || "Enhance unavailable right now");
        } finally {
            setEnhancingId(null);
        }
    };

    const undoEnhance = () => {
        if (!editingId) return;
        const prev = preEnhance[editingId];
        if (prev === undefined) return;
        setDraft(prev);
        setPreEnhance((p) => { const n = { ...p }; delete n[editingId]; return n; });
    };

    /* ── Persist ─────────────────────────────────────────────────────────── */
    const persist = async (): Promise<string[] | null> => {
        const points = cleanPoints;
        if (points.length === 0) { toast.error("Add at least one point before saving."); return null; }
        setSaving(true);
        try {
            await axios.patch("/api/course-layout", { courseId, chapterId, subContent: points });
            return points;
        } catch (err: any) {
            toast.error(err?.response?.data?.error || "Failed to save outline");
            return null;
        } finally {
            setSaving(false);
        }
    };

    const handleSave = async () => {
        const points = await persist();
        if (points) { toast.success("Outline saved"); onSaved(points); onClose(); }
    };

    const handleSaveAndGenerate = async () => {
        const points = await persist();
        if (points) { onSaved(points); onSaveAndGenerate(points); onClose(); }
    };

    if (!mounted) return null;

    /* ── Film-strip meter cells — one per point (every point is a slide) ──── */
    const filmCells = Array.from({ length: Math.max(slideCount, 1) }, () => true);

    return createPortal(
        <AnimatePresence>
            {open && (
                <motion.div
                    className="fixed inset-0 z-[9998] flex items-center justify-center bg-foreground/30 p-3 backdrop-blur-md sm:p-6"
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    transition={{ duration: 0.25 }}
                    onClick={() => !editingId && onClose()}
                >
                    <motion.div
                        className="relative flex h-[88vh] w-full max-w-6xl flex-col overflow-hidden rounded-[28px] border border-border bg-background shadow-2xl lg:flex-row"
                        initial={{ y: 26, scale: 0.985, opacity: 0 }}
                        animate={{ y: 0, scale: 1, opacity: 1 }}
                        exit={{ y: 26, scale: 0.985, opacity: 0 }}
                        transition={{ type: "spring", stiffness: 240, damping: 26 }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Close — floats over everything */}
                        <button
                            onClick={() => !editingId && onClose()}
                            className="absolute right-4 top-4 z-30 cursor-pointer rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                            aria-label="Close"
                        >
                            <X className="h-5 w-5" />
                        </button>

                        {/* ══ LEFT · POSTER ═══════════════════════════════════ */}
                        <aside className="relative flex shrink-0 flex-col justify-between overflow-hidden border-b border-border p-7 lg:w-[380px] lg:border-b-0 lg:border-r lg:p-8">
                            {/* Ambient wash */}
                            <div className="pointer-events-none absolute inset-0 opacity-[0.05]" style={{ background: BRAND_GRAD }} />
                            <div className="pointer-events-none absolute -left-16 -top-16 h-56 w-56 rounded-full opacity-20 blur-[80px]" style={{ background: BRAND_GRAD }} />

                            <div className="relative">
                                <motion.div
                                    initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: 0.05 }}
                                    className="mb-5 inline-flex items-center gap-2 rounded-full border border-border bg-background/60 px-3 py-1 backdrop-blur"
                                >
                                    <span className="flex h-4 w-4 items-center justify-center">
                                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: "#6D5BD3" }} />
                                    </span>
                                    <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                                        Storyboard · Chapter {chapterIndex + 1}
                                    </span>
                                </motion.div>

                                <motion.h2
                                    initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: 0.1 }}
                                    className="text-[30px] font-normal italic leading-[1.08] tracking-tight text-foreground sm:text-[34px]"
                                    style={{ fontFamily: SERIF }}
                                >
                                    {chapterTitle}
                                </motion.h2>

                                <motion.p
                                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.18 }}
                                    className="mt-4 max-w-[42ch] text-[13.5px] leading-relaxed text-muted-foreground"
                                >
                                    Every point becomes one slide in your video. Add, remove, reorder your
                                    thinking, and let{" "}
                                    <span className="inline-flex items-center gap-1 font-medium text-foreground">
                                        <Sparkles className="h-3.5 w-3.5" style={{ color: "#6D5BD3" }} /> Enhance
                                    </span>{" "}
                                    refine any line.
                                </motion.p>

                                {/* Film-strip meter */}
                                <motion.div
                                    initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.24 }}
                                    className="mt-7"
                                >
                                    <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                                        <Film className="h-3.5 w-3.5" /> Slide reel
                                    </div>
                                    <div className="flex flex-wrap items-center gap-1.5">
                                        {filmCells.map((_, i) => (
                                            <motion.div
                                                key={i}
                                                initial={{ opacity: 0, scale: 0.8 }}
                                                animate={{ opacity: 1, scale: 1 }}
                                                transition={{ delay: Math.min(i * 0.03, 0.3) }}
                                                className="relative flex h-7 w-7 items-center justify-center overflow-hidden rounded-[5px]"
                                                style={{ background: BRAND_GRAD }}
                                            >
                                                {/* sprocket holes */}
                                                <span className="absolute left-0.5 top-0.5 h-1 w-1 rounded-[1px] bg-background/40" />
                                                <span className="absolute right-0.5 top-0.5 h-1 w-1 rounded-[1px] bg-background/40" />
                                                <span className="absolute bottom-0.5 left-0.5 h-1 w-1 rounded-[1px] bg-background/40" />
                                                <span className="absolute bottom-0.5 right-0.5 h-1 w-1 rounded-[1px] bg-background/40" />
                                                <span className="text-[11px] font-bold text-white">{i + 1}</span>
                                            </motion.div>
                                        ))}
                                    </div>
                                    <p className="mt-2.5 text-[12px] text-muted-foreground">
                                        Every point becomes a slide ·{" "}
                                        <span className="font-semibold text-foreground">
                                            {slideCount} slide{slideCount === 1 ? "" : "s"}
                                        </span>{" "}
                                        in this chapter
                                        {cleanPoints.length >= MAX_POINTS && (
                                            <span className="text-amber-500"> · {MAX_POINTS} is the max</span>
                                        )}
                                    </p>
                                </motion.div>
                            </div>

                            {/* Actions */}
                            <div className="relative mt-7 flex flex-col gap-2.5">
                                <button
                                    onClick={handleSaveAndGenerate}
                                    disabled={saving}
                                    className="group relative flex h-12 w-full cursor-pointer items-center justify-center gap-2 overflow-hidden rounded-2xl text-[14px] font-bold text-white shadow-lg transition-transform active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
                                    style={{ background: BRAND_GRAD }}
                                >
                                    <span className="pointer-events-none absolute inset-0 translate-x-[-120%] bg-white/20 transition-transform duration-700 group-hover:translate-x-[120%] group-disabled:hidden" style={{ maskImage: "linear-gradient(90deg,transparent,black,transparent)" }} />
                                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                                    Save &amp; Generate
                                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                                </button>
                                <button
                                    onClick={handleSave}
                                    disabled={saving}
                                    className="flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-2xl border border-border bg-background/50 text-[13px] font-semibold text-foreground backdrop-blur transition-colors hover:bg-muted disabled:opacity-50"
                                >
                                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                                    Save for later
                                </button>
                            </div>
                        </aside>

                        {/* ══ RIGHT · REEL ════════════════════════════════════ */}
                        <section className="flex min-h-0 flex-1 flex-col">
                            {/* pr-16 keeps the count badge clear of the floating close button */}
                            <div className="flex items-center justify-between px-7 pb-3 pt-6 pr-16 lg:pt-7">
                                <h3 className="text-[12px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                                    Outline points
                                </h3>
                                <span className="rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-bold tabular-nums text-muted-foreground">
                                    {cleanPoints.length}
                                </span>
                            </div>

                            <div className="relative min-h-0 flex-1 overflow-y-auto px-7 pb-7">
                                {/* Storyboard spine */}
                                <div className="pointer-events-none absolute bottom-16 left-[43px] top-1 w-px bg-gradient-to-b from-transparent via-border to-transparent" />

                                <div className="relative space-y-2">
                                    <AnimatePresence initial={false}>
                                        {rows.map((row, idx) => {
                                            const isEditing = editingId === row.id;
                                            const isEnhancing = enhancingId === row.id;
                                            const canUndo = isEditing && preEnhance[row.id] !== undefined;
                                            const isSlide = idx < MAX_SLIDES;
                                            return (
                                                <motion.div
                                                    key={row.id}
                                                    layout
                                                    initial={{ opacity: 0, y: 8 }}
                                                    animate={{ opacity: 1, y: 0 }}
                                                    exit={{ opacity: 0, height: 0, marginTop: 0, transition: { duration: 0.18 } }}
                                                    transition={{ type: "spring", stiffness: 320, damping: 30 }}
                                                    className="group relative flex gap-3"
                                                >
                                                    {/* Spine node — morphing cloud */}
                                                    <div className="relative z-10 flex w-8 shrink-0 justify-center pt-3">
                                                        <CloudNode index={idx} active={isSlide} />
                                                    </div>

                                                    {/* Card */}
                                                    <div
                                                        className={`flex-1 rounded-2xl border transition-all ${
                                                            isEditing
                                                                ? "border-primary/50 bg-primary/[0.03] shadow-sm ring-1 ring-primary/30"
                                                                : "border-border bg-card hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md"
                                                        }`}
                                                    >
                                                        {isEditing ? (
                                                            <div className="p-3.5">
                                                                <div className="relative">
                                                                    <textarea
                                                                        ref={draftRef}
                                                                        value={draft}
                                                                        maxLength={MAX_LEN}
                                                                        onChange={(e) => setDraft(e.target.value)}
                                                                        onKeyDown={(e) => {
                                                                            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commitEdit(); }
                                                                        }}
                                                                        rows={2}
                                                                        placeholder="Describe what this slide should teach…"
                                                                        className="w-full resize-none rounded-xl bg-background px-3 py-2.5 text-[14px] leading-relaxed text-foreground outline-none ring-1 ring-border placeholder:text-muted-foreground/60 focus:ring-primary/50"
                                                                    />
                                                                    <AnimatePresence>
                                                                        {isEnhancing && (
                                                                            <motion.div
                                                                                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                                                                                className="pointer-events-none absolute inset-0 overflow-hidden rounded-xl"
                                                                            >
                                                                                <motion.div
                                                                                    className="absolute inset-y-0 w-1/3"
                                                                                    style={{ background: "linear-gradient(90deg, transparent, rgba(109,91,211,0.20), transparent)" }}
                                                                                    animate={{ x: ["-120%", "320%"] }}
                                                                                    transition={{ duration: 1.1, repeat: Infinity, ease: "linear" }}
                                                                                />
                                                                            </motion.div>
                                                                        )}
                                                                    </AnimatePresence>
                                                                </div>

                                                                <div className="mt-2 flex items-center justify-between gap-2">
                                                                    <div className="flex items-center gap-1.5">
                                                                        <button
                                                                            onClick={enhance}
                                                                            disabled={isEnhancing || !draft.trim()}
                                                                            className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-primary/10 px-2.5 py-1.5 text-[12px] font-semibold text-primary transition-all hover:bg-primary/20 disabled:opacity-40"
                                                                        >
                                                                            {isEnhancing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                                                                            Enhance
                                                                        </button>
                                                                        <AnimatePresence>
                                                                            {canUndo && (
                                                                                <motion.button
                                                                                    initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}
                                                                                    onClick={undoEnhance}
                                                                                    className="flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                                                                                >
                                                                                    <Undo2 className="h-3.5 w-3.5" /> Undo
                                                                                </motion.button>
                                                                            )}
                                                                        </AnimatePresence>
                                                                        <span className="ml-1 text-[11px] tabular-nums text-muted-foreground/70">
                                                                            {draft.length}/{MAX_LEN}
                                                                        </span>
                                                                    </div>
                                                                    <div className="flex items-center gap-1.5">
                                                                        <button
                                                                            onClick={cancelEdit}
                                                                            className="cursor-pointer rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                                                                        >
                                                                            Cancel
                                                                        </button>
                                                                        <button
                                                                            onClick={commitEdit}
                                                                            disabled={!draft.trim()}
                                                                            className="flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-bold text-white transition-all disabled:opacity-40"
                                                                            style={{ background: BRAND_GRAD }}
                                                                        >
                                                                            <Check className="h-3.5 w-3.5" /> Done
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        ) : (
                                                            <div className="flex items-start gap-2 p-3.5">
                                                                <p className="flex-1 pt-0.5 text-[14px] leading-relaxed text-foreground/90">
                                                                    {row.text.trim() || (
                                                                        <span className="italic text-muted-foreground/60">Empty point — click edit to write it</span>
                                                                    )}
                                                                </p>
                                                                <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                                                                    <button
                                                                        onClick={() => startEdit(row)}
                                                                        className="cursor-pointer rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-primary"
                                                                        title="Edit point"
                                                                    >
                                                                        <Pencil className="h-4 w-4" />
                                                                    </button>
                                                                    <button
                                                                        onClick={() => removeRow(row.id)}
                                                                        className="cursor-pointer rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                                                                        title="Remove point"
                                                                    >
                                                                        <Minus className="h-4 w-4" />
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                </motion.div>
                                            );
                                        })}
                                    </AnimatePresence>

                                    {/* Add point — sits on the spine as the next node */}
                                    <div className="relative flex gap-3">
                                        <div className="relative z-10 flex w-8 shrink-0 justify-center pt-2">
                                            <span className="flex h-7 w-7 items-center justify-center rounded-full border border-dashed border-border bg-background ring-4 ring-background">
                                                <Plus className="h-3.5 w-3.5 text-muted-foreground" />
                                            </span>
                                        </div>
                                        <button
                                            onClick={addRow}
                                            disabled={rows.length >= MAX_POINTS}
                                            className="flex flex-1 cursor-pointer items-center gap-2 rounded-2xl border border-dashed border-border px-3.5 py-3 text-[13px] font-semibold text-muted-foreground transition-all hover:border-primary/40 hover:bg-muted/40 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                                        >
                                            Add another point
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </section>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>,
        document.body
    );
}
