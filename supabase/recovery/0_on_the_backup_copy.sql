-- "Do this first" in docs/checkin-teams-recovery.md — run on the COPY, never on live.
--
-- Physical backups can't be downloaded, so the old teams come out of a
-- "Restore to a New Project" copy made from the last backup before the switch.
-- Open that copy's SQL Editor, run this, and copy the single cell it returns:
-- it is the INSERT that goes in step 2's second fill-in on the live project.
-- Read-only.

select 'insert into recovery.old_team_members (team_id, student_id) values' || E'\n'
    || string_agg(format('  (%L, %L)', team_id, student_id), E',\n'
                  order by team_id, student_id)
    || E'\non conflict do nothing;' as paste_into_step_2
  from team_members;
