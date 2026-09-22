-- 0043: the check-in sheet is live — a mark lands on every open copy.
--
-- Run in Supabase → SQL Editor, after 0041. Safe to re-run.
--
-- Two TFs share one sheet during a session. Diego marked Team 1's check-in 1;
-- Luke, on his own iPad, had opened the sheet before Diego started and so saw
-- an empty check-in 1 — and put check-in 2's marks into it. Nothing told him
-- the row had been filled. The app now subscribes to these three tables for
-- the open activity, and refetches the sheet when any of them changes, so the
-- copy in his hands is the one Diego wrote to.
--
-- Realtime only carries what the publication lists, and only sends a row to a
-- client whose RLS would let it SELECT that row — the same policies as the
-- sheet itself, so a student subscribing gets nothing (0016/0040).
--
-- REPLICA IDENTITY FULL on the two tables that are cleared by DELETE: with the
-- default identity a delete event carries only the primary key, and for the
-- filter activity_id=eq.<id> to match on a delete the old row has to carry
-- the column. tutorial_marks is never deleted from the sheet, so it keeps the
-- default.

do $$ begin
  alter publication supabase_realtime add table tutorial_marks;
exception when duplicate_object then null; end $$;

do $$ begin
  alter publication supabase_realtime add table tutorial_absences;
exception when duplicate_object then null; end $$;

do $$ begin
  alter publication supabase_realtime add table tutorial_graders;
exception when duplicate_object then null; end $$;

alter table tutorial_absences replica identity full;
alter table tutorial_graders  replica identity full;
