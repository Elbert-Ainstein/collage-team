-- Live questions: release the answers on their own, when team mode can't run.
--
-- Run in Supabase → SQL Editor, after 0052. Safe to re-run.
--
-- A class whose team mode broke still answered on their own. This lets the
-- instructor (or a TF who runs check-ins) end the activity without its team
-- half: every student then reads the key and the explanations beside their
-- own answers, as they would after a session closed (0047, 0051 already let
-- them once the phase is 'closed'), and scoring grades their own answers.
--
-- What changes:
--   - live_state.team_skipped: new. True only when release_live_individual
--     ended it. Not grantable, like the phase.
--   - release_live_individual(aid): new. From before class or from team mode,
--     straight to closed, team_skipped set.
--   - score_live: unchanged when the team half ran. When it was skipped, the
--     own half counts right answers whatever the activity's grading says
--     (otherwise a 'team' activity would grade nothing), and no team score is
--     written — a 0 for a session that never happened is not a grade.

-- ---------------------------------------------------------------- prereqs
do $$
declare missing text;
begin
  select string_agg(want.fn, ', ' order by want.fn)
    into missing
    from (values
      ('activity_course(uuid)'),
      ('can_grade_course(uuid)'),
      ('can_run_checkins_course(uuid)'),
      ('live_answer_correct(uuid, text, jsonb)'),
      ('live_attempt_credit(integer)'),
      ('owns_activity(uuid)'),
      ('score_live(uuid, jsonb)')
    ) as want(fn)
   where to_regprocedure('public.' || want.fn) is null;

  if missing is not null then
    raise exception
      'Missing helper functions (%) -- run 0047 and 0049 before this file.',
      missing;
  end if;
end $$;

-- ------------------------------------------------------------------ column
alter table live_state add column if not exists team_skipped boolean not null default false;

-- 0047 grants update on the three settings only; this column is the RPC's.
-- Saying so again keeps it true on a database where someone widened it.
revoke update (team_skipped) on live_state from anon, authenticated;

-- ----------------------------------------------------------------- release
/**
 * End the activity without its team half. FOR UPDATE on the state row, so an
 * autosave racing this (guard_live_response holds FOR SHARE) lands before it
 * or not at all — never after the key is out.
 */
create or replace function release_live_individual(aid uuid) returns live_state
language plpgsql security definer set search_path = public as $$
declare st live_state;
begin
  if not can_run_checkins_course(activity_course(aid)) then
    raise exception 'Only the instructor, or a TF who runs check-ins, can release the answers';
  end if;
  select * into st from live_state where activity_id = aid for update;
  if st is null then
    raise exception 'That isn''t a live questions activity';
  end if;
  if st.phase = 'closed' then
    raise exception 'This one is already closed';
  end if;
  perform set_config('live.phase_change', 'on', true);
  update live_state
     set phase = 'closed', closed_at = now(), team_skipped = true
   where activity_id = aid
  returning * into st;
  perform set_config('live.phase_change', 'off', true);
  return st;
end $$;

-- ------------------------------------------------------------------ score
/**
 * 0049's score_live. When the team half was skipped, the own half is scored
 * on right answers and the team half is left alone.
 */
create or replace function score_live(aid uuid, verdicts jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  st        live_state;
  n         int;
  owner     boolean := owns_activity(aid);
  new_status text;
  indiv_id  uuid;
  team_id_  uuid;
  students_n int;
  teams_n   int := 0;
  -- Completion only: the activity grades the team's answers, and they exist.
  ci_own    boolean;
begin
  if not can_grade_course(activity_course(aid)) then
    raise exception 'Only someone who can grade this course can score it';
  end if;
  -- One scoring at a time: two people pressing Score together would
  -- interleave their updates.
  select * into st from live_state where activity_id = aid for update;
  if st is null or st.phase <> 'closed' then
    raise exception 'Close team mode before scoring';
  end if;
  -- Once the instructor has released it, only she re-scores: a TF's run would
  -- rewrite the right/wrong marks under grades it can't change.
  if not owner and exists (
    select 1 from check_in_results r join check_ins ci on ci.id = r.check_in_id
     where ci.activity_id = aid and r.status = 'scored') then
    raise exception 'Already released — only the instructor can re-score it';
  end if;
  new_status := case when owner then 'scored' else 'needs_review' end;
  ci_own := st.grading = 'team' and not st.team_skipped;
  select count(*) into n from live_questions where activity_id = aid;

  -- What is right, question by question. The flag lets these past
  -- guard_live_response, which otherwise closes own answers after team mode.
  perform set_config('live.scoring', 'on', true);
  update live_responses r
     set correct = live_answer_correct(r.question_id, r.answer, verdicts)
   where r.activity_id = aid;
  update live_attempts a
     set correct = live_answer_correct(a.question_id, a.answer, verdicts)
   where a.activity_id = aid;
  update live_locks l
     set correct = live_answer_correct(l.question_id, l.answer, verdicts)
   where l.activity_id = aid;
  perform set_config('live.scoring', 'off', true);

  -- The individual check-in, made to match: out of the number of questions,
  -- on completion when only the team's answers count.
  select id into indiv_id from check_ins where activity_id = aid and kind = 'individual' limit 1;
  if indiv_id is null then
    insert into check_ins (activity_id, label, kind, scale, max_points, posted, position)
    values (aid, 'Individual', 'individual', 'points', n, true, 0)
    returning id into indiv_id;
  end if;
  update check_ins
     set scale = case when ci_own then 'ci' else 'points' end,
         max_points = n
   where id = indiv_id;

  -- Own scores, for everyone on the course — no answer is 0, not a gap.
  insert into check_in_results (check_in_id, subject_type, student_id, status, score, is_ci, ci_met)
  select indiv_id, 'student', s.id, new_status,
         case when ci_own then null
              else (select count(*) from live_responses r
                     where r.activity_id = aid and r.student_id = s.id and r.correct) end,
         ci_own,
         case when ci_own
              then (select count(*) from live_responses r
                     where r.activity_id = aid and r.student_id = s.id) >= n
              else true end
    from students s
   where s.course_id = activity_course(aid)
  on conflict (check_in_id, student_id) where subject_type = 'student'
  do update set
    score = excluded.score,
    is_ci = excluded.is_ci,
    ci_met = excluded.ci_met,
    status = case when check_in_results.status = 'scored' then 'scored' else excluded.status end,
    updated_at = now()
  where check_in_results.status <> 'excused'
    and (check_in_results.status <> 'scored' or owner);
  get diagnostics students_n = row_count;

  if not st.team_skipped then
    select id into team_id_ from check_ins where activity_id = aid and kind = 'team' limit 1;
    if team_id_ is null then
      insert into check_ins (activity_id, label, kind, scale, max_points, posted, position)
      values (aid, 'Team', 'team', 'points', n, true, 1)
      returning id into team_id_;
    end if;
    update check_ins set scale = 'points', max_points = n where id = team_id_;

    -- Team scores, for every team the activity was run with: per question, the
    -- credit of the first try that was right. A question never got is 0.
    insert into check_in_results (check_in_id, subject_type, team_id, status, score, is_ci, ci_met)
    select team_id_, 'team', t.team_id, new_status,
           (select coalesce(sum(live_attempt_credit(f.first_right)), 0)
              from (select min(a.attempt) as first_right
                      from live_attempts a
                     where a.activity_id = aid and a.team_id = t.team_id and a.correct
                     group by a.question_id) f),
           false, true
      from (select distinct r.team_id from activity_rosters r where r.activity_id = aid) t
    on conflict (check_in_id, team_id) where subject_type = 'team'
    do update set
      score = excluded.score,
      status = case when check_in_results.status = 'scored' then 'scored' else excluded.status end,
      updated_at = now()
    where check_in_results.status <> 'excused'
      and (check_in_results.status <> 'scored' or owner);
    get diagnostics teams_n = row_count;
  end if;

  update live_state set scored_at = now() where activity_id = aid;

  return jsonb_build_object('students', students_n, 'teams', teams_n, 'status', new_status);
end $$;

-- Who may call what (0047's note: revoke from all three first). score_live
-- keeps 0049's grants through create or replace; said again all the same.
revoke all on function release_live_individual(uuid), score_live(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function release_live_individual(uuid), score_live(uuid, jsonb)
  to authenticated;
