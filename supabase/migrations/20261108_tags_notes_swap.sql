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
--   4. UNIQUE(position) — added only if missing AND there are no duplicate
--      rows left (otherwise a NOTICE tells you to run Tidy Up first)
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
-- table predates it and may still hold hidden duplicate rows; those must be
-- removed with the in-app Tidy Up first, so this never fails half-way.
DO $$
DECLARE
  dup_positions integer;
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
    SELECT count(*) INTO dup_positions
    FROM (
      SELECT position
      FROM public.totes
      GROUP BY position
      HAVING count(*) > 1
    ) d;

    IF dup_positions > 0 THEN
      RAISE NOTICE
        'Skipped UNIQUE(position): % spot(s) still have duplicate rows. Open the app → Tidy Up → "Remove hidden duplicates", then run this script again.',
        dup_positions;
    ELSE
      ALTER TABLE public.totes
        ADD CONSTRAINT totes_position_unique UNIQUE (position);
      RAISE NOTICE 'Added UNIQUE(position).';
    END IF;
  END IF;
END
$$;

-- 5. Make PostgREST pick up the new columns and function immediately -------
NOTIFY pgrst, 'reload schema';
