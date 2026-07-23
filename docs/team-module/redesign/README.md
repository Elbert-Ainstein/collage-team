# Inline Block System — Prototype

Interactive prototype of the Collage AI **inline block editor**: text is the canvas, and
blocks are objects dropped into the flow of that text (see the Inline Block System PRD).
Built from the block designs in the *Collage AI Design System* Figma file.

## Run it

```bash
npm install
npm run dev
```

Open <http://localhost:5173>.

- **`http://localhost:5173`** — the preset *States of Matter* lesson with every block type inline.
- **`http://localhost:5173/?blank`** — empty document ("Type / to insert a block or start writing").

## What's implemented

**Editor core**

- Free text writing anywhere; Enter splits paragraphs, Backspace heals them back together.
- **Slash menu** (PRD §1.2): type `/` at line start or after a space → grouped menu
  (Content / Interactive / Media / Data & Code), strict-prefix filtering, Enter inserts the
  first match, space dismisses the menu for that `/`, "Couldn't find anything…" empty state.
- **Floating format toolbar** on text selection: bold / italic / underline / strikethrough,
  alignment (exclusive), highlighter with the 4 design swatches, H1–H3 (exclusive), lists,
  block quote, link, inline code — with active-state highlighting.
- **Block chrome**: drag handle + delete on hover, drag-to-reorder with drop indicator,
  md drop shadow while a block is selected/being edited, Backspace after a block selects it
  first, arrow keys move past blocks, Ctrl/Cmd+Z undoes block operations.
- **Shared state model** (PRD §1.4): empty → editing → saving → idle, plus generating
  (shimmer overlay), generation-failed (in-place Retry / Edit manually / Delete), and
  faculty-edit vs **student preview** modes (toggle in the top bar).

**All 15 block types** from the Figma block pages, each with editor + student states:
Header (with Learning Objectives card), Cards, Image (upload / link / search / AI prompt),
Video (link + AI-generate flow), Audio (custom player), Callout (Info / Tip / Warning /
Important), Code (syntax highlighting, language menu, copy), Table (add/delete rows &
columns, row reorder, 9×6 limits), Flashcards (flip + tab strip), Graph (bar / line /
scatter / area), Equation (KaTeX + math keyboard), Questions (Multiple Choice, Fill in the
Blank, Short Answer, Open Ended with weighted criteria — full student submit/feedback
flow), Mind Map (draggable nodes, connections, zoom, fullscreen), Interactive (particle
motion simulator demo).

## Demo conventions

- **AI generation is simulated**: empty blocks show a ✦ *Generate* affordance that fills
  sample content after ~2s. **Shift-click Generate** to demo the generation-failed state.
- Saving is simulated (status chip on the block + Saved/Saving indicator in the top bar).
- Fonts: Geist (as in Figma); Copernicus is proprietary, so Source Serif 4 stands in for
  display/serif text.

## Notes / known gaps

- Storage: in-memory only (prototype) — the PRD's Option A/B storage decision is untouched.
- Availability rules (STEM-only blocks, questions only in Exercises/Summatives) are not
  enforced; every block is available in the menu for exploration.
- LaTeX in flowing text (outside the Equation block) is not wired up yet.
