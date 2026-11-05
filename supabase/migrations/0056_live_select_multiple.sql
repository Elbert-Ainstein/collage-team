-- Live questions: "select all that apply" (0056).
--
-- Run in Supabase → SQL Editor, after 0055. Safe to re-run.
--
-- A fourth kind of question, `multi`: the options of multiple choice, and an
-- answer that is a SET of them. Ellie's ask — "can you add select multiple to
-- live questions". It is checked all-or-nothing, the way Learning Catalytics
-- grades one: the set has to be exactly the key's, no partial credit for
-- getting three of four. A question worth part marks is two questions.
--
-- An answer is stored as its letters in order, "AC" — one spelling, like every
-- other kind (0047), so that in team mode "A and C" and "C and A" are the same
-- vote, and a try the team has had is a try it can't repeat. The key is the
-- indexes of the right options, live_keys.correct_options, beside
-- correct_option, which stays multiple choice's.
--
-- In team mode a select-multiple question is a TYPED question, not a
-- multiple-choice one: four options make fifteen answers, so "try every option"
-- would mean nothing, and a team may keep going for as long as it likes (0050)
-- and move on once another try is worth nothing. live_max_attempts and
-- move_team_on already read `kind = 'mc'` for the one-per-option rule, so they
-- need no change; this file says so where it matters.
--
-- What changes:
--   - live_questions.kind takes 'multi'.
--   - live_keys.correct_options, new: a jsonb array of option indexes.
--   - live_answer_fits: what a `multi` answer may look like.
--   - live_answer_correct: a `multi` answer is right when it is the key's set.
--     live_judge (0049) calls it, so a team is told at once, as for the rest.

-- ---------------------------------------------------------------- prereqs
do $$
declare missing text;
begin
  select string_agg(want.fn, ', ' order by want.fn)
    into missing
    from (values
      ('live_answer_fits(uuid, text)'),
      ('live_answer_correct(uuid, text, jsonb)'),
      ('live_judge(uuid, text, jsonb)'),
      ('live_max_attempts(uuid)'),
      ('move_team_on(uuid)')
    ) as want(fn)
   where to_regprocedure('public.' || want.fn) is null;

  if missing is not null then
    raise exception 'Missing helper functions (%) -- run 0047, 0049 and 0050 before this file.', missing;
  end if;
end $$;

-- ------------------------------------------------------------ the new kind
-- 0047 wrote the kind check inline, so Postgres named it. Find whichever check
-- on live_questions lists the kinds and replace it — by what it says, not by a
-- name a different database might not share. Re-running drops the one this
-- file added and adds it back.
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.live_questions'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ~* '\mkind\M'
       and pg_get_constraintdef(oid) ilike '%''mc''%'
       and pg_get_constraintdef(oid) ilike '%''expression''%'
  loop
    execute format('alter table public.live_questions drop constraint %I', c.conname);
  end loop;
end $$;

alter table live_questions
  add constraint live_questions_kind_check
  check (kind in ('mc', 'number', 'expression', 'multi'));

-- ------------------------------------------------------------------ the key
/**
 * Is this a key for select multiple: an array of distinct whole numbers from 0
 * to 7 (an index into at most eight options)? Empty is a key not yet set.
 * Called by the table's check, so it runs as whoever writes the key; it reads
 * nothing.
 */
create or replace function live_options_ok(opts jsonb) returns boolean
language plpgsql immutable set search_path = public as $$
begin
  if opts is null or jsonb_typeof(opts) <> 'array' or jsonb_array_length(opts) > 8 then
    return false;
  end if;
  return not exists (
           select 1 from jsonb_array_elements(opts) e
            where jsonb_typeof(e) <> 'number'
               or (e #>> '{}') !~ '^[0-7]$')
     and (select count(*) = count(distinct e #>> '{}') from jsonb_array_elements(opts) e);
end $$;

alter table live_keys add column if not exists correct_options jsonb not null default '[]'::jsonb;
alter table live_keys drop constraint if exists live_keys_correct_options_ok;
alter table live_keys add constraint live_keys_correct_options_ok check (live_options_ok(correct_options));

/** The key's set as an answer is spelled: its letters, in order — "AC". Null for an empty key. */
create or replace function live_multi_answer(opts jsonb) returns text
language sql immutable set search_path = public as $$
  select string_agg(chr(65 + i), '' order by i)
    from (select distinct (e #>> '{}')::int as i from jsonb_array_elements(opts) e) s;
$$;

-- ------------------------------------------------------------ the answers
/**
 * 0047's live_answer_fits, plus `multi`: letters in order with none repeated
 * (so one spelling per set, as the app writes it), at least one, and none past
 * the options the question has.
 */
create or replace function live_answer_fits(qid uuid, ans text) returns boolean
language sql stable security definer set search_path = public as $$
  select case q.kind
    when 'mc' then ans ~ '^[A-H]$' and ascii(ans) - 65 < jsonb_array_length(q.options)
    when 'multi' then ans ~ '^A?B?C?D?E?F?G?H?$' and length(ans) >= 1
                      and ascii(right(ans, 1)) - 65 < jsonb_array_length(q.options)
    when 'number' then ans ~ '^[-+]?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][-+]?[0-9]{1,3})?$'
    else length(btrim(ans)) between 1 and 120
  end
  from live_questions q where q.id = qid;
$$;

/**
 * 0047's live_answer_correct, plus `multi`: right when the answer is exactly
 * the key's set. Everything else as before (see score_live for `verdicts`).
 */
create or replace function live_answer_correct(qid uuid, ans text, verdicts jsonb) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  q live_questions;
  k live_keys;
  v text;
begin
  select * into q from live_questions where id = qid;
  select * into k from live_keys where question_id = qid;
  if q is null or k is null or ans is null then
    return false;
  end if;

  if q.kind = 'mc' then
    return k.correct_option is not null
       and upper(btrim(ans)) = chr(65 + k.correct_option);
  end if;

  if q.kind = 'multi' then
    return live_multi_answer(k.correct_options) is not null
       and upper(btrim(ans)) = live_multi_answer(k.correct_options);
  end if;

  if q.kind = 'number' then
    -- Exponent bounded so the cast can't overflow; and anything that still
    -- fails to cast is wrong, never an error that stops the whole scoring.
    if k.answer is null or btrim(ans) !~ '^[-+]?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][-+]?[0-9]{1,3})?$' then
      return false;
    end if;
    begin
      return abs(btrim(ans)::numeric - k.answer) <= coalesce(k.tolerance, 0);
    exception when others then
      return false;
    end;
  end if;

  -- expression
  v := verdicts -> (qid::text) ->> ans;
  if v in ('true', 'false') then
    return v::boolean;
  end if;
  return exists (
    select 1 from jsonb_array_elements_text(k.accept) a
     where replace(lower(a), ' ', '') = replace(lower(ans), ' ', ''));
end $$;

-- Who may call what (see 0047's note: Supabase grants new functions to anon
-- and authenticated by name, so everything is revoked from all three first).
-- live_options_ok runs inside the key's check, as the owner writing it, and
-- reads nothing: signed-in users keep it. live_multi_answer reads the key —
-- called only from live_answer_correct, as the owner, and by nobody else.
revoke all on function
  live_options_ok(jsonb), live_multi_answer(jsonb),
  live_answer_fits(uuid, text), live_answer_correct(uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function live_options_ok(jsonb) to authenticated;
