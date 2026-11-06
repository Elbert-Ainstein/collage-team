-- Live questions, team mode: a team may change its leader (0057).
--
-- Run in Supabase → SQL Editor, after 0056. Safe to re-run.
--
-- 0051 fixed a team's leader for the session: once picked, the only way to a
-- new one was staff marking the old one absent on the sheet. Ellie's ask —
-- "you should be able to switch leaders if you really want to." The leader
-- went for a bathroom break, or the team just changed its mind, and the team
-- was stuck.
--
-- So: anyone on the team who is there may reopen the vote. The team's leader
-- is cleared and its votes are thrown away, and the team picks again exactly
-- as it did at the start (vote_live_leader, confirm_live_leader) — a leader
-- is still something the whole team agrees on, never something one person
-- takes. Until it has, nobody submits: the same as when the sheet marked a
-- leader absent (0051). The roll stays taken; the new leader may take it
-- again from the roll page, as the old one could.
--
-- What changes:
--   - live_team_setup.leader_at now means "when the team last PICKED a
--     leader" and stays set when the vote is reopened, so live_leads can
--     tell a team that has had a leader from one that never has. leader_id
--     is still who leads now, and is null while the team picks again.
--   - live_leads: "anyone, until the team has had a leader" reads leader_at.
--   - reopen_live_leader: new.
--
-- On a database without this file the Change leader button is refused with
-- its plain message, and nothing else is different.

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
      ('vote_live_leader(uuid, uuid)'),
      ('confirm_live_leader(uuid)')
    ) as want(fn)
   where to_regprocedure('public.' || want.fn) is null;

  if missing is not null then
    raise exception 'Missing helper functions (%) -- run 0051 before this file.', missing;
  end if;
end $$;

-- ---------------------------------------------------------------- helpers
/**
 * 0051's live_leads, reading leader_at: may this student act for the team —
 * submit a try, move it on? Anyone, until the team has ever had a leader;
 * after that only its leader, and nobody at all while it has none — the one
 * it had marked absent, or its vote reopened — and it hasn't picked again.
 * mayLead in src/live/leader.ts says the same thing to the screen.
 */
create or replace function live_leads(aid uuid, tid uuid, sid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from live_team_setup s
                      where s.activity_id = aid and s.team_id = tid and s.leader_at is not null)
      or coalesce(live_team_leader(aid, tid) = sid, false);
$$;

-- ------------------------------------------------------------- the leader
/**
 * Reopen the team's vote for leader: the team has no leader again, and no
 * votes, and picks one as at the start. By anyone on the team who is there.
 * Reopening a vote that is already open is no error. Returns the team's
 * setup row.
 */
create or replace function reopen_live_leader(aid uuid) returns live_team_setup
language plpgsql security definer set search_path = public as $$
declare
  me    record;
  setup live_team_setup;
begin
  select * into me from live_team_caller(aid);
  setup := live_setup_for_update(aid, me.tid);

  delete from live_leader_votes where activity_id = aid and team_id = me.tid;
  -- leader_at stays: the team has had a leader, so nobody submits until it
  -- has one again (live_leads).
  update live_team_setup set leader_id = null
   where activity_id = aid and team_id = me.tid
  returning * into setup;
  return setup;
end $$;

-- Who may call what (0047's note: revoke from all three first, then grant).
revoke all on function live_leads(uuid, uuid, uuid), reopen_live_leader(uuid) from public, anon, authenticated;
grant execute on function reopen_live_leader(uuid) to authenticated;
