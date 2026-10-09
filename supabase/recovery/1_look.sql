-- Step 1 of docs/checkin-teams-recovery.md — LOOK. Read-only.
--
-- Paste into Supabase → SQL Editor and run. Writes nothing. Needs 0045.
--
-- Three answers: which course, which team sets it has (and which one the app
-- now uses), and which weeks have check-in work recorded — with when, so the
-- weeks run on the OLD teams can be told from the ones run on the new.

-- 1a. Courses. Copy the id of the one to restore.
select c.id as course_id, c.code, c.name, c.term, c.current_team_set_id
  from courses c
 order by c.code, c.created_at;

-- 1b. Team sets per course. A set made with "+ New set" around the day the
-- teams were switched shows here — its created_at is the best record of WHEN
-- the switch happened. "recorded" counts marks, absences and team hand-ins on
-- its teams: a set with 0 there holds nothing anybody would lose.
select ts.course_id,
       ts.id as team_set_id,
       ts.name,
       ts.created_at,
       (ts.id = c.current_team_set_id) as is_current,
       (select count(*) from teams t where t.team_set_id = ts.id) as teams,
       (select count(*) from teams t join team_members tm on tm.team_id = t.id
         where t.team_set_id = ts.id) as members,
       (select count(*) from teams t join tutorial_marks m on m.team_id = t.id
         where t.team_set_id = ts.id)
     + (select count(*) from teams t join tutorial_absences x on x.team_id = t.id
         where t.team_set_id = ts.id)
     + (select count(*) from teams t join check_in_results r on r.team_id = t.id
         where t.team_set_id = ts.id and r.status not in ('none', 'draft')) as recorded
  from team_sets ts
  join courses c on c.id = ts.course_id
 order by ts.course_id, ts.created_at;

-- 1c. Every activity with something recorded, oldest week first: when its
-- first and last record were made, and whether 0045 froze its teams. The
-- weeks whose records all predate the switch are the ones step 4 restores.
select a.course_id,
       a.week,
       a.title,
       a.id as activity_id,
       min(e.at) as first_recorded,
       max(e.at) as last_recorded,
       (select count(*) from activity_rosters r where r.activity_id = a.id) as frozen_rows
  from activities a
  join (
    select activity_id, updated_at as at from tutorial_marks
    union all
    select activity_id, created_at from tutorial_absences
    union all
    select c.activity_id, coalesce(r.submitted_at, r.updated_at)
      from check_in_results r join check_ins c on c.id = r.check_in_id
     where r.subject_type = 'team' and r.status not in ('none', 'draft')
  ) e on e.activity_id = a.id
 group by a.id
 order by a.course_id, a.week nulls last, a.position;
