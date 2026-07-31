-- Roster & teams board (design handoff: "AP50 Class Manager").
-- =============================================================================
-- Three additions the board needs:
--   1. teams.locked      — a lock lives on the team card, not the set. "Re-roll
--                          unlocked" must preserve locked teams and their members.
--   2. students.attrs    — extra roster columns (major, skill tag, …) become the
--                          attributes teams are mixed by.
--   3. courses.team_cadence — the answer to "how often do teams change?", asked
--                          once at import time instead of exposing "team set".
-- Safe to re-run.
-- =============================================================================

alter table teams
  add column if not exists locked boolean not null default false;

alter table students
  add column if not exists attrs jsonb not null default '{}';

alter table courses
  add column if not exists team_cadence text not null default 'semester';

-- 'semester' = one shared set every activity uses; 'activity' = one set per
-- activity, each independently re-rollable.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'courses_team_cadence_check'
  ) then
    alter table courses
      add constraint courses_team_cadence_check
      check (team_cadence in ('semester', 'activity'));
  end if;
end $$;
