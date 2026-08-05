# Collage AI — Team Learning Module (3rd pillar)

A team- and project-based learning engine modeled on Harvard's AP 50 (Prof. Kelly Miller).
Two roles (Instructor / Student), four-stage activity pipeline, immutable originals,
completeness-vs-correctness grading, AI-suggested rubric grading, OCR review.

**This is a frontend-only build.** An in-memory store (persisted to the browser) stands in
for the backend; a `services/` layer enforces the business rules the way an API would. See
[`docs/team-module/DECISIONS.md`](docs/team-module/DECISIONS.md).

## Stack
React 18 · TypeScript · **Next.js (App Router)** · Zustand · Vitest · Playwright.
Client-rendered and frontend-only — no route handlers, no server data (see DECISIONS D7).

## Run
```bash
npm install
npm run dev            # http://localhost:5180  (boots into the §9 demo, student role)
npm run build          # next production build
npm run test           # rule-enforcement + unit tests (Vitest)
npm run typecheck
```
- Switch roles with the far-left rail (🎓 Instructor / 👤 Student).
- Reset the demo to seed: append `?reset` to any URL.

## Source of truth
- Spec: [`docs/team-module/frontend_build_spec.md`](docs/team-module/frontend_build_spec.md)
- Approved design: `docs/team-module/design/` (screenshots, `.dc.html`, `_ds` tokens)
- Decisions / deferred: `docs/team-module/DECISIONS.md`, `docs/team-module/TODO-deferred.md`

## Layout
```
app/          Next App Router route tree (i/* instructor, s/* student) — thin pages
              that render the screen components; layout.tsx mounts the shell
src/
  shell/      AppShell + role rail, sidebar, top bar, Boot (client chrome)
  routes/     student/ + instructor/ screen components
  components/ §8 shared inventory
  services/   rule enforcement (immutability, prep gate, privacy) + mock OCR/AI adapters
  store/      Zustand store (persisted to localStorage)
  seed/       §9 seed data
  types/      §3 data model
  flags/      TEAM_MODULE_* feature flags
  styles/     global.css (imports the _ds design system + all app styles)
tests/rules/  the priority §11 rule-enforcement suite
```

## Milestones
- **M1 (done)** — shell, routing, role switch, tokens, shared components; student prep flow
  (prep → OCR review → submit-and-lock); immutability + prep-gate enforced & tested.
- **M2 (done)** — team stage (discussion, collective/individual workspaces, participation, privacy).
- **M3 (done)** — instructor core: activity builder (5 tabs, live toggles), roster import wizard,
  team management, rubric builder, AI-suggested grading + approve/release, gradebook, course
  dashboard, activity library, and the student grade view. Full author→grade→release→student loop.
- M4 — ◇ stubs polish (oral, live controls, results, AI-gen, formation, peer-eval), empty/loading/
  error states, responsive, Playwright happy paths, seed-reset command, deploy.

Reset states: `?reset` = populated "grading day" demo · `?reset=fresh` = pre-prep (student authoring).
