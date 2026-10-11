-- Step 4 of docs/checkin-teams-recovery.md — APPLY.
--
-- Replaces who was on which team for the weeks in recovery.affected with the
-- old teams from step 2. One transaction: it all lands or none of it does.
-- What was there before is kept in recovery.replaced_rosters, and the undo at
-- the bottom puts it back.
--
-- It refuses — and changes nothing — when any check in step 3 would fail.

begin;

create temp table restore_rows on commit drop as
select a.activity_id, o.team_id, o.student_id, coalesce(a.frozen_at, now()) as frozen_at
  from recovery.affected a
  join teams t on t.team_set_id = a.team_set_id
  join recovery.old_team_members o on o.team_id = t.id
  join students s on s.id = o.student_id and s.course_id = a.course_id;

do $$
begin
  if not exists (select 1 from recovery.affected) then
    raise exception 'No weeks to restore: check recovery.params (step 2).';
  end if;
  if exists (
    select 1 from recovery.affected a
     where not exists (select 1 from restore_rows r where r.activity_id = a.activity_id))
  then
    raise exception 'A week has no old teams loaded for its team set (step 3a/3d).';
  end if;
  if exists (
    select 1 from restore_rows group by activity_id, student_id having count(*) > 1)
  then
    raise exception 'A student is on two old teams of one set (step 3e).';
  end if;
  if exists (
       select 1 from tutorial_marks m
         join recovery.affected a on a.activity_id = m.activity_id
        where m.presenter_id is not null
          and not exists (select 1 from restore_rows r
                           where r.activity_id = m.activity_id and r.team_id = m.team_id
                             and r.student_id = m.presenter_id))
     or exists (
       select 1 from tutorial_absences x
         join recovery.affected a on a.activity_id = x.activity_id
        where not exists (select 1 from restore_rows r
                           where r.activity_id = x.activity_id and r.team_id = x.team_id
                             and r.student_id = x.student_id))
  then
    raise exception 'A recorded presenter or absence disagrees with the old teams (step 3b).';
  end if;
end $$;

create table if not exists recovery.replaced_rosters as
select * from activity_rosters where false;

-- Only the latest apply is kept for undo: running this twice must not stack
-- two copies that the undo would then try to put back on top of each other.
truncate recovery.replaced_rosters;
insert into recovery.replaced_rosters
select r.* from activity_rosters r
 where r.activity_id in (select activity_id from recovery.affected);

delete from activity_rosters
 where activity_id in (select activity_id from recovery.affected);

insert into activity_rosters (activity_id, team_id, student_id, frozen_at)
select activity_id, team_id, student_id, frozen_at from restore_rows;

-- What landed, per week. Compare with step 3f.
select a.week, a.title, count(r.*) as students_restored
  from recovery.affected a
  left join activity_rosters r on r.activity_id = a.activity_id
 group by a.week, a.title
 order by a.week, a.title;

commit;

-- -------------------------------------------------------------------- undo
-- Puts back exactly what step 4 replaced. Only if something is wrong — select
-- these lines and run them on their own.
--
-- begin;
-- delete from activity_rosters
--  where activity_id in (select distinct activity_id from recovery.replaced_rosters);
-- insert into activity_rosters select * from recovery.replaced_rosters;
-- commit;
