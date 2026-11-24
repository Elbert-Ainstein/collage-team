-- What 0059 promises: staff read a course's projects and students read
-- nothing; only the owner writes projects and their rubric; whoever may grade
-- the course grades; a grading is marked done only with a grader's name and a
-- score and a reason in every category, and while done nothing can be cleared;
-- a new category reopens done gradings; and a project keeps the team set its
-- first grade was in.
--
--   psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f supabase/tests/0059_projects.sql
--
-- LOCAL DATABASE ONLY, after every migration through 0059. Everything runs in
-- one transaction that is rolled back, and each check runs as the
-- `authenticated` role with that person's JWT claims.

\set ON_ERROR_STOP 1
begin;

-- --------------------------------------------------------------- harness
create function pg_temp.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

create function pg_temp.as_admin() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $$;

create function pg_temp.ok(uid uuid, q text, label text) returns void language plpgsql as $$
begin
  perform pg_temp.as_user(uid);
  execute q;
  perform pg_temp.as_admin();
  raise notice 'ok    %', label;
exception when others then
  perform pg_temp.as_admin();
  raise exception 'FAIL  % — unexpected error: %', label, sqlerrm;
end $$;

create function pg_temp.refused(uid uuid, q text, label text, want text default null) returns void
language plpgsql as $$
declare got text;
begin
  begin
    perform pg_temp.as_user(uid);
    execute q;
    got := null;
  exception when others then
    got := sqlerrm;
  end;
  perform pg_temp.as_admin();
  if got is null then
    raise exception 'FAIL  % — it was allowed', label;
  end if;
  if want is not null and got not ilike '%' || want || '%' then
    raise exception 'FAIL  % — refused, but for the wrong reason: %', label, got;
  end if;
  raise notice 'ok    % (refused: %)', label, got;
end $$;

create function pg_temp.sees(uid uuid, q text, n int, label text) returns void language plpgsql as $$
declare c int;
begin
  perform pg_temp.as_user(uid);
  execute format('select count(*) from (%s) t', q) into c;
  perform pg_temp.as_admin();
  if c <> n then
    raise exception 'FAIL  % — saw % rows, expected %', label, c, n;
  end if;
  raise notice 'ok    % (% rows)', label, c;
end $$;

create function pg_temp.eq(got text, want text, label text) returns void language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'FAIL  % — got %, expected %', label, coalesce(got, 'null'), coalesce(want, 'null');
  end if;
  raise notice 'ok    % (%)', label, coalesce(got, 'null');
end $$;

-- ------------------------------------------------------------- fixtures
-- O owns P1 (TFs grade) and has T as a TF. Q owns P2 (TFs don't grade) and
-- has R as a TF. S is a student on P1. Z is nobody here.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a1', 'o@pj.test'),
  ('00000000-0000-4000-8000-0000000000a2', 't@pj.test'),
  ('00000000-0000-4000-8000-0000000000a3', 'q@pj.test'),
  ('00000000-0000-4000-8000-0000000000a4', 'r@pj.test'),
  ('00000000-0000-4000-8000-0000000000a5', 's@pj.test'),
  ('00000000-0000-4000-8000-0000000000a9', 'z@pj.test');

insert into courses (id, name, owner_id, tf_can_grade) values
  ('20000000-0000-4000-8000-0000000000c1', 'P1', '00000000-0000-4000-8000-0000000000a1', true),
  ('20000000-0000-4000-8000-0000000000c2', 'P2', '00000000-0000-4000-8000-0000000000a3', false);
insert into course_tfs (course_id, name, email, user_id) values
  ('20000000-0000-4000-8000-0000000000c1', 'T', 't@pj.test', '00000000-0000-4000-8000-0000000000a2'),
  ('20000000-0000-4000-8000-0000000000c2', 'R', 'r@pj.test', '00000000-0000-4000-8000-0000000000a4');
insert into students (id, course_id, name, email, user_id, position) values
  ('10000000-0000-4000-8000-0000000000b1', '20000000-0000-4000-8000-0000000000c1', 'S', 's@pj.test',
   '00000000-0000-4000-8000-0000000000a5', 1);

-- Two sets on P1 (the current one, and an older one), one on P2.
insert into team_sets (id, course_id, name) values
  ('30000000-0000-4000-8000-0000000000d1', '20000000-0000-4000-8000-0000000000c1', 'Now'),
  ('30000000-0000-4000-8000-0000000000d2', '20000000-0000-4000-8000-0000000000c1', 'Before'),
  ('30000000-0000-4000-8000-0000000000d3', '20000000-0000-4000-8000-0000000000c2', 'Theirs');
insert into teams (id, team_set_id, name, position) values
  ('40000000-0000-4000-8000-0000000000e1', '30000000-0000-4000-8000-0000000000d1', 'Team 1', 0),
  ('40000000-0000-4000-8000-0000000000e2', '30000000-0000-4000-8000-0000000000d1', 'Team 2', 1),
  ('40000000-0000-4000-8000-0000000000e3', '30000000-0000-4000-8000-0000000000d2', 'Old team', 0),
  ('40000000-0000-4000-8000-0000000000e4', '30000000-0000-4000-8000-0000000000d3', 'P2 team', 0);
insert into team_members (team_id, student_id) values
  ('40000000-0000-4000-8000-0000000000e1', '10000000-0000-4000-8000-0000000000b1');
update courses set current_team_set_id = '30000000-0000-4000-8000-0000000000d1'
 where id = '20000000-0000-4000-8000-0000000000c1';

-- ------------------------------------------------------------ the checks
do $$
declare
  o  uuid := '00000000-0000-4000-8000-0000000000a1';
  t  uuid := '00000000-0000-4000-8000-0000000000a2';
  q  uuid := '00000000-0000-4000-8000-0000000000a3';
  r  uuid := '00000000-0000-4000-8000-0000000000a4';
  s  uuid := '00000000-0000-4000-8000-0000000000a5';
  z  uuid := '00000000-0000-4000-8000-0000000000a9';
  pj text := '60000000-0000-4000-8000-0000000000f1';
  p2 text := '60000000-0000-4000-8000-0000000000f2';
  p3 text := '60000000-0000-4000-8000-0000000000f3';
  c4 text := '70000000-0000-4000-8000-000000000004';
  c1 text := '70000000-0000-4000-8000-000000000001';
  c2 text := '70000000-0000-4000-8000-000000000002';
  c3 text := '70000000-0000-4000-8000-000000000003';
  t1 text := '40000000-0000-4000-8000-0000000000e1';
  t2 text := '40000000-0000-4000-8000-0000000000e2';
  old_team text := '40000000-0000-4000-8000-0000000000e3';
  p2_team  text := '40000000-0000-4000-8000-0000000000e4';
  score text;
begin
  -- Projects: the owner makes them; nobody else does.
  perform pg_temp.ok(o, format($q$insert into projects (id, course_id, title)
    values (%L, '20000000-0000-4000-8000-0000000000c1', '  Project fair  ')$q$, pj),
    'the owner makes a project');
  perform pg_temp.eq((select title from projects where id = pj::uuid), 'Project fair', 'its title is trimmed');
  perform pg_temp.refused(t, $q$insert into projects (course_id, title)
    values ('20000000-0000-4000-8000-0000000000c1', 'Mine')$q$, 'a TF doesn''t make projects');
  perform pg_temp.refused(s, $q$insert into projects (course_id, title)
    values ('20000000-0000-4000-8000-0000000000c1', 'Mine')$q$, 'a student doesn''t either');
  perform pg_temp.refused(o, format($q$insert into projects (course_id, title, team_set_id)
    values ('20000000-0000-4000-8000-0000000000c1', 'X', %L)$q$, '30000000-0000-4000-8000-0000000000d3'),
    'a project can''t grade another course''s teams', 'aren''t on this project');
  perform pg_temp.ok(q, format($q$insert into projects (id, course_id, title)
    values (%L, '20000000-0000-4000-8000-0000000000c2', 'Their fair')$q$, p2),
    'another owner makes their own');

  perform pg_temp.sees(o, 'select * from projects', 1, 'the owner sees their project, not the other course''s');
  perform pg_temp.sees(t, 'select * from projects', 1, 'their TF sees it too');
  perform pg_temp.sees(s, 'select * from projects', 0, 'a student sees no projects');
  perform pg_temp.sees(z, 'select * from projects', 0, 'nor does anyone else');
  perform pg_temp.ok(t, format($q$update projects set title = 'Renamed' where id = %L$q$, pj),
    '(a TF tries to rename it)');
  perform pg_temp.eq((select title from projects where id = pj::uuid), 'Project fair', 'so it isn''t renamed');

  -- The rubric: the owner's.
  perform pg_temp.ok(o, format($q$insert into project_categories (id, project_id, position, name, levels) values
    (%L, %L, 0, 'Robustness', '["a","b","c","d","e"]'),
    (%L, %L, 1, 'Time', '["a","b","c","d","e"]')$q$, c1, pj, c2, pj), 'the owner writes the rubric');
  perform pg_temp.refused(t, format($q$insert into project_categories (project_id, name) values (%L, 'Mine')$q$, pj),
    'a TF doesn''t');
  perform pg_temp.refused(o, format($q$insert into project_categories (project_id, name, levels)
    values (%L, 'Short', '["a","b"]')$q$, pj), 'a category has five levels');
  perform pg_temp.sees(t, format('select * from project_categories where project_id = %L', pj), 2,
    'a TF reads the rubric');
  perform pg_temp.sees(s, 'select * from project_categories', 0, 'a student doesn''t');

  -- Grading.
  perform pg_temp.eq((select team_set_id::text from projects where id = pj::uuid), null,
    'before any grade the project follows the current teams');
  perform pg_temp.refused(t, format($q$insert into project_scores (project_id, team_id, slot, category_id, score)
    values (%L, %L, 1, %L, 5)$q$, pj, old_team, c1),
    'the first grade has to be on the class''s current teams', 'current teams');
  perform pg_temp.refused(z, format($q$insert into project_scores (project_id, team_id, slot, category_id, score)
    values (%L, %L, 1, %L, 5)$q$, pj, t1, c1),
    'a stranger is told only that they can''t grade it', 'can''t grade this project');
  perform pg_temp.ok(t, format($q$insert into project_scores (project_id, team_id, slot, category_id, score)
    values (%L, %L, 1, %L, 5)$q$, pj, t1, c1), 'a TF who grades scores a category, no reason yet');
  perform pg_temp.sees(t, format('select * from project_gradings where project_id = %L', pj), 1,
    'the score opened the grading');
  perform pg_temp.eq((select team_set_id::text from projects where id = pj::uuid),
    '30000000-0000-4000-8000-0000000000d1', 'and fixed the teams to the graded team''s set');
  perform pg_temp.eq((select updated_by::text from project_gradings where project_id = pj::uuid and slot = 1),
    t::text, 'the grading says who opened it');

  perform pg_temp.refused(t, format($q$insert into project_scores (project_id, team_id, slot, category_id, score)
    values (%L, %L, 1, %L, 5)$q$, pj, old_team, c1),
    'a team from another set is refused once the set is fixed', 'isn''t one of the teams');
  perform pg_temp.refused(t, format($q$insert into project_scores (project_id, team_id, slot, category_id, score)
    values (%L, %L, 1, %L, 5)$q$, pj, p2_team, c1),
    'a team from another course is refused', 'isn''t on this project''s course');
  perform pg_temp.refused(t, format($q$insert into project_scores (project_id, team_id, slot, category_id, score)
    values (%L, %L, 1, %L, 9)$q$, pj, t1, c2), 'a score goes from 1 to 5');
  perform pg_temp.refused(o, format($q$update projects set team_set_id = '30000000-0000-4000-8000-0000000000d2'
    where id = %L$q$, pj), 'once graded, a project keeps its teams', 'keeps the teams');

  perform pg_temp.refused(s, format($q$insert into project_scores (project_id, team_id, slot, category_id, score)
    values (%L, %L, 2, %L, 1)$q$, pj, t1, c1), 'a student can''t grade their own team');
  perform pg_temp.sees(s, 'select * from project_scores', 0, 'nor read its scores');
  perform pg_temp.sees(s, 'select * from project_gradings', 0, 'nor who graded it');
  perform pg_temp.sees(z, 'select * from project_scores', 0, 'nor can anyone else');

  -- Marking it done needs a name, and a score and a reason in every category.
  perform pg_temp.refused(t, format($q$update project_gradings set grader_name = 'Will', done_at = now()
    where project_id = %L and team_id = %L and slot = 1$q$, pj, t1),
    'not done while a category is unscored', 'every category a score and say why');
  perform pg_temp.ok(t, format($q$insert into project_scores (project_id, team_id, slot, category_id, reason)
    values (%L, %L, 1, %L, '6:47 — a bit slow')$q$, pj, t1, c2), 'a reason saves before its score is picked');
  perform pg_temp.refused(t, format($q$update project_gradings set grader_name = 'Will', done_at = now()
    where project_id = %L and team_id = %L and slot = 1$q$, pj, t1),
    'not done while a reason has no score', 'every category a score');
  perform pg_temp.ok(t, format($q$update project_scores set score = 3
    where project_id = %L and team_id = %L and slot = 1 and category_id = %L$q$, pj, t1, c2), 'then the score');
  perform pg_temp.refused(t, format($q$update project_gradings set grader_name = 'Will', done_at = now()
    where project_id = %L and team_id = %L and slot = 1$q$, pj, t1),
    'not done while a score has no reason', 'say why');
  perform pg_temp.ok(t, format($q$update project_scores set reason = '7 parts, cool pulley that actuates'
    where project_id = %L and team_id = %L and slot = 1 and category_id = %L$q$, pj, t1, c1),
    'the first reason');
  perform pg_temp.refused(t, format($q$update project_gradings set done_at = now()
    where project_id = %L and team_id = %L and slot = 1$q$, pj, t1),
    'not done without a grader''s name', 'who is grading');
  perform pg_temp.ok(t, format($q$update project_gradings set grader_name = '  Will ', done_at = '2000-01-01'
    where project_id = %L and team_id = %L and slot = 1$q$, pj, t1), 'done, with a name');
  perform pg_temp.eq((select grader_name from project_gradings where project_id = pj::uuid and slot = 1),
    'Will', 'the name is trimmed');
  perform pg_temp.eq((select (done_at > now() - interval '1 minute')::text
                        from project_gradings where project_id = pj::uuid and slot = 1),
    'true', 'and done_at is the server''s clock, not the one sent');

  -- While done.
  perform pg_temp.refused(t, format($q$update project_scores set reason = '  '
    where project_id = %L and team_id = %L and slot = 1 and category_id = %L$q$, pj, t1, c1),
    'a done grading''s reason can''t be blanked', 'needs a score and a reason');
  perform pg_temp.refused(t, format($q$delete from project_scores
    where project_id = %L and team_id = %L and slot = 1 and category_id = %L$q$, pj, t1, c1),
    'nor a score deleted', 'reopen it');
  perform pg_temp.refused(t, format($q$update project_scores set score = null
    where project_id = %L and team_id = %L and slot = 1 and category_id = %L$q$, pj, t1, c1),
    'nor a score unpicked', 'needs a score and a reason');
  perform pg_temp.ok(t, format($q$update project_scores set score = 4, reason = 'Changed my mind'
    where project_id = %L and team_id = %L and slot = 1 and category_id = %L$q$, pj, t1, c1),
    'but a score can change, with its reason');
  perform pg_temp.refused(t, format($q$update project_gradings set grader_name = ''
    where project_id = %L and team_id = %L and slot = 1$q$, pj, t1),
    'and the name can''t go', 'who is grading');
  perform pg_temp.refused(t, format($q$delete from project_gradings
    where project_id = %L and team_id = %L and slot = 1$q$, pj, t1),
    'nor can the grading be thrown away', 'reopen it before clearing');

  -- A read-only TF reads, and writes nothing.
  perform pg_temp.sees(r, 'select * from projects', 1, 'a TF who can''t grade still sees their course''s project');
  perform pg_temp.refused(r, format($q$insert into project_gradings (project_id, team_id, slot, grader_name)
    values (%L, %L, 1, 'R')$q$, p2, p2_team), 'but can''t grade on it');
  perform pg_temp.refused(t, format($q$insert into project_gradings (project_id, team_id, slot, grader_name)
    values (%L, %L, 1, 'T')$q$, p2, p2_team), 'nor can a TF from another course');

  -- A second grader on the same team.
  perform pg_temp.ok(o, format($q$insert into project_gradings (project_id, team_id, slot, grader_name)
    values (%L, %L, 2, 'Kelly')$q$, pj, t1), 'the owner takes grader 2');
  perform pg_temp.ok(o, format($q$insert into project_scores (project_id, team_id, slot, category_id, score, reason)
    values (%L, %L, 2, %L, 5, 'Solid'), (%L, %L, 2, %L, 5, 'Fast')
    on conflict (project_id, team_id, slot, category_id) do update set score = excluded.score, reason = excluded.reason$q$,
    pj, t1, c1, pj, t1, c2), 'and scores both, as an upsert');
  perform pg_temp.ok(o, format($q$update project_gradings set done_at = now()
    where project_id = %L and team_id = %L and slot = 2$q$, pj, t1), 'and marks it done');
  perform pg_temp.ok(o, format($q$update project_gradings set done_at = null
    where project_id = %L and team_id = %L and slot = 2$q$, pj, t1), 'reopening it is always allowed');
  perform pg_temp.ok(o, format($q$delete from project_scores
    where project_id = %L and team_id = %L and slot = 2 and category_id = %L$q$, pj, t1, c2),
    'and a reopened grading''s score can be cleared');

  -- A new category reopens every done grading.
  perform pg_temp.ok(o, format($q$insert into project_categories (id, project_id, position, name)
    values (%L, %L, 2, 'Presentation')$q$, c3, pj), 'the owner adds a category mid-fair');
  perform pg_temp.eq((select count(*)::text from project_gradings where project_id = pj::uuid and done_at is not null),
    '0', 'so the done grading is back in progress');

  -- Removing a category takes its scores, done or not.
  perform pg_temp.ok(o, format($q$insert into project_scores (project_id, team_id, slot, category_id, score, reason)
    values (%L, %L, 1, %L, 2, 'Mumbled')$q$, pj, t1, c3), '(graded the new one)');
  perform pg_temp.ok(t, format($q$update project_gradings set done_at = now()
    where project_id = %L and team_id = %L and slot = 1$q$, pj, t1), '(and marked it done again)');
  perform pg_temp.ok(o, format('delete from project_categories where id = %L', c3), 'the owner removes a category');
  perform pg_temp.eq((select count(*)::text from project_scores where category_id = c3::uuid), '0',
    'its scores went with it');
  perform pg_temp.eq((select (done_at is not null)::text from project_gradings
                       where project_id = pj::uuid and team_id = t1::uuid and slot = 1),
    'true', 'and the grading stays done');

  -- Deleting.
  perform pg_temp.ok(t, format($q$delete from projects where id = %L$q$, pj),
    '(a TF tries to delete the project)');
  perform pg_temp.eq((select count(*)::text from projects where id = pj::uuid), '1', 'so it''s still there');
  perform pg_temp.ok(t, format($q$delete from project_gradings
    where project_id = %L and team_id = %L and slot = 2$q$, pj, t1), 'a grader can clear a grading');
  perform pg_temp.ok(o, format('delete from projects where id = %L', pj), 'the owner deletes the project');
  perform pg_temp.eq((select count(*)::text from project_scores where project_id = pj::uuid), '0',
    'taking every grade with it');

  -- Teams going: their grades go with them, and a graded project's team set
  -- can still be deleted.
  perform pg_temp.ok(o, format($q$insert into projects (id, course_id, title)
    values (%L, '20000000-0000-4000-8000-0000000000c1', 'Second fair')$q$, p3), '(another project)');
  perform pg_temp.ok(o, format($q$insert into project_categories (id, project_id, name) values (%L, %L, 'Only')$q$,
    c4, p3), '(with one category)');
  perform pg_temp.ok(t, format($q$insert into project_scores (project_id, team_id, slot, category_id, score, reason)
    values (%L, %L, 1, %L, 4, 'Fine'), (%L, %L, 1, %L, 3, 'Okay')$q$, p3, t1, c4, p3, t2, c4),
    '(two teams graded)');
  perform pg_temp.ok(t, format($q$update project_gradings set grader_name = 'Will', done_at = now()
    where project_id = %L$q$, p3), '(both done)');
  perform pg_temp.ok(o, format('delete from teams where id = %L', t2), 'the owner deletes a graded team');
  perform pg_temp.eq((select count(*)::text from project_gradings where team_id = t2::uuid), '0',
    'its grades went with it');
  perform pg_temp.ok(o, $q$delete from team_sets where id = '30000000-0000-4000-8000-0000000000d1'$q$,
    'the owner deletes the set the project was graded on');
  perform pg_temp.eq((select coalesce(team_set_id::text, 'none') from projects where id = p3::uuid), 'none',
    'the project follows the class''s teams again');
  perform pg_temp.eq((select count(*)::text from project_gradings where project_id = p3::uuid), '0',
    'and the grades on those teams are gone');

  -- Helpers.
  perform pg_temp.refused(t, 'select guard_project_score()', 'the trigger functions aren''t callable');
end $$;

\echo 'All project checks passed.'
rollback;
