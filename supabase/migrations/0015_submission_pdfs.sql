-- Student submissions as a PDF, with pages assigned to questions.
--
-- Run in Supabase → SQL Editor, after 0014. Safe to re-run.
--
-- The flow this serves, which is Gradescope's: a student uploads ONE pdf of
-- their work, then says which pages answer which question. Grading then opens
-- straight to the right pages instead of asking a marker to hunt through a
-- scan — which is the whole reason the mapping is worth collecting.
--
-- Two tables and a bucket:
--   submission_files  one row per uploaded pdf, pointing at the object
--   submission_pages  which page answers which question, many-to-many
--
-- Pages are 1-BASED, the numbers a person reads off the page, not 0-based
-- indices. Getting that wrong is invisible until somebody is marking the wrong
-- page, so it is stated here and checked below.

-- ------------------------------------------------------------------ bucket
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('submissions', 'submissions', false, 52428800, array['application/pdf'])
on conflict (id) do nothing;

-- Restated unconditionally: a bucket someone created by hand earlier must not
-- leave a class's work public.
update storage.buckets
   set public = false,
       file_size_limit = 52428800,
       allowed_mime_types = array['application/pdf']
 where id = 'submissions';

-- ------------------------------------------------------------------ tables
create table if not exists submission_files (
  id         uuid primary key default gen_random_uuid(),
  result_id  uuid not null references check_in_results(id) on delete cascade,
  path       text not null,
  /** Read from the pdf at upload, so the page pickers do not have to re-parse it. */
  page_count int not null check (page_count > 0),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  -- One pdf per submission. Re-uploading replaces it rather than accumulating
  -- copies nobody can tell apart.
  unique (result_id)
);

create table if not exists submission_pages (
  id          uuid primary key default gen_random_uuid(),
  result_id   uuid not null references check_in_results(id) on delete cascade,
  question_id uuid not null references activity_questions(id) on delete cascade,
  -- 1-based, as printed on the page.
  page        int not null check (page > 0),
  created_at  timestamptz not null default now(),
  -- A page may answer several questions, and a question may span several pages;
  -- what cannot happen is the same page listed twice for one question.
  unique (result_id, question_id, page)
);

create index if not exists idx_submission_pages_result on submission_pages (result_id);

-- --------------------------------------------------------------------- RLS
alter table submission_files enable row level security;
alter table submission_pages enable row level security;

-- can_read_result / can_write_result come from 0013 and already express exactly
-- this: your own work, your team's, the course owner, and a TF who may grade.
-- Reusing them keeps one answer to "whose submission is this".
drop policy if exists "read submission_files" on submission_files;
create policy "read submission_files" on submission_files
  for select to authenticated using (can_read_result(result_id));

drop policy if exists "write submission_files" on submission_files;
create policy "write submission_files" on submission_files
  for insert to authenticated
  with check (can_write_result(result_id) and created_by = auth.uid());

drop policy if exists "replace submission_files" on submission_files;
create policy "replace submission_files" on submission_files
  for delete to authenticated using (can_remove_result_audio(result_id));

drop policy if exists "read submission_pages" on submission_pages;
create policy "read submission_pages" on submission_pages
  for select to authenticated using (can_read_result(result_id));

-- The mapping is the student's statement about their own work, so it follows
-- the same rule as the work: theirs or their team's to write, and it stops
-- being theirs once it has been graded — the guard on check_in_results says a
-- scored row is closed, and re-pointing pages afterwards would move what a
-- marker already looked at.
drop policy if exists "write submission_pages" on submission_pages;
create policy "write submission_pages" on submission_pages
  for insert to authenticated
  with check (
    can_write_result(result_id)
    and not exists (
      select 1 from check_in_results r where r.id = result_id and r.status = 'scored')
  );

drop policy if exists "clear submission_pages" on submission_pages;
create policy "clear submission_pages" on submission_pages
  for delete to authenticated
  using (
    can_remove_result_audio(result_id)
    and not exists (
      select 1 from check_in_results r where r.id = result_id and r.status = 'scored')
  );

-- A page must belong to a question of the SAME activity as the submission it is
-- filed under. Nothing in the policies above says so — they only ask whose
-- result it is — and a mapping pointing at another activity's question would
-- put a marker on a page that answers something else entirely.
create or replace function guard_submission_page() returns trigger
language plpgsql security definer set search_path = public as $$
declare ok boolean;
begin
  select exists (
    select 1
      from check_in_results r
      join check_ins ci on ci.id = r.check_in_id
      join activity_questions q on q.id = new.question_id
     where r.id = new.result_id
       and q.activity_id = ci.activity_id)
    into ok;

  if not ok then
    raise exception 'That question belongs to a different activity';
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_submission_page on submission_pages;
create trigger trg_guard_submission_page
  before insert or update on submission_pages
  for each row execute function guard_submission_page();

-- ------------------------------------------------------------ storage rules
-- Same shape as 0013: the path's third segment is the result id, so a policy
-- authorises from the path alone. recording_result_id() reads segment 3 and
-- returns NULL on a malformed path, which every check below then fails closed.
drop policy if exists "read submission objects" on storage.objects;
create policy "read submission objects" on storage.objects
  for select to authenticated
  using (bucket_id = 'submissions' and can_read_result(recording_result_id(name)));

drop policy if exists "write submission objects" on storage.objects;
create policy "write submission objects" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'submissions'
    and can_write_result(recording_result_id(name))
    and recording_path_matches(name)
  );

drop policy if exists "delete submission objects" on storage.objects;
create policy "delete submission objects" on storage.objects
  for delete to authenticated
  using (bucket_id = 'submissions' and can_remove_result_audio(recording_result_id(name)));

grant select, insert, delete on submission_files, submission_pages to authenticated;
