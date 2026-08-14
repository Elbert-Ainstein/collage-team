-- Stop any signed-in account from minting a course, and from writing somebody
-- else's user id onto a roster row.
--
-- Run in Supabase → SQL Editor, after 0027. Safe to re-run.
--
-- ---------------------------------------------------------------------------
-- WHAT WAS WRONG.
--
-- "own courses" (0003:43) was `for all to authenticated` with
-- `with check (owner_id = auth.uid())`. That check constrains WHO owns the new
-- row and nothing else — so every authenticated account, including every
-- student, could create a course. owner_id even fills itself in (0005:16).
--
-- On its own that is litter. Chained with two other things it is an
-- interception:
--
--   1. "own students" (0003:51) authorises a roster write purely on owning the
--      course. Nothing anywhere names students.user_id or students.email, and
--      there is no trigger on students — so the owner of ANY course may write a
--      row carrying any address and any user id.
--   2. claim_student_rows() (0006:95) matches on email alone and never asks who
--      owns the course. Its `distinct on (c.course_id)` takes one row PER
--      COURSE, so a planted row is claimed IN ADDITION to the real one.
--   3. getEnrolment (studentData.ts:79) then breaks the tie with
--      `order("created_at").limit(1)` — oldest wins — and created_at is
--      whatever the client sent.
--
-- So: a student creates "Applied Physics 50 / AP50A" (the strings ensureSessions
-- itself uses), plants a row with a classmate's address and a backdated
-- created_at, and that classmate signs in to a course that looks exactly like
-- this one and is owned by a fellow student. Their written answers, PDFs, audio
-- and whiteboard photos are written into it, and the owner reads all of it.
-- Nothing on their screen differs. The real gradebook is never written, so the
-- work simply never arrives.
--
-- The same defect aimed at staff: plant a row carrying the INSTRUCTOR's user id
-- and app/ck/page.tsx routes them into a student or TF view of the attacker's
-- course, with no way back from inside the app.
--
-- Note this was never about roles. profiles.role is self-assigned — 0024's
-- set_my_role lets any account call itself faculty — and it grants nothing,
-- because every policy tests OWNERSHIP. This is the layer underneath that.
--
-- ---------------------------------------------------------------------------
-- 1. WHO MAY CREATE A COURSE.
--
-- An allow-list of ADDRESSES. Seeded from whoever already owns a course, so
-- nothing that works today stops working — ensureSessions included, which is
-- what creates AP50A and AP50B on a first sign-in. Everybody else is refused.
--
-- Addresses rather than accounts because the people this course belongs to do
-- not have accounts yet. An instructor is authorised weeks before she first
-- signs in, and a list you could only add somebody to AFTER they signed up
-- would make her first visit the broken one.

-- Keyed on EMAIL, not on a user id. The people who will run this course do not
-- have accounts yet — an instructor is authorised weeks before she first signs
-- in — and a list you can only add somebody to AFTER they have signed up would
-- mean her first visit is a broken one.
create table if not exists course_creators (
  email      text primary key,
  note       text,
  created_at timestamptz not null default now()
);

-- Stored lowercase so the check does not turn on how somebody typed their
-- address into the sign-up form.
create or replace function normalise_creator_email() returns trigger
language plpgsql set search_path = public as $$
begin
  new.email := lower(btrim(new.email));
  if new.email = '' then raise exception 'A creator needs an email'; end if;
  return new;
end $$;

drop trigger if exists trg_normalise_creator_email on course_creators;
create trigger trg_normalise_creator_email
  before insert or update on course_creators
  for each row execute function normalise_creator_email();

alter table course_creators enable row level security;

-- Deliberately NO POLICY AT ALL. With RLS on and nothing granting access, the
-- anon key can neither read nor write this table — an allow-list the app can
-- add itself to would not be one, and there is no reason for a browser to know
-- who is on it. The only consumer is may_make_courses() below, which is
-- security definer and so reads it regardless.
drop policy if exists "read own creator row" on course_creators;

/**
 * May the caller stand up a course?
 *
 * Security definer because the policy has to read auth.users to learn the
 * caller's address, and an ordinary policy predicate may not. It answers only
 * yes or no about the CALLER — it takes no argument, so there is nothing to
 * point at somebody else.
 */
create or replace function may_make_courses() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from course_creators cc
      join auth.users u on lower(u.email) = cc.email
     where u.id = auth.uid());
$$;

grant execute on function may_make_courses() to authenticated;

-- Everyone who already owns a course keeps the right to make another. Runs
-- before the new policy exists, so it cannot lock the real instructor out, and
-- `on conflict do nothing` makes a re-run a no-op.
insert into course_creators (email, note)
select distinct lower(u.email), 'owned a course before 0028'
  from courses c join auth.users u on u.id = c.owner_id
 where c.owner_id is not null and u.email is not null
on conflict (email) do nothing;

-- ADD THE PEOPLE WHO WILL ACTUALLY RUN THE COURSE. They do not need accounts
-- yet; the address is enough, and it starts working the moment they sign up
-- with it. Edit this list and re-run the file, or insert straight into the
-- table — both are the same deliberate act in the SQL editor, which is the
-- right weight for "this person may stand up a course".
-- Uncomment, put the real addresses in, and run:
--
-- insert into course_creators (email, note) values
--   ('kelly@fas.harvard.edu', 'AP 50 instructor'),
--   ('headtf@fas.harvard.edu', 'AP 50 head TF')
-- on conflict (email) do nothing;
--
-- To see who is on the list:   select email, note from course_creators;
-- To take somebody off:        delete from course_creators where email = '...';
-- Removing somebody does NOT touch the courses they already own; it only stops
-- them starting new ones.

-- 0003's single FOR ALL policy has to be split: INSERT is the only verb that
-- needs the extra test, and folding it into the others would stop an instructor
-- reading a course they already own.
drop policy if exists "own courses" on courses;

drop policy if exists "read own courses" on courses;
create policy "read own courses" on courses
  for select to authenticated using (owner_id = auth.uid());

drop policy if exists "change own courses" on courses;
create policy "change own courses" on courses
  for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "drop own courses" on courses;
create policy "drop own courses" on courses
  for delete to authenticated using (owner_id = auth.uid());

drop policy if exists "make a course if allowed" on courses;
create policy "make a course if allowed" on courses
  for insert to authenticated
  with check (
    owner_id = auth.uid()
    and may_make_courses()
  );

-- ---------------------------------------------------------------------------
-- 2. A ROSTER ROW MAY ONLY EVER NAME THE CALLER.
--
-- Defence in depth, and the thing that closes the lock-out on its own: the
-- allow-list stops a student owning a course, but an owner could still write
-- another person's user id onto a row and hijack where that person's app sends
-- them.
--
-- The rule is narrow enough to leave every real path alone. claim_student_rows
-- and claim_tf_rows both set user_id = auth.uid(), which this permits. Nothing
-- else in the app writes the column at all — the faculty roster screens write
-- name and email and leave user_id to the claim. So the only thing this refuses
-- is writing SOMEBODY ELSE's id, which no legitimate path has ever done.
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
