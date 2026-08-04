-- The faculty Activities redesign: weeks, question/point structure, rubric
-- ladders, per-question marks, and teaching fellows.
--
-- Run in Supabase → SQL Editor, after 0006. Safe to re-run.
--
-- Four modelling decisions are worth stating, because each had a plausible
-- alternative that would have cost us later.
--
-- 1. A GRADEBOOK COLUMN IS AN ACTIVITY; A CELL IS STILL A CHECK-IN RESULT.
--    The new column view shows one column per activity, not one per check-in.
--    That does NOT require re-pointing check_in_results: a `both`-scope
--    activity already owns two check-ins (iRAT + tRAT), so one column can read
--    the individual check-in on student rows and the team check-in on team
--    rows. Cell identity stays (check_in, subject), check_in_id stays NOT NULL,
--    and every RLS helper that walks through check_ins keeps working.
--
-- 2. POINTS LIVE ON THE ACTIVITY, DERIVED NEVER STORED TWICE.
--    question_count × points_per_question IS the total; there is no
--    points_total column to drift from it. check_ins.max_points is kept in
--    step by the data layer because the student view renders it directly.
--
-- 3. A SCORE IS DERIVED FROM THE PICKED RUBRIC ROWS, WITH ONE WRITER.
--    submission_marks holds which rubric ROW was picked per question — the row,
--    not its point value, so two rows sharing a deduction stay distinct.
--    check_in_results.score is recomputed from those marks by
--    recompute_result_score(), called from a trigger on submission_marks. It is
--    a cache with exactly one writer, which is what keeps it from drifting.
--
-- 4. A TF IS NOT A ROLE. profiles.role is pinned against escalation by 0006
--    and is chosen by the person signing up; a teaching fellow is instead
--    someone the instructor listed on the course, matched by email exactly as
--    students are. That also lets a TF be added before they have an account.

-- ------------------------------------------------------------------- weeks
-- The row view groups by week and needs a name and dates per week, and "New
-- week" is a real action. Previously dates_label hung off each activity, which
-- could disagree between two activities in the same week.
create table if not exists course_weeks (
  id          uuid primary key default gen_random_uuid(),
  course_id   uuid not null references courses(id) on delete cascade,
  week        int  not null,
  dates_label text,
  created_at  timestamptz not null default now(),
  unique (course_id, week)
);

-- Which week is "live" — the only one whose team cells pulse while a
-- discussion is running.
alter table courses add column if not exists live_week int;

-- --------------------------------------------------- questions and points
alter table activities add column if not exists question_count int not null default 5;
alter table activities add column if not exists points_per_question numeric not null default 1;
alter table activities add column if not exists due_at timestamptz;
alter table activities
  drop constraint if exists activities_question_shape;
alter table activities add constraint activities_question_shape
  check (question_count > 0 and points_per_question >= 0);

-- Seed the per-type defaults the design specifies, for rows that predate this.
update activities set question_count = 10, points_per_question = 5
  where type = 'combo' and question_count = 5 and points_per_question = 1;
update activities set question_count = 5, points_per_question = 2
  where type = 'skills' and question_count = 5 and points_per_question = 1;
update activities set question_count = 3, points_per_question = 1
  where type = 'amplify' and question_count = 5 and points_per_question = 1;

-- ------------------------------------------------- submission bookkeeping
-- updated_at is bumped by grading, so it cannot answer "when was this handed
-- in". Feedback is the instructor's note; `text` is the student's own work.
alter table check_in_results add column if not exists submitted_at timestamptz;
alter table check_in_results add column if not exists feedback text;

-- Back-fill: anything already submitted was submitted at least by the last
-- time its row was touched. Better than pretending it never happened.
update check_in_results
   set submitted_at = updated_at
 where submitted_at is null
   and status in ('submitted', 'needs_review', 'scored', 'discussing');

-- -------------------------------------------------------- rubric ladders
-- The deduction ladder for an activity, shared by the criteria editor and the
-- grading screen so an edit in one is immediately visible in the other.
create table if not exists rubric_items (
  id          uuid primary key default gen_random_uuid(),
  activity_id uuid not null references activities(id) on delete cascade,
  row_index   int  not null,
  description text not null,
  deduction   numeric not null default 1,
  is_custom   boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (activity_id, row_index)
);
create index if not exists idx_rubric_activity on rubric_items (activity_id, row_index);

-- Which ladder ROW was picked for each question of one submission. Storing the
-- row and not the deduction is deliberate: two rows may carry the same points.
create table if not exists submission_marks (
  id             uuid primary key default gen_random_uuid(),
  result_id      uuid not null references check_in_results(id) on delete cascade,
  question_index int  not null,
  rubric_item_id uuid not null references rubric_items(id) on delete cascade,
  created_at     timestamptz not null default now(),
  unique (result_id, question_index)
);
create index if not exists idx_marks_result on submission_marks (result_id);

/**
 * Recompute one submission's score from its picked rubric rows.
 *
 * total points minus every deduction picked. Called from a trigger so the
 * score can never disagree with the marks that produced it.
 */
create or replace function recompute_result_score(rid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  total numeric;
  taken numeric;
begin
  select a.question_count * a.points_per_question
    into total
    from check_in_results r
    join check_ins ci on ci.id = r.check_in_id
    join activities a on a.id = ci.activity_id
   where r.id = rid;

  if total is null then
    return;
  end if;

  select coalesce(sum(ri.deduction), 0)
    into taken
    from submission_marks m
    join rubric_items ri on ri.id = m.rubric_item_id
   where m.result_id = rid;

  update check_in_results
     set score = greatest(total - taken, 0),
         updated_at = now()
   where id = rid;
end $$;

create or replace function trg_marks_rescore() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform recompute_result_score(coalesce(new.result_id, old.result_id));
  return coalesce(new, old);
end $$;

drop trigger if exists trg_submission_marks_rescore on submission_marks;
create trigger trg_submission_marks_rescore
  after insert or update or delete on submission_marks
  for each row execute function trg_marks_rescore();

-- ---------------------------------------------------------------- the TFs
create table if not exists course_tfs (
  id          uuid primary key default gen_random_uuid(),
  course_id   uuid not null references courses(id) on delete cascade,
  name        text not null,
  email       text,
  avatar_tint text,
  user_id     uuid references auth.users(id) on delete set null,
  position    int  not null default 0,
  created_at  timestamptz not null default now()
);
create unique index if not exists uniq_tf_user_course
  on course_tfs (course_id, user_id) where user_id is not null;
create index if not exists idx_tf_email on course_tfs (lower(email));

-- Course-wide, not per person. An earlier iteration had them per TF; the
-- design is explicit that it applies to every TF on the course.
alter table courses add column if not exists tf_can_grade   boolean not null default true;
alter table courses add column if not exists tf_can_checkin boolean not null default false;

/** Attach this account to any TF rows carrying its address. Mirrors claim_student_rows. */
create or replace function claim_tf_rows() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update course_tfs t
     set user_id = auth.uid()
   where t.id in (
     select distinct on (c.course_id) c.id
       from course_tfs c, auth.users u
      where u.id = auth.uid()
        and c.user_id is null
        and c.email is not null
        and lower(c.email) = lower(u.email)
      order by c.course_id, c.created_at, c.id
   );
  get diagnostics n = row_count;
  return n;
end $$;

grant execute on function claim_tf_rows() to authenticated;

/** Courses the caller is a teaching fellow on. */
create or replace function my_tf_course_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select t.course_id from course_tfs t where t.user_id = auth.uid();
$$;

/** May the caller put marks on this course — as its owner, or as a TF allowed to grade? */
create or replace function can_grade_course(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from courses c where c.id = cid and c.owner_id = auth.uid())
      or exists (
        select 1 from course_tfs t
          join courses c on c.id = t.course_id
         where t.course_id = cid and t.user_id = auth.uid() and c.tf_can_grade);
$$;

/** The same question, asked about a check-in. */
create or replace function can_grade_check_in(ciid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from check_ins ci
      join activities a on a.id = ci.activity_id
     where ci.id = ciid and can_grade_course(a.course_id));
$$;

grant execute on function my_tf_course_ids(), can_grade_course(uuid), can_grade_check_in(uuid)
  to authenticated;

-- ----------------------------------------------------------- RLS: the TFs
alter table course_weeks      enable row level security;
alter table rubric_items      enable row level security;
alter table submission_marks  enable row level security;
alter table course_tfs        enable row level security;

-- Weeks: the instructor writes them; anyone who can see the course reads them.
drop policy if exists "own course_weeks" on course_weeks;
create policy "own course_weeks" on course_weeks
  for all to authenticated
  using (owns_course(course_id)) with check (owns_course(course_id));

drop policy if exists "read course_weeks" on course_weeks;
create policy "read course_weeks" on course_weeks
  for select to authenticated
  using (course_id in (select my_course_ids()) or course_id in (select my_tf_course_ids()));

-- The TF list belongs to the instructor. A TF may see their own row, which is
-- what lets the app recognise them; naming the other TFs is not their business.
drop policy if exists "own course_tfs" on course_tfs;
create policy "own course_tfs" on course_tfs
  for all to authenticated
  using (owns_course(course_id)) with check (owns_course(course_id));

drop policy if exists "tf reads own row" on course_tfs;
create policy "tf reads own row" on course_tfs
  for select to authenticated using (user_id = auth.uid());

-- Criteria are faculty-authored and TF-readable: "TFs with grading permission
-- use these criteria" — use, not rewrite.
drop policy if exists "own rubric_items" on rubric_items;
create policy "own rubric_items" on rubric_items
  for all to authenticated
  using (exists (select 1 from activities a where a.id = rubric_items.activity_id
                   and owns_course(a.course_id)))
  with check (exists (select 1 from activities a where a.id = rubric_items.activity_id
                   and owns_course(a.course_id)));

drop policy if exists "tf reads rubric_items" on rubric_items;
create policy "tf reads rubric_items" on rubric_items
  for select to authenticated
  using (exists (select 1 from activities a where a.id = rubric_items.activity_id
                   and a.course_id in (select my_tf_course_ids())));

-- Marks are grading, so they follow the grading permission exactly.
drop policy if exists "grade submission_marks" on submission_marks;
create policy "grade submission_marks" on submission_marks
  for all to authenticated
  using (exists (select 1 from check_in_results r where r.id = submission_marks.result_id
                   and can_grade_check_in(r.check_in_id)))
  with check (exists (select 1 from check_in_results r where r.id = submission_marks.result_id
                   and can_grade_check_in(r.check_in_id)));

-- A TF who may grade needs to read the course they are grading, and to write
-- the result rows. These are additive: 0003/0004 keep the owner's access and
-- 0006 keeps the student's.
drop policy if exists "tf reads course" on courses;
create policy "tf reads course" on courses
  for select to authenticated using (id in (select my_tf_course_ids()));

drop policy if exists "tf reads students" on students;
create policy "tf reads students" on students
  for select to authenticated using (course_id in (select my_tf_course_ids()));

drop policy if exists "tf reads activities" on activities;
create policy "tf reads activities" on activities
  for select to authenticated using (course_id in (select my_tf_course_ids()));

drop policy if exists "tf reads team_sets" on team_sets;
create policy "tf reads team_sets" on team_sets
  for select to authenticated using (course_id in (select my_tf_course_ids()));

drop policy if exists "tf reads teams" on teams;
create policy "tf reads teams" on teams
  for select to authenticated
  using (exists (select 1 from team_sets ts where ts.id = teams.team_set_id
                   and ts.course_id in (select my_tf_course_ids())));

drop policy if exists "tf reads team_members" on team_members;
create policy "tf reads team_members" on team_members
  for select to authenticated
  using (exists (select 1 from teams t join team_sets ts on ts.id = t.team_set_id
                  where t.id = team_members.team_id
                    and ts.course_id in (select my_tf_course_ids())));

drop policy if exists "tf reads check_ins" on check_ins;
create policy "tf reads check_ins" on check_ins
  for select to authenticated
  using (exists (select 1 from activities a where a.id = check_ins.activity_id
                   and a.course_id in (select my_tf_course_ids())));

drop policy if exists "tf grades results" on check_in_results;
create policy "tf grades results" on check_in_results
  for all to authenticated
  using (can_grade_check_in(check_in_id)) with check (can_grade_check_in(check_in_id));

-- --------------------------------------------- the grading guard, widened
-- 0006 exempted only the course OWNER from the student restrictions, which
-- would have blocked every mark a teaching fellow makes. The test is now "may
-- this account grade this course" — owner, or TF with the grading permission.
-- Role is still not consulted: it is self-selected at sign-up and therefore
-- cannot be a security boundary.
create or replace function guard_student_grading() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if can_grade_check_in(new.check_in_id) then
    return new;
  end if;

  if new.status not in ('none', 'draft', 'submitted', 'discussing') then
    raise exception 'Students can submit work, but not grade it';
  end if;

  if new.score is not null then
    raise exception 'Students cannot set their own grade';
  end if;

  if tg_op = 'UPDATE' then
    if old.status = 'scored' then
      raise exception 'This has already been graded - ask your instructor to reopen it';
    end if;
    if new.is_ci is distinct from old.is_ci then
      raise exception 'Students cannot set their own grade';
    end if;
    if new.check_in_id is distinct from old.check_in_id
       or new.subject_type is distinct from old.subject_type
       or new.student_id is distinct from old.student_id
       or new.team_id is distinct from old.team_id then
      raise exception 'A submission cannot be moved to a different check-in or owner';
    end if;
    if new.flagged is distinct from old.flagged then
      raise exception 'Only your instructor can change that';
    end if;
    if new.feedback is distinct from old.feedback then
      raise exception 'Only your instructor can leave feedback';
    end if;
  elsif new.is_ci then
    raise exception 'Students cannot set their own grade';
  end if;

  return new;
end $$;

grant select, insert, update, delete on course_weeks, rubric_items, submission_marks, course_tfs
  to authenticated;
