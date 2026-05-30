import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import { chapterContentSlides } from './config/schema';
import { eq } from 'drizzle-orm';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env' });
const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql);

async function check() {
    console.log("Checking detailed slides for Complete Python Beginner Course...");
    try {
        const slides = await db
            .select()
            .from(chapterContentSlides)
            .where(eq(chapterContentSlides.courseId, '0923eda5-3413-4363-916a-b71d069c1005'));
        
        console.log(`\nFound ${slides.length} slides for this course:`);
        
        const simplified = slides.map(s => ({
            chapterId: s.chapterId,
            slideId: s.slideId,
            slideIndex: s.slideIndex,
            hasAudio: !!s.audioUrl,
            audioUrl: s.audioUrl ? s.audioUrl.substring(0, 50) + "..." : null,
            hasHtml: !!s.html,
            hasRevealData: !!s.revealData,
            createdAt: s.createdAt
        }));

        // Sort by chapterId and then slideIndex
        simplified.sort((a, b) => {
            if (a.chapterId !== b.chapterId) return a.chapterId.localeCompare(b.chapterId);
            return a.slideIndex - b.slideIndex;
        });

        console.table(simplified);
    } catch (e: any) {
        console.error("❌ Drizzle Query Failed!", e);
    }
}

check().catch(console.error);
