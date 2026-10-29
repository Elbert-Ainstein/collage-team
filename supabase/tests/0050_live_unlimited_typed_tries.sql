-- What 0050 promises: a team keeps trying a typed answer for as long as it
-- likes (a hundred tries), still earns 1, 0.5, 0.25, then nothing, and may
-- move on once another try is worth nothing. Multiple choice is as 0049 left it.
--
--   psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f supabase/tests/0050_live_unlimited_typed_tries.sql
--
-- LOCAL DATABASE ONLY, after every migration through 0050. Everything runs in
-- one transaction that is rolled back, and each check runs as the
-- `authenticated` role with that person's JWT claims. (0049's own checks
-- expect a typed answer to stop at three tries, so they fail once this is in.)

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

/** A result's score, by activity, check-in kind and team. */
create function pg_temp.score(aid uuid, half text, subject uuid) returns numeric language sql as $$
  select r.score from check_in_results r join check_ins c on c.id = r.check_in_id
   where c.activity_id = aid and c.kind = half and (r.student_id = subject or r.team_id = subject);
$$;

create function pg_temp.expect(got numeric, want numeric, label text) returns void language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'FAIL  % — got %, expected %', label, got, want;
  end if;
  raise notice 'ok    % (%)', label, got;
end $$;

-- ------------------------------------------------------------- fixtures
-- O instructor; A1 A2 on team A, B1 B2 on team B.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000000001', 'o@more.test'),
  ('00000000-0000-4000-8000-000000000011', 'a1@more.test'),
  ('00000000-0000-4000-8000-000000000012', 'a2@more.test'),
  ('00000000-0000-4000-8000-000000000021', 'b1@more.test'),
  ('00000000-0000-4000-8000-000000000022', 'b2@more.test');

insert into courses (id, name, owner_id) values
  ('20000000-0000-4000-8000-000000000001', 'More tries course', '00000000-0000-4000-8000-000000000001');

insert into students (id, course_id, name, email, user_id) values
  ('10000000-0000-4000-8000-000000000011', '20000000-0000-4000-8000-000000000001', 'A1', 'a1@more.test', '00000000-0000-4000-8000-000000000011'),
  ('10000000-0000-4000-8000-000000000012', '20000000-0000-4000-8000-000000000001', 'A2', 'a2@more.test', '00000000-0000-4000-8000-000000000012'),
  ('10000000-0000-4000-8000-000000000021', '20000000-0000-4000-8000-000000000001', 'B1', 'b1@more.test', '00000000-0000-4000-8000-000000000021'),
  ('10000000-0000-4000-8000-000000000022', '20000000-0000-4000-8000-000000000001', 'B2', 'b2@more.test', '00000000-0000-4000-8000-000000000022');

insert into team_sets (id, course_id, name) values
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Teams');
insert into teams (id, team_set_id, name, position) values
  ('40000000-0000-4000-8000-00000000000a', '30000000-0000-4000-8000-000000000001', 'Team A', 0),
  ('40000000-0000-4000-8000-00000000000b', '30000000-0000-4000-8000-000000000001', 'Team B', 1);
insert into team_members (team_id, student_id) values
  ('40000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-000000000011'),
  ('40000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-000000000012'),
  ('40000000-0000-4000-8000-00000000000b', '10000000-0000-4000-8000-000000000021'),
  ('40000000-0000-4000-8000-00000000000b', '10000000-0000-4000-8000-000000000022');
update courses set current_team_set_id = '30000000-0000-4000-8000-000000000001'
 where id = '20000000-0000-4000-8000-000000000001';

-- N: own + team, anyone submits, answers at close.
-- P: team only, everyone agrees, answers as teams finish.
insert into activities (id, course_id, title, type, opens_at) values
  ('50000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'More N', 'live', null),
  ('50000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 'More P', 'live', null);

-- ------------------------------------------------------------ the checks
do $$
declare
  O  uuid := '00000000-0000-4000-8000-000000000001';
  A1 uuid := '00000000-0000-4000-8000-000000000011';
  A2 uuid := '00000000-0000-4000-8000-000000000012';
  B1 uuid := '00000000-0000-4000-8000-000000000021';
  B2 uuid := '00000000-0000-4000-8000-000000000022';
  N  text := '''50000000-0000-4000-8000-000000000001''';
  P  text := '''50000000-0000-4000-8000-000000000002''';
  n1 text := '''60000000-0000-4000-8000-000000000001''';  -- number 0.3 ± 0.01
  n2 text := '''60000000-0000-4000-8000-000000000002''';  -- expression F/2
  n3 text := '''60000000-0000-4000-8000-000000000003''';  -- mc, two options, no right one in the key
  n4 text := '''60000000-0000-4000-8000-000000000004''';  -- mc, four options, key D
  p1 text := '''60000000-0000-4000-8000-000000000011''';  -- number 5
  wrong text;
  i int;
begin
  perform pg_temp.ok(O, format($q$
    insert into live_questions (id, activity_id, position, kind, stem, options) values
      (%s, %s, 0, 'number', 'How much?', '[]'),
      (%s, %s, 1, 'expression', 'In terms of F?', '[]'),
      (%s, %s, 2, 'mc', 'Which?', '["yes","no"]'),
      (%s, %s, 3, 'mc', 'Which of four?', '["one","two","three","four"]');
    insert into live_keys (question_id, activity_id, correct_option, answer, tolerance, accept) values
      (%s, %s, null, 0.3, 0.01, '[]'),
      (%s, %s, null, null, null, '["F/2"]'),
      (%s, %s, null, null, null, '[]'),
      (%s, %s, 3, null, null, '[]');
    insert into live_questions (id, activity_id, position, kind, stem, options) values
      (%s, %s, 0, 'number', 'How many?', '[]');
    insert into live_keys (question_id, activity_id, answer, tolerance) values (%s, %s, 5, 0);
    update live_state set grading = 'team', lock_rule = 'all', show_answers = 'lock' where activity_id = %s;
  $q$, n1, N, n2, N, n3, N, n4, N, n1, N, n2, N, n3, N, n4, N, p1, P, p1, P, P), 'the owner writes questions, keys and settings');

  perform pg_temp.refused(A1, format('select move_team_on(%s)', n1), 'nobody moves on before team mode', 'isn''t running');
  perform pg_temp.ok(O, 'select start_live_team(' || N || '); select start_live_team(' || P || ')', 'the owner starts team mode on both');

  -- ---- N, team A, an expression: moving on is refused while a try still pays
  perform pg_temp.ok(A1, format('select cast_vote(%s, ''2F''); select lock_team_answer(%s)', n2, n2), 'A submits 2F, wrong');
  perform pg_temp.refused(A1, format('select move_team_on(%s)', n2), 'one wrong try: the next is worth 0.5, so no moving on', 'still points');
  perform pg_temp.ok(A2, format('select cast_vote(%s, ''F/2''); select lock_team_answer(%s)', n2, n2), 'A submits F/2');
  perform pg_temp.sees(A1, 'select 1 from live_locks where question_id = ' || n2 || ' and correct', 1, 'right on try 2');

  -- ---- N, team A, a number: past three tries, and past eight
  perform pg_temp.ok(A1, format($q$
    select cast_vote(%s, '0.5'); select lock_team_answer(%s);
    select cast_vote(%s, '0.4'); select lock_team_answer(%s);
    select cast_vote(%s, '0.2'); select lock_team_answer(%s);
  $q$, n1, n1, n1, n1, n1, n1), 'three wrong numbers');
  perform pg_temp.sees(A1, 'select 1 from live_locks where question_id = ' || n1, 0, 'three wrong tries: still going');
  foreach wrong in array array['0.1', '0.6', '0.7', '0.8', '0.9', '1', '1.1'] loop
    perform pg_temp.ok(A1, format('select cast_vote(%s, %L); select lock_team_answer(%s)', n1, wrong, n1), 'another wrong number: ' || wrong);
  end loop;
  perform pg_temp.sees(A1, 'select 1 from live_attempts where question_id = ' || n1, 10, 'ten tries, all kept');
  perform pg_temp.sees(A1, 'select 1 from live_locks where question_id = ' || n1, 0, 'ten wrong tries: still going');
  perform pg_temp.refused(A1, format('select cast_vote(%s, ''0.5'')', n1), 'a tried answer is still off the table', 'already tried');
  perform pg_temp.ok(A2, format('select cast_vote(%s, ''0.3''); select lock_team_answer(%s)', n1, n1), 'A finds 0.3 on try 11');
  perform pg_temp.sees(A1, 'select 1 from live_attempts where question_id = ' || n1 || ' and attempt = 11 and correct', 1, 'right, on try 11');
  perform pg_temp.sees(A1, 'select 1 from live_locks where question_id = ' || n1 || ' and correct', 1, 'and the team is done with it');

  -- ---- N, team A, multiple choice still stops once every option is tried
  perform pg_temp.ok(A1, format($q$
    select cast_vote(%s, 'A'); select lock_team_answer(%s);
    select cast_vote(%s, 'B'); select lock_team_answer(%s);
  $q$, n3, n3, n3, n3), 'A tries both options');
  perform pg_temp.sees(A1, 'select 1 from live_locks where question_id = ' || n3 || ' and correct = false', 1, 'every option tried: locked, wrong');

  -- ---- N, team B, a number: three wrong, then moves on
  perform pg_temp.refused(B1, format('select move_team_on(%s)', n1), 'no moving on without a try', 'still points');
  perform pg_temp.ok(B1, format($q$
    select cast_vote(%s, '0.5'); select lock_team_answer(%s);
    select cast_vote(%s, '0.4'); select lock_team_answer(%s);
    select cast_vote(%s, '0.2'); select lock_team_answer(%s);
  $q$, n1, n1, n1, n1, n1, n1), 'team B: three wrong numbers');
  perform pg_temp.ok(B2, format('select move_team_on(%s)', n1), 'B2 moves the team on');
  perform pg_temp.sees(B1, 'select 1 from live_locks where question_id = ' || n1 || ' and correct = false and answer = ''0.2''', 1,
    'moved on: locked, wrong, on the last try');
  perform pg_temp.sees(B1, 'select 1 from live_attempts where question_id = ' || n1, 3, 'moving on is not a try');
  perform pg_temp.refused(B1, format('select cast_vote(%s, ''0.3'')', n1), 'no voting once moved on', 'already locked');
  perform pg_temp.refused(B1, format('select move_team_on(%s)', n1), 'nor moving on twice', 'already locked');
  perform pg_temp.sees(B1, 'select 1 from live_keys', 0, 'answers at close: no key for moving on');
  perform pg_temp.sees(A1, 'select 1 from live_locks where team_id = ''40000000-0000-4000-8000-00000000000b''', 0,
    'team A sees nothing of team B moving on');

  -- ---- N, team B, multiple choice: no moving on, the options run out instead
  perform pg_temp.ok(B1, format($q$
    select cast_vote(%s, 'A'); select lock_team_answer(%s);
    select cast_vote(%s, 'B'); select lock_team_answer(%s);
    select cast_vote(%s, 'C'); select lock_team_answer(%s);
  $q$, n4, n4, n4, n4, n4, n4), 'team B: three wrong options');
  perform pg_temp.refused(B1, format('select move_team_on(%s)', n4), 'multiple choice never moves on', 'options that are left');
  perform pg_temp.ok(B2, format('select cast_vote(%s, ''D''); select lock_team_answer(%s)', n4, n4), 'team B finds D on try 4');
  perform pg_temp.sees(B1, 'select 1 from live_locks where question_id = ' || n4 || ' and correct', 1, 'right, for nothing');

  -- ---- N, team B, an expression: a hundred tries is the ceiling
  for i in 1 .. 99 loop
    perform pg_temp.ok(B1, format('select cast_vote(%s, %L); select lock_team_answer(%s)', n2, 'F+' || i, n2), 'wrong expression ' || i);
  end loop;
  perform pg_temp.sees(B1, 'select 1 from live_locks where question_id = ' || n2, 0, 'ninety-nine wrong tries: still going');
  perform pg_temp.ok(B1, format('select cast_vote(%s, ''F+100''); select lock_team_answer(%s)', n2, n2), 'a hundredth wrong try');
  perform pg_temp.sees(B1, 'select 1 from live_locks where question_id = ' || n2 || ' and correct = false', 1,
    'a hundred tries: locked, wrong');
  perform pg_temp.refused(B1, format('select cast_vote(%s, ''F/2'')', n2), 'no hundred-and-first', 'already locked');

  -- ---- P: everyone agrees to submit, but anyone may move on
  perform pg_temp.ok(A1, format('select cast_vote(%s, ''1'')', p1), 'A1 votes 1');
  perform pg_temp.ok(A2, format('select cast_vote(%s, ''1''); select lock_team_answer(%s)', p1, p1), 'both on 1: wrong');
  perform pg_temp.ok(A1, format('select cast_vote(%s, ''2'')', p1), 'A1 votes 2');
  perform pg_temp.ok(A2, format('select cast_vote(%s, ''2''); select lock_team_answer(%s)', p1, p1), 'both on 2: wrong');
  perform pg_temp.ok(A1, format('select cast_vote(%s, ''3'')', p1), 'A1 votes 3');
  perform pg_temp.ok(A2, format('select cast_vote(%s, ''3''); select lock_team_answer(%s)', p1, p1), 'both on 3: wrong');
  perform pg_temp.sees(A1, 'select 1 from live_keys where question_id = ' || p1, 0, 'three wrong and not done: no key yet');
  perform pg_temp.ok(A1, format('select cast_vote(%s, ''4'')', p1), 'A1 votes 4 on their own');
  perform pg_temp.ok(A1, format('select move_team_on(%s)', p1), 'A1 moves the team on without A2 agreeing');
  perform pg_temp.sees(A1, 'select 1 from live_keys where question_id = ' || p1, 1, 'answers as teams finish: the key, now it''s done');
  perform pg_temp.ok(B1, format('select cast_vote(%s, ''5'')', p1), 'B1 votes 5');
  perform pg_temp.ok(B2, format('select cast_vote(%s, ''5''); select lock_team_answer(%s)', p1, p1), 'team B: right first time');

  -- ---- close and score
  perform pg_temp.ok(O, 'select close_live(' || N || '); select close_live(' || P || ')', 'the owner closes both');
  perform pg_temp.ok(O, format('select score_live(%s, %L)', N,
    json_build_object(replace(n2, '''', ''), json_build_object('2F', false, 'F/2', true))::text), 'the owner scores N');
  perform pg_temp.ok(O, 'select score_live(' || P || ', ''{}'')', 'and P');
end $$;

do $$
declare
  N  uuid := '50000000-0000-4000-8000-000000000001';
  P  uuid := '50000000-0000-4000-8000-000000000002';
  tA uuid := '40000000-0000-4000-8000-00000000000a';
  tB uuid := '40000000-0000-4000-8000-00000000000b';
begin
  -- Team A: n1 on try 11 (0), n2 on try 2 (0.5), n3 never (0).
  perform pg_temp.expect(pg_temp.score(N, 'team', tA), 0.5, 'team A is 0 + 0.5 + 0: try 11 earns nothing');
  -- Team B: n1 moved on (0), n2 out of tries (0), n4 on try 4 (0).
  perform pg_temp.expect(pg_temp.score(N, 'team', tB), 0, 'team B, moved on and out of tries, is 0');
  perform pg_temp.expect(pg_temp.score(P, 'team', tA), 0, 'team only: moved on after three is 0');
  perform pg_temp.expect(pg_temp.score(P, 'team', tB), 1, 'team only: right first time is 1');
  if live_attempt_credit(1) <> 1 or live_attempt_credit(2) <> 0.5 or live_attempt_credit(3) <> 0.25
     or live_attempt_credit(4) <> 0 or live_attempt_credit(40) <> 0 then
    raise exception 'FAIL  credit should still be 1, 0.5, 0.25, then nothing';
  end if;
  raise notice 'ok    credit is still 1, 0.5, 0.25, then nothing';
end $$;

-- Who may call it.
do $$
begin
  if has_function_privilege('anon', 'move_team_on(uuid)', 'execute') then
    raise exception 'FAIL  anon can call move_team_on';
  end if;
  if not has_function_privilege('authenticated', 'move_team_on(uuid)', 'execute') then
    raise exception 'FAIL  a signed-in student cannot call move_team_on';
  end if;
  if has_function_privilege('authenticated', 'live_max_attempts(uuid)', 'execute') then
    raise exception 'FAIL  signed-in users can call live_max_attempts';
  end if;
  if not has_function_privilege('authenticated', 'lock_team_answer(uuid, jsonb)', 'execute') then
    raise exception 'FAIL  a signed-in student cannot submit a try';
  end if;
  if to_regprocedure('public.lock_team_answer(uuid)') is not null then
    raise exception 'FAIL  the one-argument lock_team_answer is back';
  end if;
  raise notice 'ok    move_team_on for signed-in users only; the rest as 0049 left it';
end $$;

\echo 'All live unlimited-tries checks passed.'
rollback;
