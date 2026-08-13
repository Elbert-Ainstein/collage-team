-- Clearing a finished course's artifacts.
--
-- Run in Supabase → SQL Editor, after 0026. Safe to re-run.
--
-- A finished year leaves ~22 GB of recordings, handed-in PDFs and whiteboard
-- photos that nobody will open again. The grades are not part of that:
-- check_in_results keeps every written answer, score, piece of feedback and CI
-- flag, and submission_marks, check_in_marks, tutorial_marks and
-- tutorial_absences are untouched. Only the objects and the rows that name them
-- go.
--
-- `activity-files` is NOT in that set and never will be. It holds the
-- instructor's own assignment document — the thing they reuse next year, and
-- kilobytes of it.
--
-- Nothing here schedules anything: no cron, no pg_cron, no job. A person opens
-- the screen and presses the button, every time. The retention policy for this
-- material has not been confirmed yet, so nothing may go without someone
-- choosing it in the moment.

-- ----------------------------------------------------------------- the record
-- When the media went, so the screen can say so and stop offering it again.
-- Nullable and never backfilled: a course that has not been cleared has no date.
alter table courses add column if not exists artifacts_cleared_at timestamptz;

-- No policy is added for it, deliberately. 0003's "own courses" is FOR ALL with
-- `owner_id = auth.uid()` on both USING and WITH CHECK, so the owner can already
-- update their own course row, and 0010 granted UPDATE on courses to
-- authenticated. A second policy here would be a second answer to who owns a
-- course, and the two would drift.

-- ------------------------------------------------ let the owner clear the map
-- submission_pages is which page answers which question. There is no object
-- behind it, but it is meaningless once the pdf it points into is gone, so the
-- sweep takes it with the submission_files rows.
--
-- 0015's delete policy would not allow that. It reads
--
--     can_remove_result_audio(result_id)
--     and not exists (... r.status = 'scored')
--
-- and that guard is right for the student it was written for: once work has been
-- marked, re-pointing its pages would move what a marker already looked at. But
-- by July nearly every submission IS scored, so the course owner — who may
-- delete the pdf itself, and the submission_files row that names it — could not
-- delete the mapping. And a delete that RLS filters out affects no rows and
-- returns NO error, so the sweep would report success and leave the mapping
-- behind, pointing into a pdf that no longer exists.
--
-- So: the owner's branch of can_remove_result_audio, lifted out and exempted
-- from the scored guard. The student's branch is unchanged — still theirs to
-- clear only while their work is still open. Nothing here widens who can READ
-- anything, and nothing here lets anyone touch check_in_results.
drop policy if exists "clear submission_pages" on submission_pages;
create policy "clear submission_pages" on submission_pages
  for delete to authenticated
  using (
    exists (
      select 1 from check_in_results r
       where r.id = submission_pages.result_id
         and owns_check_in(r.check_in_id))
    or (
      can_remove_result_audio(submission_pages.result_id)
      and not exists (
        select 1 from check_in_results r
         where r.id = submission_pages.result_id and r.status = 'scored')
    )
  );
