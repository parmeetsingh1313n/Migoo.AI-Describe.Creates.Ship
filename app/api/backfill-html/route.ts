import { db } from "@/config/db";
import { chapterContentSlides } from "@/config/schema";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { uploadSlideHtml } from "@/lib/slide-html";

/**
 * One-time backfill API: moves inline slide HTML out of Postgres and into
 * Appwrite Storage. For every row that still has inline `html` but no `htmlUrl`,
 * it uploads the markup, stores the resulting URL in `htmlUrl`, and nulls `html`.
 *
 * Idempotent: rows already migrated (htmlUrl set) are skipped by the WHERE
 * clause, so it is safe to run repeatedly and to resume after an interruption.
 *
 * Auth: gated behind a token to avoid accidental/abusive triggering — pass
 * `?key=<ADMIN_BACKFILL_KEY or APPWRITE_API_KEY>`.
 *
 * Usage: GET /api/backfill-html?key=xxx[&limit=100]
 */
export async function GET(req: NextRequest) {
    const key = req.nextUrl.searchParams.get("key");
    const validKeys = [process.env.ADMIN_BACKFILL_KEY, process.env.APPWRITE_API_KEY].filter(Boolean);
    if (!key || !validKeys.includes(key)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Cap work per invocation so a single request can't run unbounded on a large
    // table (and to stay within the serverless time budget). Default 100.
    const limitParam = Number(req.nextUrl.searchParams.get("limit"));
    const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 500) : 100;

    try {
        // Rows still holding inline HTML that haven't been offloaded yet.
        const rows = await db
            .select({
                id: chapterContentSlides.id,
                slideId: chapterContentSlides.slideId,
                html: chapterContentSlides.html,
            })
            .from(chapterContentSlides)
            .where(and(
                isNotNull(chapterContentSlides.html),
                isNull(chapterContentSlides.htmlUrl),
            ))
            .limit(limit);

        console.log(`🔄 Backfilling HTML → Appwrite for ${rows.length} slides...`);

        let updated = 0;
        let errors = 0;

        for (const row of rows) {
            if (!row.html) continue; // defensive; WHERE already filters nulls
            try {
                const url = await uploadSlideHtml(row.slideId, row.html);
                await db
                    .update(chapterContentSlides)
                    .set({ htmlUrl: url, html: null })
                    .where(eq(chapterContentSlides.id, row.id));
                updated++;
                console.log(`✅ ${row.slideId} → ${url}`);
            } catch (err: any) {
                console.error(`❌ Failed migrating ${row.slideId}:`, err?.message?.slice(0, 140));
                errors++;
            }
        }

        // How many still remain (approximate — reflects state after this batch).
        const remaining = await db
            .select({ id: chapterContentSlides.id })
            .from(chapterContentSlides)
            .where(and(
                isNotNull(chapterContentSlides.html),
                isNull(chapterContentSlides.htmlUrl),
            ));

        console.log(`🎉 HTML backfill batch complete: ${updated} updated, ${errors} errors, ${remaining.length} remaining`);

        return NextResponse.json({
            success: true,
            processed: rows.length,
            updated,
            errors,
            remaining: remaining.length,
            note: remaining.length > 0 ? "Run again to continue — endpoint is idempotent." : "All rows migrated.",
        });
    } catch (error: any) {
        console.error("❌ HTML backfill failed:", error?.message);
        return NextResponse.json({ success: false, error: error?.message }, { status: 500 });
    }
}
