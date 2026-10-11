-- Step 5 of docs/checkin-teams-recovery.md — CLEAN UP.
--
-- Only once the re-exported check-in files match the ones downloaded before
-- the switch (step 6 of the runbook). This drops the loaded old teams and the
-- copy step 4 kept for undo; the restored teams themselves stay where they are.
drop schema if exists recovery cascade;
