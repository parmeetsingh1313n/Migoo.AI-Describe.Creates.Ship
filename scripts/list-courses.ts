import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import { coursesTable } from '../config/schema';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env' });
const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql);

async function list() {
    console.log("Listing all courses...");
    try {
        const list = await db.select().from(coursesTable);
        console.log(`\nFound ${list.length} courses:`);
        console.table(list.map(c => ({
            courseId: c.courseId,
            courseName: c.courseName,
            userId: c.userId,
        })));
    } catch (e: any) {
        console.error("❌ Failed to query courses:", e);
    }
}

list().catch(console.error);
