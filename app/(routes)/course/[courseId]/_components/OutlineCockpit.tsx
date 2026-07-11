"use client";

/**
 * OutlineCockpit — a premium, full-screen editor for a chapter's outline points
 * (the `subContent` bullets that each become one generated slide).
 *
 * Design language: dark cinematic surface (#0b0f17), brand gradient accents,
 * framer-motion micro-interactions. NOT a boxy dialog, NOT a wizard.
 *
 * Per point: hover reveals ✎ edit and – remove. Editing opens an inline textarea
 * with a ✨ Enhance button (LLM polish → text morphs in place with a shimmer →
 * ↩ undo reverts). A ghost "+ Add point" row appends new points.
 */

import { AnimatePresence, motion } from "framer-motion";
import {
    Check, Loader2, Minus, Pencil, Plus, Sparkles, Undo2, X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import axios from "axios";
import DrawOutlineButton from "@/components/ui/DrawOutlineButton";

/* ── Brand gradient (matches --migoo-grad) ──────────────────────────────── */
const BRAND_GRAD = "linear-gradient(135deg, #3EA5D6 0%, #3363AD 50%, #6D5BD3 100%)";
const MAX_SLIDES = 7;
const MAX_POINTS = 12;
const MAX_LEN = 200;

interface Props {
    open: boolean;
    onClose: () => void;
    courseId: string;
    chapterId: string;
    chapterTitle: string;
    chapterIndex: number;
    initialPoints: string[];
    /** Called with the saved points after a successful persist. */
    onSaved: (points: string[]) => void;
    /** Called when the user chooses "Save & Generate". */
    onSaveAndGenerate: (points: string[]) => void;
}

/* Local row model — stable id so reordering/animations don't thrash. */
interface Row {
    id: string;
    text: string;
}

let _rid = 0;
const makeRow = (text: string): Row => ({ id: `row-${_rid++}`, text });

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

    // Snapshot points into local rows each time the cockpit opens.
    useEffect(() => {
        if (open) {
            setRows((initialPoints.length ? initialPoints : [""]).map(makeRow));
            setEditingId(null);
            setDraft("");
            setPreEnhance({});
        }
    }, [open, initialPoints]);

    useEffect(() => setMounted(true), []);

    // Esc to close (only when not mid-edit), lock body scroll while open.
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

    // Autofocus the textarea when entering edit mode.
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
    const startEdit = (row: Row) => {
        setEditingId(row.id);
        setDraft(row.text);
    };

    const commitEdit = () => {
        if (!editingId) return;
        const value = draft.trim();
        setRows((prev) =>
            prev.map((r) => (r.id === editingId ? { ...r, text: value } : r))
        );
        setEditingId(null);
        setDraft("");
    };

    const cancelEdit = () => {
        // Drop empty freshly-added rows on cancel.
        setRows((prev) => prev.filter((r) => !(r.id === editingId && !r.text.trim())));
        setEditingId(null);
        setDraft("");
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
        setEditingId(row.id);
        setDraft("");
    };

    /* ── ✨ Enhance the point currently being edited ─────────────────────── */
    const enhance = async () => {
        const text = draft.trim();
        if (!text || !editingId) {
            toast.info("Write a point first, then enhance it.");
            return;
        }
        setEnhancingId(editingId);
        const idBeingEnhanced = editingId;
        try {
            const contextPoints = rows
                .filter((r) => r.id !== idBeingEnhanced && r.text.trim())
                .map((r) => r.text.trim());
            const res = await axios.post("/api/enhance-point", {
                text, chapterTitle, contextPoints,
            });
            const polished: string = res.data?.text?.trim();
            if (!polished) throw new Error("Empty response");
            // Remember the pre-enhance text for one-level undo.
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
        setPreEnhance((p) => {
            const n = { ...p }; delete n[editingId]; return n;
        });
    };

    /* ── Persist ─────────────────────────────────────────────────────────── */
    const persist = async (): Promise<string[] | null> => {
        const points = cleanPoints;
        if (points.length === 0) {
            toast.error("Add at least one point before saving.");
            return null;
        }
        setSaving(true);
        try {
            await axios.patch("/api/course-layout", {
                courseId, chapterId, subContent: points,
            });
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
        if (points) {
            toast.success("Outline saved");
            onSaved(points);
            onClose();
        }
    };

    const handleSaveAndGenerate = async () => {
        const points = await persist();
        if (points) {
            onSaved(points);
            onSaveAndGenerate(points);
            onClose();
        }
    };

    if (!mounted) return null;

    return createPortal(
        <AnimatePresence>
            {open && (
                <motion.div
                    className="fixed inset-0 z-[9998] flex items-stretch justify-center"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.25 }}
                    style={{ background: "rgba(4,6,12,0.72)", backdropFilter: "blur(6px)" }}
                    onClick={() => !editingId && onClose()}
                >
                    {/* ── Cockpit surface ─────────────────────────────────── */}
                    <motion.div
                        className="relative flex w-full max-w-5xl flex-col overflow-hidden"
                        initial={{ y: 24, scale: 0.985, opacity: 0 }}
                        animate={{ y: 0, scale: 1, opacity: 1 }}
                        exit={{ y: 24, scale: 0.985, opacity: 0 }}
                        transition={{ type: "spring", stiffness: 240, damping: 26 }}
                        onClick={(e) => e.stopPropagation()}
                        style={{
                            margin: "clamp(12px, 3vh, 40px) 16px",
                            background: "#0b0f17",
                            border: "1px solid rgba(255,255,255,0.08)",
                            borderRadius: 24,
                            boxShadow: "0 30px 90px rgba(0,0,0,0.75)",
                        }}
                    >
                        {/* Ambient brand glow */}
                        <div
                            className="pointer-events-none absolute -top-24 left-1/2 h-64 w-[60%] -translate-x-1/2 rounded-full opacity-25 blur-[90px]"
                            style={{ background: BRAND_GRAD }}
                        />

                        {/* ── Header ─────────────────────────────────────── */}
                        <div className="relative flex items-start justify-between gap-4 px-7 pt-6 pb-5 border-b border-white/[0.06]">
                            <div className="flex items-start gap-3.5 min-w-0">
                                <span
                                    className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl text-white shadow-lg"
                                    style={{ background: BRAND_GRAD }}
                                >
                                    <Pencil className="h-4 w-4" />
                                </span>
                                <div className="min-w-0">
                                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/40">
                                        Customize outline · Chapter {chapterIndex + 1}
                                    </p>
                                    <h2 className="truncate text-xl font-bold text-white">
                                        {chapterTitle}
                                    </h2>
                                    <p className="mt-1 text-[13px] text-white/45">
                                        Shape the points that become your slides. Add, remove, refine, or ✨ enhance each one.
                                    </p>
                                </div>
                            </div>
                            <button
                                onClick={() => !editingId && onClose()}
                                className="shrink-0 rounded-xl p-2 text-white/50 transition-colors hover:bg-white/[0.06] hover:text-white cursor-pointer"
                                aria-label="Close"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>

                        {/* ── Points list ────────────────────────────────── */}
                        <div className="relative max-h-[58vh] overflow-y-auto px-7 py-5">
                            <div className="space-y-2.5">
                                <AnimatePresence initial={false}>
                                    {rows.map((row, idx) => {
                                        const isEditing = editingId === row.id;
                                        const isEnhancing = enhancingId === row.id;
                                        const canUndo = isEditing && preEnhance[row.id] !== undefined;
                                        return (
                                            <motion.div
                                                key={row.id}
                                                layout
                                                initial={{ opacity: 0, y: 8 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                exit={{ opacity: 0, height: 0, marginTop: 0, transition: { duration: 0.18 } }}
                                                transition={{ type: "spring", stiffness: 320, damping: 30 }}
                                                className={`group relative rounded-2xl border transition-colors ${
                                                    isEditing
                                                        ? "border-transparent bg-white/[0.04]"
                                                        : "border-white/[0.07] bg-white/[0.02] hover:border-white/[0.14] hover:bg-white/[0.04]"
                                                }`}
                                                style={
                                                    isEditing
                                                        ? { boxShadow: "0 0 0 1.5px rgba(109,91,211,0.6)" }
                                                        : undefined
                                                }
                                            >
                                                <div className="flex items-start gap-3 p-3.5">
                                                    {/* Index chip */}
                                                    <span
                                                        className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold text-white/90"
                                                        style={{
                                                            background: idx < MAX_SLIDES ? BRAND_GRAD : "rgba(255,255,255,0.08)",
                                                        }}
                                                    >
                                                        {idx + 1}
                                                    </span>

                                                    {isEditing ? (
                                                        /* ── Inline editor ── */
                                                        <div className="flex-1 min-w-0">
                                                            <div className="relative">
                                                                <textarea
                                                                    ref={draftRef}
                                                                    value={draft}
                                                                    maxLength={MAX_LEN}
                                                                    onChange={(e) => setDraft(e.target.value)}
                                                                    onKeyDown={(e) => {
                                                                        if (e.key === "Enter" && !e.shiftKey) {
                                                                            e.preventDefault();
                                                                            commitEdit();
                                                                        }
                                                                    }}
                                                                    rows={2}
                                                                    placeholder="Describe what this slide should teach…"
                                                                    className="w-full resize-none rounded-xl bg-black/30 px-3 py-2.5 text-[14px] leading-relaxed text-white outline-none ring-1 ring-white/10 placeholder:text-white/30 focus:ring-white/20"
                                                                />
                                                                <AnimatePresence>
                                                                    {isEnhancing && (
                                                                        <motion.div
                                                                            initial={{ opacity: 0 }}
                                                                            animate={{ opacity: 1 }}
                                                                            exit={{ opacity: 0 }}
                                                                            className="pointer-events-none absolute inset-0 overflow-hidden rounded-xl"
                                                                        >
                                                                            <motion.div
                                                                                className="absolute inset-y-0 w-1/3"
                                                                                style={{ background: "linear-gradient(90deg, transparent, rgba(109,91,211,0.25), transparent)" }}
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
                                                                        className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-semibold text-white transition-all disabled:opacity-40 cursor-pointer"
                                                                        style={{ background: "rgba(109,91,211,0.22)" }}
                                                                    >
                                                                        {isEnhancing
                                                                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                                            : <Sparkles className="h-3.5 w-3.5" />}
                                                                        Enhance
                                                                    </button>
                                                                    <AnimatePresence>
                                                                        {canUndo && (
                                                                            <motion.button
                                                                                initial={{ opacity: 0, scale: 0.9 }}
                                                                                animate={{ opacity: 1, scale: 1 }}
                                                                                exit={{ opacity: 0, scale: 0.9 }}
                                                                                onClick={undoEnhance}
                                                                                className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-[12px] font-medium text-white/60 transition-colors hover:bg-white/[0.06] hover:text-white cursor-pointer"
                                                                            >
                                                                                <Undo2 className="h-3.5 w-3.5" /> Undo
                                                                            </motion.button>
                                                                        )}
                                                                    </AnimatePresence>
                                                                    <span className="ml-1 text-[11px] tabular-nums text-white/30">
                                                                        {draft.length}/{MAX_LEN}
                                                                    </span>
                                                                </div>
                                                                <div className="flex items-center gap-1.5">
                                                                    <button
                                                                        onClick={cancelEdit}
                                                                        className="rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-white/55 transition-colors hover:bg-white/[0.06] hover:text-white cursor-pointer"
                                                                    >
                                                                        Cancel
                                                                    </button>
                                                                    <button
                                                                        onClick={commitEdit}
                                                                        disabled={!draft.trim()}
                                                                        className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-bold text-white transition-all disabled:opacity-40 cursor-pointer"
                                                                        style={{ background: BRAND_GRAD }}
                                                                    >
                                                                        <Check className="h-3.5 w-3.5" /> Done
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        /* ── Read row ── */
                                                        <>
                                                            <p className="flex-1 pt-0.5 text-[14px] leading-relaxed text-white/85">
                                                                {row.text.trim() || (
                                                                    <span className="italic text-white/30">Empty point — click to edit</span>
                                                                )}
                                                            </p>
                                                            <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                                                                <button
                                                                    onClick={() => startEdit(row)}
                                                                    className="rounded-lg p-1.5 text-white/50 transition-colors hover:bg-white/[0.08] hover:text-white cursor-pointer"
                                                                    title="Edit point"
                                                                >
                                                                    <Pencil className="h-4 w-4" />
                                                                </button>
                                                                <button
                                                                    onClick={() => removeRow(row.id)}
                                                                    className="rounded-lg p-1.5 text-white/50 transition-colors hover:bg-rose-500/15 hover:text-rose-300 cursor-pointer"
                                                                    title="Remove point"
                                                                >
                                                                    <Minus className="h-4 w-4" />
                                                                </button>
                                                            </div>
                                                        </>
                                                    )}
                                                </div>
                                            </motion.div>
                                        );
                                    })}
                                </AnimatePresence>

                                {/* ── Add point ── */}
                                <button
                                    onClick={addRow}
                                    disabled={rows.length >= MAX_POINTS}
                                    className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-white/15 py-3 text-[13px] font-semibold text-white/50 transition-all hover:border-white/30 hover:bg-white/[0.03] hover:text-white/80 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                                >
                                    <Plus className="h-4 w-4" /> Add point
                                </button>
                            </div>
                        </div>

                        {/* ── Footer ─────────────────────────────────────── */}
                        <div className="relative flex items-center justify-between gap-4 border-t border-white/[0.06] px-7 py-4">
                            <div className="flex items-center gap-2 text-[12.5px] text-white/50">
                                <span
                                    className="flex h-6 items-center rounded-full px-2.5 text-[11px] font-bold text-white"
                                    style={{ background: BRAND_GRAD }}
                                >
                                    {slideCount} {slideCount === 1 ? "slide" : "slides"}
                                </span>
                                <span>
                                    {cleanPoints.length} point{cleanPoints.length === 1 ? "" : "s"}
                                    {cleanPoints.length > MAX_SLIDES && (
                                        <span className="text-amber-300/80"> · only the first {MAX_SLIDES} become slides</span>
                                    )}
                                </span>
                            </div>
                            <div className="flex items-center gap-2.5">
                                <button
                                    onClick={handleSave}
                                    disabled={saving}
                                    className="flex items-center gap-2 rounded-xl border border-white/12 px-4 py-2.5 text-[13px] font-semibold text-white/80 transition-colors hover:bg-white/[0.06] hover:text-white disabled:opacity-50 cursor-pointer"
                                >
                                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                                    Save
                                </button>
                                <DrawOutlineButton
                                    onClick={handleSaveAndGenerate}
                                    disabled={saving}
                                    fullWidth={false}
                                    variant="dark"
                                    accentColor="#6D5BD3"
                                    className="text-[13px] font-bold border border-[#6D5BD3]/40 px-4 py-2.5"
                                >
                                    <Sparkles className="h-4 w-4" /> Save & Generate
                                </DrawOutlineButton>
                            </div>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>,
        document.body
    );
}
