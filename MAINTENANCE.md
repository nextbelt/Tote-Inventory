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

## One-time setup: tags, notes and swap

Tote tags (Holiday, Camping, …), tote notes ("lid cracked") and swapping
two totes in one step need three small additions to the database. The app
detects whether they exist: until this is done, those features show
**"One-time setup needed: run the SQL in MAINTENANCE.md"** and everything
else keeps working exactly as before. Nothing in the script deletes or
rewrites existing totes, and it is safe to run more than once.

Steps (about one minute, from either phone or a computer):

1. Open the Supabase dashboard → your project → **SQL Editor** (left
   sidebar) → **New query**.
2. Open `supabase/migrations/20261108_tags_notes_swap.sql` from this
   repository, select **everything** in the file and copy it.
3. Paste it into the SQL Editor and press **Run**.
4. Read the **Messages**/**Results** panel. "Success" with no errors is the
   expected outcome. You may also see one NOTICE line about
   `UNIQUE(position)` — see below.
5. Force-quit and reopen the app on both phones. The tag, note and swap
   features switch on by themselves.

Verify it worked (paste in the SQL Editor, Run — expect 2 column rows and
1 function row):

```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'totes'
  AND column_name IN ('tags', 'notes')
ORDER BY column_name;

SELECT proname AS function_name
FROM pg_proc
WHERE proname = 'swap_tote_positions';
```

About the `UNIQUE(position)` notice: the script adds the unique constraint
from the section above automatically, but only if there are no hidden
duplicate rows left. If it prints *"Skipped UNIQUE(position): N spot(s)
still have duplicate rows"*, open the app → **Tidy-up available** →
**Remove hidden duplicates**, then run the same script again. Everything
else (tags, notes, swap) is already in place after the first run.

Recently deleted totes and removed items need **no** database change: they
live in hidden rows of the same table (positions starting with `__`) and
are cleared automatically after 30 days.
