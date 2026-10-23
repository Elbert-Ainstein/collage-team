-- What 0049 promises: a team is told right or wrong as it submits, tries
-- again, and earns less the more tries it took — under both ways of grading.
--
--   psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f supabase/tests/0049_live_team_attempts.sql
--
-- LOCAL DATABASE ONLY, after every migration through 0049. Like the 0047
-- checks, everything runs in one transaction that is rolled back, and each
-- check runs as the `authenticated` role with that person's JWT claims.
--
-- The expression prints below are what src/live/answers.ts makes for "F/2"
-- (the key), "0.5F" and "2F": the points are fixed, so they never change
-- unless TRIALS or the point sequence does — and then these must be made again.

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

/** A result's score, by activity, check-in kind and student or team. */
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

create table pg_temp.prints (name text primary key, print jsonb);
insert into pg_temp.prints values
  ('key', '{"vars":["F"],"values":[0.25006848073101995,1.4009556462527046,0.6115465692065407,0.5131886543301812,1.1617133273564806,0.9158928803707906,0.6616403918767536,1.1900662725977909,1.1938435510703564,0.9285628394822417,1.1056431780362703,1.0448932555946024,1.2709467784831985,0.5525059671152877,0.7177893066395955,1.1348766916826722,1.12255711067587,0.31735912934754007,1.1048869441053304,0.8348695782874104]}'),
  ('half', '{"answer":"0.5F","vars":["F"],"values":[0.25006848073101995,1.4009556462527046,0.6115465692065407,0.5131886543301812,1.1617133273564806,0.9158928803707906,0.6616403918767536,1.1900662725977909,1.1938435510703564,0.9285628394822417,1.1056431780362703,1.0448932555946024,1.2709467784831985,0.5525059671152877,0.7177893066395955,1.1348766916826722,1.12255711067587,0.31735912934754007,1.1048869441053304,0.8348695782874104]}'),
  ('double', '{"answer":"2F","vars":["F"],"values":[1.0002739229240798,5.6038225850108185,2.446186276826163,2.052754617320725,4.646853309425922,3.6635715214831626,2.6465615675070144,4.760265090391163,4.775374204281426,3.714251357928967,4.422572712145081,4.17957302237841,5.083787113932794,2.2100238684611506,2.871157226558382,4.539506766730689,4.49022844270348,1.2694365173901603,4.419547776421322,3.3394783131496415]}');

-- ------------------------------------------------------------- fixtures
-- O instructor; A1 A2 on team A, B1 B2 on team B.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000000001', 'o@tries.test'),
  ('00000000-0000-4000-8000-000000000011', 'a1@tries.test'),
  ('00000000-0000-4000-8000-000000000012', 'a2@tries.test'),
  ('00000000-0000-4000-8000-000000000021', 'b1@tries.test'),
  ('00000000-0000-4000-8000-000000000022', 'b2@tries.test');

insert into courses (id, name, owner_id) values
  ('20000000-0000-4000-8000-000000000001', 'Tries course', '00000000-0000-4000-8000-000000000001');

insert into students (id, course_id, name, email, user_id) values
  ('10000000-0000-4000-8000-000000000011', '20000000-0000-4000-8000-000000000001', 'A1', 'a1@tries.test', '00000000-0000-4000-8000-000000000011'),
  ('10000000-0000-4000-8000-000000000012', '20000000-0000-4000-8000-000000000001', 'A2', 'a2@tries.test', '00000000-0000-4000-8000-000000000012'),
  ('10000000-0000-4000-8000-000000000021', '20000000-0000-4000-8000-000000000001', 'B1', 'b1@tries.test', '00000000-0000-4000-8000-000000000021'),
  ('10000000-0000-4000-8000-000000000022', '20000000-0000-4000-8000-000000000001', 'B2', 'b2@tries.test', '00000000-0000-4000-8000-000000000022');

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

-- L: own + team, anyone submits, answers at close.
-- M: team only, everyone agrees, answers as teams finish.
insert into activities (id, course_id, title, type, opens_at) values
  ('50000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Tries L', 'live', null),
  ('50000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 'Tries M', 'live', null);

-- ------------------------------------------------------------ the checks
do $$
declare
  O  uuid := '00000000-0000-4000-8000-000000000001';
  A1 uuid := '00000000-0000-4000-8000-000000000011';
  A2 uuid := '00000000-0000-4000-8000-000000000012';
  B1 uuid := '00000000-0000-4000-8000-000000000021';
  B2 uuid := '00000000-0000-4000-8000-000000000022';
  L  text := '''50000000-0000-4000-8000-000000000001''';
  M  text := '''50000000-0000-4000-8000-000000000002''';
  q1 text := '''60000000-0000-4000-8000-000000000001''';  -- mc, four options, key B
  q2 text := '''60000000-0000-4000-8000-000000000002''';  -- number 0.3 ± 0.01
  q3 text := '''60000000-0000-4000-8000-000000000003''';  -- expression F/2
  m1 text := '''60000000-0000-4000-8000-000000000011''';  -- mc on M, two options, key A
  sA1 text := '''10000000-0000-4000-8000-000000000011''';
  sA2 text := '''10000000-0000-4000-8000-000000000012''';
  key_print    text := (select print::text from pg_temp.prints where name = 'key');
  half_print   text := (select print::text from pg_temp.prints where name = 'half');
  double_print text := (select print::text from pg_temp.prints where name = 'double');
begin
  perform pg_temp.ok(O, format($q$
    insert into live_questions (id, activity_id, position, kind, stem, options) values
      (%s, %s, 0, 'mc', 'Which?', '["one","two","three","four"]'),
      (%s, %s, 1, 'number', 'How much?', '[]'),
      (%s, %s, 2, 'expression', 'In terms of F?', '[]');
    insert into live_keys (question_id, activity_id, correct_option, answer, tolerance, accept, prints) values
      (%s, %s, 1, null, null, '[]', '[]'),
      (%s, %s, null, 0.3, 0.01, '[]', '[]'),
      (%s, %s, null, null, null, '["F/2"]', jsonb_build_array(%L::jsonb));
    insert into live_questions (id, activity_id, position, kind, stem, options) values
      (%s, %s, 0, 'mc', 'M one', '["yes","no"]');
    insert into live_keys (question_id, activity_id, correct_option) values (%s, %s, 0);
    update live_state set grading = 'team', lock_rule = 'all', show_answers = 'lock' where activity_id = %s;
  $q$, q1, L, q2, L, q3, L, q1, L, q2, L, q3, L, key_print, m1, M, m1, M, M), 'the owner writes questions, keys with prints, and settings');

  perform pg_temp.sees(A1, 'select prints from live_keys', 0, 'a student reads the prints no sooner than the key');

  perform pg_temp.ok(A1, format($q$
    insert into live_responses (question_id, activity_id, student_id, answer) values
      (%s, %s, %s, 'B'), (%s, %s, %s, '0.3'), (%s, %s, %s, 'A');
  $q$, q1, L, sA1, q2, L, sA1, m1, M, sA1), 'A1 answers on their own');

  perform pg_temp.ok(O, 'select start_live_team(' || L || '); select start_live_team(' || M || ')', 'the owner starts team mode on both');

  -- Nobody writes a try but lock_team_answer, or asks what's right.
  perform pg_temp.refused(A1, format('insert into live_attempts (question_id, activity_id, team_id, attempt, answer, correct) values (%s, %s, ''40000000-0000-4000-8000-00000000000a'', 1, ''B'', true)', q1, L),
    'a student cannot write a try');
  perform pg_temp.refused(A1, format('select live_judge(%s, ''B'', null)', q1), 'nor ask whether an answer is right', 'permission denied');

  -- ---- L, multiple choice: wrong, told so, again, right on the second try
  perform pg_temp.ok(A1, format('select cast_vote(%s, ''A''); select lock_team_answer(%s)', q1, q1), 'A1 submits A for the team');
  perform pg_temp.sees(A2, 'select 1 from live_attempts where question_id = ' || q1 || ' and attempt = 1 and correct = false', 1,
    'the team is told at once: A is wrong');
  perform pg_temp.sees(A2, 'select 1 from live_locks where question_id = ' || q1, 0, 'a wrong try doesn''t lock the question');
  perform pg_temp.sees(B1, 'select 1 from live_attempts', 0, 'team B sees none of team A''s tries');
  perform pg_temp.refused(A2, format('select cast_vote(%s, ''A'')', q1), 'a tried answer is off the table', 'already tried');
  perform pg_temp.refused(A1, format('select lock_team_answer(%s)', q1), 'and can''t be submitted again', 'already tried');
  perform pg_temp.ok(A2, format('select cast_vote(%s, ''B''); select lock_team_answer(%s)', q1, q1), 'A2 submits B');
  perform pg_temp.sees(A1, 'select 1 from live_attempts where question_id = ' || q1 || ' and attempt = 2 and correct', 1, 'B is right, on try 2');
  perform pg_temp.sees(A1, 'select 1 from live_locks where question_id = ' || q1 || ' and correct', 1, 'right: the team is done with it');
  perform pg_temp.refused(A1, format('select cast_vote(%s, ''C'')', q1), 'no voting once it''s got', 'already locked');
  perform pg_temp.sees(A1, 'select 1 from live_keys', 0, 'answers at close: no key yet, even with the question got');

  -- ---- L, a number: three wrong tries and it's over
  perform pg_temp.ok(A1, format($q$
    select cast_vote(%s, '0.5'); select lock_team_answer(%s);
    select cast_vote(%s, '0.4'); select lock_team_answer(%s);
  $q$, q2, q2, q2, q2), 'two wrong numbers');
  perform pg_temp.sees(A1, 'select 1 from live_locks where question_id = ' || q2, 0, 'two wrong tries: still going');
  perform pg_temp.ok(A1, format('select cast_vote(%s, ''0.2''); select lock_team_answer(%s)', q2, q2), 'a third wrong number');
  perform pg_temp.sees(A1, 'select 1 from live_locks where question_id = ' || q2 || ' and correct = false', 1, 'out of tries: locked, wrong');
  perform pg_temp.refused(A1, format('select cast_vote(%s, ''0.3'')', q2), 'no fourth try', 'already locked');

  -- ---- L, an expression, decided by prints
  perform pg_temp.ok(A1, format('select cast_vote(%s, ''0.5F''); select lock_team_answer(%s, %L)', q3, q3, half_print),
    'A submits 0.5F with its print');
  perform pg_temp.sees(A1, 'select 1 from live_attempts where question_id = ' || q3 || ' and attempt = 1 and correct', 1,
    '0.5F is right for F/2 on the first try — algebra, by print');

  -- ---- L, team B
  perform pg_temp.ok(B1, format($q$
    select cast_vote(%s, 'C'); select lock_team_answer(%s);
    select cast_vote(%s, 'D'); select lock_team_answer(%s);
    select cast_vote(%s, 'B'); select lock_team_answer(%s);
  $q$, q1, q1, q1, q1, q1, q1), 'team B gets q1 on the third try');
  perform pg_temp.sees(B2, 'select 1 from live_attempts where question_id = ' || q1 || ' and correct', 1, 'right on try 3');
  perform pg_temp.ok(B1, format('select cast_vote(%s, ''2F''); select lock_team_answer(%s, %L)', q3, q3, double_print),
    'team B submits 2F with its print');
  perform pg_temp.sees(B1, 'select 1 from live_attempts where question_id = ' || q3 || ' and not correct', 1, '2F is wrong');
  perform pg_temp.ok(B1, format('select cast_vote(%s, ''3F''); select lock_team_answer(%s, %L)', q3, q3, half_print),
    'team B submits 3F with the print of a right answer');
  perform pg_temp.sees(B1, 'select 1 from live_attempts where question_id = ' || q3 || ' and answer = ''3F'' and not correct', 1,
    'a print of some other answer counts for nothing');
  perform pg_temp.ok(B1, format('select cast_vote(%s, ''F/2''); select lock_team_answer(%s)', q3, q3),
    'team B submits F/2 as the key has it, with no print');
  perform pg_temp.sees(B1, 'select 1 from live_locks where question_id = ' || q3 || ' and correct', 1, 'written as the key: right, on the last try');

  -- ---- M: everyone agrees, answers as teams finish, team only
  perform pg_temp.ok(A1, format('select cast_vote(%s, ''B'')', m1), 'A1 votes B on M');
  perform pg_temp.ok(A2, format('select cast_vote(%s, ''B''); select lock_team_answer(%s)', m1, m1), 'both on B: A2 locks it in');
  perform pg_temp.sees(A1, 'select 1 from live_keys where question_id = ' || m1, 0, 'wrong and not done: no key yet');
  perform pg_temp.ok(A1, format('select cast_vote(%s, ''A'')', m1), 'A1 moves to A');
  perform pg_temp.refused(A1, format('select lock_team_answer(%s)', m1), 'a teammate still on the tried answer isn''t agreeing', 'same answer');
  perform pg_temp.ok(A2, format('select cast_vote(%s, ''A''); select lock_team_answer(%s)', m1, m1), 'both on A: right on try 2');
  perform pg_temp.sees(A1, 'select 1 from live_keys where question_id = ' || m1, 1, 'answers as teams finish: the key, now it''s done');
  perform pg_temp.ok(B1, format('select cast_vote(%s, ''A'')', m1), 'B1 votes A');
  perform pg_temp.ok(B2, format('select cast_vote(%s, ''A''); select lock_team_answer(%s)', m1, m1), 'team B: right first time');

  -- ---- close and score
  perform pg_temp.ok(O, 'select close_live(' || L || '); select close_live(' || M || ')', 'the owner closes both');
  perform pg_temp.ok(O, format('select score_live(%s, %L)', L,
    json_build_object(replace(q3, '''', ''), json_build_object('0.5F', true, '2F', false, '3F', false, 'F/2', true))::text),
    'the owner scores L, expressions decided by the algebra');
  perform pg_temp.ok(O, 'select score_live(' || M || ', ''{}'')', 'and M');
end $$;

do $$
declare
  L  uuid := '50000000-0000-4000-8000-000000000001';
  M  uuid := '50000000-0000-4000-8000-000000000002';
  tA uuid := '40000000-0000-4000-8000-00000000000a';
  tB uuid := '40000000-0000-4000-8000-00000000000b';
  A1 uuid := '10000000-0000-4000-8000-000000000011';
  A2 uuid := '10000000-0000-4000-8000-000000000012';
  r record;
begin
  -- Own + team: own answers by the key, as before.
  perform pg_temp.expect(pg_temp.score(L, 'individual', A1), 2, 'own + team: A1 own score is 2 of 3');
  -- Team A: q1 on try 2 (½), q2 never (0), q3 on try 1 (1).
  perform pg_temp.expect(pg_temp.score(L, 'team', tA), 1.5, 'own + team: team A is ½ + 0 + 1');
  -- Team B: q1 on try 3 (¼), q2 not tried (0), q3 on try 3 (¼).
  perform pg_temp.expect(pg_temp.score(L, 'team', tB), 0.5, 'own + team: team B is ¼ + 0 + ¼');
  perform pg_temp.expect((select max_points from check_ins where activity_id = L and kind = 'team'), 3,
    'the team half is out of the number of questions');

  -- Team only: the same team scoring; own answers for completion.
  perform pg_temp.expect(pg_temp.score(M, 'team', tA), 0.5, 'team only: team A, right on try 2, gets ½');
  perform pg_temp.expect(pg_temp.score(M, 'team', tB), 1, 'team only: team B, right first time, gets 1');
  select r2.is_ci, r2.ci_met, r2.score into r from check_in_results r2 join check_ins c on c.id = r2.check_in_id
   where c.activity_id = M and c.kind = 'individual' and r2.student_id = A1;
  if not (r.is_ci and r.ci_met and r.score is null) then
    raise exception 'FAIL  team only: A1 should be complete, unscored — got % / % / %', r.is_ci, r.ci_met, r.score;
  end if;
  raise notice 'ok    team only: own answers count for completion';
  if (select r2.ci_met from check_in_results r2 join check_ins c on c.id = r2.check_in_id
       where c.activity_id = M and c.kind = 'individual' and r2.student_id = A2) then
    raise exception 'FAIL  team only: A2 never answered and should not be complete';
  end if;
  raise notice 'ok    team only: no own answer, not complete';
end $$;

-- A corrected key re-judges every try: say the answer to q1 was C all along.
do $$
declare
  O  uuid := '00000000-0000-4000-8000-000000000001';
  L  uuid := '50000000-0000-4000-8000-000000000001';
  tA uuid := '40000000-0000-4000-8000-00000000000a';
  tB uuid := '40000000-0000-4000-8000-00000000000b';
begin
  perform pg_temp.ok(O, 'update live_keys set correct_option = 2 where question_id = ''60000000-0000-4000-8000-000000000001''',
    'the owner fixes q1''s key to C');
  perform pg_temp.ok(O, format('select score_live(%L, %L)', L,
    json_build_object('60000000-0000-4000-8000-000000000003', json_build_object('0.5F', true, '2F', false, '3F', false, 'F/2', true))::text),
    'and scores again');
  -- Team A tried A then B: neither is C now.
  perform pg_temp.expect(pg_temp.score(L, 'team', tA), 1, 're-scored: team A loses q1');
  -- Team B tried C first: right on try 1 now.
  perform pg_temp.expect(pg_temp.score(L, 'team', tB), 1.25, 're-scored: team B''s first try was right after all');
end $$;

-- The comparison, on its own.
do $$
declare
  key_  jsonb := (select print from pg_temp.prints where name = 'key');
  half  jsonb := (select print from pg_temp.prints where name = 'half');
  dbl   jsonb := (select print from pg_temp.prints where name = 'double');
begin
  if not live_prints_match(key_, half) then raise exception 'FAIL  F/2 and 0.5F should match'; end if;
  if live_prints_match(key_, dbl) then raise exception 'FAIL  F/2 and 2F should not match'; end if;
  if live_prints_match(key_, '{"vars": "F", "values": []}') then raise exception 'FAIL  a malformed print matched'; end if;
  if live_prints_match(key_, jsonb_set(half, '{vars}', '["G"]')) then raise exception 'FAIL  other variables matched'; end if;
  if live_prints_match(key_, jsonb_set(half, '{values,0}', 'null')) then raise exception 'FAIL  undefined at a point matched'; end if;
  if live_prints_match(key_, jsonb_set(half, '{values,0}', '1e400')) then raise exception 'FAIL  an out-of-range value matched'; end if;
  if live_prints_match(jsonb_build_object('vars', '[]'::jsonb, 'values', to_jsonb(array_fill(null::float8, array[20]))),
                       jsonb_build_object('vars', '[]'::jsonb, 'values', to_jsonb(array_fill(null::float8, array[20])))) then
    raise exception 'FAIL  two prints with nothing to compare matched';
  end if;
  raise notice 'ok    prints compare as samePrint does';

  if live_attempt_credit(1) <> 1 or live_attempt_credit(2) <> 0.5 or live_attempt_credit(3) <> 0.25 or live_attempt_credit(4) <> 0 then
    raise exception 'FAIL  credit should be 1, ½, ¼, 0';
  end if;
  raise notice 'ok    credit is 1, ½, ¼, then nothing';
end $$;

-- Nobody signed out calls any of it, and the key's helpers nobody at all.
do $$
declare f text;
begin
  for f in select p.oid::regprocedure::text from pg_proc p
            where p.pronamespace = 'public'::regnamespace
              and (p.proname like 'live\_%' or p.proname in ('cast_vote', 'lock_team_answer', 'score_live'))
  loop
    if has_function_privilege('anon', f, 'execute') then
      raise exception 'FAIL  anon can call %', f;
    end if;
  end loop;
  foreach f in array array['live_judge(uuid, text, jsonb)', 'live_prints_match(jsonb, jsonb)', 'live_print_ok(jsonb)',
                           'live_attempt_credit(integer)', 'live_max_attempts(uuid)'] loop
    if has_function_privilege('authenticated', f, 'execute') then
      raise exception 'FAIL  signed-in users can call %', f;
    end if;
  end loop;
  if to_regprocedure('public.lock_team_answer(uuid)') is not null then
    raise exception 'FAIL  the one-argument lock_team_answer is still there beside the new one';
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'live_attempts') then
    raise exception 'FAIL  live_attempts is not published to realtime';
  end if;
  raise notice 'ok    nothing callable by anon; the key''s helpers by nobody; tries published';
end $$;

-- Deleting still cascades: the activity takes its tries with it.
do $$
begin
  perform pg_temp.ok('00000000-0000-4000-8000-000000000001',
    'delete from activities where id = ''50000000-0000-4000-8000-000000000001''', 'the owner deletes L');
  if exists (select 1 from live_attempts where activity_id = '50000000-0000-4000-8000-000000000001') then
    raise exception 'FAIL  deleting the activity left its tries behind';
  end if;
  raise notice 'ok    its tries went with it';
end $$;

\echo 'All live team-tries checks passed.'
rollback;
