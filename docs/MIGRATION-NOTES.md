# Database migration notes

Everything here is **code and reviewable SQL only**. No migration has been run
against `DATABASE_URL`. Read the "How to apply" section before touching production.

---

## 1. Why this exists

The project was built with `drizzle-kit push`. `push` diffs the schema against the
live database and applies the result immediately: no SQL is written to disk, no
history is kept, and there is nothing to roll back to. Its worst failure mode is
that a column **rename** is indistinguishable from a **drop + add**, so `push`
silently destroys the column's data.

`drizzle.config.ts` now sets `out: './drizzle'`, which switches the project to
`generate` → review → `migrate`. Migrations are versioned files you can read,
diff, and revert.

| | `push` (before) | `generate` + `migrate` (now) |
|---|---|---|
| SQL written to disk | no | yes, reviewable |
| History / rollback | none | per-migration files |
| Column rename | silent DROP + ADD (data loss) | `RENAME COLUMN` |
| Runs on | your laptop, immediately | explicit, auditable step |

## 2. What changed in the schema

**`json` → `jsonb`** (20 columns). `json` stores the raw text and re-parses it on
*every* read; `jsonb` parses once on write and can be GIN-indexed. Safe here
because nothing in this codebase re-serialises and re-hashes a stored payload —
see the caveat below.

**Foreign-key source columns are now indexed** (10 indexes). Postgres indexes the
FK *target* automatically via its PK/unique constraint, but **never** the source.
Before this, `chapter_content_slides` had zero indexes, so "load this chapter's
slides" was a sequential scan of the whole table, and so was the check Postgres
runs on every `DELETE` of a parent row. Composite indexes are ordered so the
leftmost column still serves the bare FK lookup.

**`ON DELETE CASCADE`** on the six true parent→child FKs (course→images, slides,
generation status; series→assets, progress; project→messages). Previously every
FK was `NO ACTION`, so deleting a course threw a constraint violation and orphan
rows accumulated. **The `userId` FKs were left as `NO ACTION` deliberately** —
cascading there would silently delete a user's entire content library.

**`timestamp` → `timestamptz`** (17 columns). The app writes JS `new Date()`,
which is UTC, and Neon runs in UTC — so the values were already UTC, just without
saying so. The type now records it. This matters most for
`short_video_series.publish_time`, which is compared against "now" by the
scheduler.

**`updatedAt` maintains itself** via `.$onUpdate(() => new Date())`. There are 39
hand-written `updatedAt: new Date()` assignments across 22 files; each one is a
place a future edit can forget. They are now redundant (an explicit value still
wins, so they are harmless) and new code does not need them.

**`integer` 0/1 → `boolean`** for `voiceover_enabled` and `theme_confirmed`. The
domain was always two-valued; the type now enforces it. Call sites updated in
`app/api/motion-graphics/route.ts`, `app/api/motion-graphics/[projectId]/route.ts`,
and `app/motion-graphics/[projectId]/page.tsx`.

### jsonb caveat, recorded so it isn't rediscovered the hard way

`jsonb` normalises what it stores: it reorders keys, strips whitespace, drops
duplicate keys and canonicalises numbers. Harmless for every column here.

It is **not** harmless for a webhook body you intend to verify. A provider signs
the exact bytes it sent; re-hashing a `jsonb` round-trip produces a different
digest, forever. If a signed payload is ever persisted, verify it from the raw
`await req.text()` bytes **before** parsing — after that, storing it as `jsonb`
is fine.

## 3. How to apply

`drizzle/0000_baseline_existing_schema.sql` is a **baseline**. It describes the
schema the live database *already has*. It exists only so that `0001` could be
generated as a pure diff. **Do not run it** — it is `CREATE TABLE` for 11 tables
that already exist.

### Step 1 — mark the baseline as already applied

In the Neon SQL Editor:

```sql
CREATE SCHEMA IF NOT EXISTS drizzle;
CREATE TABLE IF NOT EXISTS drizzle."__drizzle_migrations" (
  id SERIAL PRIMARY KEY,
  hash text NOT NULL,
  created_at bigint
);
INSERT INTO drizzle."__drizzle_migrations" (hash, created_at)
VALUES ('aa1c9c0ff7c29a02ce44f7c2c2a901ec66030221e8d9de7193757bce93d043a9', 1786179091816);
```

That hash is the SHA-256 of `0000_baseline_existing_schema.sql`. If you edit that
file the hash changes and `migrate` will try to re-run it — don't edit it.

### Step 2 — back up

Take a Neon branch/snapshot first. `0001` rewrites tables in place.

### Step 3 — apply the real migration

```bash
npm run db:migrate
```

This runs `0001_harden_schema.sql` only, inside a transaction: it either fully
applies or fully rolls back.

### Step 4 — verify

```sql
SELECT tablename, indexname FROM pg_indexes
WHERE schemaname = 'public' ORDER BY tablename;

SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND data_type IN ('json','jsonb','boolean')
ORDER BY table_name;
```

Expect zero remaining `json` columns and an index on every FK source column.

### Note on the hand-edits in 0001

`drizzle-kit generate` produced SQL that would have **failed or silently
misbehaved** in three places. The file is hand-corrected and the reasons are in a
header comment inside it. If you ever regenerate it, re-apply those fixes:

1. `integer → boolean` has no automatic cast in Postgres. The generated
   `SET DATA TYPE boolean` aborts with *"cannot be cast automatically"*. Fixed
   with `USING (col <> 0)`, and by dropping the integer default first — a column
   default cannot be cast either.
2. `timestamp → timestamptz` *does* cast automatically, but it interprets
   existing naive values using the **session's** `TimeZone`, which is not
   guaranteed over the HTTP driver. Pinned with `AT TIME ZONE 'UTC'`.
3. `DROP CONSTRAINT` gained `IF EXISTS`, because constraint names created by
   `push` were never verified against a migration history.

`json → jsonb` needs no `USING`: Postgres registers an assignment cast and the
stored text is valid JSON by construction.

## 4. Deliberately NOT changed

**Foreign keys still reference `users.email`.** This is the schema's biggest
design flaw: email is mutable, is not in the Clerk JWT, and the column is
misleadingly named `userId` when it holds an address. Every handler therefore has
to fetch the Clerk user just to resolve an owner. Fixing it means adding
`users.clerk_user_id`, backfilling it, repointing five FKs and rewriting every
ownership check — a data migration with a correctness risk of its own, not a
schema tidy-up. Out of scope here, on purpose.

**`casing: 'snake_case'` is not enabled.** Column naming is inconsistent
(`courseId` beside `slide_topics`) because early tables omitted the name string
and Drizzle quoted the JS identifier verbatim. Enabling the flag does **not**
rename anything — it changes what SQL Drizzle *emits*, so every query would
target `course_id` while the database still has `"courseId"`, and the whole app
would break. Doing it properly needs a `RENAME COLUMN` migration first, and the
same setting mirrored in `config/db.tsx`, or `CREATE` and `SELECT` disagree.
`drizzle.config.ts` carries a comment saying so.

**Transactions.** The Neon **HTTP** driver cannot do interactive transactions, so
credit-deduction and course-creation are two separate round trips: a crash
between them charges a user for a course they never got. The fix is not a schema
change — it is either `db.batch()` for the cases that fit, or the Neon WebSocket
driver (`drizzle-orm/neon-serverless`) where a real transaction is needed. Worth
doing; it is an application-architecture change and belongs in its own commit.

**The 39 manual `updatedAt: new Date()` assignments** are left in place. They are
now redundant but harmless, and removing them touches 22 files for no behavioural
gain — churn that would bury the actual schema change in this diff.
