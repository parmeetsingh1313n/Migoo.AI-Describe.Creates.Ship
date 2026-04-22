import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });

const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql);

async function check() {
    const res = await db.execute('SELECT "video_id", "avatar_clip_urls" FROM "short_video_assets" ORDER BY "created_at" DESC LIMIT 1');
    console.log("Latest short video asset:");
    console.dir(res.rows[0], { depth: null });
}

check().catch(console.error);
