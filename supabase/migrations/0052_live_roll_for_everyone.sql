-- Live questions, team mode: the whole team watches the roll being taken.
--
-- Run in Supabase → SQL Editor, after 0051. Safe to re-run.
--
-- In 0051 the leader ticked who was absent on their own phone and saved it all
-- at once, while everyone else waited. Now the roll shows on every phone like
-- any other question: each tap the leader makes is saved as it lands, so the
-- team sees it (tutorial_absences is published already, 0043), and the team
-- moves on to play only once the leader says the roll is done.
--
-- What changes:
--   - set_live_absences(aid, absent, done): new. With done false it saves the
--     roll without finishing it — roll_at stays as it was. With done true it
--     is 0051's set_live_absences exactly.
--   - set_live_absences(aid, absent), 0051's, now calls it with done true, so
--     a phone still running the old app takes the roll as before. It keeps
--     its two arguments: one function with a defaulted third would make every
--     two-argument call ambiguous.

-- ---------------------------------------------------------------- prereqs
do $$
declare missing text;
begin
  select string_agg(want.fn, ', ' order by want.fn)
    into missing
    from (values
      ('live_team_caller(uuid)'),
      ('live_setup_for_update(uuid, uuid)'),
      ('live_team_leader(uuid, uuid)'),
      ('set_live_absences(uuid, uuid[])')
    ) as want(fn)
   where to_regprocedure('public.' || want.fn) is null;

  if missing is not null then
    raise exception 'Missing helper functions (%) -- run 0051 before this file.', missing;
  end if;
end $$;

-- ---------------------------------------------------------------- the roll
/**
 * 0051's roll, and `done` says whether the leader has finished it. A tap
 * saves with done false: the absences change and everyone sees them, but the
 * team stays on the roll. Never the leader themselves, never someone off the
 * team, and never an absence staff recorded on the sheet.
 */
create or replace function set_live_absences(aid uuid, absent uuid[], done boolean) returns live_team_setup
language plpgsql security definer set search_path = public as $$
declare
  me    record;
  setup live_team_setup;
  ids   uuid[];
begin
  select * into me from live_team_caller(aid);
  setup := live_setup_for_update(aid, me.tid);
  if live_team_leader(aid, me.tid) is distinct from me.sid then
    raise exception 'Only your team''s leader takes the roll';
  end if;

  select coalesce(array_agg(distinct a), '{}') into ids from unnest(coalesce(absent, '{}')) a where a is not null;
  if me.sid = any(ids) then
    raise exception 'You''re here — you can''t mark yourself absent';
  end if;
  if exists (select 1 from unnest(ids) a
              where not exists (select 1 from activity_rosters r
                                 where r.activity_id = aid and r.team_id = me.tid and r.student_id = a)) then
    raise exception 'Only someone on your team can be marked absent';
  end if;

  -- Only the roll's own rows go; one already there, the sheet's included, is
  -- left as it is (0051).
  delete from tutorial_absences
   where activity_id = aid and team_id = me.tid and source = 'roll'
     and student_id <> all(ids);
  insert into tutorial_absences (activity_id, team_id, student_id, source)
  select aid, me.tid, a, 'roll' from unnest(ids) a
  on conflict (activity_id, team_id, student_id) do nothing;

  if coalesce(done, true) then
    update live_team_setup set roll_at = now()
     where activity_id = aid and team_id = me.tid
    returning * into setup;
  else
    select * into setup from live_team_setup where activity_id = aid and team_id = me.tid;
  end if;
  return setup;
end $$;

/** 0051's call: the whole roll, finished. */
create or replace function set_live_absences(aid uuid, absent uuid[]) returns live_team_setup
language plpgsql security definer set search_path = public as $$
begin
  return set_live_absences(aid, absent, true);
end $$;

-- Who may call what (0047's note: revoke from all three first).
revoke all on function set_live_absences(uuid, uuid[], boolean), set_live_absences(uuid, uuid[])
  from public, anon, authenticated;
grant execute on function set_live_absences(uuid, uuid[], boolean), set_live_absences(uuid, uuid[])
  to authenticated;
