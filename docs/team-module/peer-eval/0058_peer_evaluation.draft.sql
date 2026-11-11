-- DRAFT — NOT A MIGRATION YET. Never run against the live project.
--
-- Peer evaluation: each student rates themselves and each teammate on a few
-- behaviours, 1–5. The instructor sees everything; a student sees only
-- averages of what was said about them, and only once released.
--
-- Kept out of supabase/migrations/ on purpose: SETUP.md says every file there
-- is run in order, and scripts/local-db.sh applies all of them. Move it in as
-- 0058 (or whatever is next) once PEER-EVAL-PLAN.md's open questions are
-- settled, and write supabase/tests/0058_peer_evaluation.sql beside it.
--
-- What this file has to guarantee, because the app hiding a button is not a
-- rule:
--   - A student writes only their own ratings, only about people on their
--     team FOR THIS ACTIVITY (its frozen roster, 0045), only while it is open.
--   - No student reads any rating row — not their teammates', not the ones
--     about themselves. What they get back is an aggregate, from a definer
--     function, after release, and only with enough raters to stay anonymous.
--   - Private comments reach staff only. Shared comments reach the student
--     they are about without the writer's name, after release.
--   - Completion is decided here, by counting rows, not by the client saying
--     it is done.
--   - Once anyone has rated, the teams, the dimensions and self-rating stay
--     put: changing any of them would quietly drop ratings out of the sums.
--
-- Decided (see PEER-EVAL-PLAN.md):
--   - Submitting does not lock. A student may change their ratings until the
--     due time (or until a reopen, 0044, runs out); CATME locks on Finish and
--     students complain about exactly that.
--   - Where "submitted" lives: the activity's individual check-in result,
--     status 'submitted', like any hand-in. Feedback counts ONLY submitted
--     raters, so a student who stopped after one screen can't make a single
--     teammate's score readable as an "average".
--
-- Still open:
--   - Deleting a student cascades their ratings away, which moves everyone
--     else's averages. Restrict instead? Check it against 0018's purge first.
--   - search_path: definer functions here use `public`, as 0045/0047 do;
--     `public, pg_temp` would close temp-table shadowing repo-wide.

-- ------------------------------------------------------------ the new type
-- Same dance as 0047: drop whichever check lists the types, add it back.
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.activities'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ~* '\mtype\M'
       and pg_get_constraintdef(oid) ilike '%''challenge''%'
       and pg_get_constraintdef(oid) ilike '%''amplify''%'
  loop
    execute format('alter table public.activities drop constraint %I', c.conname);
  end loop;
end $$;

alter table activities
  add constraint activities_type_check
  check (type in ('challenge', 'combo', 'skills', 'amplify', 'live', 'peer'));

-- ------------------------------------------------------------------ tables
-- A check constraint can't hold a subquery; a function it calls can. Immutable
-- and harmless, so callable by anyone who may write the column.
create or replace function peer_distinct(xs text[]) returns boolean
language sql immutable set search_path = public as $$
  select cardinality(xs) = (select count(distinct x) from unnest(xs) as x);
$$;

create table if not exists peer_settings (
  activity_id  uuid primary key references activities(id) on delete cascade,
  dimensions   text[] not null
               default array['contributing','interacting','on_track','quality','knowledge']
               check (cardinality(dimensions) between 1 and 5
                      and dimensions <@ array['contributing','interacting','on_track','quality','knowledge']
                      -- Each once: a repeated one would be asked, and counted, twice.
                      and peer_distinct(dimensions)),
  include_self boolean not null default true,
  comments     text not null default 'private' check (comments in ('off', 'private', 'shared')),
  -- Which team set this evaluation is about. Null: the course's current set
  -- at the moment the first rating is saved.
  team_set_id  uuid references team_sets(id) on delete set null,
  -- Fewest teammates who must have rated a student before they see a summary.
  min_raters   int not null default 2 check (min_raters >= 1),
  closed_at    timestamptz,
  released_at  timestamptz,
  updated_at   timestamptz not null default now()
);

create table if not exists peer_ratings (
  activity_id uuid not null references activities(id) on delete cascade,
  rater_id    uuid not null references students(id) on delete cascade,
  ratee_id    uuid not null references students(id) on delete cascade,
  dimension   text not null,
  score       smallint not null check (score between 1 and 5),
  updated_at  timestamptz not null default now(),
  primary key (activity_id, rater_id, ratee_id, dimension)
);
create index if not exists peer_ratings_ratee_idx on peer_ratings (activity_id, ratee_id);

create table if not exists peer_comments (
  activity_id uuid not null references activities(id) on delete cascade,
  rater_id    uuid not null references students(id) on delete cascade,
  ratee_id    uuid not null references students(id) on delete cascade,
  body        text not null check (length(body) between 1 and 2000),
  -- Staff can keep a shared comment from reaching the student (e.g. abuse).
  withheld    boolean not null default false,
  updated_at  timestamptz not null default now(),
  primary key (activity_id, rater_id, ratee_id)
);

-- Settings row exists the moment an activity becomes "peer" (as 0047's
-- ensure_live_state does for live_state).
create or replace function ensure_peer_settings() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.type = 'peer' then
    insert into peer_settings (activity_id) values (new.id) on conflict do nothing;
  end if;
  return null;
end $$;

drop trigger if exists trg_ensure_peer_settings on activities;
create trigger trg_ensure_peer_settings
  after insert or update of type on activities
  for each row execute function ensure_peer_settings();

-- --------------------------------------------------------------- helpers
-- (live_my_student / live_my_team are 0047's and already mean "the caller's
-- student row on this activity's course" and "their frozen team on it".)

/**
 * Open for this student's ratings: visible, not closed by the instructor, and
 * either before the due time or reopened for them (0044).
 */
create or replace function peer_open(aid uuid, sid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from activities a join peer_settings p on p.activity_id = a.id
     where a.id = aid
       and activity_open(a.opens_at)
       and p.closed_at is null
       and (a.due_at is null or a.due_at > now()
            or exists (select 1 from hand_in_reopens h
                        where h.activity_id = aid and h.student_id = sid)));
$$;

/** Freeze the evaluation's teams the first time anyone rates. */
create or replace function peer_freeze(aid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare set_id uuid;
begin
  if exists (select 1 from activity_rosters where activity_id = aid) then return; end if;
  select coalesce(p.team_set_id, c.current_team_set_id) into set_id
    from peer_settings p
    join activities a on a.id = p.activity_id
    join courses c on c.id = a.course_id
   where p.activity_id = aid;
  if set_id is null then
    raise exception 'This class has no teams yet';
  end if;
  insert into activity_rosters (activity_id, team_id, student_id)
  select aid, tm.team_id, tm.student_id
    from teams t join team_members tm on tm.team_id = t.id
   where t.team_set_id = set_id
  on conflict (activity_id, student_id) do nothing;
end $$;

-- Once rated, the teams stay. 0045's refreeze deletes and re-inserts the
-- roster; after a rating that would leave scores about people who are no
-- longer anyone's teammate here, and they would drop out of every sum unseen.
create or replace function guard_peer_roster() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- A cascade is not a re-freeze: deleting the activity, a student or a team
  -- removes its roster rows after the parent row is gone, and must still work.
  if exists (select 1 from activities where id = old.activity_id)
     and exists (select 1 from students where id = old.student_id)
     and exists (select 1 from teams where id = old.team_id)
     and exists (select 1 from peer_ratings where activity_id = old.activity_id) then
    raise exception 'Students have already rated their teams on this evaluation';
  end if;
  return old;
end $$;

drop trigger if exists trg_guard_peer_roster on activity_rosters;
create trigger trg_guard_peer_roster
  before delete on activity_rosters
  for each row execute function guard_peer_roster();

-- And the questions stay: which dimensions, and whether self counts.
create or replace function guard_peer_settings() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.dimensions is distinct from old.dimensions
      or new.include_self is distinct from old.include_self
      or new.team_set_id is distinct from old.team_set_id)
     and exists (select 1 from peer_ratings where activity_id = new.activity_id) then
    raise exception 'Students have already started rating — duplicate it to ask something different';
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_peer_settings on peer_settings;
create trigger trg_guard_peer_settings
  before update on peer_settings
  for each row execute function guard_peer_settings();

-- ------------------------------------------------------------------- RLS
alter table peer_settings enable row level security;
alter table peer_ratings  enable row level security;
alter table peer_comments enable row level security;

-- Supabase's default privileges grant every table to anon and authenticated;
-- a policy limits rows, not columns. Take it all back, then give back exactly
-- the columns a client may touch (0047 does the same).
revoke all on peer_settings, peer_ratings, peer_comments from anon, authenticated;
grant select on peer_settings, peer_ratings, peer_comments to authenticated;
-- Settings the owner edits directly. closed_at / released_at are NOT here:
-- close_peer and release_peer write them, along with the marks and the
-- TF-vs-owner review rule that has to go with them.
grant update (comments, dimensions, include_self, min_raters, team_set_id) on peer_settings to authenticated;
-- Staff may hide a comment, not rewrite it or who wrote it.
grant update (withheld) on peer_comments to authenticated;
-- No insert/update on peer_ratings at all: save_peer_ratings is the only way in.

-- Settings: anyone on the course reads (the form needs the dimensions);
-- the owner writes.
create policy "read peer_settings" on peer_settings for select
  using (staff_of_activity(activity_id) or live_student_reads(activity_id));
create policy "owner sets peer_settings" on peer_settings for update
  using (owns_activity(activity_id)) with check (owns_activity(activity_id));

-- Ratings and comments: staff read all; a student reads back only what THEY
-- wrote (so the form can reload). No insert/update policy for students —
-- writes go through save_peer_ratings / save_peer_comment below.
create policy "read peer_ratings" on peer_ratings for select
  using (staff_of_activity(activity_id) or rater_id = live_my_student(activity_id));
create policy "read peer_comments" on peer_comments for select
  using (staff_of_activity(activity_id) or rater_id = live_my_student(activity_id));
create policy "staff withholds a comment" on peer_comments for update
  using (staff_of_activity(activity_id)) with check (staff_of_activity(activity_id));

-- ------------------------------------------------------------------- RPCs

/**
 * One dimension's scores from the caller, for their whole team at once —
 * one call per screen of the form. scores: {"<student id>": 1..5, ...}.
 */
create or replace function save_peer_ratings(aid uuid, dim text, scores jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  me   uuid := live_my_student(aid);
  team uuid;
  st   peer_settings;
  k    text;
begin
  if me is null then raise exception 'You are not on this course'; end if;
  if not peer_open(aid, me) then raise exception 'This evaluation is closed'; end if;
  select * into st from peer_settings where activity_id = aid;
  if not (dim = any(st.dimensions)) then raise exception 'Not a question on this evaluation'; end if;
  if jsonb_typeof(scores) <> 'object' or scores = '{}'::jsonb then
    raise exception 'No scores to save';
  end if;

  perform peer_freeze(aid);
  team := live_my_team(aid);
  if team is null then raise exception 'You were not on a team for this evaluation'; end if;

  for k in select jsonb_object_keys(scores) loop
    if k !~ '^[0-9a-f-]{36}$' then raise exception 'Not a student'; end if;
    if jsonb_typeof(scores -> k) <> 'number'
       or (scores ->> k)::numeric not in (1, 2, 3, 4, 5) then
      raise exception 'Scores are 1 to 5';
    end if;
    if k::uuid = me and not st.include_self then
      raise exception 'This evaluation does not ask you to rate yourself';
    end if;
    if not exists (select 1 from activity_rosters r
                    where r.activity_id = aid and r.student_id = k::uuid and r.team_id = team) then
      raise exception 'You can only rate people on your team';
    end if;
    insert into peer_ratings (activity_id, rater_id, ratee_id, dimension, score)
    values (aid, me, k::uuid, dim, (scores ->> k)::smallint)
    on conflict (activity_id, rater_id, ratee_id, dimension)
    do update set score = excluded.score, updated_at = now();
  end loop;
end $$;

-- save_peer_comment(aid, ratee, body): same checks; refuses when comments = 'off'.

/**
 * Hand it in. Complete only when every teammate (and self, when asked) has a
 * score on every dimension — counted here. Writes the student's individual
 * check-in result as submitted, the way any hand-in is.
 */
-- submit_peer(aid uuid) returns check_in_results

/**
 * Close: no more ratings. Every student gets their completion mark on the
 * individual check-in — Complete if they submitted, Not complete if not —
 * released if the instructor did it, sent for review if a TF did (0038),
 * the same rule score_live follows.
 */
-- close_peer(aid uuid) returns peer_settings

/** Students see their summaries from now on. Owner only. */
-- release_peer(aid uuid) returns peer_settings

/**
 * The caller's own summary: per dimension, teammates' mean, their own score
 * and the team's mean — nothing per rater. Empty until released, and empty
 * when fewer than min_raters teammates rated them (src/peer/model.ts
 * feedbackFor does the same sum; tests there pin the arithmetic).
 */
-- peer_my_feedback(aid uuid) returns table (dimension text, from_peers numeric, self numeric, team numeric)

/** Shared comments about the caller, without who wrote them, once released. */
-- peer_my_comments(aid uuid) returns setof text

-- ------------------------------------------------------------- privileges
-- Supabase grants EXECUTE on every new function to anon and authenticated BY
-- NAME, so revoking from PUBLIC alone takes nothing away (0047 explains). All
-- of it from all three, then back to signed-in users only where needed.
-- peer_freeze is only ever called from inside save_peer_ratings: a client that
-- could call it would freeze the teams at a moment of its choosing.
revoke all on function
  peer_open(uuid, uuid), peer_freeze(uuid), ensure_peer_settings(),
  guard_peer_roster(), guard_peer_settings(), save_peer_ratings(uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function save_peer_ratings(uuid, text, jsonb) to authenticated;
-- (and save_peer_comment, submit_peer, close_peer, release_peer,
-- peer_my_feedback, peer_my_comments once written)
