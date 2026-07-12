# Database Maintenance

## Current live-data issues (found 2026-07-12)

Inspecting the production database read-only showed two legacy problems,
both caused by bugs that are now fixed in the app:

1. **Hidden duplicate rows** — 48 rows but only 23 unique positions
   (e.g. `A2` has 12 copies, `A1` has 7). The live table was created
   before `database-setup.sql` added `position TEXT NOT NULL UNIQUE`, and
   the old silent-fallback save path + migration retries inserted stale
   copies. The app always shows just the newest row per position, but
   deleting a tote would "resurrect" an older hidden copy.
2. **Embedded base64 photos** — the `D4` tote row is ~6.5 MB because two
   item photos are stored as data-URIs inside the `items` JSONB. Every app
   open downloads the full ~6.5 MB.

## Fixing them

Open the app → the amber **"Tidy-up available"** banner → **Review**. Two
one-tap actions (each shows exactly what it will change first):

- **Remove hidden duplicates** — keeps the newest row per spot (the one
  the app has always displayed), deletes the older hidden copies.
- **Move slow photos to storage** — uploads each embedded photo to the
  `tote-images` bucket (compressed), then updates the row to reference the
  URL. The row is only updated after the upload succeeds.

## Afterwards: restore the unique constraint

Once duplicates are removed, run this in the Supabase **SQL Editor** so
duplicates can never come back (the app also guards client-side):

```sql
-- Verify there are no duplicates left (should return 0 rows):
SELECT position, COUNT(*) FROM totes GROUP BY position HAVING COUNT(*) > 1;

-- Then enforce uniqueness:
ALTER TABLE totes ADD CONSTRAINT totes_position_unique UNIQUE (position);
```

If the first query still returns rows, re-run the in-app tidy-up first.

Optional backup before any of this (SQL Editor):

```sql
CREATE TABLE totes_backup_20260712 AS SELECT * FROM totes;
```
