-- Joining a course by presenting a secret that NAMES it.
--
-- Run in Supabase → SQL Editor, after 0028. Safe to re-run.
--
-- ---------------------------------------------------------------------------
-- WHY THIS EXISTS.
--
-- Enrolment has always worked by the app hunting for whichever course claims
-- your address. claim_student_rows() (0006:95) searches EVERY course in the
-- database for a roster row whose email matches the caller's, and never asks
-- who owns that course. 0028 stopped a student minting a course to plant that
-- row in, which closes the hole; it does not change the shape of the thing.
-- The direction is still wrong: the database decides which course owns you,
-- from a list you cannot see, on evidence anybody who knows your address can
-- forge.
--
-- Invite codes invert it. You present a secret that names the course, and the
-- course confirms it was expecting you. A replica cannot produce Kelly's code,
-- so it cannot be presented in the first place.
--
-- TWO FACTS, NOT ONE. The code names the course; the caller's address must
-- ALSO already be on that course's roster. Kelly's imported roster stays the
-- source of truth. A code read aloud in a lecture hall WILL leak — it is
-- spoken to eighty people — and on its own it lets a stranger in; paired with
-- the roster it lets in exactly the people Kelly listed. The cost is that a
-- student whose address Kelly typed wrong gets stopped, so this file spends a
-- whole error message telling them precisely that, with the address it looked
-- for, because that is the one failure a real student will hit.
--
-- NOT courses.code. "AP50A" is the section label, printed on the student's own
-- screen (StudentApp.tsx:309). It is not and never becomes a secret.

-- ---------------------------------------------------------------------------
-- 1. THE TABLE.

create table if not exists course_invites (
  id         uuid primary key default gen_random_uuid(),
  course_id  uuid not null references courses(id) on delete cascade,
  kind       text not null check (kind in ('student', 'tf')),
  code       text not null unique,
  -- REVOKED, NOT DELETED. Kelly needs to burn a leaked code without the course
  -- noticing, and a dead row is what lets the student who copied it down last
  -- week be told "that code has been replaced" instead of "no such code" —
  -- which sends them to their instructor rather than to a typo they do not
  -- have. It also keeps the code out of circulation: `unique (code)` spans
  -- revoked rows, so a burnt code can never be re-issued by chance.
  revoked_at timestamptz,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- A separate TF code, rotatable on its own: a student code leaks by design
-- (eighty people hear it) and a TF code does not, so burning one must not
-- disturb the other. One LIVE code per course per kind — "the code for AP50A"
-- has to mean one string, or reading it aloud is ambiguous.
create unique index if not exists uniq_live_invite
  on course_invites (course_id, kind) where revoked_at is null;
create index if not exists idx_invite_course on course_invites (course_id);

-- ---------------------------------------------------------------------------
-- 2. THE CODE ITSELF.

/**
 * A fresh, unused invite code.
 *
 * ALPHABET: 23456789 plus A-Z without I, L, O or U. The excluded letters are
 * the ones that come back wrong: I/l/1 and O/0 are the pairs people mistype
 * off a phone screen, and U is dropped both because it is heard as "you" when
 * this is read out over a lecture hall mic and because dropping a vowel makes
 * an accidental rude word far less likely. Nothing folds ambiguous input back
 * in on redemption, deliberately: since a real code never CONTAINS 0, O, 1, I
 * or L, a typed one cannot be silently reinterpreted into a different valid
 * code — it just fails to match, and the person is told to check it.
 *
 * LENGTH: 8, so 30^8 ≈ 6.6e11. Short enough to say twice and type on a phone,
 * and far past guessing — see the note on brute force in join_with_code.
 *
 * gen_random_bytes rather than random(): random() is a seeded PRNG whose next
 * value is predictable from earlier ones, and the whole point of this string is
 * that it cannot be produced by anyone who was not told it. The `< 240` test is
 * rejection sampling — 256 is not a multiple of 30, so taking the modulo of
 * every byte would make the first 16 characters of the alphabet measurably
 * likelier than the last 14 and hand a guesser free entropy.
 *
 * `extensions` is on the search_path, unlike every other function in this
 * schema, because gen_random_bytes comes from pgcrypto and Supabase installs
 * pgcrypto there rather than in public — 0001's `create extension if not
 * exists` finds it already present and leaves it where it is. Without this the
 * function creates cleanly and then fails at the first insert.
 */
create or replace function new_invite_code() returns text
language plpgsql volatile set search_path = public, extensions as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKMNPQRSTVWXYZ';
  n        constant int  := 30;
  candidate text;
  b int;
begin
  for attempt in 1..20 loop
    candidate := '';
    while length(candidate) < 8 loop
      b := get_byte(gen_random_bytes(1), 0);
      if b < 240 then
        candidate := candidate || substr(alphabet, 1 + (b % n), 1);
      end if;
    end loop;
    if not exists (select 1 from course_invites i where i.code = candidate) then
      return candidate;
    end if;
  end loop;
  -- Unreachable short of the table holding a meaningful fraction of 6.6e11
  -- rows. Loud rather than looping forever if it ever is.
  raise exception 'Could not find an unused invite code';
end $$;

/**
 * What the person actually typed, reduced to what we stored.
 *
 * Codes get written on a whiteboard in groups, so spaces and hyphens arrive
 * with them, and phone keyboards capitalise unpredictably. Everything outside
 * A-Z0-9 goes and the rest is upper-cased; nothing else is rewritten.
 */
create or replace function normalise_invite_code(raw text) returns text
language sql immutable set search_path = public as $$
  select upper(regexp_replace(coalesce(raw, ''), '[^A-Za-z0-9]', '', 'g'));
$$;

/**
 * The code is minted here, never sent in.
 *
 * The client inserts {course_id, kind} and this overwrites whatever else
 * arrived. A DEFAULT would not do: a default is only a suggestion, and the
 * anon key can post any column it likes, so an owner — or anyone who ever
 * borrows an owner's session — could set their course's code to AAAAAAAA and
 * quietly undo every bit of the entropy above.
 */
create or replace function guard_invite_code() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.code := new_invite_code();
    return new;
  end if;

  if new.code is distinct from old.code
     or new.course_id is distinct from old.course_id
     or new.kind is distinct from old.kind then
    raise exception 'A code cannot be edited. Rotate it instead — the old one stays on file as revoked.';
  end if;

  -- Un-revoking would put a string somebody already leaked back into service,
  -- and the whole reason it is on file is that it is dead.
  if old.revoked_at is not null and new.revoked_at is null then
    raise exception 'A revoked code stays revoked. Rotate to issue a new one.';
  end if;

  return new;
end $$;

drop trigger if exists trg_guard_invite_code on course_invites;
create trigger trg_guard_invite_code
  before insert or update on course_invites
  for each row execute function guard_invite_code();

-- ---------------------------------------------------------------------------
-- 3. WHO MAY SEE A CODE.

alter table course_invites enable row level security;

-- The owner manages their own course's codes, and that is the ONLY policy on
-- this table. There is deliberately no student or TF read: a student who could
-- select here would read every live code in the database, which is the entire
-- secret this table exists to keep — and "the UI never shows it" is not a
-- control when anyone can call supabase.from('course_invites') from a console.
--
-- Which is what forces redemption into join_with_code() below. A code you must
-- be able to REDEEM but must never be able to READ cannot be checked by a
-- policy, because a policy can only work by letting you see the row. It has to
-- be a security definer function that looks at the code on your behalf and
-- tells you nothing except whether it worked.
drop policy if exists "own course_invites" on course_invites;
create policy "own course_invites" on course_invites
  for all to authenticated
  using (owns_course(course_id)) with check (owns_course(course_id));

grant select, insert, update, delete on course_invites to authenticated;

-- ---------------------------------------------------------------------------
-- 4. REDEEMING ONE.

/**
 * Join a course by presenting its code. The only way in.
 *
 * Two facts have to line up: the code names a live invite, and the CALLER'S OWN
 * address is on that course's roster. Neither alone is enough, and the failure
 * messages keep them apart — "no course uses that code" and "you have the right
 * course but you are not on its roster" send a person to two different places,
 * and collapsing them into one polite refusal would strand the student whose
 * address was typed wrong.
 *
 * NO USER-ID PARAMETER, and there never will be one. The only account this can
 * enrol is auth.uid(), so there is nothing here to point at somebody else — the
 * signature itself is the guarantee, not a check inside that could be missed on
 * a later edit.
 *
 * Security definer because it has to read course_invites, which nobody but the
 * owner may read, and auth.users, which nobody may read at all. It returns the
 * course it enrolled you in and nothing else; a wrong code learns nothing about
 * which courses exist.
 *
 * IDEMPOTENT. Redeeming twice, or redeeming when you are already on the roster
 * of that course, returns the same answer rather than erroring — the button
 * will get double-tapped on a phone, and a retry after a dropped connection
 * must not look like a failure.
 *
 * BRUTE FORCE. Rate limiting is out of scope here, and does not carry the
 * weight anyway. What stops guessing is the two facts: 6.6e11 codes means a
 * guesser who managed a thousand attempts a second would average twenty years
 * per hit, and a hit is still worth nothing to them, because the roster check
 * then asks for an address the instructor already imported. Someone whose
 * address IS on the roster is a student who is meant to be there. If we ever do
 * want a brake, this function is the single chokepoint to put it in.
 */
create or replace function join_with_code(code text)
returns table (course_id uuid, course_name text, course_code text, kind text)
language plpgsql security definer set search_path = public as $$
declare
  wanted text := normalise_invite_code(code);
  inv    course_invites;
  crs    courses;
  me     text;
  took   int;
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

  select lower(btrim(u.email)) into me from auth.users u where u.id = auth.uid();
  if me is null or me = '' then
    raise exception 'Your account has no email address, so there is nothing to match against the roster';
  end if;

  if inv.kind = 'student' then
    -- Already on it: nothing to do, and saying so is the same answer as having
    -- just joined. uniq_student_user_course would refuse a second row anyway,
    -- and an error is the wrong thing to show someone who is where they wanted
    -- to be.
    if not exists (
      select 1 from students s
       where s.course_id = inv.course_id and s.user_id = auth.uid())
    then
      -- One row, oldest first. A roster can carry the same address twice (an
      -- import run against a corrected spreadsheet), and claiming both would
      -- trip uniq_student_user_course, roll the statement back, and leave the
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
        raise exception 'That code is for %, but % is not on its roster. Ask your instructor to add that address, or to fix the one they have for you.',
          coalesce(crs.name, 'that course'), me;
      end if;
    end if;

  elsif inv.kind = 'tf' then
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
        raise exception 'That is the teaching fellow code for %, but % is not listed as a TF on it. Ask the instructor to add that address.',
          coalesce(crs.name, 'that course'), me;
      end if;
    end if;

  else
    raise exception 'That code is not one this app understands';
  end if;

  return query select inv.course_id, crs.name, crs.code, inv.kind;
end $$;

-- anon must not be able to try codes at all, and PUBLIC gets EXECUTE on a new
-- function by default.
revoke all on function join_with_code(text) from public;
grant execute on function join_with_code(text) to authenticated;

/**
 * Burn the live code for one course and kind, and issue its replacement.
 *
 * One call rather than the client doing revoke-then-insert, because between
 * those two statements the course has no code at all — and if the second half
 * fails, or the phone loses signal, it stays that way with nobody aware.
 *
 * Security INVOKER: the "own course_invites" policy is the authority on who may
 * do this, and duplicating that rule inside a definer function would give the
 * question two answers that could drift. The owns_course() test is only here so
 * the refusal reads like a sentence instead of an RLS error.
 */
create or replace function rotate_invite_code(cid uuid, invite_kind text)
returns course_invites
language plpgsql security invoker set search_path = public as $$
declare fresh course_invites;
begin
  if invite_kind not in ('student', 'tf') then
    raise exception 'A code is either a student code or a TF code';
  end if;
  if not owns_course(cid) then
    raise exception 'That is not your course';
  end if;

  update course_invites set revoked_at = now()
   where course_id = cid and kind = invite_kind and revoked_at is null;

  insert into course_invites (course_id, kind) values (cid, invite_kind)
  returning * into fresh;

  return fresh;
end $$;

revoke all on function rotate_invite_code(uuid, text) from public;
grant execute on function rotate_invite_code(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. RETIRING claim_student_rows() AND claim_tf_rows().
--
-- This is the actual fix. Without it the codes are decorative: the email sweep
-- runs on every sign-in and would keep enrolling people in whatever course
-- happens to carry their address, so nobody would ever need to present a code
-- and presenting one would prove nothing.
--
-- The sweep is the vulnerability itself, not a thing near it. It searched every
-- course in the database for a row matching the caller's address and never
-- asked who owned that course, so anybody who could stand up a replica of AP50A
-- could plant a classmate's address on it and collect their work.
--
-- EMPTIED, NOT DROPPED. studentData.ts:51 and facultyData.ts:1016 call these by
-- name, and app/ck/page.tsx calls them on every sign-in. Dropping the functions
-- turns that into "function does not exist" for every account in the app —
-- including Kelly's — the moment this runs and before any deploy could catch
-- up. A migration must not be the half of a change that breaks things. They
-- return 0 now, which is exactly what a person with nothing to claim always
-- got, so every caller already handles it. The calls are being removed from the
-- client separately; until that ships they are a wasted round trip and nothing
-- else.
--
-- NOBODY IS UNENROLLED. These only ever wrote user_id where it was null.
-- Emptying them changes which UNCLAIMED rows can be taken; it cannot touch a
-- row that is already claimed, so every student enrolled today stays enrolled
-- and Kelly's own sign-in is untouched.
--
-- WHAT CHANGES FOR A NEW STUDENT: being on the roster is no longer enough on
-- its own. They need the code as well. That is the point — the roster says who
-- MAY be in the course, the code proves they were told to be.

create or replace function claim_student_rows() returns int
language sql security definer set search_path = public as $$
  select 0;
$$;

create or replace function claim_tf_rows() returns int
language sql security definer set search_path = public as $$
  select 0;
$$;

grant execute on function claim_student_rows() to authenticated;
grant execute on function claim_tf_rows() to authenticated;

-- ---------------------------------------------------------------------------
-- 6. BACKFILL.
--
-- Every course that exists gets both codes, so no course is left in a state
-- where the only way in is the sweep above. Keyed on "has no LIVE code of this
-- kind", which makes a re-run a no-op and, just as importantly, makes it safe
-- to re-run after a rotation — it will not undo Kelly's fresh code by handing
-- the course a second one.
insert into course_invites (course_id, kind)
select c.id, k.kind
  from courses c
 cross join (values ('student'), ('tf')) as k(kind)
 where not exists (
   select 1 from course_invites i
    where i.course_id = c.id and i.kind = k.kind and i.revoked_at is null);

-- To read the codes for a course:
--   select c.name, c.code as section, i.kind, i.code
--     from course_invites i join courses c on c.id = i.course_id
--    where i.revoked_at is null order by c.name, i.kind;
