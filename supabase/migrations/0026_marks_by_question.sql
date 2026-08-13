-- A mark belongs to a QUESTION, not to a position in a list.
--
-- Run in Supabase → SQL Editor, after 0025. Safe to re-run.
--
-- ---------------------------------------------------------------------------
-- WHAT WAS WRONG.
--
-- submission_marks.question_index is an ordinal: 0007 wrote it as "which
-- question of this submission", and 0014 made questions rows of their own with
-- activity_questions.position as the number it refers to. Positions are
-- renumbered whenever a question is added or deleted (facultyData.renumber),
-- and nothing renumbered the marks. So deleting question 1 halfway through
-- grading moved every mark below it onto a different question:
--
--   * a mark could disappear from the grading screen, because the criteria it
--     was picked from are filtered by the question's LABEL, while still being
--     subtracted from the score;
--   * a TF re-marking the question it landed on INSERTed a second row rather
--     than replacing it, and the trigger took both deductions off;
--   * a mark picked from the shared ladder (rubric_items with no
--     question_label) stayed perfectly plausible under its new question, which
--     is the case nobody would ever have caught.
--
-- The fix is identity: question_id, with ON DELETE CASCADE. That cascade is
-- the actual semantic change here — deleting a question now takes its marks
-- with it instead of sliding them sideways onto the question that inherits its
-- position.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS DELIBERATELY DOES NOT DO.
--
-- question_index stays, and stays written. It carries live grades: if the
-- backfill below matched a mark to the wrong question, that column is the only
-- record of what the mark used to point at and the only way back. Dropping it
-- in the same migration that adds its replacement would destroy the evidence
-- needed to check the replacement. A later migration can drop it once the
-- grades have been looked at.
--
-- question_id is NULLABLE, for two reasons. An activity with no
-- activity_questions rows is still gradeable: the grading screen synthesises
-- one question per legacy question_count, and a synthesised question has no
-- row and therefore no id to point at. Those marks keep being keyed by
-- position, which is safe precisely because an activity with no question rows
-- has nothing to renumber. And a mark whose index no longer matches any
-- question — one already stranded by an earlier delete — is left null rather
-- than guessed at; it still counts against the score exactly as it did
-- yesterday, and it is now findable with `where question_id is null`.
-- ---------------------------------------------------------------------------

alter table submission_marks add column if not exists question_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'submission_marks'::regclass
       and conname = 'submission_marks_question_id_fkey')
  then
    alter table submission_marks
      add constraint submission_marks_question_id_fkey
      foreign key (question_id) references activity_questions(id) on delete cascade;
  end if;
end $$;

comment on column submission_marks.question_id is
  'Which question this mark is against. Null only for a mark on an activity with no activity_questions rows, or one stranded by a delete that predates 0026 — question_index is the fallback for those.';

-- The cascade above deletes by this column, and without an index that is a
-- sequential scan of every mark on the course for each question removed.
create index if not exists idx_marks_question on submission_marks (question_id);

-- ------------------------------------------------------------- the backfill
--
-- The join is the whole risk in this file: a mark reaches its activity only
-- through its result's check-in, and matching against the wrong activity's
-- questions would rewrite real grades with nothing to show for it.
--
--   submission_marks -> check_in_results -> check_ins -> activities
--                                                     -> activity_questions
--
-- `distinct on` is not decoration. position carries no unique constraint —
-- only (activity_id, label) does — so a half-finished renumber can leave two
-- questions on one position, and without it the row Postgres picked would be
-- arbitrary. Oldest, then by id, is at least the same answer every time this
-- runs.
--
-- Only rows that still have no question_id are touched, so re-running this is
-- a no-op rather than a second pass over grades somebody may have corrected by
-- hand since. Every row it does touch fires 0007's rescore trigger; that
-- recomputes the same score from the same marks, because writing question_id
-- changes nothing the sum reads.
--
-- Which is also why re-running the whole file is the fix for the one gap the
-- app cannot close: a mark made in the seconds between this running and
-- PostgREST noticing the new column falls back to the old index-only write
-- (facultyData.setMark), and lands here with question_id null. Run it again
-- and those rows get keyed like the rest.
update submission_marks m
   set question_id = src.question_id
  from (
    select distinct on (mk.id)
           mk.id as mark_id,
           q.id  as question_id
      from submission_marks mk
      join check_in_results r  on r.id = mk.result_id
      join check_ins ci        on ci.id = r.check_in_id
      join activities a        on a.id = ci.activity_id
      join activity_questions q on q.activity_id = a.id
                              and q.position = mk.question_index
     where mk.question_id is null
     order by mk.id, q.created_at, q.id
  ) src
 where m.id = src.mark_id;

-- --------------------------------------------------------- the unique key
--
-- 0007's `unique (result_id, question_index)` has to GO, not merely be joined
-- by a second key. Once marks are keyed by identity, a stale index is expected:
-- a mark on the question that used to be second keeps index 1 while the
-- question now sitting there is marked as index 1 too, and the old constraint
-- would refuse that insert — grading would simply stop working on any activity
-- whose questions had ever been reordered.
--
-- Dropped by name and, in case a project's table was created by hand under
-- another one, by looking for any unique constraint on exactly those two
-- columns.
alter table submission_marks
  drop constraint if exists submission_marks_result_id_question_index_key;

do $$
declare c record;
begin
  for c in
    select con.conname
      from pg_constraint con
     where con.conrelid = 'submission_marks'::regclass
       and con.contype = 'u'
       and con.conkey @> array[
             (select attnum from pg_attribute
               where attrelid = 'submission_marks'::regclass and attname = 'question_index')]
  loop
    execute format('alter table submission_marks drop constraint %I', c.conname);
  end loop;
end $$;

-- Two partial indexes rather than one constraint, because a row is unique
-- under whichever key it is actually filed by, and neither of these can fail
-- on data that is already here:
--
--   * rows WITH a question_id came from the backfill, which maps one index to
--     one question, so two marks on one result can only share a question if
--     they already shared an index — which the constraint just dropped made
--     impossible;
--   * rows WITHOUT one are exactly the set that constraint was covering, and
--     it held.
--
-- A plain unique on (result_id, question_id) would also have accepted any
-- number of null-question rows per result, since nulls never collide — the
-- second index is what keeps the synthesised-question path from accumulating
-- duplicates that each take their own deduction off the score.
create unique index if not exists uniq_marks_result_question
  on submission_marks (result_id, question_id)
  where question_id is not null;

create unique index if not exists uniq_marks_result_index
  on submission_marks (result_id, question_index)
  where question_id is null;

-- ------------------------------------------------------------- the rescore
--
-- Checked rather than assumed, because the answer decides whether a stored
-- score is left too low after a question is deleted: an ON DELETE CASCADE is
-- performed as an ordinary DELETE on the referencing table, so the row-level
-- AFTER DELETE trigger 0007 put on submission_marks does fire for every mark
-- the cascade removes, and recompute_result_score gives back the points that
-- mark was deducting. Nothing to fix here — the trigger below is restated
-- verbatim so that a project which somehow lost it ends up with it, and so
-- that this file says out loud which trigger the cascade depends on. Drop that
-- trigger and deleting a question silently under-scores everyone marked on it.
drop trigger if exists trg_submission_marks_rescore on submission_marks;
create trigger trg_submission_marks_rescore
  after insert or update or delete on submission_marks
  for each row execute function trg_marks_rescore();
