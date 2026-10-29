-- What 0051 promises: a team picks a leader by agreeing on one name, the
-- leader alone takes the roll and submits, an absent student doesn't vote,
-- and an explanation reaches a student only once their team is done with the
-- question — never before class.
--
--   psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f supabase/tests/0051_live_team_leader.sql
--
-- LOCAL DATABASE ONLY, after every migration through 0051. Everything runs in
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
  ('00000000-0000-4000-8000-000000000001', 'o@leader.test'),
  ('00000000-0000-4000-8000-000000000011', 'a1@leader.test'),
  ('00000000-0000-4000-8000-000000000012', 'a2@leader.test'),
  ('00000000-0000-4000-8000-000000000013', 'a3@leader.test'),
  ('00000000-0000-4000-8000-000000000021', 'b1@leader.test'),
  ('00000000-0000-4000-8000-000000000022', 'b2@leader.test');

insert into courses (id, name, owner_id) values
  ('20000000-0000-4000-8000-000000000001', 'Leader course', '00000000-0000-4000-8000-000000000001');

insert into students (id, course_id, name, email, user_id) values
  ('10000000-0000-4000-8000-000000000011', '20000000-0000-4000-8000-000000000001', 'A1', 'a1@leader.test', '00000000-0000-4000-8000-000000000011'),
  ('10000000-0000-4000-8000-000000000012', '20000000-0000-4000-8000-000000000001', 'A2', 'a2@leader.test', '00000000-0000-4000-8000-000000000012'),
  ('10000000-0000-4000-8000-000000000013', '20000000-0000-4000-8000-000000000001', 'A3', 'a3@leader.test', '00000000-0000-4000-8000-000000000013'),
  ('10000000-0000-4000-8000-000000000021', '20000000-0000-4000-8000-000000000001', 'B1', 'b1@leader.test', '00000000-0000-4000-8000-000000000021'),
  ('10000000-0000-4000-8000-000000000022', '20000000-0000-4000-8000-000000000001', 'B2', 'b2@leader.test', '00000000-0000-4000-8000-000000000022');

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
  ('50000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Leader N', 'live', null),
  ('50000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 'Leader I', 'live', null);

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
  I  text := '''50000000-0000-4000-8000-000000000002''';
  sA1 text := '''10000000-0000-4000-8000-000000000011''';
  sA2 text := '''10000000-0000-4000-8000-000000000012''';
  sA3 text := '''10000000-0000-4000-8000-000000000013''';
  sB1 text := '''10000000-0000-4000-8000-000000000021''';
  sB2 text := '''10000000-0000-4000-8000-000000000022''';
  tA text := '''40000000-0000-4000-8000-00000000000a''';
  q1 text := '''60000000-0000-4000-8000-000000000001''';  -- number 5
  q2 text := '''60000000-0000-4000-8000-000000000002''';  -- number 7
  q3 text := '''60000000-0000-4000-8000-000000000003''';  -- on I, number 1
begin
  perform pg_temp.ok(O, format($q$
    insert into live_questions (id, activity_id, position, kind, stem, options) values
      (%s, %s, 0, 'number', 'How many?', '[]'),
      (%s, %s, 1, 'number', 'And now?', '[]'),
      (%s, %s, 0, 'number', 'Before class?', '[]');
    insert into live_keys (question_id, activity_id, answer, tolerance) values
      (%s, %s, 5, 0), (%s, %s, 7, 0), (%s, %s, 1, 0);
    insert into live_explanations (question_id, activity_id, body) values
      (%s, %s, 'Five, because.'), (%s, %s, 'Seven, because.'), (%s, %s, 'One, because.');
  $q$, q1, N, q2, N, q3, I, q1, N, q2, N, q3, I, q1, N, q2, N, q3, I), 'the owner writes questions, keys and explanations');

  perform pg_temp.refused(A1, format('insert into live_explanations (question_id, activity_id, body) values (%s, %s, ''mine'')', q1, N),
    'a student writes no explanation');
  perform pg_temp.sees(A1, 'select 1 from live_explanations', 0, 'before class: no explanation, on either activity');
  perform pg_temp.refused(A1, format('select vote_live_leader(%s, %s)', N, sA1), 'no leader vote before team mode', 'isn''t running');

  perform pg_temp.ok(O, 'select start_live_team(' || N || ')', 'the owner starts team mode on N');

  -- ---- team A: three people, so two agreeing must confirm
  perform pg_temp.ok(A1, format('select vote_live_leader(%s, %s)', N, sA2), 'A1 votes A2');
  perform pg_temp.refused(A1, format('select confirm_live_leader(%s)', N), 'one vote is not enough to confirm', 'one more vote');
  perform pg_temp.ok(A2, format('select vote_live_leader(%s, %s)', N, sA3), 'A2 votes A3');
  perform pg_temp.refused(A1, format('select confirm_live_leader(%s)', N), 'split votes don''t confirm', 'split');
  perform pg_temp.refused(A2, format('select vote_live_leader(%s, %s)', N, sB1), 'nobody from another team', 'on your team');
  perform pg_temp.ok(A2, format('select vote_live_leader(%s, %s)', N, sA2), 'A2 changes their vote to A2');
  perform pg_temp.sees(A1, 'select 1 from live_team_setup where leader_id is not null', 0, 'two of three agree: not set by itself');
  perform pg_temp.refused(A3, format('select confirm_live_leader(%s)', N), 'only someone who voted confirms', 'vote first');
  perform pg_temp.sees(A3, 'select 1 from live_leader_votes', 2, 'A3 sees the two votes');
  perform pg_temp.ok(A1, format('select confirm_live_leader(%s)', N), 'A1 confirms A2');
  perform pg_temp.sees(A3, 'select 1 from live_team_setup where leader_id = ' || sA2 || ' and leader_at is not null and roll_at is null', 1,
    'A2 leads team A; no roll yet');
  perform pg_temp.ok(A2, format('select confirm_live_leader(%s)', N), 'a second confirm is no error');
  perform pg_temp.refused(A3, format('select vote_live_leader(%s, %s)', N, sA3), 'no voting once there''s a leader', 'already has a leader');

  -- ---- team B: everyone voting for one person sets it at once
  perform pg_temp.ok(B1, format('select vote_live_leader(%s, %s)', N, sB2), 'B1 votes B2');
  perform pg_temp.ok(B2, format('select vote_live_leader(%s, %s)', N, sB2), 'B2 votes B2');
  perform pg_temp.sees(B1, 'select 1 from live_team_setup where leader_id = ' || sB2, 1, 'the whole team agreed: B2 leads');
  perform pg_temp.sees(B1, 'select 1 from live_leader_votes', 2, 'team B sees only its own votes');
  perform pg_temp.sees(B1, 'select 1 from live_team_setup', 1, 'and only its own setup');
  perform pg_temp.refused(B1, 'insert into live_leader_votes (activity_id, team_id, student_id, candidate_id) values ('
    || N || ', ' || tA || ', ' || sB1 || ', ' || sB1 || ')', 'nobody writes a vote directly');

  -- ---- the roll
  perform pg_temp.refused(A1, format('select set_live_absences(%s, array[%s]::uuid[])', N, sA3), 'only the leader takes the roll', 'leader');
  perform pg_temp.refused(A2, format('select set_live_absences(%s, array[%s]::uuid[])', N, sA2), 'the leader can''t mark themselves absent', 'yourself');
  perform pg_temp.refused(A2, format('select set_live_absences(%s, array[%s]::uuid[])', N, sB1), 'nor someone on another team', 'on your team');
  perform pg_temp.ok(A2, format('select set_live_absences(%s, array[%s]::uuid[])', N, sA3), 'A2 marks A3 absent');
  perform pg_temp.sees(A1, 'select 1 from live_team_setup where roll_at is not null', 1, 'the roll is taken');
  perform pg_temp.sees(A1, 'select 1 from tutorial_absences where student_id = ' || sA3, 1, 'A1 sees A3 is out');
  perform pg_temp.sees(B1, 'select 1 from tutorial_absences', 0, 'team B sees nothing of team A''s roll');
  perform pg_temp.sees(A1, 'select 1 from activity_rosters', 3, 'A1 reads team A''s frozen roster');
  perform pg_temp.sees(A1, 'select 1 from activity_rosters where team_id <> ' || tA, 0, 'and nothing of team B''s');
  perform pg_temp.sees(O, 'select 1 from tutorial_absences where student_id = ' || sA3, 1, 'the instructor''s sheet has it');
  perform pg_temp.refused(A3, format('select cast_vote(%s, ''5'')', q1), 'an absent student doesn''t vote', 'absent');

  -- ---- only the leader submits
  perform pg_temp.ok(A1, format('select cast_vote(%s, ''4'')', q1), 'A1 still votes');
  perform pg_temp.refused(A1, format('select lock_team_answer(%s)', q1), 'but doesn''t submit', 'leader submits');
  perform pg_temp.ok(A2, format('select cast_vote(%s, ''4''); select lock_team_answer(%s)', q1, q1), 'the leader submits 4, wrong');
  perform pg_temp.sees(A1, 'select 1 from live_explanations', 0, 'a wrong try isn''t done: no explanation yet');
  perform pg_temp.ok(A2, format('select cast_vote(%s, ''5''); select lock_team_answer(%s)', q1, q1), 'the leader submits 5, right');
  perform pg_temp.sees(A1, 'select 1 from live_explanations where question_id = ' || q1, 1, 'done with q1: its explanation');
  perform pg_temp.sees(A1, 'select 1 from live_explanations', 1, 'and not q2''s');
  perform pg_temp.sees(B1, 'select 1 from live_explanations', 0, 'team B isn''t done: nothing');

  perform pg_temp.ok(A2, format($q$
    select cast_vote(%s, '1'); select lock_team_answer(%s);
    select cast_vote(%s, '2'); select lock_team_answer(%s);
    select cast_vote(%s, '3'); select lock_team_answer(%s);
  $q$, q2, q2, q2, q2, q2, q2), 'the leader tries q2 three times, wrong');
  perform pg_temp.refused(A1, format('select move_team_on(%s)', q2), 'only the leader moves the team on', 'leader');

  -- ---- someone turns up late
  perform pg_temp.ok(O, format('insert into tutorial_absences (activity_id, team_id, student_id) values (%s, %s, %s)', N, tA, sA1),
    'the instructor marks A1 absent on the sheet');
  perform pg_temp.ok(A2, format('select set_live_absences(%s, ''{}''::uuid[])', N), 'the leader takes the roll again: A3 is here');
  perform pg_temp.sees(O, 'select 1 from tutorial_absences where student_id = ' || sA3, 0, 'A3''s roll mark is gone');
  perform pg_temp.sees(O, 'select 1 from tutorial_absences where student_id = ' || sA1 || ' and source = ''sheet''', 1,
    'the sheet''s mark on A1 stays: the roll can''t clear it');
  perform pg_temp.ok(O, format('delete from tutorial_absences where activity_id = %s and student_id = %s', N, sA1),
    'the instructor clears A1');
  perform pg_temp.sees(A1, 'select 1 from tutorial_absences', 0, 'nobody is out now');
  perform pg_temp.ok(A3, format('select cast_vote(%s, ''9'')', q2), 'A3 votes now');

  -- ---- the sheet marks the leader absent: the team picks again
  perform pg_temp.ok(O, format('insert into tutorial_absences (activity_id, team_id, student_id) values (%s, %s, %s)', N, tA, sA2),
    'the instructor marks A2 absent on the sheet');
  perform pg_temp.refused(A2, format('select move_team_on(%s)', q2), 'an absent leader leads nothing', 'absent');
  perform pg_temp.refused(A1, format('select move_team_on(%s)', q2), 'nor does anyone else, until the team picks again', 'leader');
  perform pg_temp.ok(A1, format('select vote_live_leader(%s, %s)', N, sA1), 'A1 votes A1');
  perform pg_temp.refused(A3, format('select vote_live_leader(%s, %s)', N, sA2), 'not for someone who is out', 'who''s here');
  perform pg_temp.ok(A3, format('select vote_live_leader(%s, %s)', N, sA1), 'A3 votes A1: everyone there agrees');
  perform pg_temp.sees(A1, 'select 1 from live_team_setup where leader_id = ' || sA1, 1, 'A1 leads now');
  perform pg_temp.ok(A1, format('select move_team_on(%s)', q2), 'and moves the team on');

  -- ---- closed: every explanation, but still never I's before class
  perform pg_temp.ok(O, 'select close_live(' || N || ')', 'the owner closes N');
  perform pg_temp.sees(B1, 'select 1 from live_explanations where activity_id = ' || N, 2, 'closed: team B reads both');
  perform pg_temp.sees(B1, 'select 1 from live_explanations where activity_id = ' || I, 0, 'and still nothing of I');
  perform pg_temp.refused(B2, format('select vote_live_leader(%s, %s)', N, sB2), 'no leader vote after close', 'isn''t running');

  -- ---- the owner edits and clears
  perform pg_temp.ok(O, format('update live_explanations set body = ''Five.'' where question_id = %s; delete from live_explanations where question_id = %s', q1, q3),
    'the owner edits one explanation and clears another');
  perform pg_temp.sees(O, 'select 1 from live_explanations', 2, 'two left');
end $$;

-- Who may call what.
do $$
begin
  if has_function_privilege('anon', 'vote_live_leader(uuid, uuid)', 'execute')
     or has_function_privilege('anon', 'set_live_absences(uuid, uuid[])', 'execute') then
    raise exception 'FAIL  anon can call a leader RPC';
  end if;
  if not (has_function_privilege('authenticated', 'vote_live_leader(uuid, uuid)', 'execute')
          and has_function_privilege('authenticated', 'confirm_live_leader(uuid)', 'execute')
          and has_function_privilege('authenticated', 'set_live_absences(uuid, uuid[])', 'execute')
          and has_function_privilege('authenticated', 'lock_team_answer(uuid, jsonb)', 'execute')
          and has_function_privilege('authenticated', 'move_team_on(uuid)', 'execute')
          and has_function_privilege('authenticated', 'cast_vote(uuid, text)', 'execute')) then
    raise exception 'FAIL  a signed-in student cannot call an RPC they need';
  end if;
  if has_function_privilege('authenticated', 'live_set_leader(uuid, uuid, uuid)', 'execute')
     or has_function_privilege('authenticated', 'live_team_caller(uuid)', 'execute')
     or has_function_privilege('authenticated', 'live_leader_tally(uuid, uuid)', 'execute') then
    raise exception 'FAIL  signed-in users can call an internal helper';
  end if;
  raise notice 'ok    the RPCs for signed-in users only; the helpers for nobody';
end $$;

\echo 'All live team leader checks passed.'
rollback;
