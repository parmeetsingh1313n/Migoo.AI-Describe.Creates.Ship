"use client";

import { useState } from "react";
import axios from "axios";

/**
 * TEST PAGE: /test-parallel
 * Enter a courseId, fetch its chapters, then trigger parallel slide generation
 * for any chapter. Sends the full chapter object (same shape the real flow uses).
 */
export default function TestParallelSlides() {
    const [courseId, setCourseId] = useState("");
    const [course, setCourse] = useState<any>(null);
    const [loadingCourse, setLoadingCourse] = useState(false);
    const [triggering, setTriggering] = useState<number | null>(null);
    const [result, setResult] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const loadCourse = async () => {
        if (!courseId.trim()) { setError("Enter a courseId first"); return; }
        setLoadingCourse(true);
        setError(null);
        setResult(null);
        setCourse(null);
        try {
            const res = await axios.get(`/api/course?courseId=${encodeURIComponent(courseId.trim())}`);
            const data = res.data?.data ?? res.data;
            const courseObj = data?.course ?? data;
            if (!courseObj?.courseLayout?.chapters) {
                setError("Course has no chapters (check the courseId)");
                return;
            }
            setCourse(courseObj);
        } catch (err: any) {
            setError(err?.response?.data?.error || err.message || "Failed to load course");
        } finally {
            setLoadingCourse(false);
        }
    };

    const triggerParallel = async (chapter: any, chapterIndex: number) => {
        setTriggering(chapterIndex);
        setError(null);
        setResult(null);
        try {
            const res = await axios.post("/api/test-parallel-slides", {
                chapter,
                courseId: course.courseId,
                courseName: course.courseName,
                chapterIndex,
            });
            const data = res.data?.data ?? res.data;
            setResult(`✅ Parallel generation queued for "${chapter.chapterTitle}" (chapter ${chapterIndex}). Watch your Inngest dashboard / server logs for progress. Event: ${data.event}`);
        } catch (err: any) {
            setError(err?.response?.data?.error || err.message || "Failed to trigger");
        } finally {
            setTriggering(null);
        }
    };

    const chapters: any[] = course?.courseLayout?.chapters ?? [];

    return (
        <div style={{ maxWidth: 760, margin: "0 auto", padding: 32, fontFamily: "system-ui, sans-serif" }}>
            <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>🧪 Test Parallel Slide Generation</h1>
            <p style={{ color: "#666", fontSize: 14, marginBottom: 24 }}>
                Trigger the experimental plan-then-parallel generator for any chapter (~1 min instead of ~7 min).
                The serial pipeline is unchanged; this only sends the <code>course/slides.generate.parallel</code> event.
            </p>

            <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
                <input
                    value={courseId}
                    onChange={(e) => setCourseId(e.target.value)}
                    placeholder="Enter courseId (from your course page URL)"
                    style={{ flex: 1, padding: "10px 14px", borderRadius: 8, border: "1px solid #ddd", fontSize: 14 }}
                />
                <button
                    onClick={loadCourse}
                    disabled={loadingCourse}
                    style={{ padding: "10px 20px", borderRadius: 8, border: "none", background: "#6D5BD3", color: "#fff", fontWeight: 600, cursor: "pointer", opacity: loadingCourse ? 0.6 : 1 }}
                >
                    {loadingCourse ? "Loading..." : "Load Chapters"}
                </button>
            </div>

            {error && (
                <div style={{ padding: 14, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, color: "#b91c1c", fontSize: 14, marginBottom: 16 }}>
                    {error}
                </div>
            )}
            {result && (
                <div style={{ padding: 14, background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, color: "#15803d", fontSize: 14, marginBottom: 16 }}>
                    {result}
                </div>
            )}

            {course && (
                <div>
                    <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>{course.courseName}</h2>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {chapters.map((ch, i) => (
                            <div key={ch.chapterId ?? i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", border: "1px solid #eee", borderRadius: 10 }}>
                                <div>
                                    <div style={{ fontWeight: 600, fontSize: 14 }}>Ch{i + 1}: {ch.chapterTitle}</div>
                                    <div style={{ fontSize: 12, color: "#999" }}>{(ch.subContent?.length ?? 0)} outline points</div>
                                </div>
                                <button
                                    onClick={() => triggerParallel(ch, i)}
                                    disabled={triggering !== null}
                                    style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: i === 0 ? "#6D5BD3" : "#374151", color: "#fff", fontWeight: 600, fontSize: 13, cursor: "pointer", opacity: triggering !== null ? 0.6 : 1 }}
                                >
                                    {triggering === i ? "Triggering..." : "⚡ Generate (parallel)"}
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div style={{ marginTop: 32, padding: 16, background: "#f9fafb", borderRadius: 10, fontSize: 12, color: "#666" }}>
                <strong>How to find courseId:</strong> open your course page — it's the last part of the URL
                (<code>/course/&lt;courseId&gt;</code>).
            </div>
        </div>
    );
}
