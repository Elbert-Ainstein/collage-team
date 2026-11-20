-- What 0058 promises: one vote is enough to confirm a leader, so a student
-- whose teammates didn't come can pick themselves and take the roll. Split
-- votes still don't confirm, and the caller must still have voted.
--
--   psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f supabase/tests/0058_live_leader_one_vote.sql
--
-- LOCAL DATABASE ONLY, after every migration through 0058. Everything runs in
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
  ('00000000-0000-4000-8000-000000000001', 'o@onevote.test'),
  ('00000000-0000-4000-8000-000000000011', 'a1@onevote.test'),
  ('00000000-0000-4000-8000-000000000012', 'a2@onevote.test'),
  ('00000000-0000-4000-8000-000000000013', 'a3@onevote.test'),
  ('00000000-0000-4000-8000-000000000021', 'b1@onevote.test'),
  ('00000000-0000-4000-8000-000000000022', 'b2@onevote.test');

insert into courses (id, name, owner_id) values
  ('20000000-0000-4000-8000-000000000001', 'One vote course', '00000000-0000-4000-8000-000000000001');

insert into students (id, course_id, name, email, user_id) values
  ('10000000-0000-4000-8000-000000000011', '20000000-0000-4000-8000-000000000001', 'A1', 'a1@onevote.test', '00000000-0000-4000-8000-000000000011'),
  ('10000000-0000-4000-8000-000000000012', '20000000-0000-4000-8000-000000000001', 'A2', 'a2@onevote.test', '00000000-0000-4000-8000-000000000012'),
  ('10000000-0000-4000-8000-000000000013', '20000000-0000-4000-8000-000000000001', 'A3', 'a3@onevote.test', '00000000-0000-4000-8000-000000000013'),
  ('10000000-0000-4000-8000-000000000021', '20000000-0000-4000-8000-000000000001', 'B1', 'b1@onevote.test', '00000000-0000-4000-8000-000000000021'),
  ('10000000-0000-4000-8000-000000000022', '20000000-0000-4000-8000-000000000001', 'B2', 'b2@onevote.test', '00000000-0000-4000-8000-000000000022');

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

insert into activities (id, course_id, title, type, opens_at) values
  ('50000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'One vote N', 'live', null);

-- ------------------------------------------------------------ the checks
do $$
declare
  O  uuid := '00000000-0000-4000-8000-000000000001';
  A1 uuid := '00000000-0000-4000-8000-000000000011';
  A2 uuid := '00000000-0000-4000-8000-000000000012';
  A3 uuid := '00000000-0000-4000-8000-000000000013';
  B1 uuid := '00000000-0000-4000-8000-000000000021';
  B2 uuid := '00000000-0000-4000-8000-000000000022';
  N  text := '''50000000-0000-4000-8000-000000000001''';
  sA1 text := '''10000000-0000-4000-8000-000000000011''';
  sA2 text := '''10000000-0000-4000-8000-000000000012''';
  sA3 text := '''10000000-0000-4000-8000-000000000013''';
  sB1 text := '''10000000-0000-4000-8000-000000000021''';
  sB2 text := '''10000000-0000-4000-8000-000000000022''';
  tA text := '''40000000-0000-4000-8000-00000000000a''';
  q1 text := '''60000000-0000-4000-8000-000000000001''';  -- number 5
begin
  perform pg_temp.ok(O, format($q$
    insert into live_questions (id, activity_id, position, kind, stem, options) values
      (%s, %s, 0, 'number', 'How many?', '[]');
    insert into live_keys (question_id, activity_id, answer, tolerance) values
      (%s, %s, 5, 0);
  $q$, q1, N, q1, N), 'the owner writes a question and its key');

  perform pg_temp.ok(O, 'select start_live_team(' || N || ')', 'the owner starts team mode on N');

  -- ---- team A: only A1 came
  perform pg_temp.refused(A1, format('select confirm_live_leader(%s)', N), 'nobody confirms before voting', 'vote first');
  perform pg_temp.ok(A1, format('select vote_live_leader(%s, %s)', N, sA1), 'A1 votes A1, alone');
  perform pg_temp.sees(A1, 'select 1 from live_team_setup where team_id = ' || tA || ' and leader_id is not null', 0,
    'one of three: not set by itself');
  perform pg_temp.refused(A2, format('select confirm_live_leader(%s)', N), 'someone who hasn''t voted still can''t confirm', 'vote first');
  perform pg_temp.ok(A1, format('select confirm_live_leader(%s)', N), 'A1 confirms themselves on one vote');
  perform pg_temp.sees(A1, 'select 1 from live_team_setup where team_id = ' || tA || ' and leader_id = ' || sA1, 1, 'A1 leads team A');
  perform pg_temp.ok(A1, format('select set_live_absences(%s, array[%s, %s]::uuid[], true)', N, sA2, sA3),
    'A1 marks A2 and A3 absent on the roll');
  perform pg_temp.ok(A1, format('select cast_vote(%s, ''5''); select lock_team_answer(%s)', q1, q1), 'and submits for the team');

  -- ---- team B: split votes still don't confirm
  perform pg_temp.ok(B1, format('select vote_live_leader(%s, %s)', N, sB1), 'B1 votes B1');
  perform pg_temp.ok(B2, format('select vote_live_leader(%s, %s)', N, sB2), 'B2 votes B2');
  perform pg_temp.refused(B1, format('select confirm_live_leader(%s)', N), 'split votes don''t confirm', 'split');
end $$;

-- Who may call what.
do $$
begin
  if has_function_privilege('anon', 'confirm_live_leader(uuid)', 'execute') then
    raise exception 'FAIL  anon can confirm a leader';
  end if;
  if not has_function_privilege('authenticated', 'confirm_live_leader(uuid)', 'execute') then
    raise exception 'FAIL  a signed-in student cannot confirm their team''s leader';
  end if;
  raise notice 'ok    confirm is for signed-in users only';
end $$;

\echo 'All live one-vote leader checks passed.'
rollback;
