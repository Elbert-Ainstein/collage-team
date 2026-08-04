-- Class Check-ins — initial schema (v1, no auth)
-- =============================================================================
-- Run this in your Supabase project's SQL editor (Dashboard → SQL Editor → New
-- query → paste → Run). Models the validated Class Check-ins prototype:
--   course → students, activities(one per week) → check-ins(iRAT + tRAT),
--   per-activity team sets → teams → members, and check_in_results (the
--   gradebook cells: status / score / transcription / flag).
--
-- PROTOTYPE SECURITY: no auth yet. RLS is ON but with a permissive policy so the
-- frontend anon key can read/write. Anyone with your project URL + anon key can
-- change data. That is acceptable for a single-faculty prototype ONLY — replace
-- these policies with real per-user rules before adding auth or real students.
-- =============================================================================

create extension if not exists "pgcrypto";

-- A class section, e.g. "Intro to Systems Biology · Fall".
create table if not exists courses (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  code        text,
  term        text,
  created_at  timestamptz not null default now()
);

-- Roster.
create table if not exists students (
  id          uuid primary key default gen_random_uuid(),
  course_id   uuid not null references courses(id) on delete cascade,
  name        text not null,
  email       text,
  avatar_tint text,
  position    int  not null default 0,
  created_at  timestamptz not null default now()
);

-- One activity per week (a topic/case). Owns its check-in columns.
create table if not exists activities (
  id                uuid primary key default gen_random_uuid(),
  course_id         uuid not null references courses(id) on delete cascade,
  week              int,
  topic             text,
  title             text not null,
  dates_label       text,
  stage             int  not null default 0,      -- 0 setup, 1 individual, 2 discuss, 3 resubmit, 4 closed
  resubmit_mode     text not null default 'team', -- team | individual | choice
  source_text       text,
  files             jsonb not null default '[]',  -- [{name, size}]
  opens_at          timestamptz,
  individual_due_at timestamptz,
  team_due_at       timestamptz,
  posted            boolean not null default false,
  position          int  not null default 0,
  created_at        timestamptz not null default now()
);

-- Per-activity team configuration (same class can be teams-of-4 for one
-- activity and pairs for another).
create table if not exists team_sets (
  id          uuid primary key default gen_random_uuid(),
  course_id   uuid not null references courses(id) on delete cascade,
  activity_id uuid references activities(id) on delete cascade,
  name        text,
  team_size   int,
  locked      boolean not null default false,
  created_at  timestamptz not null default now()
);

create table if not exists teams (
  id          uuid primary key default gen_random_uuid(),
  team_set_id uuid not null references team_sets(id) on delete cascade,
  name        text not null,
  position    int  not null default 0,
  created_at  timestamptz not null default now()
);

-- A student's membership in a team (assigned by faculty; never self-selected).
create table if not exists team_members (
  team_id    uuid not null references teams(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  primary key (team_id, student_id)
);

-- Two per week: an individual "iRAT" + a team "tRAT" (kept general).
create table if not exists check_ins (
  id          uuid primary key default gen_random_uuid(),
  activity_id uuid not null references activities(id) on delete cascade,
  label       text not null,
  kind        text not null,                 -- individual | team
  phase       text,                          -- Readiness | Participation | Milestone
  scale       text not null default 'points',-- points | ci  (complete/incomplete)
  max_points  int,
  posted      boolean not null default false,
  position    int  not null default 0,
  created_at  timestamptz not null default now()
);

-- The gradebook cell: a subject's result for a check-in.
-- subject = a student (for an individual check-in) or a team (for a team one).
create table if not exists check_in_results (
  id                  uuid primary key default gen_random_uuid(),
  check_in_id         uuid not null references check_ins(id) on delete cascade,
  subject_type        text not null,               -- student | team
  student_id          uuid references students(id) on delete cascade,
  team_id             uuid references teams(id) on delete cascade,
  status              text not null default 'none', -- none|draft|submitted|needs_review|scored|excused|discussing
  score               numeric,
  is_ci               boolean not null default false,
  text                text,
  files               jsonb not null default '[]',
  transcription       text,
  transcription_state text default 'none',          -- none | auto | confirmed
  flagged             boolean not null default false,
  updated_at          timestamptz not null default now(),
  constraint subject_shape check (
    (subject_type = 'student' and student_id is not null and team_id is null) or
    (subject_type = 'team'    and team_id   is not null and student_id is null)
  )
);

-- One result per (check-in, subject).
create unique index if not exists uniq_result_student
  on check_in_results (check_in_id, student_id) where subject_type = 'student';
create unique index if not exists uniq_result_team
  on check_in_results (check_in_id, team_id)    where subject_type = 'team';

-- Lookup indexes.
create index if not exists idx_students_course   on students(course_id);
create index if not exists idx_activities_course  on activities(course_id);
create index if not exists idx_teamsets_activity  on team_sets(activity_id);
create index if not exists idx_teams_set          on teams(team_set_id);
create index if not exists idx_checkins_activity  on check_ins(activity_id);
create index if not exists idx_results_checkin    on check_in_results(check_in_id);

-- ---- RLS: prototype-only permissive policies (see header warning) ----------
do $$
declare t text;
begin
  foreach t in array array[
    'courses','students','activities','team_sets','teams',
    'team_members','check_ins','check_in_results'
  ] loop
    execute format('alter table %I enable row level security', t);
    -- This policy opens every table to the public anon key. It was right for
    -- the pre-auth prototype and 0003 drops it by name.
    --
    -- Re-running this file after 0003 would therefore SUCCEED — the name is
    -- free again — and silently re-open the whole database to anyone holding
    -- the anon key, which is public by design. So it is created only when the
    -- owner-scoped policies that replaced it are not already present.
    if not exists (
      select 1 from pg_policies
       where schemaname = 'public' and tablename = t and policyname = 'own ' || t
    ) then
      execute format($p$
        create policy "prototype anon full access" on %I
          for all to anon, authenticated using (true) with check (true)
      $p$, t);
    end if;
  end loop;
end $$;
