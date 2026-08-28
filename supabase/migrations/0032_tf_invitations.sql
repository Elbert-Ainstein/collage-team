-- An invitation somebody ACCEPTS, instead of an address the database acts on.
--
-- Run in Supabase → SQL Editor, after 0031. Safe to re-run.
--
-- ---------------------------------------------------------------------------
-- WHAT BROKE.
--
-- Kelly can type a teaching fellow's address into course_tfs and always could.
-- Before 0029, claim_tf_rows() (0007:176) ran on every sign-in and linked that
-- row to whoever turned up holding the address, so typing it in WAS the invite.
-- 0029 emptied that function, and for a good reason: it searched every course
-- in the database for a row matching the caller's address and never asked who
-- owned the course, so anybody able to stand up a replica of AP50A could plant
-- a classmate's address on it and collect that person's work.
--
-- What went with it was the only path in for a TF added by hand. The TF code
-- remains, but a person Kelly typed into the list and never sent a code to is
-- now stuck for good: they sign in, they are on nobody's roster, and the one
-- box on screen wants a string nobody has given them.
--
-- This file gives that person the missing half. NOT by restoring the sweep —
-- routing an account into a course because a row somewhere carries its address
-- is the exact shape of the hole 0029 filled in. The difference is who acts:
--
--   * The sweep acted on the row. Sign in, and the database decided which
--     courses owned you, from a list you could not see, on evidence anybody
--     who knew your address could forge.
--   * An invitation is shown to you and does nothing until you press Accept.
--     The forged row is still forgeable — anyone may make a course and type
--     any address on its TF list — but now it can only ever produce an offer
--     from a named instructor on a named course, which the person reads and
--     refuses. Nothing happens behind their back.
--
-- SECURITY DEFINER IS NOT OPTIONAL HERE. course_tfs has two policies (0007:243)
-- — the owner sees the whole list, a TF sees the row that already names them —
-- and someone who has not accepted yet is neither. That is correct and stays
-- correct: a read policy wide enough to show them their pending row would be a
-- policy wide enough to ask "is this address on that course's TF list?" about
-- anybody. So the listing happens inside a definer function that answers only
-- about the CALLER'S OWN address and returns nothing else.
--
-- NEITHER FUNCTION TAKES A USER ID, and neither ever will. Every one of them
-- reads auth.uid() and the address on auth.users, so there is nothing in the
-- signature to point at somebody else — the same guarantee join_with_code
-- makes, made the same way, because a check inside a body is a check a later
-- edit can drop.

-- ---------------------------------------------------------------------------
-- 1. SAYING NO, AND HAVING IT STICK.
--
-- Declining must not touch Kelly's row. She typed that address for a reason and
-- it is her list; a decline is a fact about the person invited, not an edit to
-- the roster, and the two want different owners. So it is recorded beside the
-- row, keyed to the account that said no.
--
-- It is also NOT a revocation. Somebody who declines by reflex and then hears
-- from Kelly in the corridor can still join with the TF code, which is
-- unaffected by anything here. All this stops is the asking.

create table if not exists tf_invitation_declines (
  course_tf_id uuid not null references course_tfs(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  declined_at  timestamptz not null default now(),
  primary key (course_tf_id, user_id)
);

alter table tf_invitation_declines enable row level security;

-- The instructor reads it, so a row she is waiting on can say it is not coming
-- rather than sitting on "not accepted yet" forever. Nobody writes through a
-- policy: there is no insert grant at all below, so the only way a row lands
-- here is decline_tf_invitation(), which has checked whose address it is.
drop policy if exists "owner reads tf declines" on tf_invitation_declines;
create policy "owner reads tf declines" on tf_invitation_declines
  for select to authenticated
  using (exists (
    select 1 from course_tfs t
     where t.id = tf_invitation_declines.course_tf_id
       and owns_course(t.course_id)));

grant select on tf_invitation_declines to authenticated;

-- ---------------------------------------------------------------------------
-- 2. WHAT IS WAITING FOR ME.

/**
 * The pending TF invitations addressed to the CALLER, and nothing else.
 *
 * One question, asked about one address: the one on the caller's own row in
 * auth.users. It cannot be asked about anybody else's, which is the whole
 * reason it is allowed to read a table nobody may select from — knowing whether
 * an address is on somebody's TF list is not public, and a function that took
 * the address as an argument would make it public to anyone with a login.
 *
 * Returns silently rather than raising when there is no session or no address:
 * this runs on the sign-in screen of somebody who may have nothing waiting for
 * them at all, and "nothing waiting" is the ordinary answer, not a failure.
 *
 * WHO INVITED YOU is the load-bearing half. "You have been invited to a course"
 * is not enough to accept or refuse on — the instructor's name is what tells
 * the person this is the AP50 they were emailed about and not a course somebody
 * typed their address into. profiles is readable only by its owner (0006:29),
 * so it takes the definer context to read Kelly's name at all. The fallback is
 * her ADDRESS rather than a blank: an offer nobody has signed cannot be judged,
 * and the account making it is a thing she chose to put in front of them by
 * naming them on her list.
 *
 * ONE PER COURSE. A TF list can carry the same address twice — an import run
 * again against a corrected file — and two identical cards offering the same
 * course is a puzzle, not a choice. Oldest first, matching how join_with_code
 * picks among duplicates, so both paths claim the same row.
 *
 * A COURSE YOU ALREADY WORK ON drops out too: the second row is a duplicate
 * Kelly made, uniq_tf_user_course would refuse it, and there is nothing to
 * offer somebody who is already in.
 */
create or replace function my_tf_invitations()
returns table (
  invitation_id uuid,
  course_id     uuid,
  course_name   text,
  course_code   text,
  invited_by    text,
  invited_at    timestamptz
)
language plpgsql stable security definer set search_path = public as $$
declare me text;
begin
  if auth.uid() is null then
    return;
  end if;

  select lower(btrim(u.email)) into me from auth.users u where u.id = auth.uid();
  if me is null or me = '' then
    return;
  end if;

  return query
  select distinct on (t.course_id)
         t.id,
         t.course_id,
         c.name,
         c.code,
         coalesce(nullif(btrim(p.full_name), ''), inviter.email::text),
         t.created_at
    from course_tfs t
    join courses c on c.id = t.course_id
    left join profiles p on p.id = c.owner_id
    left join auth.users inviter on inviter.id = c.owner_id
   where t.user_id is null
     and t.email is not null
     and lower(btrim(t.email)) = me
     -- Her own address on her own list is a thing instructors do; offering her
     -- an invitation from herself is not an answer to it. IS DISTINCT FROM,
     -- because owner_id is nullable and `null <> uid` is null — which would
     -- silently swallow the invitation instead of showing it.
     and c.owner_id is distinct from auth.uid()
     and not exists (
       select 1 from tf_invitation_declines d
        where d.course_tf_id = t.id and d.user_id = auth.uid())
     and not exists (
       select 1 from course_tfs mine
        where mine.course_id = t.course_id and mine.user_id = auth.uid())
   order by t.course_id, t.created_at, t.id;
end $$;

-- ---------------------------------------------------------------------------
-- 3. ACCEPTING.

/**
 * Take the invitation with this id, if it is in fact addressed to you.
 *
 * THE ID IS NOT THE AUTHORITY. It arrives from the client and the client got it
 * from the listing above, but a uuid is a thing that can be typed a second time
 * — after Kelly deleted that row and made a new one for somebody else, or by
 * anyone who ever saw it. So the address is re-read from auth.users and checked
 * against the row here, on the same terms the listing matched it on. The id
 * says WHICH invitation; auth.uid() says who is accepting; only the pair gets
 * anybody onto a roster.
 *
 * The refusal names the caller's address on purpose. The one person who will
 * ever hit it in practice is somebody signed into the wrong account of the two
 * they have, and the address is what tells them that.
 *
 * THE 0028 TRIGGER FIRES ON THIS UPDATE, AND PASSES. guard_roster_identity
 * (0028:87) is BEFORE INSERT OR UPDATE on course_tfs and refuses any user_id
 * that is neither null nor auth.uid(); the update below writes auth.uid()
 * literally, so its test (`new.user_id <> auth.uid()`) is false. The part worth
 * stating because it looks wrong: auth.uid() means the same thing on both sides
 * even though both functions are SECURITY DEFINER. Definer changes the ROLE a
 * statement runs as, while auth.uid() reads the request JWT out of a GUC that
 * PostgREST sets per request — neither the role switch nor the trigger's own
 * definer context disturbs it. So the row names the caller, and the guard
 * agrees that it names the caller.
 *
 * IDEMPOTENT, and it returns the course either way. A double-tapped Accept on a
 * phone, or a retry after the answer was lost on the way back, is the same
 * event to the person pressing it.
 *
 * Returns the same four columns as join_with_code so the client has one shape
 * for "you are now on this course, by whichever door".
 */
create or replace function accept_tf_invitation(invitation_id uuid)
returns table (course_id uuid, course_name text, course_code text, kind text)
language plpgsql security definer set search_path = public as $$
declare
  tf  course_tfs;
  crs courses;
  me  text;
begin
  if auth.uid() is null then
    raise exception 'Sign in first, then accept the invitation';
  end if;

  select lower(btrim(u.email)) into me from auth.users u where u.id = auth.uid();
  if me is null or me = '' then
    raise exception 'Your account has no email address, so there is no invitation to match it to';
  end if;

  select * into tf from course_tfs t where t.id = invitation_id;
  -- Gone and not-yours get the same sentence, because telling them apart would
  -- answer "is that id a real invitation?" for somebody holding an id that was
  -- never theirs.
  if not found or tf.email is null or lower(btrim(tf.email)) <> me then
    raise exception 'That invitation is not for %. Ask whoever added you to send it again.', me;
  end if;

  select * into crs from courses c where c.id = tf.course_id;

  if tf.user_id is null then
    -- Already a TF here on another row: Kelly listed the address twice, and
    -- uniq_tf_user_course (0007:166) would refuse the second claim. Nothing to
    -- do, and being in is the answer they wanted. The spare row stays on her
    -- list for her to remove; deleting somebody's roster row on their behalf is
    -- not what pressing Accept asked for.
    if not exists (
      select 1 from course_tfs t
       where t.course_id = tf.course_id and t.user_id = auth.uid())
    then
      update course_tfs t set user_id = auth.uid()
       where t.id = tf.id and t.user_id is null;
    end if;
  elsif tf.user_id <> auth.uid() then
    -- Only reachable if two accounts share one address, which auth.users does
    -- not allow. Loud rather than silently telling the wrong person they are in.
    raise exception 'That invitation has already been accepted by another account.';
  end if;

  return query select tf.course_id, crs.name, crs.code, 'tf'::text;
end $$;

-- ---------------------------------------------------------------------------
-- 4. DECLINING.

/**
 * Stop being asked about this one. Kelly's row is not touched.
 *
 * Same address re-check as accepting, for the same reason and with the same
 * refusal: an id is not evidence of who is holding it. Recording a decline
 * against somebody else's invitation would be a way to make their prompt
 * disappear without their knowing, which is a smaller version of exactly the
 * thing this file exists to stop.
 *
 * ON CONFLICT DO NOTHING for the double tap; declining twice is declining.
 */
create or replace function decline_tf_invitation(invitation_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  tf course_tfs;
  me text;
begin
  if auth.uid() is null then
    raise exception 'Sign in first';
  end if;

  select lower(btrim(u.email)) into me from auth.users u where u.id = auth.uid();
  if me is null or me = '' then
    raise exception 'Your account has no email address, so there is no invitation to match it to';
  end if;

  select * into tf from course_tfs t where t.id = invitation_id;
  if not found or tf.email is null or lower(btrim(tf.email)) <> me then
    raise exception 'That invitation is not for %.', me;
  end if;

  insert into tf_invitation_declines (course_tf_id, user_id)
  values (tf.id, auth.uid())
  on conflict do nothing;
end $$;

-- ---------------------------------------------------------------------------
-- 5. WHO MAY CALL THESE.
--
-- PUBLIC gets EXECUTE on a new function by default, and anon is PUBLIC. None of
-- these tells anon anything — every one of them starts by reading auth.uid() —
-- but a function that can be called by a stranger is a function whose next edit
-- has to remember that.

revoke all on function my_tf_invitations() from public;
revoke all on function accept_tf_invitation(uuid) from public;
revoke all on function decline_tf_invitation(uuid) from public;

grant execute on function my_tf_invitations() to authenticated;
grant execute on function accept_tf_invitation(uuid) to authenticated;
grant execute on function decline_tf_invitation(uuid) to authenticated;

-- To see who has been invited and not yet answered:
--   select c.name, t.email, t.created_at,
--          exists (select 1 from tf_invitation_declines d where d.course_tf_id = t.id) as declined
--     from course_tfs t join courses c on c.id = t.course_id
--    where t.user_id is null and t.email is not null
--    order by c.name, t.created_at;
