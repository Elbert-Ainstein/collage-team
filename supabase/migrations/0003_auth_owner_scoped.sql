-- Per-user workspaces.
--
-- Until now the database had one permissive policy ("anyone may do anything"),
-- which was fine for a local prototype and unacceptable for real rosters. This
-- migration ties every row to the account that created it and rewrites the
-- policies so a signed-in user can reach their own data and nothing else.
--
-- Consequence worth understanding: sign-up can stay open. A new account starts
-- with an empty workspace and can never see anyone else's, so a second account
-- is exactly how you get a sandbox with placeholder data.
--
-- Run in Supabase → SQL Editor.

-- ---------------------------------------------------------------- ownership
alter table courses add column if not exists owner_id uuid references auth.users(id) on delete cascade;
create index if not exists idx_courses_owner on courses(owner_id);

-- Sessions are unique per OWNER, not globally: every user provisions their own
-- AP50A/AP50B, so the old global unique index from 0002 must go.
drop index if exists uniq_course_code;
create unique index if not exists uniq_course_owner_code
  on courses (owner_id, code) where code is not null;

-- Rows created before accounts existed belong to nobody and are unreachable
-- under the policies below. The prototype data was placeholder, so drop it
-- rather than leave orphans behind.
delete from courses where owner_id is null;

-- ------------------------------------------------------------------ policies
-- Replace the prototype's blanket access everywhere.
do $$
declare t text;
begin
  foreach t in array array[
    'courses','students','activities','team_sets','teams',
    'team_members','check_ins','check_in_results'
  ] loop
    execute format('drop policy if exists "prototype anon full access" on %I', t);
  end loop;
end $$;

-- A course is owned directly.
create policy "own courses" on courses
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- Everything else is reachable only through a course the user owns. Each policy
-- walks back up to courses.owner_id; WITH CHECK uses the same test so a row can
-- never be created under someone else's course.
create policy "own students" on students
  for all to authenticated
  using (exists (select 1 from courses c where c.id = students.course_id and c.owner_id = auth.uid()))
  with check (exists (select 1 from courses c where c.id = students.course_id and c.owner_id = auth.uid()));

create policy "own activities" on activities
  for all to authenticated
  using (exists (select 1 from courses c where c.id = activities.course_id and c.owner_id = auth.uid()))
  with check (exists (select 1 from courses c where c.id = activities.course_id and c.owner_id = auth.uid()));

create policy "own team_sets" on team_sets
  for all to authenticated
  using (exists (select 1 from courses c where c.id = team_sets.course_id and c.owner_id = auth.uid()))
  with check (exists (select 1 from courses c where c.id = team_sets.course_id and c.owner_id = auth.uid()));

create policy "own teams" on teams
  for all to authenticated
  using (exists (
    select 1 from team_sets s join courses c on c.id = s.course_id
    where s.id = teams.team_set_id and c.owner_id = auth.uid()))
  with check (exists (
    select 1 from team_sets s join courses c on c.id = s.course_id
    where s.id = teams.team_set_id and c.owner_id = auth.uid()));

create policy "own team_members" on team_members
  for all to authenticated
  using (exists (
    select 1 from teams t join team_sets s on s.id = t.team_set_id join courses c on c.id = s.course_id
    where t.id = team_members.team_id and c.owner_id = auth.uid()))
  with check (exists (
    select 1 from teams t join team_sets s on s.id = t.team_set_id join courses c on c.id = s.course_id
    where t.id = team_members.team_id and c.owner_id = auth.uid()));

create policy "own check_ins" on check_ins
  for all to authenticated
  using (exists (
    select 1 from activities a join courses c on c.id = a.course_id
    where a.id = check_ins.activity_id and c.owner_id = auth.uid()))
  with check (exists (
    select 1 from activities a join courses c on c.id = a.course_id
    where a.id = check_ins.activity_id and c.owner_id = auth.uid()));

create policy "own check_in_results" on check_in_results
  for all to authenticated
  using (exists (
    select 1 from check_ins ci join activities a on a.id = ci.activity_id join courses c on c.id = a.course_id
    where ci.id = check_in_results.check_in_id and c.owner_id = auth.uid()))
  with check (exists (
    select 1 from check_ins ci join activities a on a.id = ci.activity_id join courses c on c.id = a.course_id
    where ci.id = check_in_results.check_in_id and c.owner_id = auth.uid()));

-- Note: policies are granted to `authenticated` only. The `anon` role — the key
-- that ships in the browser before sign-in — now has no access to any table.
