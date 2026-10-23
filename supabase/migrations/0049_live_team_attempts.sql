-- Live questions, team mode: told right or wrong at once, and another try.
--
-- Run in Supabase → SQL Editor, after 0048. Safe to re-run.
--
-- Until now a team's answer was final, and nobody said whether it was right
-- until the session closed (or the team locked it, with answers shown as
-- teams lock). Now it works like a scratch-off (IF-AT) card: a team submits,
-- is told right or wrong as the answer lands, and if it's wrong tries again.
-- Getting a question right is worth less the more tries it took — the whole
-- point on the first, then half, then a quarter, then nothing
-- (live_attempt_credit). Multiple choice may try every option, so a team
-- always leaves knowing the answer; a typed answer gets three tries
-- (live_max_attempts).
--
-- It is the same for both ways of grading. "Own + team" and "team only" only
-- ever decided what OWN answers count for — right or wrong, or completion —
-- and the team half is scored this way under either.
--
-- What changes:
--   - live_attempts: every try, right or wrong, with the verdict it was given.
--     Read by the team and by staff; written only by lock_team_answer.
--   - live_locks keeps meaning "the team is done with this question": now,
--     it got it right or ran out of tries. So the key shown "as teams lock"
--     still reaches a team only once it's done with that question, and the
--     app's "which question is this team on" doesn't change.
--   - cast_vote refuses an answer the team has already tried.
--   - lock_team_answer judges the try as it lands, and locks the question
--     only when it's right or the tries are used up.
--   - score_live scores each of a team's questions by the FIRST try that was
--     right — judged again with the key as it is then, so a corrected key
--     re-scores the tries — rather than by the final lock.
--
-- Expressions: the database still doesn't do algebra. When the owner saves a
-- key, her browser evaluates each accepted form at twenty fixed points
-- (live_keys.prints); when a team submits an expression, its browser does the
-- same for the answer, and the two sets of values are compared here by the
-- rule expressionsEquivalent uses (src/live/answers.ts). A browser could send
-- values that aren't its answer's — but only values matching the key's earn
-- "right", and producing those takes knowing the key. And score_live decides
-- expressions again from the answer TEXT, by the staff client's algebra, so
-- the gradebook never rests on what a student's browser said.

-- ---------------------------------------------------------------- prereqs
do $$
declare missing text;
begin
  select string_agg(want.fn, ', ' order by want.fn)
    into missing
    from (values
      ('live_answer_correct(uuid, text, jsonb)'),
      ('live_answer_fits(uuid, text)'),
      ('live_my_student(uuid)'),
      ('live_my_team(uuid)'),
      ('live_student_reads(uuid)'),
      ('staff_of_activity(uuid)'),
      ('can_grade_course(uuid)'),
      ('owns_activity(uuid)'),
      ('activity_course(uuid)')
    ) as want(fn)
   where to_regprocedure('public.' || want.fn) is null;

  if missing is not null then
    raise exception 'Missing helper functions (%) -- run 0047 before this file.', missing;
  end if;
end $$;

-- ------------------------------------------------------------- the tables
-- Each accepted form's values at the twenty points, written by the owner's
-- browser with the key (src/live/data.ts). Read by nobody but lock_team_answer:
-- it's as secret as the key, and lives in the key's row.
alter table live_keys add column if not exists prints jsonb not null default '[]'::jsonb;
do $$ begin
  alter table live_keys add constraint live_keys_prints_array check (jsonb_typeof(prints) = 'array');
exception when duplicate_object then null; end $$;

create table if not exists live_attempts (
  question_id uuid not null,
  activity_id uuid not null,
  team_id     uuid not null references teams(id) on delete cascade,
  -- 1 for the first. At most eight: multiple choice has at most eight options.
  attempt     int  not null check (attempt between 1 and 8),
  answer      text not null check (length(answer) between 1 and 200),
  -- The verdict the team was given; score_live gives it again. Null only on a
  -- lock carried over from before this file and not yet scored.
  correct     boolean,
  locked_by   uuid references students(id) on delete set null,
  locked_at   timestamptz not null default now(),
  primary key (question_id, team_id, attempt),
  -- The same wrong answer twice is no new try.
  unique (question_id, team_id, answer),
  foreign key (question_id, activity_id)
    references live_questions (id, activity_id) on delete cascade
);
create index if not exists live_attempts_activity_idx on live_attempts (activity_id, team_id);

-- Every lock made before this file was a team's one and only try.
insert into live_attempts (question_id, activity_id, team_id, attempt, answer, correct, locked_by, locked_at)
select l.question_id, l.activity_id, l.team_id, 1, l.answer, l.correct, l.locked_by, l.locked_at
  from live_locks l
 where not exists (select 1 from live_attempts a
                    where a.question_id = l.question_id and a.team_id = l.team_id)
on conflict do nothing;

-- ---------------------------------------------------------------- the rules
/** What getting a question right on try n is worth (TRY_CREDIT in src/live/answers.ts). */
create or replace function live_attempt_credit(n int) returns numeric
language sql immutable set search_path = public as $$
  select (case n when 1 then 1 when 2 then 0.5 when 3 then 0.25 else 0 end)::numeric;
$$;

/** How many tries a team gets at a question (maxTries in src/live/answers.ts). */
create or replace function live_max_attempts(qid uuid) returns int
language sql stable security definer set search_path = public as $$
  select case when q.kind = 'mc' then greatest(jsonb_array_length(q.options), 1) else 3 end
    from live_questions q where q.id = qid;
$$;

-- --------------------------------------------------------- expression prints
/**
 * Is this a print: {"vars": [text...], "values": [number|null x 20]}? Twenty
 * is TRIALS in src/live/answers.ts. Anything else — or anything big — is not.
 */
create or replace function live_print_ok(p jsonb) returns boolean
language plpgsql immutable set search_path = public as $$
begin
  -- Nothing here can fail on a non-object: -> on an array or a scalar is null.
  if p is null or jsonb_typeof(p) <> 'object' or length(p::text) > 4000
     or jsonb_typeof(p -> 'vars') is distinct from 'array'
     or jsonb_typeof(p -> 'values') is distinct from 'array' then
    return false;
  end if;
  return jsonb_array_length(p -> 'values') = 20
     and not exists (select 1 from jsonb_array_elements(p -> 'vars') v where jsonb_typeof(v) <> 'string')
     and not exists (select 1 from jsonb_array_elements(p -> 'values') v where jsonb_typeof(v) not in ('number', 'null'));
end $$;

/**
 * samePrint in src/live/answers.ts, line for line: the same variables, real
 * at the same points, and agreeing to a relative 1e-9 wherever they are — at
 * ten points at least. float8, as the browser's numbers are.
 */
create or replace function live_prints_match(a jsonb, b jsonb) returns boolean
language plpgsql immutable set search_path = public as $$
declare
  x jsonb;
  y jsonb;
  fx float8;
  fy float8;
  compared int := 0;
begin
  if not (live_print_ok(a) and live_print_ok(b)) then
    return false;
  end if;
  if (select coalesce(array_agg(v order by v), '{}') from jsonb_array_elements_text(a -> 'vars') v)
     <> (select coalesce(array_agg(v order by v), '{}') from jsonb_array_elements_text(b -> 'vars') v) then
    return false;
  end if;
  for i in 0 .. 19 loop
    x := a -> 'values' -> i;
    y := b -> 'values' -> i;
    if (jsonb_typeof(x) = 'number') <> (jsonb_typeof(y) = 'number') then
      return false;
    end if;
    continue when jsonb_typeof(x) <> 'number';
    fx := (x #>> '{}')::float8;
    fy := (y #>> '{}')::float8;
    compared := compared + 1;
    if abs(fx - fy) > 1e-9 * greatest(1, abs(fx), abs(fy)) then
      return false;
    end if;
  end loop;
  return compared >= 10;
exception
  -- A number past float8 can't have come from a browser; it matches nothing.
  when numeric_value_out_of_range then
    return false;
end $$;

/**
 * Is this try right, decided now? Multiple choice and numbers exactly as
 * score_live decides them. An expression by its print, when the key has
 * prints and the print is of this answer; otherwise only by matching an
 * accepted form as written.
 */
create or replace function live_judge(qid uuid, ans text, print jsonb) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  kind_  text;
  prints jsonb;
begin
  select q.kind, k.prints into kind_, prints
    from live_questions q
    left join live_keys k on k.question_id = q.id
   where q.id = qid;
  if kind_ = 'expression'
     and print ->> 'answer' = ans
     and live_print_ok(print)
     and exists (select 1 from jsonb_array_elements(coalesce(prints, '[]'::jsonb)) p where live_print_ok(p)) then
    return exists (select 1 from jsonb_array_elements(prints) p where live_prints_match(p, print));
  end if;
  return coalesce(live_answer_correct(qid, ans, '{}'::jsonb), false);
end $$;

-- ------------------------------------------------------------------- RLS
alter table live_attempts enable row level security;
revoke all on live_attempts from anon, authenticated;
grant select on live_attempts to authenticated;
-- No writes from a client at all: lock_team_answer is the only way in.

drop policy if exists "read live_attempts" on live_attempts;
create policy "read live_attempts" on live_attempts
  for select to authenticated
  using (staff_of_activity(activity_id) or team_id = live_my_team(activity_id));

-- ------------------------------------------------------------- in class
/** 0047's cast_vote, and an answer the team has tried is off the table. */
create or replace function cast_vote(qid uuid, ans text) returns void
language plpgsql security definer set search_path = public as $$
declare
  aid uuid;
  ph  text;
  sid uuid;
  tid uuid;
begin
  if ans is null or length(btrim(ans)) = 0 or length(ans) > 200 then
    raise exception 'That answer can''t be used';
  end if;
  select activity_id into aid from live_questions where id = qid;
  if aid is null or not live_student_reads(aid) then
    raise exception 'That question isn''t available';
  end if;
  select phase into ph from live_state where activity_id = aid for share;
  if ph is distinct from 'team' then
    raise exception 'Team mode isn''t running';
  end if;
  sid := live_my_student(aid);
  tid := live_my_team(aid);
  if sid is null or tid is null then
    raise exception 'You''re not on a team for this activity — ask your instructor to add you';
  end if;

  if not coalesce(live_answer_fits(qid, btrim(ans)), false) then
    raise exception 'That answer can''t be used';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(qid::text || ':' || tid::text, 0));
  if exists (select 1 from live_locks where question_id = qid and team_id = tid) then
    raise exception 'Your team has already locked this one';
  end if;
  if exists (select 1 from live_attempts where question_id = qid and team_id = tid and answer = btrim(ans)) then
    raise exception 'Your team already tried that one';
  end if;

  insert into live_votes (question_id, activity_id, team_id, student_id, answer)
  values (qid, aid, tid, sid, btrim(ans))
  on conflict (question_id, student_id)
  do update set answer = excluded.answer, team_id = excluded.team_id, updated_at = now();
end $$;

-- 0047's took only the question and returned the lock. Dropped, not
-- overloaded: lock_team_answer(qid) must keep meaning one function.
drop function if exists lock_team_answer(uuid);

/**
 * Submit the caller's current vote as the team's next try, and say whether
 * it's right. 'any': anyone on the team may. 'all': every member must be on
 * the same answer, except those marked absent on the sheet (0047).
 *
 * `print` is for an expression: {"answer": ..., "vars": ..., "values": ...}
 * as src/live/answers.ts makes it, used only if it is of the answer the
 * caller is voting for. Returns the try; the question is locked as well when
 * the try is right or the last one the team gets.
 */
create or replace function lock_team_answer(qid uuid, print jsonb default null) returns live_attempts
language plpgsql security definer set search_path = public as $$
declare
  aid   uuid;
  st    live_state;
  sid   uuid;
  tid   uuid;
  ans   text;
  n     int;
  agree int;
  try_n int;
  ok    boolean;
  res   live_attempts;
begin
  select activity_id into aid from live_questions where id = qid;
  if aid is null or not live_student_reads(aid) then
    raise exception 'That question isn''t available';
  end if;
  select * into st from live_state where activity_id = aid for share;
  if st.phase is distinct from 'team' then
    raise exception 'Team mode isn''t running';
  end if;
  sid := live_my_student(aid);
  tid := live_my_team(aid);
  if sid is null or tid is null then
    raise exception 'You''re not on a team for this activity';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(qid::text || ':' || tid::text, 0));

  if exists (select 1 from live_locks where question_id = qid and team_id = tid) then
    raise exception 'Your team has already locked this one';
  end if;

  select answer into ans from live_votes where question_id = qid and student_id = sid;
  if ans is null then
    raise exception 'Pick an answer first';
  end if;
  if exists (select 1 from live_attempts where question_id = qid and team_id = tid and answer = ans) then
    raise exception 'Your team already tried that one';
  end if;

  if st.lock_rule = 'all' then
    select count(*), count(*) filter (where v.answer = ans)
      into n, agree
      from activity_rosters r
      left join live_votes v on v.question_id = qid and v.student_id = r.student_id
     where r.activity_id = aid
       and r.team_id = tid
       and not exists (select 1 from tutorial_absences x
                        where x.activity_id = aid and x.team_id = tid and x.student_id = r.student_id);
    if agree < n then
      raise exception 'Everyone has to be on the same answer first';
    end if;
  end if;

  select coalesce(max(attempt), 0) + 1 into try_n
    from live_attempts where question_id = qid and team_id = tid;
  ok := live_judge(qid, ans, print);

  insert into live_attempts (question_id, activity_id, team_id, attempt, answer, correct, locked_by)
  values (qid, aid, tid, try_n, ans, ok, sid)
  returning * into res;

  -- Right, or out of tries: the team is done with this one.
  if ok or try_n >= live_max_attempts(qid) then
    insert into live_locks (question_id, activity_id, team_id, answer, correct, locked_by)
    values (qid, aid, tid, ans, ok, sid);
  end if;
  return res;
end $$;

-- ------------------------------------------------------------------ score
/**
 * 0047's score_live, with the team half scored by tries: each question earns
 * live_attempt_credit of the first try that was right, and nothing if none
 * was. Every try is judged again first, with the key and the expression
 * verdicts as they are now. The own half is unchanged, and the team half is
 * the same whichever way the activity grades.
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
  teams_n   int;
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

  -- The two check-ins, made to match: each half out of the number of questions,
  -- the individual half on completion when only the team's answers count.
  select id into indiv_id from check_ins where activity_id = aid and kind = 'individual' limit 1;
  if indiv_id is null then
    insert into check_ins (activity_id, label, kind, scale, max_points, posted, position)
    values (aid, 'Individual', 'individual', 'points', n, true, 0)
    returning id into indiv_id;
  end if;
  update check_ins
     set scale = case when st.grading = 'team' then 'ci' else 'points' end,
         max_points = n
   where id = indiv_id;

  select id into team_id_ from check_ins where activity_id = aid and kind = 'team' limit 1;
  if team_id_ is null then
    insert into check_ins (activity_id, label, kind, scale, max_points, posted, position)
    values (aid, 'Team', 'team', 'points', n, true, 1)
    returning id into team_id_;
  end if;
  update check_ins set scale = 'points', max_points = n where id = team_id_;

  -- Own scores, for everyone on the course — no answer is 0, not a gap.
  insert into check_in_results (check_in_id, subject_type, student_id, status, score, is_ci, ci_met)
  select indiv_id, 'student', s.id, new_status,
         case when st.grading = 'team' then null
              else (select count(*) from live_responses r
                     where r.activity_id = aid and r.student_id = s.id and r.correct) end,
         st.grading = 'team',
         case when st.grading = 'team'
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

  update live_state set scored_at = now() where activity_id = aid;

  return jsonb_build_object('students', students_n, 'teams', teams_n, 'status', new_status);
end $$;

-- Who may call what (see 0047's note: Supabase grants new functions to anon
-- and authenticated by name, so everything is revoked from all three first).
-- live_judge reads the key and the prints; like live_answer_correct it is
-- called only from inside lock_team_answer, as the owner, and by nobody else.
revoke all on function
  live_attempt_credit(int), live_max_attempts(uuid), live_print_ok(jsonb),
  live_prints_match(jsonb, jsonb), live_judge(uuid, text, jsonb),
  cast_vote(uuid, text), lock_team_answer(uuid, jsonb), score_live(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function
  cast_vote(uuid, text), lock_team_answer(uuid, jsonb), score_live(uuid, jsonb)
  to authenticated;

-- -------------------------------------------------------------- realtime
-- A wrong try changes nothing else a phone watches, so the tries themselves
-- are published (read through RLS: a team gets only its own).
do $$ begin
  alter publication supabase_realtime add table live_attempts;
exception when duplicate_object then null; when undefined_object then null; end $$;

alter table live_attempts replica identity full;
