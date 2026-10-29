-- Live questions, team mode: a leader submits for the team, and takes the roll.
--
-- Run in Supabase → SQL Editor, after 0050. Safe to re-run.
--
-- Until now anyone on a team could submit its answer, so the team's tries
-- were whoever tapped first. Now, once team mode starts, each team first picks
-- one person to submit for everyone, and that person says who isn't there.
--
--   1. The leader. Everyone taps one name on their team's list, themselves
--      included, and sees everyone else's tap as it lands. The leader is set
--      when every vote cast so far names the same person, and either the
--      whole team has voted (set at once) or at least two have and one of
--      them confirms. Votes may change until then; after, the leader is fixed
--      for the session.
--   2. The roll. The leader alone marks who is absent. That is the sheet's
--      own tutorial_absences, so it means what an absence already means (0016,
--      0031), and lock_rule 'all' already leaves absentees out (0047). The
--      leader may take it again later, when someone turns up late. The roll
--      only ever adds to the sheet or takes back its own marks: an absence
--      staff recorded stays, whatever the leader says.
--   3. Then team play as before, except that only the leader submits a try or
--      moves the team on. Everyone else still votes, so the team can see it
--      agrees. An absent student can't vote at all.
--
-- A leader the sheet later marks absent is no leader: the team votes again,
-- among those still there, and nobody submits until it has. Otherwise a staff
-- tick on the sheet could leave a team with nobody allowed to submit.
--
-- Also here: an explanation per question, written by the instructor. It says
-- why the answer is the answer, so a student reads it only once their team is
-- done with that question, or once the session has closed — never before
-- class, which is why it lives in its own table rather than on
-- live_questions, which students read while answering alone.
--
-- What changes:
--   - live_leader_votes, live_team_setup, live_explanations: new.
--   - tutorial_absences says who wrote each row: the sheet, or a roll.
--   - A student reads their teammates' absences, and their team's frozen
--     roster, once team mode has started — so the screen counts the same
--     people the RPCs below do.
--   - vote_live_leader, confirm_live_leader, set_live_absences: new.
--   - cast_vote refuses a student marked absent.
--   - lock_team_answer and move_team_on refuse anyone marked absent, and,
--     once a team has had a leader, anyone but its leader.

-- ---------------------------------------------------------------- prereqs
do $$
declare missing text;
begin
  select string_agg(want.fn, ', ' order by want.fn)
    into missing
    from (values
      ('live_attempt_credit(integer)'),
      ('live_answer_fits(uuid, text)'),
      ('live_judge(uuid, text, jsonb)'),
      ('live_max_attempts(uuid)'),
      ('live_my_student(uuid)'),
      ('live_my_team(uuid)'),
      ('live_phase(uuid)'),
      ('live_student_reads(uuid)'),
      ('move_team_on(uuid)'),
      ('owns_activity(uuid)'),
      ('staff_of_activity(uuid)')
    ) as want(fn)
   where to_regprocedure('public.' || want.fn) is null;

  if missing is not null then
    raise exception 'Missing helper functions (%) -- run 0050 before this file.', missing;
  end if;
end $$;

-- ------------------------------------------------------------- the tables
-- Each member's current pick for leader. One per student per activity; a
-- change of mind overwrites it.
create table if not exists live_leader_votes (
  activity_id  uuid not null references activities(id) on delete cascade,
  team_id      uuid not null references teams(id) on delete cascade,
  student_id   uuid not null references students(id) on delete cascade,
  candidate_id uuid not null references students(id) on delete cascade,
  updated_at   timestamptz not null default now(),
  primary key (activity_id, student_id)
);
create index if not exists live_leader_votes_team_idx on live_leader_votes (activity_id, team_id);

-- Where each team is in getting started: its leader, and when the roll was
-- taken. A row appears with the team's first vote.
create table if not exists live_team_setup (
  activity_id uuid not null references activities(id) on delete cascade,
  team_id     uuid not null references teams(id) on delete cascade,
  leader_id   uuid references students(id) on delete set null,
  leader_at   timestamptz,
  roll_at     timestamptz,
  primary key (activity_id, team_id)
);

-- Why the answer is the answer, one per question. Apart from the question for
-- the same reason the key is: a student reads one and not the other.
create table if not exists live_explanations (
  question_id uuid primary key,
  activity_id uuid not null,
  body        text not null check (length(btrim(body)) between 1 and 8000),
  updated_at  timestamptz not null default now(),
  foreign key (question_id, activity_id)
    references live_questions (id, activity_id) on delete cascade
);
create index if not exists live_explanations_activity_idx on live_explanations (activity_id);

-- Who wrote each absence. Staff, on the sheet, unless a leader's roll did. A
-- student's absence is a 0 for the team's check-in (0031), so the roll may
-- take back what it marked and nothing else. Staff have no update grant
-- (0016), and the sheet writes by delete-then-insert, so a team's row saved
-- from the sheet becomes the sheet's, as it should.
alter table tutorial_absences
  add column if not exists source text not null default 'sheet'
  check (source in ('sheet', 'roll'));

-- --------------------------------------------------------------- helpers
-- Definer, fixed search_path, as 0047's are (0044).

/** Is this student marked absent for this activity? */
create or replace function live_absent(aid uuid, sid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from tutorial_absences x where x.activity_id = aid and x.student_id = sid);
$$;

/** The team's leader, unless the sheet has since marked them absent. */
create or replace function live_team_leader(aid uuid, tid uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select s.leader_id from live_team_setup s
   where s.activity_id = aid and s.team_id = tid
     and s.leader_id is not null
     and not live_absent(aid, s.leader_id);
$$;

/**
 * May this student act for the team — submit a try, move it on? Anyone, until
 * the team has had a leader; after that only its leader, and nobody at all
 * while the one it had is marked absent and it hasn't picked again.
 */
create or replace function live_leads(aid uuid, tid uuid, sid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from live_team_setup s
                      where s.activity_id = aid and s.team_id = tid and s.leader_id is not null)
      or coalesce(live_team_leader(aid, tid) = sid, false);
$$;

/**
 * Where the team's vote for leader stands, counting only the people who are
 * there — as voters and as candidates. `agreed` is the one name every counted
 * vote is for, or null when there are none or they're split. leaderTally in
 * src/live/leader.ts says the same thing to the screen.
 */
create or replace function live_leader_tally(aid uuid, tid uuid,
  out agreed uuid, out voted int, out present int)
language plpgsql stable security definer set search_path = public as $$
begin
  select count(*) into present
    from activity_rosters r
   where r.activity_id = aid and r.team_id = tid and not live_absent(aid, r.student_id);

  select count(*), case when count(distinct v.candidate_id) = 1 then min(v.candidate_id::text)::uuid end
    into voted, agreed
    from live_leader_votes v
    join activity_rosters voter on voter.activity_id = aid and voter.student_id = v.student_id and voter.team_id = tid
    join activity_rosters cand  on cand.activity_id  = aid and cand.student_id  = v.candidate_id and cand.team_id = tid
   where v.activity_id = aid
     and not live_absent(aid, v.student_id)
     and not live_absent(aid, v.candidate_id);
end $$;

/**
 * The caller, as a member of a team in a running session who is there: their
 * student and team. Raises what cast_vote raises otherwise. FOR SHARE on the
 * state row, so a close can't land halfway through.
 */
create or replace function live_team_caller(aid uuid, out sid uuid, out tid uuid)
language plpgsql security definer set search_path = public as $$
declare ph text;
begin
  if aid is null or not live_student_reads(aid) then
    raise exception 'That activity isn''t available';
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
  if live_absent(aid, sid) then
    raise exception 'You''re marked absent for this session — tell your team''s leader if you''re here';
  end if;
end $$;

/**
 * The team's setup row, made if need be and locked FOR UPDATE: two votes
 * landing together are counted one after the other, never both against a
 * tally neither has seen.
 */
create or replace function live_setup_for_update(aid uuid, tid uuid) returns live_team_setup
language plpgsql security definer set search_path = public as $$
declare res live_team_setup;
begin
  insert into live_team_setup (activity_id, team_id) values (aid, tid) on conflict do nothing;
  select * into res from live_team_setup where activity_id = aid and team_id = tid for update;
  return res;
end $$;

/** Make `who` the team's leader. Called only once the tally says so. */
create or replace function live_set_leader(aid uuid, tid uuid, who uuid) returns live_team_setup
language plpgsql security definer set search_path = public as $$
declare res live_team_setup;
begin
  update live_team_setup
     set leader_id = who, leader_at = now()
   where activity_id = aid and team_id = tid
  returning * into res;
  return res;
end $$;

/**
 * May the caller read this question's explanation? Staff always. A student
 * who can read the activity once the session has closed, or once their own
 * team is done with this question (it has a lock) — never before class.
 */
create or replace function live_explanation_visible(qid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from live_questions q
      join live_state st on st.activity_id = q.activity_id
     where q.id = qid
       and (
         staff_of_activity(q.activity_id)
         or (live_student_reads(q.activity_id)
             and (st.phase = 'closed'
                  or (st.phase = 'team'
                      and exists (select 1 from live_locks l
                                   where l.question_id = qid
                                     and l.team_id = live_my_team(q.activity_id)))))
       ));
$$;

-- ------------------------------------------------------------------- RLS
alter table live_leader_votes enable row level security;
alter table live_team_setup   enable row level security;
alter table live_explanations enable row level security;

revoke all on live_leader_votes, live_team_setup, live_explanations from anon, authenticated;
grant select on live_leader_votes, live_team_setup, live_explanations to authenticated;
grant insert, update, delete on live_explanations to authenticated;
-- live_leader_votes and live_team_setup: no writes from a client at all; the
-- three RPCs below are the only way in.

drop policy if exists "read live_leader_votes" on live_leader_votes;
create policy "read live_leader_votes" on live_leader_votes
  for select to authenticated
  using (staff_of_activity(activity_id) or team_id = live_my_team(activity_id));

drop policy if exists "read live_team_setup" on live_team_setup;
create policy "read live_team_setup" on live_team_setup
  for select to authenticated
  using (staff_of_activity(activity_id) or team_id = live_my_team(activity_id));

drop policy if exists "read live_explanations" on live_explanations;
create policy "read live_explanations" on live_explanations
  for select to authenticated
  using (live_explanation_visible(question_id));

-- Whoever writes the key writes the explanation beside it.
drop policy if exists "owner writes live_explanations" on live_explanations;
create policy "owner writes live_explanations" on live_explanations
  for all to authenticated
  using (owns_activity(activity_id))
  with check (owns_activity(activity_id));

-- The team sees who its leader marked absent. Beside 0031's own-row policy,
-- never in place of it; only a live activity, only the caller's own team, and
-- only once team mode has started — before that there is no roll to see.
drop policy if exists "student reads team's live absences" on tutorial_absences;
create policy "student reads team's live absences" on tutorial_absences
  for select to authenticated
  using (
    coalesce(live_phase(activity_id), 'individual') <> 'individual'
    and live_student_reads(activity_id)
    and team_id = live_my_team(activity_id)
  );

-- The team's frozen roster, beside 0045's own-row policy: the leader RPCs
-- count these people, so the screen has to count the same ones. Only once
-- team mode has started, and only the caller's own team.
drop policy if exists "student reads team's live roster" on activity_rosters;
create policy "student reads team's live roster" on activity_rosters
  for select to authenticated
  using (
    coalesce(live_phase(activity_id), 'individual') <> 'individual'
    and live_student_reads(activity_id)
    and team_id = live_my_team(activity_id)
  );

-- ------------------------------------------------------------- the leader
/**
 * The caller's pick for leader: anyone on their team who is there,
 * themselves included. Sets the leader at once if that makes everyone who is
 * there agree. Returns the team's setup row.
 */
create or replace function vote_live_leader(aid uuid, candidate uuid) returns live_team_setup
language plpgsql security definer set search_path = public as $$
declare
  me    record;
  setup live_team_setup;
  t     record;
begin
  select * into me from live_team_caller(aid);
  setup := live_setup_for_update(aid, me.tid);
  if live_team_leader(aid, me.tid) is not null then
    raise exception 'Your team already has a leader';
  end if;
  if candidate is null
     or not exists (select 1 from activity_rosters r
                     where r.activity_id = aid and r.team_id = me.tid and r.student_id = candidate)
     or live_absent(aid, candidate) then
    raise exception 'Pick someone on your team who''s here';
  end if;

  insert into live_leader_votes (activity_id, team_id, student_id, candidate_id)
  values (aid, me.tid, me.sid, candidate)
  on conflict (activity_id, student_id)
  do update set candidate_id = excluded.candidate_id, team_id = excluded.team_id, updated_at = now();

  select * into t from live_leader_tally(aid, me.tid);
  if t.agreed is not null and t.voted >= t.present then
    return live_set_leader(aid, me.tid, t.agreed);
  end if;
  return setup;
end $$;

/**
 * "Confirm <name>": settle on the one name every vote is for, without waiting
 * for the rest. By someone who has voted, once two have — or everyone, on a
 * team of one. A second confirm of the same leader is no error.
 */
create or replace function confirm_live_leader(aid uuid) returns live_team_setup
language plpgsql security definer set search_path = public as $$
declare
  me    record;
  setup live_team_setup;
  t     record;
begin
  select * into me from live_team_caller(aid);
  setup := live_setup_for_update(aid, me.tid);
  if live_team_leader(aid, me.tid) is not null then
    return setup;
  end if;
  if not exists (select 1 from live_leader_votes v
                  where v.activity_id = aid and v.student_id = me.sid and v.team_id = me.tid) then
    raise exception 'Vote first';
  end if;

  select * into t from live_leader_tally(aid, me.tid);
  if t.agreed is null then
    raise exception 'Votes are split — agree on one person';
  end if;
  if t.voted < 2 and t.voted < t.present then
    raise exception 'Wait for one more vote';
  end if;
  return live_set_leader(aid, me.tid, t.agreed);
end $$;

-- ---------------------------------------------------------------- the roll
/**
 * The leader's roll: these teammates are absent, and anyone the roll marked
 * before who isn't named is here. Taking it again for someone who turned up
 * late is the same call. Never the leader themselves — they're plainly there.
 * Never an absence staff recorded on the sheet: that stays, named or not.
 */
create or replace function set_live_absences(aid uuid, absent uuid[]) returns live_team_setup
language plpgsql security definer set search_path = public as $$
declare
  me    record;
  setup live_team_setup;
  ids   uuid[];
begin
  select * into me from live_team_caller(aid);
  setup := live_setup_for_update(aid, me.tid);
  if live_team_leader(aid, me.tid) is distinct from me.sid then
    raise exception 'Only your team''s leader takes the roll';
  end if;

  select coalesce(array_agg(distinct a), '{}') into ids from unnest(coalesce(absent, '{}')) a where a is not null;
  if me.sid = any(ids) then
    raise exception 'You''re here — you can''t mark yourself absent';
  end if;
  if exists (select 1 from unnest(ids) a
              where not exists (select 1 from activity_rosters r
                                 where r.activity_id = aid and r.team_id = me.tid and r.student_id = a)) then
    raise exception 'Only someone on your team can be marked absent';
  end if;

  -- As the owner: 0016's guard passes (everyone named is on the frozen
  -- roster, 0045), and 0045's freeze does nothing, the roster being frozen.
  -- Only the roll's own rows go; one already there, the sheet's included, is
  -- left as it is.
  delete from tutorial_absences
   where activity_id = aid and team_id = me.tid and source = 'roll'
     and student_id <> all(ids);
  insert into tutorial_absences (activity_id, team_id, student_id, source)
  select aid, me.tid, a, 'roll' from unnest(ids) a
  on conflict (activity_id, team_id, student_id) do nothing;

  update live_team_setup set roll_at = now()
   where activity_id = aid and team_id = me.tid
  returning * into setup;
  return setup;
end $$;

-- ------------------------------------------------------------- in class
/** 0049's cast_vote, and a student marked absent doesn't vote. */
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
  if live_absent(aid, sid) then
    raise exception 'You''re marked absent for this session — tell your team''s leader if you''re here';
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

/** 0049's lock_team_answer, and only the leader submits once the team has one. */
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
  if live_absent(aid, sid) then
    raise exception 'You''re marked absent for this session — tell your team''s leader if you''re here';
  end if;
  if not live_leads(aid, tid, sid) then
    raise exception 'Only your team''s leader submits';
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

/** 0050's move_team_on, and only the leader moves the team on once it has one. */
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
  if live_absent(aid, sid) then
    raise exception 'You''re marked absent for this session — tell your team''s leader if you''re here';
  end if;
  if not live_leads(aid, tid, sid) then
    raise exception 'Only your team''s leader moves the team on';
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
-- The helpers read absences and tallies on the caller's behalf and are called
-- only from inside the RPCs, as the owner — except live_explanation_visible,
-- which a policy calls as the caller, like 0047's live_key_visible.
revoke all on function
  live_absent(uuid, uuid), live_team_leader(uuid, uuid), live_leads(uuid, uuid, uuid),
  live_leader_tally(uuid, uuid),
  live_team_caller(uuid), live_setup_for_update(uuid, uuid), live_set_leader(uuid, uuid, uuid),
  live_explanation_visible(uuid),
  vote_live_leader(uuid, uuid), confirm_live_leader(uuid), set_live_absences(uuid, uuid[]),
  cast_vote(uuid, text), lock_team_answer(uuid, jsonb), move_team_on(uuid)
  from public, anon, authenticated;
grant execute on function
  live_explanation_visible(uuid),
  vote_live_leader(uuid, uuid), confirm_live_leader(uuid), set_live_absences(uuid, uuid[]),
  cast_vote(uuid, text), lock_team_answer(uuid, jsonb), move_team_on(uuid)
  to authenticated;

-- -------------------------------------------------------------- realtime
-- Leader votes and setup rows, so every phone on the team moves on together.
-- tutorial_absences is published already (0043), with the replica identity a
-- filtered delete needs. Explanations are not published, like the keys: a
-- team reloads when it locks a question anyway, and that is when one appears.
do $$ begin
  alter publication supabase_realtime add table live_leader_votes;
exception when duplicate_object then null; when undefined_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table live_team_setup;
exception when duplicate_object then null; when undefined_object then null; end $$;

alter table live_leader_votes replica identity full;
alter table live_team_setup   replica identity full;
