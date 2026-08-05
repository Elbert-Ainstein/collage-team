-- One total per activity, and questions that are only questions.
--
-- Run in Supabase → SQL Editor, after 0012. Safe to re-run.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS REPLACES.
--
-- An activity used to say "N questions worth P each", and its total was the
-- product. Faculty never think in that shape: they know what the activity is
-- out of, and separately what its questions are. So:
--
--   1. activities.points_total  -- what it is out of. One number, chosen.
--   2. activity_questions       -- "1", "2", "2a". Structure for the criteria,
--                                  carrying no points of their own.
--
-- question_count and points_per_question STAY on the row, unread. Dropping
-- them would break any client still running the previous build, and their
-- product is what this file backfills the new column from — so an activity
-- that was out of 50 is still out of 50 the moment this runs, with nothing to
-- re-enter by hand.
--
-- submission_marks is untouched: still one criterion per question_index, where
-- the index is the question's position. A criterion's deduction now comes off
-- the activity total rather than off one question's share of it.
-- ---------------------------------------------------------------------------

-- The add and the backfill are one step. Guarding on the column's existence
-- rather than on its value means re-running cannot overwrite a total someone
-- has since set by hand — including a deliberate zero.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'activities'
       and column_name = 'points_total')
  then
    alter table activities add column points_total numeric not null default 0;
    update activities set points_total = question_count * points_per_question;
  end if;
end $$;

alter table activities drop constraint if exists activities_points_total_nonneg;
alter table activities add constraint activities_points_total_nonneg
  check (points_total >= 0);

-- 0007 required question_count > 0, because back then it was a divisor. It is
-- now only a record of how many questions an activity USED to declare, read
-- once to write those questions down as rows — and an activity created since
-- this migration has none until someone writes one, which is zero.
alter table activities drop constraint if exists activities_question_shape;
alter table activities add constraint activities_question_shape
  check (question_count >= 0 and points_per_question >= 0);

comment on column activities.points_total is
  'What this activity is out of. Chosen by faculty; criteria deduct from it. Replaces question_count x points_per_question, which are left in place unread.';

-- ------------------------------------------------------------- questions

create table if not exists activity_questions (
  id          uuid primary key default gen_random_uuid(),
  activity_id uuid not null references activities(id) on delete cascade,
  -- What faculty call it: "1", "2", "2a". Free text, because a sub-question is
  -- a naming convention rather than a second table.
  label       text not null,
  -- Ordering, and the question_index submission_marks records against.
  position    int not null default 0,
  created_at  timestamptz not null default now(),
  unique (activity_id, label)
);

comment on table activity_questions is
  'The questions of an activity, in order. Deliberately carries no points: an activity has one total, and criteria deduct from it.';

create index if not exists idx_questions_activity
  on activity_questions (activity_id, position);

alter table activity_questions enable row level security;

-- Questions are authored by the instructor who owns the course.
drop policy if exists "own activity_questions" on activity_questions;
create policy "own activity_questions" on activity_questions
  for all to authenticated
  using (exists (select 1 from activities a where a.id = activity_questions.activity_id
                   and owns_course(a.course_id)))
  with check (exists (select 1 from activities a where a.id = activity_questions.activity_id
                   and owns_course(a.course_id)));

-- A TF marks question by question, so a TF reads them. Read only.
drop policy if exists "tf reads activity_questions" on activity_questions;
create policy "tf reads activity_questions" on activity_questions
  for select to authenticated
  using (exists (select 1 from activities a where a.id = activity_questions.activity_id
                   and a.course_id in (select my_tf_course_ids())));

-- A student sees the breakdown of work that has opened to them — the same
-- opens_at rule 0011 applies to the activity itself.
drop policy if exists "student reads open activity_questions" on activity_questions;
create policy "student reads open activity_questions" on activity_questions
  for select to authenticated
  using (exists (select 1 from activities a where a.id = activity_questions.activity_id
                   and a.course_id in (select my_course_ids())
                   and (a.opens_at is null or a.opens_at <= now())));

grant select, insert, update, delete on activity_questions to authenticated;

/**
 * Recompute one submission's score from its picked rubric rows.
 *
 * Unchanged except for where the TOTAL comes from: the activity's own
 * points_total, backfilled above from the product it replaces, so no mark
 * already recorded moves when this runs.
 */
create or replace function recompute_result_score(rid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  total numeric;
  taken numeric;
begin
  select a.points_total
    into total
    from check_in_results r
    join check_ins ci on ci.id = r.check_in_id
    join activities a on a.id = ci.activity_id
   where r.id = rid;

  if total is null then
    return;
  end if;

  select coalesce(sum(ri.deduction), 0)
    into taken
    from submission_marks m
    join rubric_items ri on ri.id = m.rubric_item_id
   where m.result_id = rid;

  update check_in_results
     set score = greatest(total - taken, 0),
         updated_at = now()
   where id = rid;
end $$;

-- Changing what an activity is out of changes every score already released
-- from it. Without this, re-pointing it after grading leaves marks that no
-- longer add up to what the gradebook shows.
create or replace function trg_activity_rescore() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if new.points_total is not distinct from old.points_total then
    return new;
  end if;
  for r in
    select res.id
      from check_in_results res
      join check_ins ci on ci.id = res.check_in_id
     where ci.activity_id = new.id
  loop
    perform recompute_result_score(r.id);
  end loop;
  return new;
end $$;

drop trigger if exists activity_points_rescore on activities;
create trigger activity_points_rescore
  after update of points_total on activities
  for each row execute function trg_activity_rescore();
