-- What 0060 promises:
--   - Once a student submits their team evaluation, nothing they send changes
--     it — not a draft save, not a second submit, not before the due date.
--     Until then drafts save as before.
--   - A note to the instructor is optional; staff can't read a draft of one;
--     once submitted it sits in te_notes with no author, readable by staff and
--     by no student.
--
--   psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f supabase/tests/0060_team_eval_final_and_notes.sql
--
-- LOCAL DATABASE ONLY, after every migration through 0060. Everything runs in
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
-- O instructor; A1 and A2 on one team.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000000001', 'o@te60.test'),
  ('00000000-0000-4000-8000-000000000011', 'a1@te60.test'),
  ('00000000-0000-4000-8000-000000000012', 'a2@te60.test');

insert into courses (id, name, owner_id) values
  ('20000000-0000-4000-8000-000000000001', 'TE course', '00000000-0000-4000-8000-000000000001');

insert into students (id, course_id, name, email, user_id, position) values
  ('10000000-0000-4000-8000-000000000011', '20000000-0000-4000-8000-000000000001', 'A1', 'a1@te60.test', '00000000-0000-4000-8000-000000000011', 1),
  ('10000000-0000-4000-8000-000000000012', '20000000-0000-4000-8000-000000000001', 'A2', 'a2@te60.test', '00000000-0000-4000-8000-000000000012', 2);

insert into team_sets (id, course_id, name) values
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Teams');
insert into teams (id, team_set_id, name, position) values
  ('40000000-0000-4000-8000-00000000000a', '30000000-0000-4000-8000-000000000001', 'Team A', 0);
insert into team_members (team_id, student_id) values
  ('40000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-000000000011'),
  ('40000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-000000000012');
update courses set current_team_set_id = '30000000-0000-4000-8000-000000000001'
 where id = '20000000-0000-4000-8000-000000000001';

-- Open, due tomorrow: nothing here is late or released.
insert into activities (id, course_id, title, type, opens_at, due_at, points_total) values
  ('50000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Eval', 'teameval', null, now() + interval '1 day', 5);
insert into te_categories (id, activity_id, position, name, levels) values
  ('60000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 0, 'Communication', '["a","b","c","d","e"]');
insert into te_questions (id, activity_id, position, audience, prompt) values
  ('70000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000001', 0, 'self', 'Reflection'),
  ('70000000-0000-4000-8000-000000000003', '50000000-0000-4000-8000-000000000001', 1, 'instructor', 'Anything for your instructor?');

-- ------------------------------------------------------------ the checks
do $$
declare
  O  uuid := '00000000-0000-4000-8000-000000000001';
  A1 uuid := '00000000-0000-4000-8000-000000000011';
  A2 uuid := '00000000-0000-4000-8000-000000000012';
  E  text := '''50000000-0000-4000-8000-000000000001''';
  sA1 text := '10000000-0000-4000-8000-000000000011';
  sA2 text := '10000000-0000-4000-8000-000000000012';
  c1 text := '60000000-0000-4000-8000-000000000001';
  qs text := '70000000-0000-4000-8000-000000000002';
  qn text := '70000000-0000-4000-8000-000000000003';
  -- A complete evaluation from %2$s rating both A1 and A2 %3$s; %4$s says
  -- whether to submit; %9$s is extra comments (a note, or '[]').
  full_eval text := $f$
    select save_team_eval(%1$s,
      (select jsonb_agg(jsonb_build_object('category_id', '%5$s', 'ratee_id', p, 'score', %3$s))
         from unnest(array['%6$s','%7$s']::uuid[]) p),
      jsonb_build_array(jsonb_build_object('question_id', '%8$s', 'subject_id', '%2$s', 'body', 'my reflection'))
        || '%9$s'::jsonb,
      %4$s)
  $f$;
  note_a1 text := jsonb_build_array(jsonb_build_object(
    'question_id', '70000000-0000-4000-8000-000000000003',
    'subject_id', '10000000-0000-4000-8000-000000000011',
    'body', 'the deadlines are tight'))::text;
begin
  -- ---- the third audience
  perform pg_temp.refused(O, format('insert into te_questions (activity_id, audience, prompt) values (%s, %L, %L)', E, 'everyone', 'x'),
    'only peer, self and instructor questions', 'te_questions_audience_check');

  -- ---- drafts, as before
  perform pg_temp.ok(A1, format(full_eval, E, sA1, 2, 'false', c1, sA1, sA2, qs, '[]'), 'A1 saves a draft');
  perform pg_temp.ok(A1, format(full_eval, E, sA1, 3, 'false', c1, sA1, sA2, qs, note_a1), 'and changes it, adding a note');
  perform pg_temp.sees(A1, format('select 1 from te_ratings where rater_id = %L and score = 3', sA1), 2,
    'the later draft is what''s kept');
  perform pg_temp.sees(A1, format('select 1 from te_comments where question_id = %L', qn), 1,
    'A1 reads back the draft of their note');
  perform pg_temp.sees(O, format('select 1 from te_comments where question_id = %L', qn), 0,
    'the instructor can''t read a draft note, which still has A1''s name on it');
  perform pg_temp.sees(O, format('select 1 from te_comments where question_id = %L', qs), 1,
    'though they read the draft reflection, as 0058 had it');
  perform pg_temp.refused(A1, format('select save_team_eval(%s, ''[]'', %L)', E,
    jsonb_build_array(jsonb_build_object('question_id', qn, 'subject_id', sA2, 'body', 'hi'))),
    'a note is from the student, not about a teammate', 'about you');

  -- ---- submitting
  perform pg_temp.ok(A1, format(full_eval, E, sA1, 4, 'true', c1, sA1, sA2, qs, note_a1), 'A1 submits, giving 4s, with the note');
  perform pg_temp.sees(O, 'select 1 from te_notes where body = ''the deadlines are tight'' and activity_id = ' || E, 1,
    'the instructor reads the note');
  perform pg_temp.sees(O, format('select 1 from te_comments where question_id = %L', qn), 0,
    'and nothing under A1''s name is left of it');
  perform pg_temp.sees(A1, format('select 1 from te_comments where question_id = %L', qn), 0,
    'not even for A1');
  perform pg_temp.sees(A1, 'select 1 from te_notes', 0, 'no student reads te_notes, their own note included');
  perform pg_temp.sees(O, $q$
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'te_notes'
       and column_name not in ('id', 'activity_id', 'question_id', 'body')$q$, 0,
    'te_notes keeps no author and no time');

  -- ---- handed in is final, though it isn't due until tomorrow
  perform pg_temp.refused(A1, format(full_eval, E, sA1, 1, 'false', c1, sA1, sA2, qs, '[]'),
    'a draft save after submitting is refused', 'already submitted');
  perform pg_temp.refused(A1, format(full_eval, E, sA1, 1, 'true', c1, sA1, sA2, qs, note_a1),
    'and so is submitting again, which would leave a second note', 'already submitted');
  perform pg_temp.refused(A1, format('select save_team_eval(%s, ''[]'', ''[]'')', E),
    'and so is emptying it', 'already submitted');
  perform pg_temp.sees(A1, format('select 1 from te_ratings where rater_id = %L and score = 4', sA1), 2,
    'A1''s submitted 4s are untouched');
  perform pg_temp.sees(A1, format('select 1 from te_comments where author_id = %L and body = %L', sA1, 'my reflection'), 1,
    'and so is their reflection');
  perform pg_temp.sees(O, 'select 1 from te_notes where activity_id = ' || E, 1, 'and there is still one note');

  -- ---- a note is optional
  perform pg_temp.ok(A2, format(full_eval, E, sA2, 5, 'true', c1, sA1, sA2, qs, '[]'), 'A2 submits without a note');
  perform pg_temp.sees(A2, format('select 1 from te_submissions where student_id = %L', sA2), 1,
    'and has a submission of their own');
  perform pg_temp.sees(O, 'select 1 from te_notes where activity_id = ' || E, 1, 'still one note');
end $$;

-- Who may call what.
do $$
begin
  if has_function_privilege('anon', 'save_team_eval(uuid, jsonb, jsonb, boolean)', 'execute') then
    raise exception 'FAIL  anon can save an evaluation';
  end if;
  if not has_function_privilege('authenticated', 'save_team_eval(uuid, jsonb, jsonb, boolean)', 'execute') then
    raise exception 'FAIL  a student cannot save an evaluation';
  end if;
  if has_table_privilege('authenticated', 'te_notes', 'insert')
     or has_table_privilege('anon', 'te_notes', 'select') then
    raise exception 'FAIL  te_notes can be written directly, or read signed out';
  end if;
  raise notice 'ok    signed-in users save; anon doesn''t; te_notes is read-only to the signed-in';
end $$;

\echo 'All 0060 checks passed.'
rollback;
