-- A week can be called something.
--
-- Run in Supabase → SQL Editor, after 0032. Safe to re-run.
--
-- course_weeks has carried `dates_label` since 0007 — "Feb 17-21", the range
-- under the heading — but the heading itself was always "Week N", built from
-- the number in code. A course that runs in units rather than weeks, or a demo
-- that wants "Momentum" over the top of it, had nowhere to put that.
--
-- Nullable, and the number stays the source of ORDER. A title is what the week
-- is called; `week` is still where it sits, still what activities point at, and
-- still what makes (course_id, week) unique. Renaming one cannot reorder
-- anything, which is the property that makes this safe to add to a live course.

alter table course_weeks add column if not exists title text;

comment on column course_weeks.title is
  'What this week is called, when "Week N" is not it. Null means use the number.';
