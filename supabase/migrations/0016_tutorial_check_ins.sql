-- The live tutorial sheet: who was absent, who presented, and how it went.
--
-- Run in Supabase → SQL Editor, after 0015. Safe to re-run.
--
-- The Check-in tab was a frontend prototype holding a session in React state.
-- It is real now because the marks have to reach the people they are about: a
-- student on Team Helix sees the presenter and the two scores their team was
-- given for that activity. Nothing crosses a team boundary.
--
-- TWO TABLES, both keyed on (activity, team) rather than hanging off a record
-- row. Rows, not columns — the same call the rubric made when question counts
-- became question rows. A session with three check-ins, or four absences, is a
-- different number of rows and not a migration.
--
--   tutorial_marks      one row per check-in slot: presenter + two 1-5 scores
--   tutorial_absences   one row per absent student
--
-- These are SEPARATE from check_in_results. That table is about submitted work
-- and carries a grade an instructor releases; this is about what happened in the
-- room. Folding them together would put "accuracy 4/5, spoken" into a column
-- that means "your assignment scored 4".

-- ------------------------------------------------------------------ helper
-- Defined first: `language sql` validates its body at CREATE time, so a
-- forward reference from the policies below would fail outright.
create or replace function activity_course(aid uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select course_id from activities where id = aid;
$$;

grant execute on function activity_course(uuid) to authenticated;

-- ------------------------------------------------------------------ tables
create table if not exists tutorial_marks (
  id           uuid primary key default gen_random_uuid(),
  activity_id  uuid not null references activities(id) on delete cascade,
  team_id      uuid not null references teams(id) on delete cascade,
  /** Which check-in of the session. 1 and 2 today; the column does not care. */
  slot         int  not null check (slot >= 1),
  presenter_id uuid references students(id) on delete set null,
  accuracy     int check (accuracy between 1 and 5),
  discussion   int check (discussion between 1 and 5),
  updated_at   timestamptz not null default now(),
  unique (activity_id, team_id, slot)
);

create table if not exists tutorial_absences (
  activity_id uuid not null references activities(id) on delete cascade,
  team_id     uuid not null references teams(id) on delete cascade,
  student_id  uuid not null references students(id) on delete cascade,
  created_at  timestamptz not null default now(),
  -- Marking the same person absent twice is never what was meant, and it would
  -- quietly double an attendance count.
  primary key (activity_id, team_id, student_id)
);

create index if not exists idx_tutorial_marks_activity on tutorial_marks (activity_id);
create index if not exists idx_tutorial_marks_team on tutorial_marks (team_id);
create index if not exists idx_tutorial_absences_team on tutorial_absences (team_id);

-- ------------------------------------------------------------------ guards
-- Nothing in the policies below says the people named have anything to do with
-- the team, or the team with the activity's course. Without these an instructor
-- of one course could file a mark against another course's team, and a presenter
-- could be someone who has never been on the team.
--
-- Does this team belong to the same course as this activity? A team carries no
-- course of its own — it belongs to a team_set, and the SET belongs to a course.
create or replace function tutorial_team_fits(aid uuid, tid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from teams t
      join team_sets ts on ts.id = t.team_set_id
     where t.id = tid and ts.course_id = activity_course(aid));
$$;

create or replace function guard_tutorial_mark() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not tutorial_team_fits(new.activity_id, new.team_id) then
    raise exception 'That team is not in this activity''s course';
  end if;

  if new.presenter_id is not null and not exists (
    select 1 from team_members tm
     where tm.team_id = new.team_id and tm.student_id = new.presenter_id)
  then
    raise exception 'The presenter has to be on the team that presented';
  end if;

  return new;
end $$;

-- Two functions rather than one branching on tg_table_name: the two tables have
-- different columns, and a single body referencing both only fails on the row
-- that reaches the wrong branch — at run time, in a live session.
create or replace function guard_tutorial_absence() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not tutorial_team_fits(new.activity_id, new.team_id) then
    raise exception 'That team is not in this activity''s course';
  end if;

  if not exists (
    select 1 from team_members tm
     where tm.team_id = new.team_id and tm.student_id = new.student_id)
  then
    raise exception 'Only a member of the team can be marked absent from it';
  end if;

  return new;
end $$;

drop trigger if exists trg_guard_tutorial_marks on tutorial_marks;
create trigger trg_guard_tutorial_marks
  before insert or update on tutorial_marks
  for each row execute function guard_tutorial_mark();

drop trigger if exists trg_guard_tutorial_absences on tutorial_absences;
create trigger trg_guard_tutorial_absences
  before insert or update on tutorial_absences
  for each row execute function guard_tutorial_absence();

-- --------------------------------------------------------------------- RLS
alter table tutorial_marks    enable row level security;
alter table tutorial_absences enable row level security;

-- Who may FILL THE SHEET IN: the course owner, and a TF the owner has given
-- check-in permission. Exactly can_run_checkins_course, which 0010 already
-- defines for this purpose — one answer to "who runs check-ins", not two.
drop policy if exists "staff read tutorial_marks" on tutorial_marks;
create policy "staff read tutorial_marks" on tutorial_marks
  for select to authenticated using (can_run_checkins_course(activity_course(activity_id)));

drop policy if exists "staff write tutorial_marks" on tutorial_marks;
create policy "staff write tutorial_marks" on tutorial_marks
  for insert to authenticated
  with check (can_run_checkins_course(activity_course(activity_id)));

drop policy if exists "staff update tutorial_marks" on tutorial_marks;
create policy "staff update tutorial_marks" on tutorial_marks
  for update to authenticated
  using (can_run_checkins_course(activity_course(activity_id)))
  with check (can_run_checkins_course(activity_course(activity_id)));

drop policy if exists "staff clear tutorial_marks" on tutorial_marks;
create policy "staff clear tutorial_marks" on tutorial_marks
  for delete to authenticated using (can_run_checkins_course(activity_course(activity_id)));

-- A student sees their OWN team's row, and only once the activity is open to
-- them. Read-only: this is a record of what an instructor observed, and a
-- student editing their own presenter mark is the whole point of it not being
-- writable here. Permissive policies are OR-ed, so staff keep their access
-- through the policy above.
drop policy if exists "student reads own team tutorial_marks" on tutorial_marks;
create policy "student reads own team tutorial_marks" on tutorial_marks
  for select to authenticated
  using (
    team_id in (select my_team_ids())
    and exists (
      -- Qualified: an unqualified activity_id inside this subquery reads as the
      -- outer column only because `activities` happens not to have one, and
      -- that is not a thing to leave resting on.
      select 1 from activities a
       where a.id = tutorial_marks.activity_id and activity_open(a.opens_at))
  );

drop policy if exists "staff read tutorial_absences" on tutorial_absences;
create policy "staff read tutorial_absences" on tutorial_absences
  for select to authenticated using (can_run_checkins_course(activity_course(activity_id)));

drop policy if exists "staff write tutorial_absences" on tutorial_absences;
create policy "staff write tutorial_absences" on tutorial_absences
  for insert to authenticated
  with check (can_run_checkins_course(activity_course(activity_id)));

drop policy if exists "staff clear tutorial_absences" on tutorial_absences;
create policy "staff clear tutorial_absences" on tutorial_absences
  for delete to authenticated using (can_run_checkins_course(activity_course(activity_id)));

-- Deliberately NOT readable by students. Who else on your team was marked
-- absent is a fact about them, not about you, and the student screen has no
-- reason to show it.

grant select, insert, update, delete on tutorial_marks to authenticated;
grant select, insert, delete on tutorial_absences to authenticated;
