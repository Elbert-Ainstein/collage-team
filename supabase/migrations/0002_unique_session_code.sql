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

-- 1. Move dependents off duplicate rows onto the oldest row for that code.
with ranked as (
  select id, code,
         first_value(id) over (partition by code order by created_at, id) as keeper
  from courses
  where code is not null
)
update students s set course_id = r.keeper
from ranked r where s.course_id = r.id and r.id <> r.keeper;

with ranked as (
  select id, code,
         first_value(id) over (partition by code order by created_at, id) as keeper
  from courses
  where code is not null
)
update activities a set course_id = r.keeper
from ranked r where a.course_id = r.id and r.id <> r.keeper;

with ranked as (
  select id, code,
         first_value(id) over (partition by code order by created_at, id) as keeper
  from courses
  where code is not null
)
update team_sets t set course_id = r.keeper
from ranked r where t.course_id = r.id and r.id <> r.keeper;

-- 2. Drop the now-empty duplicates.
delete from courses c
using (
  select id, first_value(id) over (partition by code order by created_at, id) as keeper
  from courses
  where code is not null
) r
where c.id = r.id and r.id <> r.keeper;

-- 3. Make it impossible to recreate.
create unique index if not exists uniq_course_code on courses (code) where code is not null;
