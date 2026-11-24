-- Team evaluation: final once submitted, and an anonymous note to the
-- instructor (0060).
--
-- Run in Supabase → SQL Editor, after 0058. Safe to re-run.
--
-- 1. Final once submitted. 0058 let a student change an evaluation they had
--    already handed in, up to the due date and until results were out. Now
--    what's handed in stays as it was handed in: save_team_eval refuses every
--    save — draft or submit — once the caller has a submission. Before that
--    nothing is different: drafts save as they go, and one never submitted
--    can still be submitted late, flagged late. Staff are untouched: they
--    never write through save_team_eval, and set_team_eval_late still marks a
--    submission late or on time.
--
-- 2. A note to the instructor. A third kind of question, audience
--    'instructor': asked once, last, optional, and anonymous to the
--    instructor.
--      - While the student drafts it, it sits in te_comments like their
--        reflection, under their name so they can come back to it — and
--        staff can't read it there (the te_comments policy below).
--      - When they submit, it moves to te_notes, which has no author and no
--        time: nothing left in the database ties it to who wrote it. Staff
--        read te_notes; students never do.
--      - It's never required to submit, and never shown to teammates.
--
-- The app's builder adds a note question to every new evaluation, so this
-- file must run before that build ships: without it the database refuses the
-- 'instructor' audience and Finish fails.

-- ---------------------------------------------------------------- prereqs
do $$
declare missing text;
begin
  select string_agg(want.fn, ', ' order by want.fn)
    into missing
    from (values
      ('save_team_eval(uuid, jsonb, jsonb, boolean)'),
      ('staff_of_activity(uuid)'),
      ('te_my_student(uuid)'),
      ('te_student_reads(uuid)'),
      ('te_team_of(uuid, uuid)'),
      ('te_team_members(uuid, uuid)')
    ) as want(fn)
   where to_regprocedure('public.' || want.fn) is null;

  if missing is not null then
    raise exception 'Missing functions (%) -- run 0058 before this file.', missing;
  end if;
end $$;

-- ------------------------------------------------------------ the note
-- A third audience. Found by what it says, as 0058 did for activities' type
-- check, so a re-run replaces it rather than stacking a second one.
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.te_questions'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ~* '\maudience\M'
  loop
    execute format('alter table public.te_questions drop constraint %I', c.conname);
  end loop;
end $$;

alter table te_questions
  add constraint te_questions_audience_check
  check (audience in ('peer', 'self', 'instructor'));

-- A submitted note: which evaluation and question, and what it says. No
-- author, no timestamp — the id is random, so ordering by it shuffles.
create table if not exists te_notes (
  id          uuid primary key default gen_random_uuid(),
  activity_id uuid not null,
  question_id uuid not null,
  body        text not null check (length(btrim(body)) between 1 and 10000),
  foreign key (question_id, activity_id)
    references te_questions (id, activity_id) on delete cascade
);
create index if not exists te_notes_activity_idx on te_notes (activity_id);

alter table te_notes enable row level security;
revoke all on te_notes from public, anon, authenticated;
grant select on te_notes to authenticated;

drop policy if exists "staff read te_notes" on te_notes;
create policy "staff read te_notes" on te_notes
  for select to authenticated
  using (staff_of_activity(activity_id));

/** Is this question the note to the instructor? Read inside the te_comments policy. */
create or replace function te_is_note(qid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from te_questions q where q.id = qid and q.audience = 'instructor');
$$;

-- 0058's policy, less the drafts of notes for staff: a student still reads
-- every row they wrote, staff every row but those.
drop policy if exists "read te_comments" on te_comments;
create policy "read te_comments" on te_comments
  for select to authenticated
  using ((staff_of_activity(activity_id) and not te_is_note(question_id))
         or author_id = te_my_student(activity_id));

-- ------------------------------------------------------------------ saving
/**
 * Save the caller's evaluation, whole: every rating and answer they have so
 * far replaces what was saved before. With `submit`, it must be complete, and
 * it's handed in — its notes to the instructor moved to te_notes without
 * the caller's name. Once handed in, nothing more is accepted (0060).
 *
 *   ratings:  [{"category_id": "...", "ratee_id": "...", "score": 1-5}]
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
  aud      text;
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

  -- Handed in is final: no change to it, before the due date or after.
  if exists (select 1 from te_submissions where activity_id = aid and student_id = sid) then
    raise exception 'You''ve already submitted this evaluation, so it can''t be changed';
  end if;

  delete from te_ratings where activity_id = aid and rater_id = sid;
  delete from te_comments where activity_id = aid and author_id = sid;

  for r in
    select * from jsonb_to_recordset(coalesce(ratings, '[]'::jsonb))
      as x(category_id uuid, ratee_id uuid, score int)
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
    insert into te_ratings (activity_id, category_id, rater_id, ratee_id, score)
    values (aid, r.category_id, sid, r.ratee_id, r.score)
    on conflict (category_id, rater_id, ratee_id)
    do update set score = excluded.score, updated_at = now();
  end loop;

  for r in
    select * from jsonb_to_recordset(coalesce(comments, '[]'::jsonb))
      as x(question_id uuid, subject_id uuid, body text)
  loop
    if nullif(btrim(coalesce(r.body, '')), '') is null then
      continue;
    end if;
    aud := null;
    select q.audience into aud
      from te_questions q where q.id = r.question_id and q.activity_id = aid;
    if aud is null then
      raise exception 'That question isn''t on this evaluation';
    end if;
    if aud = 'peer' then
      if not st.peer_comments then
        raise exception 'This evaluation doesn''t ask about teammates';
      end if;
      if r.subject_id is null or r.subject_id = sid
         or r.subject_id not in (select te_team_members(aid, tid)) then
        raise exception 'You can only write about people on your team';
      end if;
    elsif r.subject_id is distinct from sid then
      -- A reflection is about themselves; a note is from them, filed the same way.
      raise exception 'That question is about you';
    end if;
    insert into te_comments (activity_id, question_id, author_id, subject_id, body)
    values (aid, r.question_id, sid, r.subject_id, btrim(r.body))
    on conflict (question_id, author_id, subject_id)
    do update set body = excluded.body, updated_at = now();
  end loop;

  if not submit then
    return null;
  end if;

  -- Complete: every person on the team rated in every category, every
  -- question about themselves answered, and — when the evaluation asks about
  -- teammates — every one about each teammate. A note is optional.
  select count(*) into missing
    from te_categories c
    cross join (select te_team_members(aid, tid) as id) m
   where c.activity_id = aid
     and not exists (
       select 1 from te_ratings x
        where x.category_id = c.id and x.rater_id = sid and x.ratee_id = m.id);
  if missing > 0 then
    raise exception 'Rate everyone in every category before you submit';
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

  -- The notes leave their writer behind: copied without author or time, and
  -- the drafts under the caller's name deleted.
  insert into te_notes (activity_id, question_id, body)
  select x.activity_id, x.question_id, x.body
    from te_comments x
    join te_questions q on q.id = x.question_id and q.audience = 'instructor'
   where x.activity_id = aid and x.author_id = sid;
  delete from te_comments x
   using te_questions q
   where q.id = x.question_id and q.audience = 'instructor'
     and x.activity_id = aid and x.author_id = sid;

  insert into te_submissions (activity_id, student_id) values (aid, sid)
  returning * into sub;
  return sub;
end $$;


-- Who may call what: save_team_eval as 0058 had it (create or replace keeps
-- the grants; this says them again so a re-run leaves no doubt), and
-- te_is_note for the signed-in, whose te_comments policy calls it — it says
-- only whether a question is a note, which anyone who can see it knows.
revoke all on function save_team_eval(uuid, jsonb, jsonb, boolean), te_is_note(uuid) from public, anon, authenticated;
grant execute on function save_team_eval(uuid, jsonb, jsonb, boolean), te_is_note(uuid) to authenticated;
