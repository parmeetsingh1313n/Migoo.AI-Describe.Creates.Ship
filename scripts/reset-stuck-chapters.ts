import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import { chapterGenerationStatus } from '../config/schema';
import { eq, or } from 'drizzle-orm';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env' });
const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql);

async function resetStuckChapters() {
    console.log("Searching for stuck chapter generation statuses...");
    try {
        const stuck = await db.select()
            .from(chapterGenerationStatus)
            .where(
                or(
                    eq(chapterGenerationStatus.status, 'generating:audio'),
                    eq(chapterGenerationStatus.status, 'generating:slides'),
                    eq(chapterGenerationStatus.status, 'queued')
                )
            );

        console.log(`Found ${stuck.length} stuck chapter status records.`);

        for (const record of stuck) {
            console.log(`Resetting Chapter ID: ${record.chapterId} (Course ID: ${record.courseId}) from "${record.status}" to "failed"...`);
            await db.update(chapterGenerationStatus)
                .set({
                    status: 'failed',
                    errorMessage: 'Pipeline interrupted (Server restarted). Please click retry to resume generation.',
                    updatedAt: new Date()
                })
                .where(eq(chapterGenerationStatus.chapterId, record.chapterId));
        }

        console.log("✅ Stuck chapters successfully updated to 'failed' status.");
    } catch (e: any) {
        console.error("❌ Failed to reset stuck chapters:", e);
    }
}

resetStuckChapters().catch(console.error);
