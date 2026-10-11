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

> **Done once already.** AP50A was restored on 11 Oct 2026 from the 7 Oct backup: 9 check-ins
> (week 1 to Tuesday's Week 5 Tutorial) went back to the old teams, 74 students each, and
> Thursday's Week 5 Challenge kept the new ones. The steps below are the ones that worked.

## Do this first, today

**Get the old teams out of a backup before it expires.** Supabase keeps daily backups for
**seven days**; after that the old teams are gone for good.

> ⚠️ Never press **Restore** on the live project's backup list. That rolls the *whole*
> database back to that day and loses every mark, hand-in and grade since. Only one table
> is needed, and the steps below take it from a copy.

1. Dashboard → the project → **Database → Backups**. Pick the **last daily backup taken
   before the switch**. They are taken around midnight in the project's region, which for
   this project is about 9:35 AM Central. A switch on Wednesday night means Wednesday
   morning's backup.
2. These are **physical** backups, which can't be downloaded. Open the **Restore to a New
   Project** tab and restore that backup there. It makes a separate project and leaves the
   live one alone. It's billed by the hour while it exists (about 1–2¢ an hour on the
   smallest compute), so delete it as soon as step 4 is done.
3. In the **copy's** SQL Editor, run `supabase/recovery/0_on_the_backup_copy.sql`. It returns
   one cell: the old teams, written as an INSERT. Use **Export → Download CSV**; copying the
   cell from the grid can cut it short.
4. Delete the copy: its **Project Settings → General → Delete project**.

If the project's backups *are* downloadable (logical backups), download the one before the
switch instead and run
`sh supabase/recovery/extract_team_members.sh <backup file> > old_team_members.sql`.

**Keep Kelly's files.** That's the class spreadsheet she gave the assistant (it has a column
of each student's previous team), and every weekly check-in CSV she downloaded before the
switch. The spreadsheet is the fallback if the backup is gone, and the CSVs prove the
restore is right (step 7).

## Before running anything

Everything below runs in the **live** project's SQL Editor.

- **The editor only shows the result of the last statement.** Where a file has several
  queries (`1_look.sql`), select one and run it on its own.
- **Supabase will warn** that a script is "destructive" or "creates tables without RLS".
  For these files that is expected: they write to a private `recovery` schema that the
  app's API can't reach. Choose **Run without RLS**.
- **No database password is needed.** Everything here runs in the dashboard.

## Then

**0. Deploy.** Run `supabase/migrations/0045_activity_rosters.sql`, then deploy the app with
it (PR #6). `supabase/check_migrations.sql` should then report 0045 as applied. Until that
code is live, the site still works every week out from today's teams and won't show the
restore, even though the database has it.

**1. Snapshot.** A copy of the tables involved, inside the database, in case anything needs
putting back by hand. The day's automatic backup is the other safety net.

```sql
create schema if not exists snapshot_2026_10_11;
create table snapshot_2026_10_11.activity_rosters  as select * from public.activity_rosters;
create table snapshot_2026_10_11.team_members      as select * from public.team_members;
create table snapshot_2026_10_11.teams             as select * from public.teams;
create table snapshot_2026_10_11.students          as select * from public.students;
create table snapshot_2026_10_11.tutorial_marks    as select * from public.tutorial_marks;
create table snapshot_2026_10_11.tutorial_absences as select * from public.tutorial_absences;
create table snapshot_2026_10_11.check_in_results  as select * from public.check_in_results;
```

Use the day's date in the schema name.

**2. Look.** Run the queries in `supabase/recovery/1_look.sql`, one at a time.
- **1a**: the courses. Note the id of each session to restore.
- **1b**: each course's team sets. `recorded = 0` means nothing is filed on that set.
- **1c**: every check-in with something recorded, and when. Note the **last week** that ran
  on the old teams, and roughly **when the switch happened**.

**3. Load the old teams.** Open `supabase/recovery/2_load_old_teams.sql` and fill in the two
marked places, then run the whole file.
- *Course:* one row per session: the course id, the last old week, and **when the teams were
  switched**, with a time zone:
  `insert into recovery.params values ('<course id>', 5, '2026-10-07 12:00 America/Chicago');`
  Only check-ins first recorded *before* that time are restored. That matters when a week
  has two check-ins either side of the switch: AP50A's Week 5 Tutorial (Tuesday) ran on the
  old teams and Week 5 Challenge (Thursday) on the new ones. Any time between the last old
  check-in and the first new one works.
- *Old teams:* paste the INSERT from the CSV in step 3 of "Do this first" (the cell's
  contents, without the CSV's surrounding quotes). Or, from Kelly's spreadsheet, add rows to
  `recovery.old_teams_by_email`.

**4. Preview.** Run `supabase/recovery/3_by_name.sql`. It reads only, and returns one table:
- **1 RESTORE TO OLD TEAMS**: the check-ins that will change, when each was first recorded,
  and how many students change team. All the old weeks, and nothing after the switch.
- **2 KEEPS TODAY'S TEAMS**: the check-ins left alone. The first one after the switch
  should be here.
- **3 PROBLEM** must not appear. Every presenter and absence on those weeks was saved while
  that student was on that team, because the database refused anything else. A row here
  means the loaded teams aren't the ones those weeks ran with.
- **4 NO OLD TEAM**: students on the roster with no old team. Anyone who joined after the
  backup belongs here. Anyone else would drop off those weeks, so find their team first.
- **5 BY NAME**: the last restored sheet, team by team: the old team next to what the sheet
  shows today. Read it against what Kelly remembers.

The individual checks behind it, with more detail, are in `3_preview.sql`.

**5. Apply.** Run `supabase/recovery/4_apply.sql`. It re-runs the checks and changes
nothing if one fails. It keeps what it replaced in `recovery.replaced_rosters`, and the
commented block at the bottom of the file puts that back.

**6. Check it.** Run `3_by_name.sql` again. Every RESTORE row should now say **0** students
change team, and in every BY NAME row the two lists should be the same people. Then open an
old week's Check-in sheet in the app: it shows the old teams, under a note saying these are
the teams as they were. The students' cards follow, because each student now reads the team
they were on that week.

**7. Prove it against Kelly's CSVs.** On Roster & teams, export the check-ins for a week
she **did** download before the switch, and compare it with her copy. If they're identical,
the restore is right. Then export **last week**, the one she never downloaded. That file is
now worked out from the teams that were actually in the room.

**8. Clean up**, a few days later, once step 7 matches: run `supabase/recovery/5_cleanup.sql`
(drops the loaded data and the undo copy; the restored teams stay) and
`drop schema snapshot_2026_10_11 cascade;`.

## If there's no backup and no spreadsheet

The database still has partial evidence: every presenter and every absent student was on
their team that week. That's usually one to three people per team per week, not the whole
team, so it can check a recovered membership but can't replace one. Kelly's own records,
her memory and the teams' channels are the remaining sources. Whatever list comes out of
them goes in through the spreadsheet route, and the PROBLEM check still tests it against
the evidence.

## The stray team set

If step 2's 1b shows a second set created around the switch with `recorded = 0`, that's the
"+ New set" Kelly made. Before PR #6, students could land on *either* set's team
(the app took whichever membership the database returned first), while the assistant and
the check-in sheet used the other one. 0045 points the course at the set the app was already
using. Once the restore is done, the stray set can be deleted in Teams → the set builder;
it shows what it holds before deleting.

If that set shows `recorded` **above** 0, some students handed team work in under it while
the app was picking their team at random. **Don't delete it**: deleting a set deletes
everything filed on its teams. Leave it in place and look at what's on it first.
