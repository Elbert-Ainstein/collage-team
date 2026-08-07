-- A team can keep a take in Team resources, and give it a name.
--
-- Run in Supabase → SQL Editor, after 0020. Safe to re-run.
--
-- A team records several takes of one discussion and one of them is the one
-- worth keeping. Until now every take sat in the Audio card and nowhere else,
-- and Team resources held only photos — so "the recording of our discussion"
-- and "the photo of our board" lived in two different places despite being the
-- same kind of thing: what the team made.
--
-- TWO COLUMNS ON `recordings`, not a row copied into team_resources:
--
--   in_resources  the team said keep this one
--   title         what they called it
--
-- Copying would mean a second row pointing at the same object in a DIFFERENT
-- bucket from the one team_resources' storage policies authorise, and two rows
-- that have to be deleted together or one becomes a pointer to nothing. The
-- take is already scoped to the team and the activity through its result; this
-- only marks it.

alter table recordings add column if not exists in_resources boolean not null default false;
alter table recordings add column if not exists title text;

-- Read by anyone who can already read the recording, and set by anyone who can
-- already write to the result it hangs off. No policy change is needed: 0013's
-- "read recordings" and the storage rules cover both, and there is no UPDATE
-- policy on the table yet — so add one, narrow to the two columns a team may
-- change.
drop policy if exists "name and keep recordings" on recordings;
create policy "name and keep recordings" on recordings
  for update to authenticated
  using (can_write_result(result_id))
  with check (can_write_result(result_id));

/**
 * A team may rename a take and mark it kept. Nothing else.
 *
 * result_id and path are what the storage policies authorise against, and
 * created_by is who made it — letting an update move any of them would let a
 * row point at an object it has no claim to, or file a take under a teammate.
 */
create or replace function guard_recording_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.result_id   is distinct from old.result_id
  or new.path        is distinct from old.path
  or new.created_by  is distinct from old.created_by
  or new.duration_ms is distinct from old.duration_ms then
    raise exception 'A recording can be renamed or kept, not re-filed';
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_recording_update on recordings;
create trigger trg_guard_recording_update
  before update on recordings
  for each row execute function guard_recording_update();

grant update (in_resources, title) on recordings to authenticated;
