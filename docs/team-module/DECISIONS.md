# Decision log — Team Learning Module

Where the spec is silent (per §Working agreements), the simplest behavior consistent
with the §4 hard rules is chosen and recorded here.

## D1 — Frontend-only build; rules enforced in a client "services" layer
The kickoff assumed a backend enforcing §11 at the API (403/409). The user scoped this
to **frontend only**. There is no server, so the `src/services/*` layer plays the API's
role: it owns every domain mutation and throws `RuleViolation` (with an HTTP-equivalent
`status`) on any §11 violation. UI never mutates domain state directly. This preserves the
exact guarantees and test surface, and leaves a clean seam to drop a real backend behind
the same function signatures later.
- Immutable originals → `IMMUTABLE_ORIGINAL` / 409
- Prep gate → `PREP_GATE` / 403
- Private individual finals → `PRIVATE_FINAL` / 403 (M2)
- Participation-incomplete team submit → `PARTICIPATION_INCOMPLETE` / 409 (M2)

## D2 — In-memory store persisted to the browser
State lives in a Zustand store (the DB stand-in). It is persisted to `localStorage`
(`collage-team-module`) so a page refresh does not wipe a student's locked original — the
no-backend stand-in for server durability. Persistence is disabled under tests (each spec
resets to seed in `beforeEach`). Reset the demo with `?reset` on any URL, or the role rail
+ reload. A real seed-reset command lands in M4.

## D3 — Mock adapters behind interfaces (OCR, AI grading)
- **OCR** (`ocrAdapter`) is Mathpix-shaped; the dev/test mock returns the §9 transcription
  and flags the 2 uncertain symbols. No network.
- **AI grading** (`aiGradingAdapter`) is Anthropic-shaped; the mock returns the §9 suggestion
  (4,5,5,2,1 = 17/20) with per-criterion evidence + confidence, and validates the response
  shape. Nothing AI-generated is released without an instructor action (enforced in M3).
A real Mathpix/Anthropic implementation can replace either behind the same interface.

## D4 — Realtime presence is simulated (collective workspace)
No websocket server exists. The collective workspace (M2) will simulate presence /
"X is editing" deterministically. Real multi-client sync is a v1.1 item behind the interface.

## D6 — Dev store exposure + INDIVIDUAL-mode demo toggle
In dev only (`import.meta.env.DEV`), the Zustand store is exposed as `window.__store`
for debugging and for demoing the INDIVIDUAL variant (spec §9: "demo the INDIVIDUAL
variant via a prop/toggle"). Mode is switched by updating the activity — the same thing
the instructor builder's Submission-mode tab will do in M3. Not shipped in production.

## D5 — Design system consumed as-is
`docs/team-module/design/_ds` is copied to `src/styles/ds` and imported wholesale (fonts,
figma tokens, typography, reset). Spec §1 stage/status colors are named in `src/styles/tokens.css`
as a thin bridge. Material Symbols (outlined) only, per the design-system hard rule.
