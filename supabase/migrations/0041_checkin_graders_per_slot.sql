-- 0041: a grading TF per CHECK-IN, and the instructor as one of the names.
--
-- Run in Supabase → SQL Editor, after 0040. Safe to re-run.
--
-- Two corrections to 0040, both from how a session actually runs:
--
--   1. The room is split per check-in, not per tutorial. Teams present their
--      sections one at a time and the staff swap between them, so "who is
--      grading Helix" has two answers on the same activity. The key grows a
--      slot, like tutorial_marks has always had.
--   2. The instructor grades too. course_tfs is the TF roster and the owner is
--      not on it, so a pick is now EITHER a course_tfs row or the course's
--      instructor — tf_id null with instructor true — and exactly one of them.
--
-- The 0040 rows are one pick meant for the whole activity, so each becomes
-- both of that team's check-ins rather than only the first.

-- ------------------------------------------------------------------ columns
alter table tutorial_graders add column if not exists slot int not null default 1;
alter table tutorial_graders add column if not exists instructor boolean not null default false;
alter table tutorial_graders alter column tf_id drop not null;

do $$ begin
  alter table tutorial_graders
    add constraint tutorial_graders_slot_ck check (slot in (1, 2));
exception when duplicate_object then null; end $$;

-- A pick is one person: a TF row, or the instructor. Never both, never neither
-- — a row naming nobody is what deleting the row already says.
do $$ begin
  alter table tutorial_graders
    add constraint tutorial_graders_one_grader_ck
    check ((tf_id is not null) <> instructor);
exception when duplicate_object then null; end $$;

-- --------------------------------------------------------------------- key
-- The 0040 pick applied to the team's whole activity, so it becomes check-in 2
-- as well. Done while the old key still forbids a second row per team — hence
-- the copy first, the key swap after, in one transaction.
do $$ begin
  if exists (
    select 1 from pg_constraint
     where conname = 'tutorial_graders_pkey'
       and conrelid = 'tutorial_graders'::regclass
       and array_length(conkey, 1) = 2)
  then
    alter table tutorial_graders drop constraint tutorial_graders_pkey;
    insert into tutorial_graders (activity_id, team_id, slot, tf_id, instructor, updated_at)
      select activity_id, team_id, 2, tf_id, instructor, updated_at
        from tutorial_graders where slot = 1;
    alter table tutorial_graders
      add constraint tutorial_graders_pkey primary key (activity_id, team_id, slot);
  end if;
end $$;

-- ------------------------------------------------------------------ guards
-- As 0040, minus the assumption that there is always a TF row to check: the
-- instructor is the course's owner by definition and has no row to point at.
create or replace function guard_tutorial_grader() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not tutorial_team_fits(new.activity_id, new.team_id) then
    raise exception 'That team is not in this activity''s course';
  end if;

  if new.tf_id is not null and not exists (
    select 1 from course_tfs ct
     where ct.id = new.tf_id and ct.course_id = activity_course(new.activity_id))
  then
    raise exception 'The grader has to be a TF on this activity''s course';
  end if;

  return new;
end $$;

drop trigger if exists trg_guard_tutorial_graders on tutorial_graders;
create trigger trg_guard_tutorial_graders
  before insert or update on tutorial_graders
  for each row execute function guard_tutorial_grader();

-- RLS, the indexes and the grants are 0040's and unchanged: who may fill the
-- sheet in may set this, and students never read it.
