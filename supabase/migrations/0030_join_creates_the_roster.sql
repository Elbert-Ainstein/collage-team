-- The roster is what joining PRODUCES, not what it checks.
--
-- Run in Supabase → SQL Editor, after 0029. Safe to re-run.
--
-- ---------------------------------------------------------------------------
-- WHY THIS EXISTS.
--
-- 0029 made joining mean presenting a code that names the course, and then
-- asked for a second fact: the caller's address had to ALREADY be on that
-- course's roster, imported by the instructor. That is the half of 0029 this
-- file removes. Kelly does not have a spreadsheet of eighty addresses before
-- term starts — she has a code she can read out in the first lecture. Making
-- the import a precondition means the app cannot be used until she has done a
-- chore nobody asked her to do, and the one failure it produces in practice is
-- a real student, holding a real code, refused because their address was typed
-- wrong or they enrolled late.
--
-- So the direction inverts again: the student supplies their own name and
-- address at sign-up, presents the code, and the roster row APPEARS. Kelly
-- watches the roster fill in rather than typing it in.
--
-- WHAT IS NOT LOST. The code is still the only way in, and it still names its
-- course — nothing here restores the 0006 email sweep that let the database
-- decide which course owned you. What is gone is the second fact, and with it
-- 0029's long "you have the right course but you are not on its roster"
-- refusal, which no student can now hit.
--
-- IMPORTING STILL WORKS. Kelly may still paste a roster, and some instructors
-- will. So a student whose address is already sitting on an unclaimed row must
-- end up ON that row rather than beside it — otherwise she gets eighty rows she
-- typed and eighty more that joined, and every team she built points at the
-- wrong half. That is step 2 below, and it is why the create is the last resort
-- and not the first move.
--
-- ---------------------------------------------------------------------------
-- THE TF CODE DOES NOT WORK THIS WAY, ON PURPOSE.
--
-- A TF code stays CLAIM-ONLY: Kelly must have entered that address first, and
-- redeeming a TF code with an address she never listed is refused exactly as it
-- was in 0029.
--
-- This asymmetry is deliberate and it is not an oversight to be tidied up. The
-- two codes buy different things. A student code buys you a seat: you can see
-- your own work and your own team, and the worst a stranger who redeems one can
-- do is occupy a row. A TF code buys you eighty other people's work — grading,
-- check-ins, the whole gradebook (0007, 0010). A code that is read aloud, put
-- on a slide, or glanced at over a shoulder WILL travel; that is survivable for
-- a seat and not survivable for a grader. Requiring the address means the leak
-- alone is not enough — the holder also has to be somebody Kelly named, and
-- naming four TFs is a chore she actually has.
--
-- If you are here because the inconsistency bothers you: the inconsistency is
-- the feature. Make the TF path create rows and anyone holding that string
-- becomes staff.
--
-- ---------------------------------------------------------------------------
-- WHAT STOPS ABUSE NOW, SINCE IT IS NO LONGER THE ROSTER.
--
-- TWO IDENTITIES, ONE ACCOUNT: uniq_student_user_course (0006:82) is unique on
-- (course_id, user_id), so one account gets at most one row per course however
-- many times it redeems. What that index does NOT stop is one PERSON with two
-- email accounts holding two seats. Nothing here can — the app has never had
-- any notion of a person apart from an account, and inventing one to guard a
-- seat that carries no privilege would be the wrong trade.
--
-- A CODE POSTED PUBLICLY: assume it happens. There is no rate limit in this
-- function and no useful one to add — the join is a single call per account and
-- an attacker with a thousand accounts is not making a thousand calls with one.
-- The real brakes are these, in order of how much work they are for Kelly:
--   * Each junk row costs a distinct, confirmable email account, because the
--     row is keyed to auth.uid() and the address is read from auth.users, not
--     from anything the caller types here. A hundred rows is a hundred
--     mailboxes, not a hundred POSTs.
--   * A junk row is inert. It can read its own work and its own team, and it
--     has no team until Kelly puts it in one.
--   * rotate_invite_code(course, 'student') ends the flood in one click and
--     costs the real students nothing but a new string read out once. That is
--     the actual recourse, and it is why 0029 built rotation before anyone
--     needed it.
--   * Kelly deletes the rows. They are visibly junk: created_at clusters, and
--     the address is the account's real one, so the same person twice is the
--     same address twice.
-- The honest summary is that a student code is a revocable convenience, not a
-- secret, and this file treats it as one.
--
-- KELLY REDEEMING HER OWN CODE: she gets a roster row in her own course, which
-- is a thing instructors do deliberately to see the student view. app/ck's
-- routing already asks whether the enrolment is on a course you do NOT own, so
-- it does not throw her out of her gradebook.
--
-- ---------------------------------------------------------------------------
-- THE 0028 TRIGGER FIRES ON THIS INSERT, AND PASSES.
--
-- guard_roster_identity (0028:87) is BEFORE INSERT OR UPDATE on students and
-- refuses any row whose user_id is neither null nor auth.uid(). The insert
-- below sets user_id = auth.uid() literally, so the INSERT branch's test
-- (`new.user_id <> auth.uid()`) is false and the row goes through.
--
-- The thing worth stating, because it looks wrong at a glance: auth.uid() means
-- the same thing on both sides even though this function is SECURITY DEFINER.
-- Definer changes the ROLE the statement runs as; auth.uid() reads the request
-- JWT out of a GUC that PostgREST sets per request, and neither the role switch
-- nor the trigger's own definer context disturbs it. So the row names the
-- caller, and the guard agrees it names the caller.
--
-- ---------------------------------------------------------------------------
-- avatar_tint IS LEFT NULL, DELIBERATELY.
--
-- Null does not mean "no colour" anywhere in this app: ui.tsx:24 and
-- icons.tsx's FAvatar both do `tint || tintFor(name)`, and StudentApp.tsx:37
-- does it again by hand. Null means "derive it from the name", and that is
-- exactly what we want for a row whose name we are also deriving.
--
-- Writing one here would mean reimplementing tintFor()'s hash and palette
-- (data.ts:22) in plpgsql, where it would silently drift from the TS the first
-- time somebody adds a colour — and it would freeze a colour computed from a
-- placeholder name, so fixing the name later would leave the wrong avatar.
-- Kelly's imported rows carry a stored tint only because the client had the
-- function to hand; that is not a convention worth matching from SQL.

create or replace function join_with_code(code text)
returns table (course_id uuid, course_name text, course_code text, kind text)
language plpgsql security definer set search_path = public as $$
declare
  wanted   text := normalise_invite_code(code);
  inv      course_invites;
  crs      courses;
  me       text;
  took     int;
  who      text;
  next_pos int;
begin
  if auth.uid() is null then
    raise exception 'Sign in first, then enter your code';
  end if;

  select * into inv from course_invites i where i.code = wanted;
  if not found then
    raise exception 'No course uses that code. Check it for typos, or ask for it again.';
  end if;
  if inv.revoked_at is not null then
    raise exception 'That code has been replaced. Ask for the current one.';
  end if;

  select * into crs from courses c where c.id = inv.course_id;

  -- Still required, and now for a second reason: the address is what the new
  -- row carries and what any later import has to match against, so a row
  -- without one is a row Kelly can never reconcile.
  select lower(btrim(u.email)) into me from auth.users u where u.id = auth.uid();
  if me is null or me = '' then
    raise exception 'Your account has no email address, so there is nothing to put on the roster';
  end if;

  if inv.kind = 'student' then
    -- 1. ALREADY IN. Somebody re-entering a code they used last week is where
    -- they wanted to be, and an error is the wrong thing to show them.
    if not exists (
      select 1 from students s
       where s.course_id = inv.course_id and s.user_id = auth.uid())
    then
      -- 2. CLAIM AN IMPORTED ROW, if Kelly did import one. One row, oldest
      -- first: a roster can carry the same address twice (an import re-run
      -- against a corrected spreadsheet), and claiming both would trip
      -- uniq_student_user_course, roll the statement back, and leave the
      -- student enrolled on nothing.
      update students s
         set user_id = auth.uid()
       where s.id = (
         select s2.id from students s2
          where s2.course_id = inv.course_id
            and s2.user_id is null
            and s2.email is not null
            and lower(btrim(s2.email)) = me
          order by s2.created_at, s2.id
          limit 1);
      get diagnostics took = row_count;

      if took = 0 then
        -- 3. NOTHING TO CLAIM, SO MAKE THE ROW. This is the ordinary path now;
        -- steps 1 and 2 are the exceptions.

        -- NAME. profiles.full_name is what the sign-up form collects and what
        -- handle_new_user() (0006:49) already copies out of the sign-up
        -- metadata, so no new column and no new parameter — a name that
        -- arrived as a function argument could be anyone's.
        select nullif(btrim(p.full_name), '') into who
          from profiles p where p.id = auth.uid();

        -- FALLBACK, because name is NOT NULL and an account made before the
        -- sign-up form asked for a name has none. The address, not 'Student':
        -- eight rows reading 'Student' tell Kelly nothing and she has no rename
        -- in the app, whereas an address identifies the person, sorts sanely,
        -- and is obviously a placeholder — nobody is called jdoe@harvard.edu —
        -- so it gets fixed instead of quietly accepted. The chain cannot fall
        -- through: a caller with no address was already refused above.
        who := coalesce(who, me);

        -- POSITION. The end of this course's roster, matching what the faculty
        -- app computes when Kelly adds someone (TeamsScreen.tsx:92, the same
        -- max+1 with the same -1 seed) so an empty roster starts at 0 rather
        -- than at 1. Two students joining in the same second can land on the
        -- same number; that is a cosmetic tie, not a constraint, and listStudents
        -- (data.ts:293) already breaks it on created_at. Locking the roster to
        -- serialise a display order would be the more expensive mistake.
        select coalesce(max(s.position), -1) + 1 into next_pos
          from students s where s.course_id = inv.course_id;

        -- The stored address is the normalised one, so the next import Kelly
        -- runs matches it on the same terms step 2 matches on.
        --
        -- ON CONFLICT DO NOTHING covers the double-tapped button: two calls in
        -- flight at once both pass the step-1 check, and the second insert would
        -- otherwise raise. Untargeted because uniq_student_user_course is the
        -- only unique index on this table, so there is no other conflict this
        -- could be swallowing — and naming it would put `course_id` in an
        -- inference clause, where plpgsql resolves it against this function's
        -- own OUT parameter of that name.
        insert into students (course_id, user_id, name, email, position)
        values (inv.course_id, auth.uid(), who, me, next_pos)
        on conflict do nothing;
      end if;
    end if;

  elsif inv.kind = 'tf' then
    -- Symmetric with the student path, by decision: the instructor should not
    -- have to type a TF's address before they can join. Claim an existing row
    -- first so somebody she DID enter ends up on one row rather than two, then
    -- create.
    --
    -- Worth being clear-eyed about what this code now is. A student code buys a
    -- seat; this one buys the gradebook — whoever redeems it can read all
    -- eighty submissions and change every mark. Removal is cleanup, not
    -- prevention: taking somebody off afterwards does not un-read the work or
    -- restore the grades. The control that actually closes it is
    -- rotate_invite_code(course, 'tf') once the real TFs are through, which
    -- takes one press and leaves nothing live in a chat log.
    if not exists (
      select 1 from course_tfs t
       where t.course_id = inv.course_id and t.user_id = auth.uid())
    then
      update course_tfs t
         set user_id = auth.uid()
       where t.id = (
         select t2.id from course_tfs t2
          where t2.course_id = inv.course_id
            and t2.user_id is null
            and t2.email is not null
            and lower(btrim(t2.email)) = me
          order by t2.created_at, t2.id
          limit 1);
      get diagnostics took = row_count;

      if took = 0 then
        insert into course_tfs (course_id, name, email, user_id, position)
        values (
          inv.course_id,
          coalesce(nullif(btrim((select p.full_name from profiles p where p.id = auth.uid())), ''), me),
          me,
          auth.uid(),
          coalesce((select max(t3.position) from course_tfs t3 where t3.course_id = inv.course_id), -1) + 1
        )
        on conflict do nothing;
      end if;
    end if;

  else
    raise exception 'That code is not one this app understands';
  end if;

  return query select inv.course_id, crs.name, crs.code, inv.kind;
end $$;

-- CREATE OR REPLACE keeps the existing grants, so these two lines change
-- nothing today. They are here because they are the only thing standing between
-- anon and an unlimited supply of code guesses, and a future edit that has to
-- DROP this function (any change to the returned columns does) would otherwise
-- hand PUBLIC the default EXECUTE and nobody would notice.
revoke all on function join_with_code(text) from public;
grant execute on function join_with_code(text) to authenticated;
