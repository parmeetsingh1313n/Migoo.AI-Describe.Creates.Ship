"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function TestParallelSlides() {
    const [courseId, setCourseId] = useState("");
    const [chapterId, setChapterId] = useState("");
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState<any>(null);
    const [error, setError] = useState<string | null>(null);

    const handleTest = async () => {
        if (!courseId || !chapterId) {
            setError("Please enter both courseId and chapterId");
            return;
        }

        setLoading(true);
        setError(null);
        setResult(null);

        try {
            const response = await fetch("/api/test-parallel-slides", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ courseId, chapterId }),
            });

            const data = await response.json();

            if (!response.ok) {
                setError(data.error || "Failed to trigger parallel generation");
                return;
            }

            setResult(data);
        } catch (err: any) {
            setError(err.message || "Network error");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="container mx-auto p-8 max-w-2xl">
            <Card>
                <CardHeader>
                    <CardTitle>🧪 Test Parallel Slide Generation</CardTitle>
                    <CardDescription>
                        Trigger the experimental plan-then-parallel slide generation for a specific chapter.
                        This will generate all slides in ~1 minute instead of ~7 minutes.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium mb-2">Course ID</label>
                        <Input
                            placeholder="e.g., course-123"
                            value={courseId}
                            onChange={(e) => setCourseId(e.target.value)}
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium mb-2">Chapter ID</label>
                        <Input
                            placeholder="e.g., chapter-456"
                            value={chapterId}
                            onChange={(e) => setChapterId(e.target.value)}
                        />
                    </div>

                    <Button
                        onClick={handleTest}
                        disabled={loading || !courseId || !chapterId}
                        className="w-full"
                    >
                        {loading ? "Triggering..." : "Trigger Parallel Generation"}
                    </Button>

                    {error && (
                        <div className="p-4 bg-red-50 border border-red-200 rounded-md">
                            <p className="text-red-800 text-sm font-medium">Error:</p>
                            <p className="text-red-600 text-sm">{error}</p>
                        </div>
                    )}

                    {result && (
                        <div className="p-4 bg-green-50 border border-green-200 rounded-md space-y-2">
                            <p className="text-green-800 text-sm font-medium">✅ {result.message}</p>
                            <div className="text-xs text-green-700 space-y-1">
                                <p><strong>Chapter Index:</strong> {result.chapterIndex}</p>
                                <p><strong>Event:</strong> {result.event}</p>
                                <p className="mt-2">{result.note}</p>
                            </div>
                            <div className="mt-3 p-3 bg-white rounded border border-green-300">
                                <p className="text-xs text-gray-600 mb-1">Next steps:</p>
                                <ul className="text-xs text-gray-700 list-disc list-inside space-y-1">
                                    <li>Check your Inngest dashboard for real-time progress</li>
                                    <li>Console logs will show: "🗺️ Generating chapter plan" → "✅ Plan ready" → "🎬 Generating N slides in parallel"</li>
                                    <li>Compare the output quality with the serial version</li>
                                </ul>
                            </div>
                        </div>
                    )}

                    <div className="pt-4 border-t">
                        <p className="text-xs text-gray-500">
                            <strong>How to find IDs:</strong> Go to your course page, open browser DevTools → Network tab,
                            refresh the page, and look for API calls. The courseId and chapterId will be in the URLs.
                        </p>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
