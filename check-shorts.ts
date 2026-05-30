import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import { shortVideoAssets, shortVideoSeries } from './config/schema';
import { desc } from 'drizzle-orm';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env' });
const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql);

async function check() {
    console.log("Checking latest short series and video assets...");
    try {
        const series = await db
            .select()
            .from(shortVideoSeries)
            .orderBy(desc(shortVideoSeries.createdAt))
            .limit(3);
        
        console.log("\n--- LATEST SERIES ---");
        console.table(series.map(s => ({
            id: s.id,
            seriesId: s.seriesId,
            title: s.title,
            status: s.status,
            createdAt: s.createdAt
        })));

        const assets = await db
            .select()
            .from(shortVideoAssets)
            .orderBy(desc(shortVideoAssets.createdAt))
            .limit(10);
        
        console.log("\n--- LATEST VIDEO ASSETS ---");
        console.table(assets.map(a => ({
            id: a.id,
            videoId: a.videoId,
            seriesId: a.seriesId,
            videoTitle: a.videoTitle,
            status: a.status,
            videoUrl: a.videoUrl ? a.videoUrl.substring(0, 50) + "..." : null,
            createdAt: a.createdAt
        })));
    } catch (e: any) {
        console.error("❌ Drizzle Query Failed!", e);
    }
}

check().catch(console.error);
