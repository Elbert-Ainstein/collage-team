-- owns_student and owns_team read the tables directly.
--
-- Run in Supabase → SQL Editor, after 0047. Safe to re-run.
--
-- 0044's header describes a loop it worked around: a policy reads `students`
-- as the caller, `students`' policies reach `team_members`, whose owner policy
-- calls owns_student() — security invoker since 0004 — which reads `students`
-- again, under its policies, which reach `team_members`... "Under some plans
-- that loops until the statement is cancelled."
--
-- On a fresh database it is every plan: the instructor reading their own
-- roster, once any team exists, recursed until Postgres ran out of memory and
-- the server was killed. The live project has evidently been getting a plan
-- that doesn't take that path. Nothing should depend on that.
--
-- The fix 0038 made for owns_check_in, made here for the other two: security
-- definer, so the question "does the caller own this?" is answered by reading
-- the rows once, without the caller's policies in the way. Both still ask only
-- about auth.uid(); neither reveals anything but that one yes or no.

create or replace function owns_student(sid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from students s join courses c on c.id = s.course_id
    where s.id = sid and c.owner_id = auth.uid());
$$;

create or replace function owns_team(tid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from teams t
      join team_sets ts on ts.id = t.team_set_id
      join courses c on c.id = ts.course_id
    where t.id = tid and c.owner_id = auth.uid());
$$;

-- Signed-in callers only: anon gets EXECUTE on new functions by default in
-- Supabase, and has no use for these.
revoke all on function owns_student(uuid), owns_team(uuid) from public, anon;
grant execute on function owns_student(uuid), owns_team(uuid) to authenticated;
