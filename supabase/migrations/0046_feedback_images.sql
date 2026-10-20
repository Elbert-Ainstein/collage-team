-- 0046: an image beside the grading comment.
--
-- Run in Supabase → SQL Editor, after 0045. Safe to re-run.
--
-- A comment box takes words, and a lot of what a marker wants to say about a
-- Combo, Challenge or Amplify answer is a picture: the free-body diagram drawn
-- the way it should have been, a photo of the worked solution on the board, a
-- screenshot of the Amplify response with the slip circled. Faculty and TFs
-- can now attach images to the comment, and the student sees them under it.
--
-- THE BOUNDARY is the comment's own: staff who may grade the activity read and
-- write; the student (or team) the result belongs to reads, and only once the
-- grade is RELEASED. An image is part of the judgement it illustrates and is
-- often attached days before release, so showing it earlier would put a
-- half-finished mark in front of the person it is about — the same reason
-- Assignments.tsx gates the comment text on status = 'scored'.
--
-- Same shape as recordings (0013) and submissions (0015): a private bucket
-- whose object path is {course}/{activity}/{result}/{uuid}.{ext}, a row per
-- object, and policies that authorise from the result id in segment 3 of the
-- path — so the row and the object are guarded by one question each, asked the
-- same way.
--
-- NOT EDITABLE, like a recording: an image can be attached and removed, never
-- swapped under an id somebody has already looked at.

do $$
declare missing text;
begin
  select string_agg(want.fn, ', ' order by want.fn)
    into missing
    from (values
      ('my_team_ids()'),
      ('owns_check_in(uuid)'),
      ('can_grade_check_in(uuid)'),
      ('recording_result_id(text)'),
      ('recording_path_matches(text)'),
      ('check_in_activity(uuid)'),
      ('was_on_team(uuid,uuid)')
    ) as want(fn)
   where to_regprocedure('public.' || want.fn) is null;

  if missing is not null then
    raise exception
      'Missing helper functions (%) -- run 0013, 0015, 0038 and 0045 before this file.',
      missing;
  end if;
end $$;

-- ------------------------------------------------------------------ the bucket
-- Images a browser renders everywhere, and nothing else. HEIC is left out on
-- purpose: Chrome and Firefox cannot draw it, and an image the student cannot
-- see is a comment they cannot read. 25 MB clears any screenshot and any phone
-- photo short of max-quality HDR, and stays under the Free plan's 50 MB.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'feedback', 'feedback', false, 26214400,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
on conflict (id) do nothing;

update storage.buckets
   set public = false,
       file_size_limit = 26214400,
       allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
 where id = 'feedback';

-- ------------------------------------------------------------------- the table
create table if not exists feedback_images (
  id          uuid primary key default gen_random_uuid(),
  result_id   uuid not null references check_in_results(id) on delete cascade,
  -- The object path, never a URL — a signed URL expires.
  path        text not null unique,
  mime        text check (mime in ('image/png', 'image/jpeg', 'image/webp', 'image/gif')),
  -- What the marker's file was called, shown in the viewer and used when the
  -- student downloads it. The object itself is stored under a uuid.
  name        text check (name is null or length(name) between 1 and 255),
  created_by  uuid default auth.uid() references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  constraint feedback_images_path_matches_result
    check (lower(split_part(path, '/', 3)) = result_id::text)
);

create index if not exists feedback_images_result_id_idx on feedback_images (result_id, created_at);

-- ---------------------------------------------------------------- the questions

/** May the caller attach or remove a feedback image on this result — staff who may grade it. */
create or replace function can_annotate_result(rid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from check_in_results r
     where r.id = rid
       and (owns_check_in(r.check_in_id) or can_grade_check_in(r.check_in_id)));
$$;

/**
 * May the caller SEE the feedback images on this result?
 *
 * Staff who may grade, always — so a TF whose grading is switched off stops
 * seeing them too, the same as the rest of the grading screen. The student or team it belongs to only once it is released —
 * and "team" includes a student who has since moved teams but was on this one
 * for this activity (0045), the same reach released marks have.
 */
create or replace function can_read_feedback(rid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select can_annotate_result(rid)
      or exists (
        select 1 from check_in_results r
         where r.id = rid
           and r.status = 'scored'
           and (
             (r.subject_type = 'student'
               and r.student_id in (select s.id from students s where s.user_id = auth.uid()))
             or (r.subject_type = 'team'
               and (r.team_id in (select my_team_ids())
                    or was_on_team(check_in_activity(r.check_in_id), r.team_id)))
           ));
$$;

grant execute on function can_annotate_result(uuid), can_read_feedback(uuid) to authenticated;

-- --------------------------------------------------------------- RLS: the rows
alter table feedback_images enable row level security;

drop policy if exists "read feedback_images" on feedback_images;
create policy "read feedback_images" on feedback_images
  for select to authenticated using (can_read_feedback(result_id));

drop policy if exists "write feedback_images" on feedback_images;
create policy "write feedback_images" on feedback_images
  for insert to authenticated
  -- recording_path_matches: the path's course and activity are the result's
  -- own, not just its result id, so a row can never name an object filed
  -- under somebody else's course.
  with check (
    can_annotate_result(result_id)
    and created_by = auth.uid()
    and recording_path_matches(path)
  );

drop policy if exists "delete feedback_images" on feedback_images;
create policy "delete feedback_images" on feedback_images
  for delete to authenticated using (can_annotate_result(result_id));

grant select, insert, delete on feedback_images to authenticated;

-- ------------------------------------------------------------ RLS: the objects
drop policy if exists "read feedback objects" on storage.objects;
create policy "read feedback objects" on storage.objects
  for select to authenticated
  using (bucket_id = 'feedback' and can_read_feedback(recording_result_id(name)));

drop policy if exists "write feedback objects" on storage.objects;
create policy "write feedback objects" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'feedback'
    and can_annotate_result(recording_result_id(name))
    and recording_path_matches(name)
  );

drop policy if exists "delete feedback objects" on storage.objects;
create policy "delete feedback objects" on storage.objects
  for delete to authenticated
  using (bucket_id = 'feedback' and can_annotate_result(recording_result_id(name)));
