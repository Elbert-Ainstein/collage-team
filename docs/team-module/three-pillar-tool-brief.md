# Standalone Three-Pillar Team-Learning Tool — Brief + Build Prompt

Off Collage. Unbranded. The whole app is three pillars, one loop:

> **① Individual attempt → ② Team discussion → ③ Resubmit (team or individual)**

Pillar mapping: **Teams** decide *who discusses* · **Activities** run *the loop* · **Check-ins** record *what the loop produced*.

---

## Plan

### The whole app = three pillars, one loop
No brand topbar, no Create/Library nav. A thin context strip (class name · roster count · term) sits above three tabs. The load-bearing seam: an **Activity owns one or more Check-in columns**; clicking a column header or cell opens that activity's workspace — so Pillars 1 and 3 never feel like two apps. Landing tab = **Check-ins**. Faculty is the primary lens; a Faculty⇄Student toggle lives inside the Activity workspace only.

### Pillar 1 — CHECK-INS (the gradebook)
At-a-glance ledger. Rows = students under collapsible **team rollup rows**; columns = check-ins grouped under their owning activity; frozen name column; horizontal scroll.
- **Individual cell states:** `—` not started · `●` submitted/unscored · `⚑` needs review · `4` scored · `·` excused.
- **Team cell states (rollup row):** `··` not submitted · pulsing amber = discussion live · `✓ 12` submitted+scored; rollup shows `3/4 in` + `⚠` when behind.
- **Cell scorer side panel:** click a cell → upload (zoomable) + transcription + score + `Mark complete` / `Needs review` / `Save & next` (auto-advances down the column).
- **Add check-in:** type (Individual/Team) · phase (Readiness/Participation/Milestone) · scale (points/complete).
- States: Empty · In-progress · Done (columns locked, header shows mean + participation %).

### Pillar 2 — TEAMS (assigned, never self-selected, per-activity)
- Class roster (add/paste).
- **Team set per activity** — same class can be 4-person teams for one activity, pairs for another. `Set team size` → `Auto-form teams` or drag → `Assign roles automatically` → `Publish teams`.
- **Team card:** members + role chips (Facilitator/Scribe/Skeptic/Reporter), count badge, under-target warning, add/remove/delete.
- States: Empty · In-progress (undersized warnings) · Done (Locked).

### Pillar 3 — ACTIVITIES (workspace + upload loop)
- **Activity list:** each card dominated by the loop bar `Setup → Individual → Discuss → Resubmit → Closed`, counts, deadline chips.
- **Workspace:** one screen, persistent **View as student ⇄ View as faculty** toggle.
  - *Faculty tabs:* **Source** · **Submission** (per-student + per-team rollups + responses-review launcher) · **Discussion** (what teams *submitted*, never private scratch space) · **Progress** (loop funnel + `Post check-ins to gradebook`).
  - *Student lens:* three-step stepper. ① upload field (file + text) + `Submit Round 1`; ② private team space; ③ greyed until ① done, forks per `resubmitMode` (team / individual / choice).
- **Student-responses review:** ALL responses, filter (All / Needs review / By team / Unscored), zoomable scans, `Confirm transcription` (faculty-owned, distinct from grading).

### Minimal data model
```
Student   { id, name, email, avatar }
Activity  { id, title, source{text,files[]}, teamSetId,
            resubmitMode:"team"|"individual"|"choice",
            stage:"setup|individual|discuss|resubmit|closed",
            opensAt, individualDueAt, discussionEndsAt, teamDueAt, checkInIds[] }
TeamSet   { id, activityId, teamSize? }
Team      { id, teamSetId, name, memberIds[], roles:{studentId:role}, locked }
CheckIn   { id, activityId, label, type:"individual"|"team",
            phase:"readiness|participation|milestone", scale:"points|complete", max?, posted }
Submission{ id, activityId, checkInId, round:1|2, authorType:"student"|"team",
            authorId, submittedBy, text, files[], transcription?,
            transcriptionState:"none|auto|confirmed", score?, flagged,
            status:"draft|submitted|needs_review|confirmed" }
```
Load-bearing: team membership belongs to the **Activity** (per-activity teams are real); a gradebook cell is **derived** from the latest matching Submission (no separate grade object); `round + authorType` lets one entity be both the solo attempt and the resubmit, so the individual→team lift is visible by placing the two columns adjacent.

### KEEP vs CUT
**KEEP:** the two-pass loop as the spine; per-activity assigned teams with optional size + auto-roles + role chips; the check-in gradebook grid with team rollup rows and derived cells; the Faculty⇄Student workspace toggle; Source/Submission/Discussion/Progress tabs; student upload field (file + text); all-responses review with filter + zoomable scans + Confirm transcription; faculty-owned transcription distinct from grading; privacy rule.

**CUT:** the Collage brand topbar and Create/Library nav; a standalone "Workspace" nav item; self-selection of teams; real-time chat; rubric/course authoring; cross-class dashboards; notification center; dead v1 team code; real audio (demo waveform only); any AI feature promoted to top-level. No fourth pillar ever.

---

## Build prompt (copy-paste into Claude)

Build a single self-contained HTML file (inline CSS + JS, no external assets, no CDN, no build step, no network calls) implementing a STANDALONE, UNBRANDED team-based-learning tool for one college class. No product name, no logo, no topbar brand, no Create/Library navigation. The entire app is exactly THREE pillars. Encode all sample data as JS objects and render from them; all state is in-memory (refresh resets) — that is fine.

## Global shell
- A thin context strip at top: class name, roster count, term — e.g. "Intro to Systems Biology · 24 students · Fall". This is context, not nav.
- Below it, three top-level tabs that ARE the whole app: **Check-ins** (default/home) · **Teams** · **Activities**.
- One repeating pedagogical loop named and shown everywhere: `① Individual attempt → ② Team discussion → ③ Resubmit`. Print a compact loop/stage bar on every activity card and workspace header so the model is legible in three seconds.
- Load-bearing seam: an Activity owns one or more Check-in columns. Column headers and cells in the gradebook link into that activity's workspace.

## Visual / UX direction (avoid generic AI-artifact defaults)
Design it like a registrar's gradebook crossed with a clean lab notebook — a "serious classroom instrument," NOT a glossy pastel AI toy. Requirements:
- Near-black ink on paper-white; slate for structure; hairline (1px) dividers. One humanist/geometric system sans (use a system font stack, e.g. `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`).
- Exactly ONE signal color per meaning: blue = submitted/unscored, amber = needs attention/review, green = complete/scored-good. No rainbow, no gradients as decoration, no large colored hero banners, no drop-shadow-heavy rounded pastel cards.
- Scores use **tabular/lining numerals** (`font-variant-numeric: tabular-nums`) so columns align and scan.
- Status carried by **shape + label, not color alone**: use `—` `●` `⚑` `·` `✓` glyphs plus text (survives color-blindness/printing).
- Density is a feature in the gradebook (read 24 students at a glance); calm is a feature in the workspace (one clear task per stage). The only motion is a cell changing state; keep transitions subtle (~120ms).
- The loop/stage bar and the student three-step stepper are the only recurring "hero" motifs.

## Theming & responsiveness
- Support BOTH light and dark themes. Default to `prefers-color-scheme`, plus a small toggle in the context strip. Drive all colors through CSS custom properties (`--ink`, `--paper`, `--line`, `--blue`, `--amber`, `--green`, etc.) and override under `@media (prefers-color-scheme: dark)` and a `[data-theme="dark"]`/`[data-theme="light"]` attribute on the root so the toggle wins both directions.
- Fully responsive. The gradebook grid scrolls horizontally inside its own `overflow-x:auto` container with a frozen first (name) column; the page body itself must never scroll horizontally. On narrow/mobile widths, collapse the three tabs into a bottom bar and let the side panel become a full-width sheet. Use relative units, flexbox/grid, `max-width:100%` on media.

## PILLAR 1 — CHECK-INS (the gradebook grid)
The home screen and the operating surface. Rows = students; columns = check-ins grouped visually under their owning activity (a spanning header labels the activity, sub-headers label each check-in). Frozen name column; horizontal scroll for many columns.
- Group students under collapsible **team rollup rows** (e.g. "▾ Team Helix  3/4 in"). Team-type check-ins render their cell on the rollup row; individual check-ins render on each student row.
- **Individual cell states:** `—` gray (not started) · `●` blue (submitted, unscored) · `⚑` amber (needs review) · an ink number like `4` or `12` (scored) · `·` muted (excused/absent) · a ring highlight when that cell is open in the side panel.
- **Team cell states (on rollup row):** `··` (not submitted) · pulsing amber (discussion in progress) · `✓ 12` (submitted + scored). Rollup header shows an `n/4 in` tally and a `⚠` when a team is behind.
- Clicking any cell slides in a right-hand **cell scorer side panel** showing the actual upload (a fake but zoomable scan — see below), the transcription text, a score input, and buttons `Mark complete` · `Needs review` · `Save & next` (Save & next auto-advances to the next student down the same column). Grade a whole column without leaving the grid.
- **Add check-in** control opens a small form: type (Individual / Team), phase (Readiness / Participation / Milestone), scale (points / complete–incomplete), and which activity it belongs to. Appends a column.
- Screen states: Empty (roster + one ghost column + a `New activity` CTA) · In-progress (mix of scored/awaiting/flagged cells; the active activity's live column header shows a stage chip) · Done (columns locked to scored values; header shows mean + participation %).

## PILLAR 2 — TEAMS (assigned, per-activity, never self-selected)
- A **class roster** (add student / paste list; ship it pre-populated).
- **Team sets are per activity** — the same class can be 4-person teams for one activity and pairs for another; team size is optional/configurable. Controls: `Set team size` → `Auto-form teams` (splits roster into balanced cards) or drag/assign manually → `Assign roles automatically` → `Publish teams`. Never offer self-selection anywhere.
- **Team cards:** editable team name, member count badge (amber when under target), members as avatar chips (initials + deterministic color) with optional role chip and a remove "✕", an `Add student` inline search (filters unassigned roster), a `Roles` control cycling roles (Facilitator / Scribe / Skeptic / Reporter / Timekeeper), an under-target warning row ("Fewer than 4 members" / "No students yet"), and a delete-team icon.
- States: Empty (unassigned pool of all students) · In-progress (some placed, warning chips on undersized teams) · Done (all placed, Locked badge).

## PILLAR 3 — ACTIVITIES (workspace + the upload loop)
**Activity list:** cards each dominated by the loop/stage bar `Setup → Individual → Discuss → Resubmit → Closed` (current stage filled), plus title, team-set name, submission counts ("18/24 individual attempts in"), and up to three deadline chips (Opens · Individual due · Team due) with a live-countdown style when under 24h. A `New activity` button.

**The Workspace** (opened from an activity card OR from a gradebook column header): ONE screen with a persistent **View as student ⇄ View as faculty** toggle in its header (one workspace, two lenses — never a separate preview screen or sidebar jump). Header repeats the activity title + the loop/stage bar.

Faculty lens = four tabs:
1. **Source** — the prompt/reading/case body + attached files, shown read-only ("The original upload is shown as-is").
2. **Submission** — the upload-loop status: individual (Round 1) submissions in, then team-or-individual (Round 2) resubmissions, with per-student and per-team rollups. This tab launches the Student-responses review screen. Faculty see WHAT was submitted, per student and per team.
3. **Discussion** — metadata + what each team SUBMITTED in Round 2, plus role assignments and a demo audio-discussion list (static waveform bars + Play; clearly a non-authoritative demo placeholder, no real audio). Faculty do NOT see the team's private scratch resources here — only submitted output.
4. **Progress** — this activity's loop funnel (individual → discussion → resubmit conversion), a per-student/per-team who's-done view, and a `Post check-ins to gradebook` action that writes this activity's scores into Pillar 1 and flips its column header to "Posted".

Student lens (same workspace, toggled): a three-step stepper ALWAYS visible at top — `① Your attempt → ② Team discussion → ③ Team answer`:
- **Step ①** Left = the source/brief read-only. Right = an upload field: a drag-drop dropzone ("Upload your answer" / "or take a photo of handwritten work") PLUS a text box, and a `Submit Round 1` button. Draft state says "Saved as draft — only you can see this." Submitted state: "Submitted ✓ — editable until the deadline."
- **Step ②** Private team space: shows my team's individual submissions side by side once Round 1 closes, and an `Add a resource` control (upload field + text, attributed to the member). Explicit privacy note: "These team resources stay private to your team — faculty see what you submit, not your working space."
- **Step ③** Greyed/disabled until Step ① is submitted, with an inline REASON (never a dead-end): "Submit your own answer first to unlock the team step." Behavior forks on the activity's `resubmitMode`: team → one shared answer, any member uploads, others see "Submitted by Priya on behalf of the team", button `Submit team answer`; individual → each member resubmits their own; choice → an explicit two-button fork `Submit as team` / `Submit my own answer`, each with a one-line consequence ("A team answer counts for everyone; your own answer counts only for you").

**Student-responses review screen** (launched from the Submission tab or a column header): shows EVERY student's response for the activity, not just flagged ones. A filter row (`All` · `Needs review` · `By team` · `Unscored`) with counts and an empty state. Each response card: student avatar + name + "…· individual prep" + a status badge (amber "Needs review" or green "High confidence"). A **zoomable scan**: render a FAKE handwritten scan with CSS (a cursive/handwriting web-safe font on a ruled-paper gradient background), captioned "[filename].jpg · click to enlarge"; clicking opens a modal showing the same content enlarged, closable via ✕ or backdrop click (this is click-to-enlarge, not pinch-zoom). Below the scan, an "AI transcription" block with the suspect substring wrapped in an amber flag style (e.g. a misread "1180" or "4l2"). Actions: flagged cards show `Confirm transcription` (primary) + `Edit text` (ghost, makes the transcription contenteditable inline); high-confidence cards show only `Edit text`. `Confirm transcription` flips the card to confirmed (green "Transcription confirmed", "Confirmed by you") and recomputes filter counts. State this in copy: transcription confirmation is a faculty-owned step DISTINCT from grading; faculty can open any student's response regardless of flag.

## Sample content (ship it populated, realistic)
- Class: "Intro to Systems Biology · 24 students · Fall". Roster of 24 real-sounding, diverse names (e.g. Maya Chen, Liam Ortiz, Priya Nair, Sam Whitfield, Ava Thompson, Kai Nakamura, Ben Okafor, Cora Marsh, Dev Patel, Sofia Rossi, Jamal Harris, Grace Kim, Noah Bergstrom, Aisha Rahman, Leo Martin, Elena Petrova, Marcus Webb, Yuki Tanaka, Hannah Cohen, Diego Alvarez, Zoe Mitchell, Omar Haddad, Ruby Sinclair, Theo Novak). Deterministic avatar initials + color.
- Example activity: **"Membrane Transport — Case 4"**, source = a short case brief about predicting solute movement across a semipermeable membrane, `resubmitMode: "team"`, teams of 4, due chips Opens Mon / Individual due Wed 11:59pm / Team due Fri 5pm. Include at least one second activity in a different stage (e.g. "Enzyme Kinetics — Readiness Check", individual-resubmit or choice mode) so per-activity team config and multiple stage states are visible.
- Example check-in columns under Case 4: an individual "iRAT" (readiness, points/10), a team "tRAT" (team, points/15), an individual "Participation" (complete/incomplete), and a team "Milestone 2" (points). Seed a realistic mix of cell states across the 24 students so the grid shows scored, submitted-unscored, needs-review, and not-started at once, plus one team visibly "behind".
- Teams: pre-form ~6 teams with themed names (Team Helix, Team Ribosome, etc.), members, and assigned roles; leave one team under target to show the warning state.
- Responses review: 6 seeded response cards (3 flagged / needs-review, 3 high-confidence) with fake handwritten scans and transcriptions containing plausible OCR misreads.

## Must-not-violate rules
- Never blur individual vs team: every submission and every cell must always state which round (1 individual / 2 team-or-individual) and which identity (student vs team) it carries.
- Never leak the team's private discussion space to faculty — faculty see only submitted Round 2 output.
- Never show a student their peers' scores; a student's own check-in view is their row/strip only.
- Keep it to three pillars — no chat, no rubric builder, no course authoring, no cross-class dashboard, no fourth tab, no standalone workspace nav item.

Deliver as ONE `.html` file that opens and works by double-clicking, unbranded, with both light and dark themes and full responsiveness.

---

## Open decisions (worth settling before/while building)
1. **Default resubmit mode** — ship the flagship activity as team-only (simplest to demo the individual→team lift) or choice mode (richest fork, more student-facing UI)? Draft defaults to team-only + a second activity showing choice.
2. **Student's own Check-ins view** — a separate privacy-safe "my check-ins strip", or only build the faculty gradebook this pass and keep the student lens workspace-only?
3. **How real the scan/transcription feels** — keep CSS-faked handwritten scans + canned OCR misreads (clearly demo), or wire a real file-picker that previews a dropped image (no OCR, just display)?
4. **"Post check-ins to gradebook"** — actually mutate Pillar 1 columns live (nice demo of the seam), or leave it labeled but inert to reduce scope?
