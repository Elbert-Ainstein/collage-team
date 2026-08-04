-- Per-question grading criteria, and somewhere to keep the assignment PDF.
--
-- Run in Supabase → SQL Editor, after 0011. Safe to re-run.
--
-- ---------------------------------------------------------------------------
-- TWO ADDITIVE CHANGES. Nothing here narrows an existing rule.
--
--   1. rubric_items.question_label  -- which question a criterion belongs to.
--      NULL means "every question", which is what every existing row means:
--      the ladder written by 0007 is one shared list applied to whichever
--      question is being marked. Reading NULL as "belongs to no question" would
--      empty the ladder on every activity already being graded.
--
--   2. a private `activity-files` storage bucket for the source document the
--      criteria are written against. Objects are named `<activity_id>/<file>`,
--      and every policy below reads that first path segment — an object stored
--      under any other shape is reachable by nobody.
--
-- submission_marks is deliberately untouched. It still records ONE picked row
-- per question, and recompute_result_score still subtracts exactly those. A
-- question owning several criteria is about how the ladder is WRITTEN; letting
-- a marker pick several at once is a separate change to grading and its score
-- function, and doing both at once would make a scoring bug indistinguishable
-- from an authoring one.
-- ---------------------------------------------------------------------------

alter table rubric_items add column if not exists question_label text;

comment on column rubric_items.question_label is
  'Which question/sub-question this criterion belongs to, e.g. "1" or "2b". NULL applies to every question — that is what the pre-0012 shared ladder means.';

-- Grading reads a whole activity's ladder and groups it in memory; the ordering
-- index from 0007 already covers that. This one serves the builder, which asks
-- for one question at a time.
create index if not exists idx_rubric_activity_question
  on rubric_items (activity_id, question_label, row_index);

-- ------------------------------------------------------------------ storage

-- Private. Every read below goes through a signed URL minted for someone a
-- policy has already let in.
insert into storage.buckets (id, name, public)
values ('activity-files', 'activity-files', false)
on conflict (id) do nothing;

/**
 * The activity an object belongs to, or NULL if it is not named for one.
 *
 * The cast is guarded: `split_part` on a name with no slash returns the whole
 * string, and casting that to uuid would raise rather than simply refuse the
 * row — which inside a policy means an error instead of a denial.
 */
create or replace function activity_of_object(object_name text) returns uuid
language sql immutable set search_path = public as $$
  select case
    when object_name ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/'
    then split_part(object_name, '/', 1)::uuid
  end
$$;

-- The instructor who owns the course owns its files: upload, replace, remove.
drop policy if exists "owner writes activity files" on storage.objects;
create policy "owner writes activity files" on storage.objects
  for all to authenticated
  using (
    bucket_id = 'activity-files'
    and exists (
      select 1 from activities a
        join courses c on c.id = a.course_id
       where a.id = activity_of_object(storage.objects.name)
         and c.owner_id = auth.uid())
  )
  with check (
    bucket_id = 'activity-files'
    and exists (
      select 1 from activities a
        join courses c on c.id = a.course_id
       where a.id = activity_of_object(storage.objects.name)
         and c.owner_id = auth.uid())
  );

-- A TF marks against the document, so a TF reads it. Read only: the criteria
-- and the source they are written against are the instructor's.
drop policy if exists "tf reads activity files" on storage.objects;
create policy "tf reads activity files" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'activity-files'
    and exists (
      select 1 from activities a
       where a.id = activity_of_object(storage.objects.name)
         and a.course_id in (select my_tf_course_ids()))
  );

-- A student on the course reads it once the activity has opened — the same
-- opens_at rule 0011 put on the activity row itself, repeated here because a
-- storage object is not covered by the policy on the table that names it.
drop policy if exists "student reads open activity files" on storage.objects;
create policy "student reads open activity files" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'activity-files'
    and exists (
      select 1 from activities a
       where a.id = activity_of_object(storage.objects.name)
         and a.course_id in (select my_course_ids())
         and (a.opens_at is null or a.opens_at <= now()))
  );
