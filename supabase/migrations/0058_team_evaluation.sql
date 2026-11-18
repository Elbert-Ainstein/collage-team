-- Team evaluation: students rate themselves and each teammate, CATME style.
--
-- Run in Supabase → SQL Editor, after 0057. Safe to re-run.
--
-- A new kind of activity. The instructor writes rating categories ("Communi-
-- cation"), each a 1–5 scale with a sentence saying what each point looks
-- like, and open-ended questions — some asked about each teammate, some asked
-- of the student about themselves (a personal reflection). Each student then
-- fills in one page per person on their team, themselves included, and
-- submits. The instructor sees every rating and comment; a student, once the
-- results are released, sees what they gave themselves beside the AVERAGE of
-- what their teammates gave them, and — when the instructor chose to release
-- them — what their teammates wrote, without names unless the instructor
-- chose otherwise.
--
-- What this file has to guarantee, because the app hiding a button is not a
-- rule:
--   - A student never reads another student's ratings or comments directly:
--     not the ones about them, not the ones about anyone else. What reaches
--     them about themselves comes out of team_eval_results(), which hands
--     back averages and — only if released — comments, with the author's
--     name removed when the evaluation is anonymous.
--   - Anonymous stays anonymous: once anyone has submitted, the switch can't
--     be turned off. They wrote expecting it.
--   - Only submitted evaluations count. A teammate who never submitted, or
--     only saved a draft, is left out of everyone's averages — not counted
--     as a zero. A student's own ratings of themselves never count toward
--     their average.
--   - A student rates only the people on their team for this activity, and
--     writes only through save_team_eval, which checks every row.
--   - A submitted evaluation can still be changed until the due date, and not
--     after it or once results are out. One that was never submitted can be
--     submitted late, and is flagged late.
--   - The gradebook score is written by score_team_eval, not by
--     recompute_result_score: points for submitting, less the late penalty
--     for a late one, and nothing for none.
--
-- Teams: an evaluation keeps the teams it was run with (0045). The first save
-- freezes the course's current team set onto the activity if nothing has
-- frozen it already.

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
      ('can_grade_course(uuid)'),
      ('can_release_check_in(uuid)'),
      ('my_course_ids()'),
      ('recompute_result_score(uuid)')
    ) as want(fn)
   where to_regprocedure('public.' || want.fn) is null;

  if missing is not null then
    raise exception
      'Missing helper functions (%) -- run every migration through 0057 before this file.',
      missing;
  end if;
  if to_regclass('public.activity_rosters') is null then
    raise exception 'Missing activity_rosters -- run 0045 before this file.';
  end if;
end $$;

-- ------------------------------------------------------------ the new type
-- Find whichever check on activities lists the types and replace it, by what
-- it says rather than by name (0047 explains why).
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
  check (type in ('challenge', 'combo', 'skills', 'amplify', 'live', 'teameval'));

-- ------------------------------------------------------------------ tables
create table if not exists te_settings (
  activity_id      uuid primary key references activities(id) on delete cascade,
  -- Ask the open-ended questions about each teammate ("evaluate peer to peer").
  -- Off: only the ratings, and the questions they answer about themselves.
  peer_comments    boolean not null default true,
  -- Show a student what their teammates wrote about them, once results are out.
  release_comments boolean not null default true,
  -- Show those comments without who wrote them. Can't be turned off once
  -- anyone has submitted (guard below).
  anonymize        boolean not null default true,
  -- Every rating comes with a sentence saying why.
  explain_ratings  boolean not null default true,
  -- Percent of the points taken off a late submission.
  late_penalty     numeric not null default 10 check (late_penalty between 0 and 100),
  -- When the instructor let students see their results. Null: not yet.
  released_at      timestamptz,
  -- When it was last written into the gradebook.
  scored_at        timestamptz,
  updated_at       timestamptz not null default now()
);

create table if not exists te_categories (
  id          uuid primary key default gen_random_uuid(),
  activity_id uuid not null references activities(id) on delete cascade,
  position    int  not null default 0,
  name        text not null check (length(btrim(name)) between 1 and 120),
  -- What each point means: levels[0] describes a 1, levels[4] a 5.
  levels      jsonb not null default '["", "", "", "", ""]'::jsonb
              check (jsonb_typeof(levels) = 'array' and jsonb_array_length(levels) = 5),
  created_at  timestamptz not null default now(),
  unique (id, activity_id)
);
create index if not exists te_categories_activity_idx on te_categories (activity_id, position);

create table if not exists te_questions (
  id          uuid primary key default gen_random_uuid(),
  activity_id uuid not null references activities(id) on delete cascade,
  position    int  not null default 0,
  -- 'peer': asked about each teammate. 'self': asked once, of themselves.
  audience    text not null check (audience in ('peer', 'self')),
  prompt      text not null check (length(btrim(prompt)) between 1 and 1000),
  created_at  timestamptz not null default now(),
  unique (id, activity_id)
);
create index if not exists te_questions_activity_idx on te_questions (activity_id, position);

-- One rating: rater gave ratee this score in this category. Rater = ratee is
-- how they rated themselves.
create table if not exists te_ratings (
  activity_id uuid not null,
  category_id uuid not null,
  rater_id    uuid not null references students(id) on delete cascade,
  ratee_id    uuid not null references students(id) on delete cascade,
  score       int  not null check (score between 1 and 5),
  reason      text check (reason is null or length(reason) <= 4000),
  updated_at  timestamptz not null default now(),
  primary key (category_id, rater_id, ratee_id),
  foreign key (category_id, activity_id)
    references te_categories (id, activity_id) on delete cascade
);
create index if not exists te_ratings_activity_idx on te_ratings (activity_id, ratee_id);
create index if not exists te_ratings_rater_idx on te_ratings (activity_id, rater_id);

-- One answer to one open-ended question. Author = subject for a 'self' question.
create table if not exists te_comments (
  activity_id uuid not null,
  question_id uuid not null,
  author_id   uuid not null references students(id) on delete cascade,
  subject_id  uuid not null references students(id) on delete cascade,
  body        text not null check (length(btrim(body)) between 1 and 10000),
  updated_at  timestamptz not null default now(),
  primary key (question_id, author_id, subject_id),
  foreign key (question_id, activity_id)
    references te_questions (id, activity_id) on delete cascade
);
create index if not exists te_comments_activity_idx on te_comments (activity_id, subject_id);

-- Room for real paragraphs: a reflection or a comment can run long. Stated
-- again here so a database that ran an earlier copy of this file, with
-- tighter limits, gets these on a re-run (create table if not exists leaves
-- an existing table's checks alone).
alter table te_comments drop constraint if exists te_comments_body_check;
alter table te_comments add constraint te_comments_body_check
  check (length(btrim(body)) between 1 and 10000);
alter table te_ratings drop constraint if exists te_ratings_reason_check;
alter table te_ratings add constraint te_ratings_reason_check
  check (reason is null or length(reason) <= 4000);

-- Handed in. Its ratings and comments are the rows above with this rater; a
-- student without one here has a draft at most, and counts for nobody.
create table if not exists te_submissions (
  activity_id   uuid not null references activities(id) on delete cascade,
  student_id    uuid not null references students(id) on delete cascade,
  -- The first time. Changing it before the due date doesn't move this.
  submitted_at  timestamptz not null default now(),
  -- Null: late exactly when submitted after the due date. True or false: staff
  -- said so (an extension, or a late one they've excused).
  late_override boolean,
  primary key (activity_id, student_id)
);

-- --------------------------------------------------------------- helpers
-- All definer with a fixed search_path, like 0047's: an invoker read through
-- students inside a policy is how 0044's recursion happened.

/** The caller's student row on this activity's course, if they have one. */
create or replace function te_my_student(aid uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select s.id
    from students s
    join activities a on a.course_id = s.course_id
   where a.id = aid and s.user_id = auth.uid()
   limit 1;
$$;

/** May the caller read this evaluation as a student: enrolled, and it is open. */
create or replace function te_student_reads(aid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from activities a
     where a.id = aid
       and a.type = 'teameval'
       and a.course_id in (select my_course_ids())
       and activity_open(a.opens_at));
$$;

/**
 * The team this student evaluates on this activity: from its frozen roster
 * when it has one, otherwise from the course's current team set.
 */
create or replace function te_team_of(aid uuid, sid uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from activity_rosters r where r.activity_id = aid)
      then (select r.team_id from activity_rosters r
             where r.activity_id = aid and r.student_id = sid)
    else (select tm.team_id
            from team_members tm
            join teams t on t.id = tm.team_id
            join courses c on c.current_team_set_id = t.team_set_id
           where c.id = activity_course(aid) and tm.student_id = sid
           order by t.position, t.id
           limit 1)
  end;
$$;

/** Everyone on that team for this activity, the student included. */
create or replace function te_team_members(aid uuid, tid uuid) returns setof uuid
language sql stable security definer set search_path = public as $$
  select r.student_id from activity_rosters r
   where r.activity_id = aid and r.team_id = tid
     and exists (select 1 from activity_rosters x where x.activity_id = aid)
  union
  select tm.student_id from team_members tm
   where tm.team_id = tid
     and not exists (select 1 from activity_rosters x where x.activity_id = aid);
$$;

/** When the evaluation is due, if it is. */
create or replace function te_due(aid uuid) returns timestamptz
language sql stable security definer set search_path = public as $$
  select coalesce(a.due_at, a.individual_due_at) from activities a where a.id = aid;
$$;

/** Was this submission late? Staff's word wins; otherwise the clock's. */
create or replace function te_is_late(aid uuid, sid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(s.late_override, te_due(aid) is not null and s.submitted_at > te_due(aid))
    from te_submissions s
   where s.activity_id = aid and s.student_id = sid;
$$;

grant execute on function
  te_my_student(uuid), te_student_reads(uuid)
  to authenticated;

-- --------------------------------------- an evaluation has a settings row
create or replace function ensure_te_settings() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.type = 'teameval' then
    insert into te_settings (activity_id) values (new.id) on conflict do nothing;
  end if;
  return null;
end $$;

drop trigger if exists trg_ensure_te_settings on activities;
create trigger trg_ensure_te_settings
  after insert or update of type on activities
  for each row execute function ensure_te_settings();

insert into te_settings (activity_id)
select id from activities where type = 'teameval'
on conflict do nothing;

-- Turning an evaluation into something else would strand what students wrote.
create or replace function guard_te_type() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.type = 'teameval' and new.type is distinct from 'teameval'
     and (exists (select 1 from te_ratings r where r.activity_id = old.id)
          or exists (select 1 from te_comments c where c.activity_id = old.id)) then
    raise exception 'Students have started this evaluation, so it has to stay a team evaluation';
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_te_type on activities;
create trigger trg_guard_te_type
  before update of type on activities
  for each row execute function guard_te_type();

-- ---------------------------------------------------------------- guards
create or replace function guard_te_settings() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_setting('te.scoring', true) = 'on' then
    new.updated_at := now();
    return new;
  end if;
  if old.anonymize and not new.anonymize
     and exists (select 1 from te_submissions s where s.activity_id = old.activity_id) then
    raise exception 'Students wrote these expecting to stay anonymous, so that can''t be turned off now';
  end if;
  -- scored_at is score_team_eval's to write.
  new.scored_at := old.scored_at;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_guard_te_settings on te_settings;
create trigger trg_guard_te_settings
  before update on te_settings
  for each row execute function guard_te_settings();

/**
 * The categories and questions are what students answered against. Once
 * anyone has submitted, none may be added or removed — that would leave a
 * submitted evaluation incomplete, or quietly drop part of it. Wording and
 * the scale's descriptions may still be fixed.
 */
create or replace function guard_te_shape() returns trigger
language plpgsql security definer set search_path = public as $$
declare aid uuid := coalesce(new.activity_id, old.activity_id);
begin
  -- Deleting the activity (or course) takes these with it: a cascade.
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  if not exists (select 1 from te_submissions s where s.activity_id = aid) then
    return coalesce(new, old);
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

drop trigger if exists trg_guard_te_categories on te_categories;
create trigger trg_guard_te_categories
  before insert or update or delete on te_categories
  for each row execute function guard_te_shape();

drop trigger if exists trg_guard_te_questions on te_questions;
create trigger trg_guard_te_questions
  before insert or update or delete on te_questions
  for each row execute function guard_te_shape();

-- ------------------------------------------- evaluation scores stay put
-- recompute_result_score as 0047 left it, with team evaluations alongside
-- live questions in the early return: score_team_eval writes these results,
-- and there are no rubric deductions to take from them.
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
     where r.id = rid and a.type in ('live', 'teameval'))
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
alter table te_settings    enable row level security;
alter table te_categories  enable row level security;
alter table te_questions   enable row level security;
alter table te_ratings     enable row level security;
alter table te_comments    enable row level security;
alter table te_submissions enable row level security;

revoke all on te_settings, te_categories, te_questions, te_ratings, te_comments, te_submissions
  from anon, authenticated;

grant select on te_settings, te_categories, te_questions, te_ratings, te_comments, te_submissions
  to authenticated;
grant update (peer_comments, release_comments, anonymize, explain_ratings, late_penalty, released_at)
  on te_settings to authenticated;
grant insert, update, delete on te_categories, te_questions to authenticated;
-- te_ratings, te_comments, te_submissions: no writes from a client at all.
-- save_team_eval and set_team_eval_late are the only ways in.

drop policy if exists "read te_settings" on te_settings;
create policy "read te_settings" on te_settings
  for select to authenticated
  using (staff_of_activity(activity_id) or te_student_reads(activity_id));

drop policy if exists "owner sets te_settings" on te_settings;
create policy "owner sets te_settings" on te_settings
  for update to authenticated
  using (owns_activity(activity_id))
  with check (owns_activity(activity_id));

drop policy if exists "read te_categories" on te_categories;
create policy "read te_categories" on te_categories
  for select to authenticated
  using (staff_of_activity(activity_id) or te_student_reads(activity_id));

drop policy if exists "owner writes te_categories" on te_categories;
create policy "owner writes te_categories" on te_categories
  for all to authenticated
  using (owns_activity(activity_id))
  with check (owns_activity(activity_id));

drop policy if exists "read te_questions" on te_questions;
create policy "read te_questions" on te_questions
  for select to authenticated
  using (staff_of_activity(activity_id) or te_student_reads(activity_id));

drop policy if exists "owner writes te_questions" on te_questions;
create policy "owner writes te_questions" on te_questions
  for all to authenticated
  using (owns_activity(activity_id))
  with check (owns_activity(activity_id));

-- A student reads what THEY wrote, and nothing anyone else wrote.
drop policy if exists "read te_ratings" on te_ratings;
create policy "read te_ratings" on te_ratings
  for select to authenticated
  using (staff_of_activity(activity_id) or rater_id = te_my_student(activity_id));

drop policy if exists "read te_comments" on te_comments;
create policy "read te_comments" on te_comments
  for select to authenticated
  using (staff_of_activity(activity_id) or author_id = te_my_student(activity_id));

drop policy if exists "read te_submissions" on te_submissions;
create policy "read te_submissions" on te_submissions
  for select to authenticated
  using (staff_of_activity(activity_id) or student_id = te_my_student(activity_id));

-- ------------------------------------------------------------ students
/**
 * Who the caller evaluates: everyone on their team for this activity, them
 * included (is_me). Names come from here rather than from students, whose
 * policies follow today's teams, not the activity's.
 */
create or replace function team_eval_team(aid uuid)
returns table (student_id uuid, name text, avatar_tint text, is_me boolean)
language plpgsql stable security definer set search_path = public as $$
declare
  sid uuid := te_my_student(aid);
  tid uuid;
begin
  if sid is null or not te_student_reads(aid) then
    raise exception 'That evaluation isn''t available';
  end if;
  tid := te_team_of(aid, sid);
  if tid is null then
    return;
  end if;
  return query
    select s.id, s.name, s.avatar_tint, s.id = sid
      from students s
     where s.id in (select te_team_members(aid, tid))
     order by s.id <> sid, s.position, s.name;
end $$;

/**
 * Save the caller's evaluation, whole: every rating and answer they have so
 * far replaces what was saved before. With `submit`, it must be complete, and
 * it's handed in. Once handed in, every later save must be complete too, and
 * none is accepted after the due date or once results are out.
 *
 *   ratings:  [{"category_id": "...", "ratee_id": "...", "score": 1-5, "reason": "..."}]
 *   comments: [{"question_id": "...", "subject_id": "...", "body": "..."}]
 */
create or replace function save_team_eval(aid uuid, ratings jsonb, comments jsonb, submit boolean default false)
returns te_submissions
language plpgsql security definer set search_path = public as $$
declare
  sid      uuid := te_my_student(aid);
  tid      uuid;
  set_id   uuid;
  st       te_settings;
  sub      te_submissions;
  r        record;
  missing  int;
  is_peer  boolean;
begin
  if sid is null or not te_student_reads(aid) then
    raise exception 'That evaluation isn''t available';
  end if;
  select * into st from te_settings where activity_id = aid;
  if st.activity_id is null then
    raise exception 'That isn''t a team evaluation';
  end if;
  if jsonb_typeof(coalesce(ratings, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(comments, '[]'::jsonb)) <> 'array' then
    raise exception 'That evaluation can''t be saved';
  end if;

  -- One save at a time per student: two tabs would interleave their rows.
  perform pg_advisory_xact_lock(hashtextextended('te:' || aid::text || ':' || sid::text, 0));

  -- The teams are fixed the first time anyone saves.
  if not exists (select 1 from activity_rosters where activity_id = aid) then
    select c.current_team_set_id into set_id from courses c where c.id = activity_course(aid);
    if set_id is not null then
      insert into activity_rosters (activity_id, team_id, student_id)
      select aid, tm.team_id, tm.student_id
        from teams t join team_members tm on tm.team_id = t.id
       where t.team_set_id = set_id
      on conflict (activity_id, student_id) do nothing;
    end if;
  end if;
  tid := te_team_of(aid, sid);
  if tid is null then
    raise exception 'You''re not on a team for this evaluation — ask your instructor to add you';
  end if;

  select * into sub from te_submissions where activity_id = aid and student_id = sid;
  if sub.student_id is not null then
    if st.released_at is not null then
      raise exception 'Results are out, so your evaluation can''t be changed now';
    end if;
    if te_due(aid) is not null and now() > te_due(aid) then
      raise exception 'It''s past the due date, so your evaluation can''t be changed now';
    end if;
  end if;

  delete from te_ratings where activity_id = aid and rater_id = sid;
  delete from te_comments where activity_id = aid and author_id = sid;

  for r in
    select * from jsonb_to_recordset(coalesce(ratings, '[]'::jsonb))
      as x(category_id uuid, ratee_id uuid, score int, reason text)
  loop
    if not exists (select 1 from te_categories c where c.id = r.category_id and c.activity_id = aid) then
      raise exception 'That category isn''t on this evaluation';
    end if;
    if r.ratee_id is null or r.ratee_id not in (select te_team_members(aid, tid)) then
      raise exception 'You can only rate people on your team';
    end if;
    if r.score is null or r.score not between 1 and 5 then
      raise exception 'Ratings go from 1 to 5';
    end if;
    insert into te_ratings (activity_id, category_id, rater_id, ratee_id, score, reason)
    values (aid, r.category_id, sid, r.ratee_id, r.score, nullif(btrim(coalesce(r.reason, '')), ''))
    on conflict (category_id, rater_id, ratee_id)
    do update set score = excluded.score, reason = excluded.reason, updated_at = now();
  end loop;

  for r in
    select * from jsonb_to_recordset(coalesce(comments, '[]'::jsonb))
      as x(question_id uuid, subject_id uuid, body text)
  loop
    if nullif(btrim(coalesce(r.body, '')), '') is null then
      continue;
    end if;
    select q.audience = 'peer' into is_peer
      from te_questions q where q.id = r.question_id and q.activity_id = aid;
    if is_peer is null then
      raise exception 'That question isn''t on this evaluation';
    end if;
    if is_peer then
      if not st.peer_comments then
        raise exception 'This evaluation doesn''t ask about teammates';
      end if;
      if r.subject_id is null or r.subject_id = sid
         or r.subject_id not in (select te_team_members(aid, tid)) then
        raise exception 'You can only write about people on your team';
      end if;
    elsif r.subject_id is distinct from sid then
      raise exception 'That question is about you';
    end if;
    insert into te_comments (activity_id, question_id, author_id, subject_id, body)
    values (aid, r.question_id, sid, r.subject_id, btrim(r.body))
    on conflict (question_id, author_id, subject_id)
    do update set body = excluded.body, updated_at = now();
  end loop;

  if not submit and sub.student_id is null then
    return null;
  end if;

  -- Complete: every person on the team rated in every category (with a why,
  -- when asked for), every question about themselves answered, and — when
  -- the evaluation asks about teammates — every one about each teammate.
  select count(*) into missing
    from te_categories c
    cross join (select te_team_members(aid, tid) as id) m
   where c.activity_id = aid
     and not exists (
       select 1 from te_ratings x
        where x.category_id = c.id and x.rater_id = sid and x.ratee_id = m.id
          and (not st.explain_ratings or x.reason is not null));
  if missing > 0 then
    raise exception 'Rate everyone in every category%', case when st.explain_ratings then ', and say why,' else '' end
      || ' before you submit';
  end if;

  select count(*) into missing
    from te_questions q
    cross join (select te_team_members(aid, tid) as id) m
   where q.activity_id = aid
     and ((q.audience = 'self' and m.id = sid)
          or (q.audience = 'peer' and st.peer_comments and m.id <> sid))
     and not exists (
       select 1 from te_comments x
        where x.question_id = q.id and x.author_id = sid and x.subject_id = m.id);
  if missing > 0 then
    raise exception 'Answer every question before you submit';
  end if;

  if sub.student_id is null then
    insert into te_submissions (activity_id, student_id) values (aid, sid)
    returning * into sub;
  end if;
  return sub;
end $$;

/**
 * The caller's results, once the instructor has released them.
 *
 * For each category: what they gave themselves, and the average of what each
 * teammate who SUBMITTED gave them — not counting themselves, and not counting
 * anyone who didn't submit. Then, if released, what teammates wrote, without
 * names when the evaluation is anonymous; and their own answers about
 * themselves. In an order that says nothing about who wrote what.
 */
create or replace function team_eval_results(aid uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  sid uuid := te_my_student(aid);
  st  te_settings;
  shown boolean;
begin
  if sid is null or not te_student_reads(aid) then
    raise exception 'That evaluation isn''t available';
  end if;
  select * into st from te_settings where activity_id = aid;
  if st.activity_id is null or st.released_at is null then
    return jsonb_build_object('released', false);
  end if;
  shown := st.release_comments;

  return jsonb_build_object(
    'released', true,
    'anonymous', st.anonymize,
    'comments_shown', shown,
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object(
               'category_id', c.id,
               'self', (select x.score from te_ratings x
                         where x.category_id = c.id and x.rater_id = sid and x.ratee_id = sid),
               'self_reason', (select x.reason from te_ratings x
                                where x.category_id = c.id and x.rater_id = sid and x.ratee_id = sid),
               'average', (select round(avg(x.score)::numeric, 2) from te_ratings x
                            where x.category_id = c.id and x.ratee_id = sid and x.rater_id <> sid
                              and exists (select 1 from te_submissions s
                                           where s.activity_id = aid and s.student_id = x.rater_id)),
               'raters', (select count(*) from te_ratings x
                           where x.category_id = c.id and x.ratee_id = sid and x.rater_id <> sid
                             and exists (select 1 from te_submissions s
                                          where s.activity_id = aid and s.student_id = x.rater_id)),
               'reasons', case when not shown then '[]'::jsonb else coalesce((
                  select jsonb_agg(jsonb_build_object(
                           'author', case when st.anonymize then null else w.name end,
                           'score', x.score,
                           'text', x.reason)
                         order by md5(x.rater_id::text || aid::text))
                    from te_ratings x join students w on w.id = x.rater_id
                   where x.category_id = c.id and x.ratee_id = sid and x.rater_id <> sid
                     and x.reason is not null
                     and exists (select 1 from te_submissions s
                                  where s.activity_id = aid and s.student_id = x.rater_id)
                 ), '[]'::jsonb) end)
             order by c.position, c.id)
        from te_categories c where c.activity_id = aid), '[]'::jsonb),
    'comments', case when not (shown and st.peer_comments) then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
               'question_id', x.question_id,
               'author', case when st.anonymize then null else w.name end,
               'body', x.body)
             order by q.position, md5(x.author_id::text || aid::text))
        from te_comments x
        join te_questions q on q.id = x.question_id and q.audience = 'peer'
        join students w on w.id = x.author_id
       where x.activity_id = aid and x.subject_id = sid and x.author_id <> sid
         and exists (select 1 from te_submissions s
                      where s.activity_id = aid and s.student_id = x.author_id)
    ), '[]'::jsonb) end,
    'reflection', coalesce((
      select jsonb_agg(jsonb_build_object('question_id', x.question_id, 'body', x.body)
                       order by q.position)
        from te_comments x
        join te_questions q on q.id = x.question_id and q.audience = 'self'
       where x.activity_id = aid and x.author_id = sid and x.subject_id = sid
    ), '[]'::jsonb)
  );
end $$;

-- --------------------------------------------------------------- staff
/** Mark a submission late, or not; null goes back to what the clock says. */
create or replace function set_team_eval_late(aid uuid, sid uuid, late boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not can_grade_course(activity_course(aid)) then
    raise exception 'Only someone who can grade this course can change that';
  end if;
  update te_submissions set late_override = late
   where activity_id = aid and student_id = sid;
  if not found then
    raise exception 'They haven''t submitted';
  end if;
end $$;

/**
 * Write the evaluation into the gradebook: one result per student on its
 * teams. Points for submitting, less the late penalty for a late one, and
 * none for no submission. Released if the caller may release (0055), sent for
 * review otherwise; excused rows are never touched, and someone who can't
 * release never rewrites a released grade. Safe to run again.
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
begin
  if not can_grade_course(activity_course(aid)) then
    raise exception 'Only someone who can grade this course can score it';
  end if;
  select * into st from te_settings where activity_id = aid for update;
  if st.activity_id is null then
    raise exception 'That isn''t a team evaluation';
  end if;
  select points_total into total from activities where id = aid;

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

  insert into check_in_results (check_in_id, subject_type, student_id, status, score, is_ci, ci_met, submitted_at)
  select indiv_id, 'student', who.id, new_status,
         case when s.student_id is null then 0
              when te_is_late(aid, who.id) then round(total * (1 - st.late_penalty / 100.0), 2)
              else total end,
         false, true, s.submitted_at
    from (
      select r.student_id as id from activity_rosters r where r.activity_id = aid
      union
      select tm.student_id from team_members tm join teams t on t.id = tm.team_id
       where t.team_set_id = set_id
         and not exists (select 1 from activity_rosters x where x.activity_id = aid)
    ) who
    left join te_submissions s on s.activity_id = aid and s.student_id = who.id
  on conflict (check_in_id, student_id) where subject_type = 'student'
  do update set
    score = excluded.score,
    is_ci = false,
    submitted_at = excluded.submitted_at,
    status = case when check_in_results.status = 'scored' then 'scored' else excluded.status end,
    updated_at = now()
  where check_in_results.status <> 'excused'
    and (check_in_results.status <> 'scored' or releases);
  get diagnostics n = row_count;

  perform set_config('te.scoring', 'on', true);
  update te_settings set scored_at = now() where activity_id = aid;
  perform set_config('te.scoring', 'off', true);

  return jsonb_build_object('students', n, 'status', new_status);
end $$;

-- Who may call what. Revoked from all three (Supabase grants new functions to
-- anon and authenticated by name), then given back where needed. The helpers
-- that read rosters, lateness and teams are called only from inside the
-- definer functions above.
revoke all on function
  te_my_student(uuid), te_student_reads(uuid), te_team_of(uuid, uuid),
  te_team_members(uuid, uuid), te_due(uuid), te_is_late(uuid, uuid),
  ensure_te_settings(), guard_te_type(), guard_te_settings(), guard_te_shape(),
  team_eval_team(uuid), save_team_eval(uuid, jsonb, jsonb, boolean),
  team_eval_results(uuid), set_team_eval_late(uuid, uuid, boolean), score_team_eval(uuid)
  from public, anon, authenticated;

grant execute on function
  te_my_student(uuid), te_student_reads(uuid),
  team_eval_team(uuid), save_team_eval(uuid, jsonb, jsonb, boolean),
  team_eval_results(uuid), set_team_eval_late(uuid, uuid, boolean), score_team_eval(uuid)
  to authenticated;
