-- Projects: grading a project fair, one team at a time.
--
-- Run in Supabase → SQL Editor, after 0058. Safe to re-run.
--
-- A project is not an activity. Students hand nothing in and see nothing here;
-- it is a rubric the staff carry round the room, like the check-in sheet.
-- The instructor writes the categories ("Robustness"), each a 1–5 scale with a
-- sentence for what each point looks like. At the fair, a grader opens a team,
-- takes one of its grader slots (Grader 1, Grader 2, …), and for every
-- category picks a score and says why. When every category has both, they
-- mark it done.
--
--   projects            one per project fair: its title and how many graders
--                       each team should get
--   project_categories  the rubric, in order
--   project_gradings    one grader's go at one team: who, and whether done
--   project_scores      one category of one grading: the score and the reason
--
-- What this file guarantees, because the app hiding a button is not a rule:
--   - Students read and write none of it. Staff of the course (the owner and
--     every TF on it) read all of it; the owner writes the projects and their
--     categories; whoever may grade the course writes the gradings.
--   - A grading is marked done only when it names its grader and every
--     category has a score and a reason. While it is done, no score can be
--     cleared and no reason blanked: reopen it first.
--   - A category added to a project reopens every done grading on it, because
--     none of them has scored it yet.
--   - A project grades the teams of one team set. Until the first grade it
--     follows the course's current set; the first grade fixes the set the
--     graded team belongs to, and a team from any other set is refused after
--     that. Re-forming the class later does not move a project's grades.

-- ---------------------------------------------------------------- prereqs
do $$
begin
  if to_regprocedure('public.can_grade_course(uuid)') is null then
    raise exception 'Missing can_grade_course -- run every migration through 0058 before this file.';
  end if;
  if to_regclass('public.course_tfs') is null or to_regclass('public.team_sets') is null then
    raise exception 'Missing course_tfs or team_sets -- run every migration through 0058 before this file.';
  end if;
end $$;

-- ------------------------------------------------------------------ tables
create table if not exists projects (
  id               uuid primary key default gen_random_uuid(),
  course_id        uuid not null references courses(id) on delete cascade,
  title            text not null check (length(btrim(title)) between 1 and 200),
  -- How many grader slots each team shows. More can be added on a team.
  graders_per_team int  not null default 2 check (graders_per_team between 1 and 8),
  -- The teams being graded. Null: the course's current set, until the first
  -- grade fixes it (guard_project_grading below).
  team_set_id      uuid references team_sets(id) on delete set null,
  position         int  not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists projects_course_idx on projects (course_id, position);

create table if not exists project_categories (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  position   int  not null default 0,
  name       text not null check (length(btrim(name)) between 1 and 120),
  -- What each point means: levels[0] describes a 1, levels[4] a 5.
  levels     jsonb not null default '["", "", "", "", ""]'::jsonb
             check (jsonb_typeof(levels) = 'array' and jsonb_array_length(levels) = 5),
  created_at timestamptz not null default now(),
  unique (id, project_id)
);
create index if not exists project_categories_project_idx on project_categories (project_id, position);

create table if not exists project_gradings (
  project_id  uuid not null references projects(id) on delete cascade,
  team_id     uuid not null references teams(id) on delete cascade,
  -- Grader 1, Grader 2, …: each grader on a team has their own slot, so two
  -- people grading the same team at once never write the same rows.
  slot        int  not null check (slot between 1 and 20),
  -- A name rather than an account: a guest judge grades from a TF's iPad.
  grader_name text not null default '' check (length(grader_name) <= 120),
  done_at     timestamptz,
  -- Whoever last wrote it, for when a name was typed wrong.
  updated_by  uuid,
  updated_at  timestamptz not null default now(),
  primary key (project_id, team_id, slot)
);
create index if not exists project_gradings_team_idx on project_gradings (team_id);

create table if not exists project_scores (
  project_id  uuid not null,
  team_id     uuid not null,
  slot        int  not null,
  category_id uuid not null,
  -- Both required before the grading can be marked done. Either can come
  -- first: a reason written before the score is picked is still saved.
  score       int  check (score between 1 and 5),
  reason      text not null default '' check (length(reason) <= 4000),
  updated_at  timestamptz not null default now(),
  primary key (project_id, team_id, slot, category_id),
  foreign key (project_id, team_id, slot)
    references project_gradings (project_id, team_id, slot) on delete cascade,
  foreign key (category_id, project_id)
    references project_categories (id, project_id) on delete cascade
);
create index if not exists project_scores_category_idx on project_scores (category_id);

-- --------------------------------------------------------------- helpers
-- Definer with a fixed search_path, like 0058's: they read courses and
-- course_tfs, whose own policies would otherwise be applied inside a policy.

create or replace function project_course(pid uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select course_id from projects where id = pid;
$$;

/** The owner of this course, or any TF on it. */
create or replace function project_staff(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from courses c where c.id = cid and c.owner_id = auth.uid())
      or exists (select 1 from course_tfs t where t.course_id = cid and t.user_id = auth.uid());
$$;

create or replace function project_owner(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from courses c where c.id = cid and c.owner_id = auth.uid());
$$;

-- ---------------------------------------------------------------- guards
create or replace function guard_project() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.course_id is distinct from old.course_id then
    raise exception 'A project can''t move to another course';
  end if;
  if new.team_set_id is not null and not exists (
    select 1 from team_sets s where s.id = new.team_set_id and s.course_id = new.course_id)
  then
    raise exception 'Those teams aren''t on this project''s course';
  end if;
  if tg_op = 'UPDATE'
     and old.team_set_id is not null
     and new.team_set_id is distinct from old.team_set_id
     and exists (select 1 from project_gradings g where g.project_id = old.id) then
    raise exception 'Teams have been graded on this project, so it keeps the teams it has';
  end if;
  new.title := btrim(new.title);
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_guard_project on projects;
create trigger trg_guard_project
  before insert or update on projects
  for each row execute function guard_project();

create or replace function guard_project_grading() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  p      projects;
  set_id uuid;
begin
  if tg_op = 'UPDATE' and (new.project_id, new.team_id, new.slot)
                          is distinct from (old.project_id, old.team_id, old.slot) then
    raise exception 'A grading can''t move to another team or slot';
  end if;

  select * into p from projects where id = new.project_id;
  select t.team_set_id into set_id
    from teams t join team_sets s on s.id = t.team_set_id
   where t.id = new.team_id and s.course_id = p.course_id;
  if set_id is null then
    raise exception 'That team isn''t on this project''s course';
  end if;
  if p.team_set_id is null then
    -- The first grade fixes which teams this project grades.
    update projects set team_set_id = set_id where id = p.id;
  elsif p.team_set_id <> set_id then
    raise exception 'That team isn''t one of the teams this project grades';
  end if;

  new.grader_name := btrim(new.grader_name);

  if new.done_at is not null then
    if tg_op = 'UPDATE' and old.done_at is not null then
      -- Still done: keep when it was first marked.
      new.done_at := old.done_at;
    else
      new.done_at := now();
    end if;
    if new.grader_name = '' then
      raise exception 'Say who is grading before marking it done';
    end if;
    if exists (
      select 1 from project_categories c
       where c.project_id = new.project_id
         and not exists (
           select 1 from project_scores x
            where x.project_id = new.project_id and x.team_id = new.team_id
              and x.slot = new.slot and x.category_id = c.id
              and x.score is not null and btrim(x.reason) <> ''))
    then
      raise exception 'Give every category a score and say why before marking it done';
    end if;
  end if;

  new.updated_by := coalesce(auth.uid(), new.updated_by);
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_guard_project_grading on project_gradings;
create trigger trg_guard_project_grading
  before insert or update on project_gradings
  for each row execute function guard_project_grading();

create or replace function guard_project_score() returns trigger
language plpgsql security definer set search_path = public as $$
declare done timestamptz;
begin
  if tg_op = 'DELETE' then
    -- A cascade — the grading, category, team or project going — takes its
    -- scores with it whatever state they were in.
    if pg_trigger_depth() > 1 then
      return old;
    end if;
    select g.done_at into done from project_gradings g
     where g.project_id = old.project_id and g.team_id = old.team_id and g.slot = old.slot;
    if done is not null then
      raise exception 'This grading is marked done — reopen it to clear a score';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' and (new.project_id, new.team_id, new.slot, new.category_id)
                          is distinct from (old.project_id, old.team_id, old.slot, old.category_id) then
    raise exception 'A score can''t move to another grading or category';
  end if;

  -- The first score is what opens a grading: one write, not two.
  insert into project_gradings (project_id, team_id, slot)
  values (new.project_id, new.team_id, new.slot)
  on conflict do nothing;

  select g.done_at into done from project_gradings g
   where g.project_id = new.project_id and g.team_id = new.team_id and g.slot = new.slot;
  if done is not null and (new.score is null or btrim(new.reason) = '') then
    raise exception 'This grading is marked done, so every category needs a score and a reason';
  end if;

  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_guard_project_score on project_scores;
create trigger trg_guard_project_score
  before insert or update or delete on project_scores
  for each row execute function guard_project_score();

-- A new category hasn't been scored by anyone: every done grading on the
-- project goes back to in progress until it is.
create or replace function project_category_added() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update project_gradings set done_at = null
   where project_id = new.project_id and done_at is not null;
  return null;
end $$;

drop trigger if exists trg_project_category_added on project_categories;
create trigger trg_project_category_added
  after insert on project_categories
  for each row execute function project_category_added();

-- ------------------------------------------------------------------- RLS
alter table projects           enable row level security;
alter table project_categories enable row level security;
alter table project_gradings   enable row level security;
alter table project_scores     enable row level security;

revoke all on projects, project_categories, project_gradings, project_scores from anon, authenticated;
grant select, insert, update, delete
  on projects, project_categories, project_gradings, project_scores to authenticated;

drop policy if exists "staff read projects" on projects;
create policy "staff read projects" on projects
  for select to authenticated using (project_staff(course_id));

drop policy if exists "owner writes projects" on projects;
create policy "owner writes projects" on projects
  for all to authenticated
  using (project_owner(course_id))
  with check (project_owner(course_id));

drop policy if exists "staff read project_categories" on project_categories;
create policy "staff read project_categories" on project_categories
  for select to authenticated using (project_staff(project_course(project_id)));

drop policy if exists "owner writes project_categories" on project_categories;
create policy "owner writes project_categories" on project_categories
  for all to authenticated
  using (project_owner(project_course(project_id)))
  with check (project_owner(project_course(project_id)));

drop policy if exists "staff read project_gradings" on project_gradings;
create policy "staff read project_gradings" on project_gradings
  for select to authenticated using (project_staff(project_course(project_id)));

drop policy if exists "graders write project_gradings" on project_gradings;
create policy "graders write project_gradings" on project_gradings
  for all to authenticated
  using (can_grade_course(project_course(project_id)))
  with check (can_grade_course(project_course(project_id)));

drop policy if exists "staff read project_scores" on project_scores;
create policy "staff read project_scores" on project_scores
  for select to authenticated using (project_staff(project_course(project_id)));

drop policy if exists "graders write project_scores" on project_scores;
create policy "graders write project_scores" on project_scores
  for all to authenticated
  using (can_grade_course(project_course(project_id)))
  with check (can_grade_course(project_course(project_id)));

-- Policies run as the caller, so the caller needs the three helpers. The
-- trigger functions are for nobody to call.
revoke all on function
  project_course(uuid), project_staff(uuid), project_owner(uuid),
  guard_project(), guard_project_grading(), guard_project_score(), project_category_added()
  from public, anon, authenticated;
grant execute on function project_course(uuid), project_staff(uuid), project_owner(uuid)
  to authenticated;

-- ------------------------------------------------------------- realtime
-- Several graders work one fair from their own phones: the team list's
-- progress dots and an open grading follow what the others write. Realtime
-- sends a row only to a client whose RLS lets it read that row, so students
-- get nothing. FULL identity so a delete still carries project_id for the
-- filter to match on.
do $$ begin
  alter publication supabase_realtime add table projects;
exception when duplicate_object or undefined_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table project_categories;
exception when duplicate_object or undefined_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table project_gradings;
exception when duplicate_object or undefined_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table project_scores;
exception when duplicate_object or undefined_object then null; end $$;

alter table project_categories replica identity full;
alter table project_gradings   replica identity full;
alter table project_scores     replica identity full;
