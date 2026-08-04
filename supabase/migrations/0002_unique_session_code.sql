-- One row per session code.
--
-- The app provisions the AP50A / AP50B sessions on load. Without a constraint,
-- two concurrent loads (React's dev double-invoke, two tabs, two people opening
-- the app at once) could each see the session as missing and both insert it,
-- leaving duplicate sessions with split rosters. The database is the only place
-- that can settle that race, so it is enforced here.
--
-- Run this in Supabase → SQL Editor. It de-duplicates first, keeping the oldest
-- row of each code and re-parenting its students, activities and team sets, so
-- no data is stranded.

-- RE-RUN SAFETY. When this was written every code was globally unique. 0003
-- replaced that with uniq_course_owner_code precisely so every account
-- provisions its own AP50A and AP50B. Partitioning by `code` alone after 0003
-- would treat every instructor's AP50A as a duplicate of one arbitrary keeper,
-- re-parent their students and activities onto a stranger's course, and delete
-- the rest.
--
-- So the partition key is chosen at RUN time: (owner_id, code) once owner_id
-- exists, `code` alone before it. Dynamic SQL because a static reference to
-- owner_id would fail to parse on a database that predates 0003 — including a
-- fresh one running these files in order.
do $$
declare
  part text := case
    when exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'courses' and column_name = 'owner_id'
    ) then 'owner_id, code'
    else 'code'
  end;
  t text;
begin
  -- 1. Move dependents off duplicate rows onto the oldest row for that group.
  foreach t in array array['students', 'activities', 'team_sets'] loop
    execute format($q$
      with ranked as (
        select id, first_value(id) over (partition by %s order by created_at, id) as keeper
        from courses where code is not null
      )
      update %I d set course_id = r.keeper
      from ranked r where d.course_id = r.id and r.id <> r.keeper
    $q$, part, t);
  end loop;

  -- 2. Drop the now-empty duplicates.
  execute format($q$
    delete from courses c using (
      select id, first_value(id) over (partition by %s order by created_at, id) as keeper
      from courses where code is not null
    ) r
    where c.id = r.id and r.id <> r.keeper
  $q$, part);

  -- 3. Make it impossible to recreate. Skipped once 0003 has replaced this
  --    index with the owner-scoped one, which is the stronger statement.
  if part = 'code' then
    execute 'create unique index if not exists uniq_course_code on courses (code) where code is not null';
  end if;
end $$;

