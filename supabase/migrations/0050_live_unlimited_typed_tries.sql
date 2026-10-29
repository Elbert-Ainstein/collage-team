-- Live questions, team mode: a typed answer is tried until the team has it.
--
-- Run in Supabase → SQL Editor, after 0049. Safe to re-run.
--
-- 0049 gave a team three tries at a number or an expression, then locked the
-- question wrong. Now a team keeps going for as long as it likes. What a
-- question is worth doesn't change — the whole point on the first try, then
-- half, then a quarter, then nothing (live_attempt_credit) — so a fourth try
-- and a fortieth both earn nothing, and only find the answer.
--
-- "As long as it likes" is a hundred tries: more than any team types by hand,
-- and a bound on what a script hammering lock_team_answer could pile into the
-- table and onto every teammate's realtime feed. 0049's lock_team_answer
-- already locks a question wrong at live_max_attempts, so it needs no change.
--
-- A team that can't find the answer would otherwise be stuck there for the
-- rest of the session: the next question opens only once this one is done.
-- So once another try is worth nothing, anyone on the team may move it on
-- (move_team_on), which locks the question wrong on the team's last try —
-- what running out of tries did before. Anyone, under either lock rule: the
-- question pays nothing by then, and a holdout shouldn't keep a team from
-- the questions that still do.
--
-- Multiple choice is unchanged: one try per option, and no moving on. It
-- can't trap a team — the options run out — and a team always leaves it
-- knowing the answer.
--
-- What changes:
--   - live_attempts.attempt goes up to a hundred (0049's ceiling was eight).
--   - live_max_attempts is a hundred for a typed answer (0049's was three).
--   - move_team_on, new.

-- ---------------------------------------------------------------- prereqs
do $$
declare missing text;
begin
  select string_agg(want.fn, ', ' order by want.fn)
    into missing
    from (values
      ('live_attempt_credit(integer)'),
      ('live_max_attempts(uuid)'),
      ('live_my_student(uuid)'),
      ('live_my_team(uuid)'),
      ('live_student_reads(uuid)'),
      ('lock_team_answer(uuid, jsonb)')
    ) as want(fn)
   where to_regprocedure('public.' || want.fn) is null;

  if missing is not null then
    raise exception 'Missing helper functions (%) -- run 0049 before this file.', missing;
  end if;
end $$;

-- ------------------------------------------------------------- the table
alter table live_attempts drop constraint if exists live_attempts_attempt_check;
alter table live_attempts add constraint live_attempts_attempt_check check (attempt between 1 and 100);

-- ---------------------------------------------------------------- the rules
/**
 * How many tries a team gets at a question (maxTries in src/live/answers.ts):
 * one per option for multiple choice, and a hundred — in practice, no limit —
 * for a typed answer.
 */
create or replace function live_max_attempts(qid uuid) returns int
language sql stable security definer set search_path = public as $$
  select case when q.kind = 'mc' then greatest(jsonb_array_length(q.options), 1) else 100 end
    from live_questions q where q.id = qid;
$$;

/**
 * Done with a typed question the team hasn't got, once another try would be
 * worth nothing: lock it wrong, on the team's last try. Anyone on the team,
 * under either lock rule. Not a try itself, so it earns nothing and changes no
 * score.
 */
create or replace function move_team_on(qid uuid) returns live_locks
language plpgsql security definer set search_path = public as $$
declare
  aid   uuid;
  kind_ text;
  ph    text;
  sid   uuid;
  tid   uuid;
  last_ live_attempts;
  res   live_locks;
begin
  select activity_id, kind into aid, kind_ from live_questions where id = qid;
  if aid is null or not live_student_reads(aid) then
    raise exception 'That question isn''t available';
  end if;
  if kind_ = 'mc' then
    raise exception 'Try the options that are left';
  end if;
  select phase into ph from live_state where activity_id = aid for share;
  if ph is distinct from 'team' then
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

  select * into last_ from live_attempts
   where question_id = qid and team_id = tid
   order by attempt desc
   limit 1;
  if not found or live_attempt_credit(last_.attempt + 1) > 0 then
    raise exception 'There are still points for this one — keep trying';
  end if;

  -- Not locked, so none of its tries was right.
  insert into live_locks (question_id, activity_id, team_id, answer, correct, locked_by)
  values (qid, aid, tid, last_.answer, false, sid)
  returning * into res;
  return res;
end $$;

-- Who may call what (see 0047's note: Supabase grants new functions to anon
-- and authenticated by name, so everything is revoked from all three first).
revoke all on function live_max_attempts(uuid), move_team_on(uuid) from public, anon, authenticated;
grant execute on function move_team_on(uuid) to authenticated;
