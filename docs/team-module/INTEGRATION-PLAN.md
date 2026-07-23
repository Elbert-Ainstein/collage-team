# Team Learning Module → Collage AI Faculty Dashboard — Integration Plan

**Status:** IMPLEMENTED. The faculty shell, Create + Course-content (Activities subtab),
the activity create wizard, per-activity workspace (Build · Grade · Monitor), Analytics
(dashboard + gradebook + prep→performance), and Roster & teams (off the course bar) are all
built under `src/faculty/*`. Old consolidated-hub routes retired; the fixed four-item nav
holds. §11 rules + tests untouched (19/19 green).
**Context:** The Team Learning Module (this repo) becomes a feature *inside* the redesigned
Collage AI **Faculty Dashboard** (Create · Analytics · AI tutor · Library, with a top course
bar and a Course content area split into Lessons | Summatives). This doc maps our existing
screens onto that shell and flags the decisions the team needs to make.

---

## 1. The core idea: "Activity" is a third content type

Today the Faculty Dashboard has two content types:

- **Lesson** — delivered instructional content, built from sources via the wizard.
- **Summative** — an assessment, generated from sources + lessons or imported.

We add a third:

- **Activity** — a **team-based learning activity** with the four-stage pipeline
  (Individual prep → Team discussion → Final submission → Assessment). Unlike a Lesson (pure
  delivery) or a Summative (pure assessment), an Activity **spans create → deliver → assess**,
  so it appears in several places: the create menu, the content list, Analytics, and grading.

This is the single conceptual addition; everything below is where it surfaces.

---

## 1a. Hard constraint: the top-level nav never grows

**The left sidebar is fixed at the original four — Create · Analytics · AI tutor · Library —
and the Team Module adds nothing to it.** Every module surface fits *within* those four (as a
subtab, a per-item view, or an entry off the top course bar). No "Grading", "Assessment",
"Roster", "Activities", or any other item is ever added to the sidebar.

| Module surface | Home (within the fixed four / course bar) |
|---|---|
| Activities list | **Create → Course content → Activities** subtab |
| Create / author an activity | **Create** (menu option + wizard) → our builder |
| Course dashboard, results, convergence | **Analytics** |
| Gradebook grid (student × activity) | **Analytics** |
| Per-submission grading (AI rubric, approve/release) | **inside an Activity** (open it → Grade) |
| Roster import + team management | **top course bar** (the "28 Students · Invite" cluster) |
| Reusable activity templates (future) | **Library** |
| Student four-stage flow | separate student experience (unchanged) |

---

## 2. Navigation mapping

### 2.1 Create tab — add "Activity"
- **Create menu dropdown** (today: Generate Lesson · Generate Summative · Import Summative)
  → add **Generate Activity**.
- **Option cards** (today: Create a Lesson from sources · Create an Assessment · Upload an
  assessment) → add a 4th: **"Create a team activity from sources & lessons."**
- The create flow is a **wizard** (conversational "Wizard guide" + Artifacts panel). Activities
  follow the same pattern: `Source material → Questions → Rubric → Team/mode settings → Publish`.
  Our existing **5-tab Activity builder** becomes the **edit surface you land in after** the
  wizard (fine-tune questions, toggles, rubric, submission mode) — not the entry point. See §5.

### 2.2 Course content — new "Activities" subtab
- Subtabs become **Lessons | Summatives | Activities**.
- The Activities list reuses the Lessons-row pattern (icon · title · status · due · row action).
  Row action is **stage-aware**: *Open* (draft/scheduled) · *Open live* (team stage) ·
  **Grade** (grading) · *View results* (released).
- Reuses our existing **Activity library** screen almost verbatim.

### 2.3 Analytics tab — course monitoring + gradebook
- Our **Course dashboard** (Students · Prep complete · Needs review · Awaiting grade, prep-by-team).
- **Results & analytics** ◇ (submission rates, rubric performance, original→final, team convergence).
- The **Gradebook grid** (student × activity, completeness vs submission) — it's cross-activity,
  so it belongs here rather than inside one activity. (Per-submission grading stays in the activity — see §2.4.)

### 2.4 Grading — per-activity, with an Analytics entry point *(decided — no nav item)*
No "Grading"/"Assessment" item is added to the sidebar (per §1a). Grading is inherently tied to
one activity's rubric, so:
- **Per-activity Grade view** — open an Activity from the list → its **Grade** view (AI-suggested
  rubric with evidence + confidence, instructor override, approve-and-release). This is our existing
  Grading screen, scoped to that activity.
- **Analytics → "Awaiting grade / Needs review"** cards deep-link into the relevant activity's Grade view.
- **Gradebook** (the cross-activity grid) lives in Analytics (§2.3).
*Why:* keeps grading in the activity's context, avoids a new top-level nav item, and matches the
"open the thing, then act on it" pattern the Lessons list already uses.

### 2.5 Roster & teams — course-level, from the top course bar *(decided — no nav item)*
No "Roster" item is added to the sidebar (per §1a). The top bar already surfaces
**28 Students + Invite** — that cluster is the home:
- A course-level **Roster & teams** panel (roster import wizard + team management) opened from the
  Students/Invite region or a course-settings menu.
*Why:* it's course *setup* done once, not per-activity content — it shouldn't sit inside the
content-creation flow, and it isn't a sidebar destination.

### 2.6 AI tutor / Library — unchanged, with light touchpoints
- **Library** could later hold reusable **activity templates** (out of scope for the pilot).
- **AI tutor** is unaffected; it could optionally reference an activity's context in future.

---

## 3. Student experience — unchanged

The redesign is **faculty-facing only**. The student side (My activities → Individual prep →
Team discussion → Final submission → Grades & feedback) stays as its own experience/role. No
student screens change. The faculty and student apps share the same data + services layer.

---

## 4. What's reusable vs. new

**Reused as-is (re-hosted, not rewritten):**
- Activity builder (5 tabs), Grading + gradebook, Roster import wizard, Team management,
  Course dashboard, Results, and the entire **student flow**.
- The **services layer** (immutability, prep gate, privacy, participation, AI-suggested grading)
  and all **§11 rule tests** — these are shell-agnostic and unaffected.

**New / changed:**
- "Activities" subtab in Course content + the Activities list wired to it.
- "Generate Activity" in the create menu + option card + the create **wizard** for activities.
- Wizard → builder hand-off (§5).
- Grade entry point from the activity; gradebook moved into Analytics.
- Roster & teams entry point from the course bar.
- **Outer shell swap**: adopt the Faculty Dashboard chrome (top course bar + Create/Analytics/
  AI tutor/Library sidebar) in place of our current navy rail + 4-hub instructor sidebar. The 4
  hubs' *screens* are preserved as the hosted content; only the chrome changes.

---

## 5. Wizard vs. builder (author flow reconciliation)

- **Wizard** (conversational, right-side guide + Artifacts) = the *guided authoring* entry, matching
  Lessons/Summatives. For an Activity it collects: sources → suggested questions (AI ✦) → rubric
  hints → team/mode settings, everything as **drafts requiring approval** (§11: AI proposes,
  instructor approves).
- **Builder** (our 5-tab form) = the *precise edit* surface you land in after the wizard, and the
  place you return to from the Activities list. Every toggle stays live-wired to the student experience.
- Net: the wizard *drafts*, the builder *refines and publishes*. No rule changes.

---

## 6. Integration details to resolve (team decisions)

1. **Status vocabulary.** Lessons use *Published / Draft / Closed*. Activities have a richer
   lifecycle (*draft → scheduled → prep-open → team-stage → grading → released*). Do we (a) show the
   full activity lifecycle in the Activities list, or (b) collapse it to the Lesson-style
   Draft/Published/Closed set? **Recommendation:** keep the richer activity status but *badge-map* it
   into the same visual family so the list reads consistently.
2. **Do Activities belong to a Unit** (like Lessons/Summatives under "Unit 2 — Matter & Energy")?
   Assumed yes — Activities are course/unit-scoped.
3. **Wizard vs. builder** default: does "Create Activity" always run the wizard first, or offer
   "start blank in the builder" too? (Lessons appear wizard-first.)
4. **Grading & roster placement** — *decided:* neither adds a sidebar item (§1a); grading is
   per-activity, roster is off the course bar.
5. **Summative vs. Activity overlap.** An Activity's final stage *is* an assessment. Do we keep them
   as distinct content types (recommended — different pedagogy) or let an Activity optionally emit a
   Summative record?

---

## 7. Suggested phased rollout (when we do build)

- **Phase A — low risk, validates the concept (in current shell):** add the **Activities** subtab in
  Course content + **Create Activity** in the create menu, pointing at our existing builder. No
  re-shell yet.
- **Phase B — adopt the Faculty Dashboard shell:** move the instructor side onto the redesign chrome
  (top course bar + Create/Analytics/AI tutor/Library), re-hosting our screens. Dashboard → Analytics.
- **Phase C — wire the homes:** grade entry from the activity + gradebook in Analytics; roster & teams
  from the course bar; activity **create wizard** with builder hand-off.
- Throughout: **§11 rules and the rule-test suite stay green** — the services layer never moves.

---

## 8. One-paragraph summary for the team

We introduce **Activity** as a third content type beside Lessons and Summatives. It shows up as an
**Activities subtab** in Course content, a **Create Activity** option (wizard-first, builder for
edits), course **Analytics** (dashboard + gradebook + convergence), **per-activity grading**, and a
course-level **Roster & teams** area off the top bar. The student four-stage flow and all business
rules are untouched — only the faculty *navigation shell* changes. Everything we've already built is
reused; the work is re-hosting it and adding the Activity content-type plumbing.
