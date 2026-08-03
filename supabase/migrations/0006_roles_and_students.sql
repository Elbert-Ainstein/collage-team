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

-- Backfill anyone who signed up before this migration.
insert into profiles (id, role)
select u.id, 'faculty' from auth.users u
where not exists (select 1 from profiles p where p.id = u.id);

-- ------------------------------------------------- link roster rows to logins
alter table students add column if not exists user_id uuid references auth.users(id) on delete set null;
create unique index if not exists uniq_student_user on students (user_id) where user_id is not null;
create index if not exists idx_students_email on students (lower(email));

/** Claim the roster rows whose email matches this account. */
create or replace function claim_student_rows() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update students s
     set user_id = auth.uid()
   from auth.users u
  where u.id = auth.uid()
    and s.user_id is null
    and s.email is not null
    and lower(s.email) = lower(u.email);
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

create policy "student reads own course" on courses
  for select to authenticated using (id in (select my_course_ids()));

create policy "student reads classmates" on students
  for select to authenticated using (course_id in (select my_course_ids()));

create policy "student reads activities" on activities
  for select to authenticated using (course_id in (select my_course_ids()));

create policy "student reads team_sets" on team_sets
  for select to authenticated using (course_id in (select my_course_ids()));

create policy "student reads teams" on teams
  for select to authenticated
  using (exists (select 1 from team_sets ts where ts.id = teams.team_set_id
                   and ts.course_id in (select my_course_ids())));

create policy "student reads team_members" on team_members
  for select to authenticated
  using (team_id in (select my_team_ids()));

create policy "student reads check_ins" on check_ins
  for select to authenticated
  using (exists (select 1 from activities a where a.id = check_ins.activity_id
                   and a.course_id in (select my_course_ids())));

-- A student sees their OWN results and their TEAM's — never a classmate's
-- individual work.
create policy "student reads own results" on check_in_results
  for select to authenticated
  using (
    (subject_type = 'student' and student_id in (select s.id from students s where s.user_id = auth.uid()))
    or (subject_type = 'team' and team_id in (select my_team_ids()))
  );

-- ------------------------------------------------------------ student writes
-- A student may submit their own work, and their team's. They may not create
-- rows for anyone else, and grading stays with faculty: score is not writable
-- here, which is enforced by the trigger below rather than by column grants so
-- the message is legible.

create policy "student writes own result" on check_in_results
  for insert to authenticated
  with check (
    (subject_type = 'student' and student_id in (select s.id from students s where s.user_id = auth.uid()))
    or (subject_type = 'team' and team_id in (select my_team_ids()))
  );

create policy "student updates own result" on check_in_results
  for update to authenticated
  using (
    (subject_type = 'student' and student_id in (select s.id from students s where s.user_id = auth.uid()))
    or (subject_type = 'team' and team_id in (select my_team_ids()))
  )
  with check (
    (subject_type = 'student' and student_id in (select s.id from students s where s.user_id = auth.uid()))
    or (subject_type = 'team' and team_id in (select my_team_ids()))
  );

/** Students submit; faculty grade. Blocks a student setting their own score. */
create or replace function guard_student_grading() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if is_student() then
    if tg_op = 'INSERT' and (new.score is not null or new.status = 'scored') then
      raise exception 'Students cannot set their own grade';
    end if;
    if tg_op = 'UPDATE' and (new.score is distinct from old.score) then
      raise exception 'Students cannot change a grade';
    end if;
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
