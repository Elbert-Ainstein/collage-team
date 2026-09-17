-- 0040: the check-in sheet says which TF is grading each team.
--
-- Run in Supabase → SQL Editor, after 0016. Safe to re-run.
--
-- During a session the staff split the room: "you take Helix and Vesicle, I
-- take the rest". That split lived in the air; the sheet now has a Grader
-- column, one pick per (activity, team), stored here. It names a course_tfs
-- row rather than an auth user, because the person being pointed at is "the
-- TF called Sam on this course" — the same row the TFs tab manages — whether
-- or not they have signed up yet.
--
-- Same family as tutorial_marks/tutorial_absences (0016): keyed on
-- (activity, team), written by whoever runs check-ins, invisible to students.

create table if not exists tutorial_graders (
  activity_id uuid not null references activities(id) on delete cascade,
  team_id     uuid not null references teams(id) on delete cascade,
  -- Cascade: a TF removed from the course was going to stop grading anyway,
  -- and a row pointing at nobody would render as an empty cell regardless.
  tf_id       uuid not null references course_tfs(id) on delete cascade,
  updated_at  timestamptz not null default now(),
  primary key (activity_id, team_id)
);

create index if not exists idx_tutorial_graders_team on tutorial_graders (team_id);
create index if not exists idx_tutorial_graders_tf on tutorial_graders (tf_id);

-- ------------------------------------------------------------------ guards
-- Same shape as guard_tutorial_mark (0016): nothing in the policies says the
-- team or the TF has anything to do with the activity's course, so the row
-- itself has to refuse a cross-course pairing.
create or replace function guard_tutorial_grader() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not tutorial_team_fits(new.activity_id, new.team_id) then
    raise exception 'That team is not in this activity''s course';
  end if;

  if not exists (
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

-- --------------------------------------------------------------------- RLS
alter table tutorial_graders enable row level security;

-- Who may read and set it: exactly who may fill the sheet in — the course
-- owner, and a TF the owner has given check-in permission (0010/0016).
drop policy if exists "staff read tutorial_graders" on tutorial_graders;
create policy "staff read tutorial_graders" on tutorial_graders
  for select to authenticated using (can_run_checkins_course(activity_course(activity_id)));

drop policy if exists "staff write tutorial_graders" on tutorial_graders;
create policy "staff write tutorial_graders" on tutorial_graders
  for insert to authenticated
  with check (can_run_checkins_course(activity_course(activity_id)));

drop policy if exists "staff update tutorial_graders" on tutorial_graders;
create policy "staff update tutorial_graders" on tutorial_graders
  for update to authenticated
  using (can_run_checkins_course(activity_course(activity_id)))
  with check (can_run_checkins_course(activity_course(activity_id)));

drop policy if exists "staff clear tutorial_graders" on tutorial_graders;
create policy "staff clear tutorial_graders" on tutorial_graders
  for delete to authenticated using (can_run_checkins_course(activity_course(activity_id)));

-- Deliberately NOT readable by students: who on the staff is grading a team
-- is staff business, like who else was marked absent.

grant select, insert, update, delete on tutorial_graders to authenticated;

-- The pick is a name from the TF roster, so whoever can fill the sheet in has
-- to be able to READ that roster. Until now only the owner could (0007 gives
-- a TF just their own row), which would leave the Grader dropdown holding one
-- name. Additive, like every policy here: the owner's access is untouched,
-- and a TF without check-in permission still sees only their own row.
drop policy if exists "checkin staff read course_tfs" on course_tfs;
create policy "checkin staff read course_tfs" on course_tfs
  for select to authenticated using (can_run_checkins_course(course_id));
