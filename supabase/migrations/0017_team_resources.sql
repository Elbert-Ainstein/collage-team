-- Team resources: the whiteboard photos a team takes during a session.
--
-- Run in Supabase → SQL Editor, after 0016. Safe to re-run.
--
-- The Team resources screen showed the handoff's seed copy behind a "Sample"
-- badge and an Add button that could not be pressed, because there was nowhere
-- to put a file. This is that place.
--
-- One table and a bucket:
--   team_resources   one row per uploaded image, pointing at the object
--
-- Paths are {course}/{activity}/{team}/{uuid}.ext — the same shape 0013 and 0015
-- use, with the TEAM in segment 3 rather than a result, so the storage policies
-- authorise from the path alone.
--
-- Scoped to a team AND an activity: a whiteboard photo is a record of a
-- particular discussion, and the screen files it under the activity it came
-- from. A team-wide drawer with everything in it is what this replaces.

-- ------------------------------------------------------------------ bucket
-- Images only. A team drawer that also accepts arbitrary files becomes a place
-- to pass a finished answer between teammates, which is not what this is for,
-- and the screen has no way to render one.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'resources', 'resources', false, 26214400,
  -- heic/heif because a photo taken on an iPhone arrives as one, and refusing
  -- it would reject the single most likely way a whiteboard gets photographed.
  array['image/png','image/jpeg','image/webp','image/gif','image/heic','image/heif']
)
on conflict (id) do nothing;

-- Restated unconditionally: a bucket somebody created by hand earlier must not
-- leave a class's photos public.
update storage.buckets
   set public = false,
       file_size_limit = 26214400,
       allowed_mime_types =
         array['image/png','image/jpeg','image/webp','image/gif','image/heic','image/heif']
 where id = 'resources';

-- ------------------------------------------------------------------- table
create table if not exists team_resources (
  id          uuid primary key default gen_random_uuid(),
  activity_id uuid not null references activities(id) on delete cascade,
  team_id     uuid not null references teams(id) on delete cascade,
  /** What the team called it. Never blank — the upload names it if nobody does. */
  title       text not null check (length(btrim(title)) > 0),
  path        text not null unique,
  mime        text,
  size_bytes  bigint,
  created_by  uuid references auth.users(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now()
);

create index if not exists idx_team_resources_team on team_resources (team_id);
create index if not exists idx_team_resources_activity on team_resources (activity_id);

-- ------------------------------------------------------------------ helpers
-- activity_course() comes from 0016.
create or replace function resource_team_id(object_name text) returns uuid
language plpgsql immutable as $$
declare seg text;
begin
  seg := split_part(object_name, '/', 3);
  begin
    return seg::uuid;
  exception when others then
    return null;
  end;
end $$;

/** May the caller see this team's resources? Its members, and the course staff. */
create or replace function can_read_team_resources(tid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select tid in (select my_team_ids())
      or exists (
        select 1
          from teams t
          join team_sets ts on ts.id = t.team_set_id
         where t.id = tid
           and (can_grade_course(ts.course_id) or can_run_checkins_course(ts.course_id)));
$$;

/**
 * May the caller ADD or REMOVE one? Its members only.
 *
 * Narrower than reading on purpose. These are the team's own notes; an
 * instructor looking at them is a reader, and deleting a team's record of their
 * own discussion is not something the sheet needs to be able to do.
 */
create or replace function can_write_team_resources(tid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select tid in (select my_team_ids());
$$;

grant execute on function resource_team_id(text), can_read_team_resources(uuid),
  can_write_team_resources(uuid) to authenticated;

/**
 * The whole path is checked, not just the team id.
 *
 * Segment 3 is what authorises, so validating only that would leave the
 * {course}/{activity} prefix client-supplied and arbitrary — a team could file
 * their photo under any course they liked. Nobody else can see it either way,
 * but the prefix is what a person reads when they go looking through the
 * bucket, and it should not be a lie.
 */
create or replace function resource_path_matches(oname text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from teams t
      join team_sets ts on ts.id = t.team_set_id
      join activities a on a.id::text = split_part(oname, '/', 2)
     where t.id = resource_team_id(oname)
       and a.course_id = ts.course_id
       and split_part(oname, '/', 1) = ts.course_id::text);
$$;

grant execute on function resource_path_matches(text) to authenticated;

-- --------------------------------------------------------------------- RLS
alter table team_resources enable row level security;

drop policy if exists "read team_resources" on team_resources;
create policy "read team_resources" on team_resources
  for select to authenticated using (can_read_team_resources(team_id));

-- created_by is defaulted to auth.uid() and pinned here, so a photo cannot be
-- filed under a teammate's name.
drop policy if exists "write team_resources" on team_resources;
create policy "write team_resources" on team_resources
  for insert to authenticated
  with check (can_write_team_resources(team_id) and created_by = auth.uid());

-- Renaming, and nothing else. The team_id and activity_id a row was filed under
-- are what its storage object's path encodes; letting them move would leave the
-- object authorised by one team and the row owned by another.
drop policy if exists "rename team_resources" on team_resources;
create policy "rename team_resources" on team_resources
  for update to authenticated
  using (can_write_team_resources(team_id))
  with check (can_write_team_resources(team_id));

create or replace function guard_team_resource_move() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.team_id     is distinct from old.team_id
  or new.activity_id is distinct from old.activity_id
  or new.path        is distinct from old.path
  or new.created_by  is distinct from old.created_by then
    raise exception 'A resource can be renamed, not re-filed';
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_team_resource_move on team_resources;
create trigger trg_guard_team_resource_move
  before update on team_resources
  for each row execute function guard_team_resource_move();

drop policy if exists "delete team_resources" on team_resources;
create policy "delete team_resources" on team_resources
  for delete to authenticated using (can_write_team_resources(team_id));

-- ------------------------------------------------------------ storage rules
drop policy if exists "read resource objects" on storage.objects;
create policy "read resource objects" on storage.objects
  for select to authenticated
  using (bucket_id = 'resources' and can_read_team_resources(resource_team_id(name)));

drop policy if exists "write resource objects" on storage.objects;
create policy "write resource objects" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'resources'
    and can_write_team_resources(resource_team_id(name))
    and resource_path_matches(name)
  );

drop policy if exists "delete resource objects" on storage.objects;
create policy "delete resource objects" on storage.objects
  for delete to authenticated
  using (bucket_id = 'resources' and can_write_team_resources(resource_team_id(name)));

grant select, insert, update, delete on team_resources to authenticated;
