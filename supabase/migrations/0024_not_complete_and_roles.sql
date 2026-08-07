-- Two things: a mark can say NOT complete, and a wrong account type can be fixed.
--
-- Run in Supabase → SQL Editor, after 0023. Safe to re-run.

-- ══════════════════════════════════════════════════ 1. "Not complete"
--
-- releaseMark writes `is_ci`, and `is_ci = true` has always meant "Complete".
-- There was nowhere to record the other answer — an instructor marking a
-- completion activity could say complete, or leave it ungraded, and nothing in
-- between.
--
-- NOT score = 0. Overloading the number would make "did not complete this" and
-- "completed it and scored nothing" the same row, and the gradebook could never
-- tell them apart again.
--
--   is_ci = false            marked out of points; `score` is the mark
--   is_ci = true, ci_met     Complete
--   is_ci = true, not ci_met Not complete
--
-- DEFAULT TRUE, so every row already released reads exactly as it did before:
-- they were all "Complete", because that was the only thing is_ci could say.

alter table check_in_results
  add column if not exists ci_met boolean not null default true;

comment on column check_in_results.ci_met is
  'Only meaningful when is_ci. True = Complete, false = Not complete.';

-- A student may not set their own completion any more than their own score.
-- 0008's guard already refuses `score` and `is_ci`; this is the third field of
-- the same fact and has to be refused with them.
create or replace function guard_student_grading() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if can_grade_check_in(new.check_in_id) then
    return new;
  end if;

  if new.status not in ('none', 'draft', 'submitted', 'discussing') then
    raise exception 'Students can submit work, but not grade it';
  end if;

  if tg_op = 'INSERT' then
    if new.score is not null then
      raise exception 'Students cannot set their own grade';
    end if;
    if new.is_ci then
      raise exception 'Students cannot set their own grade';
    end if;
    return new;
  end if;

  -- UPDATE. Compare against the old row: a score that is already there may stay
  -- there, it just may not move.
  if new.score is distinct from old.score then
    raise exception 'Students cannot change a grade';
  end if;
  if old.status = 'scored' then
    raise exception 'This has already been graded - ask your instructor to reopen it';
  end if;
  if new.is_ci is distinct from old.is_ci then
    raise exception 'Students cannot set their own grade';
  end if;
  if new.ci_met is distinct from old.ci_met then
    raise exception 'Students cannot set their own grade';
  end if;
  if new.check_in_id is distinct from old.check_in_id
     or new.subject_type is distinct from old.subject_type
     or new.student_id is distinct from old.student_id
     or new.team_id is distinct from old.team_id then
    raise exception 'A submission cannot be moved to another row';
  end if;
  if new.feedback is distinct from old.feedback then
    raise exception 'Only your instructor can leave feedback';
  end if;

  return new;
end $$;

-- ══════════════════════════════════════════════════ 2. Wrong account type
--
-- profiles.role is 'faculty' or 'student', chosen at sign-up, and 0006 pins it:
-- the own-profile UPDATE policy requires `role` to equal what it already is, so
-- nobody — not the person, not a course owner — can change it through the
-- table. That pinning is right. Role is the only thing standing between a
-- student account and an instructor's gradebook, and a policy that let anyone
-- write it to anyone would be an escalation with no bottom.
--
-- So this does NOT loosen the policy. It adds one narrow, security-definer
-- door, and the whole of the safety is in its WHERE clause: a course owner may
-- set the role of somebody who is ON A COURSE THEY OWN — on its roster, or on
-- its TF list — and of nobody else. They already control both of those lists,
-- so this grants no reach they did not already have.

create or replace function set_member_role(target uuid, next_role text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if next_role not in ('faculty', 'student') then
    raise exception 'A role is faculty or student';
  end if;

  -- Never yourself. An owner demoting their own account locks them out of the
  -- course they own, from a button whose whole purpose is fixing somebody
  -- else's mistake.
  if target = auth.uid() then
    raise exception 'Use your own account settings to change your own role';
  end if;

  if not exists (
    select 1
      from students s
      join courses c on c.id = s.course_id
     where s.user_id = target and c.owner_id = auth.uid()
    union all
    select 1
      from course_tfs t
      join courses c on c.id = t.course_id
     where t.user_id = target and c.owner_id = auth.uid())
  then
    raise exception 'That account is not on a course you own';
  end if;

  update profiles set role = next_role where id = target;
end $$;

revoke all on function set_member_role(uuid, text) from public;
grant execute on function set_member_role(uuid, text) to authenticated;

/**
 * ...and the far simpler half: fixing your OWN wrong pick.
 *
 * "Faculty" is the default button at sign-up, so choosing wrong is easy and
 * silent. There is no escalation here — the person is choosing what to be, the
 * same choice the sign-up form offered — and it is what the request actually
 * described: "if people choose the wrong account type".
 *
 * What role does NOT do is grant anything. A faculty role provisions your own
 * empty courses; it does not let you read anybody else's, because every policy
 * in this schema keys on ownership and roster membership rather than on role.
 */
create or replace function set_my_role(next_role text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if next_role not in ('faculty', 'student') then
    raise exception 'A role is faculty or student';
  end if;
  update profiles set role = next_role where id = auth.uid();
end $$;

revoke all on function set_my_role(text) from public;
grant execute on function set_my_role(text) to authenticated;

-- Faculty need to SEE the current role to fix it. 0006 lets you read only your
-- own profile, so a course owner cannot tell a mis-signed-up student from a
-- correctly signed-up one. This reads role and nothing else, for people on a
-- course they own — same bound as set_member_role.
create or replace function course_member_roles(cid uuid)
returns table (user_id uuid, role text)
language sql stable security definer set search_path = public as $$
  select p.id, p.role
    from profiles p
   where exists (select 1 from courses c where c.id = cid and c.owner_id = auth.uid())
     and (
       exists (select 1 from students s where s.user_id = p.id and s.course_id = cid)
       or exists (select 1 from course_tfs t where t.user_id = p.id and t.course_id = cid));
$$;

revoke all on function course_member_roles(uuid) from public;
grant execute on function course_member_roles(uuid) to authenticated;
