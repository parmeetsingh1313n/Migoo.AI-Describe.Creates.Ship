"use client";

/**
 * StudioReviewCockpit — the gated review studio that opens once a chapter's
 * slides + narration are generated (status `review:slides`) but BEFORE the
 * voiceover is synthesised.
 *
 * Two acts, gated in sequence (not a boxy wizard — a continuous "screening room"):
 *   Act 1 · SLIDES  — screen every slide, request per-slide changes → the LLM
 *                     regenerates that one slide → it re-reflects live.
 *   Act 2 · SCRIPT  — read/edit each slide's narration, ✨ Enhance any of them
 *                     (inline replace + undo). This is the exact text the TTS
 *                     will speak.
 * Finishing Act 2 → "Generate voiceover" approves everything and fires the
 * audio phase. Render (Download MP4) stays a later, separate gate.
 *
 * Matches the app's light/dark theme via semantic tokens, brand gradient, and
 * the Instrument Serif display face — consistent with OutlineCockpit.
 */

import { AnimatePresence, motion } from "framer-motion";
import {
    ArrowLeft, ArrowRight, Film, Loader2, MessageSquarePlus, Mic, Sparkles,
    Undo2, Wand2, X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import axios from "axios";
import { injectRuntime } from "./ChapterVideo";

/* ── Brand gradient (matches --migoo-grad) ──────────────────────────────── */
const BRAND_GRAD = "linear-gradient(135deg, #3EA5D6 0%, #3363AD 50%, #6D5BD3 100%)";
const SERIF = "var(--font-instrument), Georgia, 'Times New Roman', serif";

export interface ReviewSlide {
    slideId: string;
    slideIndex: number;
    html: string | null;
    narration: any;
    revealData?: any;
}

interface Props {
    open: boolean;
    onClose: () => void;
    courseId: string;
    chapterId: string;
    chapterTitle: string;
    chapterIndex: number;
    slides: ReviewSlide[];
    /** Called after the user approves — parent fires the audio phase + polls. */
    onApprove: () => void;
}

type Act = "slides" | "script";

/** Force every fragment/reveal element visible so a static preview isn't blank. */
function buildStaticPreview(html: string): string {
    const runtime = injectRuntime(html || "<section></section>");
    const revealAll = `<script>(function(){
        function show(){
            document.querySelectorAll('[data-fragment-index]').forEach(function(el){
                el.style.opacity='1';el.style.transform='none';el.style.filter='none';el.classList.add('visible');
            });
            document.querySelectorAll('[data-reveal]').forEach(function(el){
                el.style.opacity='1';el.style.transform='none';el.classList.add('active');
            });
        }
        if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',show);}else{show();}
        window.addEventListener('load',show);setTimeout(show,120);setTimeout(show,400);
    })();</script>`;
    // Inject just before </body> so it runs after the slide markup + runtime script.
    if (runtime.includes("</body>")) return runtime.replace("</body>", revealAll + "</body>");
    return runtime + revealAll;
}

/* ── A single slide preview iframe, scaled to fit its frame ──────────────── */
function SlidePreview({ html, className }: { html: string | null; className?: string }) {
    const wrapRef = useRef<HTMLDivElement>(null);
    const [scale, setScale] = useState(0.25);

    useEffect(() => {
        const el = wrapRef.current;
        if (!el) return;
        const ro = new ResizeObserver(() => {
            const w = el.clientWidth, h = el.clientHeight;
            if (w && h) setScale(Math.min(w / 1440, h / 720));
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    const srcDoc = useMemo(() => buildStaticPreview(html || ""), [html]);

    return (
        <div ref={wrapRef} className={`relative overflow-hidden bg-black ${className ?? ""}`}>
            <iframe
                srcDoc={srcDoc}
                sandbox="allow-scripts allow-same-origin"
                title="Slide preview"
                style={{
                    position: "absolute",
                    top: "50%",
                    left: "50%",
                    width: 1440,
                    height: 720,
                    border: "none",
                    transform: `translate(-50%, -50%) scale(${scale})`,
                    transformOrigin: "center center",
                    pointerEvents: "none",
                    background: "#000",
                }}
            />
        </div>
    );
}

export default function StudioReviewCockpit({
    open, onClose, courseId, chapterId, chapterTitle, chapterIndex, slides, onApprove,
}: Props) {
    const [mounted, setMounted] = useState(false);
    const [act, setAct] = useState<Act>("slides");
    const [current, setCurrent] = useState(0);

    // Local working copy of slides (regen + narration edits reflect immediately).
    const [work, setWork] = useState<ReviewSlide[]>([]);

    // Stage 2 — per-slide change request
    const [instruction, setInstruction] = useState("");
    const [regenId, setRegenId] = useState<string | null>(null);

    // Stage 3 — narration editing
    const [draft, setDraft] = useState("");
    const [preEnhance, setPreEnhance] = useState<string | null>(null);
    const [enhancing, setEnhancing] = useState(false);
    const [savingNarration, setSavingNarration] = useState(false);

    const [approving, setApproving] = useState(false);

    useEffect(() => setMounted(true), []);

    useEffect(() => {
        if (open) {
            const sorted = [...slides].sort((a, b) => (a.slideIndex ?? 0) - (b.slideIndex ?? 0));
            setWork(sorted);
            setAct("slides");
            setCurrent(0);
            setInstruction("");
            setPreEnhance(null);
        }
    }, [open, slides]);

    // Keep the narration draft synced to the current slide when it changes.
    const currentSlide = work[current];
    useEffect(() => {
        setDraft((currentSlide?.narration?.fullText ?? "").toString());
        setPreEnhance(null);
    }, [current, act, currentSlide?.slideId]); // eslint-disable-line react-hooks/exhaustive-deps

    // Lock body scroll + Escape to close (guard against closing mid-edit).
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") tryClose(); };
        window.addEventListener("keydown", onKey);
        const prev = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
    }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

    const busy = regenId !== null || enhancing || approving || savingNarration;

    const tryClose = () => {
        if (busy) { toast.info("Hang on — finishing the current step first."); return; }
        onClose();
    };

    /* ── Stage 2 · regenerate one slide from a change request ─────────────── */
    const regenerate = async () => {
        const slide = work[current];
        const text = instruction.trim();
        if (!slide || !text) { toast.info("Describe the change you want for this slide."); return; }
        setRegenId(slide.slideId);
        try {
            const res = await axios.post("/api/regenerate-slide", {
                courseId, chapterId, slideId: slide.slideId, instruction: text,
            });
            const next = res.data?.data?.slide ?? res.data?.slide;
            if (!next) throw new Error("No slide returned");
            setWork((prev) => prev.map((s) => (s.slideId === slide.slideId
                ? { ...s, html: next.html ?? s.html, narration: next.narration ?? s.narration, revealData: next.revealData ?? s.revealData }
                : s)));
            setInstruction("");
            toast.success(`Slide ${slide.slideIndex} updated`);
        } catch (err: any) {
            toast.error(err?.response?.data?.error || "Couldn't regenerate that slide right now");
        } finally {
            setRegenId(null);
        }
    };

    /* ── Stage 3 · enhance narration (inline replace + undo) ──────────────── */
    const enhance = async () => {
        const text = draft.trim();
        if (!text) { toast.info("There's no narration to enhance yet."); return; }
        setEnhancing(true);
        try {
            const res = await axios.post("/api/enhance-narration", {
                text, chapterTitle, slideTopic: `Slide ${currentSlide?.slideIndex}`,
            });
            const polished: string = res.data?.text?.trim();
            if (!polished) throw new Error("Empty response");
            setPreEnhance(text);
            setDraft(polished);
        } catch (err: any) {
            toast.error(err?.response?.data?.error || "Enhance unavailable right now");
        } finally {
            setEnhancing(false);
        }
    };

    const undoEnhance = () => {
        if (preEnhance === null) return;
        setDraft(preEnhance);
        setPreEnhance(null);
    };

    /* ── Stage 3 · persist edited narration for the current slide ─────────── */
    const saveNarration = async (): Promise<boolean> => {
        const slide = work[current];
        if (!slide) return false;
        const text = draft.trim();
        if (!text) { toast.error("Narration can't be empty."); return false; }
        // No change → nothing to persist.
        if (text === (slide.narration?.fullText ?? "").toString().trim()) return true;
        setSavingNarration(true);
        try {
            await axios.patch("/api/slide-content", {
                courseId, chapterId, slideId: slide.slideId, narration: text,
            });
            setWork((prev) => prev.map((s) => (s.slideId === slide.slideId
                ? { ...s, narration: { ...(s.narration ?? {}), fullText: text } }
                : s)));
            setPreEnhance(null);
            return true;
        } catch (err: any) {
            toast.error(err?.response?.data?.error || "Failed to save narration");
            return false;
        } finally {
            setSavingNarration(false);
        }
    };

    /* ── Navigation ──────────────────────────────────────────────────────── */
    const goTo = async (idx: number) => {
        if (idx === current) return;
        // Persist any pending narration edit before leaving the slide.
        if (act === "script") { const ok = await saveNarration(); if (!ok) return; }
        setCurrent(Math.max(0, Math.min(work.length - 1, idx)));
    };

    const goToAct = async (next: Act) => {
        if (next === act) return;
        if (act === "script") { const ok = await saveNarration(); if (!ok) return; }
        setAct(next);
    };

    /* ── Final approval → fire the audio phase ───────────────────────────── */
    const approve = async () => {
        if (act === "script") { const ok = await saveNarration(); if (!ok) return; }
        setApproving(true);
        try {
            onApprove(); // parent fires /api/approve-slides + starts polling
            toast.success("Approved — generating your voiceover now");
            onClose();
        } finally {
            setApproving(false);
        }
    };

    if (!mounted) return null;

    const total = work.length;
    const isRegenThis = regenId === currentSlide?.slideId;

    return createPortal(
        <AnimatePresence>
            {open && (
                <motion.div
                    className="fixed inset-0 z-[9998] flex items-center justify-center bg-foreground/30 p-3 backdrop-blur-md sm:p-6"
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    transition={{ duration: 0.25 }}
                    onClick={tryClose}
                >
                    <motion.div
                        className="relative flex h-[90vh] w-full max-w-[1180px] flex-col overflow-hidden rounded-[28px] border border-border bg-background shadow-2xl"
                        initial={{ y: 26, scale: 0.985, opacity: 0 }}
                        animate={{ y: 0, scale: 1, opacity: 1 }}
                        exit={{ y: 26, scale: 0.985, opacity: 0 }}
                        transition={{ type: "spring", stiffness: 240, damping: 26 }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* ══ HEADER ═══════════════════════════════════════════ */}
                        <header className="relative flex items-center justify-between gap-4 border-b border-border px-6 py-4">
                            <div className="pointer-events-none absolute inset-0 opacity-[0.04]" style={{ background: BRAND_GRAD }} />
                            <div className="relative flex min-w-0 items-center gap-3">
                                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white shadow-sm" style={{ background: BRAND_GRAD }}>
                                    <Film className="h-4 w-4" />
                                </span>
                                <div className="min-w-0">
                                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                                        Screening room · Chapter {chapterIndex + 1}
                                    </p>
                                    <h2 className="truncate text-[19px] font-normal italic leading-tight text-foreground" style={{ fontFamily: SERIF }}>
                                        {chapterTitle}
                                    </h2>
                                </div>
                            </div>

                            {/* Act switcher (segmented, gated in feel but freely navigable) */}
                            <div className="relative flex items-center gap-1 rounded-full border border-border bg-muted/50 p-1">
                                {([
                                    { key: "slides" as Act, label: "Slides", icon: Film },
                                    { key: "script" as Act, label: "Script", icon: Mic },
                                ]).map(({ key, label, icon: Icon }) => {
                                    const active = act === key;
                                    return (
                                        <button
                                            key={key}
                                            onClick={() => goToAct(key)}
                                            disabled={busy}
                                            className={`relative flex cursor-pointer items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${active ? "text-white" : "text-muted-foreground hover:text-foreground"}`}
                                        >
                                            {active && (
                                                <motion.span layoutId="act-pill" className="absolute inset-0 rounded-full" style={{ background: BRAND_GRAD }} transition={{ type: "spring", stiffness: 380, damping: 30 }} />
                                            )}
                                            <Icon className="relative h-3.5 w-3.5" />
                                            <span className="relative">{label}</span>
                                        </button>
                                    );
                                })}
                            </div>

                            <button
                                onClick={tryClose}
                                className="relative cursor-pointer rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                                aria-label="Close"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </header>

                        {/* ══ BODY ═════════════════════════════════════════════ */}
                        <div className="flex min-h-0 flex-1">
                            {/* ── LEFT RAIL · filmstrip of slides ── */}
                            <aside className="flex w-[132px] shrink-0 flex-col border-r border-border">
                                <div className="px-3 py-2.5 text-[10.5px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                                    {total} slide{total === 1 ? "" : "s"}
                                </div>
                                <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-2.5 pb-3">
                                    {work.map((s, i) => {
                                        const active = i === current;
                                        return (
                                            <button
                                                key={s.slideId}
                                                onClick={() => goTo(i)}
                                                disabled={busy}
                                                className={`group relative block w-full cursor-pointer overflow-hidden rounded-xl border text-left transition-all disabled:cursor-not-allowed ${active ? "border-transparent ring-2 ring-primary" : "border-border hover:border-primary/40"}`}
                                                style={active ? { boxShadow: "0 4px 14px rgba(109,91,211,0.25)" } : undefined}
                                            >
                                                <SlidePreview html={s.html} className="h-[62px] w-full" />
                                                <span className={`absolute left-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-md px-1 text-[9.5px] font-bold ${active ? "text-white" : "bg-background/80 text-muted-foreground"}`} style={active ? { background: BRAND_GRAD } : undefined}>
                                                    {s.slideIndex}
                                                </span>
                                                {regenId === s.slideId && (
                                                    <span className="absolute inset-0 flex items-center justify-center bg-background/70">
                                                        <Loader2 className="h-4 w-4 animate-spin text-primary" />
                                                    </span>
                                                )}
                                            </button>
                                        );
                                    })}
                                </div>
                            </aside>

                            {/* ── CENTER · big preview ── */}
                            <section className="flex min-w-0 flex-1 flex-col bg-muted/20">
                                <div className="relative flex min-h-0 flex-1 items-center justify-center p-5">
                                    <div className="relative aspect-video w-full max-w-full overflow-hidden rounded-2xl border border-border shadow-xl">
                                        <SlidePreview html={currentSlide?.html ?? ""} className="h-full w-full" />
                                        <AnimatePresence>
                                            {isRegenThis && (
                                                <motion.div
                                                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                                                    className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-foreground/50 backdrop-blur-sm"
                                                >
                                                    <Loader2 className="h-7 w-7 animate-spin text-white" />
                                                    <p className="text-[13px] font-semibold text-white">Redesigning slide {currentSlide?.slideIndex}…</p>
                                                </motion.div>
                                            )}
                                        </AnimatePresence>
                                    </div>
                                </div>

                                {/* prev / next strip */}
                                <div className="flex items-center justify-between gap-2 border-t border-border px-5 py-2.5">
                                    <button
                                        onClick={() => goTo(current - 1)}
                                        disabled={busy || current === 0}
                                        className="flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                                    >
                                        <ArrowLeft className="h-4 w-4" /> Prev
                                    </button>
                                    <span className="text-[12px] font-medium tabular-nums text-muted-foreground">
                                        Slide {currentSlide?.slideIndex ?? 0} of {total}
                                    </span>
                                    <button
                                        onClick={() => goTo(current + 1)}
                                        disabled={busy || current >= total - 1}
                                        className="flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                                    >
                                        Next <ArrowRight className="h-4 w-4" />
                                    </button>
                                </div>
                            </section>

                            {/* ── RIGHT · inspector (changes by act) ── */}
                            <aside className="flex w-[336px] shrink-0 flex-col border-l border-border">
                                <div className="min-h-0 flex-1 overflow-y-auto p-5">
                                    <AnimatePresence mode="wait">
                                        {act === "slides" ? (
                                            <motion.div
                                                key="slides-panel"
                                                initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }}
                                                transition={{ duration: 0.2 }}
                                            >
                                                <div className="mb-1 flex items-center gap-2">
                                                    <MessageSquarePlus className="h-4 w-4 text-primary" />
                                                    <h3 className="text-[13px] font-bold text-foreground">Request a change</h3>
                                                </div>
                                                <p className="mb-3 text-[12.5px] leading-relaxed text-muted-foreground">
                                                    Not happy with slide {currentSlide?.slideIndex}? Describe what to change and
                                                    the AI will redesign just this slide.
                                                </p>
                                                <textarea
                                                    value={instruction}
                                                    onChange={(e) => setInstruction(e.target.value)}
                                                    disabled={busy}
                                                    rows={5}
                                                    maxLength={600}
                                                    placeholder="e.g. Make it a 3-column comparison, add a real-world example, use warmer colours…"
                                                    className="w-full resize-none rounded-xl bg-background px-3 py-2.5 text-[13px] leading-relaxed text-foreground outline-none ring-1 ring-border placeholder:text-muted-foreground/60 focus:ring-primary/50 disabled:opacity-60"
                                                />
                                                <div className="mt-1.5 text-right text-[11px] tabular-nums text-muted-foreground/70">{instruction.length}/600</div>
                                                <button
                                                    onClick={regenerate}
                                                    disabled={busy || !instruction.trim()}
                                                    className="mt-2 flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl text-[13px] font-bold text-white shadow-md transition-transform active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                                                    style={{ background: BRAND_GRAD }}
                                                >
                                                    {isRegenThis ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                                                    Regenerate this slide
                                                </button>

                                                <div className="mt-5 rounded-xl border border-border bg-muted/30 p-3.5">
                                                    <p className="text-[12px] leading-relaxed text-muted-foreground">
                                                        Tip: screen every slide using the filmstrip on the left. When the visuals
                                                        look right, switch to <span className="font-semibold text-foreground">Script</span> to review the voiceover.
                                                    </p>
                                                </div>
                                            </motion.div>
                                        ) : (
                                            <motion.div
                                                key="script-panel"
                                                initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }}
                                                transition={{ duration: 0.2 }}
                                                className="flex h-full flex-col"
                                            >
                                                <div className="mb-1 flex items-center justify-between">
                                                    <div className="flex items-center gap-2">
                                                        <Mic className="h-4 w-4 text-primary" />
                                                        <h3 className="text-[13px] font-bold text-foreground">Narration · slide {currentSlide?.slideIndex}</h3>
                                                    </div>
                                                    {savingNarration && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                                                </div>
                                                <p className="mb-3 text-[12.5px] leading-relaxed text-muted-foreground">
                                                    This is exactly what the voice will speak. Edit freely, or ✨ Enhance to polish it.
                                                </p>
                                                <div className="relative min-h-0 flex-1">
                                                    <textarea
                                                        value={draft}
                                                        onChange={(e) => setDraft(e.target.value)}
                                                        disabled={busy}
                                                        placeholder="Slide narration…"
                                                        className="h-full min-h-[220px] w-full resize-none rounded-xl bg-background px-3 py-2.5 text-[13px] leading-relaxed text-foreground outline-none ring-1 ring-border placeholder:text-muted-foreground/60 focus:ring-primary/50 disabled:opacity-60"
                                                    />
                                                    <AnimatePresence>
                                                        {enhancing && (
                                                            <motion.div
                                                                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                                                                className="pointer-events-none absolute inset-0 overflow-hidden rounded-xl"
                                                            >
                                                                <motion.div
                                                                    className="absolute inset-y-0 w-1/3"
                                                                    style={{ background: "linear-gradient(90deg, transparent, rgba(109,91,211,0.18), transparent)" }}
                                                                    animate={{ x: ["-120%", "320%"] }}
                                                                    transition={{ duration: 1.1, repeat: Infinity, ease: "linear" }}
                                                                />
                                                            </motion.div>
                                                        )}
                                                    </AnimatePresence>
                                                </div>
                                                <div className="mt-2.5 flex items-center gap-2">
                                                    <button
                                                        onClick={enhance}
                                                        disabled={busy || !draft.trim()}
                                                        className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-primary/10 px-3 py-2 text-[12.5px] font-semibold text-primary transition-colors hover:bg-primary/20 disabled:opacity-40"
                                                    >
                                                        {enhancing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                                                        Enhance
                                                    </button>
                                                    <AnimatePresence>
                                                        {preEnhance !== null && (
                                                            <motion.button
                                                                initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}
                                                                onClick={undoEnhance}
                                                                className="flex cursor-pointer items-center gap-1 rounded-lg px-2.5 py-2 text-[12.5px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                                                            >
                                                                <Undo2 className="h-3.5 w-3.5" /> Undo
                                                            </motion.button>
                                                        )}
                                                    </AnimatePresence>
                                                    <span className="ml-auto text-[11px] tabular-nums text-muted-foreground/70">
                                                        {draft.trim().split(/\s+/).filter(Boolean).length} words
                                                    </span>
                                                </div>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </div>

                                {/* ── FOOTER · gated primary action ── */}
                                <div className="border-t border-border p-4">
                                    {act === "slides" ? (
                                        <button
                                            onClick={() => goToAct("script")}
                                            disabled={busy}
                                            className="group relative flex h-12 w-full cursor-pointer items-center justify-center gap-2 overflow-hidden rounded-2xl text-[14px] font-bold text-white shadow-lg transition-transform active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
                                            style={{ background: BRAND_GRAD }}
                                        >
                                            <span className="pointer-events-none absolute inset-0 translate-x-[-120%] bg-white/20 transition-transform duration-700 group-hover:translate-x-[120%]" style={{ maskImage: "linear-gradient(90deg,transparent,black,transparent)" }} />
                                            Slides look good · Review script
                                            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                                        </button>
                                    ) : (
                                        <div className="space-y-2">
                                            <button
                                                onClick={approve}
                                                disabled={busy}
                                                className="group relative flex h-12 w-full cursor-pointer items-center justify-center gap-2 overflow-hidden rounded-2xl text-[14px] font-bold text-white shadow-lg transition-transform active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
                                                style={{ background: BRAND_GRAD }}
                                            >
                                                <span className="pointer-events-none absolute inset-0 translate-x-[-120%] bg-white/20 transition-transform duration-700 group-hover:translate-x-[120%] group-disabled:hidden" style={{ maskImage: "linear-gradient(90deg,transparent,black,transparent)" }} />
                                                {approving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic className="h-4 w-4" />}
                                                Approve &amp; generate voiceover
                                            </button>
                                            <button
                                                onClick={() => goToAct("slides")}
                                                disabled={busy}
                                                className="flex h-9 w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl text-[12.5px] font-semibold text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                                            >
                                                <ArrowLeft className="h-3.5 w-3.5" /> Back to slides
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </aside>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>,
        document.body
    );
}
