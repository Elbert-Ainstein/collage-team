-- Team evaluation: the late penalty in points, and a switch for it (0061).
--
-- Run in Supabase → SQL Editor, after 0060. Safe to re-run.
--
-- 0058 took a percent of a late student's grade off. Instructors think of it
-- as points: "two points off if it's late". And some don't want a penalty
-- at all, but still want to see who was late.
--
-- What changes:
--   - te_settings.late_points: the points taken off a late student's grade,
--     never below 0. Default 2.
--   - te_settings.late_on: whether that happens at all. Default on. Off, a
--     late evaluation loses nothing — and is still marked late everywhere
--     (te_is_late, the instructor's results, set_team_eval_late).
--   - score_team_eval reads those two instead of late_penalty.
--   - Evaluations that already exist keep what their percent came to on
--     their own total (10% of 25 is 2.5 points); one with 0% gets the
--     switch off. That conversion happens once, when the columns are added.
--   - late_penalty stays, unread, so a page still open from the older build
--     can save without an error.
--
-- Also a fix to 0058: once anyone had submitted, the builder's Save failed
-- outright — "categories and questions can't be added or removed" — even
-- with nothing added or removed, so not even a setting could change. The
-- builder writes every row as an upsert, and an upsert fires BEFORE INSERT
-- triggers before ON CONFLICT turns it into an update; guard_te_shape read
-- that as a new row. It now lets an insert through when the row is already
-- there: the UPDATE that follows is checked as before.
--
-- The app's builder writes late_points and late_on, so this file must run
-- before that build ships.

-- ---------------------------------------------------------------- prereqs
do $$
declare missing text;
begin
  select string_agg(want.fn, ', ' order by want.fn)
    into missing
    from (values
      ('score_team_eval(uuid)'),
      ('te_is_late(uuid, uuid)'),
      ('save_team_eval(uuid, jsonb, jsonb, boolean)')
    ) as want(fn)
   where to_regprocedure('public.' || want.fn) is null;

  if missing is not null then
    raise exception 'Missing functions (%) -- run 0058 and 0060 before this file.', missing;
  end if;
  if to_regclass('public.te_notes') is null then
    raise exception 'Missing te_notes -- run 0060 before this file.';
  end if;
end $$;

-- ---------------------------------------------------------- the settings
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'te_settings'
                    and column_name = 'late_points') then
    alter table te_settings
      add column late_points numeric not null default 2 check (late_points >= 0),
      add column late_on     boolean not null default true;

    -- What each existing evaluation's percent came to on its own total.
    -- guard_te_settings is told this is a system write, as score_team_eval
    -- does, so it neither checks nor stamps it as the instructor's edit.
    perform set_config('te.scoring', 'on', true);
    update te_settings st
       set late_on = st.late_penalty > 0,
           late_points = case when st.late_penalty > 0
                              then round((select 5 * count(*) from te_categories c
                                           where c.activity_id = st.activity_id)
                                         * st.late_penalty / 100.0, 2)
                              else 2 end;
    perform set_config('te.scoring', 'off', true);
  end if;
end $$;

comment on column te_settings.late_penalty is
  'Unread since 0061 (late_points, late_on). Kept so an older build''s save still works.';

grant update (late_points, late_on) on te_settings to authenticated;

-- --------------------------------------------- saving after submissions
/**
 * 0058's guard_te_shape, letting an upsert of an existing row reach its
 * UPDATE. Otherwise the same: once anyone has submitted, no category or
 * question is added, removed, moved to another evaluation, or switched to
 * another audience.
 */
create or replace function guard_te_shape() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  aid     uuid := coalesce(new.activity_id, old.activity_id);
  already boolean;
begin
  -- Deleting the activity (or course) takes these with it: a cascade.
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  if not exists (select 1 from te_submissions s where s.activity_id = aid) then
    return coalesce(new, old);
  end if;
  -- An upsert of a row that's already there: ON CONFLICT makes it an UPDATE,
  -- and this trigger checks that UPDATE when it fires for it.
  if tg_op = 'INSERT' then
    execute format('select exists (select 1 from public.%I where id = $1)', tg_table_name)
      into already using new.id;
    if already then
      return new;
    end if;
  end if;
  -- A question may not switch audience either. Through jsonb because this
  -- guards two tables and only one has the column (plpgsql would still
  -- resolve new.audience on the other).
  if tg_op = 'UPDATE' and new.activity_id = old.activity_id
     and to_jsonb(new) ->> 'audience' is not distinct from to_jsonb(old) ->> 'audience' then
    return new;
  end if;
  raise exception 'Students have submitted this evaluation, so categories and questions can''t be added or removed now — you can still change their wording';
end $$;

revoke all on function guard_te_shape() from public, anon, authenticated;

-- ---------------------------------------------------------------- scoring
/**
 * 0058's score_team_eval, with the late penalty in points: a late student's
 * grade is the sum of their category averages less late_points, never below
 * 0 — when late_on. Otherwise exactly as 0058 has it.
 */
create or replace function score_team_eval(aid uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  st         te_settings;
  total      numeric;
  indiv_id   uuid;
  releases   boolean;
  new_status text;
  set_id     uuid;
  n          int;
  unrated    int;
begin
  if not can_grade_course(activity_course(aid)) then
    raise exception 'Only someone who can grade this course can score it';
  end if;
  select * into st from te_settings where activity_id = aid for update;
  if st.activity_id is null then
    raise exception 'That isn''t a team evaluation';
  end if;
  select 5 * count(*) into total from te_categories where activity_id = aid;
  if total = 0 then
    raise exception 'Add a category before you score it';
  end if;

  select id into indiv_id from check_ins where activity_id = aid and kind = 'individual' limit 1;
  if indiv_id is null then
    insert into check_ins (activity_id, label, kind, scale, max_points, posted, position)
    values (aid, 'Individual', 'individual', 'points', total, true, 0)
    returning id into indiv_id;
  end if;
  update check_ins set scale = 'points', max_points = total where id = indiv_id;

  releases := can_release_check_in(indiv_id);
  new_status := case when releases then 'scored' else 'needs_review' end;
  if not releases and exists (
    select 1 from check_in_results r where r.check_in_id = indiv_id and r.status = 'scored') then
    raise exception 'Already released — only someone who can release grades can re-score it';
  end if;

  -- Whoever it was run with; before anyone has saved, the class's teams now.
  select c.current_team_set_id into set_id from courses c where c.id = activity_course(aid);

  with grades as (
    select who.id as student_id, s.submitted_at,
           case when s.student_id is null then 0
                when g.points is null then null
                when st.late_on and te_is_late(aid, who.id) then greatest(0, round(g.points - st.late_points, 2))
                else round(g.points, 2) end as score
      from (
        select r.student_id as id from activity_rosters r where r.activity_id = aid
        union
        select tm.student_id from team_members tm join teams t on t.id = tm.team_id
         where t.team_set_id = set_id
           and not exists (select 1 from activity_rosters x where x.activity_id = aid)
      ) who
      left join te_submissions s on s.activity_id = aid and s.student_id = who.id
      -- The sum of their category averages, from teammates who submitted.
      left join lateral (
        select sum(a.avg) as points
          from (
            select avg(x.score)::numeric as avg
              from te_ratings x
             where x.activity_id = aid and x.ratee_id = who.id and x.rater_id <> who.id
               and exists (select 1 from te_submissions y
                            where y.activity_id = aid and y.student_id = x.rater_id)
             group by x.category_id
          ) a
      ) g on true
  ), written as (
    insert into check_in_results (check_in_id, subject_type, student_id, status, score, is_ci, ci_met, submitted_at)
    select indiv_id, 'student', g.student_id, new_status, g.score, false, true, g.submitted_at
      from grades g
     where g.score is not null
    on conflict (check_in_id, student_id) where subject_type = 'student'
    do update set
      score = excluded.score,
      is_ci = false,
      submitted_at = excluded.submitted_at,
      status = case when check_in_results.status = 'scored' then 'scored' else excluded.status end,
      updated_at = now()
    where check_in_results.status <> 'excused'
      and (check_in_results.status <> 'scored' or releases)
    returning 1
  )
  select (select count(*) from written), (select count(*) from grades where score is null)
    into n, unrated;

  perform set_config('te.scoring', 'on', true);
  update te_settings set scored_at = now() where activity_id = aid;
  perform set_config('te.scoring', 'off', true);

  return jsonb_build_object('students', n, 'status', new_status, 'unrated', unrated, 'out_of', total);
end $$;


-- create or replace keeps 0058's grants; said again so a re-run leaves no doubt.
revoke all on function score_team_eval(uuid) from public, anon, authenticated;
grant execute on function score_team_eval(uuid) to authenticated;
