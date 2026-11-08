-- ============================================================================
-- Garage Totes — one-time setup: tote tags, tote notes, atomic position swap
-- ============================================================================
-- Paste the WHOLE file into Supabase → SQL Editor → Run. Safe to run again:
-- every step checks first and only adds what is missing.
--
-- What it does
--   1. totes.tags   text[]  NOT NULL DEFAULT '{}'   (e.g. {Holiday,Camping})
--   2. totes.notes  text    up to 500 characters   (e.g. "lid cracked")
--   3. swap_tote_positions(a_id, b_id) — swaps two totes' spots in ONE
--      transaction so UNIQUE(position) is never violated half-way
--   4. UNIQUE(position) — added only if missing AND no position is
--      duplicated (otherwise a NOTICE lists the duplicates: real spots are
--      fixed with the in-app Tidy Up, hidden "__" rows with the merge
--      snippet in MAINTENANCE.md)
--   5. tells PostgREST to reload its schema cache so the app sees the
--      new columns/function right away
--
-- Nothing here deletes or rewrites existing rows. Existing rows get
-- tags = '{}' and notes = NULL.
-- Target: PostgreSQL 15 on Supabase.
-- ============================================================================

-- 1 + 2. Columns -------------------------------------------------------------
ALTER TABLE public.totes
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}';

ALTER TABLE public.totes
  ADD COLUMN IF NOT EXISTS notes text;

-- notes ≤ 500 characters (constraint added only when it is missing)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname  = 'totes_notes_length'
      AND conrelid = 'public.totes'::regclass
  ) THEN
    ALTER TABLE public.totes
      ADD CONSTRAINT totes_notes_length
      CHECK (notes IS NULL OR char_length(notes) <= 500);
  END IF;
END
$$;

-- 3. Atomic swap -------------------------------------------------------------
-- Locks both rows (always in id order, so two concurrent swaps can't
-- deadlock), refuses missing rows and reserved "__" rows, then swaps via a
-- temporary reserved position so a UNIQUE(position) constraint is never
-- violated mid-way. All inside the function's single transaction.
-- SECURITY INVOKER (the default): the caller's row-level-security policies
-- apply, exactly as for a normal UPDATE from the app.
CREATE OR REPLACE FUNCTION public.swap_tote_positions(a_id bigint, b_id bigint)
RETURNS SETOF public.totes
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  lo_id   bigint;
  hi_id   bigint;
  lo_pos  text;
  hi_pos  text;
  tmp_pos text;
  stamp   timestamptz := now();
BEGIN
  IF a_id IS NULL OR b_id IS NULL OR a_id = b_id THEN
    RAISE EXCEPTION 'swap_tote_positions: two different tote ids are required'
      USING ERRCODE = '22023'; -- invalid_parameter_value
  END IF;

  lo_id := LEAST(a_id, b_id);
  hi_id := GREATEST(a_id, b_id);

  SELECT position INTO lo_pos FROM public.totes WHERE id = lo_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'swap_tote_positions: tote % not found', lo_id
      USING ERRCODE = 'P0002'; -- no_data_found
  END IF;

  SELECT position INTO hi_pos FROM public.totes WHERE id = hi_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'swap_tote_positions: tote % not found', hi_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Positions starting with "__" are app-internal rows (settings, the
  -- removed-items bin, deleted-tote tombstones) — never swap those.
  IF left(lo_pos, 2) = '__' OR left(hi_pos, 2) = '__' THEN
    RAISE EXCEPTION 'swap_tote_positions: reserved rows cannot be swapped'
      USING ERRCODE = '22023';
  END IF;

  -- Park the first row on a unique temporary reserved position, then move
  -- the second into the freed slot, then the first into the second's slot.
  tmp_pos := '__swap__:' || lo_id::text || ':' || hi_id::text || ':'
             || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS');

  UPDATE public.totes SET position = tmp_pos                       WHERE id = lo_id;
  UPDATE public.totes SET position = lo_pos, updated_at = stamp    WHERE id = hi_id;
  UPDATE public.totes SET position = hi_pos, updated_at = stamp    WHERE id = lo_id;

  RETURN QUERY
    SELECT * FROM public.totes WHERE id IN (lo_id, hi_id) ORDER BY id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.swap_tote_positions(bigint, bigint)
  TO anon, authenticated;

-- 4. UNIQUE(position), guarded ---------------------------------------------
-- Fresh installs already have it (database-setup.sql). The original live
-- table predates it and may still hold duplicate rows, so this never fails
-- half-way: it adds the constraint only when no position is duplicated and
-- otherwise says exactly which ones are, and how to fix each kind:
--   - real spots (A3, LW2, …): the in-app Tidy Up removes the older copies
--   - hidden app rows (positions starting with "__", e.g. two "__config__"
--     rows from both phones saving the layout at the same moment): Tidy Up
--     never touches those — use the "Merge duplicate hidden rows" snippet
--     in MAINTENANCE.md
DO $$
DECLARE
  real_dups     text;
  reserved_dups text;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_attribute a
      ON a.attrelid = i.indrelid
     AND a.attnum   = ANY (i.indkey)
    WHERE i.indrelid    = 'public.totes'::regclass
      AND i.indisunique
      AND i.indnkeyatts = 1
      AND a.attname     = 'position'
  ) THEN
    RAISE NOTICE 'UNIQUE(position) is already in place — nothing to do.';
  ELSE
    SELECT string_agg(d.position || ' (' || d.n || ' rows)', ', ' ORDER BY d.position)
      INTO real_dups
    FROM (
      SELECT position, count(*) AS n
      FROM public.totes
      WHERE left(position, 2) <> '__'
      GROUP BY position
      HAVING count(*) > 1
    ) d;

    SELECT string_agg(d.position || ' (' || d.n || ' rows)', ', ' ORDER BY d.position)
      INTO reserved_dups
    FROM (
      SELECT position, count(*) AS n
      FROM public.totes
      WHERE left(position, 2) = '__'
      GROUP BY position
      HAVING count(*) > 1
    ) d;

    IF real_dups IS NULL AND reserved_dups IS NULL THEN
      ALTER TABLE public.totes
        ADD CONSTRAINT totes_position_unique UNIQUE (position);
      RAISE NOTICE 'Added UNIQUE(position).';
    ELSE
      IF real_dups IS NOT NULL THEN
        RAISE NOTICE
          'Skipped UNIQUE(position): these spots still have duplicate rows: %. Open the app → Tidy Up → "Remove hidden duplicates", then run this script again.',
          real_dups;
      END IF;
      IF reserved_dups IS NOT NULL THEN
        RAISE NOTICE
          'Skipped UNIQUE(position): these hidden app rows are duplicated: %. Tidy Up does not touch them — run the "Merge duplicate hidden rows" snippet in MAINTENANCE.md, then run this script again.',
          reserved_dups;
      END IF;
    END IF;
  END IF;
END
$$;

-- 5. Make PostgREST pick up the new columns and function immediately -------
NOTIFY pgrst, 'reload schema';
