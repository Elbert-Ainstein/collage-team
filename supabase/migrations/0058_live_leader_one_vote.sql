-- Live questions, team mode: one vote is enough to confirm a leader (0058).
--
-- Run in Supabase → SQL Editor, after 0057. Safe to re-run.
--
-- 0051 let "Confirm <name>" through only once two people had voted, or the
-- whole team had. A student whose teammates didn't come was stuck: nobody
-- else could vote, and the others still counted as there, because marking
-- them absent is the leader's roll — and there was no leader to take it. The
-- only way out was staff marking them absent on the sheet.
--
-- So: confirm_live_leader takes the one name every vote is for, however many
-- votes there are. The rest is as before — the caller must have voted, split
-- votes don't confirm, and a whole team agreeing still sets the leader at
-- once without a confirm. A team that turns up and disagrees changes leader
-- (0057).
--
-- What changes:
--   - confirm_live_leader: no "Wait for one more vote".
--
-- On a database without this file, Confirm on one vote is refused with
-- "Wait for one more vote", and nothing else is different.

-- ---------------------------------------------------------------- prereqs
do $$
declare missing text;
begin
  select string_agg(want.fn, ', ' order by want.fn)
    into missing
    from (values
      ('live_team_caller(uuid)'),
      ('live_setup_for_update(uuid, uuid)'),
      ('live_team_leader(uuid, uuid)'),
      ('live_leader_tally(uuid, uuid)'),
      ('live_set_leader(uuid, uuid, uuid)')
    ) as want(fn)
   where to_regprocedure('public.' || want.fn) is null;

  if missing is not null then
    raise exception 'Missing helper functions (%) -- run 0051 before this file.', missing;
  end if;
end $$;

-- ------------------------------------------------------------- the leader
/**
 * "Confirm <name>": settle on the one name every vote is for, without waiting
 * for the rest. By someone who has voted; one vote is enough. A second
 * confirm of the same leader is no error.
 */
create or replace function confirm_live_leader(aid uuid) returns live_team_setup
language plpgsql security definer set search_path = public as $$
declare
  me    record;
  setup live_team_setup;
  t     record;
begin
  select * into me from live_team_caller(aid);
  setup := live_setup_for_update(aid, me.tid);
  if live_team_leader(aid, me.tid) is not null then
    return setup;
  end if;
  if not exists (select 1 from live_leader_votes v
                  where v.activity_id = aid and v.student_id = me.sid and v.team_id = me.tid) then
    raise exception 'Vote first';
  end if;

  select * into t from live_leader_tally(aid, me.tid);
  if t.agreed is null then
    raise exception 'Votes are split — agree on one person';
  end if;
  return live_set_leader(aid, me.tid, t.agreed);
end $$;

-- Who may call what (0047's note: revoke from all three first, then grant).
revoke all on function confirm_live_leader(uuid) from public, anon, authenticated;
grant execute on function confirm_live_leader(uuid) to authenticated;
