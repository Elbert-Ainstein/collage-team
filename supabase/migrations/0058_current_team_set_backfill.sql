-- The class's team set, recorded for courses whose first teams never said so (0058).
--
-- Run in Supabase → SQL Editor, after 0057. Safe to re-run.
--
-- 0045 added courses.current_team_set_id and backfilled it once, for the
-- courses that existed then. After that, a course's FIRST team set made by the
-- roster file import or by the assistant (targetSet, teamImport.ts) was created
-- without being recorded as the course's set. Every screen still showed the
-- teams — they fall back on a set by themselves (currentSetOf) — but
-- start_live_team reads the column and nothing else, so team mode refused with
-- "Form teams on the Teams page first" on a course that plainly had teams.
--
-- The app now records a set it creates. It does not record a set it merely
-- falls back on (a failed read looks the same as "nothing chosen", and writing
-- then could move a class off its real set), so this fills the column for the
-- courses already caught, with exactly the set the faculty app is showing them
-- — the first whole-session set, else the newest — so nothing on screen
-- changes. Only where it is unset, so a later choice is never undone.
--
-- On a database without this file those courses keep the old refusal; new
-- courses are fine either way.

update courses c
   set current_team_set_id = pick.id
  from (
    select distinct on (ts.course_id) ts.course_id, ts.id
      from team_sets ts
     order by ts.course_id,
              -- whole-session sets first, oldest first: sets.find(activity_id == null)
              (ts.activity_id is null) desc,
              case when ts.activity_id is null then ts.created_at end asc,
              case when ts.activity_id is null then ts.id end asc,
              -- otherwise the last set in (created_at, id) order: sets[sets.length - 1]
              ts.created_at desc,
              ts.id desc
  ) pick
 where pick.course_id = c.id and c.current_team_set_id is null;
