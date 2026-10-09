# Getting the check-ins back after the team switch

## What happened

A check-in mark is saved against a **team** (Team 3, week 4: presenter, two scores, who was
absent). Each student's score is worked out from whoever is on that team *when you look*.
Nothing recorded who was on it on the day.

When Kelly made the new teams, the assistant moved students between the **existing** team
rows; it didn't make new ones. So Team 3's week 4 marks now go to whoever is on Team 3
today. Every earlier week's sheet, every student's card and every week's export read the new
teams.

**Nothing was deleted.** Every mark, presenter, absence and score is still in the database
against the right team. What was lost is *who was on each team* before the switch. Put that
back and every week reads correctly again.

Migration `0045_activity_rosters.sql` stops this from happening again. The first time
anything is recorded on an activity, it freezes who was on which team. It can't know the old
teams for weeks that already ran, though. That's what this runbook is for.

## Do this first, today

1. **Download the database backup from before the switch.** Supabase keeps daily backups for
   **seven days**, so after a week the old teams are gone for good. Go to Dashboard → the
   project → **Database → Backups**, pick the last backup taken *before* the teams were
   switched, and **Download** it. Keep the file somewhere safe.

   > ⚠️ Do **not** press **Restore** on the live project. That rolls the *whole* database
   > back to that day, which loses every mark, hand-in and grade since. You only need one
   > table out of the backup, and step 2 takes it out of the downloaded file.

   If there's no Download button, use "restore to a new project" if the plan offers it,
   then copy the `team_members` table out of that new project.

2. **Keep Kelly's files.** That's the class spreadsheet she gave the assistant (it has a
   column of each student's previous team), and every weekly check-in CSV she downloaded
   before the switch. The spreadsheet is the fallback if the backup is gone, and the CSVs
   prove the restore is right (step 6).

## Then

Every step below runs in Supabase → **SQL Editor**. Steps 1 and 3 change nothing. Step 4 is
one transaction: it refuses to run if any check fails, and it can be undone.

**0. Deploy.** Run `supabase/migrations/0045_activity_rosters.sql`, then deploy this branch
of the app. `supabase/check_migrations.sql` should then report 0045 as applied.

**1. Look.** Run `supabase/recovery/1_look.sql`. It lists:
- **1a**: the courses. Note the id of each session to restore.
- **1b**: each course's team sets. A set made with "+ New set" around the switch shows its
  `created_at`, which is the best record of *when* the switch happened. `recorded = 0`
  means nothing is filed on it.
- **1c**: every week with something recorded, and when. The weeks whose records all come
  before the switch are the ones to restore. Note the **last** of them.

**2. Load the old teams.** Open `supabase/recovery/2_load_old_teams.sql`, fill in the two
marked places, and run the whole file.
- *Course:* `insert into recovery.params values ('<course id>', <last old week>);` with one
  row per session.
- *Old teams, from the backup (best):* run
  ```sh
  sh supabase/recovery/extract_team_members.sh <downloaded backup file> > old_team_members.sql
  ```
  and paste the file's contents in. The ids match exactly.
- *Old teams, from the spreadsheet:* add one row per student to
  `recovery.old_teams_by_email` (their email, and their old team as `3` or `Team 3`). The
  file reports any row it couldn't match.

**3. Preview.** Run `supabase/recovery/3_preview.sql` and read every result.
- **3b must be empty.** Every presenter and absence on those weeks was saved while that
  student was on that team, because the database refused anything else. So the old teams
  have to agree with all of them. A row here means the old teams loaded in step 2 aren't the
  ones those weeks ran with.
- **3d**: students with no old team. Anyone who joined after the switch belongs here.
  Anyone else would drop off those weeks, so find their team first.
- **3f**: how many students change team, per week. These are the people whose marks were
  going to the wrong team.

**4. Apply.** Run `supabase/recovery/4_apply.sql`. It re-runs the step 3 checks and changes
nothing if one fails. It keeps what it replaced, and the commented block at the bottom of
the file puts that back.

**5. Check it in the app.** Open an old week's Check-in sheet. It should show the old teams,
under a note saying these are the teams as they were. The students' cards follow, because
each student now reads the team they were on that week.

**6. Prove it against Kelly's CSVs.** On Roster & teams, export the check-ins for a week
she **did** download before the switch, and compare it with her copy. If they're identical,
the restore is right. Then export **last week**, the one she never downloaded. That file is
now worked out from the teams that were actually in the room.

**7. Clean up.** Once step 6 matches, run `supabase/recovery/5_cleanup.sql`. It drops the
loaded data and the undo copy. The restored teams stay.

## If there's no backup and no spreadsheet

The database still has partial evidence: every presenter and every absent student was on
their team that week. That's usually one to three people per team per week, not the whole
team, so it can check a recovered membership but can't replace one. Kelly's own records,
her memory and the teams' channels are the remaining sources. Whatever list comes out of
them goes in through the spreadsheet route, and 3b still checks it against the evidence.

## The stray team set

If step 1b shows a second set created around the switch with `recorded = 0`, that's the
"+ New set" Kelly made. Before this branch, students could land on *either* set's team
(the app took whichever membership the database returned first), while the assistant and
the check-in sheet used the other one. 0045 points the course at the set the app was already
using. Once the restore is done, the stray set can be deleted in Teams → the set builder;
it shows what it holds before deleting.

If that set shows `recorded` **above** 0, some students handed team work in under it while
the app was picking their team at random. **Don't delete it**: deleting a set deletes
everything filed on its teams. Leave it in place and look at what's on it first.
