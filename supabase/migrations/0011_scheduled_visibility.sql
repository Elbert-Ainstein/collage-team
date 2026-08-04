-- Scheduled visibility: an activity reaches students when it opens, not when it
-- is created.
--
-- Run in Supabase → SQL Editor, after 0010. Safe to re-run.
--
-- ---------------------------------------------------------------------------
-- NULL MEANS VISIBLE. Read that twice before changing anything in this file.
--
--   activities.opens_at IS NULL   -> visible to students
--   activities.opens_at <= now()  -> visible to students
--   activities.opens_at  > now()  -> invisible to students, and unwritable
--
-- The next person to touch this will assume NULL means hidden, because an unset
-- flag usually means "off". It does not mean that here, and acting on that
-- assumption takes a live course dark. The column has existed since 0001 and
-- has never been written by anything, so every activity in the running course
-- carries NULL right now. Reading NULL as hidden would make every assignment
-- vanish from every student's list the moment this migration is applied, with
-- no backfill to put them back. NULL means "authored before scheduling
-- existed", not "not released yet".
--
-- `posted` is NOT part of this and must not become part of it. It is a separate
-- faculty-side flag that the legacy /ck?classic=1 UI and GradebookPillar still
-- read, its column default is FALSE, and hanging student visibility on it would
-- hide every existing activity at once for exactly the same reason in reverse.
-- opens_at is the single student-visibility rule.
--
-- Faculty are not subject to it at all. The instructor and their TFs are the
-- people doing the scheduling, so they have to see and edit an activity before
-- it opens -- that is the whole feature. This migration narrows the three
-- student-facing rules and nothing else: the owner policies from 0003/0004 and
-- the TF read policies from 0007 are left exactly as they are.
-- ---------------------------------------------------------------------------

-- Narrowing what a student may read is only safe if faculty still reach these
-- tables by another route. Postgres ORs permissive policies together, so the
-- owner and TF policies are that route -- and if one of them has gone missing,
-- restricting the student policy is how a course loses an activity entirely.
-- Check before writing rather than discover it from a support request.
do $$
declare missing text;
begin
  select string_agg(want.policyname || ' on ' || want.tablename, ', ' order by want.policyname)
    into missing
    from (values
      ('activities', 'own activities'),
      ('activities', 'tf reads activities'),
      ('check_ins',  'own check_ins'),
      ('check_ins',  'tf reads check_ins')
    ) as want(tablename, policyname)
   where not exists (
     select 1 from pg_policies p
      where p.schemaname = 'public'
        and p.tablename  = want.tablename
        and p.policyname = want.policyname);

  if missing is not null then
    raise exception
      'Faculty access is incomplete (missing: %) -- re-run 0003 and 0007 before this file, or scheduling will hide activities from their own instructor.',
      missing;
  end if;
end $$;

-- ------------------------------------------------------------- the one rule
/**
 * Is an activity open to students yet?
 *
 * The single place the NULL / past / future rule is written down. Every
 * student-facing gate below calls it, so what a student can SEE and what a
 * student can WRITE TO cannot drift apart -- and drift is the failure that
 * matters here, because the student write policies never look at the activity
 * on their own.
 *
 * Takes the timestamp rather than an activity id so the read policies can apply
 * it to a row they already have, without a second lookup per row.
 */
create or replace function activity_open(opens timestamptz) returns boolean
language sql stable security invoker as $$
  select opens is null or opens <= now();
$$;

grant execute on function activity_open(timestamptz) to authenticated;

-- ------------------------------------------------------------ student reads
-- Both policies are replaced whole rather than added to, because a policy can
-- only be replaced whole. The enrolment test is carried over from 0006 verbatim.

drop policy if exists "student reads activities" on activities;
create policy "student reads activities" on activities
  for select to authenticated
  using (course_id in (select my_course_ids()) and activity_open(opens_at));

-- The open test is restated here rather than left to the activities policy
-- above. A check-in is only ever meaningful through its parent, and a
-- visibility rule should not depend on how two policies on two tables happen to
-- compose inside a subquery.
--
-- Deliberately not extended to check_in_results: a student reads their own
-- result rows by subject, and a row belonging to an unopened activity has no
-- check-in and no activity they can read alongside it. Worth revisiting only if
-- faculty start pre-creating scored rows ahead of the open date.
drop policy if exists "student reads check_ins" on check_ins;
create policy "student reads check_ins" on check_ins
  for select to authenticated
  using (exists (select 1 from activities a where a.id = check_ins.activity_id
                   and a.course_id in (select my_course_ids())
                   and activity_open(a.opens_at)));

-- ----------------------------------------------------------- student writes
/**
 * Is this check-in part of a course the caller is enrolled in, on an activity
 * that has opened?
 *
 * The open test is the load-bearing half. This function is the whole of what
 * the student INSERT and UPDATE policies on check_in_results consult -- they
 * gate on my_check_in() and never reach the activity -- so without it a student
 * holding a check-in id could POST a submission to an activity that has not
 * opened, and hiding the activity from the read policies would have been a
 * courtesy rather than a boundary.
 *
 * Faculty and TF writes do not come through here: they run on "own
 * check_in_results" (0003/0004) and "tf grades results" (0007), which are
 * unchanged, so grading an unopened activity still works.
 */
create or replace function my_check_in(ciid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from check_ins ci
      join activities a on a.id = ci.activity_id
     where ci.id = ciid
       and a.course_id in (select my_course_ids())
       and activity_open(a.opens_at));
$$;

grant execute on function my_check_in(uuid) to authenticated;

-- ------------------------------------------- scheduling is a posting action
/**
 * Did this UPDATE touch anything outside `cols`?
 *
 * The plural of touches_beyond() from 0010, under its own name rather than as
 * an overload: 0010's two other guards call touches_beyond() with a bare string
 * literal, and adding a text[] candidate puts an untyped literal in front of two
 * signatures. Not worth the risk of re-resolving a call in live guard code.
 */
create or replace function touches_outside(old_row jsonb, new_row jsonb, cols text[]) returns boolean
language sql immutable set search_path = public as $$
  select (old_row - cols) is distinct from (new_row - cols);
$$;

-- 0010 let a permitted TF move exactly one column on an activity, `posted`.
-- Deciding when the class sees an activity is the same act under a different
-- name, and the design puts it behind the same permission, so opens_at joins it.
--
-- Replaced here rather than edited into 0010, which has already been run by hand
-- against the live database.
--
-- Everything else is carried over unchanged and needs to stay that way. The
-- re-parenting refusal sits ABOVE the owner exemption because the exemption
-- reads the OLD row; together they are what stops a TF walking an instructor's
-- activity into a course of their own and having the new policy's WITH CHECK
-- wave it through.
create or replace function guard_activity_posting() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if new.course_id is distinct from old.course_id then
    raise exception 'An activity cannot be moved to a different course';
  end if;

  if owns_course(old.course_id) then
    return new;
  end if;

  if touches_outside(to_jsonb(old), to_jsonb(new), array['posted', 'opens_at']) then
    raise exception 'Check-in permission covers posting and scheduling an activity, not editing it';
  end if;

  return new;
end $$;

-- 0010 already created this trigger against the same function name, so the
-- replacement above is live on its own. Re-asserted so this file stands up on a
-- database rebuilt from the migrations in order.
drop trigger if exists trg_guard_activity_posting on activities;
create trigger trg_guard_activity_posting
  before update on activities
  for each row execute function guard_activity_posting();
