import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
    schema: './config/schema.tsx',
    // Versioned SQL migrations live here. `drizzle-kit generate` diffs the schema
    // against the previous snapshot and writes an ALTER-only migration, so a column
    // rename becomes RENAME COLUMN instead of the silent DROP + ADD (i.e. data loss)
    // that `drizzle-kit push` performs. Apply with `drizzle-kit migrate`, never `push`.
    out: './drizzle',
    dialect: 'postgresql',
    // NOTE: `casing` is intentionally NOT set. The live database was created with
    // verbatim column names ("courseId", "courseName", ...). Adding
    // casing: 'snake_case' would make every generated query target course_id,
    // which does not exist — it needs a RENAME COLUMN migration first, and the
    // same setting must then be mirrored in config/db.tsx or CREATE and SELECT
    // will disagree.
    dbCredentials: {
        url: process.env.DATABASE_URL!,
    },
});
