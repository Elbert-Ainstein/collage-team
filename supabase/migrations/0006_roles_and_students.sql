-- Faculty and student accounts.
--
-- Until now every account was a faculty workspace: you owned your courses and
-- saw nothing else. Students need to sign in too, and see a strictly smaller
-- slice — their own session, their own submissions, their own team — without
-- being able to reach another student's work or another instructor's course.
--
-- Two ideas carry it:
--   1. profiles.role says which kind of account this is.
--   2. students.user_id links a roster row to a login. The roster already
--      carries emails (the importer captures them), so a student who signs up
--      with the address their instructor imported is claimed automatically.
--
-- Run in Supabase → SQL Editor, after 0005.

-- ------------------------------------------------------------------ profiles
create table if not exists profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  role       text not null default 'faculty' check (role in ('faculty', 'student')),
  full_name  text,
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;

-- Everyone reads and edits only their own profile. Role is set at sign-up and
-- is not something a user should be able to hand themselves later, so updates
-- may not change it.
drop policy if exists "own profile read" on profiles;
create policy "own profile read" on profiles
  for select to authenticated using (id = auth.uid());

drop policy if exists "own profile insert" on profiles;
create policy "own profile insert" on profiles
  for insert to authenticated with check (id = auth.uid());

drop policy if exists "own profile update" on profiles;
create policy "own profile update" on profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and role = (select p.role from profiles p where p.id = auth.uid()));

-- A row appears the moment an account is created, so the app never has to cope
-- with a signed-in user that has no profile. The role travels in sign-up
-- metadata; anything unrecognised falls back to faculty.
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, role, full_name)
  values (
    new.id,
    case when new.raw_user_meta_data->>'role' = 'student' then 'student' else 'faculty' end,
    nullif(new.raw_user_meta_data->>'full_name', '')
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- Backfill anyone who signed up before this migration. The Faculty/Student
-- picker has been live since before this ran, so the choice they made is
-- sitting in their sign-up metadata -- read it, rather than making every early
-- student a permanent faculty account with no way to undo it.
insert into profiles (id, role)
select
  u.id,
  case when u.raw_user_meta_data->>'role' = 'student' then 'student' else 'faculty' end
from auth.users u
where not exists (select 1 from profiles p where p.id = u.id);

-- ------------------------------------------------- link roster rows to logins
alter table students add column if not exists user_id uuid references auth.users(id) on delete set null;
-- One login per roster row, per session. NOT globally unique: a student who
-- appears on both AP50A and AP50B must be able to claim both rows, and a
-- global constraint would make claim_student_rows() fail outright and leave
-- them with no enrolment at all.
drop index if exists uniq_student_user;
create unique index if not exists uniq_student_user_course
  on students (course_id, user_id) where user_id is not null;
create index if not exists idx_students_email on students (lower(email));

/**
 * Claim the roster rows whose email matches this account.
 *
 * At most ONE row per course. Nothing stops an instructor from having the same
 * address on two rows of one roster, and claiming both at once would violate
 * uniq_student_user_course, roll the whole statement back, and leave the
 * student claimed on nothing at all -- stranded on "you're not on a roster yet"
 * with no way to tell why. One row per course always succeeds.
 */
create or replace function claim_student_rows() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update students s
     set user_id = auth.uid()
   where s.id in (
     select distinct on (c.course_id) c.id
       from students c, auth.users u
      where u.id = auth.uid()
        and c.user_id is null
        and c.email is not null
        and lower(c.email) = lower(u.email)
      order by c.course_id, c.created_at, c.id
   );
  get diagnostics n = row_count;
  return n;
end $$;

grant execute on function claim_student_rows() to authenticated;

-- ------------------------------------------------------- helpers for policies
/** Is the caller a student? */
create or replace function is_student() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'student');
$$;

/** Courses the caller is enrolled in as a student. */
create or replace function my_course_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select s.course_id from students s where s.user_id = auth.uid();
$$;

/** Teams the caller belongs to. */
create or replace function my_team_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select tm.team_id from team_members tm
    join students s on s.id = tm.student_id
   where s.user_id = auth.uid();
$$;

grant execute on function is_student(), my_course_ids(), my_team_ids() to authenticated;

-- ------------------------------------------------------------ student reads
-- Additive: these sit alongside the owner policies from 0003/0004. Postgres ORs
-- permissive policies together, so faculty keep exactly the access they had and
-- students gain a strictly narrower one.

drop policy if exists "student reads own course" on courses;
create policy "student reads own course" on courses
  for select to authenticated using (id in (select my_course_ids()));

-- Themselves and their teammates -- not the whole class. The roster carries
-- every student's email address, and no student screen needs a classmate they
-- do not work with.
drop policy if exists "student reads classmates" on students;
drop policy if exists "student reads self and teammates" on students;
create policy "student reads self and teammates" on students
  for select to authenticated
  using (
    user_id = auth.uid()
    or id in (select tm.student_id from team_members tm
               where tm.team_id in (select my_team_ids()))
  );

drop policy if exists "student reads activities" on activities;
create policy "student reads activities" on activities
  for select to authenticated using (course_id in (select my_course_ids()));

drop policy if exists "student reads team_sets" on team_sets;
create policy "student reads team_sets" on team_sets
  for select to authenticated using (course_id in (select my_course_ids()));

drop policy if exists "student reads teams" on teams;
create policy "student reads teams" on teams
  for select to authenticated
  using (exists (select 1 from team_sets ts where ts.id = teams.team_set_id
                   and ts.course_id in (select my_course_ids())));

drop policy if exists "student reads team_members" on team_members;
create policy "student reads team_members" on team_members
  for select to authenticated
  using (team_id in (select my_team_ids()));

drop policy if exists "student reads check_ins" on check_ins;
create policy "student reads check_ins" on check_ins
  for select to authenticated
  using (exists (select 1 from activities a where a.id = check_ins.activity_id
                   and a.course_id in (select my_course_ids())));

-- A student sees their OWN results and their TEAM's — never a classmate's
-- individual work.
drop policy if exists "student reads own results" on check_in_results;
create policy "student reads own results" on check_in_results
  for select to authenticated
  using (
    (subject_type = 'student' and student_id in (select s.id from students s where s.user_id = auth.uid()))
    or (subject_type = 'team' and team_id in (select my_team_ids()))
  );

-- ------------------------------------------------------------ student writes
-- A student may submit their own work, and their team's. They may not create
-- rows for anyone else, and grading stays with faculty.
--
-- Three things have to line up, and it is worth saying why:
--
--   1. `is_student()` gates the policy. Without it the policy population and
--      the trigger population differ, and a student who picks "Faculty" at
--      sign-up lands in the gap: allowed to write by the policy, exempted from
--      the guard by the trigger, free to post themselves a scored grade.
--   2. The check-in must be in a course they are enrolled in. Constraining only
--      the subject re-opens the hole 0004 was written to close -- a guessed or
--      copied check-in id would otherwise attach a row to a stranger's course,
--      where neither instructor can then read or delete it.
--   3. The trigger below stops them grading, and keys off course ownership
--      rather than the self-selected role, so it holds whatever the profile says.

/** Is this check-in part of a course the caller is enrolled in? */
create or replace function my_check_in(ciid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from check_ins ci
      join activities a on a.id = ci.activity_id
     where ci.id = ciid and a.course_id in (select my_course_ids()));
$$;

grant execute on function my_check_in(uuid) to authenticated;

drop policy if exists "student writes own result" on check_in_results;
create policy "student writes own result" on check_in_results
  for insert to authenticated
  with check (
    is_student()
    and my_check_in(check_in_id)
    and (
      (subject_type = 'student' and student_id in (select s.id from students s where s.user_id = auth.uid()))
      or (subject_type = 'team' and team_id in (select my_team_ids()))
    )
  );

drop policy if exists "student updates own result" on check_in_results;
create policy "student updates own result" on check_in_results
  for update to authenticated
  using (
    is_student()
    and my_check_in(check_in_id)
    and (
      (subject_type = 'student' and student_id in (select s.id from students s where s.user_id = auth.uid()))
      or (subject_type = 'team' and team_id in (select my_team_ids()))
    )
  )
  with check (
    is_student()
    and my_check_in(check_in_id)
    and (
      (subject_type = 'student' and student_id in (select s.id from students s where s.user_id = auth.uid()))
      or (subject_type = 'team' and team_id in (select my_team_ids()))
    )
  );

/**
 * Students submit; faculty grade.
 *
 * The test is course OWNERSHIP, not profiles.role. Role is chosen by the person
 * signing up, so anything keyed on it can be opted out of by picking the other
 * button; ownership cannot be. Whoever owns the session may do anything, and
 * everyone else is submitting.
 *
 * Guarding `score` alone was not enough either. A result is also "graded" when
 * its status says so -- gradeOf() renders a scored completion-credit row as
 * "Complete" without ever reading score -- and 'excused' would let a student
 * excuse themselves. So a non-owner may only park a row in the states that mean
 * work in progress, may not move a row between subjects or check-ins, and may
 * not touch a row once it is graded.
 */
create or replace function guard_student_grading() returns trigger
language plpgsql security definer set search_path = public as $$
declare owner boolean;
begin
  select exists (
    select 1 from check_ins ci
      join activities a on a.id = ci.activity_id
      join courses c on c.id = a.course_id
     where ci.id = new.check_in_id and c.owner_id = auth.uid())
    into owner;
  if owner then
    return new;
  end if;

  if new.status not in ('none', 'draft', 'submitted', 'discussing') then
    raise exception 'Students can submit work, but not grade it';
  end if;

  if new.score is not null then
    raise exception 'Students cannot set their own grade';
  end if;

  if tg_op = 'UPDATE' then
    if old.status = 'scored' then
      raise exception 'This has already been graded - ask your instructor to reopen it';
    end if;
    if new.is_ci is distinct from old.is_ci then
      raise exception 'Students cannot set their own grade';
    end if;
    -- Re-pointing a row is how a team's scored result becomes someone's
    -- personal grade without `score` ever changing.
    if new.check_in_id is distinct from old.check_in_id
       or new.subject_type is distinct from old.subject_type
       or new.student_id is distinct from old.student_id
       or new.team_id is distinct from old.team_id then
      raise exception 'A submission cannot be moved to a different check-in or owner';
    end if;
    if new.flagged is distinct from old.flagged then
      raise exception 'Only your instructor can change that';
    end if;
  elsif new.is_ci then
    raise exception 'Students cannot set their own grade';
  end if;

  return new;
end $$;

drop trigger if exists trg_guard_student_grading on check_in_results;
create trigger trg_guard_student_grading
  before insert or update on check_in_results
  for each row execute function guard_student_grading();

-- --------------------------------------------- activity type drives the UI
-- The student design keys its layout off an activity's SCOPE (individual /
-- team / both), which it derives from a type. Storing the type keeps the
-- mapping in one place.
alter table activities add column if not exists type text not null default 'challenge'
  check (type in ('challenge', 'combo', 'skills', 'amplify'));
