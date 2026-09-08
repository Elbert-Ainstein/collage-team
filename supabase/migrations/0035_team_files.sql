-- Team resources becomes a drive.
--
-- Every file used to belong to an activity: team_resources.activity_id was NOT
-- NULL, and the screen was a list of assignments to file photos under. That is
-- the right shape for a whiteboard photo taken during a session and the wrong
-- shape for everything else a team keeps — the data they are working from, a
-- draft, a reading somebody found — none of which is about one assignment, and
-- all of which had to be filed under an arbitrary one or not kept here at all.
--
-- Two changes, and no third. A file may now belong to no activity, and a team
-- may make folders of its own. The assignment folders stay exactly as they
-- are — they are made by the course rather than by hand, and a photo taken in
-- week 3 belongs under week 3 without anybody filing it.
--
-- WHAT IS NOT CHANGED, on purpose: who may see and write these. They are the
-- team's own files, its members add and remove them, and course staff read
-- them — the same rule 0017 argued for, and a drive is not a reason to widen it.

-- ------------------------------------------------------------------ bucket
--
-- 0017 allowed images and nothing else, and said why: "a team drawer that also
-- accepts arbitrary files becomes a place to pass a finished answer between
-- teammates, which is not what this is for, and the screen has no way to render
-- one." The first half was a product decision and it has been made the other
-- way — this is a drive now, and a team that cannot keep the data file it is
-- working from keeps it in a group chat instead, where staff cannot see it and
-- nobody can find it in week 9. The second half was true and is now false: the
-- screen renders a file it cannot preview as a file.
--
-- Nothing about who can reach them changes. The bucket stays private, every
-- object is still authorised by the team in segment 3 of its path, and the size
-- ceiling stays where 0022 put it.
update storage.buckets
   set public = false,
       allowed_mime_types = null
 where id = 'resources';

-- ------------------------------------------------------- a file with no home
alter table team_resources alter column activity_id drop not null;

-- ------------------------------------------------------------------ folders
create table if not exists team_folders (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references teams(id) on delete cascade,
  /** What the team called it. Never blank. */
  name       text not null check (length(btrim(name)) > 0),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create index if not exists idx_team_folders_team on team_folders (team_id);

/**
 * Deleting a folder does NOT delete what is in it — the files fall back to the
 * drive's top level.
 *
 * A folder is a label a team put on a file; the file is the whiteboard nobody
 * can photograph twice. Cascading here would mean one press on "delete folder"
 * silently destroying a term of a team's work, and storage does not cascade at
 * all, so the objects would be stranded where no policy can reach them.
 */
alter table team_resources
  add column if not exists folder_id uuid references team_folders(id) on delete set null;

create index if not exists idx_team_resources_folder on team_resources (folder_id);

-- One home per file. An assignment folder and a folder of the team's own are
-- both folders on the same screen, so a file in both would appear twice and be
-- moved out of one place while staying in the other.
alter table team_resources drop constraint if exists team_resources_one_home;
alter table team_resources add constraint team_resources_one_home
  check (activity_id is null or folder_id is null);

-- ---------------------------------------------------------------------- RLS
alter table team_folders enable row level security;

drop policy if exists "read team_folders" on team_folders;
create policy "read team_folders" on team_folders
  for select to authenticated using (can_read_team_resources(team_id));

drop policy if exists "write team_folders" on team_folders;
create policy "write team_folders" on team_folders
  for insert to authenticated
  with check (can_write_team_resources(team_id) and created_by = auth.uid());

drop policy if exists "rename team_folders" on team_folders;
create policy "rename team_folders" on team_folders
  for update to authenticated
  using (can_write_team_resources(team_id))
  with check (can_write_team_resources(team_id));

drop policy if exists "delete team_folders" on team_folders;
create policy "delete team_folders" on team_folders
  for delete to authenticated using (can_write_team_resources(team_id));

create or replace function guard_team_folder_move() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.team_id is distinct from old.team_id
  or new.created_by is distinct from old.created_by then
    raise exception 'A folder can be renamed, not handed to another team';
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_team_folder_move on team_folders;
create trigger trg_guard_team_folder_move
  before update on team_folders
  for each row execute function guard_team_folder_move();

-- ------------------------------------------------------- moving between them
/**
 * 0017 pinned activity_id along with team_id and path, because at the time a
 * file's activity was part of where its object LIVED and re-filing a row would
 * have left the object authorised by one folder and owned by another.
 *
 * It is not, and never was: the storage policy authorises on the team in
 * segment 3, and resource_path_matches only checks that the prefix is not a
 * lie about the course. So a file may now move between folders — which is the
 * whole point of a drive — while the three things that decide who may touch it
 * stay exactly where they were.
 */
create or replace function guard_team_resource_move() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    if new.team_id    is distinct from old.team_id
    or new.path       is distinct from old.path
    or new.created_by is distinct from old.created_by then
      raise exception 'A resource can be renamed and moved between folders, not re-teamed';
    end if;
  end if;
  -- A folder of somebody else's team is not a place this file can go. The
  -- insert policy authorises the TEAM, which says nothing about the folder.
  if new.folder_id is not null and not exists (
       select 1 from team_folders f where f.id = new.folder_id and f.team_id = new.team_id) then
    raise exception 'That folder belongs to another team';
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_team_resource_move on team_resources;
create trigger trg_guard_team_resource_move
  before insert or update on team_resources
  for each row execute function guard_team_resource_move();

-- --------------------------------------------------------------- the path
/**
 * A file with no activity is filed under the literal segment "files":
 * {course}/files/{team}/{uuid}.
 *
 * The team is still segment 3, which is what every storage policy authorises
 * on, so none of them change. "files" cannot collide with an activity because
 * an activity id is a uuid, and the prefix stays checkable rather than
 * arbitrary — a team still cannot file anything under a course that is not
 * theirs.
 */
create or replace function resource_path_matches(oname text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from teams t
      join team_sets ts on ts.id = t.team_set_id
     where t.id = resource_team_id(oname)
       and split_part(oname, '/', 1) = ts.course_id::text
       and (
         split_part(oname, '/', 2) = 'files'
         or exists (
              select 1 from activities a
               where a.id::text = split_part(oname, '/', 2)
                 and a.course_id = ts.course_id)));
$$;
