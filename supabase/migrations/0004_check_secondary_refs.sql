-- Close a gap in the 0003 policies.
--
-- Those policies validate only the row's DIRECT parent. Rows with a second
-- foreign key were therefore only half-checked:
--
--   team_members validates team_id but not student_id, so an account could
--   attach another account's student to its own team.
--   check_in_results validates check_in_id but not student_id / team_id.
--
-- Exploiting it needs the other account's row UUID, which is not guessable, but
-- "hard to guess" is not an access rule. These policies check every reference.
--
-- Run in Supabase → SQL Editor, after 0003.

-- helper: does this account own the course behind a given row?
create or replace function owns_course(cid uuid) returns boolean
language sql stable security invoker as $$
  select exists (select 1 from courses c where c.id = cid and c.owner_id = auth.uid());
$$;

create or replace function owns_student(sid uuid) returns boolean
language sql stable security invoker as $$
  select exists (
    select 1 from students s join courses c on c.id = s.course_id
    where s.id = sid and c.owner_id = auth.uid());
$$;

create or replace function owns_team(tid uuid) returns boolean
language sql stable security invoker as $$
  select exists (
    select 1 from teams t
      join team_sets ts on ts.id = t.team_set_id
      join courses c on c.id = ts.course_id
    where t.id = tid and c.owner_id = auth.uid());
$$;

create or replace function owns_check_in(ciid uuid) returns boolean
language sql stable security invoker as $$
  select exists (
    select 1 from check_ins ci
      join activities a on a.id = ci.activity_id
      join courses c on c.id = a.course_id
    where ci.id = ciid and c.owner_id = auth.uid());
$$;

-- team_members: BOTH sides must belong to this account.
drop policy if exists "own team_members" on team_members;
create policy "own team_members" on team_members
  for all to authenticated
  using (owns_team(team_id) and owns_student(student_id))
  with check (owns_team(team_id) and owns_student(student_id));

-- check_in_results: the check-in AND whichever subject the row names.
drop policy if exists "own check_in_results" on check_in_results;
create policy "own check_in_results" on check_in_results
  for all to authenticated
  using (
    owns_check_in(check_in_id)
    and (student_id is null or owns_student(student_id))
    and (team_id is null or owns_team(team_id))
  )
  with check (
    owns_check_in(check_in_id)
    and (student_id is null or owns_student(student_id))
    and (team_id is null or owns_team(team_id))
  );

-- team_sets.activity_id points at an activity; make sure it is ours too.
drop policy if exists "own team_sets" on team_sets;
create policy "own team_sets" on team_sets
  for all to authenticated
  using (owns_course(course_id))
  with check (
    owns_course(course_id)
    and (activity_id is null or exists (
      select 1 from activities a where a.id = team_sets.activity_id and owns_course(a.course_id)))
  );
