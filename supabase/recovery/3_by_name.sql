-- Steps 4 and 6 of docs/checkin-teams-recovery.md — preview, then check, by name.
-- Read-only. One table, read top to bottom by "section". Run it before step 4
-- to see what will change, and again after it: every RESTORE row should then
-- say 0 students change team, and each team's two lists should match.

with moving as (
  select a.activity_id,
         count(*) filter (where cur.team_id is distinct from o.team_id) as moving,
         count(*) as students
    from recovery.affected a
    join teams t on t.team_set_id = a.team_set_id
    join recovery.old_team_members o on o.team_id = t.id
    join students s on s.id = o.student_id and s.course_id = a.course_id
    left join activity_rosters cur
      on cur.activity_id = a.activity_id and cur.student_id = o.student_id
   group by a.activity_id
),
last_old as (
  select distinct on (course_id) * from recovery.affected order by course_id, frozen_at desc
)
-- 1. Check-ins that go back to the old teams.
select '1 RESTORE TO OLD TEAMS' as section, a.week, a.title, null::text as team, null::text as students,
       'first recorded ' || to_char(a.frozen_at at time zone 'America/Chicago', 'Dy Mon DD HH12:MI AM')
       || ' · ' || coalesce(m.moving, 0) || ' of ' || coalesce(m.students, 0) || ' students change team' as detail,
       0 as ord
  from recovery.affected a left join moving m using (activity_id)
union all
-- 2. Check-ins that keep today's teams.
select '2 KEEPS TODAY''S TEAMS', a.week, a.title, null, null,
       'first recorded ' || to_char(min(r.frozen_at) at time zone 'America/Chicago', 'Dy Mon DD HH12:MI AM'),
       0
  from activities a
  join recovery.params p on p.course_id = a.course_id
  join activity_rosters r on r.activity_id = a.id
 where a.id not in (select activity_id from recovery.affected)
 group by a.id, a.week, a.title
union all
-- 3. Must be empty: a presenter or absence that disagrees with the old teams.
select '3 PROBLEM', a.week, a.title, t.name, s.name, 'presented, but was not on this team in the backup', 0
  from tutorial_marks m
  join recovery.affected a on a.activity_id = m.activity_id
  join teams t on t.id = m.team_id
  join students s on s.id = m.presenter_id
 where not exists (select 1 from recovery.old_team_members o
                    where o.team_id = m.team_id and o.student_id = m.presenter_id)
union all
select '3 PROBLEM', a.week, a.title, t.name, s.name, 'marked absent, but was not on this team in the backup', 0
  from tutorial_absences x
  join recovery.affected a on a.activity_id = x.activity_id
  join teams t on t.id = x.team_id
  join students s on s.id = x.student_id
 where not exists (select 1 from recovery.old_team_members o
                    where o.team_id = x.team_id and o.student_id = x.student_id)
union all
-- 4. On the roster today with no team in the backup (joined after it).
select '4 NO OLD TEAM', null, null, null, s.name,
       'added to the roster ' || to_char(s.created_at at time zone 'America/Chicago', 'Dy Mon DD'), 0
  from students s
  join recovery.params p on p.course_id = s.course_id
 where not exists (select 1 from recovery.old_team_members o where o.student_id = s.id)
union all
-- 5. The last restored sheet, team by team, by name.
select '5 BY NAME: ' || l.title, l.week, l.title, t.name,
       coalesce((select string_agg(s.name, ', ' order by s.name)
                   from recovery.old_team_members o join students s on s.id = o.student_id
                  where o.team_id = t.id), '—'),
       'sheet shows today: ' || coalesce((select string_agg(s.name, ', ' order by s.name)
                   from activity_rosters r join students s on s.id = r.student_id
                  where r.activity_id = l.activity_id and r.team_id = t.id), '—'),
       t.position
  from last_old l
  join teams t on t.team_set_id = l.team_set_id
order by section, week nulls first, title, ord, team;
