import { db } from './config/db';
import { shortVideoAssets } from './config/schema';
import { eq } from 'drizzle-orm';

async function run() {
    const res = await db.select().from(shortVideoAssets).where(eq(shortVideoAssets.videoId, 'vid_1775291323116_xuhq5p'));
    console.log(JSON.stringify(res, null, 2));
}

run().catch(console.error);
