-- Live questions: release to individual mode after a session was closed.
--
-- Run in Supabase → SQL Editor, after 0053. Safe to re-run.
--
-- When team mode breaks in class, someone closes it — and then 0053's
-- release_live_individual refused it ("already closed"). Students could
-- already read the key and the explanations, but scoring it would have graded
-- the team half that never happened. Now a session closed but not yet scored
-- can be released too: team_skipped is set, it stays closed, and scoring
-- grades own answers only (0053's score_live).
--
-- What changes:
--   - release_live_individual(aid): also from 'closed' while scored_at is
--     null. A scored session still refuses: its grades are out, and turning
--     it into individual-only would quietly rewrite them.

-- ---------------------------------------------------------------- prereqs
do $$
begin
  if to_regprocedure('public.release_live_individual(uuid)') is null then
    raise exception 'Missing release_live_individual(uuid) -- run 0053 before this file.';
  end if;
end $$;

create or replace function release_live_individual(aid uuid) returns live_state
language plpgsql security definer set search_path = public as $$
declare st live_state;
begin
  if not can_run_checkins_course(activity_course(aid)) then
    raise exception 'Only the instructor, or a TF who runs check-ins, can release the answers';
  end if;
  select * into st from live_state where activity_id = aid for update;
  if st is null then
    raise exception 'That isn''t a live questions activity';
  end if;
  if st.phase = 'closed' and st.scored_at is not null then
    raise exception 'This one is already scored';
  end if;
  perform set_config('live.phase_change', 'on', true);
  update live_state
     set phase = 'closed',
         -- Closed already: when it was closed is when it was closed.
         closed_at = coalesce(closed_at, now()),
         team_skipped = true
   where activity_id = aid
  returning * into st;
  perform set_config('live.phase_change', 'off', true);
  return st;
end $$;

-- Who may call what (0047's note: revoke from all three first).
revoke all on function release_live_individual(uuid) from public, anon, authenticated;
grant execute on function release_live_individual(uuid) to authenticated;
