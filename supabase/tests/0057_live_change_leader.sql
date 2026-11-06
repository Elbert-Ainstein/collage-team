-- What 0057 promises: a team may reopen its vote for leader; while it has
-- none again nobody submits, and once it has picked again the new leader
-- does. A team that never had a leader is as before: anyone submits.
--
--   psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f supabase/tests/0057_live_change_leader.sql
--
-- LOCAL DATABASE ONLY, after every migration through 0057. Everything runs in
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
  ('00000000-0000-4000-8000-000000000001', 'o@reopen.test'),
  ('00000000-0000-4000-8000-000000000011', 'a1@reopen.test'),
  ('00000000-0000-4000-8000-000000000012', 'a2@reopen.test'),
  ('00000000-0000-4000-8000-000000000013', 'a3@reopen.test'),
  ('00000000-0000-4000-8000-000000000021', 'b1@reopen.test'),
  ('00000000-0000-4000-8000-000000000022', 'b2@reopen.test');

insert into courses (id, name, owner_id) values
  ('20000000-0000-4000-8000-000000000001', 'Reopen course', '00000000-0000-4000-8000-000000000001');

insert into students (id, course_id, name, email, user_id) values
  ('10000000-0000-4000-8000-000000000011', '20000000-0000-4000-8000-000000000001', 'A1', 'a1@reopen.test', '00000000-0000-4000-8000-000000000011'),
  ('10000000-0000-4000-8000-000000000012', '20000000-0000-4000-8000-000000000001', 'A2', 'a2@reopen.test', '00000000-0000-4000-8000-000000000012'),
  ('10000000-0000-4000-8000-000000000013', '20000000-0000-4000-8000-000000000001', 'A3', 'a3@reopen.test', '00000000-0000-4000-8000-000000000013'),
  ('10000000-0000-4000-8000-000000000021', '20000000-0000-4000-8000-000000000001', 'B1', 'b1@reopen.test', '00000000-0000-4000-8000-000000000021'),
  ('10000000-0000-4000-8000-000000000022', '20000000-0000-4000-8000-000000000001', 'B2', 'b2@reopen.test', '00000000-0000-4000-8000-000000000022');

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
  ('50000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Reopen N', 'live', null);

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
  tA text := '''40000000-0000-4000-8000-00000000000a''';
  q1 text := '''60000000-0000-4000-8000-000000000001''';  -- number 5
  q2 text := '''60000000-0000-4000-8000-000000000002''';  -- number 7
begin
  perform pg_temp.ok(O, format($q$
    insert into live_questions (id, activity_id, position, kind, stem, options) values
      (%s, %s, 0, 'number', 'How many?', '[]'),
      (%s, %s, 1, 'number', 'And now?', '[]');
    insert into live_keys (question_id, activity_id, answer, tolerance) values
      (%s, %s, 5, 0), (%s, %s, 7, 0);
  $q$, q1, N, q2, N, q1, N, q2, N), 'the owner writes questions and keys');

  perform pg_temp.refused(A1, format('select reopen_live_leader(%s)', N), 'no reopening before team mode', 'isn''t running');
  perform pg_temp.ok(O, 'select start_live_team(' || N || ')', 'the owner starts team mode on N');

  -- ---- team B never picks a leader: anyone still submits, as before 0051
  perform pg_temp.ok(B1, format('select cast_vote(%s, ''4''); select lock_team_answer(%s)', q1, q1),
    'a team that never had a leader: anyone submits');
  perform pg_temp.ok(B2, format('select reopen_live_leader(%s)', N), 'reopening a vote that was never held is no error');
  perform pg_temp.ok(B1, format('select cast_vote(%s, ''5''); select lock_team_answer(%s)', q1, q1), 'and anyone still submits');

  -- ---- team A picks A2, then changes its mind
  perform pg_temp.ok(A1, format('select vote_live_leader(%s, %s)', N, sA2), 'A1 votes A2');
  perform pg_temp.ok(A2, format('select vote_live_leader(%s, %s)', N, sA2), 'A2 votes A2');
  perform pg_temp.ok(A3, format('select vote_live_leader(%s, %s)', N, sA2), 'A3 votes A2: A2 leads');
  perform pg_temp.ok(A2, format('select set_live_absences(%s, ''{}''::uuid[])', N), 'A2 takes the roll');
  perform pg_temp.ok(A2, format('select cast_vote(%s, ''4''); select lock_team_answer(%s)', q1, q1), 'A2 submits 4, wrong');
  perform pg_temp.refused(A3, format('select vote_live_leader(%s, %s)', N, sA3), 'no voting while there''s a leader', 'already has a leader');

  perform pg_temp.ok(A3, format('select reopen_live_leader(%s)', N), 'A3 — not the leader — reopens the vote');
  perform pg_temp.sees(A1, 'select 1 from live_team_setup where team_id = ' || tA || ' and leader_id is null and leader_at is not null and roll_at is not null', 1,
    'team A has no leader, remembers it had one, and keeps its roll');
  perform pg_temp.sees(A1, 'select 1 from live_leader_votes where team_id = ' || tA, 0, 'its old votes are gone');
  perform pg_temp.sees(B1, 'select 1 from live_team_setup where leader_at is not null', 0, 'team B is untouched');
  perform pg_temp.refused(A2, format('select cast_vote(%s, ''5''); select lock_team_answer(%s)', q1, q1), 'the old leader no longer submits', 'leader submits');
  perform pg_temp.refused(A3, format('select cast_vote(%s, ''5''); select lock_team_answer(%s)', q1, q1), 'nor does anyone else, until the team picks again', 'leader submits');
  perform pg_temp.refused(A1, format('select move_team_on(%s)', q1), 'nobody moves the team on either', 'leader');
  perform pg_temp.ok(A1, format('select reopen_live_leader(%s)', N), 'reopening twice is no error');

  perform pg_temp.ok(A1, format('select vote_live_leader(%s, %s)', N, sA1), 'A1 votes A1');
  perform pg_temp.ok(A2, format('select vote_live_leader(%s, %s)', N, sA1), 'A2 votes A1');
  perform pg_temp.refused(A3, format('select confirm_live_leader(%s)', N), 'only someone who voted confirms', 'vote first');
  perform pg_temp.ok(A3, format('select vote_live_leader(%s, %s)', N, sA1), 'A3 votes A1: everyone agrees, A1 leads');
  perform pg_temp.sees(A2, 'select 1 from live_team_setup where team_id = ' || tA || ' and leader_id = ' || sA1, 1, 'A1 leads team A now');
  perform pg_temp.refused(A2, format('select cast_vote(%s, ''5''); select lock_team_answer(%s)', q1, q1), 'the old leader still doesn''t submit', 'leader submits');
  perform pg_temp.ok(A1, format('select cast_vote(%s, ''5''); select lock_team_answer(%s)', q1, q1), 'the new leader submits 5, right');
  perform pg_temp.ok(A1, format('select set_live_absences(%s, ''{}''::uuid[])', N), 'and may take the roll again');
end $$;

-- Who may call what.
do $$
begin
  if has_function_privilege('anon', 'reopen_live_leader(uuid)', 'execute') then
    raise exception 'FAIL  anon can reopen a leader vote';
  end if;
  if not has_function_privilege('authenticated', 'reopen_live_leader(uuid)', 'execute') then
    raise exception 'FAIL  a signed-in student cannot reopen their team''s leader vote';
  end if;
  if has_function_privilege('authenticated', 'live_leads(uuid, uuid, uuid)', 'execute') then
    raise exception 'FAIL  signed-in users can call an internal helper';
  end if;
  raise notice 'ok    the RPC for signed-in users only; the helper for nobody';
end $$;

\echo 'All live change-leader checks passed.'
rollback;
