-- Questions become rows, written on the rubric page.
--
-- Run in Supabase → SQL Editor, after 0012. Safe to re-run.
--
-- ---------------------------------------------------------------------------
-- WHAT MOVES, AND WHAT DELIBERATELY DOES NOT.
--
-- Until now an activity's questions were a COUNT: `question_count` questions,
-- each worth `points_per_question`, and the total was the product. That shape
-- cannot express "question 2 is worth 10 and has sub-questions 2a and 2b", so
-- the questions become rows that faculty add on the rubric page, each carrying
-- its own points.
--
-- The old columns STAY, and are still what scores an activity that has no rows
-- here. Every activity in the running course has a count and no rows, so
-- reading the sum unconditionally would score every one of them out of zero.
-- The rule is: rows if there are any, the product otherwise.
--
-- submission_marks is untouched: still one picked criterion per question_index,
-- where question_index is the question's POSITION. Letting a marker pick
-- several criteria per question is a change to grading and to the score
-- function, and mixing it into this one would make a scoring bug and an
-- authoring bug look identical.
-- ---------------------------------------------------------------------------

create table if not exists activity_questions (
  id          uuid primary key default gen_random_uuid(),
  activity_id uuid not null references activities(id) on delete cascade,
  -- What faculty call it: "1", "2", "2a". Free text, because a sub-question is
  -- a naming convention rather than a second table.
  label       text not null,
  points      numeric not null default 1 check (points >= 0),
  -- Ordering, and the question_index submission_marks records against.
  position    int not null default 0,
  created_at  timestamptz not null default now(),
  unique (activity_id, label)
);

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
 * Unchanged except for where the TOTAL comes from: the sum of this activity's
 * questions when it has any, and the old count x points product when it has
 * none. Deductions are read exactly as before, so re-running this file cannot
 * move a mark that was already recorded.
 */
create or replace function recompute_result_score(rid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  total numeric;
  taken numeric;
begin
  select coalesce(
           (select sum(q.points) from activity_questions q where q.activity_id = a.id),
           a.question_count * a.points_per_question)
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

-- Changing a question's points changes what every submission against it is out
-- of, so the marks already recorded have to be recomputed. Without this, a
-- question re-pointed after grading leaves scores that no longer add up.
create or replace function trg_questions_rescore() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  aid uuid := coalesce(new.activity_id, old.activity_id);
  r record;
begin
  for r in
    select res.id
      from check_in_results res
      join check_ins ci on ci.id = res.check_in_id
     where ci.activity_id = aid
  loop
    perform recompute_result_score(r.id);
  end loop;
  return coalesce(new, old);
end $$;

drop trigger if exists questions_rescore on activity_questions;
create trigger questions_rescore
  after insert or update or delete on activity_questions
  for each row execute function trg_questions_rescore();
