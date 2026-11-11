# Peer evaluation (CATME-style) — plan

Status: **scaffold** on `feat/peer-eval-scaffold`. Scoring and flags are written and
tested (`src/peer/`); the schema is a draft; there are no screens yet. Spec §6.12 and
TEAM-TAB-PLAN listed this as ◇ deferred.

## 1. How CATME does it

**The instrument.** Five dimensions, each 1–5, with written anchors at 1, 3 and 5
(three behaviours each); 2 and 4 mean "some of both" (Ohland et al. 2012):
Contributing to the team's work · Interacting with teammates · Keeping the team on
track · Expecting quality · Having relevant knowledge, skills and abilities. Optional
Likert sets about the team (satisfaction, conflict, psychological safety, …) can be
added; instructors can't write their own questions.

**Student.** Emailed when it opens, reminded 2 days before it closes. Optional rater
practice first (rate three fictional teammates, see the answer). Then one dimension
per screen, rating **themselves and every teammate** on it; everyone must be rated to
move on. Optional comments per teammate, plus a private note to the instructor.
Nothing counts until they press Finish; leaving loses it, and editing after needs
the instructor to reopen it. After the instructor releases results: per dimension,
**self · teammates' average · team average**, the scale, and tips. Never who said what.

**Faculty.** Add activity → name, dates, rater practice → tick dimensions and extra
sets → comment settings (on; released to students; anonymous) → import students and
teams by CSV (or from Team-Maker) → done. Each evaluation is a new activity that
re-imports teams; a midterm (formative, with practice) + final (graded) is common.

**Results.** Per student: average per dimension, **adjustment factor** with and
without self, and flags. Drill-down: who rated whom; raw export. Red highlights when
a rater gave one person the same score on every dimension, or everyone the same
score on one.
- **Factor** = student's average rating ÷ the mean of every member's average.
  Shown capped at 1.05 (from Oakley et al. 2004); applying it (team grade × factor)
  is up to the instructor.
- **Flags** ("exceptional conditions"): Low, High, Overconfident, Underconfident,
  Manipulator, Conflict, Clique — rules in §6. Manipulator/Conflict/Clique also
  highlight the factor as suspect. CATME says Conflict and Clique are not validated.

**What instructors and students complain about.** It takes 15–60 minutes. Ratings
cluster near 4.2 and the five dimensions correlate highly. Over/Underconfident
punish strict raters. 90%+ of comments are positive or neutral. Teams of two can't
be anonymous. No edits after submitting, no reuse of an old evaluation, no custom
questions.

### What we take, what we change

| Take | Change |
|---|---|
| The five dimensions, 1/3/5 anchors | **One-line anchors**, our own words (CATME's text is copyrighted, and long) |
| One dimension per screen, whole team as rows | **Saves on every tap**; leaving loses nothing |
| Self-rating | **Editable until the due time**, no reopen needed |
| Comments, private by default | Teams come from **Collage's frozen roster** — no CSV per evaluation |
| Released summary: self · teammates · team | **Hidden below 2 raters** (CATME has no floor) |
| Factor with/without self, flags by CATME's rules | **Duplicate** last evaluation for the next one |
| Red rating patterns | v1 skips: rater practice, extra team sets, email reminders |

---

## 2. How it fits Collage

**A new activity type, `peer`**, the same move live questions made (0047):

| Collage already has | Peer eval uses it for |
|---|---|
| Weeks + `opens_at` / `due_at` | when it opens and closes; midterm and final are two activities |
| `activity_rosters` (0045) | **who counts as a teammate**: frozen on the first rating, so a re-form later doesn't change it |
| Individual check-in + gradebook | a **completion** column (submitted = Complete) |
| TF review-before-release (0038) | a TF closing it sends marks for review, as `score_live` does |
| Canvas export | the factor as an extra column |
| `+ Activity` menu | a third item: **Peer evaluation** |

Scope is `indiv`. The factor is **reported, not applied**: the instructor decides
whether it multiplies a team grade.

## 3. Student flow

Assignments → **Peer evaluation · Week 7 · Due Fri** → a stepper.

```
 Contributing to the work                                    1 / 5
 ─────────────────────────────────────────────────────────────────
               1                     3                     5
         Did little of the      Did a fair share,     More than a fair
         work, or late.         on time.              share, done well.
 You         ○      ○      ●      ○      ○
 Maya        ○      ○      ○      ●      ○
 Theo        ○      ○      ○      ○      ●
 Ana         ○      ●      ○      ○      ○
 ─────────────────────────────────────────────────────────────────
                                              Back      Next →
```

- Next unlocks when every row has a score. Each screen saves as one call.
- Last screen: a comment box per teammate (if on), then **Submit**.
- After release: **My feedback**, one row per dimension: *teammates · you · team*.

## 4. Faculty flow

`+ Activity → Peer evaluation` → its own page (beside `LiveDetail`):

1. **Set up**: title, week, opens / due (existing controls); five dimension toggles;
   *Students rate themselves*; *Comments*: off / to me / to me and the student.
2. **Open**: per team, `3 / 4 submitted`.
3. **Closed → results**, grouped by team:
   ```
   Team 3     From team   Self   Factor   Flags
   Maya         3.9        4.0    1.10
   Theo         4.1        3.0    1.15    High · Underconfident
   Ana          2.4        4.6    0.68    Low · Overconfident
   Sam          3.8        3.8    1.07
   ```
   Tap a team → rater × ratee grid, rating patterns, comments (withhold one here).
4. **Release** to students. **Export** CSV with the factor.

## 5. Data (draft: `docs/team-module/peer-eval/0058_peer_evaluation.draft.sql`)

| Table | Row |
|---|---|
| `peer_settings` | per activity: dimensions, include_self, comments, team_set_id, min_raters, closed_at, released_at |
| `peer_ratings` | (activity, rater, ratee, dimension) → score 1–5 |
| `peer_comments` | (activity, rater, ratee) → body, withheld |

The database enforces the rules, not the screen:
- Students write only through RPCs that check the frozen roster, the due time (or a
  reopen, 0044) and the score range. **No student reads any rating row**; they get
  `peer_my_feedback()` averages after release.
- Feedback counts **submitted raters only**, and is hidden unless every dimension has
  `min_raters` of them, the same rule as `feedbackFor()`. Submitted lives on the
  individual check-in result, like any hand-in. Submitting doesn't lock; the due
  time does.
- Once anyone has rated, the teams, dimensions and self-rating are locked (re-freeze
  refused). To ask something different, duplicate it.
- Column grants, not just RLS: staff can withhold a comment but not edit it;
  `closed_at` / `released_at` move only through `close_peer` / `release_peer`.

The draft applies cleanly on the local DB (checked in a rolled-back transaction).

## 6. Scoring (`src/peer/model.ts`, `src/peer/flags.ts`)

- *From team*: mean of every score teammates gave them. *Self*: their own.
- **Factor** = *from team* ÷ mean of every member's *from team* (CATME's formula;
  CATME doesn't publish how its without-self denominator is built, so this is ours).
  With-self version too. Nobody rated them → no factor, and not in the mean.
- `applyFactor(teamScore, factor, { max, cap })`: cap 1.05 matches CATME's display.

| Flag | Rule (CATME's, in `THRESHOLDS`) |
|---|---|
| Low | from team < 2.5 |
| High | from team > 3.5 and > team mean + 0.5 |
| Overconfident | from team < 3 and self ≥ from team + 1 |
| Underconfident | from team > 3 and self ≤ from team − 1 |
| Manipulator | self ≥ 4 and every teammate rated ≥ 2 below self |
| Conflict | (on the rater) gave someone ≤ 2 whom the rest rate ≥ 3 by median |
| Clique | no other flag on the team, and Σ per-dimension SD > number of dimensions |

Clique is CATME's catch-all for spread no one-person flag explains: scores that swing
within a dimension but even out per person. On a one-dimension evaluation it needs
a team of 5+, because on 4 any rating low enough to spread the scores trips Low or
Conflict first.

## 7. On this branch

| File | What |
|---|---|
| `src/peer/types.ts` | row types, mirroring the draft schema |
| `src/peer/dimensions.ts` | the five dimensions, one-line anchors |
| `src/peer/model.ts` | what's left to rate, per-member summary, factor, `applyFactor`, `feedbackFor` |
| `src/peer/flags.ts` | CATME's flags and rating patterns |
| `src/peer/*.test.ts` | 57 tests, 100% of lines |
| `docs/team-module/peer-eval/0058_peer_evaluation.draft.sql` | tables, RLS, the save RPC; the rest as signatures |

## 8. Build order (each a PR)

1. **Schema**: draft → `supabase/migrations/0058…`, plus `supabase/tests/0058…`
   proving the guarantees on the local DB.
2. **Data + type**: `src/peer/data.ts`, and `peer` in `ActivityType`. That breaks the
   build at every `Record<ActivityType, …>` (5 in `checkins/types.ts`, 2 each in
   `student/Assignments.tsx`, `student/TeamResources.tsx`): that's the checklist.
   Then `AddActivityMenu` and duplicate in `facultyData.ts`.
3. **Student**: `src/student/peer/PeerAssignment.tsx`, branched in `StudentApp`.
4. **Faculty**: `src/faculty/peer/PeerDetail.tsx`, branched in `FacultyApp`.
5. **Later**: apply the factor to a chosen grade; rater practice; reminders.

## 9. Open questions (for Kelly)

1. **Factor applied, or only shown?** Default: shown and exported. If applied: which
   grade, what cap?
2. **Graded on completion?** Default: submitted = Complete.
3. **Comments**: default *to me only*. Should students ever see them?
4. **Self-rating**: on by default (the confidence flags need it).
5. **When**: end of term, or midterm + final?
6. **Wording**: our anchors, or license CATME's validated text?

## Sources

- Ohland et al. 2012, *AMLE* 11(4), Appendix B (the scale):
  https://warwick.ac.uk/fac/soc/al/research/groups/wacc_old/activities/regular_events/may_27_wacc.pdf
- CATME terms (flag rules): https://info.catme.org/instructor/instructor-help/catme-terms/
- Adjustment factor: https://catme.org/help/instructor/instructor14.html
- Instructor FAQ: https://info.catme.org/instructor/instructor-help/faq/ ·
  Student FAQ: https://info.catme.org/student/student-help/faq/
- UW ChemE CATME tutorial (setup screens, results):
  https://www.cheme.washington.edu/sites/cheme/files/mycheme/Faculty/Docs/CATME%20Tutorial%20for%20Team%20Creation%20and%20Peer%20Evaluation.pdf
- Oakley et al. 2004 (the 1.05 cap):
  https://www.cs.upc.edu/~idss/WorkingTeams/turnin_student_groups_into_effective_teams.pdf
- Student-side critique (n=12): https://peer.asee.org/assessment-of-the-catme-peer-evaluation-tool-effectiveness.pdf
