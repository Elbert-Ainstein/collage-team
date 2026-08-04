-- Makes the "Check-in" TF permission real.
--
-- Run in Supabase → SQL Editor, after 0009. Safe to re-run.
--
-- THE GAP. 0007 added courses.tf_can_checkin beside courses.tf_can_grade and
-- wired only the second one: can_grade_course() reads tf_can_grade, and the
-- policies on check_in_results and submission_marks are built on it. Nothing
-- anywhere read tf_can_checkin. So the switch on the TFs screen wrote a column
-- and granted nothing — worse than having no switch at all, because the
-- instructor believes they have withheld something and they have not.
--
-- WHAT IT NOW MEANS. Only writes this product already has, no new concept:
--   check_ins.posted    whether students can see the check-in and submit to it
--   activities.posted   the same action — the UI writes both in one go
--   courses.live_week   which week's team cells are live right now
-- Nothing about scores.
--
-- `discussing` was the other candidate and is deliberately left out. No code in
-- this product writes that status; only readers exist. Granting it would be
-- inventing a capability rather than enforcing one — and the only way to grant
-- it is an UPDATE policy on check_in_results, which would also hand a TF who
-- cannot grade the ability to rewrite a student's answer text (the grading
-- guard permits text edits for non-graders, because that is how students save).
--
-- WHAT MUST KEEP HOLDING. A TF with this permission and WITHOUT the grading one
-- must still be unable to put a score on anything. Two things keep that true:
--
--   1. check_in_results and submission_marks still ask can_grade_check_in(),
--      which reads tf_can_grade and nothing else. This migration does not touch
--      either policy, or guard_student_grading.
--   2. The UPDATE policies below each open a whole row, and RLS cannot narrow
--      that to one column — so a BEFORE UPDATE guard does it, raising on any
--      change beyond the one column the permission is about. Without the guard
--      on `courses` this permission would be an escalation: a TF could set
--      tf_can_grade on their own course and start grading.

-- --------------------------------------------------------------- the helper
/** May the caller run check-ins on this course — as its owner, or as a TF allowed to? */
create or replace function can_run_checkins_course(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from courses c where c.id = cid and c.owner_id = auth.uid())
      or exists (
        select 1 from course_tfs t
          join courses c on c.id = t.course_id
         where t.course_id = cid and t.user_id = auth.uid() and c.tf_can_checkin);
$$;

grant execute on function can_run_checkins_course(uuid) to authenticated;

-- ---------------------------------------------------------------- the guard
/**
 * Did this UPDATE touch anything besides `col`?
 *
 * Compared as jsonb rather than column by column so a column added to the table
 * later is protected by default instead of quietly escaping the guard.
 */
create or replace function touches_beyond(old_row jsonb, new_row jsonb, col text) returns boolean
language sql immutable set search_path = public as $$
  select (old_row - col) is distinct from (new_row - col);
$$;

/**
 * The three guards below share a shape:
 *
 *   - auth.uid() null means this is not a request from a signed-in user — the
 *     SQL editor, or a service-role script. Those already bypass RLS, and
 *     tripping the instructor's own hand-applied fix on an unrelated column
 *     would be its own outage.
 *   - the course owner is exempt: they edit these tables outright. The guard
 *     exists only to bound what tf_can_checkin opened up.
 *   - anyone else who got this far did so through the policies below, so they
 *     are a permitted TF, and may move exactly one column.
 *
 * "Which course is this" is answered from the OLD row on purpose. Answering it
 * from the new one would exempt exactly the write worth stopping: a TF pointing
 * an instructor's check-in or activity at a course they own themselves, which
 * the policy's WITH CHECK would then wave through — and the submissions and
 * marks hanging off it would go with it.
 */
create or replace function guard_check_in_posting() returns trigger
language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  if auth.uid() is null then
    return new;
  end if;

  -- Re-parenting is never posting. The permissive policies are OR-ed, so a TF
  -- could satisfy USING through their OWN course and WITH CHECK through the new
  -- "tf posts check_ins" policy, and walk a check-in from a course they own
  -- into the instructor's — dragging its results and marks along the cascade.
  -- Refuse it outright, before the owner exemption, because the exemption tests
  -- only the row's OLD parent.
  if new.activity_id is distinct from old.activity_id then
    raise exception 'A check-in cannot be moved to a different activity';
  end if;

  -- An unresolvable parent guards rather than exempts; the foreign key means it
  -- cannot happen, and "unknown" is not a reason to allow a write.
  select a.course_id into cid from activities a where a.id = old.activity_id;
  if cid is not null and owns_course(cid) then
    return new;
  end if;

  if touches_beyond(to_jsonb(old), to_jsonb(new), 'posted') then
    raise exception 'Check-in permission covers posting a check-in, not changing it';
  end if;

  return new;
end $$;

create or replace function guard_activity_posting() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  -- Same shape as the check-in guard: the owner exemption below reads only the
  -- OLD parent, so without this a TF could move an activity they own into the
  -- instructor's course and have the new policy's WITH CHECK accept it.
  if new.course_id is distinct from old.course_id then
    raise exception 'An activity cannot be moved to a different course';
  end if;

  if owns_course(old.course_id) then
    return new;
  end if;

  if touches_beyond(to_jsonb(old), to_jsonb(new), 'posted') then
    raise exception 'Check-in permission covers posting an activity, not editing it';
  end if;

  return new;
end $$;

create or replace function guard_course_live_week() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or owns_course(old.id) then
    return new;
  end if;

  -- The one that matters most: tf_can_grade, tf_can_checkin and owner_id all
  -- live on this row, and a TF who could write them would be granting
  -- themselves the permissions the instructor is deciding about.
  if touches_beyond(to_jsonb(old), to_jsonb(new), 'live_week') then
    raise exception 'Check-in permission covers the live week, not the course settings';
  end if;

  return new;
end $$;

drop trigger if exists trg_guard_check_in_posting on check_ins;
create trigger trg_guard_check_in_posting
  before update on check_ins
  for each row execute function guard_check_in_posting();

drop trigger if exists trg_guard_activity_posting on activities;
create trigger trg_guard_activity_posting
  before update on activities
  for each row execute function guard_activity_posting();

drop trigger if exists trg_guard_course_live_week on courses;
create trigger trg_guard_course_live_week
  before update on courses
  for each row execute function guard_course_live_week();

-- ------------------------------------------------------------------ the RLS
-- UPDATE only. A permitted TF posts and unposts what the instructor authored;
-- creating and deleting check-ins, activities and courses stays with the owner,
-- so no policy here is `for all`. Reads already exist (0006/0007).
drop policy if exists "tf posts check_ins" on check_ins;
create policy "tf posts check_ins" on check_ins
  for update to authenticated
  using (exists (select 1 from activities a where a.id = check_ins.activity_id
                   and can_run_checkins_course(a.course_id)))
  with check (exists (select 1 from activities a where a.id = check_ins.activity_id
                   and can_run_checkins_course(a.course_id)));

drop policy if exists "tf posts activities" on activities;
create policy "tf posts activities" on activities
  for update to authenticated
  using (can_run_checkins_course(course_id))
  with check (can_run_checkins_course(course_id));

drop policy if exists "tf sets live week" on courses;
create policy "tf sets live week" on courses
  for update to authenticated
  using (can_run_checkins_course(id))
  with check (can_run_checkins_course(id));

-- Table privileges are the floor under the policies; the owner already has
-- these, so this is a no-op on a database where 0003 ran normally.
grant update on courses, activities, check_ins to authenticated;
