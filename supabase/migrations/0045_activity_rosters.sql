-- 0045: every activity keeps the teams it was run with.
--
-- Run in Supabase → SQL Editor, after 0044. Safe to re-run.
--
-- THE BUG. A check-in mark is written against a TEAM ROW (tutorial_marks.team_id)
-- and scored against whoever is on that row — studentMarks() reads the team's
-- members at the moment it is asked. Nothing recorded who was on the row on the
-- day. So when Kelly re-formed the class mid-term, the assistant moved students
-- between the existing rows (seating.ts keeps rows so their files survive), and
-- every earlier week's marks were silently re-credited to the new members: the
-- week 3 sheet, the student cards and the week 3 export all read the week 7
-- teams. The rows themselves were never deleted; who they belonged to was lost.
--
-- THE FIX. An activity's teams are frozen the first time anything is recorded
-- against them — a sheet mark, an absence, or a team hand-in — and read back
-- from here ever after:
--
--   activity_rosters   one row per student: on this activity, they were on this team
--
-- Frozen by the DATABASE, in a trigger, rather than by the app: every path that
-- records a mark (two TFs on two iPads, an old tab, a future screen) freezes the
-- same way, and none can forget to. The whole set is frozen at once — the room
-- as it stood when the first thing was written — so a team marked late in the
-- session is still the team that was there.
--
-- NOT frozen on a DRAFT. Opening the Team tab of an activity creates an empty
-- draft row for the recorder (ensureTeamResult), and students open next week's
-- activity early; freezing on that would pin next week to this week's teams.
--
-- ALSO HERE: courses.current_team_set_id — which team set the class is using
-- now. Before this, the faculty app took the FIRST whole-session set and the
-- student app took whichever membership row Postgres returned first, so a
-- second set made with "+ New set" was invisible to the assistant and the
-- check-in sheet while students could land on either. One answer, stored.

-- ------------------------------------------------------------------ helpers
-- (activity_course and tutorial_team_fits are 0016's.)
create or replace function check_in_activity(cid uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select activity_id from check_ins where id = cid;
$$;

grant execute on function check_in_activity(uuid) to authenticated;

-- ------------------------------------------------------------------- table
create table if not exists activity_rosters (
  activity_id uuid not null references activities(id) on delete cascade,
  team_id     uuid not null references teams(id) on delete cascade,
  student_id  uuid not null references students(id) on delete cascade,
  /** When this was frozen — the first thing recorded on the activity. */
  frozen_at   timestamptz not null default now(),
  -- One team per student per activity. A student on two teams of one set is a
  -- data error, and freezing it would put them in the room twice.
  primary key (activity_id, student_id)
);

create index if not exists idx_activity_rosters_team on activity_rosters (team_id);
create index if not exists idx_activity_rosters_student on activity_rosters (student_id);

-- Nothing in the policies below says the team and the student belong to the
-- activity's course. Only definer functions write here, but the recovery
-- script (supabase/recovery/) is pasted by hand, and that is exactly when a
-- wrong id goes in.
create or replace function guard_activity_roster() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not tutorial_team_fits(new.activity_id, new.team_id) then
    raise exception 'That team is not in this activity''s course';
  end if;
  if not exists (
    select 1 from students s
     where s.id = new.student_id and s.course_id = activity_course(new.activity_id))
  then
    raise exception 'That student is not on this activity''s course';
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_activity_rosters on activity_rosters;
create trigger trg_guard_activity_rosters
  before insert or update on activity_rosters
  for each row execute function guard_activity_roster();

-- ------------------------------------------------------------------ freeze
-- Freeze an activity's teams from the set `tid` belongs to — unless they are
-- frozen already, which is the whole point: the first write wins and nothing
-- after it moves them. ON CONFLICT covers two TFs' first marks landing at once:
-- both read "not frozen", both insert the same rows, one set of them sticks.
create or replace function freeze_activity_roster(aid uuid, tid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if aid is null or tid is null then return; end if;
  if exists (select 1 from activity_rosters where activity_id = aid) then return; end if;

  insert into activity_rosters (activity_id, team_id, student_id)
  select aid, tm.team_id, tm.student_id
    from teams t
    join team_members tm on tm.team_id = t.id
   where t.team_set_id = (select team_set_id from teams where id = tid)
  on conflict (activity_id, student_id) do nothing;
end $$;

-- Called by the triggers below, never by a client: what is frozen is decided
-- by what was recorded, not by whoever asks.
revoke execute on function freeze_activity_roster(uuid, uuid) from public;
do $$ begin
  revoke execute on function freeze_activity_roster(uuid, uuid) from anon, authenticated;
exception when undefined_object then null; end $$;

create or replace function freeze_on_sheet_write() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform freeze_activity_roster(new.activity_id, new.team_id);
  return null;
end $$;

-- A team hand-in, but not a draft and not an empty row — see the header.
create or replace function freeze_on_team_result() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.subject_type = 'team' and new.status not in ('none', 'draft') then
    perform freeze_activity_roster(check_in_activity(new.check_in_id), new.team_id);
  end if;
  return null;
end $$;

drop trigger if exists trg_freeze_on_mark on tutorial_marks;
create trigger trg_freeze_on_mark
  after insert or update on tutorial_marks
  for each row execute function freeze_on_sheet_write();

drop trigger if exists trg_freeze_on_absence on tutorial_absences;
create trigger trg_freeze_on_absence
  after insert or update on tutorial_absences
  for each row execute function freeze_on_sheet_write();

drop trigger if exists trg_freeze_on_team_result on check_in_results;
create trigger trg_freeze_on_team_result
  after insert or update of status on check_in_results
  for each row execute function freeze_on_team_result();

-- ------------------------------------------------------------- re-freeze
-- "Use today's teams on this sheet." For the session where somebody is moved
-- AFTER the first mark — a late arrival put on a team, a student who sat with
-- the wrong one. Explicit, from the sheet, by the people who run check-ins;
-- delete and insert in one transaction so the sheet is never half one and half
-- the other.
create or replace function refreeze_activity_roster(aid uuid, set_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not can_run_checkins_course(activity_course(aid)) then
    raise exception 'Only the instructor, or a TF who runs check-ins, can change the teams on a sheet';
  end if;
  if not exists (
    select 1 from team_sets ts where ts.id = set_id and ts.course_id = activity_course(aid))
  then
    raise exception 'That team set is not on this activity''s course';
  end if;

  delete from activity_rosters where activity_id = aid;
  insert into activity_rosters (activity_id, team_id, student_id)
  select aid, tm.team_id, tm.student_id
    from teams t
    join team_members tm on tm.team_id = t.id
   where t.team_set_id = set_id
  on conflict (activity_id, student_id) do nothing;
end $$;

grant execute on function refreeze_activity_roster(uuid, uuid) to authenticated;

-- ------------------------------------------------------------------ guards
-- 0016's guards said "the presenter has to be on the team" and "only a member
-- can be marked absent" — on the team AS IT IS NOW. With the teams frozen, the
-- week 3 sheet shows week 3's teams, and correcting a week 3 presenter after a
-- re-form would be refused for naming someone who was on the team that week.
-- Either answer is accepted: on the team now, or on it for this activity.
--
-- And the presenter is checked when it is SET, not on every write to the row:
-- otherwise a presenter later moved off the team would lock that row's two
-- scores against correction, for a reason that has nothing to do with them.
create or replace function guard_tutorial_mark() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not tutorial_team_fits(new.activity_id, new.team_id) then
    raise exception 'That team is not in this activity''s course';
  end if;

  if new.presenter_id is not null
     and (tg_op = 'INSERT' or new.presenter_id is distinct from old.presenter_id
          or new.team_id is distinct from old.team_id)
     and not exists (
       select 1 from team_members tm
        where tm.team_id = new.team_id and tm.student_id = new.presenter_id)
     and not exists (
       select 1 from activity_rosters r
        where r.activity_id = new.activity_id and r.team_id = new.team_id
          and r.student_id = new.presenter_id)
  then
    raise exception 'The presenter has to be on the team that presented';
  end if;

  return new;
end $$;

create or replace function guard_tutorial_absence() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not tutorial_team_fits(new.activity_id, new.team_id) then
    raise exception 'That team is not in this activity''s course';
  end if;

  if not exists (
       select 1 from team_members tm
        where tm.team_id = new.team_id and tm.student_id = new.student_id)
     and not exists (
       select 1 from activity_rosters r
        where r.activity_id = new.activity_id and r.team_id = new.team_id
          and r.student_id = new.student_id)
  then
    raise exception 'Only a member of the team can be marked absent from it';
  end if;

  return new;
end $$;

-- --------------------------------------------------------------------- RLS
alter table activity_rosters enable row level security;

-- Staff read every activity's teams on their course: the owner, and any TF —
-- a grading TF needs them as much as a check-in one, because the grading
-- screen lists an old activity's teams from here.
--
-- A definer function, not owns_course() in the policy: owns_course is security
-- invoker, and 0044 explains how an invoker read inside a policy can loop
-- through students and team_members until the statement is cancelled.
create or replace function staff_of_activity(aid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from activities a
      join courses c on c.id = a.course_id
     where a.id = aid
       and (c.owner_id = auth.uid()
            or exists (select 1 from course_tfs t
                        where t.course_id = c.id and t.user_id = auth.uid())));
$$;

grant execute on function staff_of_activity(uuid) to authenticated;

drop policy if exists "staff read activity_rosters" on activity_rosters;
create policy "staff read activity_rosters" on activity_rosters
  for select to authenticated
  using (staff_of_activity(activity_id));

-- A student reads their own rows: which team they were on, for each activity.
drop policy if exists "student reads own activity_rosters" on activity_rosters;
create policy "student reads own activity_rosters" on activity_rosters
  for select to authenticated
  using (student_id in (select s.id from students s where s.user_id = auth.uid()));

-- No insert, update or delete policy, deliberately. Rows are written by the
-- freeze trigger and by refreeze_activity_roster, both of which check for
-- themselves; a client writing here directly could rewrite whose marks are whose.
grant select on activity_rosters to authenticated;

-- ------------------------------------------- what a former teammate may read
-- A student moved off a team keeps their OWN history on it. These are added
-- beside 0006/0016/0039's policies, never in place of them — permissive
-- policies are OR-ed, so nobody loses a read they had.
create or replace function was_on_team(aid uuid, tid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from activity_rosters r
      join students s on s.id = r.student_id
     where r.activity_id = aid and r.team_id = tid and s.user_id = auth.uid());
$$;

-- Did the caller share a team with this student on any activity?
create or replace function shared_a_team_with(sid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from activity_rosters theirs
      join activity_rosters mine
        on mine.activity_id = theirs.activity_id and mine.team_id = theirs.team_id
      join students me on me.id = mine.student_id
     where theirs.student_id = sid and me.user_id = auth.uid());
$$;

grant execute on function was_on_team(uuid, uuid), shared_a_team_with(uuid) to authenticated;

drop policy if exists "student reads results of a team they were on" on check_in_results;
create policy "student reads results of a team they were on" on check_in_results
  for select to authenticated
  using (subject_type = 'team' and was_on_team(check_in_activity(check_in_id), team_id));

drop policy if exists "student reads marks of a team they were on" on tutorial_marks;
create policy "student reads marks of a team they were on" on tutorial_marks
  for select to authenticated
  using (
    was_on_team(activity_id, team_id)
    and exists (
      select 1 from activities a
       where a.id = tutorial_marks.activity_id and activity_open(a.opens_at))
  );

drop policy if exists "student reads released marks of a team they were on" on submission_marks;
create policy "student reads released marks of a team they were on" on submission_marks
  for select to authenticated
  using (exists (
    select 1 from check_in_results r
     where r.id = submission_marks.result_id
       and r.status = 'scored'
       and r.subject_type = 'team'
       and was_on_team(check_in_activity(r.check_in_id), r.team_id)
  ));

-- So the card can say who presented, when that was a teammate from before.
drop policy if exists "student reads teammates they had" on students;
create policy "student reads teammates they had" on students
  for select to authenticated
  using (shared_a_team_with(id));

-- ---------------------------------------------------------------- realtime
-- The sheet freezes on its first mark and can be re-frozen from the sheet, so
-- the other open copies watch this table too. FULL so a re-freeze's DELETE
-- carries activity_id for the sheet's filter — the same reason 0043 gives.
do $$ begin
  alter publication supabase_realtime add table activity_rosters;
exception when duplicate_object then null; when undefined_object then null; end $$;

alter table activity_rosters replica identity full;

-- -------------------------------------------------- the class's current set
alter table courses
  add column if not exists current_team_set_id uuid references team_sets(id) on delete set null;

-- The set has to be one of this course's. Not expressible as a foreign key
-- without a composite key on team_sets, and a guard says it in words.
create or replace function guard_current_team_set() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.current_team_set_id is not null and not exists (
    select 1 from team_sets ts where ts.id = new.current_team_set_id and ts.course_id = new.id)
  then
    raise exception 'That team set belongs to another course';
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_current_team_set on courses;
create trigger trg_guard_current_team_set
  before insert or update of current_team_set_id on courses
  for each row execute function guard_current_team_set();

-- Backfill with exactly the set the faculty app was already using — the first
-- whole-session set, else the newest — so nothing on screen changes when this
-- runs. Only where it is unset, so a re-run does not undo a later choice.
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

-- ---------------------------------------------------------------- backfill
-- Freeze every activity that already has something recorded, from the set its
-- FIRST record was made on, dated by that record.
--
-- This freezes the teams AS THEY ARE TODAY. For an activity whose teams have
-- not changed since it ran, that is the truth. For one that ran before a
-- re-form — Kelly's weeks before the switch — it is today's teams, which is
-- also what every screen has been showing for it; this does not make it worse,
-- and supabase/recovery/restore_activity_rosters.sql is how it is made right.
with events as (
  select activity_id, team_id, updated_at as at from tutorial_marks
  union all
  select activity_id, team_id, created_at from tutorial_absences
  union all
  select c.activity_id, r.team_id, coalesce(r.submitted_at, r.updated_at)
    from check_in_results r
    join check_ins c on c.id = r.check_in_id
   where r.subject_type = 'team' and r.team_id is not null
     and r.status not in ('none', 'draft')
),
firsts as (
  select distinct on (activity_id) activity_id, team_id, at
    from events
   order by activity_id, at, team_id
)
insert into activity_rosters (activity_id, team_id, student_id, frozen_at)
select f.activity_id, tm.team_id, tm.student_id, f.at
  from firsts f
  join teams t0 on t0.id = f.team_id
  join teams t on t.team_set_id = t0.team_set_id
  join team_members tm on tm.team_id = t.id
 where not exists (select 1 from activity_rosters r where r.activity_id = f.activity_id)
on conflict (activity_id, student_id) do nothing;
