-- What 0052 promises: the leader's taps on the roll are saved as they land,
-- so the team sees them, without finishing the roll; finishing it is 0051's
-- call, which still works as it did.
--
--   psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f supabase/tests/0052_live_roll_for_everyone.sql
--
-- LOCAL DATABASE ONLY, after every migration through 0052. Everything runs in
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

-- ------------------------------------------------------------- fixtures
-- O instructor; A1 A2 A3 on team A, B1 B2 on team B.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000000001', 'o@roll.test'),
  ('00000000-0000-4000-8000-000000000011', 'a1@roll.test'),
  ('00000000-0000-4000-8000-000000000012', 'a2@roll.test'),
  ('00000000-0000-4000-8000-000000000013', 'a3@roll.test'),
  ('00000000-0000-4000-8000-000000000021', 'b1@roll.test'),
  ('00000000-0000-4000-8000-000000000022', 'b2@roll.test');

insert into courses (id, name, owner_id) values
  ('20000000-0000-4000-8000-000000000001', 'Roll course', '00000000-0000-4000-8000-000000000001');

insert into students (id, course_id, name, email, user_id) values
  ('10000000-0000-4000-8000-000000000011', '20000000-0000-4000-8000-000000000001', 'A1', 'a1@roll.test', '00000000-0000-4000-8000-000000000011'),
  ('10000000-0000-4000-8000-000000000012', '20000000-0000-4000-8000-000000000001', 'A2', 'a2@roll.test', '00000000-0000-4000-8000-000000000012'),
  ('10000000-0000-4000-8000-000000000013', '20000000-0000-4000-8000-000000000001', 'A3', 'a3@roll.test', '00000000-0000-4000-8000-000000000013'),
  ('10000000-0000-4000-8000-000000000021', '20000000-0000-4000-8000-000000000001', 'B1', 'b1@roll.test', '00000000-0000-4000-8000-000000000021'),
  ('10000000-0000-4000-8000-000000000022', '20000000-0000-4000-8000-000000000001', 'B2', 'b2@roll.test', '00000000-0000-4000-8000-000000000022');

insert into team_sets (id, course_id, name) values
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Teams');
insert into teams (id, team_set_id, name, position) values
  ('40000000-0000-4000-8000-00000000000a', '30000000-0000-4000-8000-000000000001', 'Team A', 0),
  ('40000000-0000-4000-8000-00000000000b', '30000000-0000-4000-8000-000000000001', 'Team B', 1);
insert into team_members (team_id, student_id) values
  ('40000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-000000000011'),
  ('40000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-000000000012'),
  ('40000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-000000000013'),
  ('40000000-0000-4000-8000-00000000000b', '10000000-0000-4000-8000-000000000021'),
  ('40000000-0000-4000-8000-00000000000b', '10000000-0000-4000-8000-000000000022');
update courses set current_team_set_id = '30000000-0000-4000-8000-000000000001'
 where id = '20000000-0000-4000-8000-000000000001';

-- N: run in class. I: still before class, never started.
insert into activities (id, course_id, title, type, opens_at) values
  ('50000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Roll N', 'live', null),
  ('50000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 'Roll I', 'live', null);

-- ------------------------------------------------------------ the checks
do $$
declare
  O  uuid := '00000000-0000-4000-8000-000000000001';
  A1 uuid := '00000000-0000-4000-8000-000000000011';
  A2 uuid := '00000000-0000-4000-8000-000000000012';
  A3 uuid := '00000000-0000-4000-8000-000000000013';
  N  text := '''50000000-0000-4000-8000-000000000001''';
  sA2 text := '''10000000-0000-4000-8000-000000000012''';
  sA3 text := '''10000000-0000-4000-8000-000000000013''';
begin
  perform pg_temp.ok(O, 'select start_live_team(' || N || ')', 'the owner starts team mode');
  perform pg_temp.ok(A1, format('select vote_live_leader(%s, %s)', N, sA2), 'A1 votes A2');
  perform pg_temp.ok(A2, format('select vote_live_leader(%s, %s)', N, sA2), 'A2 votes A2');
  perform pg_temp.ok(A3, format('select vote_live_leader(%s, %s)', N, sA2), 'A3 votes A2: A2 leads');

  perform pg_temp.refused(A1, format('select set_live_absences(%s, array[%s]::uuid[], false)', N, sA3),
    'only the leader taps the roll', 'leader');
  perform pg_temp.ok(A2, format('select set_live_absences(%s, array[%s]::uuid[], false)', N, sA3), 'the leader taps A3 absent');
  perform pg_temp.sees(A1, 'select 1 from tutorial_absences where student_id = ' || sA3, 1, 'A1 sees the tap at once');
  perform pg_temp.sees(A1, 'select 1 from live_team_setup where roll_at is null', 1, 'but the roll isn''t done');
  perform pg_temp.ok(A2, format('select set_live_absences(%s, ''{}''::uuid[], false)', N), 'the leader taps A3 back');
  perform pg_temp.sees(A1, 'select 1 from tutorial_absences', 0, 'A3 is here again');
  perform pg_temp.sees(A1, 'select 1 from live_team_setup where roll_at is null', 1, 'still taking the roll');

  perform pg_temp.ok(A2, format('select set_live_absences(%s, array[%s]::uuid[], true)', N, sA3), 'the leader finishes the roll');
  perform pg_temp.sees(A1, 'select 1 from live_team_setup where roll_at is not null', 1, 'the roll is done');
  perform pg_temp.sees(A1, 'select 1 from tutorial_absences where source = ''roll'' and student_id = ' || sA3, 1, 'with A3 out');

  perform pg_temp.ok(A2, format('select set_live_absences(%s, ''{}''::uuid[])', N), '0051''s call still takes the whole roll');
  perform pg_temp.sees(A1, 'select 1 from tutorial_absences', 0, 'A3 is back');
  perform pg_temp.sees(A1, 'select 1 from live_team_setup where roll_at is not null', 1, 'and the roll stays done');
end $$;

do $$
begin
  if has_function_privilege('anon', 'set_live_absences(uuid, uuid[], boolean)', 'execute')
     or not has_function_privilege('authenticated', 'set_live_absences(uuid, uuid[], boolean)', 'execute')
     or not has_function_privilege('authenticated', 'set_live_absences(uuid, uuid[])', 'execute') then
    raise exception 'FAIL  the roll is for signed-in users only';
  end if;
  raise notice 'ok    the roll is for signed-in users only';
end $$;

\echo 'All live roll checks passed.'
rollback;
