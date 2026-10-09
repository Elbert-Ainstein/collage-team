-- Step 3 of docs/checkin-teams-recovery.md — PREVIEW. Read-only.
--
-- What step 4 would write, and the evidence that the old teams loaded in step
-- 2 are the right ones. Run it and read every result before going on.

-- 3a. The weeks that will be restored.
select week, title, activity_id, frozen_at
  from recovery.affected
 order by week, title;

-- 3b. THE CHECK THAT MATTERS. Every presenter and every absence recorded on
-- those weeks was written while the person was on that team — the database
-- refused anything else (0016). So each one must be on that same team in the
-- old membership. Expect ZERO rows; step 4 refuses to run otherwise. A row
-- here means the loaded teams are not the ones those weeks ran with.
select a.week, a.title, t.name as team, s.name as student, 'presented, but is not on this team' as problem
  from tutorial_marks m
  join recovery.affected a on a.activity_id = m.activity_id
  join teams t on t.id = m.team_id
  join students s on s.id = m.presenter_id
 where not exists (
   select 1 from recovery.old_team_members o
    where o.team_id = m.team_id and o.student_id = m.presenter_id)
union all
select a.week, a.title, t.name, s.name, 'marked absent, but is not on this team'
  from tutorial_absences x
  join recovery.affected a on a.activity_id = x.activity_id
  join teams t on t.id = x.team_id
  join students s on s.id = x.student_id
 where not exists (
   select 1 from recovery.old_team_members o
    where o.team_id = x.team_id and o.student_id = x.student_id)
order by 1, 2, 3;

-- 3c. ...and how much evidence that was. A clean 3b over two presenters says
-- less than a clean 3b over forty.
select (select count(*) from tutorial_marks m join recovery.affected a using (activity_id)
         where m.presenter_id is not null) as presenters_checked,
       (select count(*) from tutorial_absences x join recovery.affected a using (activity_id))
         as absences_checked;

-- 3d. Students on the roster with no old team in the set those weeks used.
-- Someone who joined after the switch belongs here. Anyone else would vanish
-- from those weeks' sheets — and so from their scores — so find their team
-- before step 4.
select s.name, s.email, s.created_at as added_to_roster
  from students s
  join recovery.params p on p.course_id = s.course_id
 where not exists (
   select 1 from recovery.old_team_members o
     join teams t on t.id = o.team_id
    where o.student_id = s.id
      and t.team_set_id in (select team_set_id from recovery.affected))
 order by s.name;

-- 3e. A student on two old teams of one set. Expect zero rows: step 4 refuses
-- to guess between them.
select s.name, count(*) as teams
  from recovery.old_team_members o
  join teams t on t.id = o.team_id
  join students s on s.id = o.student_id
 where t.team_set_id in (select team_set_id from recovery.affected)
 group by s.id, s.name, t.team_set_id
having count(*) > 1;

-- 3f. Per week: how many students step 4 puts on a different team from the
-- one the sheet shows today. These are the people whose marks were credited
-- to the wrong team.
select a.week, a.title,
       count(*) filter (where cur.team_id is distinct from o.team_id) as students_moving,
       count(*) as students
  from recovery.affected a
  join teams t on t.team_set_id = a.team_set_id
  join recovery.old_team_members o on o.team_id = t.id
  left join activity_rosters cur
    on cur.activity_id = a.activity_id and cur.student_id = o.student_id
 group by a.week, a.title
 order by a.week, a.title;
