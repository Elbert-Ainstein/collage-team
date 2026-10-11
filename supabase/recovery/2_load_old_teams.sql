-- Step 2 of docs/checkin-teams-recovery.md — LOAD the old teams.
--
-- Makes a private `recovery` schema (not exposed to the app's API), says which
-- course and which weeks to restore, and holds who was on which team before
-- the switch. Step 5 drops it all again.
--
-- Fill in the two marked places, then run the whole file.

create schema if not exists recovery;

-- Which course, and the LAST week that ran on the old teams. Everything with
-- something recorded in that course up to and including that week is restored.
-- One row per course: both sessions can be restored in one go.
create table if not exists recovery.params (
  course_id     uuid primary key,
  last_old_week int  not null
);

-- When the teams were switched. Only activities whose teams were frozen BEFORE
-- this are restored, so a week with a Tuesday on the old teams and a Thursday
-- on the new ones restores the Tuesday and leaves the Thursday alone. Null
-- means "every week up to last_old_week".
alter table recovery.params add column if not exists switched_at timestamptz;

-- Who was on which team before the switch — by row id, exactly as the
-- database had it.
create table if not exists recovery.old_team_members (
  team_id    uuid not null,
  student_id uuid not null,
  primary key (team_id, student_id)
);

-- The same, from a spreadsheet instead of a backup: an email and a team name
-- ("Team 3") or number ("3"). Resolved into old_team_members below.
create table if not exists recovery.old_teams_by_email (
  course_id uuid not null,
  email     text not null,
  team      text not null
);

-- ======================================================== 1. FILL IN: course
-- From step 1a and 1c, and when the switch happened (with its time zone).
-- Example:
--   insert into recovery.params values
--     ('00000000-0000-0000-0000-000000000000', 6, '2026-10-07 18:00 America/Chicago')
--   on conflict (course_id) do update
--     set last_old_week = excluded.last_old_week, switched_at = excluded.switched_at;


-- ===================================================== 2. FILL IN: old teams
-- EITHER (best) paste the INSERT that 0_on_the_backup_copy.sql returned on the
-- restored copy (or the output of extract_team_members.sh on a downloaded
-- backup) here — one INSERT into recovery.old_team_members, every course's rows.
--
-- OR, from Kelly's spreadsheet's previous-team column:
--   insert into recovery.old_teams_by_email (course_id, email, team) values
--     ('<course id>', 'ada@college.edu', '3'),
--     ('<course id>', 'alan@college.edu', 'Team 5');


-- ------------------------------------------------ spreadsheet rows → team ids
-- A number means "Team N". Matched to the teams of the set each course's old
-- weeks were frozen with, by name, ignoring case — the assistant kept every
-- team's name when it moved students between them.
insert into recovery.old_team_members (team_id, student_id)
select t.id, s.id
  from recovery.old_teams_by_email x
  join students s
    on s.course_id = x.course_id and lower(trim(s.email)) = lower(trim(x.email))
  join teams t
    on lower(t.name) = lower(case when trim(x.team) ~ '^[0-9]+$'
                                  then 'Team ' || trim(x.team)
                                  else trim(x.team) end)
  join team_sets ts
    on ts.id = t.team_set_id and ts.course_id = x.course_id
 where ts.id in (
   select t2.team_set_id
     from activity_rosters r
     join teams t2 on t2.id = r.team_id
     join activities a on a.id = r.activity_id
     join recovery.params p on p.course_id = a.course_id
    where a.week <= p.last_old_week)
on conflict do nothing;

-- Spreadsheet rows that matched nobody, or no team. Fix the row and re-run.
select x.email, x.team,
       case when s.id is null then 'no student on this course has that email'
            else 'no team of that name in the set the old weeks used' end as problem
  from recovery.old_teams_by_email x
  left join students s
    on s.course_id = x.course_id and lower(trim(s.email)) = lower(trim(x.email))
 where not exists (
   select 1 from recovery.old_team_members o where o.student_id = s.id);

-- ------------------------------------------------------ the weeks to restore
-- Every activity in the course up to the last old week that 0045 froze —
-- which is every one with something recorded on it — with the set it was
-- frozen from and when. Steps 3 and 4 read this, so both mean the same weeks.
create or replace view recovery.affected as
select a.id as activity_id,
       a.course_id,
       a.week,
       a.title,
       (select t.team_set_id from activity_rosters r join teams t on t.id = r.team_id
         where r.activity_id = a.id limit 1) as team_set_id,
       (select min(r.frozen_at) from activity_rosters r where r.activity_id = a.id) as frozen_at
  from activities a
  join recovery.params p on p.course_id = a.course_id
 where a.week is not null
   and a.week <= p.last_old_week
   and exists (select 1 from activity_rosters r where r.activity_id = a.id)
   and (p.switched_at is null
        or (select min(r.frozen_at) from activity_rosters r where r.activity_id = a.id)
           < p.switched_at);

-- How many old memberships were loaded, per course. Zero means step 2's
-- second fill-in is still empty.
select ts.course_id, count(*) as old_memberships
  from recovery.old_team_members o
  join teams t on t.id = o.team_id
  join team_sets ts on ts.id = t.team_set_id
 group by ts.course_id;
