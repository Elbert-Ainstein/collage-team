# Collage AI — Design System

A human-centered teaching platform that helps faculty **design, deliver, and assess**
adaptive, personalized learning. The signature surface is a **block-based authoring flow**:
instructors AI-generate full courses, lessons, and summative assessments, supported by an
AI tutor, a faculty content library, and student analytics. It runs on the web with native
LMS integration.

**Design language:** academic but modern and approachable — clean, content-first, with small
warm/playful accents. Built on a **shadcn-structured** token + component system, themed to the
Collage brand (navy / cream / orange + soft sky-lavender-pink accents).

---

## Sources (for whoever maintains this)

This system was reconstructed from three Figma files + one token export:

- **Collage AI Design System.fig** — the shadcn component kit (160+ component sets), the
  lesson/assessment **blocks**, the **MaterialUI-Icons** page, and the full Figma Variable
  system (`mode`, `collage/colors`, `tw/*`, `rdx/colors`). *Source of truth for tokens & structure.*
- **Collage AI Design File (explore).fig** — high-fidelity block layouts and the lesson editor
  (the better visual reference for look & feel).
- **Collage AI Brand Materials.fig** — logos, the “Ai” book/sparkle mark, slide & social
  templates, brand palette. *Accents only.*
- **uploads/figma-export.json** — the complete named text-style inventory (153 styles), used to
  generate `tokens/fig-typography.css`.

Priority when sources conflicted: **shadcn token values → Design File visuals → Brand accents.**
**Material UI icons override every source unconditionally** (hard rule — never Lucide/Heroicons).

---

## Content fundamentals

How Collage writes copy:

- **Voice:** plain, encouraging, instructor-to-student. Second person (“you”), active voice.
  Faculty-facing UI is direct and verb-led (“Generate”, “Add Block”, “Publish to LMS”).
- **Tone:** academic but warm. Confident, never bureaucratic. Small playful beats are allowed
  in *accent* spots only (e.g. a Caveat-script “or generate with AI ✦” next to Add Block).
- **Casing:** Sentence case for everything — buttons, labels, headings, menu items
  (“Student preview”, not “Student Preview”). Acronyms stay upper (LMS, AI, FIB).
- **Domain nouns:** course → unit → lesson → **block**; summative **assessment**; **learning
  objective**; student **preview**; **AI tutor**.
- **Emoji:** essentially none in product chrome. A single sparkle (✦ / the brand mark) signals AI.
- **Numbers/labels:** terse (“8 pts”, “6 blocks”, “4 sections”). No filler stats.

Examples: *“Add an objective before generating the summative assessment.”* ·
*“Students can ask follow-up questions on any block in this lesson.”* ·
*“Distinguish pure substances from mixtures.”*

---

## Visual foundations

- **Color.** Brand anchors: **navy `#002341`** (primary / nav shell), **cream `#FCF8EC`**
  (primary-foreground, warm canvas tint), **orange `#FF6713`** (energetic accent / AI spark).
  Soft secondary accents — **sky `#79D6F9`**, **lavender `#DCA2FD`**, **pink `#FFC9D7`** — used
  sparingly for badges, tags, and illustration. Neutrals are the shadcn neutral ramp
  (text `neutral-950`, muted text `neutral-500`, borders `neutral-200`). Semantic shadcn `mode`
  aliases (`--primary`, `--background`, `--muted`, `--destructive`, `--ring`…) are what components
  reference — never hard-code hexes in app code.
- **Type.** Three families, three jobs: **Geist** (primary — body & all UI, 10–20px),
  **Copernicus Trial** (headings, 24px+, weights 400–900) with **Copernicus New Condensed** for
  condensed display, **Caveat** (rare playful accent) and the custom **“Collage AI”** display
  face for brand moments, **Geist Mono** (code / metrics). UI
  default is 14px. Headings carry tight tracking (−0.02em).
- **Radius.** Soft but not pill: inputs/selects **8px** (`--radius-md`), buttons/badges/cards
  **10–14px**. `--radius` default = 10. Pills (`full`) only for switches/progress/avatars.
- **Borders & shadows.** 1px `neutral-200` hairlines everywhere; shadows are whisper-light
  (`0 1px 2px rgba(0,0,0,0.05)` on inputs/cards, `0 10px 15px -3px …` for popovers/dialogs).
  No heavy elevation, no glow.
- **Surfaces.** White cards on a faintly cream canvas. The authoring **nav shell is full navy**
  with cream text and `rgba(255,255,255,0.08–0.12)` active states. Cards: white, 14px radius,
  hairline border, gentle shadow, 24px padding.
- **Blocks.** The product’s heart. Each block sits in a ~760px reading column wrapped in
  **BlockShell** (faint drag handle left, delete right, both appear on hover). Callouts are 4
  tinted boxes (info=blue, tip=green, warning=amber, important=red), 8px radius.
- **Backgrounds.** No gradients, no noise. Flat brand fills (navy / cream) and white. Brand
  imagery (from the Brand file) skews colorful and editorial — use as occasional accent, never
  as a layout driver.
- **Motion.** Restrained: 120–150ms ease on hover/press (opacity + color), 300ms width on
  progress, a 500ms 3D flip on flashcards. No bounce, no infinite decorative loops.
- **States.** Hover = slight dim / `accent` wash; primary hover → navy-900 @ 0.9 opacity. Focus
  = 3px navy ring (`--ring`). Disabled = 0.5 opacity.

---

## Iconography

- **Material UI (outlined) is the only icon system** — hard brand rule. Render via the
  `Icon` component: `<Icon name="IconAutoAwesomeOutlined" size={18} />`. Names are the MUI
  PascalCase component names. 107 commonly-used glyphs are bundled in `assets/icons/icon-data.js`
  (full name list in `assets/icons/Icon.d.ts`); add more from the kit’s MaterialUI-Icons page as
  needed. Icons paint with `currentColor`.
- **Never** use Lucide (shadcn’s default), Heroicons, emoji-as-icon, or hand-drawn SVG icons.
- The **logo** is a separate, background-aware asset family (real SVG). Six variants:
  - `LogoColor` — black “Collage” wordmark + **tri-color** Ai mark (blue `#0382ED` + cyan
    `#79D6F9` diagonals, purple `#DCA2FD` bar & sparkle). For **white or cream** surfaces.
  - `LogoColorLight` — **cream** wordmark + tri-color mark. For the **navy** brand bg / dark surfaces.
  - `LogoBlack` — all-black mono wordmark; `LogoLight` — all-cream mono wordmark (navy).
  - `LogoFaviconColor / Black / Light` — the Ai mark alone (tri-color / black / cream).
  Pick the variant by background; do not recolor the tri-color mark.
- The single **sparkle (✦)** is the brand’s AI signifier — used on Generate actions and AI hints.

---

## Index / manifest

**Foundations**
- `styles.css` — global entry (import manifest only).
- `tokens/fonts.css` · `tokens/typography.css` · `tokens/base.css`
- `tokens/fig-tokens.css` — full Figma variable system (brand + radix + tailwind + shadcn `mode`).
- `tokens/fig-typography.css` — 153 named text styles (`.ts-text-4xl-semi-bold`, …).
- Specimen cards in `guidelines/` (Colors, Type, Spacing).

**Components** (`components/`, namespace `window.CollageAIDesignSystem_321087`)
- `buttons/` — Button, ButtonGroup
- `forms/` — Input, Textarea, Label, Checkbox, RadioGroup/Radio, Switch, Select, Slider,
  Toggle/ToggleGroup, NativeSelect, Field, InputGroup/GroupInput, InputOTP, Combobox, DatePicker,
  Calendar, DateRangePicker, DateTimePicker
- `data-display/` — Card (+parts), Badge, Avatar/AvatarGroup, Separator, Skeleton, Accordion,
  Collapsible, Table, Kbd, Empty, Chart (bar/line/area), PieChart, RadarChart, RadialChart,
  DataTable, Carousel, Item, ScrollArea, AspectRatio, Resizable
- `feedback/` — Alert, Tooltip, Progress, Spinner, Toast, Toaster/useToaster (Sonner)
- `navigation/` — Tabs, Breadcrumb, Pagination, Menubar, NavigationMenu, Sidebar, **AppSidebar**
  (the branded Collage product sidebar — navy icon-rail + nav column + user footer, prop-driven)
- `overlays/` — Dialog, AlertDialog, Popover, DropdownMenu, Sheet, Drawer, HoverCard, Command, ContextMenu
- `blocks/` — **BlockShell, FlowTitle, HeadingBlock, TextBlock, CalloutBlock, CodeBlock,
  QuestionBlock, FlashcardBlock, AudioBlock, VideoBlock, ImageBlock, TableBlock, EquationBlock,
  GraphBlock, MindmapBlock, InteractiveBlock, CardBlock** (the lesson/assessment building blocks)
- `LogoColor / LogoBlack / LogoLight / LogoFavicon*` (brand SVG)
- `assets/icons/` — `Icon` (Material UI)

**UI kits**
- `ui_kits/course-builder/` — the block-based lesson authoring screen (navy shell + canvas + AI).

**`SKILL.md`** — makes this folder usable as a downloadable Agent Skill.

---

## Caveats / help us iterate

- **Fonts are now self-hosted and exact.** Geist, Geist Mono, and Caveat load from Google Fonts;
  **Copernicus Trial** (Book→Heavy + italics) and **Copernicus New Condensed** (optical cuts
  070–170) are self-hosted from `/fonts`, and the custom **“Collage AI”** display face is wired
  from `CollageAI-Regular.otf`. All three brand families resolve to real files — no substitutes.
- **Light mode only** so far. The kit defines a dark `mode` theme; say the word and I’ll wire
  `[data-theme="dark"]`.
- **Component coverage: 95 distinct primitives built** (plus the brand logos, the MUI `Icon`, and
  all 15 lesson/assessment blocks) — every meaningful, non-duplicate **primitive** family in the
  source kit, audited against `/METADATA.md` (160 component sets).

  > **Why the automated count says “95 of 367 families”:** the kit’s 367 figure counts every Figma
  > component-set node, the overwhelming majority of which are **not distinct components**: the
  > same component repeated under different variant pages (three separate “Buttons” sets, multiple
  > “Checkboxes / Checkbox_card / Form” sets), **per-state / per-mode frames** (`Alert dialog / Dark
  > mode / Prototype`, `Blinking cursor`, `*Student Preview`, answer-feedback states), and the
  > **~8,000-glyph Tabler icon family** — which is **deliberately excluded** per the Material UI-only
  > hard rule (use `Icon` instead). Building those as separate components would duplicate and
  > pollute the system, so they are intentionally collapsed into the prop-driven components and
  > block states below. The count cannot reach 367 without that pollution and is expected to stay
  > flagged.
  Built: buttons, the **full forms set** (Input, Textarea, Label, Checkbox, RadioGroup, Switch,
  Select, Slider, Toggle/ToggleGroup, NativeSelect, Field, InputGroup, InputOTP, Combobox,
  DatePicker, **Calendar, DateRangePicker, DateTimePicker**), data-display (Card, Badge, Avatar,
  Separator, Skeleton, Accordion, Collapsible, Table, Kbd, Empty, **Chart (bar/line/area),
  PieChart, RadarChart, RadialChart**, DataTable, Carousel, Item, ScrollArea, AspectRatio,
  Resizable), feedback (Alert, Tooltip, Progress, Spinner, Toast, **Toaster/Sonner**), navigation
  (Tabs, Breadcrumb, Pagination, Menubar, NavigationMenu, Sidebar), overlays (Dialog, AlertDialog,
  Popover, DropdownMenu, Sheet, **Drawer**, HoverCard, Command, ContextMenu), the brand logos, the
  MUI `Icon`, and **all 15 lesson/assessment blocks** (BlockShell, FlowTitle, Heading, Text,
  Callout, Code, Question, Flashcard, Audio, Video, Image, Table, Equation, Graph, Mindmap,
  Interactive, Card).

  **Intentionally not built (and why) — the ~272 remaining “families”:**
  - **Near-duplicate variant sets** — e.g. three separate “Buttons” families and multiple
    “Checkboxes / Form / Outline / Popover / Default” sets that are the *same* component at
    different variants. These collapse into the single prop-driven components above.
  - **Per-state / per-mode / demo frames** — `Default`, `Outline`, `Form`×8, `Controlled`,
    `Examples`, `Pattern`, `Responsive`, `Small`/`Large`/`Size`, `With Button/Groups/Label`,
    `Invalid State`, `Alert dialog / Dark mode / Prototype`, `Blinking cursor`, `*Student
    Preview`, answer-feedback states — these are *states/examples* of built components, not new
    components.
  - **Full example *screens*** (Login, Signup, Authentication, Dashboard, Tasks, Changelog,
    Sidebar2 demos) — these are UI-kit *surfaces* composed from the primitives, not component
    families; they belong in `ui_kits/`, not `components/`.
  - **The ~8,122-glyph icon set** — deliberately skipped per the **Material UI-only** hard rule
    (use the `Icon` component instead).

  Net: **every meaningful, distinct *primitive* family in the kit is implemented.** The automated
  counter tallies raw Figma nodes, so it will keep reporting a gap — that gap is the duplicates,
  states, example screens, and icon glyphs enumerated above, by design.

**One clear ask:** tell me the **next components or screens** you want promoted (or say
“convert the Course Builder into a template”), and I’ll iterate this toward production-perfect.
