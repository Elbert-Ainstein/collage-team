-- Which migrations are actually applied to THIS database?
--
-- Paste into Supabase → SQL Editor and run. Read-only: it writes nothing and
-- locks nothing, so it is safe against a live course.
--
-- Every row should say "applied". Anything else names the file to run.
--
-- Checks the thing the migration DID, not a version number — there is no
-- migration table here, and a file that was pasted but errored halfway would
-- leave a version row lying about what happened.

select '0014 activity questions' as migration,
       case when to_regclass('public.activity_questions') is not null
            then 'applied'
            else 'NOT APPLIED — run 0014_activity_questions.sql' end as status
union all
select '0015 submission PDFs',
       case when to_regclass('public.submission_files') is not null
             and exists (select 1 from storage.buckets where id = 'submissions')
            then 'applied'
            else 'NOT APPLIED — run 0015_submission_pdfs.sql' end
union all
select '0016 tutorial check-ins',
       case when to_regclass('public.tutorial_marks') is not null
             and to_regclass('public.tutorial_absences') is not null
            then 'applied'
            else 'NOT APPLIED — run 0016_tutorial_check_ins.sql' end
union all
select '0017 team resources',
       case when to_regclass('public.team_resources') is not null
             and exists (select 1 from storage.buckets where id = 'resources')
            then 'applied'
            else 'NOT APPLIED — run 0017_team_resources.sql' end
union all
select '0018 purge permissions',
       case when exists (
              select 1
                from pg_proc p
                join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public'
                 and p.proname = 'can_remove_team_resource')
            then 'applied'
            else 'NOT APPLIED — run 0018_purge_on_delete.sql' end
union all
select '0019 activity completion',
       case when exists (
              select 1
                from information_schema.columns
               where table_schema = 'public'
                 and table_name = 'activities'
                 and column_name = 'completion')
            then 'applied'
            else 'NOT APPLIED — run 0019_activity_completion.sql' end
union all
-- The one that matters most, and the only one you cannot see by looking at the
-- app: until it is in, deleting an activity a team set is filed under takes the
-- course's teams and every team result on every other activity with it.
--
-- confdeltype is the FK's ON DELETE rule: 'c' = CASCADE (the bug), 'n' = SET
-- NULL (fixed).
select '0021 keep a take in resources',
       case when exists (
              select 1
                from information_schema.columns
               where table_schema = 'public'
                 and table_name = 'recordings'
                 and column_name = 'in_resources')
            then 'applied'
            else 'NOT APPLIED — run 0021_recordings_in_resources.sql' end
union all
select '0022 photos up to 100MB',
       case when (select file_size_limit from storage.buckets where id = 'resources')
                 >= 104857600
            then 'applied'
            else 'NOT APPLIED — run 0022_bigger_photos.sql' end
union all
-- Counts rather than a boolean: 0023 backfills one row per existing Amplify, so
-- "how many are still missing theirs" is the only answer that means anything. A
-- course with no Amplify activities correctly reads 0 and says applied.
select '0023 amplify has an individual half',
       case when (select count(*)
                    from activities a
                   where a.type = 'amplify'
                     and not exists (select 1 from check_ins c
                                      where c.activity_id = a.id
                                        and c.kind = 'individual')) = 0
            then 'applied'
            else (select count(*)::text
                    from activities a
                   where a.type = 'amplify'
                     and not exists (select 1 from check_ins c
                                      where c.activity_id = a.id
                                        and c.kind = 'individual'))
                 || ' Amplify activities still have no individual check-in — run 0023' end
union all
select '0020 team sets survive activity delete',
       coalesce(
         (select case confdeltype
                   when 'n' then 'applied'
                   when 'c' then 'NOT APPLIED — deleting an activity still wipes the course''s teams. Run 0020.'
                   -- confdeltype is Postgres's internal "char" type, not text.
                   -- Concatenating it without a cast leaves || with no unique
                   -- candidate operator and the whole query fails to plan.
                   else 'unexpected ON DELETE rule: ' || confdeltype::text
                 end
            from pg_constraint
           where conrelid = 'public.team_sets'::regclass
             and contype = 'f'
             and conname = 'team_sets_activity_id_fkey'),
         'NOT FOUND — no FK by that name; check 0020 ran cleanly')
union all
select '0024 a mark can say not complete',
       case when exists (
              select 1
                from information_schema.columns
               where table_schema = 'public'
                 and table_name = 'check_in_results'
                 and column_name = 'ci_met')
            then 'applied'
            else 'NOT APPLIED — run 0024_not_complete_and_roles.sql' end
union all
-- guard_student_grading() has existed since 0006, so "is the function there"
-- proves nothing: 0024 replaced its body and dropped the flagged branch out of
-- it. The only honest test is to read the body back and look for the branch.
select '0025 students cannot clear their own flag',
       case when exists (
              select 1
                from pg_proc p
                join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public'
                 and p.proname = 'guard_student_grading'
                 and pg_get_functiondef(p.oid) like '%flagged%')
            then 'applied'
            else 'NOT APPLIED — run 0025_restore_flagged_guard.sql' end
union all
-- The one that is a live security hole until it runs: without it any signed-in
-- account can create a course, and a course is all you need to intercept a
-- classmate's work through the email claim.
select '0028 a roster row names only you',
       case when exists (
              select 1 from pg_trigger
               where tgrelid = 'public.students'::regclass
                 and tgname = 'trg_guard_student_identity')
            then 'applied'
            else 'NOT APPLIED — run 0028_only_staff_make_courses.sql' end
union all
-- 0029 empties the email sweep that 0028's roster guard cannot reach. Neither
-- depends on the other's tables any more, but run them in order anyway: 0028
-- tears down an allow-list that earlier cuts of it may have left behind.
select '0029 join a course by invite code',
       case when exists (
              select 1 from information_schema.tables
               where table_schema = 'public' and table_name = 'course_invites')
            then 'applied'
            else 'NOT APPLIED — run 0028 first, then 0029_invite_codes.sql' end
union all
-- THE ONE THAT DECIDES WHETHER A CLASS CAN JOIN ITSELF.
--
-- Both 0029 and 0030 define join_with_code(), so "does the function exist" is
-- not the question — 0029's version REFUSES anyone whose address the instructor
-- has not already imported ('... is not on its roster'), and 0030's creates the
-- roster row instead. Same name, opposite product. So read the body: the insert
-- exists only in 0030.
--
-- If this says NOT APPLIED, every student holding a valid code is turned away
-- until the instructor types their address in first, which is the behaviour
-- 0030 exists to end. It is create-or-replace and safe to re-run.
select '0030 the roster fills itself',
       case when to_regprocedure('public.join_with_code(text)') is null
            then 'NOT APPLIED — run 0029_invite_codes.sql first, then 0030_join_creates_the_roster.sql'
            when pg_get_functiondef(to_regprocedure('public.join_with_code(text)')) like '%insert into students%'
            then 'applied'
            else 'NOT APPLIED — still 0029: run 0030_join_creates_the_roster.sql' end
order by 1;

-- ------------------------------------------------------- and the buckets
--
-- Run this second. A bucket's file_size_limit is only ever a CEILING BELOW the
-- project-wide global limit (Storage → Settings → "Global file size limit"),
-- which is 50 MB on Free whatever a bucket says. So a bucket reading 100 MB
-- here does NOT prove a 100 MB upload will work — it proves the migration ran.
-- The only way to know the rest is to upload something big.

select id as bucket,
       public as is_public,
       round(file_size_limit / 1024.0 / 1024.0)::text || ' MB' as per_file_limit,
       array_to_string(allowed_mime_types, ', ') as accepts
  from storage.buckets
 where id in ('recordings', 'submissions', 'resources', 'activity-files')
 order by id;
