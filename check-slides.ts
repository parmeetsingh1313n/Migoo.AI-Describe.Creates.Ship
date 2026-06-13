import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import { chapterContentSlides } from './config/schema';
import { like } from 'drizzle-orm';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env' });
const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql);

async function check() {
    console.log("Searching for slide with 'Fetching Data'...");
    try {
        const slides = await db
            .select()
            .from(chapterContentSlides)
            .where(like(chapterContentSlides.html, '%Fetching Data%'))
            .limit(1);
        
        if (slides.length > 0) {
            const s = slides[0];
            console.log(`\nFound slide: ${s.slideId}`);
            console.log(s.html);
        } else {
            console.log("No slide found matching query.");
        }
    } catch (e: any) {
        console.error("❌ Failed to query slide:", e);
    }
}

check().catch(console.error);
