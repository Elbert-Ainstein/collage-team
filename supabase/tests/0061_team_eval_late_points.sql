-- What 0061 promises: the late penalty is points off a late student's grade,
-- never below 0, only while the switch is on — and a late evaluation is
-- still marked late with it off. And the builder's Save (an upsert of every
-- row) works after students have submitted, while adding or removing a
-- category is still refused.
--
--   psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f supabase/tests/0061_team_eval_late_points.sql
--
-- LOCAL DATABASE ONLY, after every migration through 0061. Everything runs in
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

create function pg_temp.eq(got text, want text, label text) returns void language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'FAIL  % — got %, expected %', label, coalesce(got, 'null'), coalesce(want, 'null');
  end if;
  raise notice 'ok    % (%)', label, coalesce(got, 'null');
end $$;

-- ------------------------------------------------------------- fixtures
-- O instructor; A1 A2 on one team. A1 submits on time, A2 late.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000000001', 'o@te61.test'),
  ('00000000-0000-4000-8000-000000000011', 'a1@te61.test'),
  ('00000000-0000-4000-8000-000000000012', 'a2@te61.test');

insert into courses (id, name, owner_id) values
  ('20000000-0000-4000-8000-000000000001', 'TE course', '00000000-0000-4000-8000-000000000001');

insert into students (id, course_id, name, email, user_id, position) values
  ('10000000-0000-4000-8000-000000000011', '20000000-0000-4000-8000-000000000001', 'A1', 'a1@te61.test', '00000000-0000-4000-8000-000000000011', 1),
  ('10000000-0000-4000-8000-000000000012', '20000000-0000-4000-8000-000000000001', 'A2', 'a2@te61.test', '00000000-0000-4000-8000-000000000012', 2);

insert into team_sets (id, course_id, name) values
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Teams');
insert into teams (id, team_set_id, name, position) values
  ('40000000-0000-4000-8000-00000000000a', '30000000-0000-4000-8000-000000000001', 'Team A', 0);
insert into team_members (team_id, student_id) values
  ('40000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-000000000011'),
  ('40000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-000000000012');
update courses set current_team_set_id = '30000000-0000-4000-8000-000000000001'
 where id = '20000000-0000-4000-8000-000000000001';

insert into activities (id, course_id, title, type, opens_at, due_at, points_total) values
  ('50000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Eval', 'teameval', null, now() + interval '1 day', 5);
insert into te_categories (id, activity_id, position, name, levels) values
  ('60000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 0, 'Communication', '["a","b","c","d","e"]');

-- ------------------------------------------------------------ the checks
do $$
declare
  O  uuid := '00000000-0000-4000-8000-000000000001';
  A1 uuid := '00000000-0000-4000-8000-000000000011';
  A2 uuid := '00000000-0000-4000-8000-000000000012';
  E  text := '''50000000-0000-4000-8000-000000000001''';
  eid uuid := '50000000-0000-4000-8000-000000000001';
  sA1 text := '10000000-0000-4000-8000-000000000011';
  sA2 text := '10000000-0000-4000-8000-000000000012';
  c1 text := '60000000-0000-4000-8000-000000000001';
  -- %2$s gives both teammates %3$s and submits.
  full_eval text := $f$
    select save_team_eval(%1$s,
      (select jsonb_agg(jsonb_build_object('category_id', '%4$s', 'ratee_id', p, 'score', %3$s))
         from unnest(array['%5$s','%6$s']::uuid[]) p),
      '[]'::jsonb, true)
  $f$;
  grades text := $q$
    select string_agg(s.name || '=' || r.score::text, ' ' order by s.name)
      from check_in_results r join check_ins ci on ci.id = r.check_in_id join students s on s.id = r.student_id
     where ci.activity_id = '50000000-0000-4000-8000-000000000001'
  $q$;
  got text;
begin
  -- ---- the defaults
  perform pg_temp.as_user(O);
  select late_on || '/' || late_points into got from te_settings where activity_id = eid;
  perform pg_temp.as_admin();
  perform pg_temp.eq(got, 'true/2', 'a new evaluation takes 2 points off late ones');

  -- A1 gives A2 a 4 on time. A2 gives A1 a 1, submitting late.
  perform pg_temp.ok(A1, format(full_eval, E, sA1, 4, c1, sA1, sA2), 'A1 submits on time');
  update te_submissions set submitted_at = now() - interval '2 hours'
   where activity_id = eid and student_id = sA1::uuid;
  perform pg_temp.ok(O, 'update activities set due_at = now() - interval ''1 hour'' where id = ' || E, 'the due date passes');
  perform pg_temp.ok(A2, format(full_eval, E, sA2, 1, c1, sA1, sA2), 'A2 submits late');

  -- ---- on: points off, never below 0
  perform pg_temp.ok(O, format('select score_team_eval(%s)', E), 'scored with the penalty on');
  perform pg_temp.as_user(O); execute grades into got; perform pg_temp.as_admin();
  perform pg_temp.eq(got, 'A1=1.00 A2=2.00', 'A2 is late: 4 less 2 points; A1 on time keeps their 1');

  perform pg_temp.ok(O, 'update te_settings set late_points = 10 where activity_id = ' || E, 'the owner makes it 10 points');
  perform pg_temp.ok(O, format('select score_team_eval(%s)', E), 'scored again');
  perform pg_temp.as_user(O); execute grades into got; perform pg_temp.as_admin();
  perform pg_temp.eq(got, 'A1=1.00 A2=0', 'more points off than they earned leaves 0, not less');

  -- ---- off: nothing off, still late
  perform pg_temp.ok(O, 'update te_settings set late_on = false where activity_id = ' || E, 'the owner turns the penalty off');
  perform pg_temp.ok(O, format('select score_team_eval(%s)', E), 'scored again');
  perform pg_temp.as_user(O); execute grades into got; perform pg_temp.as_admin();
  perform pg_temp.eq(got, 'A1=1.00 A2=4.00', 'with it off, A2 keeps their 4');
  -- te_is_late is internal (0058): asked as the database, the way score_team_eval asks.
  select te_is_late(eid, sA2::uuid)::text into got;
  perform pg_temp.eq(got, 'true', 'and is still marked late');

  -- ---- the builder's Save, after submissions
  perform pg_temp.ok(O, format($q$
    insert into te_categories (id, activity_id, position, name, levels)
    values (%L, %s, 0, 'Talking', '["a","b","c","d","e"]')
    on conflict (id) do update set name = excluded.name, position = excluded.position, levels = excluded.levels$q$, c1, E),
    'the builder''s upsert of an existing category saves once students have submitted');
  perform pg_temp.refused(O, format($q$
    insert into te_categories (activity_id, position, name, levels)
    values (%s, 1, 'New', '["a","b","c","d","e"]')
    on conflict (id) do update set name = excluded.name$q$, E),
    'but a new category is still refused', 'can''t be added or removed');
  perform pg_temp.refused(O, format('delete from te_categories where id = %L', c1),
    'and so is removing one', 'can''t be added or removed');

  -- ---- what may be written
  perform pg_temp.refused(O, 'update te_settings set late_points = -1 where activity_id = ' || E,
    'points off can''t be negative', 'te_settings_late_points_check');
  perform pg_temp.ok(A1, 'update te_settings set late_on = true where activity_id = ' || E,
    'a student''s update reaches no rows');
  perform pg_temp.as_user(O);
  select late_on::text into got from te_settings where activity_id = eid;
  perform pg_temp.as_admin();
  perform pg_temp.eq(got, 'false', 'and the switch is as the owner left it');
end $$;

\echo 'All 0061 checks passed.'
rollback;
