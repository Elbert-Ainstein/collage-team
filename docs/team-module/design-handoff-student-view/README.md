# Handoff: Collage AI — Student View

## Overview

The student-facing half of the Collage AI team-learning module (modeled on Harvard AP 50). Two top-level tabs:

1. **Assignments** — everything the student owes, grouped by week, drilling into an assignment detail and a "my work" submission screen.
2. **Team resources** — per-activity folders holding the artifacts the student's team produced (whiteboard photos, audio recordings, notes/files) plus faculty feedback PDFs.

The faculty view is a separate design (`Faculty view - redesign.dc.html` in the source project) and is **not** part of this handoff, but the two share the same shell, palette, and card language — build the shared chrome once.

## About the design files

`student-view.html` in this bundle is a **design reference created in HTML** — a self-contained prototype showing intended look and behavior. It is **not** production code to copy.

The task is to **recreate this design in the target codebase's existing environment** (React/Next.js, etc.) using its established component library, routing, and data layer. If no environment exists yet, pick the most appropriate framework and implement there.

The source project it came from is a Next.js app (`app/ck/page.tsx` + `src/checkins/*`) using Supabase for persistence — the existing `ClassCheckins.tsx` / `ActivitiesPillar.tsx` / `GradebookPillar.tsx` are the faculty side and are the pattern to follow for data access.

## Fidelity

**High-fidelity.** Final colors, typography, spacing, and interactions. Every value below is exact. Recreate pixel-perfectly using the Collage AI design system components rather than re-implementing primitives.

---

## Core concept: scope, not type

This is the most important modeling decision in the design and the easiest thing to get wrong.

There are four **activity types**. The type only determines a label and an accent color. What actually changes the UI is the activity's **scope**:

| Type | Scope | Accent | Detail screen |
|---|---|---|---|
| Challenge | `both` | `--orange-500` `#ff6713` | Individual + Team tabs |
| Combo | `indiv` | `--navy-700` `rgb(31,102,163)` | No tabs — individual layout only |
| Skills | `indiv` | `--sky-700` `#0e7490` | No tabs — individual layout only |
| Amplify | `team` | `--lavender-600` `#9405e6` | No tabs — team layout only |

`SCOPE_LABEL = { both: "Individual + team", indiv: "Individual", team: "Team" }`

Rules:
- A `both` activity shows a two-tab segmented control (Individual / Team). Default tab: `indiv`.
- An `indiv` activity renders only the individual layout, no tabs.
- A `team` activity renders only the team layout, no tabs.
- "Labs" was a fifth type in earlier iterations and has been **removed**. Do not implement it.

---

## Screens

### 1. Shell (persistent)

Two-column: fixed sidebar + main panel.

**Sidebar** — `width: 238px; flex: 0 0 238px; display:flex; flex-direction:column; padding: 22px 14px 14px`. Sits directly on the page background (`--cream-300`), no border or fill of its own.

Contents, top to bottom:
- Course title — `--font-serif`, `--text-xl` (20px), `line-height: 1.18`, `--weight-bold`, `letter-spacing: --tracking-tight`. Copy: "Applied Physics 50".
- Meta row — `display:flex; gap:6px; margin-top:6px`, `--text-xs`, `--muted-foreground`. Copy: "AP50A" · "· Fall".
- Team chip — `display:flex; align-items:center; gap:9px; margin-top:12px; padding:9px 10px; border:1px solid --neutral-200; background:--cream-300; border-radius:--radius-lg`. Contains a 28px `Avatar` with initials "T3", styled `background: --lavender-300; color: --navy; font-weight: --weight-bold`. Then a two-line block: "Team 3" (`--text-xs`, `--weight-semibold`) over "Maya · Nikolai · Olivia · you" (`--text-2xs`, `--muted-foreground`, truncated with ellipsis).
- Nav — `display:flex; flex-direction:column; gap:4px; margin-top:18px`. Two ghost `Button`s, `full-width`, `justify-content: flex-start`, `height: 38px`, `padding: 0 11px`, `--text-sm`.
  - Active: `background: --cream-400`, `color: --navy`, `font-weight: --weight-semibold`, `border: 1px solid --neutral-200`.
  - Inactive: `background: transparent`, `color: --muted-foreground`, `font-weight: --weight-regular`, `border: 1px solid transparent`.
  - "Assignments" — `IconAssignmentOutlined` (18px) start icon; end slot shows a due count: `--text-2xs`, `color: --amber-700 (#b45309)`, tabular-nums, copy "2 due".
  - "Team resources" — `IconGroupsOutlined` (18px) start icon.
  - Assignments is active for the `list`, `detail`, and `work` screens; Team resources for `tr` and `trDetail`.
- Spacer (`flex: 1`).
- Footer — `border-top: 1px solid --neutral-200; padding-top: 10px; display:flex; align-items:center; gap:8px`. Email `--text-xs --muted-foreground` truncated ("p.raman@college.harvard.edu"), then an outline `sm` Button "Sign out" (`height: 26px; padding: 0 10px; font-size: --text-2xs`).

**Main panel** — `flex:1; display:flex; padding: 12px 12px 12px 0`. Inside it one card: `border: 1px solid --neutral-200; background: --cream-200; border-radius: --radius-xl (14px); box-shadow: 0 1px 2px 0 rgba(0,0,0,.05); padding: 26px 30px 34px`.

Page background: `--cream-300`. Body type: `--font-sans`, `--text-sm`, `line-height: 1.45`, `color: --navy`, `-webkit-font-smoothing: antialiased`, `text-wrap: pretty`.

---

### 2. Assignments list

**Purpose:** see everything owed, individually and as a team, and open one.

**Header** — `display:flex; align-items:baseline; gap:14px; flex-wrap:wrap; margin-bottom:6px`. `<h1>` `--font-serif --text-2xl --weight-bold --tracking-tight`, copy "Assignments". Beside it `--text-xs --muted-foreground`: "Everything you owe, and everything your team owes together."

**Filter tabs** — `Tabs` component, `margin: 14px 0 18px`. Options: `All`, `To do · 2`, `Submitted · 3`, `Graded · 4`. Default `all`. (Filtering is not yet wired — the tabs are presentational; wire them to the real counts.)

**Week groups** — `display:flex; flex-direction:column; gap:22px`.

Each group has a heading row: `display:flex; align-items:center; gap:10px; margin-bottom:9px` containing the label (`--font-serif --text-base --weight-bold --tracking-tight`), the dates (`--text-xs --muted-foreground`), then a `flex:1; height:1px; background:--neutral-200` rule filling the remainder.

Groups in the mock: "This week" / "Week 5 · Mar 3–7", and "Last week" / "Week 4 · Feb 24–28".

**Activity row** — a `<button>`, `display:flex; align-items:center; gap:16px; width:100%; padding:13px 16px; border:1px solid --neutral-200; border-left:3px solid <type accent>; background:--cream-100; border-radius:--radius-lg (10px); box-shadow:0 1px 2px 0 rgba(0,0,0,.05); text-align:left; cursor:pointer`.

Left to right:
1. Type label — `flex:none; width:82px; --text-2xs; letter-spacing:--tracking-wide; text-transform:uppercase; --weight-semibold; color: <type accent>`.
2. Flexible middle (`flex:1; min-width:0`):
   - Title row: `display:flex; align-items:center; gap:9px; flex-wrap:wrap` — title in `--font-serif --text-base --weight-bold --tracking-tight`, then an outline `Badge` with the scope label (`height:20px; font-size:--text-2xs; color:--muted-foreground`).
   - Due line: `--text-xs --muted-foreground; margin-top:3px`.
3. Status `Badge` — variant by status (table below).
4. Grade — `width:74px; flex:none; text-align:right; --text-xs; color:--navy; font-variant-numeric: tabular-nums`.
5. Chevron — `IconChevronRightOutlined`, 18px, `--muted-foreground`.

Status → Badge variant:

| Status | Variant |
|---|---|
| Turned in | `sky` |
| Late | `warning` |
| Not started | `outline` |
| Graded | `success` |
| Discussing | `warning` |
| Excused | `secondary` |

Clicking a row → assignment detail for that activity, with the tab preset to `team` if the activity's scope is `team`, otherwise `indiv`.

**Seed data (exact copy used in the mock):**

Week 5:
- `ch5` Challenge · "Ballistic pendulum" · due "Due Thu 9:00am · discussion Thu 2:00pm" · Not started · grade "—" · 5 questions · desc "Work the pendulum problem set on your own, then bring your answers to the Thursday discussion." · instructions "Record the discussion. Rotate who presents each problem."
- `sk5` Skills · "Vector decomposition" · "Closed Tue 4:00pm" · Late · "7 / 10" · 8 questions · desc "Timed quiz on resolving forces into components."
- `am5` Amplify · "Peer explanation set" · "Marked at the Tue check-in" · Graded · "Complete" · 3 prompts · instructions "Explain each prompt to the team. Record the session."
- `co5` Combo · "Momentum & collisions" · "Closed Sun 11:59pm" · Turned in · "—" · submitted "Sun 11:47pm" · 10 questions · desc "Five tutorial questions and five challenge questions."

Week 4:
- `ch4` Challenge · "Rolling without slipping" · "Closed Feb 28" · Graded · "Complete" · submitted "Thu 8:52am" · 4 questions
- `co4` Combo · "Energy bookkeeping" · "Closed Feb 23" · Graded · "18 / 20" · submitted "Sun 10:12pm" · 10 questions

---

### 3. Assignment detail

**Purpose:** read the brief, open your work, and (for team scopes) see the recording and live grading.

Back link at top: `Button variant="link" size="sm"` with `IconChevronLeftOutlined` (15px), styled `color:--muted-foreground; font-size:--text-xs; text-decoration:none`. Copy "All assignments".

Below it a two-column layout: `display:flex; gap:22px; align-items:flex-start; flex-wrap:wrap; margin-top:10px`. Left column `flex:1; min-width:420px`; right rail `width:270px; flex:none; display:flex; flex-direction:column; gap:12px`.

**Left column header** — type `Badge` (variant per type: Challenge `orange`, Combo/Skills `sky`, Amplify `lavender`) then `<h1>` `--font-serif --text-2xl --weight-bold --tracking-tight` with the activity title. Under it `--text-xs --muted-foreground`: `"{week} · {scope label}"`, e.g. "Week 5 · Individual + team".

**Tabs** — rendered only when scope is `both`. `Tabs` component, `margin: 16px 0 0`, options Individual / Team.

#### Individual layout

- Description `Card` (`background:--cream-100; border:1px solid --neutral-200; border-radius:--radius-lg; padding:18px 20px; box-shadow:0 1px 2px 0 rgba(0,0,0,.05); margin-top:14px`):
  - Eyebrow "Description" — `--text-2xs; letter-spacing:--tracking-wide; text-transform:uppercase; --muted-foreground`.
  - Body `<p>` — `margin:8px 0 0; --text-sm; line-height:1.6; color:--navy; max-width:68ch`.
  - Badge row `margin-top:14px; gap:8px` — a `secondary` badge with the question count, a `warning` badge with the due string.
- Action row `margin-top:14px; gap:12px` — primary `Button` "Open my work", then `--text-xs --muted-foreground`: "Saved 4 minutes ago · 3 of 5 questions answered".

#### Team layout

Three stacked cards, same card styling as above (`margin-top:12px` for the 2nd and 3rd):

1. **Instructions** — eyebrow + `<p>` same as Description.
2. **Audio**
   - Header row: eyebrow "Audio" (`flex:1`) + a `warning` Badge with `IconMicOutlined` (13px) reading "Recording · 12:41".
   - Body `display:flex; gap:16px; align-items:center; margin-top:14px; flex-wrap:wrap`:
     - Waveform (`flex:1; min-width:280px`): 64 bars in `display:flex; align-items:flex-end; gap:2px; height:46px`. Bar `i`: `flex:1; min-width:2px; border-radius:2px; height: round(8 + |sin(i*0.7)*26| + (i%5)*2)px`. Bars `i < 38` are `--navy` (played), the rest `--neutral-300`. Below it a `display:flex; justify-content:space-between; --text-2xs; --muted-foreground; margin-top:6px; tabular-nums` row: "00:00" / "Trial 2 · Nikolai presenting" / "12:41".
     - Feedback column (`width:230px; flex:none; border-left:1px solid --neutral-200; padding-left:16px`): eyebrow "Feedback", `<p>` `--text-xs; line-height:1.55; --muted-foreground`, then "Generated from the recording" in `--text-2xs`.
   - Footer: right-aligned outline `sm` Button "Add to Team resources" with `IconAddOutlined` (15px).
3. **Team resources strip**
   - Header: eyebrow "Team resources" (`flex:1`) + link `sm` Button "Open all" → navigates to the resource detail.
   - Three 150px-wide tiles, `display:flex; gap:10px; flex-wrap:wrap`. Tile: `border:1px solid --neutral-200; background:--cream-300; border-radius:--radius-md (8px); overflow:hidden`. Top strip `height:62px; display:flex; align-items:center; justify-content:center` with a 20px icon and a per-kind background: image → `--neutral-100`, audio → `--sky-100 (#e3f6fd)`, doc → `--cream-400`. Below, `padding:8px 10px`: title `--text-xs --weight-semibold`, meta `--text-2xs --muted-foreground; margin-top:2px`.
   - Mock content: "Final board / Thu 2:14pm" (`IconImageOutlined`), "Thursday session / 12:41" (`IconMicOutlined`), "Trials 1–3 / Generated" (`IconAssignmentOutlined`).

#### Right rail

**Status / Grade card — individual tab only.** Same card styling, `padding:16px 18px`.
- Eyebrow "Status", then a status `Badge` (variant from the table above), then a timestamp line `--text-xs --muted-foreground; margin-top:8px; tabular-nums`. The timestamp is derived: `"Submitted {submitted}"` if there's a submission time, else "Submitted late" for Late, else "Marked in session" for Graded, else "Nothing submitted yet".
- `height:1px; background:--neutral-200; margin:14px 0` divider.
- Eyebrow "Grade", then the grade in `--font-serif --text-lg --weight-bold --muted-foreground` — "Pending" when the grade is "—". Below it a note: `team` → "Team mark"; `both` → "Your mark, plus the team discussion"; `indiv` → "Released after grading".
- Full-width outline `Button` "Resubmit" (`margin-top:16px`), then a centered `--text-2xs --muted-foreground` note: `"Replaces your {submitted} submission"`, or "You have not submitted yet".

**Live grading sidebar — team tab only.** Deliberately **not** a card: `border-left: 1px solid --neutral-200; padding: 2px 0 2px 20px`.
- Header row: eyebrow "Live grading" (`flex:1`) + a 7px `--emerald-500 (#10b981)` dot.
- `--text-2xs --muted-foreground; margin-top:5px`: "Marked by your instructor during the session".
- Presenter blocks, `display:flex; flex-direction:column; gap:12px; margin-top:14px`. Each: `border-top:1px solid --neutral-200; padding-top:11px`, a row with the slot (`--text-2xs --muted-foreground`) and the name (`--text-xs --weight-semibold`), then score rows `gap:7px; margin-top:9px`.
- Score row: label (`width:78px; flex:none; --text-xs --muted-foreground`), a `Progress` bar (`value`, `max=5`, `height=6`, color `--emerald-600 (#059669)` when the score is 5 else `--navy-700`), then `"{v}/5"` in `--text-xs`, `width:26px`, right-aligned, tabular-nums.
- Mock data: Presenter 1 "Ellie" — Accuracy 5, Collaboration 4. Presenter 2 "Caleb" — Accuracy 4, Collaboration 5.

Gate this whole panel behind a `showLiveGrading` flag (default true) **and** the team tab being active.

---

### 4. My work

**Purpose:** attach pages to questions and submit.

**Header** — `display:flex; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom:16px`: back link Button (chevron + activity name), `<h1>` "My work" (`--font-serif --text-xl --weight-bold --tracking-tight`), "Autosaved · draft" (`--text-xs --muted-foreground`), `flex:1` spacer, "3 of 5 answered" (`--text-xs --muted-foreground`, tabular-nums), primary Button "Submit".

**Body** — `display:flex; gap:20px; align-items:flex-start`.

**Question list** (left, `width:204px; flex:none`, card styling with `padding:12px`):
- Eyebrow "Questions" with `padding: 0 4px 8px`.
- Rows `gap:2px`. Row: `display:flex; align-items:center; gap:8px; padding:7px 8px; border-radius:--radius-md`. Active row (index 3) gets `background:--cream-400`.
  - Id — `width:22px; flex:none; --text-xs --weight-semibold; tabular-nums`.
  - Parts — `flex:1; min-width:0; --text-xs --muted-foreground`, ellipsis-truncated.
  - State dot — 7px circle: done `--emerald-600`, draft `--navy-700`, empty `--neutral-300`.
- Rows: `1a` → "P1, P2" done · `1b` → "P2" done · `2` → "P3" done · `3a` → "P4" draft · `3b` → "P4 · not attached" empty.
- Footer note: `border-top:1px solid --neutral-200; margin-top:10px; padding:10px 4px 2px; --text-2xs --muted-foreground; line-height:1.5` — "Questions can span more than one page. Attach the page and tag it."

**Page cards** (right, `flex:1; min-width:0`): `display:grid; gap:12px; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr))`.

Card: `border:1px solid <--neutral-200 | --cream-500 when Draft>; background:--cream-100; border-radius:--radius-lg; overflow:hidden`.
- Header `display:flex; align-items:center; gap:8px; padding:11px 13px; border-bottom:1px solid --neutral-200` — label `--font-serif --text-sm --weight-bold`, spacer, tag `--text-2xs --muted-foreground`.
- Body `display:flex; flex-direction:column; align-items:center; justify-content:center; gap:8px; min-height:132px; padding:18px; text-align:center; color:--muted-foreground; background: <--neutral-100 | --cream-300 when Draft>` — a 22px icon plus a `--text-xs` caption.
- Footer `display:flex; align-items:center; gap:8px; padding:10px 13px; border-top:1px solid --neutral-200` — a state `Badge` (Attached → `success`, Draft → `sky`), spacer, a link `sm` Button with the action verb.

Cards: `P1 / Q1a / "Photo of worked solution" / Attached / IconImageOutlined / Replace`; `P2 / Q1a, Q1b / same / Attached / IconImageOutlined / Replace`; `P3 / Q2 / "Typed answer · 180 words" / Attached / IconAssignmentOutlined / Edit`; `P4 / Q3a, Q3b / "Nothing attached yet" / Draft / IconAddPhotoAlternateOutlined / Attach`.

**Prompt bar** below the grid: `display:flex; align-items:center; gap:10px; margin-top:14px; padding:13px 16px; border:1px solid --neutral-200; background:--cream-300; border-radius:--radius-lg` — "Q3b has no page attached yet." (`--text-xs --muted-foreground; flex:1`) and an outline `sm` Button "Add a page" with `IconAddOutlined`.

---

### 5. Team resources index

**Purpose:** find the folder for an activity.

Header: `<h1>` "Team resources" + `--text-xs --muted-foreground` "Everything Team 3 has made, filed under the activity it came from. Visible to your team only."

Grid: `display:grid; gap:10px; grid-template-columns: repeat(auto-fill, minmax(252px, 1fr)); margin-top:18px`.

Card (clickable): `display:flex; align-items:flex-start; gap:11px; width:100%; padding:11px 12px; border:1px solid --neutral-200; border-left:3px solid <type accent>; background:--cream-100; border-radius:--radius-lg; box-shadow:0 1px 2px 0 rgba(0,0,0,.05); text-align:left; cursor:pointer`.
- `IconFolderOutlined` 20px, `--muted-foreground`, `margin-top:1px`, `flex:none`.
- Middle (`flex:1; min-width:0`): type label (`display:block; --text-2xs; --tracking-wide; uppercase; --weight-semibold; color:<accent>`), title (`--font-serif --text-base --weight-bold --tracking-tight; margin-top:1px`, ellipsis), then `"{week} · {count}"` in `--text-xs --muted-foreground; margin-top:2px`.
- Overflow affordance: 24px circle, `--neutral-400`, hover `background:--neutral-100; color:--navy`, `IconMoreVertOutlined` 18px, `transition: background 140ms ease, color 140ms ease`.

Note the activity **numbers are intentionally omitted from titles** ("Ballistic pendulum", not "Challenge 5 — Ballistic pendulum") because the week line already carries that.

Mock cards: Challenge / "Ballistic pendulum" / Week 5 / 5 resources · Amplify / "Peer explanation set" / Week 5 / 2 resources · Challenge / "Rolling without slipping" / Week 4 / 3 resources.

---

### 6. Team resources detail

**Purpose:** browse and **add** the team's artifacts; read faculty feedback.

Back link "Team resources". Header row: type `Badge`, `<h1>` with the activity title, `flex:1` spacer, then **both actions grouped in one non-shrinking `flex` container with `gap:10px`** — outline `sm` "View assignment" and primary `sm` "Add resource" (with `IconAddOutlined`). Grouping matters: with the buttons as loose siblings of a `flex-wrap` row they break onto separate lines at narrow widths.

Meta line: "Week 5 · 5 resources · your team only".

Two-column body: a resource list panel on the left, a preview pane on the right.

**Resource panel** — sections separated by hairlines. Section wrapper: `padding: 0 0 14px` for the first, `14px 0` plus `border-top: 1px solid --neutral-200` for the rest.
- Section header: `display:flex; align-items:center; gap:8px; padding: 0 4px 8px` — label (`--text-2xs; --tracking-wide; uppercase; --muted-foreground; flex:1`) and item count (`--text-2xs --muted-foreground`, tabular-nums). The count is **derived from the items array**, never hardcoded.
- Resource row: `display:flex; align-items:center; gap:13px; padding:11px 12px; border-radius:--radius-md; cursor:pointer`. The currently-previewed row gets `background: --cream-400`. Inside: a 34px tile (`border-radius:--radius-md; background:--neutral-100; --muted-foreground`) with a 19px icon, then title (`--text-sm --weight-semibold`, ellipsis) over meta (`--text-xs --muted-foreground; margin-top:2px`).
- **Add row** (per section, when the section accepts uploads): same geometry as a resource row, but the 34px tile is `border: 1px dashed --neutral-300` with a transparent fill, and the row hover is `background: --cream-400` with `transition: background 140ms ease`. Title is the action (`--text-sm --weight-semibold; color:--navy`), subtitle is the hint.

Sections:

| Section | Items | Add row | Add icon |
|---|---|---|---|
| Whiteboard photos | Trial 1 setup (Thu 1:52pm), Momentum table (Thu 2:14pm), Loss estimate (Thu 2:31pm) — all `IconImageOutlined` | "Add a whiteboard photo" / "Take a photo or drop an image" | `IconAddPhotoAlternateOutlined` |
| Audio | Thursday session (12:41 · transcript attached) — `IconMicOutlined` | "Record the discussion" / "Or upload an existing recording" | `IconMicOutlined` |
| Notes & files | *(empty)* | "Add a note or file" / "Working notes, data, a written summary" | `IconAttachFileOutlined` |
| Feedback | Challenge 5 feedback (PDF · marked Thu 2:41pm) — `IconAssignmentOutlined` | **none** — faculty-authored, read-only | — |

**Preview pane** — opens when the feedback PDF row is clicked, styled after a document viewer: a title bar with the file name (`--text-sm`, with "· PDF" in `--muted-foreground`) and an open-in-new affordance (`IconOpenInNewOutlined`, 16px, 28px circle, hover `background:--neutral-100`), then the document body: `flex:1; overflow:auto; padding:34px 44px 44px; font-family:--font-serif; color:--navy`, opening with an eyebrow "AP50A · Week 5" (`--font-sans`), an `<h2>` at 26px `--weight-bold --tracking-tight` naming the activity, and a byline "Team 3 · marked Thu 2:41pm".

**Consistency requirement:** the folder, the feedback item, and the PDF's own heading must all name the same activity. In the mock: folder "Challenge · Ballistic pendulum" → item "Challenge 5 feedback" → document heading "Challenge 5 — Ballistic pendulum".

---

## Interactions & behavior

Navigation is a single `screen` value: `list | detail | work | tr | trDetail`.

| Trigger | Effect |
|---|---|
| Sidebar "Assignments" | `screen = list` |
| Sidebar "Team resources" | `screen = tr` |
| Activity row click | `screen = detail`, `selId = <id>`, `tab = scope === "team" ? "team" : "indiv"` |
| "All assignments" back link | `screen = list` |
| "Open my work" | `screen = work` |
| Back link on My work | `screen = detail` |
| Detail tab change (`both` only) | `tab = indiv | team` |
| "Open all" in the team resources strip | `screen = trDetail` |
| Resource card click | `screen = trDetail` |
| "Team resources" back link | `screen = tr` |
| "View assignment" | `screen = detail` |
| Feedback PDF row click | opens the preview pane; the row takes `background: --cream-400` |

Transitions: hover-only, `140ms ease` on `background` / `color` (and `box-shadow`/`border-color`/`transform` where used). No page transitions.

The effective tab is `scope === "both" ? tabState : scope` — so tab state is ignored for single-scope activities and can't strand the user on a tab that doesn't exist.

**Not yet wired (implement against real data):** filter tabs, Resubmit, Submit, Add resource / add rows (need file pickers + upload), audio recording, overflow menus, "Replace"/"Edit"/"Attach" page actions, Add a page.

---

## State management

```
screen:  "list" | "detail" | "work" | "tr" | "trDetail"   // default "list"
selId:   string                                            // selected activity id, default "ch5"
tab:     "indiv" | "team"                                  // default "indiv"
filter:  "all" | "todo" | "submitted" | "graded"            // default "all"
pdf:     boolean                                           // preview pane open, default true
```

Prop: `showLiveGrading: boolean` (default `true`) — gates the Live grading sidebar.

Derived, not stored: effective `tab`, the flat activity lookup, submission stamp text, grade note, resubmit note, section counts.

**Data needed per activity:** `id`, `type`, `title`, `week`, `due`, `status`, `grade`, `submitted?`, `questionCount`, `description?`, `instructions?`. Scope comes from the type, not the row. Plus per-activity resource collections (whiteboard photos, audio + transcript, notes/files, feedback PDFs) and, for team activities, the live-grading rubric rows (presenter slot, name, criterion, score out of 5).

Faculty-authored artifacts (feedback PDFs, rubric scores) are read-only to students. Student-authored resources are visible to the team only — enforce this server-side, not just in the UI.

---

## Design tokens

All values come from the Collage AI design system (`_ds/collage-ai-design-system-…/tokens/`). Use the CSS variables, not the literals.

**Surfaces:** `--cream-100` `rgb(255,252,242)` (cards) · `--cream-200` `rgb(255,250,236)` (main panel) · `--cream-300` `rgb(252,248,236)` (page bg, inset tiles) · `--cream-400` `rgb(239,223,173)` (active/selected) · `--cream-500` `rgb(238,216,152)` (draft borders)

**Ink:** `--navy` `rgb(0,35,65)` · `--navy-700` `rgb(31,102,163)` · `--muted-foreground` (secondary text)

**Lines & neutrals:** `--neutral-100` `rgb(245,245,245)` · `--neutral-200` `rgb(229,229,229)` (every hairline) · `--neutral-300` `rgb(212,212,212)` · `--neutral-400` `rgb(163,163,163)`

**Accents:** `--orange-500` `#ff6713` (Challenge) · `--sky-700` `#0e7490` (Skills) · `--lavender-600` `#9405e6` (Amplify) · `--lavender-300` (team avatar) · `--emerald-600` `#059669` / `--emerald-500` `#10b981` (complete) · `--amber-700` `#b45309` (due/late) · `--sky-100` `#e3f6fd`

**Type:** `--font-sans` = Geist (body/UI) · `--font-serif` = Copernicus Trial (headings) · `--font-mono` = Geist Mono.
Scale: `--text-2xs` 10 · `--text-xs` 12 · `--text-sm` 14 · `--text-base` 16 · `--text-lg` 18 · `--text-xl` 20 · `--text-2xl` 24.
Weights: `--weight-regular` 400 · `--weight-semibold` 600 · `--weight-bold` 700.
Tracking: `--tracking-tight` −0.02em · `--tracking-wide` 0.02em.

**Radius:** `--radius-md` 8px (rows, tiles) · `--radius-lg` 10px (cards) · `--radius-xl` 14px (main panel) · `999px` (avatars, icon buttons).

**Spacing:** 2 · 3 · 4 · 6 · 8 · 10 · 11 · 12 · 13 · 14 · 16 · 18 · 20 · 22 · 26 · 30 · 34px.

**Shadow:** `0 1px 2px 0 rgba(0,0,0,.05)` — the only elevation in the design.

---

## Design system components used

From the `CollageAIDesignSystem_321087` bundle: `Button` (variants `primary`, `outline`, `ghost`, `link`; sizes `default`, `sm`, `icon-sm`; `full-width`, `start-icon`, `end-icon`), `Badge` (`outline`, `secondary`, `success`, `warning`, `sky`, `orange`, `lavender`, `pink`), `Card`, `Tabs` (`tabs=[{value,label}]`, `value`, `on-change`), `Progress` (`value`, `max`, `height`, `color`), `Avatar` (`initials`, `size`), `Icon` (`name`, `size`).

**Icons (all verified present in the bundle — the set is not complete MUI, so check before adding new ones):** `IconAssignmentOutlined`, `IconGroupsOutlined`, `IconChevronLeftOutlined`, `IconChevronRightOutlined`, `IconMicOutlined`, `IconAddOutlined`, `IconCheckOutlined`, `IconPlayArrowOutlined`, `IconFolderOutlined`, `IconImageOutlined`, `IconAddPhotoAlternateOutlined`, `IconAttachFileOutlined`, `IconMoreVertOutlined`, `IconOpenInNewOutlined`.

Names that do **not** exist and were tried during design: `IconPhotoCameraOutlined`, `IconUploadFileOutlined`, `IconDescriptionOutlined`.

## Assets

None. No photography or illustration. Whiteboard thumbnails and the PDF preview body are placeholders — real images and generated PDFs need to come from the app.

## Files

- `student-view.html` — the design reference, self-contained, open it in a browser. All five screens are reachable by clicking.
- `Student view - redesign.dc.html` — the authored source (template + logic) the reference was built from. Useful for reading exact style values.
