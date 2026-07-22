# Collage AI — Team Learning Module: Frontend Build Spec (AI-ready)

> Paste this whole document into your coding AI. It specifies a two-role web app (Instructor / Student) implementing a team-based learning activity engine modeled on Kelly Miller's design. Build as a single-page app with client-side routing. Every screen, tab, state, and business rule is specified. ★ = MVP (ship first); ◇ = v1.x (build the screen shell with a "coming soon" state if time-boxed.)

---

## 1. Design tokens

```
Colors:
  navy (primary text/brand):   #002341
  ink (body text):             #0A0A0A
  muted text:                  #737373  /  #9A9A9A
  background (app canvas):     #F5F1E6  (warm cream)
  surface (cards/panels):      #FFFFFF, border #E5E5E5, radius 14px, shadow 0 1px 2px rgba(0,0,0,.04)
  section-divider on cream:    #E7E1D2
  STAGE COLORS (used as a system — chip tint + soft background):
    prep/individual-blue:      #0382ED on #EAF4FE
    discussion-purple:         #8A3FFC on #F4ECFE
    collective-orange:         #FF6713 on #FFF0E6
    individual-final-navy:     #002341 on #E9EEF3
    assessment-green:          #0E7C57 on #E7F5EF
  warning amber:               #B45309 on #FFF4E5
  danger red:                  #B91C1C on #FDECEC
Typography:
  Headings: serif (e.g., Georgia/"Copernicus"-like), 600 weight, -0.02em tracking; h1 30px
  Body/UI: clean sans (e.g., Geist/Inter), 13–15px
  Mono (calculations, scores): Geist Mono / ui-monospace
Icons: Material UI outlined style throughout.
AI marker: every AI-generated element gets an orange "sparkle" (✦ #FF6713) label — non-negotiable.
```

## 2. Core concepts & business rules (enforce in UI everywhere)

- **Stage pipeline per activity:** `Individual prep → Team discussion → Final submission (COLLECTIVE or INDIVIDUAL, set by instructor) → Assessment`. Render as a chip sequence with arrows wherever an activity is summarized. ★
- **Immutable originals:** a student's prep answers become permanently read-only at submission ("originals"). Never editable, never overwritten by later work, always labeled `original`. Teammates see originals only — never drafts or post-discussion work. ★
- **Completeness ≠ correctness:** prep is graded for completeness only (credit awarded for attempting); the final submission is graded for correctness/quality against a rubric. Display these as two separate values everywhere (gradebook, student grade view, submission confirmations). Copy: *"This submission is assessed for completeness, not correctness."* ★
- **Prep gate:** the team stage is locked until the student submits individual prep. ★
- **AI proposes, instructor approves:** AI-generated questions, rubrics, and grades are drafts until explicitly approved. Both AI-suggested and instructor-approved grades are stored and shown. ★
- **Submission mode switch:** `mode: 'COLLECTIVE' | 'INDIVIDUAL'` on each activity changes student nav, workspace screens, and grading structure (details in §6/§7). ★
- **Oral check-ins are separate:** oral scores never modify the written grade or completeness credit. ◇

## 3. Data model (client state / API shape)

```ts
Course { id, name, code, term, studentCount, teamCount }
Activity {
  id, title, objective, description, learningObjectives[],
  estimatedTime, individualDue, teamStageWhen, gradeValue,      // e.g. 20 pts
  mode: 'COLLECTIVE' | 'INDIVIDUAL',
  status: 'draft' | 'scheduled' | 'prep-open' | 'team-stage' | 'grading' | 'released',
  questions: Question[], rubric: RubricCriterion[], oralRubric: RubricCriterion[],
  prepSettings {                                                 // all booleans, defaults true unless noted
    requireAllAttempted, requireWrittenReasoning, requireUploadOnQ(n),
    requireOcrConfirmation, aiCompletenessAssessment (AI✦),
    hideCorrectnessFeedback, lockOriginalOnSubmit, awardPrepCredit }
  teamSettings {
    requirePrepBeforeAccess, showTeammateNames, showOriginalsOnly,
    showUploadsAndOcr, releaseOneQuestionAtATime (default false), allowInstructorPause }
  collectiveSettings { allMembersEdit, requireParticipationConfirm,
    sameGradeForAll, showContributionHistory, startBlankWorkspace }
  individualSettings { requireEveryStudentSubmit, keepFinalsPrivate,
    oneSubmissionLimit, releaseFinalsAfterGrading (default false), aiSuggestedGrading (AI✦) }
}
Question { n, type: 'multiple-choice'|'short-response'|'long-response'|'numerical'|'handwritten-upload',
  prompt, options?[],                                            // MC only
  aiMeta? { objective, sourceCitation, suggestedAnswer, completenessRule, likelyMisconception, difficulty } }  // AI✦
Team { id, number, name, members: Member[], locked, roles { recorderId? } }
Member { id, name, initials, avatarTint }
OriginalResponse { memberId, activityId, answers { [qn]: value }, upload? { filename, imageUrl, ocrText, ocrConfirmed, flaggedSymbols },
  status: 'complete' | 'needs-review', submittedAt, LOCKED: true }   // immutable after submit
CollectiveResponse { teamId, text, attachments[], editingMemberId?, lastEditedAt,
  participationConfirmed { [memberId]: bool }, submittedBy?, submittedAt?, locked }
IndividualFinalResponse { memberId, text, attachments[], submittedAt?, locked, PRIVATE: true }
RubricCriterion { criterion, points, description, aiMayScore: bool }
AiGradeSuggestion { criterion -> { score, max, evidence: string, confidence: 'High'|'Medium' } }  // AI✦
ApprovedGrade { criterion -> score, total, feedback { criterion -> string }, releasedAt }
OralRecord { teamId, memberId, questionN, scores { criterionIdx -> n }, total, note?, absent: bool }
OralTeamResult { teamId, records: OralRecord[], averageApplied?: number }
GradebookRow { student, perActivity { prepCredit: [earned, max], submissionScore, flag? } }
```

## 4. App shell & routing ★

- **Rail (far left):** two role icons — Instructor 🎓, Student 👤. Switching role switches the whole workspace (demo affordance; in production it's auth-driven).
- **Sidebar (288px):** grouped nav (see §5, §7). Active item highlighted. User card at bottom (name, role · course).
- **Top bar (sticky):** `[COURSE CODE] › [context]` breadcrumb; right side: student's team badge (student role only), notification + help icons. Backdrop-blur cream.
- **Main content:** max-width 1180px, generous padding, page header pattern = serif h1 + muted subtitle + right-aligned action buttons.
- Routes: `/i/dashboard, /i/library, /i/roster, /i/teams, /i/builder, /i/ai, /i/rubric, /i/live, /i/oral/:teamId, /i/grading, /i/results` · `/s/activities, /s/prep, /s/ocr, /s/confirm, /s/discussion, /s/collective, /s/individual, /s/participation, /s/grades`

## 5. INSTRUCTOR sidebar structure ★

```
Teaching
  ├─ Course dashboard      ★
  └─ Activity library      ★
Roster & teams
  ├─ Roster & import       ★
  ├─ Team management       ★
  └─ Team formation        ◇  (criteria-based wizard — gap addition)
Authoring
  ├─ Activity builder      ★
  ├─ AI generation         ◇
  └─ Rubric builder        ★ (manual) / AI-gen ◇
Class & assessment
  ├─ Live dashboard        ★ (status only) / controls ◇
  ├─ Grading               ★
  ├─ Results & analytics   ◇
  └─ Peer evaluation       ◇  (gap addition)
```

## 6. INSTRUCTOR screens — detailed

### 6.1 Course dashboard ★
- 4 stat cards: `Students 24 (across 6 teams)` · `Prep complete 21/24 — 88% ready` · `Needs review 3 — flagged submissions` · `Awaiting grade 4 teams`.
- "Active activity" panel: icon tile, title, due line ("Individual due Wed 11:59pm · Team stage Thu in class"), badge `Team stage today`, button **Open live view**; below it the 4-stage chip pipeline (mode-aware: shows collective OR individual-final chip).
- "Prep by team" panel: horizontal progress bar per team (`Team 4 — 3/4`, bar green when full, orange when incomplete).
- Header actions: **New activity** → builder · **Import roster** → roster wizard.

### 6.2 Activity library ★
- 2-col grid of activity cards: icon tile, status badge (`Team stage today` orange / `Grading` lavender / `Draft` gray / `Scheduled` sky), title, `{n} questions · {mode label with icon}`. Click → builder.
- Header actions: **Create manually** · **Generate with AI ✦**.

### 6.3 Roster & import ★ — 4-step wizard with stepper (Upload → Map columns → Validate → Confirm)
- **Step 1 Upload:** dashed dropzone ("Drop a CSV or Excel roster… supports .csv, .xlsx · first row should be column headers"); footer: fields we read (name, email, student ID, team, section, role) + **Download sample template**.
- **Step 2 Map columns:** each source column (mono chip, e.g. `first_name`) → arrow → dropdown of platform fields incl. "Ignore column".
- **Step 3 Validate:** 4 stat tiles (`24 valid`, `2 need attention`, `6 teams detected`, `1 missing email`); warning alert ("Fix the flagged rows, or import now and resolve later"); table of rows with per-row status badges: `OK` / `No email` (red) / `Two teams` (amber, e.g. "Team 3 / Team 4").
- **Step 4 Confirm:** success card — "24 students across 6 teams. Historical team records were preserved." → **Manage teams**.
- Back/Continue in header; Continue label becomes "Confirm import" on step 3.

### 6.4 Team management ★
- 2-col grid of team cards: header (groups icon, `Team {n}`, optional `Locked 🔒` badge, member count — amber if under target size), member rows (avatar, name, role badge e.g. `Recorder`, overflow menu), under-size warning ("Fewer than 4 members"), actions **Add student** · **Roles**.
- Header actions: **Import updated roster** · **Create team**.
- ◇ Team formation wizard: pick criteria (skills survey, schedule, demographics distribution rules) → preview balanced teams → apply. (CATME-style; stub the screen.)

### 6.5 Activity builder ★ — 5 tabs
- **Tab: Details** — inputs: Activity title, Description, Learning objectives (multiline bullets), and a 3-col row: Estimated time / Individual due / Grade value.
- **Tab: Questions** — question cards: drag handle, number tile, type badge, special badge `Written work required` on handwritten-upload, prompt text, duplicate + delete icons. Actions: **Add question**, **Preview student view** (switches to student prep screen). Question types: multiple choice (options list), short response, long response, numerical (unit-aware input), handwritten upload.
- **Tab: Individual prep** — description line: "Individual prep is assessed for completeness, not correctness." Then 8 toggle rows (label + sublabel + switch; ✦ on AI ones): Require every question attempted · Require written reasoning · Require uploaded work on Q{n} · Require OCR confirmation · Use AI completeness assessment ✦ ("Flags blank, illegible, or off-topic work for review") · Hide correctness feedback · Lock original after submission · Award preparation credit.
- **Tab: Team stage** — 6 toggles: Require individual completion before access · Show teammates' names ("otherwise responses appear anonymously") · Show original responses only ("Never expose in-progress or post-discussion work") · Show original uploaded work & OCR · Release one question at a time (default OFF) · Allow instructor to pause the activity.
- **Tab: Submission mode** — REQUIRED choice between two big selectable cards:
  - `COLLECTIVE` (orange): "One collective response per team — students discuss their original responses and create one shared submission. It receives a team grade based on the rubric."
  - `INDIVIDUAL` (navy): "One post-discussion response per student — each student privately submits a final response, graded individually."
  - Below, mode-specific toggle panel. COLLECTIVE: Allow all team members to edit ("otherwise only a designated recorder edits") · Require participation confirmation · Apply the same grade to all members ("instructor may still adjust individually") · Show contribution & edit history · Begin with a blank shared workspace ("No original answer is copied in automatically"). INDIVIDUAL: Require every student to submit · Keep post-discussion responses private · Limit students to one final submission · Release teammates' responses after grading (default OFF) · Use AI-suggested grading ✦.
  - **Preview how students see this** link.
- Header actions: **Regenerate with AI ✦** · **Publish activity**.

### 6.6 AI activity generation ◇
- Left column (340px): **Source materials** panel (uploaded files list with type icons + check marks, e.g. "Bridge structures (reading).pdf — 6 pages"; **Add material**) and **Parameters** panel (Student level, Subject area, Length "5 questions · 45 min", Difficulty, Thinking type, Final submission mode) + **Generate draft** button.
- Right column: before generation → empty state ("You'll get editable questions with answer keys, completeness rules and rubric hints"). After → info alert "Draft generated from 4 sources — every item keeps a citation," then per-question AI cards: number, type + difficulty badges, prompt, and an AI-meta block (✦ per line): Learning objective · Source used · Suggested answer · Completeness rule · Likely misconception. Card actions: **Accept / Edit / Regenerate / Add follow-up**.
- Footer: **Generate matching rubric** → rubric builder · **Open in builder**.
- Rule: nothing generated ever auto-publishes.

### 6.7 Rubric builder ★ (manual) / AI-gen ◇
- If AI-generated: amber alert "AI-generated — your approval required… it will not be used for grading until you approve it"; **Approve rubric** disabled until reviewed.
- Criterion cards: name + ✦, points, per-criterion **"AI may score" toggle**, description, 4 performance-level mini-cells (Exemplary/Proficient/Developing/Beginning with auto-scaled point values and short descriptors).
- Separate section: **Oral check-in rubric** (preset, lavender): 3 criteria — Clarity of explanation (3) · Depth of understanding (4) · Responds to follow-up (3) = 10 pts. Note: "Scored separately from the written submission — it never changes the team grade or completeness credit." **Edit oral rubric**.

### 6.8 Live dashboard ★ status / ◇ controls
- Control bar: pulsing live dot "Team discussion live" · countdown "18:24 remaining" · buttons: **Release Q2 ◇ · Extend time ◇ · Announce ◇ · Pause ◇ · Close stage (destructive)**.
- 4 stat cards: Prep complete 21/24 · Missing prep 3 ("joined without prep") · Teams active 4/6 ("1 submitted, 1 idle") · Needs assistance 1 ("Team 4 flagged").
- Team grid (3-col): each card = `Team {n}` + status badge (`Submitted` green / `Active` lavender / `Needs help` amber / `Not started` gray), progress bar (colored by status), 4 prep-dots (green = member prepped), `Message team` link on flagged teams, and an **Oral check-in 🎙 button** (disabled for Not started). Hint line: "Click a team to run an oral check-in."

### 6.9 Oral check-in ◇ — 4-phase state machine (route `/i/oral/:teamId`)
- **Phase SELECT:** roster strip of prior check-ins (chips: name + score, or `absent`, or pending ○; shows running team average "7.5 / 10"); big panel with all member avatars (dimmed when already checked/absent; each has a tiny "Mark absent" link), **🎲 Select at random** button → spin animation cycles through ELIGIBLE members only (excludes checked-in + absent), lands randomly; right panel: question picker (Q1–Q5 buttons) + info alert "Absent and already-checked students are excluded from the next random draw."
- **Phase PRESENT/SCORE:** banner: avatar, name, badge `Randomly selected 🎲`, "Presenting Q{n} · {type}", **Mark absent** button, pulsing "Listening 🎙". Left: the question card + oral rubric criteria as tap-to-score button rows (0…max per criterion). Right: live total `7 / 10`, optional note input ("e.g. Strong on load path; revisit units."), **Save oral score**, **Cancel & re-pick**.
- **Phase DONE:** confirmation card — "{Name} presented Q{n} for Team {n}", big score, running team average, note "Kept separate from the written team submission and the completeness credit." Actions: **Check in another** (if eligible members remain) · **Review & apply team average**.
- **Phase SUMMARY:** list of records (absent rows amber: "Marked absent — receives 0, excluded from average"), big `Team average (n present): 7.5/10`, then either info alert + **Apply average to whole team**, or success state "Applied — {n} present students received 7.5/10; absent students received 0."
- Rules: absent ⇒ score 0 + excluded from average; average application overwrites individual oral scores for present members only; all oral data stays out of written grades.

### 6.10 Grading ★ — toggles: `Submissions ⇄ Gradebook`, and within Submissions `Individual ⇄ Team`
- Left queue (230px): students (avatar, name, status: Submitted / Needs review amber / graded ✓) or teams (dot-status, `Team {n}`, "Submitted 2:31 / In review / Not submitted").
- Detail column: **Response card** (who — team tile or avatar, what — submitted text, attachments with ✦OCR chips, submitted-at) + **Grading panel**:
  - Header: "Rubric-based grading — graded for correctness & quality against the approved rubric" · big total `17 / 20` · badge `AI-suggested ✦`.
  - Per criterion row: name · confidence badge (`High confidence` green / `Medium` amber) · editable score input `5 / 6` · ✦ **Evidence:** one-line quote from the submission justifying the score.
  - Info alert: "AI suggestion vs. your grade are kept separate. Adjust any score to override. Both are preserved in the record."
  - Actions: **Save draft** · **Approve & release grade** (team version: "Approve & release team grade").
- **Gradebook view:** legend chips ("Individual = completeness of prep" blue · "Submission = shared team grade" orange or "= individual final grade" navy); table: student rows × activity columns; each cell shows TWO sub-scores: `Individual 5/5 (completeness)` | `Team 17/20 (shared grade)` + optional amber `reviewed` flag. Footer note: "Completeness credit and the graded submission are stored separately for every student — the completeness grade is never affected by the correctness of the final work."

### 6.11 Results & analytics ◇ — 3 tabs
- **Analytics:** stat cards (Submission rate 6/6 teams or 23/24 · Avg score 15.8/20 · Changed answer 58% "after discussion" · Incorrect→correct 31% "improved"); panel "Rubric performance by criterion" (h-bars with %); panel "Preparation → performance" (bars: prep complete 88%, on-time 79%, OCR issues 8% + success alert "Students who completed prep on time averaged 3.2 points higher on the final rubric.").
- **Original → final:** info alert ("Original responses are preserved unchanged. The comparison never overwrites either record."); table: Student | Original (Q1 choice) | Final (Q1 choice) + `Changed ↻` sky badge or "kept" | Score.
- **Team convergence:** per-team before/after answer distribution bars (Original: Suspension 2, Cable-stayed 1, Arch 1 → Final: Suspension 4); "Degree of convergence: High — 4 of 4 agree after discussion"; amber alert "Persistent misconception: one student still treats horizontal cable force H as the maximum tension — worth revisiting in class"; "Convergence by team" h-bars (100%/75%/50% color-coded).
- Header: **Export results**.

### 6.12 Peer evaluation ◇ (gap addition — stub acceptable)
- Per activity or per checkpoint: students rate teammates on 5 behavioral dimensions (BARS descriptions per level), forced differentiation (divide 50 pts among 5 teammates, min 7 / max 13 — not everyone equal), results screen for instructor with flags (clique, conflict, low/over-confidence) and a grade-adjustment factor preview.

---

## 7. STUDENT sidebar & flow ★

```
Learn
  └─ My activities                          ★
{Active activity title}                      ← activity-scoped section
  ├─ Individual prep                        ★
  ├─ Team discussion                        ★  (locked until prep submitted)
  ├─ Final submission                       ★  (label + destination depends on activity.mode)
  └─ Grades & feedback                      ★
```
- Top bar shows `Team {n}` badge with purple groups icon.
- Nav rule: "Final submission" routes to `/s/collective` when mode=COLLECTIVE, `/s/individual` when mode=INDIVIDUAL; the participation screen counts as the collective route for active-state highlighting.

### 7.1 My activities ★
- Vertical list of activity cards: stage icon tile (colored by current stage), title, `{due line} · {progress}` (e.g., "Team stage open now · Prep complete 5/5"), status badge (`Team discussion` lavender / `Graded` green / `Not started` gray), chevron. Click → the relevant stage screen.

### 7.2 Individual prep ★
- Page header: "Individual preparation — Work on this independently before class. **Your original answers are saved and shown to your team — you cannot change them afterward.**"
- Activity banner (blue, left-border): stage chip + "Assessed for completeness, not correctness. Due Wed 11:59pm."
- Meta row: "✓ Autosaved just now · {n} of 5 attempted".
- Question cards by type: number tile + type badge + prompt, then: MC → radio group · numerical → small unit-hinted input ("e.g. 1180 kN") · short/long → textarea (2/4 rows) · handwritten-upload → dashed dropzone ("Upload a photo or PDF of your calculations — We run OCR so your team can read it during discussion"); after OCR confirm, dropzone turns green: "calc_bridge_load.jpg — OCR confirmed · Tap to review the transcription again" + ✦ "OCR transcription ready · you reviewed 2 flagged symbols".
- Sticky footer: **Save draft** · **Submit preparation 🔒** (validate against prepSettings; block if requireAllAttempted fails).

### 7.3 OCR review ★ (sub-screen of prep)
- Two-panel: left "Original upload" (filename badge, rendered handwritten image, "Page 1 of 1 · handwritten") · right "OCR transcription ✦ Auto-transcribed" with amber alert "**2 symbols were uncertain** — we highlighted where the handwriting was hard to read. Please correct anything wrong," editable textarea of the transcription, **Confirm transcription**.
- Copy note: "The original image is always kept — this text is just an interpretation your team can read."

### 7.4 Prep submitted — confirmation ★
- Centered success card: ✓ ring icon, "Preparation submitted," subtitle "Your original response is locked and preserved. Your team will see it during the discussion."
- Receipt rows: Submitted (Wed 9:42 PM) · Completeness (Complete — 5/5 attempted) · Preparation credit (Awarded, 5 pts) · Original response (Locked · cannot be edited 🔒).
- Info strip: "This submission is assessed for completeness, not correctness. It will be shown to your team during discussion."
- Actions: **Back to activities** · **Continue to team stage →**.

### 7.5 Team discussion ★
- Header: "Team discussion — Compare everyone's original reasoning, then discuss in person. **You only see original prep — never what teammates change now.**"
- Purple activity banner: "Team 3 · Maya, Liam, Priya, Sam". Info alert: "**Original responses are read-only.** These are the answers your teammates submitted before class. Post-discussion work stays private until it is submitted."
- Question navigator: pill buttons Q1–Q5 (active = navy).
- Current-question card: number tile, type badge, objective tag (green, e.g. "Objective: justify a load-bearing decision"), prompt.
- Section label "YOUR TEAM'S ORIGINAL RESPONSES" → 2×2 grid of member cards: avatar, name (+`You` badge, own card blue-tinted), "Submitted Wed · original", status badge (`Complete` green / `Needs review` amber), then the member's original answer for the selected question (uploads render as file chip + ✦OCR + mono excerpt; unanswered → "— not attempted").
- Bottom mode panel (orange or navy left-border): stage chip + "set by your instructor" + mode explainer text + CTA **Open shared workspace** (COLLECTIVE) or **Open my private response** (INDIVIDUAL).

### 7.6 Collective workspace ★ (mode=COLLECTIVE)
- Header: "Team's final response — One shared answer for Team 3. Everyone can contribute; one member submits it for a shared grade." Right meta: "↻ Autosaved".
- Layout: left rail (320px) "YOUR ORIGINAL RESPONSES" — compact read-only cards of each member's Q1 choice + reasoning; lock note: "Originals stay read-only. Nothing is copied in automatically." Main: "YOUR TEAM'S FINAL RESPONSE" panel — presence avatars + "Liam is editing" + "Edited 2:14 PM", big shared textarea (starts blank), buttons **Attach final calculations** · **Copy selected original in** (explicit action).
- Alert: "Participation & submission — All members confirm participation, then one member submits for the whole team." → **Confirm & review**.

### 7.7 Participation confirmation ★
- Card listing each member: avatar, name (+you), status text ("Confirmed contribution" / "Awaiting confirmation"), green `Confirmed ✓` badge, toggle switch.
- Alert states: warning "Waiting on confirmations — every member must confirm before the team can submit" → success "All members confirmed."
- **Submit for team** (disabled until ALL confirmed) → success card: "Team response submitted — Submitted on behalf of Team 3 by Maya Chen · All 4 members confirmed participation · Awaiting team rubric grade · Shared response locked."

### 7.8 Individual final workspace ★ (mode=INDIVIDUAL)
- Header: "My final individual response — After discussing, write your own revised answer. **This is private — teammates never see it, and it does not replace your original prep.**"
- Same left rail of originals (lock note: "Your original prep is kept and never overwritten."). Main panel: navy `Private to you 🔒` alert ("Teammates cannot see what you write here. You may revise until the deadline."), textarea, **Upload final calculations**, **Submit for grading 🔒** → success card ("Private · teammates cannot see this response" / "Original prep preserved separately — not overwritten" / "Awaiting rubric-based grading").

### 7.9 Grades & feedback ★
- Green assessment banner: "Team 3 rubric result · released by Dr. Alvarez" (or "Your rubric result…").
- Left: "Rubric breakdown" panel (`Instructor-approved` badge): per criterion — name, score `5 / 6` (green when full, amber otherwise), feedback sentence.
- Right: big score card `17 / 20` + badge `Shared across Team 3` (orange) or `Individual grade` (navy); info alert ✦ "**How this was graded:** AI suggested scores against the rubric with evidence from your submission; your instructor reviewed and approved them."; lavender badge "Original prep preserved — completeness credit awarded separately."

---

## 8. Shared component inventory (build once)

- `StageChip(stage, big?)` — icon + label pill in stage colors ★
- `StatCard(label, value, icon, tint, sub)` ★
- `Panel` (white card), `PageHeader(title, subtitle, actions)` ★
- `Avatar(member, size)` — initials on tinted circle ★
- `SettingRow(label, desc, defaultOn, aiFlag)` — toggle row, ✦ when AI ★
- `Stepper(steps, current)` — numbered circles with check states ★
- `QuestionNav(questions, activeIdx)` — pill row ★
- `ScoreButtonsRow(max, value)` — tap-to-score 0…max (oral rubric) ◇
- `AiBadge/sparkle(label)` — orange ✦ marker ★
- `StatusBadge(variant)` — success/warning/destructive/sky/lavender/orange/outline ★
- `ProgressBar(pct, color)`, `PrepDots(n, total)` ★
- `ConfirmationCard(title, receiptRows, actions)` ★
- `ModeSelectorCards(value)` ★
- `HBar(label, value, max, tint, rightLabel)` — analytics bars ◇

## 9. Seed data (render this so every screen has realistic content)

- Course: "Introduction to Engineering" · ENGR 101 · Fall 2026 · 24 students · 6 teams. Instructor: Dr. Elena Alvarez.
- Activity: **"Bridge Design Decision"** — objective "Evaluate structural options against site constraints and justify a load-bearing decision." · 20 pts · mode COLLECTIVE (demo the INDIVIDUAL variant via a prop/toggle).
- Questions: 1 MC "Which bridge structure is most appropriate for the proposed 90 m span over a deep gorge?" (Beam/Arch/Suspension/Cable-stayed) · 2 Long "Explain the reasoning behind your structural choice…" · 3 Numerical "Calculate the expected axial load (kN) on one main cable at midspan." · 4 Handwritten upload "Upload your written calculations supporting Q3." · 5 Short "Identify one important design tradeoff."
- Team 3: Maya Chen (MC, blue, you) · Liam Ortiz (LO, purple) · Priya Nair (PN, green) · Sam Whitfield (SW, orange).
- Originals: Maya→Suspension (≈1,180 kN) · Liam→Cable-stayed (≈1,050 kN) · Priya→Suspension (≈1,210 kN) · Sam→Arch (≈1,400 kN, status Needs review). OCR sample: "Span L = 90 m, w = 32 kN/m → W = 2880 kN → H = 3600 kN → T_max ≈ 1180 kN per cable."
- Rubric: Correct structure choice 4 · Quality of reasoning 6 · Load calculation accuracy 6 · Units & assumptions 2 · Tradeoff analysis 2 (= 20). AI suggestion for Team 3: 4,5,5,2,1 = 17/20 with evidence lines + High/Medium confidence.
- Oral rubric: Clarity 3 · Depth 4 · Follow-up 3 (= 10).
- Other library activities: "Statics Warm-up: Free-body Diagrams" (INDIVIDUAL, Grading) · "Materials Selection Case" (INDIVIDUAL, Draft) · "Truss Analysis Project Milestone" (COLLECTIVE, Scheduled).

## 10. Build order (matches the one-month plan)

1. Shell + routing + role switch + design tokens + shared components
2. Student prep flow (7.2 → 7.4) incl. lock semantics; OCR screen with mocked transcription
3. Team discussion (7.5) + both final workspaces (7.6–7.8) + participation logic
4. Instructor: builder 5 tabs (6.5) + roster wizard (6.3) + team management (6.4)
5. Grading + gradebook (6.10) with AI-suggestion objects mocked
6. Dashboard + library (6.1–6.2); stub Live/Oral/Results/AI-gen/Formation/Peer-eval screens with real layouts, "coming soon" states
7. Polish: empty states, loading, disabled logic, responsive down to 1280px

## 11. Hard rules checklist for the AI (do not violate)

- [ ] Originals become read-only at submit and render with a lock icon + "original" label everywhere
- [ ] Completeness credit and correctness grade never merge into one number in any view
- [ ] Team stage routes are unreachable (locked nav item + guard) until prep is submitted
- [ ] COLLECTIVE vs INDIVIDUAL mode changes: student nav label/destination, workspace screen, grading queue (teams vs students), gradebook column caption, grade-view badges
- [ ] Every AI-generated element carries the ✦ marker; every AI grade shows evidence + confidence; nothing AI auto-releases without an instructor action
- [ ] Participation confirmation: submit disabled until every member toggle is on
- [ ] Oral scores render only in oral contexts — never added into written totals
- [ ] Teammates' finals are never visible to students (unless releaseFinalsAfterGrading is ON and grades are released)
