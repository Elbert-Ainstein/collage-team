-- What 0047 promises, checked as every kind of person who can ask.
--
--   psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f supabase/tests/0047_live_questions.sql
--
-- LOCAL DATABASE ONLY (scripts/local-db.sh). Everything runs inside one
-- transaction that is rolled back at the end, so it leaves nothing behind —
-- but it inserts auth users, and it has no business near the live project.
--
-- Each check switches to the `authenticated` role with that person's JWT
-- claims, exactly as a request through the API would arrive, so RLS, column
-- grants and the definer helpers are all in play. A failed check stops the
-- script with the name of the check.

\set ON_ERROR_STOP 1
begin;

-- --------------------------------------------------------------- harness
create function pg_temp.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

-- Back to the admin role, and forget whose request this was: a trigger that
-- asks auth.uid() while the fixtures are being changed must see nobody.
create function pg_temp.as_admin() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $$;

-- The statement must succeed.
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

-- The statement must be refused (any error; `want` narrows it when given).
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

-- The query must return exactly n rows.
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
-- People: O instructor, T a TF, A1 A2 on team A, B1 B2 on team B, N enrolled
-- but on no team, X not enrolled at all.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000000001', 'o@live.test'),
  ('00000000-0000-4000-8000-000000000002', 't@live.test'),
  ('00000000-0000-4000-8000-000000000011', 'a1@live.test'),
  ('00000000-0000-4000-8000-000000000012', 'a2@live.test'),
  ('00000000-0000-4000-8000-000000000021', 'b1@live.test'),
  ('00000000-0000-4000-8000-000000000022', 'b2@live.test'),
  ('00000000-0000-4000-8000-000000000031', 'n@live.test'),
  ('00000000-0000-4000-8000-000000000099', 'x@live.test');

insert into courses (id, name, owner_id, tf_can_checkin, tf_can_grade) values
  ('20000000-0000-4000-8000-000000000001', 'Live test course',
   '00000000-0000-4000-8000-000000000001', false, false);

insert into course_tfs (course_id, name, email, user_id) values
  ('20000000-0000-4000-8000-000000000001', 'Tess TF', 't@live.test',
   '00000000-0000-4000-8000-000000000002');

insert into students (id, course_id, name, email, user_id) values
  ('10000000-0000-4000-8000-000000000011', '20000000-0000-4000-8000-000000000001', 'A1', 'a1@live.test', '00000000-0000-4000-8000-000000000011'),
  ('10000000-0000-4000-8000-000000000012', '20000000-0000-4000-8000-000000000001', 'A2', 'a2@live.test', '00000000-0000-4000-8000-000000000012'),
  ('10000000-0000-4000-8000-000000000021', '20000000-0000-4000-8000-000000000001', 'B1', 'b1@live.test', '00000000-0000-4000-8000-000000000021'),
  ('10000000-0000-4000-8000-000000000022', '20000000-0000-4000-8000-000000000001', 'B2', 'b2@live.test', '00000000-0000-4000-8000-000000000022'),
  ('10000000-0000-4000-8000-000000000031', '20000000-0000-4000-8000-000000000001', 'N',  'n@live.test',  '00000000-0000-4000-8000-000000000031');

insert into team_sets (id, course_id, name) values
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Fall teams');
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

-- L: "anyone submits", answers at close. M: "everyone agrees", answers as teams lock.
insert into activities (id, course_id, title, type, opens_at) values
  ('50000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Live L', 'live', null),
  ('50000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 'Live M', 'live', null);

-- ------------------------------------------------------------ the checks
do $$
declare
  O  uuid := '00000000-0000-4000-8000-000000000001';
  T  uuid := '00000000-0000-4000-8000-000000000002';
  A1 uuid := '00000000-0000-4000-8000-000000000011';
  A2 uuid := '00000000-0000-4000-8000-000000000012';
  B1 uuid := '00000000-0000-4000-8000-000000000021';
  B2 uuid := '00000000-0000-4000-8000-000000000022';
  N  uuid := '00000000-0000-4000-8000-000000000031';
  X  uuid := '00000000-0000-4000-8000-000000000099';
  L  text := '''50000000-0000-4000-8000-000000000001''';
  M  text := '''50000000-0000-4000-8000-000000000002''';
  q1 text := '''60000000-0000-4000-8000-000000000001''';  -- mc, key B
  q2 text := '''60000000-0000-4000-8000-000000000002''';  -- number 0.3 ± 0.01
  q3 text := '''60000000-0000-4000-8000-000000000003''';  -- expression F/2
  m1 text := '''60000000-0000-4000-8000-000000000011''';  -- mc on M, key A
  sA1 text := '''10000000-0000-4000-8000-000000000011''';
  sA2 text := '''10000000-0000-4000-8000-000000000012''';
  sB1 text := '''10000000-0000-4000-8000-000000000021''';
  sB2 text := '''10000000-0000-4000-8000-000000000022''';
  r record;
begin
  -- state rows came from the trigger
  perform pg_temp.sees(O, 'select 1 from live_state where activity_id = ' || L || ' and phase = ''individual''', 1,
    'a live activity gets a state row, individual');

  -- building: the owner only
  perform pg_temp.ok(O, format($q$
    insert into live_questions (id, activity_id, position, kind, stem, options) values
      (%s, %s, 0, 'mc', 'Which?', '["one","two","three","four"]'),
      (%s, %s, 1, 'number', 'How much?', '[]'),
      (%s, %s, 2, 'expression', 'In terms of F?', '[]');
    insert into live_keys (question_id, activity_id, correct_option, answer, tolerance, accept) values
      (%s, %s, 1, null, null, '[]'),
      (%s, %s, null, 0.3, 0.01, '[]'),
      (%s, %s, null, null, null, '["F/2"]');
    insert into live_questions (id, activity_id, position, kind, stem, options) values
      (%s, %s, 0, 'mc', 'M one', '["yes","no"]');
    insert into live_keys (question_id, activity_id, correct_option) values (%s, %s, 0);
    update live_state set lock_rule = 'all', show_answers = 'lock' where activity_id = %s;
  $q$, q1, L, q2, L, q3, L, q1, L, q2, L, q3, L, m1, M, m1, M, M), 'owner writes questions, keys and settings');

  perform pg_temp.refused(T, format('insert into live_questions (activity_id, kind, stem) values (%s, ''mc'', ''x'')', L),
    'a TF cannot add questions');
  perform pg_temp.refused(A1, format('insert into live_keys (question_id, activity_id, correct_option) values (%s, %s, 0)', q1, L),
    'a student cannot write a key');
  perform pg_temp.sees(A1, 'select 1 from live_state where activity_id = ' || L, 1, 'a student reads the state');
  perform pg_temp.refused(A1, 'update live_state set phase = ''closed'' where activity_id = ' || L,
    'a student cannot move the phase');
  perform pg_temp.refused(O, 'update live_state set phase = ''closed'' where activity_id = ' || L,
    'even the owner cannot move the phase except through the RPCs');

  -- reading questions and keys before class
  perform pg_temp.sees(A1, 'select 1 from live_questions where activity_id = ' || L, 3, 'a student reads the questions');
  perform pg_temp.sees(A1, 'select 1 from live_keys', 0, 'a student reads no keys before class');
  perform pg_temp.sees(T, 'select 1 from live_keys', 4, 'a TF reads every key');
  perform pg_temp.sees(X, 'select 1 from live_questions', 0, 'someone not enrolled reads nothing');

  -- hidden activity
  update activities set opens_at = '9999-12-31T00:00:00Z' where id = '50000000-0000-4000-8000-000000000001';
  perform pg_temp.sees(A1, 'select 1 from live_questions where activity_id = ' || L, 0, 'hidden: a student reads no questions');
  perform pg_temp.refused(A1, format('insert into live_responses (question_id, activity_id, student_id, answer) values (%s, %s, %s, ''B'')', q1, L, sA1),
    'hidden: a student cannot answer');
  update activities set opens_at = null where id = '50000000-0000-4000-8000-000000000001';

  -- own answers before class
  perform pg_temp.ok(A1, format($q$
    insert into live_responses (question_id, activity_id, student_id, answer) values
      (%s, %s, %s, 'A'), (%s, %s, %s, '0.3'), (%s, %s, %s, 'f / 2');
    update live_responses set answer = 'B' where question_id = %s and student_id = %s;
  $q$, q1, L, sA1, q2, L, sA1, q3, L, sA1, q1, sA1), 'a student answers and changes an answer');
  perform pg_temp.ok(A2, format('insert into live_responses (question_id, activity_id, student_id, answer) values (%s, %s, %s, ''C''), (%s, %s, %s, ''0.6'')',
    q1, L, sA2, q2, L, sA2), 'a teammate answers');
  perform pg_temp.ok(B1, format('insert into live_responses (question_id, activity_id, student_id, answer) values (%s, %s, %s, ''B'')',
    q1, L, sB1), 'team B answers');
  perform pg_temp.ok(A1, format('insert into live_responses (question_id, activity_id, student_id, answer) values (%s, %s, %s, ''A'')',
    m1, M, sA1), 'answers on M');
  -- An answer has to fit its question: a letter it has, a plain number.
  perform pg_temp.refused(A2, format('insert into live_responses (question_id, activity_id, student_id, answer) values (%s, %s, %s, ''C'')',
    m1, M, sA2), 'no option C on a two-option question', 'can''t be used');
  perform pg_temp.refused(A2, format('insert into live_responses (question_id, activity_id, student_id, answer) values (%s, %s, %s, ''1e999999'')',
    q2, L, sA2), 'a number too big to score is refused', 'can''t be used');
  -- The key can't be asked about, by a student or by nobody at all.
  perform pg_temp.refused(A1, format('select live_answer_correct(%s, ''B'', ''{}'')', q1), 'a student cannot ask whether an answer is right', 'permission denied');
  perform pg_temp.refused(A1, format('select live_answer_fits(%s, ''B'')', q1), 'nor call the answer-shape check', 'permission denied');

  perform pg_temp.refused(A1, format('insert into live_responses (question_id, activity_id, student_id, answer) values (%s, %s, %s, ''D'')', q3, L, sA2),
    'a student cannot answer for someone else');
  perform pg_temp.refused(A1, format('insert into live_responses (question_id, activity_id, student_id, answer, correct) values (%s, %s, %s, ''B'', true)', q1, M, sA1),
    'a student cannot mark their own answer right');
  perform pg_temp.refused(A1, format('update live_responses set correct = true where student_id = %s', sA1),
    'a student cannot set correct on update');
  perform pg_temp.refused(A2, format('insert into live_responses (question_id, activity_id, student_id, answer) values (%s, %s, %s, ''A'')', q3, M, sA2),
    'a question cannot be filed under another activity', 'foreign key');
  perform pg_temp.sees(A1, 'select 1 from live_responses where activity_id = ' || L, 3, 'before team mode a student sees only their own answers');
  perform pg_temp.sees(T, 'select 1 from live_responses where activity_id = ' || L, 6, 'staff see every answer');

  -- nothing team-shaped before team mode
  perform pg_temp.refused(A1, format('select cast_vote(%s, ''B'')', q1), 'no votes before team mode', 'Team mode');
  perform pg_temp.refused(A1, format('insert into live_votes (question_id, activity_id, team_id, student_id, answer) values (%s, %s, ''40000000-0000-4000-8000-00000000000a'', %s, ''B'')', q1, L, sA1),
    'no direct writes to votes');
  perform pg_temp.refused(A1, 'select start_live_team(' || L || ')', 'a student cannot start team mode');
  perform pg_temp.refused(T, 'select start_live_team(' || L || ')', 'a TF without the check-in switch cannot start');

  update courses set tf_can_checkin = true where id = '20000000-0000-4000-8000-000000000001';
  perform pg_temp.ok(T, 'select start_live_team(' || L || ')', 'a TF who runs check-ins starts team mode');
  perform pg_temp.sees(O, 'select 1 from activity_rosters where activity_id = ' || L, 4, 'starting froze the four team members');
  perform pg_temp.refused(T, 'select start_live_team(' || L || ')', 'team mode cannot start twice', 'already');

  -- team mode: answers closed, teammates visible, other teams not
  perform pg_temp.refused(A1, format('update live_responses set answer = ''D'' where question_id = %s and student_id = %s', q1, sA1),
    'own answers close when team mode starts', 'Team mode');
  perform pg_temp.refused(A2, format('insert into live_responses (question_id, activity_id, student_id, answer) values (%s, %s, %s, ''F/2'')', q3, L, sA2),
    'no new own answers in team mode');
  perform pg_temp.sees(A1, 'select 1 from live_responses where activity_id = ' || L, 5, 'in team mode a student sees their team''s answers');
  perform pg_temp.sees(B1, 'select 1 from live_responses where activity_id = ' || L, 1, 'and never another team''s');
  perform pg_temp.sees(A1, 'select 1 from live_keys', 0, 'still no keys in team mode');
  perform pg_temp.refused(O, 'update live_state set lock_rule = ''all'' where activity_id = ' || L, 'settings are fixed once team mode starts', 'fixed');
  perform pg_temp.refused(O, format('update live_questions set options = ''["a","b"]'' where id = %s', q1), 'question shape is fixed in team mode');
  perform pg_temp.ok(O, format('update live_questions set stem = ''Which one?'' where id = %s', q1), 'a typo in the wording can still be fixed');
  perform pg_temp.refused(O, 'select refreeze_activity_roster(' || L || ', ''30000000-0000-4000-8000-000000000001'')',
    'teams cannot be re-frozen while it runs', 'Team mode');

  -- votes and locks, "anyone submits"
  perform pg_temp.ok(A1, format('select cast_vote(%s, ''B'')', q1), 'A1 votes B');
  perform pg_temp.ok(A2, format('select cast_vote(%s, ''C'')', q1), 'A2 votes C');
  perform pg_temp.refused(N, format('select cast_vote(%s, ''B'')', q1), 'a student on no team cannot vote', 'not on a team');
  perform pg_temp.refused(X, format('select cast_vote(%s, ''B'')', q1), 'someone not enrolled cannot vote');
  perform pg_temp.sees(B1, 'select 1 from live_votes', 0, 'team B sees none of team A''s votes');
  perform pg_temp.sees(A2, 'select 1 from live_votes', 2, 'team A sees its own votes');
  perform pg_temp.ok(A1, format('select lock_team_answer(%s)', q1), 'anyone submits: A1 locks B while split');
  perform pg_temp.refused(A2, format('select cast_vote(%s, ''A'')', q1), 'no voting after a lock', 'already locked');
  perform pg_temp.refused(A2, format('select lock_team_answer(%s)', q1), 'no second lock', 'already locked');
  perform pg_temp.sees(B1, 'select 1 from live_locks', 0, 'team B sees none of team A''s locks');

  -- M: "everyone agrees", answers as teams lock
  perform pg_temp.ok(O, 'select start_live_team(' || M || ')', 'owner starts M');
  perform pg_temp.ok(A1, format('select cast_vote(%s, ''A'')', m1), 'A1 votes A on M');
  perform pg_temp.ok(A2, format('select cast_vote(%s, ''B'')', m1), 'A2 votes B on M');
  perform pg_temp.refused(A1, format('select lock_team_answer(%s)', m1), 'everyone agrees: a split team cannot lock', 'same answer');
  perform pg_temp.ok(A2, format('select cast_vote(%s, ''A'')', m1), 'A2 comes round');
  perform pg_temp.ok(A1, format('select lock_team_answer(%s)', m1), 'everyone agrees: now it locks');
  perform pg_temp.refused(B1, format('select cast_vote(%s, ''ZZ'')', m1), 'a vote has to be one of the options', 'can''t be used');
  perform pg_temp.ok(B1, format('select cast_vote(%s, ''B'')', m1), 'B1 votes; B2 never shows up');
  perform pg_temp.refused(B1, format('select lock_team_answer(%s)', m1), 'everyone agrees: one voter cannot lock for a teammate who has not voted', 'same answer');
  perform pg_temp.ok(O, format('insert into tutorial_absences (activity_id, team_id, student_id) values (%s, %s, %s)',
    M, '''40000000-0000-4000-8000-00000000000b''', sB2), 'the instructor marks B2 absent');
  perform pg_temp.ok(B1, format('select lock_team_answer(%s)', m1), 'with B2 marked absent, B1 locks');
  perform pg_temp.sees(A1, 'select 1 from live_keys where question_id = ' || m1, 1, 'answers as teams lock: A reads the key it locked');
  perform pg_temp.sees(A1, 'select 1 from live_keys where question_id = ' || q1, 0, 'but not L''s keys, which show at close');

  -- close and score
  perform pg_temp.refused(A1, 'select close_live(' || L || ')', 'a student cannot close');
  perform pg_temp.ok(T, 'select close_live(' || L || ')', 'a TF who runs check-ins closes');
  perform pg_temp.refused(A1, format('select cast_vote(%s, ''B'')', q2), 'no votes after close', 'Team mode');
  perform pg_temp.sees(A1, 'select 1 from live_keys where activity_id = ' || L, 3, 'after close a student reads the keys');
  perform pg_temp.sees(X, 'select 1 from live_keys', 0, 'someone not enrolled never does');
  perform pg_temp.refused(T, 'select score_live(' || L || ', ''{}'')', 'a TF who cannot grade cannot score', 'grade');

  update courses set tf_can_grade = true where id = '20000000-0000-4000-8000-000000000001';
  perform pg_temp.ok(T, format('select score_live(%s, %L)', L, json_build_object(replace(q3, '''', ''), json_build_object('f / 2', true))::text),
    'a grading TF scores');
end $$;

-- What scoring wrote
do $$
declare r record;
begin
  -- A1: B right, 0.3 right, "f / 2" right by verdict → 3. A2: C wrong, 0.6 wrong → 0.
  select score, status into r from check_in_results
   where student_id = '10000000-0000-4000-8000-000000000011'
     and check_in_id = (select id from check_ins where activity_id = '50000000-0000-4000-8000-000000000001' and kind = 'individual');
  if r.score <> 3 or r.status <> 'needs_review' then
    raise exception 'FAIL  A1 own score — got % / %', r.score, r.status;
  end if;
  raise notice 'ok    A1 own score 3, sent for review (TF scored)';

  select score into r from check_in_results
   where student_id = '10000000-0000-4000-8000-000000000012'
     and check_in_id = (select id from check_ins where activity_id = '50000000-0000-4000-8000-000000000001' and kind = 'individual');
  if r.score <> 0 then raise exception 'FAIL  A2 own score — got %', r.score; end if;
  raise notice 'ok    A2 own score 0';

  select score into r from check_in_results
   where student_id = '10000000-0000-4000-8000-000000000031'
     and check_in_id = (select id from check_ins where activity_id = '50000000-0000-4000-8000-000000000001' and kind = 'individual');
  if r.score is distinct from 0 then raise exception 'FAIL  N (no answers) — got %', r.score; end if;
  raise notice 'ok    a student who never answered gets 0, not a gap';

  select score into r from check_in_results
   where team_id = '40000000-0000-4000-8000-00000000000a'
     and check_in_id = (select id from check_ins where activity_id = '50000000-0000-4000-8000-000000000001' and kind = 'team');
  if r.score <> 1 then raise exception 'FAIL  team A score — got %', r.score; end if;
  raise notice 'ok    team A: one locked right, two never locked → 1';

  -- the instructor excuses B2 before releasing
  perform pg_temp.ok('00000000-0000-4000-8000-000000000001', $q$
    update check_in_results set status = 'excused'
     where student_id = '10000000-0000-4000-8000-000000000022'
       and check_in_id = (select id from check_ins where activity_id = '50000000-0000-4000-8000-000000000001' and kind = 'individual')
  $q$, 'the instructor excuses a student');
end $$;

do $$
declare
  O uuid := '00000000-0000-4000-8000-000000000001';
  T uuid := '00000000-0000-4000-8000-000000000002';
  L text := '''50000000-0000-4000-8000-000000000001''';
  bad int;
begin
  perform pg_temp.ok(O, 'select score_live(' || L || ', ''{}'')', 'the owner scores: released');
  select count(*) into bad from check_in_results r join check_ins c on c.id = r.check_in_id
   where c.activity_id = '50000000-0000-4000-8000-000000000001'
     and r.status not in ('scored', 'excused');
  if bad > 0 then raise exception 'FAIL  owner scoring left % rows unreleased', bad; end if;
  if not exists (select 1 from check_in_results where student_id = '10000000-0000-4000-8000-000000000022' and status = 'excused') then
    raise exception 'FAIL  scoring overwrote an excused row';
  end if;
  raise notice 'ok    everything released, excused left alone';

  perform pg_temp.refused(T, 'select score_live(' || L || ', ''{}'')', 'once released, a TF cannot re-score', 'only the instructor');
  perform pg_temp.ok(O, 'select score_live(' || L || ', ''{}'')', 'the instructor can, as often as she likes');
  select count(*) into bad from check_in_results r join check_ins c on c.id = r.check_in_id
   where c.activity_id = '50000000-0000-4000-8000-000000000001' and r.status = 'needs_review';
  if bad > 0 then raise exception 'FAIL  a re-score pulled % released rows back to review', bad; end if;
  raise notice 'ok    re-scoring leaves released rows released';

  -- a points edit must not touch live scores (recompute_result_score)
  perform pg_temp.ok(O, 'update activities set points_total = 99 where id = ''50000000-0000-4000-8000-000000000001''',
    'the instructor changes what it is out of');
  if (select score from check_in_results where student_id = '10000000-0000-4000-8000-000000000012'
        and check_in_id = (select id from check_ins where activity_id = '50000000-0000-4000-8000-000000000001' and kind = 'individual')) <> 0 then
    raise exception 'FAIL  a points edit rescored a live result';
  end if;
  raise notice 'ok    a points edit leaves live scores alone';
end $$;

-- The import bucket: owner only
do $$
declare
  O  uuid := '00000000-0000-4000-8000-000000000001';
  A1 uuid := '00000000-0000-4000-8000-000000000011';
  T  uuid := '00000000-0000-4000-8000-000000000002';
  p  text := '20000000-0000-4000-8000-000000000001/50000000-0000-4000-8000-000000000001/q.pdf';
begin
  perform pg_temp.ok(O, format('insert into storage.objects (bucket_id, name) values (''imports'', %L)', p), 'the owner uploads an import');
  perform pg_temp.sees(A1, 'select 1 from storage.objects where bucket_id = ''imports''', 0, 'a student cannot see imports');
  perform pg_temp.sees(T, 'select 1 from storage.objects where bucket_id = ''imports''', 0, 'nor can a TF');
  perform pg_temp.refused(A1, format('insert into storage.objects (bucket_id, name) values (''imports'', %L)', p || '2'), 'a student cannot upload one');
end $$;

-- Nobody signed in can call any of it.
do $$
declare f text;
begin
  for f in select p.oid::regprocedure::text from pg_proc p
            where p.pronamespace = 'public'::regnamespace
              and (p.proname like 'live\_%' or p.proname in ('start_live_team', 'close_live', 'add_live_member',
                   'cast_vote', 'lock_team_answer', 'score_live', 'owns_import_path', 'owns_student', 'owns_team')
                   or p.proname like 'guard\_live\_%' or p.proname = 'ensure_live_state')
  loop
    if has_function_privilege('anon', f, 'execute') then
      raise exception 'FAIL  anon can call %', f;
    end if;
  end loop;
  if has_function_privilege('authenticated', 'live_answer_correct(uuid, text, jsonb)', 'execute') then
    raise exception 'FAIL  signed-in users can call live_answer_correct';
  end if;
  raise notice 'ok    nothing callable by anon; the key check by nobody but its callers';
end $$;

-- Deleting things still works once a session has run: the guards stop
-- re-freezing teams, not the cascades from deleting a student, team or activity.
do $$
declare
  O  uuid := '00000000-0000-4000-8000-000000000001';
  L  text := '''50000000-0000-4000-8000-000000000001''';
begin
  perform pg_temp.refused(O, 'select refreeze_activity_roster(' || L || ', ''30000000-0000-4000-8000-000000000001'')',
    'teams cannot be re-frozen once team mode has started', 'teams can''t change');
  perform pg_temp.ok(O, 'delete from students where id = ''10000000-0000-4000-8000-000000000031''', 'a student can still be removed from the course');
  perform pg_temp.ok(O, 'delete from teams where id = ''40000000-0000-4000-8000-00000000000b''', 'a team can still be deleted');
  perform pg_temp.ok(O, 'delete from activities where id = ' || L, 'and the activity itself');
end $$;

\echo 'All live-questions checks passed.'
rollback;
