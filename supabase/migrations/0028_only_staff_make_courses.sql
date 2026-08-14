-- A roster row may only ever name the person signing in.
--
-- Run in Supabase → SQL Editor, before 0029. Safe to re-run.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS FILE USED TO DO, AND WHY IT NO LONGER DOES.
--
-- Two earlier cuts gated course creation behind an allow-list — first keyed on
-- user_id, then on email. If you ran either, this undoes it.
--
-- That allow-list existed to stop one specific attack: claim_student_rows()
-- searched EVERY course in the database for a roster row whose email matched
-- the caller's, so a student who could create a course could plant a
-- classmate's address on a replica of AP50A and have that classmate's app route
-- into it. Gating creation made the replica impossible to stand up.
--
-- 0029 removes the search instead, which is the better half of the same fix.
-- Once joining a course means presenting a secret that NAMES it, a course
-- somebody made for themselves is inert — it can only ever contain people who
-- were handed its code AND are on its roster. The allow-list became a fence
-- around a hole that is now filled in, and it had a real cost: an instructor
-- could not sign herself up. Somebody with database access had to enter her
-- address first, or her first visit was an empty app.
--
-- So anyone may create a course again, which is how a tool of this shape is
-- supposed to work and how Kelly gets started without asking anybody.
--
-- ---------------------------------------------------------------------------
-- 1. UNDO THE ALLOW-LIST, if a previous run of this file created it.

-- The policy goes before the table it reads and before the column one version
-- of it tested — Postgres refuses to drop a column a policy depends on.
drop policy if exists "make a course if allowed" on courses;

drop function if exists may_make_courses();
drop trigger if exists trg_normalise_creator_email on course_creators;
drop function if exists normalise_creator_email();
drop table if exists course_creators;

-- 0003 had ONE policy on courses; the allow-list split it into four so INSERT
-- could carry an extra test. With the test gone, four statements that all have
-- to agree is worse than one.
drop policy if exists "read own courses" on courses;
drop policy if exists "change own courses" on courses;
drop policy if exists "drop own courses" on courses;
drop policy if exists "own courses" on courses;

create policy "own courses" on courses
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 2. THE PART CODES DO NOT REPLACE.
--
-- "own students" (0003:51) authorises a roster write purely on owning the
-- course. Nothing anywhere names students.user_id and there is no trigger on
-- the table, so the owner of any course could write a row carrying SOMEBODY
-- ELSE's account id. app/ck/page.tsx:123 reads "you are on the roster of a
-- course you do not own" as "you are a student here" and routes that person
-- into the attacker's course. Aimed at the instructor it is a lock-out, and she
-- cannot undo it: deleting the row needs owns_course() on THEIR course.
--
-- Codes are no help here, because this attack never asks the victim to join
-- anything. That is why this file still exists at all.
--
-- The rule is narrow enough to leave every real path alone. Both claim
-- functions set user_id = auth.uid(), and 0029's join_with_code does the same —
-- it has no user id parameter to abuse. Nothing in the app has ever written
-- another person's id onto a roster row, so that is the only thing refused.
--
-- A trigger rather than a policy because WITH CHECK cannot see the old row, and
-- "may not CHANGE once set" is a statement about both.

create or replace function guard_roster_identity() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.user_id is not null and new.user_id <> auth.uid() then
      raise exception 'A roster row can only be linked to your own account';
    end if;
    return new;
  end if;

  if new.user_id is distinct from old.user_id
     and new.user_id is not null
     and new.user_id <> auth.uid() then
    raise exception 'A roster row can only be linked to your own account';
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_student_identity on students;
create trigger trg_guard_student_identity
  before insert or update on students
  for each row execute function guard_roster_identity();

drop trigger if exists trg_guard_tf_identity on course_tfs;
create trigger trg_guard_tf_identity
  before insert or update on course_tfs
  for each row execute function guard_roster_identity();
