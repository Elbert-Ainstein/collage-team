-- 0044: the hand-in closes at the deadline, and the instructor reopens it per
-- student.
--
-- Run in Supabase → SQL Editor, after 0043. Safe to re-run.
--
-- Seven AP50 students handed the last combo in after it was due, and nothing
-- stopped them: due_at only ever coloured a hand-in amber on the instructor's
-- list. Kelly's rule is the one Gradescope enforced for her last year. At the
-- deadline the hand-in closes, and work that is not in gets a 0. Now and then
-- she reopens it for one student she has decided to let in late, and their work
-- is still marked Late.
--
-- WHAT CLOSES, AND WHEN
--   - A student's own row (subject_type = 'student'), the individual half. A
--     team hands its answer in at the check-in, on a date of its own, and due_at
--     was never its deadline. Team rows are untouched.
--   - At coalesce(due_at, individual_due_at): the date the app prints as
--     "Individual work due" and marks Late against. Inclusive. Work arriving AT
--     the deadline is on time, which is how the Late flag has always read it.
--   - For students only. The course owner and a TF who may grade write these
--     rows to mark them and are never held to it.
--   - An activity with no due date never closes.
--
-- WHAT "CLOSED" MEANS: the student's work is frozen as it stood at the deadline.
-- Every write a student can make to it, not just Submit, because each of the
-- others is a way round it:
--   - status. Submit is the obvious one. Unsubmit is the other: after the
--     deadline it would take on-time work back, with no way to hand it in again.
--   - the pdf (submission_files and its object). Swapping the file under a row
--     that still says "submitted", at an on-time stamp, is a late hand-in that
--     never looks like one.
--   - the page mapping (submission_pages). It is the student's statement about
--     their work, and it follows the work.
--
-- REOPENING is one row per (activity, student) in hand_in_reopens, written by
-- the course owner and nobody else. While the row is there that student is held
-- to nothing; deleting it closes the hand-in again. It does not move the
-- deadline. The Late flag still reads against due_at, so work handed in through
-- a reopen shows as Late on the instructor's list, which is the point: it is in,
-- and it was late.
--
-- submitted_at is now stamped every time work is handed in, not only the first
-- time. 0008 stamped it once, so a student who handed in on time, pressed
-- Unsubmit and handed in different work later kept the on-time stamp, and the
-- Late flag never saw it. After this file a student can only do that while the
-- hand-in is open: before the deadline, where the new stamp is still on time,
-- or through a reopen, where it is late and should say so.

-- ------------------------------------------------------------------- table
create table if not exists hand_in_reopens (
  activity_id uuid not null references activities(id) on delete cascade,
  student_id  uuid not null references students(id) on delete cascade,
  created_by  uuid references auth.users(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  primary key (activity_id, student_id)
);

alter table hand_in_reopens enable row level security;

-- The three questions the policies ask, each answered by a security definer
-- function rather than a join inside the policy.
--
-- Not a style choice. A policy that reads `students` as the caller runs that
-- table's own policies, and those reach team_members, whose policy calls
-- owns_student() (0004, security invoker), which reads `students` again. Under
-- some plans that loops until the statement is cancelled: a scratch copy of this
-- schema hung on exactly this insert, written with the join in the policy.
-- These read the tables directly, once.

/** Does the caller own the course this activity is on? */
create or replace function owns_activity(aid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from activities a
      join courses c on c.id = a.course_id
     where a.id = aid and c.owner_id = auth.uid());
$$;

/**
 * May the caller reopen this activity for this student?
 *
 * The course owner, and only for a student on the same course as the activity.
 * Without the second half a guessed student id would file a reopen under a
 * course that student is not on, where nothing would ever read it.
 */
create or replace function can_reopen(aid uuid, sid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from activities a
      join courses c on c.id = a.course_id
      join students s on s.course_id = a.course_id
     where a.id = aid and s.id = sid and c.owner_id = auth.uid());
$$;

/**
 * May the caller read this reopen? The owner, any TF on the course (the
 * activity page lists who it has been reopened for, and a TF reads that page
 * too), and the student it is about. A student never sees who ELSE was let in
 * late.
 */
create or replace function can_read_reopen(aid uuid, sid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from students s where s.id = sid and s.user_id = auth.uid())
      or exists (
        select 1 from activities a
          join courses c on c.id = a.course_id
         where a.id = aid
           and (c.owner_id = auth.uid()
                or exists (
                  select 1 from course_tfs t
                   where t.course_id = a.course_id and t.user_id = auth.uid())));
$$;

grant execute on function owns_activity(uuid), can_reopen(uuid, uuid), can_read_reopen(uuid, uuid)
  to authenticated;

drop policy if exists "owner reopens" on hand_in_reopens;
create policy "owner reopens" on hand_in_reopens
  for insert to authenticated
  with check (created_by = auth.uid() and can_reopen(activity_id, student_id));

drop policy if exists "owner closes" on hand_in_reopens;
create policy "owner closes" on hand_in_reopens
  for delete to authenticated
  using (owns_activity(activity_id));

drop policy if exists "read hand_in_reopens" on hand_in_reopens;
create policy "read hand_in_reopens" on hand_in_reopens
  for select to authenticated
  using (can_read_reopen(activity_id, student_id));

grant select, insert, delete on hand_in_reopens to authenticated;

-- ----------------------------------------------------------------- the rule
/**
 * May this student still hand in on this check-in?
 *
 * True with no due date, up to and including the deadline, and after it while a
 * reopen row stands. A check-in that cannot be found answers true: whatever
 * write is asking is refused by its own policy, and a raise from here would
 * only hide which one.
 *
 * security definer because the guard below calls it from a student's session,
 * where hand_in_reopens is readable but the answer must not depend on that.
 */
create or replace function hand_in_open(ciid uuid, sid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select coalesce(a.due_at, a.individual_due_at) is null
        or now() <= coalesce(a.due_at, a.individual_due_at)
        or exists (
          select 1 from hand_in_reopens o
           where o.activity_id = a.id and o.student_id = sid)
      from check_ins ci
      join activities a on a.id = ci.activity_id
     where ci.id = ciid), true);
$$;

/** The same question, asked of a result row. A team's row is always open. */
create or replace function result_hand_in_open(rid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select r.subject_type <> 'student' or hand_in_open(r.check_in_id, r.student_id)
      from check_in_results r
     where r.id = rid), true);
$$;

grant execute on function hand_in_open(uuid, uuid), result_hand_in_open(uuid) to authenticated;

-- ---------------------------------------------------------- the result row
-- Its own trigger, not a branch in guard_student_grading: 0025 is the story of
-- what `create or replace` does to a branch somebody forgets to carry over, and
-- 0038 kept guard_release separate for the same reason.
--
-- Inserts too. Opening the hand-in screen creates an empty draft row, and after
-- the deadline there is nothing for one to be a draft of. The app stops asking;
-- this is what makes that true.
create or replace function guard_hand_in_deadline() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.subject_type is distinct from 'student' then
    return new;
  end if;
  if can_grade_check_in(new.check_in_id) or owns_check_in(new.check_in_id) then
    return new;
  end if;
  if hand_in_open(new.check_in_id, new.student_id) then
    return new;
  end if;
  raise exception 'The deadline for this has passed - ask your instructor to reopen it';
end $$;

drop trigger if exists trg_guard_hand_in_deadline on check_in_results;
create trigger trg_guard_hand_in_deadline
  before insert or update on check_in_results
  for each row execute function guard_hand_in_deadline();

-- -------------------------------------------------- the pdf and its pages
/**
 * May the caller change the work filed under this result: upload, replace, map?
 *
 * The student or team whose work it is (0013), while their hand-in is open.
 */
create or replace function can_change_submission(rid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select can_write_result(rid) and result_hand_in_open(rid);
$$;

/**
 * May the caller remove this result's pdf?
 *
 * As can_change_submission, plus the owner of the check-in at any time, so that
 * deleting an activity or clearing a course still takes the pdfs with it (0018).
 * That sweep runs long after every deadline, and closing it would leave the
 * objects behind: invisible, unlistable, and still counted against storage.
 */
create or replace function can_remove_submission(rid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select can_change_submission(rid)
      or exists (
        select 1 from check_in_results r
         where r.id = rid and owns_check_in(r.check_in_id));
$$;

grant execute on function can_change_submission(uuid), can_remove_submission(uuid) to authenticated;

-- Each policy below is 0015's (as 0018 and 0027 last left it) with the
-- student's branch narrowed to an open hand-in. The owner's branches are
-- unchanged, and nothing here widens who can read anything.
drop policy if exists "write submission_files" on submission_files;
create policy "write submission_files" on submission_files
  for insert to authenticated
  with check (can_change_submission(result_id) and created_by = auth.uid());

drop policy if exists "replace submission_files" on submission_files;
create policy "replace submission_files" on submission_files
  for delete to authenticated using (can_remove_submission(result_id));

drop policy if exists "write submission_pages" on submission_pages;
create policy "write submission_pages" on submission_pages
  for insert to authenticated
  with check (
    can_change_submission(result_id)
    and not exists (
      select 1 from check_in_results r where r.id = result_id and r.status = 'scored')
  );

drop policy if exists "clear submission_pages" on submission_pages;
create policy "clear submission_pages" on submission_pages
  for delete to authenticated
  using (
    exists (
      select 1 from check_in_results r
       where r.id = submission_pages.result_id
         and owns_check_in(r.check_in_id))
    or (
      can_change_submission(submission_pages.result_id)
      and not exists (
        select 1 from check_in_results r
         where r.id = submission_pages.result_id and r.status = 'scored')
    )
  );

drop policy if exists "write submission objects" on storage.objects;
create policy "write submission objects" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'submissions'
    and can_change_submission(recording_result_id(name))
    and recording_path_matches(name)
  );

drop policy if exists "delete submission objects" on storage.objects;
create policy "delete submission objects" on storage.objects
  for delete to authenticated
  using (bucket_id = 'submissions' and can_remove_submission(recording_result_id(name)));

-- ------------------------------------------------------- the hand-in stamp
-- 0008's function with one branch added: a row moving from nothing-in to
-- 'submitted' is a new hand-in and gets a new stamp. 'needs_review' is left out
-- of that branch on purpose. It is a TF's move, made long after the work
-- arrived, and re-stamping on it would mark everyone a TF graded after the
-- deadline as late.
create or replace function stamp_submitted_at() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.status in ('submitted', 'needs_review') and new.submitted_at is null then
    new.submitted_at := now();
  elsif tg_op = 'UPDATE'
        and new.status = 'submitted'
        and old.status in ('none', 'draft') then
    new.submitted_at := now();
  end if;
  return new;
end $$;
