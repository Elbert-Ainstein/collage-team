-- What 0056 promises: a select-all-that-apply question takes a set of options
-- as its answer, in one spelling; is marked all or nothing, own answers and
-- team tries alike; and is tried in team mode like a typed answer — as many
-- tries as the team likes, and moving on once one is worth nothing.
--
--   psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f supabase/tests/0056_live_select_multiple.sql
--
-- LOCAL DATABASE ONLY, after every migration through 0056. Everything runs in
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

/** A result's score, by activity, check-in kind and subject. */
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
  ('00000000-0000-4000-8000-000000000001', 'o@multi.test'),
  ('00000000-0000-4000-8000-000000000011', 'a1@multi.test'),
  ('00000000-0000-4000-8000-000000000012', 'a2@multi.test'),
  ('00000000-0000-4000-8000-000000000021', 'b1@multi.test'),
  ('00000000-0000-4000-8000-000000000022', 'b2@multi.test');

insert into courses (id, name, owner_id) values
  ('20000000-0000-4000-8000-000000000001', 'Select multiple course', '00000000-0000-4000-8000-000000000001');

insert into students (id, course_id, name, email, user_id) values
  ('10000000-0000-4000-8000-000000000011', '20000000-0000-4000-8000-000000000001', 'A1', 'a1@multi.test', '00000000-0000-4000-8000-000000000011'),
  ('10000000-0000-4000-8000-000000000012', '20000000-0000-4000-8000-000000000001', 'A2', 'a2@multi.test', '00000000-0000-4000-8000-000000000012'),
  ('10000000-0000-4000-8000-000000000021', '20000000-0000-4000-8000-000000000001', 'B1', 'b1@multi.test', '00000000-0000-4000-8000-000000000021'),
  ('10000000-0000-4000-8000-000000000022', '20000000-0000-4000-8000-000000000001', 'B2', 'b2@multi.test', '00000000-0000-4000-8000-000000000022');

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

insert into activities (id, course_id, title, type, opens_at) values
  ('50000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Forces', 'live', null);

-- ------------------------------------------------------------ the checks
do $$
declare
  O  uuid := '00000000-0000-4000-8000-000000000001';
  A1 uuid := '00000000-0000-4000-8000-000000000011';
  A2 uuid := '00000000-0000-4000-8000-000000000012';
  B1 uuid := '00000000-0000-4000-8000-000000000021';
  B2 uuid := '00000000-0000-4000-8000-000000000022';
  sA1 uuid := '10000000-0000-4000-8000-000000000011';
  sB1 uuid := '10000000-0000-4000-8000-000000000021';
  tA uuid := '40000000-0000-4000-8000-00000000000a';
  tB uuid := '40000000-0000-4000-8000-00000000000b';
  N  uuid := '50000000-0000-4000-8000-000000000001';
  q1 text := '''60000000-0000-4000-8000-000000000001''';  -- multi, four options, key A and C
  q2 text := '''60000000-0000-4000-8000-000000000002''';  -- mc, as before
begin
  -- ---- the kind and its key
  perform pg_temp.ok(O, format($q$
    insert into live_questions (id, activity_id, position, kind, stem, options) values
      (%s, %L, 0, 'multi', 'Which forces act?', '["gravity","normal","friction","tension"]'),
      (%s, %L, 1, 'mc', 'Which?', '["yes","no"]');
    insert into live_keys (question_id, activity_id, correct_options) values (%s, %L, '[2, 0]');
    insert into live_keys (question_id, activity_id, correct_option) values (%s, %L, 1);
  $q$, q1, N, q2, N, q1, N, q2, N), 'the owner writes a select-multiple question and its key');

  perform pg_temp.refused(O, format('update live_keys set correct_options = ''[0, 9]'' where question_id = %s', q1),
    'a key naming a ninth option is refused', 'correct_options');
  perform pg_temp.refused(O, format('update live_keys set correct_options = ''[0, 0]'' where question_id = %s', q1),
    'a key naming an option twice is refused', 'correct_options');
  perform pg_temp.refused(O, format('update live_keys set correct_options = ''["A"]'' where question_id = %s', q1),
    'a key of letters is refused: indexes only', 'correct_options');
  perform pg_temp.refused(O, format('update live_questions set kind = ''ranking'' where id = %s', q1),
    'a kind the activity cannot ask is still refused', 'kind');

  -- ---- own answers: one spelling, within the options
  perform pg_temp.ok(A1, format($q$
    insert into live_responses (question_id, activity_id, student_id, answer) values (%s, %L, %L, 'AC')
  $q$, q1, N, sA1), 'A1 answers A and C, written AC');
  perform pg_temp.refused(A1, format('update live_responses set answer = ''CA'' where question_id = %s and student_id = %L', q1, sA1),
    'CA is not how a set is written', 'can''t be used');
  perform pg_temp.refused(A1, format('update live_responses set answer = ''AA'' where question_id = %s and student_id = %L', q1, sA1),
    'nor is an option twice', 'can''t be used');
  perform pg_temp.refused(A1, format('update live_responses set answer = ''AE'' where question_id = %s and student_id = %L', q1, sA1),
    'nor an option the question hasn''t got', 'can''t be used');
  perform pg_temp.refused(A1, format('update live_responses set answer = '''' where question_id = %s and student_id = %L', q1, sA1),
    'nor no option at all', 'answer');
  perform pg_temp.ok(A1, format('update live_responses set answer = ''ABCD'' where question_id = %s and student_id = %L', q1, sA1),
    'every option at once is an answer');
  perform pg_temp.ok(A1, format('update live_responses set answer = ''AC'' where question_id = %s and student_id = %L', q1, sA1),
    'and back to A and C');
  perform pg_temp.ok(B1, format($q$
    insert into live_responses (question_id, activity_id, student_id, answer) values (%s, %L, %L, 'A')
  $q$, q1, N, sB1), 'B1 answers A alone');

  -- ---- team mode: told at once, as many tries as it likes, move on once a try pays nothing
  perform pg_temp.ok(O, format('select start_live_team(%L)', N), 'the owner starts team mode');

  perform pg_temp.refused(A1, format('select cast_vote(%s, ''CA'')', q1), 'a vote is held to the one spelling too', 'can''t be used');
  perform pg_temp.ok(A1, format('select cast_vote(%s, ''A''); select lock_team_answer(%s)', q1, q1), 'A submits A alone');
  perform pg_temp.sees(A1, 'select 1 from live_attempts where question_id = ' || q1 || ' and attempt = 1 and correct = false', 1,
    'part of the set is wrong, not most of a point');
  perform pg_temp.sees(A1, 'select 1 from live_locks where question_id = ' || q1, 0, 'and the team goes again');
  perform pg_temp.refused(A1, format('select cast_vote(%s, ''A'')', q1), 'a tried set is off the table', 'already tried');
  perform pg_temp.ok(A1, format('select cast_vote(%s, ''ABC''); select lock_team_answer(%s)', q1, q1), 'A submits A, B and C');
  perform pg_temp.sees(A1, 'select 1 from live_attempts where question_id = ' || q1 || ' and attempt = 2 and correct = false', 1,
    'one option too many is wrong');
  perform pg_temp.refused(A1, format('select move_team_on(%s)', q1), 'two tries in, the third still pays', 'still points');
  perform pg_temp.ok(A2, format('select cast_vote(%s, ''AC''); select lock_team_answer(%s)', q1, q1), 'A2 submits A and C');
  perform pg_temp.sees(A1, 'select 1 from live_attempts where question_id = ' || q1 || ' and attempt = 3 and correct', 1, 'right, on try 3');
  perform pg_temp.sees(A1, 'select 1 from live_locks where question_id = ' || q1 || ' and correct', 1, 'and the team is done with it');

  perform pg_temp.ok(B1, format($q$
    select cast_vote(%s, 'A'); select lock_team_answer(%s);
    select cast_vote(%s, 'B'); select lock_team_answer(%s);
    select cast_vote(%s, 'ABCD'); select lock_team_answer(%s);
    select cast_vote(%s, 'D'); select lock_team_answer(%s);
  $q$, q1, q1, q1, q1, q1, q1, q1, q1), 'team B: four wrong sets, more than four options would allow multiple choice');
  perform pg_temp.sees(B1, 'select 1 from live_locks where question_id = ' || q1, 0, 'four wrong tries: still going, not locked out');
  perform pg_temp.ok(B2, format('select move_team_on(%s)', q1), 'B2 moves the team on');
  perform pg_temp.sees(B1, 'select 1 from live_locks where question_id = ' || q1 || ' and correct = false and answer = ''D''', 1,
    'locked wrong on the last try');

  -- ---- the mc question beside it is as it was
  perform pg_temp.ok(A1, format('select cast_vote(%s, ''A''); select lock_team_answer(%s)', q2, q2), 'A tries A on the multiple choice');
  perform pg_temp.ok(A1, format('select cast_vote(%s, ''B''); select lock_team_answer(%s)', q2, q2), 'then B');
  perform pg_temp.ok(B1, format('select cast_vote(%s, ''B''); select lock_team_answer(%s)', q2, q2), 'B gets it first time');

  -- ---- scored: own answers all or nothing, team credit by the first right try
  perform pg_temp.ok(O, format('select close_live(%L); select score_live(%L)', N, N), 'the owner closes and scores');
  perform pg_temp.expect(pg_temp.score(N, 'individual', sA1), 1, 'A1 own: AC is right');
  perform pg_temp.expect(pg_temp.score(N, 'individual', sB1), 0, 'B1 own: A alone is wrong');
  perform pg_temp.expect(pg_temp.score(N, 'team', tA), 0.25 + 0.5, 'team A: a quarter for try 3, half for the mc on try 2');
  perform pg_temp.expect(pg_temp.score(N, 'team', tB), 1, 'team B: nothing for the set it never found, the mc first time');

  -- ---- a corrected key re-scores
  perform pg_temp.ok(O, format('update live_keys set correct_options = ''[0]'' where question_id = %s', q1), 'the owner decides A alone was right');
  perform pg_temp.ok(O, format('select score_live(%L)', N), 'and scores again');
  perform pg_temp.expect(pg_temp.score(N, 'individual', sB1), 1, 'B1 own: now right');
  perform pg_temp.expect(pg_temp.score(N, 'team', tA), 1 + 0.5, 'team A: A alone was its first try');
end $$;

-- Who may call what.
do $$
begin
  if not has_function_privilege('authenticated', 'live_options_ok(jsonb)', 'execute') then
    raise exception 'FAIL  the owner could not write a key: live_options_ok runs in its check';
  end if;
  if has_function_privilege('authenticated', 'live_multi_answer(jsonb)', 'execute')
     or has_function_privilege('anon', 'live_multi_answer(jsonb)', 'execute') then
    raise exception 'FAIL  live_multi_answer is callable from a client';
  end if;
  if has_function_privilege('authenticated', 'live_answer_correct(uuid, text, jsonb)', 'execute')
     or has_function_privilege('authenticated', 'live_answer_fits(uuid, text)', 'execute') then
    raise exception 'FAIL  the answer checks are callable from a client again';
  end if;
  raise notice 'ok    the key check for signed-in users; the answer checks for nobody';
end $$;

\echo 'All live select-multiple checks passed.'
rollback;
