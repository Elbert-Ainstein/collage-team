-- Live questions: answer alone before class, then agree as a team in class.
--
-- Run in Supabase → SQL Editor, after 0046. Safe to re-run.
--
-- A new kind of activity, modelled on a readiness assurance. Students answer a
-- short set of questions on their own before class. In class, someone who
-- runs check-ins presses Start team mode: every team now sees how each of its
-- members answered and agrees on one answer per question, live. Closing ends
-- it, and scoring writes each student's own score and each team's score into
-- check_in_results like any other activity — released if the instructor did
-- it, sent for review if a TF did (0038).
--
-- What this file has to guarantee, because the app hiding a button is not a
-- rule:
--   - Nobody reads anyone else's answers before team mode, and a student only
--     ever reads their own team's.
--   - No student reads the answer key before the session closes — or, when the
--     activity shows answers as each team locks, before THEIR team locked that
--     question. The keys live in their own table for exactly this reason, and
--     that table is never published to realtime.
--   - Answers can only change while that half is running: own answers while
--     the activity is open and still individual, team votes only in team mode,
--     and a locked team answer never moves.
--   - The phase moves only through the RPCs below, which check who is asking.
--   - Live scores are computed here, not by recompute_result_score: that
--     function scores rubric deductions against points_total, and a live
--     result has no deductions — a points edit after scoring would otherwise
--     hand everyone full marks.
--
-- Teams: an activity keeps the teams it was run with (0045). Starting team mode
-- freezes the course's current team set onto this activity if nothing has
-- frozen it already, and nothing may re-freeze it while the session runs —
-- votes would be orphaned on teams that no longer hold their voters.

-- ---------------------------------------------------------------- prereqs
do $$
declare missing text;
begin
  select string_agg(want.fn, ', ' order by want.fn)
    into missing
    from (values
      ('owns_activity(uuid)'),
      ('staff_of_activity(uuid)'),
      ('activity_course(uuid)'),
      ('activity_open(timestamp with time zone)'),
      ('can_run_checkins_course(uuid)'),
      ('can_grade_course(uuid)'),
      ('my_course_ids()'),
      ('recompute_result_score(uuid)')
    ) as want(fn)
   where to_regprocedure('public.' || want.fn) is null;

  if missing is not null then
    raise exception
      'Missing helper functions (%) -- run 0007, 0010, 0011, 0016, 0044 and 0045 before this file.',
      missing;
  end if;
end $$;

-- ------------------------------------------------------------ the new type
-- 0006 wrote the type check inline, so Postgres named it. Find whichever check
-- on activities lists the types and replace it — by what it says, not by a
-- name a different database might not share. Re-running drops the one this
-- file added and adds it back.
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.activities'::regclass
       and contype = 'c'
       -- The check on `type` that lists the types: nothing else on activities.
       and pg_get_constraintdef(oid) ~* '\mtype\M'
       and pg_get_constraintdef(oid) ilike '%''challenge''%'
       and pg_get_constraintdef(oid) ilike '%''amplify''%'
  loop
    execute format('alter table public.activities drop constraint %I', c.conname);
  end loop;
end $$;

alter table activities
  add constraint activities_type_check
  check (type in ('challenge', 'combo', 'skills', 'amplify', 'live'));

-- ------------------------------------------------------------------ tables
create table if not exists live_state (
  activity_id     uuid primary key references activities(id) on delete cascade,
  phase           text not null default 'individual'
                  check (phase in ('individual', 'team', 'closed')),
  -- 'any': one member's submit is the team's answer. 'all': it locks once every
  -- member who is there has voted for the same answer.
  lock_rule       text not null default 'any' check (lock_rule in ('any', 'all')),
  -- 'close': the key reaches students when the session closes. 'lock': a team
  -- sees a question's key as soon as it locks it.
  show_answers    text not null default 'close' check (show_answers in ('close', 'lock')),
  -- 'both': a point for your own answer and a point for your team's. 'team':
  -- own answers count for completion only.
  grading         text not null default 'both' check (grading in ('both', 'team')),
  team_started_at timestamptz,
  closed_at       timestamptz,
  scored_at       timestamptz,
  updated_at      timestamptz not null default now()
);

create table if not exists live_questions (
  id          uuid primary key default gen_random_uuid(),
  activity_id uuid not null references activities(id) on delete cascade,
  position    int  not null default 0,
  kind        text not null check (kind in ('mc', 'number', 'expression')),
  stem        text not null default '' check (length(stem) <= 4000),
  -- Multiple choice only: the option texts, A first. Stored without the key.
  options     jsonb not null default '[]'::jsonb
              check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) <= 8),
  -- Number only: shown beside the box ("m/s"). Not secret.
  unit        text check (unit is null or length(unit) <= 40),
  -- An object in activity-files under <activity_id>/, never a URL.
  figure_path text,
  created_at  timestamptz not null default now(),
  -- So responses, votes and locks can name the activity a question belongs to
  -- and have the database hold them to it (see their foreign keys).
  unique (id, activity_id)
);
create index if not exists live_questions_activity_idx on live_questions (activity_id, position);

-- The answer key, apart from the question so a student can read one and not
-- the other.
create table if not exists live_keys (
  question_id    uuid primary key,
  activity_id    uuid not null,
  correct_option int  check (correct_option is null or correct_option between 0 and 7),
  answer         numeric,
  tolerance      numeric check (tolerance is null or tolerance >= 0),
  -- Expression only: every accepted form, as written ("F/2").
  accept         jsonb not null default '[]'::jsonb check (jsonb_typeof(accept) = 'array'),
  foreign key (question_id, activity_id)
    references live_questions (id, activity_id) on delete cascade
);

-- Each student's own answer, before class. Answers are stored as text in one
-- canonical form the app writes: an option letter ("B"), a number as the app
-- normalises it ("0.3"), or an expression as typed.
create table if not exists live_responses (
  question_id uuid not null,
  activity_id uuid not null,
  student_id  uuid not null references students(id) on delete cascade,
  answer      text not null check (length(answer) between 1 and 200),
  -- Set by score_live only.
  correct     boolean,
  updated_at  timestamptz not null default now(),
  primary key (question_id, student_id),
  foreign key (question_id, activity_id)
    references live_questions (id, activity_id) on delete cascade
);
create index if not exists live_responses_activity_idx on live_responses (activity_id);

-- Where each member's vote sits right now, in team mode.
create table if not exists live_votes (
  question_id uuid not null,
  activity_id uuid not null,
  team_id     uuid not null references teams(id) on delete cascade,
  student_id  uuid not null references students(id) on delete cascade,
  answer      text not null check (length(answer) between 1 and 200),
  updated_at  timestamptz not null default now(),
  primary key (question_id, student_id),
  foreign key (question_id, activity_id)
    references live_questions (id, activity_id) on delete cascade
);
create index if not exists live_votes_activity_idx on live_votes (activity_id, team_id);

-- The team's answer. One per team per question, and final.
create table if not exists live_locks (
  question_id uuid not null,
  activity_id uuid not null,
  team_id     uuid not null references teams(id) on delete cascade,
  answer      text not null check (length(answer) between 1 and 200),
  -- Set by score_live only.
  correct     boolean,
  locked_by   uuid references students(id) on delete set null,
  locked_at   timestamptz not null default now(),
  primary key (question_id, team_id),
  foreign key (question_id, activity_id)
    references live_questions (id, activity_id) on delete cascade
);
create index if not exists live_locks_activity_idx on live_locks (activity_id, team_id);

-- --------------------------------------------------------------- helpers
-- All definer, all with a fixed search_path: 0044 is the story of an invoker
-- read through students inside a policy that looped until it was cancelled.

/** The caller's student row on this activity's course, if they have one. */
create or replace function live_my_student(aid uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select s.id
    from students s
    join activities a on a.course_id = s.course_id
   where a.id = aid and s.user_id = auth.uid()
   limit 1;
$$;

/** The team the caller is on for this activity, from its frozen roster. */
create or replace function live_my_team(aid uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select r.team_id from activity_rosters r
   where r.activity_id = aid and r.student_id = live_my_student(aid);
$$;

/** May the caller read this activity as a student: enrolled, and it is open. */
create or replace function live_student_reads(aid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from activities a
     where a.id = aid
       and a.course_id in (select my_course_ids())
       and activity_open(a.opens_at));
$$;

create or replace function live_phase(aid uuid) returns text
language sql stable security definer set search_path = public as $$
  select phase from live_state where activity_id = aid;
$$;

/** Was this student on the caller's team for this activity? */
create or replace function live_teammate(aid uuid, sid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from activity_rosters theirs
     where theirs.activity_id = aid
       and theirs.student_id = sid
       and theirs.team_id = live_my_team(aid));
$$;

/**
 * May the caller see this question's key?
 *
 * Staff always. A student who can read the activity once the session has
 * closed, or — when it shows answers as teams lock — once their own team has
 * locked this question.
 */
create or replace function live_key_visible(qid uuid) returns boolean
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
                  or (st.show_answers = 'lock'
                      and exists (select 1 from live_locks l
                                   where l.question_id = qid
                                     and l.team_id = live_my_team(q.activity_id)))))
       ));
$$;

grant execute on function
  live_my_student(uuid), live_my_team(uuid), live_student_reads(uuid),
  live_phase(uuid), live_teammate(uuid, uuid), live_key_visible(uuid)
  to authenticated;

-- ------------------------------------------- a live activity has a state row
create or replace function ensure_live_state() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.type = 'live' then
    insert into live_state (activity_id) values (new.id) on conflict do nothing;
  end if;
  return null;
end $$;

drop trigger if exists trg_ensure_live_state on activities;
create trigger trg_ensure_live_state
  after insert or update of type on activities
  for each row execute function ensure_live_state();

-- Any live activity made before this trigger existed.
insert into live_state (activity_id)
select id from activities where type = 'live'
on conflict do nothing;

-- Turning a live activity into something else would strand its answers.
create or replace function guard_live_type() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.type = 'live' and new.type is distinct from 'live'
     and exists (select 1 from live_responses r where r.activity_id = old.id) then
    raise exception 'Students have answered this one, so it has to stay live questions';
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_live_type on activities;
create trigger trg_guard_live_type
  before update of type on activities
  for each row execute function guard_live_type();

-- ------------------------------------------------------- settings and phase
-- Settings change only before class. The phase and its timestamps are not
-- even grantable (see the grants below); this catches the settings.
create or replace function guard_live_state() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_setting('live.phase_change', true) = 'on' then
    new.updated_at := now();
    return new;
  end if;
  if old.phase <> 'individual'
     and (new.lock_rule is distinct from old.lock_rule
          or new.show_answers is distinct from old.show_answers
          or new.grading is distinct from old.grading) then
    raise exception 'These settings are fixed once team mode has started';
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_guard_live_state on live_state;
create trigger trg_guard_live_state
  before update on live_state
  for each row execute function guard_live_state();

-- Questions take their shape before class. Their wording and figure may still
-- be fixed later; what students answered against may not change under them.
create or replace function guard_live_question() returns trigger
language plpgsql security definer set search_path = public as $$
declare aid uuid := coalesce(new.activity_id, old.activity_id);
begin
  -- Deleting the activity (or the course) takes its questions with it: that's
  -- a cascade, one trigger deep, and not the instructor editing questions.
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  if coalesce(live_phase(aid), 'individual') = 'individual' then
    return coalesce(new, old);
  end if;
  if tg_op = 'UPDATE'
     and new.kind = old.kind
     and new.options = old.options
     and new.position = old.position
     and new.activity_id = old.activity_id then
    return new;
  end if;
  raise exception 'Questions can''t be added, removed or changed once team mode has started';
end $$;

drop trigger if exists trg_guard_live_question on live_questions;
create trigger trg_guard_live_question
  before insert or update or delete on live_questions
  for each row execute function guard_live_question();

-- Own answers: only while the activity is still individual. FOR SHARE on the
-- state row so an autosave racing Start team mode lands before it or not at
-- all — never after the team has seen the answers.
-- What an answer to this question may look like: a letter it has, a plain
-- number (exponent at most three digits, so it always fits numeric), or a
-- short expression. The client writes answers this way already; this is what
-- stops a hand-made request from voting "ZZ" or locking "1e999999".
create or replace function live_answer_fits(qid uuid, ans text) returns boolean
language sql stable security definer set search_path = public as $$
  select case q.kind
    when 'mc' then ans ~ '^[A-H]$' and ascii(ans) - 65 < jsonb_array_length(q.options)
    when 'number' then ans ~ '^[-+]?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][-+]?[0-9]{1,3})?$'
    else length(btrim(ans)) between 1 and 120
  end
  from live_questions q where q.id = qid;
$$;

create or replace function guard_live_response() returns trigger
language plpgsql security definer set search_path = public as $$
declare ph text;
begin
  -- score_live marking answers right or wrong; nothing a student can set.
  if current_setting('live.scoring', true) = 'on' then
    return new;
  end if;
  select phase into ph from live_state where activity_id = new.activity_id for share;
  if ph is distinct from 'individual' then
    raise exception 'Team mode has started, so answers on your own are closed';
  end if;
  if not coalesce(live_answer_fits(new.question_id, new.answer), false) then
    raise exception 'That answer can''t be used';
  end if;
  new.updated_at := now();
  if tg_op = 'UPDATE' then
    new.correct := old.correct;
  else
    new.correct := null;
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_live_response on live_responses;
create trigger trg_guard_live_response
  before insert or update on live_responses
  for each row execute function guard_live_response();

-- A live activity's teams stay put while it runs (refreeze_activity_roster
-- deletes and re-inserts; votes would be left on teams nobody is on).
create or replace function guard_live_roster() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- Deleting a student, a team, the activity or the course removes their
  -- roster rows by cascade (one trigger deep). Those must still work; what's
  -- refused is re-freezing the teams (refreeze_activity_roster, a direct delete).
  if pg_trigger_depth() > 1 then
    return old;
  end if;
  if coalesce(live_phase(old.activity_id), 'individual') <> 'individual' then
    raise exception 'Team mode has started on this activity, so its teams can''t change now — add a late student instead';
  end if;
  return old;
end $$;

drop trigger if exists trg_guard_live_roster on activity_rosters;
create trigger trg_guard_live_roster
  before delete on activity_rosters
  for each row execute function guard_live_roster();

-- ------------------------------------------------- live scores stay put
-- recompute_result_score as 0014 left it, plus one early return: a live
-- activity's results are written by score_live from the answers, and there are
-- no rubric deductions to subtract.
create or replace function recompute_result_score(rid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  total numeric;
  taken numeric;
begin
  if exists (
    select 1 from check_in_results r
      join check_ins ci on ci.id = r.check_in_id
      join activities a on a.id = ci.activity_id
     where r.id = rid and a.type = 'live')
  then
    return;
  end if;

  select a.points_total
    into total
    from check_in_results r
    join check_ins ci on ci.id = r.check_in_id
    join activities a on a.id = ci.activity_id
   where r.id = rid;

  if total is null then
    return;
  end if;

  select coalesce(sum(ri.deduction), 0)
    into taken
    from submission_marks m
    join rubric_items ri on ri.id = m.rubric_item_id
   where m.result_id = rid;

  update check_in_results
     set score = greatest(total - taken, 0),
         updated_at = now()
   where id = rid;
end $$;

-- ------------------------------------------------------------------- RLS
alter table live_state     enable row level security;
alter table live_questions enable row level security;
alter table live_keys      enable row level security;
alter table live_responses enable row level security;
alter table live_votes     enable row level security;
alter table live_locks     enable row level security;

-- Supabase's default privileges grant every table to anon and authenticated.
-- Column grants only mean something once that is taken back.
revoke all on live_state, live_questions, live_keys, live_responses, live_votes, live_locks
  from anon, authenticated;

grant select on live_state, live_questions, live_keys, live_responses, live_votes, live_locks
  to authenticated;
grant update (lock_rule, show_answers, grading) on live_state to authenticated;
grant insert, update, delete on live_questions, live_keys to authenticated;
grant insert (question_id, activity_id, student_id, answer) on live_responses to authenticated;
grant update (answer) on live_responses to authenticated;
-- live_votes and live_locks: no writes at all from a client; cast_vote and
-- lock_team_answer below are the only way in.

-- state
drop policy if exists "read live_state" on live_state;
create policy "read live_state" on live_state
  for select to authenticated
  using (staff_of_activity(activity_id) or live_student_reads(activity_id));

drop policy if exists "owner sets live_state" on live_state;
create policy "owner sets live_state" on live_state
  for update to authenticated
  using (owns_activity(activity_id))
  with check (owns_activity(activity_id));

-- questions
drop policy if exists "read live_questions" on live_questions;
create policy "read live_questions" on live_questions
  for select to authenticated
  using (staff_of_activity(activity_id) or live_student_reads(activity_id));

drop policy if exists "owner writes live_questions" on live_questions;
create policy "owner writes live_questions" on live_questions
  for all to authenticated
  using (owns_activity(activity_id))
  with check (owns_activity(activity_id));

-- keys
drop policy if exists "read live_keys" on live_keys;
create policy "read live_keys" on live_keys
  for select to authenticated
  using (live_key_visible(question_id));

drop policy if exists "owner writes live_keys" on live_keys;
create policy "owner writes live_keys" on live_keys
  for all to authenticated
  using (owns_activity(activity_id))
  with check (owns_activity(activity_id));

-- own answers
drop policy if exists "read live_responses" on live_responses;
create policy "read live_responses" on live_responses
  for select to authenticated
  using (
    staff_of_activity(activity_id)
    or student_id = live_my_student(activity_id)
    or (coalesce(live_phase(activity_id), 'individual') <> 'individual'
        and live_teammate(activity_id, student_id))
  );

drop policy if exists "student answers" on live_responses;
create policy "student answers" on live_responses
  for insert to authenticated
  with check (
    student_id = live_my_student(activity_id)
    and live_student_reads(activity_id)
  );

drop policy if exists "student changes answer" on live_responses;
create policy "student changes answer" on live_responses
  for update to authenticated
  using (student_id = live_my_student(activity_id) and live_student_reads(activity_id))
  with check (student_id = live_my_student(activity_id) and live_student_reads(activity_id));

-- votes and locks: read by the team and by staff
drop policy if exists "read live_votes" on live_votes;
create policy "read live_votes" on live_votes
  for select to authenticated
  using (staff_of_activity(activity_id) or team_id = live_my_team(activity_id));

drop policy if exists "read live_locks" on live_locks;
create policy "read live_locks" on live_locks
  for select to authenticated
  using (staff_of_activity(activity_id) or team_id = live_my_team(activity_id));

-- ------------------------------------------------------------- in class
/**
 * Start team mode. Freezes the course's current teams onto the activity if
 * nothing has frozen it yet; the state row is locked FOR UPDATE so an own
 * answer still being saved lands before this, not after.
 */
create or replace function start_live_team(aid uuid) returns live_state
language plpgsql security definer set search_path = public as $$
declare
  st live_state;
  set_id uuid;
begin
  if not can_run_checkins_course(activity_course(aid)) then
    raise exception 'Only the instructor, or a TF who runs check-ins, can start team mode';
  end if;
  select * into st from live_state where activity_id = aid for update;
  if st is null then
    raise exception 'That isn''t a live questions activity';
  end if;
  if st.phase <> 'individual' then
    raise exception 'Team mode has already started';
  end if;

  if not exists (select 1 from activity_rosters where activity_id = aid) then
    select c.current_team_set_id into set_id
      from courses c where c.id = activity_course(aid);
    if set_id is null then
      raise exception 'Form teams on the Teams page first';
    end if;
    insert into activity_rosters (activity_id, team_id, student_id)
    select aid, tm.team_id, tm.student_id
      from teams t
      join team_members tm on tm.team_id = t.id
     where t.team_set_id = set_id
    on conflict (activity_id, student_id) do nothing;
  end if;

  perform set_config('live.phase_change', 'on', true);
  update live_state
     set phase = 'team', team_started_at = now()
   where activity_id = aid
  returning * into st;
  perform set_config('live.phase_change', 'off', true);
  return st;
end $$;

create or replace function close_live(aid uuid) returns live_state
language plpgsql security definer set search_path = public as $$
declare st live_state;
begin
  if not can_run_checkins_course(activity_course(aid)) then
    raise exception 'Only the instructor, or a TF who runs check-ins, can close this';
  end if;
  select * into st from live_state where activity_id = aid for update;
  if st is null or st.phase <> 'team' then
    raise exception 'Team mode isn''t running';
  end if;
  perform set_config('live.phase_change', 'on', true);
  update live_state
     set phase = 'closed', closed_at = now()
   where activity_id = aid
  returning * into st;
  perform set_config('live.phase_change', 'off', true);
  return st;
end $$;

/** A student who wasn't on a team when it was frozen — a late add, a new enrolment. */
create or replace function add_live_member(aid uuid, sid uuid, tid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not can_run_checkins_course(activity_course(aid)) then
    raise exception 'Only the instructor, or a TF who runs check-ins, can add someone to a team';
  end if;
  if exists (select 1 from activity_rosters where activity_id = aid and student_id = sid) then
    raise exception 'They''re already on a team for this activity';
  end if;
  insert into activity_rosters (activity_id, team_id, student_id) values (aid, tid, sid);
end $$;

/** Put the caller's vote on an answer. Their team comes from the roster, never the client. */
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

  insert into live_votes (question_id, activity_id, team_id, student_id, answer)
  values (qid, aid, tid, sid, btrim(ans))
  on conflict (question_id, student_id)
  do update set answer = excluded.answer, team_id = excluded.team_id, updated_at = now();
end $$;

/**
 * Make the caller's current vote the team's answer.
 *
 * 'any': anyone on the team may. 'all': every member on the team must be on
 * the same answer, except those marked absent on the sheet — which is how the
 * instructor lets a team go on without someone who isn't there. (Not "has
 * voted yet": at the start of a session that is nobody, and one student could
 * lock for everyone.)
 */
create or replace function lock_team_answer(qid uuid) returns live_locks
language plpgsql security definer set search_path = public as $$
declare
  aid   uuid;
  st    live_state;
  sid   uuid;
  tid   uuid;
  ans   text;
  n     int;
  agree int;
  res   live_locks;
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

  select answer into ans from live_votes where question_id = qid and student_id = sid;
  if ans is null then
    raise exception 'Pick an answer first';
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

  insert into live_locks (question_id, activity_id, team_id, answer, locked_by)
  values (qid, aid, tid, ans, sid)
  on conflict do nothing
  returning * into res;
  if res is null then
    raise exception 'Your team has already locked this one';
  end if;
  return res;
end $$;

-- ------------------------------------------------------------------ score
/**
 * Score a closed session into the gradebook.
 *
 * Multiple choice and number answers are checked here. Expression answers need
 * algebra the database doesn't do, so the staff client works them out and
 * passes `verdicts` — {"<question id>": {"<answer>": true|false}} — which are
 * accepted for expression questions only; an answer missing from them counts
 * if it matches an accepted form exactly.
 *
 * Writes one result per student on the course (their own score) and one per
 * frozen team (the team's score). Released if the instructor runs it, sent for
 * review if a TF does (0038) — and a TF re-scoring never touches what is
 * already released. Excused is never overwritten. Safe to run again after a
 * key is corrected.
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

  -- Team scores, for every team the activity was run with. A question the team
  -- never locked counts as wrong.
  insert into check_in_results (check_in_id, subject_type, team_id, status, score, is_ci, ci_met)
  select team_id_, 'team', t.team_id, new_status,
         (select count(*) from live_locks l
           where l.activity_id = aid and l.team_id = t.team_id and l.correct),
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

/** Is this answer right for this question? See score_live for `verdicts`. */
create or replace function live_answer_correct(qid uuid, ans text, verdicts jsonb) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  q live_questions;
  k live_keys;
  v text;
begin
  select * into q from live_questions where id = qid;
  select * into k from live_keys where question_id = qid;
  if q is null or k is null or ans is null then
    return false;
  end if;

  if q.kind = 'mc' then
    return k.correct_option is not null
       and upper(btrim(ans)) = chr(65 + k.correct_option);
  end if;

  if q.kind = 'number' then
    -- Exponent bounded so the cast can't overflow; and anything that still
    -- fails to cast is wrong, never an error that stops the whole scoring.
    if k.answer is null or btrim(ans) !~ '^[-+]?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][-+]?[0-9]{1,3})?$' then
      return false;
    end if;
    begin
      return abs(btrim(ans)::numeric - k.answer) <= coalesce(k.tolerance, 0);
    exception when others then
      return false;
    end;
  end if;

  -- expression
  v := verdicts -> (qid::text) ->> ans;
  if v in ('true', 'false') then
    return v::boolean;
  end if;
  return exists (
    select 1 from jsonb_array_elements_text(k.accept) a
     where replace(lower(a), ' ', '') = replace(lower(ans), ' ', ''));
end $$;

-- Who may call what. Supabase grants EXECUTE on every new function to anon
-- and authenticated BY NAME (default privileges), so revoking from PUBLIC
-- alone takes nothing away. Everything is revoked from all three, then given
-- back to signed-in users only where it's needed:
--   - the RPCs, which check who's calling themselves;
--   - the helpers RLS policies call, which run as the caller.
-- live_answer_correct and live_answer_fits read the key; they are called only
-- from inside score_live, cast_vote and the guards (definer, as the owner), and
-- callable by nobody else — otherwise "is B right?" is a question anyone could
-- ask. Trigger functions are never called directly.
revoke all on function
  live_my_student(uuid), live_my_team(uuid), live_student_reads(uuid), live_phase(uuid),
  live_teammate(uuid, uuid), live_key_visible(uuid), live_answer_fits(uuid, text),
  ensure_live_state(), guard_live_type(), guard_live_state(), guard_live_question(),
  guard_live_response(), guard_live_roster(),
  start_live_team(uuid), close_live(uuid), add_live_member(uuid, uuid, uuid),
  cast_vote(uuid, text), lock_team_answer(uuid), score_live(uuid, jsonb),
  live_answer_correct(uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function
  live_my_student(uuid), live_my_team(uuid), live_student_reads(uuid), live_phase(uuid),
  live_teammate(uuid, uuid), live_key_visible(uuid),
  start_live_team(uuid), close_live(uuid), add_live_member(uuid, uuid, uuid),
  cast_vote(uuid, text), lock_team_answer(uuid), score_live(uuid, jsonb)
  to authenticated;

-- -------------------------------------------------------------- realtime
-- State (so every phone knows team mode started), votes and locks. Never the
-- keys, and never own answers before class — the instructor's progress view
-- polls instead. Votes and locks are never deleted, so the default replica
-- identity carries everything an update needs; set to full anyway, like 0043.
do $$ begin
  alter publication supabase_realtime add table live_state;
exception when duplicate_object then null; when undefined_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table live_votes;
exception when duplicate_object then null; when undefined_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table live_locks;
exception when duplicate_object then null; when undefined_object then null; end $$;

alter table live_state replica identity full;
alter table live_votes replica identity full;
alter table live_locks replica identity full;

-- -------------------------------------------------------- the import bucket
-- A PDF the instructor imports from. Its own bucket, owner only, because the
-- activity-files bucket is readable by every student once the activity opens
-- (0012) — and a question PDF may well carry its answer key. Path:
-- <course_id>/<activity_id>/<file>.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('imports', 'imports', false, 20971520, array['application/pdf'])
on conflict (id) do nothing;

update storage.buckets
   set public = false, file_size_limit = 20971520, allowed_mime_types = array['application/pdf']
 where id = 'imports';

create or replace function owns_import_path(path text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from courses c
     where c.id::text = split_part(path, '/', 1)
       and c.owner_id = auth.uid());
$$;
revoke all on function owns_import_path(text) from public, anon, authenticated;
grant execute on function owns_import_path(text) to authenticated;

drop policy if exists "owner reads imports" on storage.objects;
create policy "owner reads imports" on storage.objects
  for select to authenticated
  using (bucket_id = 'imports' and owns_import_path(name));

drop policy if exists "owner writes imports" on storage.objects;
create policy "owner writes imports" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'imports' and owns_import_path(name));

drop policy if exists "owner deletes imports" on storage.objects;
create policy "owner deletes imports" on storage.objects
  for delete to authenticated
  using (bucket_id = 'imports' and owns_import_path(name));
