-- Team audio: a private bucket for the recordings, and the table that indexes them.
--
-- Run in Supabase → SQL Editor, after 0012. Safe to re-run.
--
-- WHY A ROW BESIDE THE OBJECT. Storage can say which objects sit under a prefix;
-- it cannot say how long one runs or who made it without a listing round trip
-- per submission, and a listing is not shaped like the reads the student screens
-- do (many results at once). So the row is the index and the object is the
-- bytes. The two are pinned together by the check constraint below -- a row's
-- path must carry its own result_id -- and kept in step by deleting the object
-- first and the row second (src/checkins/audio.ts).
--
-- THE BOUNDARY. Two doors lead to the same recording, the row and the object
-- path, and a student from another team has to be turned away at both. Both are
-- decided by one question -- "may this account reach that check-in result?" --
-- asked of the helpers 0006/0007 already use for check_in_results, so the answer
-- here cannot drift from the answer the rest of the app gives.
--
-- RECORDINGS ARE NOT EDITABLE. There is deliberately no UPDATE policy on the
-- table and none on the objects: a recording is the artefact of a discussion
-- that happened, so it can be made and it can be withdrawn, but it cannot be
-- quietly replaced under an id someone has already listened to and marked.

-- The policies below are built entirely out of helpers from earlier files. If
-- one is missing the failure would otherwise be "function does not exist" in
-- the middle of a policy, which does not tell anyone which file to run.
do $$
declare missing text;
begin
  select string_agg(want.fn, ', ' order by want.fn)
    into missing
    from (values
      ('my_team_ids()'),
      ('my_check_in(uuid)'),
      ('owns_check_in(uuid)'),
      ('can_grade_check_in(uuid)')
    ) as want(fn)
   where to_regprocedure('public.' || want.fn) is null;

  if missing is not null then
    raise exception
      'Missing helper functions (%) -- run 0004, 0006 and 0007 before this file.',
      missing;
  end if;
end $$;

-- ------------------------------------------------------------------ the bucket
-- Created here rather than in the dashboard so that applying this one file is
-- the whole setup. PRIVATE: every object is reached through a signed URL, which
-- is only issued after the storage policies below have said yes.
--
-- 50 MB is a few hours of Opus speech and also the default per-file ceiling a
-- Supabase project applies globally, so nothing here promises more than the
-- platform will accept. The mime list is what a browser MediaRecorder actually
-- produces: webm/Opus on Chrome and Firefox, mp4/AAC on Safari.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'recordings', 'recordings', false, 52428800,
  array['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/mpeg']
)
on conflict (id) do nothing;

-- A bucket of this name made by hand earlier could be public, or accept
-- anything. The privacy of every discussion in the course rests on those two
-- settings, so restate them instead of trusting what is already there.
update storage.buckets
   set public = false,
       file_size_limit = 52428800,
       allowed_mime_types = array['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/mpeg']
 where id = 'recordings';

-- ------------------------------------------------------------------- the table
create table if not exists recordings (
  id          uuid primary key default gen_random_uuid(),
  result_id   uuid not null references check_in_results(id) on delete cascade,
  -- The object path inside the 'recordings' bucket, never a URL: a URL would be
  -- a signed one and would expire, leaving a dead row nobody can play.
  path        text not null unique,
  duration_ms int check (duration_ms is null or duration_ms >= 0),
  created_by  uuid default auth.uid() references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  -- The storage policies authorise by reading the result_id out of the object
  -- path. If a row could name a path belonging to some other result, the row
  -- would be a way to hand a teammate's player a path it may not fetch -- a
  -- broken player rather than a leak, since storage checks the path itself, but
  -- there is no reason to allow the mismatch at all.
  constraint recordings_path_matches_result
    check (lower(split_part(path, '/', 3)) = result_id::text)
);

create index if not exists recordings_result_id_idx on recordings (result_id);
create index if not exists recordings_created_at_idx on recordings (created_at, id);

-- ---------------------------------------------------------------- the questions
-- Asked in one place because the row and the object have to answer them the
-- same way. Both are security definer: they are called from storage policies,
-- where the caller cannot be assumed to hold a select on check_in_results, so
-- the predicate has to be complete on its own rather than lean on that table's
-- own RLS.

/** May the caller reach this result at all -- their own, their team's, or as faculty? */
create or replace function can_read_result(rid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from check_in_results r
     where r.id = rid
       and (
         (r.subject_type = 'student'
           and r.student_id in (select s.id from students s where s.user_id = auth.uid()))
         or (r.subject_type = 'team' and r.team_id in (select my_team_ids()))
         -- The course owner is named separately from can_grade_check_in() even
         -- though that helper includes them today: it also reads the TF grading
         -- switch, and an instructor must not be able to lock themselves out of
         -- their own course's audio by turning a TF permission off.
         or owns_check_in(r.check_in_id)
         or can_grade_check_in(r.check_in_id)
       ));
$$;

/**
 * May the caller add or withdraw audio on this result?
 *
 * Narrower than reading: only the student whose work it is, or a member of the
 * team whose work it is. Faculty listen and mark; they do not record for a team.
 * my_check_in() is asked as well, exactly as the student write policies in 0006
 * do, so a guessed result id cannot pull an object into a stranger's course.
 */

create or replace function can_write_result(rid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from check_in_results r
     where r.id = rid
       and my_check_in(r.check_in_id)
       and (
         (r.subject_type = 'student'
           and r.student_id in (select s.id from students s where s.user_id = auth.uid()))
         or (r.subject_type = 'team' and r.team_id in (select my_team_ids()))
       ));
$$;

/**
 * May the caller REMOVE a recording on this result?
 *
 * Wider than can_write_result on purpose. Deleting an activity is meant to take
 * its recordings with it, and only the instructor does that — without this the
 * rows would cascade away and leave the audio orphaned in the bucket: invisible,
 * unlistable, and still counted against storage.
 */
create or replace function can_remove_result_audio(rid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select can_write_result(rid)
      or exists (
        select 1 from check_in_results r
         where r.id = rid and owns_check_in(r.check_in_id));
$$;

/**
 * The result id carried by an object path: {course}/{activity}/{result}/{uuid}.
 *
 * Returns NULL for anything that is not a uuid in that position. A bare cast
 * would raise instead, and a raise inside a policy reaches the browser as a 500
 * on an ordinary listing -- an unreadable failure for what is simply a path
 * that does not belong to this feature.
 */
create or replace function recording_result_id(object_name text) returns uuid
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

grant execute on function can_read_result(uuid), can_write_result(uuid),
  can_remove_result_audio(uuid), recording_result_id(text) to authenticated;

-- --------------------------------------------------------------- RLS: the rows
alter table recordings enable row level security;

drop policy if exists "read recordings" on recordings;
create policy "read recordings" on recordings
  for select to authenticated using (can_read_result(result_id));

-- created_by is defaulted to auth.uid() and pinned here so a recording cannot be
-- filed under a teammate's name.
drop policy if exists "write recordings" on recordings;
create policy "write recordings" on recordings
  for insert to authenticated
  with check (can_write_result(result_id) and created_by = auth.uid());

drop policy if exists "delete recordings" on recordings;
create policy "delete recordings" on recordings
  for delete to authenticated using (can_remove_result_audio(result_id));

-- ------------------------------------------------------------ RLS: the objects
-- storage.objects has RLS on by default in a Supabase project; these policies
-- are what make this bucket reachable at all. Each is scoped to the bucket, so
-- nothing here changes access to any other bucket's objects.
drop policy if exists "read recording objects" on storage.objects;
create policy "read recording objects" on storage.objects
  for select to authenticated
  using (bucket_id = 'recordings' and can_read_result(recording_result_id(name)));

/**
 * The whole path is checked, not just the result id.
 *
 * Segment 3 is what authorises, so validating only that left the
 * {course}/{activity} prefix client-supplied and arbitrary — a student could
 * file their own audio under any course they liked. It reaches nobody else's
 * ears, but it makes the prefix a lie, and the prefix is what a person reads
 * when they go looking through the bucket.
 */
create or replace function recording_path_matches(oname text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from check_in_results r
      join check_ins ci on ci.id = r.check_in_id
      join activities a on a.id = ci.activity_id
     where r.id = recording_result_id(oname)
       and split_part(oname, '/', 1) = a.course_id::text
       and split_part(oname, '/', 2) = a.id::text);
$$;

grant execute on function recording_path_matches(text) to authenticated;

drop policy if exists "write recording objects" on storage.objects;
create policy "write recording objects" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'recordings'
    and can_write_result(recording_result_id(name))
    and recording_path_matches(name)
  );

drop policy if exists "delete recording objects" on storage.objects;
create policy "delete recording objects" on storage.objects
  for delete to authenticated
  using (bucket_id = 'recordings' and can_remove_result_audio(recording_result_id(name)));

-- A malformed path yields NULL above, and both helpers ask `r.id = NULL`, which
-- is false -- so an object outside the {course}/{activity}/{result}/{file} shape
-- is readable and writable by nobody, including the account that put it there.
