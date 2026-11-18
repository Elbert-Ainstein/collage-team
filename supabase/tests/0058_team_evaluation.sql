-- What 0058 promises: students rate their own team only, read nothing anyone
-- else wrote, see averages that leave out themselves and anyone who didn't
-- submit, see comments without names when it's anonymous, can't change a
-- submitted evaluation after the due date, and the gradebook takes points off
-- a late one.
--
--   psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f supabase/tests/0058_team_evaluation.sql
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

/** The value of a jsonb path in what `q` returns, as the user. */
create function pg_temp.val(uid uuid, q text) returns text language plpgsql as $$
declare v text;
begin
  perform pg_temp.as_user(uid);
  execute q into v;
  perform pg_temp.as_admin();
  return v;
end $$;

create function pg_temp.eq(got text, want text, label text) returns void language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'FAIL  % — got %, expected %', label, coalesce(got, 'null'), coalesce(want, 'null');
  end if;
  raise notice 'ok    % (%)', label, coalesce(got, 'null');
end $$;

-- ------------------------------------------------------------- fixtures
-- O instructor, T a TF who grades; A1 A2 A3 on team A, B1 B2 on team B; X on
-- no team; Z on another course.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000000001', 'o@te.test'),
  ('00000000-0000-4000-8000-000000000002', 't@te.test'),
  ('00000000-0000-4000-8000-000000000011', 'a1@te.test'),
  ('00000000-0000-4000-8000-000000000012', 'a2@te.test'),
  ('00000000-0000-4000-8000-000000000013', 'a3@te.test'),
  ('00000000-0000-4000-8000-000000000021', 'b1@te.test'),
  ('00000000-0000-4000-8000-000000000022', 'b2@te.test'),
  ('00000000-0000-4000-8000-000000000031', 'x@te.test'),
  ('00000000-0000-4000-8000-000000000099', 'z@te.test');

insert into courses (id, name, owner_id, tf_can_grade, tf_can_release) values
  ('20000000-0000-4000-8000-000000000001', 'TE course', '00000000-0000-4000-8000-000000000001', true, false),
  ('20000000-0000-4000-8000-000000000009', 'Other', '00000000-0000-4000-8000-000000000099', false, false);
insert into course_tfs (course_id, name, email, user_id) values
  ('20000000-0000-4000-8000-000000000001', 'T', 't@te.test', '00000000-0000-4000-8000-000000000002');

insert into students (id, course_id, name, email, user_id, position) values
  ('10000000-0000-4000-8000-000000000011', '20000000-0000-4000-8000-000000000001', 'A1', 'a1@te.test', '00000000-0000-4000-8000-000000000011', 1),
  ('10000000-0000-4000-8000-000000000012', '20000000-0000-4000-8000-000000000001', 'A2', 'a2@te.test', '00000000-0000-4000-8000-000000000012', 2),
  ('10000000-0000-4000-8000-000000000013', '20000000-0000-4000-8000-000000000001', 'A3', 'a3@te.test', '00000000-0000-4000-8000-000000000013', 3),
  ('10000000-0000-4000-8000-000000000021', '20000000-0000-4000-8000-000000000001', 'B1', 'b1@te.test', '00000000-0000-4000-8000-000000000021', 4),
  ('10000000-0000-4000-8000-000000000022', '20000000-0000-4000-8000-000000000001', 'B2', 'b2@te.test', '00000000-0000-4000-8000-000000000022', 5),
  ('10000000-0000-4000-8000-000000000031', '20000000-0000-4000-8000-000000000001', 'X',  'x@te.test',  '00000000-0000-4000-8000-000000000031', 6),
  ('10000000-0000-4000-8000-000000000099', '20000000-0000-4000-8000-000000000009', 'Z',  'z@te.test',  '00000000-0000-4000-8000-000000000099', 1);

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

-- E: open, due tomorrow, 10 points, 20% off late. H: hidden.
insert into activities (id, course_id, title, type, opens_at, due_at, points_total) values
  ('50000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Eval', 'teameval', null, now() + interval '1 day', 10),
  ('50000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 'Hidden', 'teameval', '9999-12-31', null, 10);

-- ------------------------------------------------------------ the checks
do $$
declare
  O  uuid := '00000000-0000-4000-8000-000000000001';
  T  uuid := '00000000-0000-4000-8000-000000000002';
  A1 uuid := '00000000-0000-4000-8000-000000000011';
  A2 uuid := '00000000-0000-4000-8000-000000000012';
  A3 uuid := '00000000-0000-4000-8000-000000000013';
  B1 uuid := '00000000-0000-4000-8000-000000000021';
  X  uuid := '00000000-0000-4000-8000-000000000031';
  Z  uuid := '00000000-0000-4000-8000-000000000099';
  E  text := '''50000000-0000-4000-8000-000000000001''';
  H  text := '''50000000-0000-4000-8000-000000000002''';
  sA1 text := '10000000-0000-4000-8000-000000000011';
  sA2 text := '10000000-0000-4000-8000-000000000012';
  sA3 text := '10000000-0000-4000-8000-000000000013';
  sB1 text := '10000000-0000-4000-8000-000000000021';
  c1 text := '60000000-0000-4000-8000-000000000001';
  c2 text := '60000000-0000-4000-8000-000000000002';
  qp text := '70000000-0000-4000-8000-000000000001';  -- about each teammate
  qs text := '70000000-0000-4000-8000-000000000002';  -- about themselves
  -- A full evaluation from %2$s on team A, giving each person %3$s; %11$s says whether to submit.
  full_a text := $f$
    select save_team_eval(%1$s,
      (select jsonb_agg(jsonb_build_object('category_id', c, 'ratee_id', p, 'score', %3$s, 'reason', 'because'))
         from unnest(array['%4$s','%5$s']::uuid[]) c, unnest(array['%6$s','%7$s','%8$s']::uuid[]) p),
      (select jsonb_agg(jsonb_build_object('question_id', '%9$s', 'subject_id', p, 'body', 'note from %2$s'))
         from unnest(array['%6$s','%7$s','%8$s']::uuid[]) p where p <> '%2$s'::uuid)
        || jsonb_build_array(jsonb_build_object('question_id', '%10$s', 'subject_id', '%2$s', 'body', 'my reflection')),
      %11$s)
  $f$;
begin
  -- ---- setup
  perform pg_temp.sees(O, 'select 1 from te_settings where activity_id = ' || E || ' and anonymize and peer_comments', 1,
    'a team evaluation gets its settings row, anonymous by default');
  perform pg_temp.ok(O, format($q$
    insert into te_categories (id, activity_id, position, name, levels) values
      (%L, %s, 0, 'Communication', '["never","rarely","sometimes","often","always"]'),
      (%L, %s, 1, 'Reliability',   '["a","b","c","d","e"]');
    insert into te_questions (id, activity_id, position, audience, prompt) values
      (%L, %s, 0, 'peer', 'One thing they do well'),
      (%L, %s, 1, 'self', 'Personal reflection');
  $q$, c1, E, c2, E, qp, E, qs, E), 'the owner writes categories and questions');
  -- RLS turns an update nobody may make into one that matches no rows.
  perform pg_temp.ok(T, format('update te_categories set name = %L where id = %L', 'x', c1),
    'a TF''s edit to the categories reaches no rows');
  perform pg_temp.sees(T, format('select 1 from te_categories where id = %L and name = %L', c1, 'Communication'), 1,
    'and the category is unchanged');
  perform pg_temp.refused(O, format('insert into te_categories (activity_id, name, levels) values (%s, %L, %L)', E, 'Bad', '["a"]'),
    'a scale has exactly five points');
  perform pg_temp.refused(A1, format('insert into te_categories (activity_id, name) values (%s, %L)', E, 'Mine'),
    'a student can''t add a category');

  -- ---- who sees what before anything is written
  perform pg_temp.sees(A1, 'select 1 from te_categories where activity_id = ' || E, 2, 'a student on the course reads the categories');
  perform pg_temp.sees(Z, 'select 1 from te_categories where activity_id = ' || E, 0, 'someone on another course reads none');
  perform pg_temp.refused(A1, 'select * from team_eval_team(' || H || ')', 'a hidden evaluation can''t be opened', 'isn''t available');
  perform pg_temp.sees(A1, 'select 1 from team_eval_team(' || E || ')', 3, 'A1 evaluates their team of three');
  perform pg_temp.sees(A1, 'select 1 from team_eval_team(' || E || ') where is_me', 1, 'and knows which one is them');
  perform pg_temp.sees(X, 'select 1 from team_eval_team(' || E || ')', 0, 'someone on no team has nobody to evaluate');
  perform pg_temp.refused(X, format('select save_team_eval(%s, ''[]'', ''[]'')', E), 'and can''t save', 'not on a team');

  -- ---- writing
  perform pg_temp.refused(A1, format('insert into te_ratings (activity_id, category_id, rater_id, ratee_id, score) values (%s, %L, %L, %L, 5)', E, c1, sA1, sA2),
    'no rating straight into the table');
  perform pg_temp.refused(A1, format('insert into te_submissions (activity_id, student_id) values (%s, %L)', E, sA1),
    'no submission straight into the table');
  perform pg_temp.refused(A1, format('select save_team_eval(%s, %L, ''[]'')', E,
    jsonb_build_array(jsonb_build_object('category_id', c1, 'ratee_id', sB1, 'score', 5))),
    'A1 can''t rate someone on team B', 'only rate people on your team');
  perform pg_temp.refused(A1, format('select save_team_eval(%s, %L, ''[]'')', E,
    jsonb_build_array(jsonb_build_object('category_id', c1, 'ratee_id', sA2, 'score', 6))),
    'ratings go to 5', '1 to 5');
  perform pg_temp.refused(A1, format('select save_team_eval(%s, ''[]'', %L)', E,
    jsonb_build_array(jsonb_build_object('question_id', qs, 'subject_id', sA2, 'body', 'hi'))),
    'a question about themselves is about themselves', 'about you');
  perform pg_temp.refused(A1, format('select save_team_eval(%s, ''[]'', %L)', E,
    jsonb_build_array(jsonb_build_object('question_id', qp, 'subject_id', sA1, 'body', 'hi'))),
    'a peer question isn''t answered about themselves', 'people on your team');
  perform pg_temp.ok(A1, format('select save_team_eval(%s, %L, ''[]'')', E,
    jsonb_build_array(jsonb_build_object('category_id', c1, 'ratee_id', sA2, 'score', 4, 'reason', 'talks'))),
    'A1 saves a draft');
  perform pg_temp.sees(O, 'select 1 from activity_rosters where activity_id = ' || E, 5, 'the first save froze the teams');
  perform pg_temp.refused(A1, format('select save_team_eval(%s, %L, ''[]'', true)', E,
    jsonb_build_array(jsonb_build_object('category_id', c1, 'ratee_id', sA2, 'score', 4, 'reason', 'talks'))),
    'an incomplete evaluation can''t be submitted', 'Rate everyone');

  -- A1 submits giving everyone 5; A2 gives everyone 3; A3 only drafts, giving 1.
  perform pg_temp.ok(A1, format(full_a, E, sA1, 5, c1, c2, sA1, sA2, sA3, qp, qs, 'true'), 'A1 submits a complete evaluation');
  perform pg_temp.ok(A2, format(full_a, E, sA2, 3, c1, c2, sA1, sA2, sA3, qp, qs, 'true'), 'A2 submits');
  perform pg_temp.ok(A3, format(full_a, E, sA3, 1, c1, c2, sA1, sA2, sA3, qp, qs, 'false'),
    'A3 saves everything but doesn''t submit');

  -- ---- reading
  perform pg_temp.sees(A1, 'select 1 from te_ratings where activity_id = ' || E, 6, 'A1 reads only their own six ratings');
  perform pg_temp.sees(A1, 'select 1 from te_ratings where rater_id <> ''' || sA1 || '''', 0, 'and none of anyone else''s');
  perform pg_temp.sees(A2, 'select 1 from te_comments where author_id <> ''' || sA2 || '''', 0, 'nor anyone else''s comments');
  perform pg_temp.sees(A2, 'select 1 from te_submissions', 1, 'and only their own submission');
  perform pg_temp.sees(T, 'select 1 from te_ratings where activity_id = ' || E, 18, 'a TF reads every rating');
  perform pg_temp.sees(Z, 'select 1 from te_ratings', 0, 'someone on another course reads none');

  perform pg_temp.eq(pg_temp.val(A1, 'select team_eval_results(' || E || ')->>''released'''), 'false',
    'no results before they''re released');
  perform pg_temp.ok(O, 'update te_settings set released_at = now() where activity_id = ' || E, 'the owner releases results');

  -- A1's average leaves out their own 5 and A3's unsubmitted 1: only A2's 3.
  perform pg_temp.eq(pg_temp.val(A1, 'select team_eval_results(' || E || ')->''categories''->0->>''average'''), '3.00',
    'A1''s average is A2''s 3 alone — not their own 5, not A3''s draft');
  perform pg_temp.eq(pg_temp.val(A1, 'select team_eval_results(' || E || ')->''categories''->0->>''raters'''), '1',
    'from one rater');
  perform pg_temp.eq(pg_temp.val(A1, 'select team_eval_results(' || E || ')->''categories''->0->>''self'''), '5',
    'beside what A1 gave themselves');
  perform pg_temp.eq(pg_temp.val(A3, 'select team_eval_results(' || E || ')->''categories''->0->>''average'''), '4.00',
    'A3, who didn''t submit, is still rated by those who did: (5 + 3) / 2');
  perform pg_temp.eq(pg_temp.val(A1, 'select jsonb_array_length(team_eval_results(' || E || ')->''comments'')'), '1',
    'A1 reads the one comment from the teammate who submitted');
  perform pg_temp.eq(pg_temp.val(A1, 'select team_eval_results(' || E || ')->''comments''->0->>''author'''), null,
    'without a name — it''s anonymous');
  perform pg_temp.eq(pg_temp.val(A1, 'select team_eval_results(' || E || ')->''reflection''->0->>''body'''), 'my reflection',
    'and their own reflection');

  -- ---- anonymity holds
  perform pg_temp.refused(O, 'update te_settings set anonymize = false where activity_id = ' || E,
    'anonymity can''t be turned off once anyone has submitted', 'anonymous');
  perform pg_temp.ok(O, 'update te_settings set release_comments = false where activity_id = ' || E, 'the owner hides comments');
  perform pg_temp.eq(pg_temp.val(A1, 'select jsonb_array_length(team_eval_results(' || E || ')->''comments'')'), '0',
    'and students don''t get them');
  perform pg_temp.eq(pg_temp.val(A1, 'select jsonb_array_length(team_eval_results(' || E || ')->''categories''->0->''reasons'')'), '0',
    'nor the reasons behind ratings');

  -- ---- the shape is fixed once anyone has submitted
  perform pg_temp.refused(O, format('delete from te_categories where id = %L', c2), 'no removing a category after submissions', 'can''t be added or removed');
  perform pg_temp.refused(O, format('insert into te_questions (activity_id, audience, prompt) values (%s, ''peer'', ''New'')', E),
    'no adding a question after submissions', 'can''t be added or removed');
  perform pg_temp.ok(O, format('update te_categories set name = %L where id = %L', 'Talking', c1), 'but wording can still change');

  -- ---- after release, a submitted evaluation is fixed; A3 can still submit late
  perform pg_temp.refused(A1, format(full_a, E, sA1, 4, c1, c2, sA1, sA2, sA3, qp, qs, 'true'),
    'A1 can''t change theirs once results are out', 'Results are out');
  perform pg_temp.ok(O, 'update te_settings set released_at = null where activity_id = ' || E, 'the owner takes results back');
  -- now() doesn't move inside one transaction, so A1 and A2 "submitted" two
  -- hours ago and the due date was one hour ago.
  update te_submissions set submitted_at = now() - interval '2 hours'
   where activity_id = '50000000-0000-4000-8000-000000000001' and student_id in (sA1::uuid, sA2::uuid);
  perform pg_temp.ok(O, 'update activities set due_at = now() - interval ''1 hour'' where id = ' || E, 'the due date passes');
  perform pg_temp.ok(O, 'update te_settings set late_penalty = 20 where activity_id = ' || E, 'late costs 20%');
  perform pg_temp.refused(A2, format(full_a, E, sA2, 4, c1, c2, sA1, sA2, sA3, qp, qs, 'true'),
    'A2 can''t change theirs after the due date', 'past the due date');
  perform pg_temp.ok(A3, format(full_a, E, sA3, 1, c1, c2, sA1, sA2, sA3, qp, qs, 'true'), 'A3 submits late');
  perform pg_temp.ok(O, 'update te_settings set released_at = now() where activity_id = ' || E, 'released again');
  perform pg_temp.eq(pg_temp.val(A1, 'select team_eval_results(' || E || ')->''categories''->0->>''average'''), '2.00',
    'A3''s late submission now counts in A1''s average: (3 + 1) / 2');

  -- ---- lateness and the gradebook
  perform pg_temp.refused(A3, format('select set_team_eval_late(%s, %L, false)', E, sA3), 'a student can''t excuse their own lateness');
  perform pg_temp.ok(T, format('select score_team_eval(%s)', E), 'the TF scores it');
  perform pg_temp.sees(O, format($q$
    select 1 from check_in_results r join check_ins ci on ci.id = r.check_in_id
     where ci.activity_id = %s and r.status = 'needs_review'$q$, E), 5,
    'a TF who can''t release sends five results for review — X, on no team, gets none');
  perform pg_temp.eq(pg_temp.val(O, format($q$
    select string_agg(s.name || '=' || r.score::text, ' ' order by s.name)
      from check_in_results r join check_ins ci on ci.id = r.check_in_id join students s on s.id = r.student_id
     where ci.activity_id = %s$q$, E)),
    'A1=10 A2=10 A3=8.00 B1=0 B2=0', 'on time 10, late 20% off, none 0');
  perform pg_temp.ok(T, format('select set_team_eval_late(%s, %L, false)', E, sA3), 'the TF excuses A3''s lateness');
  perform pg_temp.ok(O, format('select score_team_eval(%s)', E), 'the owner scores it again');
  perform pg_temp.eq(pg_temp.val(O, format($q$
    select string_agg(s.name || '=' || r.score::text || ':' || r.status, ' ' order by s.name)
      from check_in_results r join check_ins ci on ci.id = r.check_in_id join students s on s.id = r.student_id
     where ci.activity_id = %s and s.name like 'A%%'$q$, E)),
    'A1=10:scored A2=10:scored A3=10:scored', 'released now, and A3 has full marks');
  perform pg_temp.refused(T, format('select score_team_eval(%s)', E), 'the TF can''t re-score what''s released', 'Already released');
  perform pg_temp.ok(O, 'update activities set points_total = 4 where id = ' || E, 'the owner changes the points');
  perform pg_temp.sees(O, format($q$
    select 1 from check_in_results r join check_ins ci on ci.id = r.check_in_id
     where ci.activity_id = %s and r.score = 10$q$, E), 3,
    'the rubric recompute leaves evaluation scores alone');

  -- ---- type guard
  perform pg_temp.refused(O, 'update activities set type = ''combo'' where id = ' || E,
    'an evaluation students have started stays one', 'stay a team evaluation');
  perform pg_temp.ok(O, 'delete from activities where id = ' || E, 'but it can still be deleted');
  perform pg_temp.sees(O, 'select 1 from te_ratings', 0, 'taking its ratings with it');
end $$;

-- Who may call what.
do $$
begin
  if has_function_privilege('anon', 'save_team_eval(uuid, jsonb, jsonb, boolean)', 'execute') then
    raise exception 'FAIL  anon can save an evaluation';
  end if;
  if has_function_privilege('authenticated', 'te_is_late(uuid, uuid)', 'execute')
     or has_function_privilege('authenticated', 'te_team_members(uuid, uuid)', 'execute') then
    raise exception 'FAIL  signed-in users can call an internal helper';
  end if;
  if not has_function_privilege('authenticated', 'team_eval_results(uuid)', 'execute') then
    raise exception 'FAIL  a student cannot read their results';
  end if;
  raise notice 'ok    the RPCs for signed-in users only; the helpers for nobody';
end $$;

\echo 'All team evaluation checks passed.'
rollback;
