// Shared closed sets and design-system values for the Roster & Teams board.
// Kept here so no screen carries a literal list or magic number.

import type { TeamCadence } from "./types";

/** Team size bounds on the "Teams of" stepper. */
export const TEAM_SIZE_MIN = 2;
export const TEAM_SIZE_MAX = 8;
export const TEAM_SIZE_DEFAULT = 4;

/** Team names, in order, from the design's fixed list. */
export const TEAM_NAMES = [
  "Helix", "Quartz", "Delta", "Ember", "Nimbus", "Cobalt", "Vertex", "Onyx",
  "Cinder", "Zephyr", "Lumen", "Basalt", "Kestrel", "Marrow", "Solstice", "Tundra",
] as const;

/** Name for the nth team, cycling with a suffix once the list runs out. */
export function teamName(index: number): string {
  const base = TEAM_NAMES[index % TEAM_NAMES.length];
  const lap = Math.floor(index / TEAM_NAMES.length);
  return lap === 0 ? base : `${base} ${lap + 1}`;
}

/**
 * What teams are mixed by. `none` is a plain shuffle; anything else is a roster
 * attribute key, so the options are built from the roster rather than fixed.
 */
export const MIX_BY_NONE = "none";
export type MixBy = typeof MIX_BY_NONE | string;

/** Cadence choice, as asked in the roster panel. */
export const CADENCE_OPTIONS: {
  id: TeamCadence;
  label: string;
  body: string;
}[] = [
  {
    id: "semester",
    label: "Same teams all semester",
    body:
      "One set of teams. Every activity uses it unless you override that activity.",
  },
  {
    id: "activity",
    label: "New teams for each activity",
    body:
      "Each activity gets its own set, seeded from the roster. Re-roll one without touching the others.",
  },
];

/**
 * Attribute-value tints for avatars and the mix bar. Values are assigned in
 * first-seen order so any roster column works, not just the designed ones.
 */
export const ATTR_TINTS = [
  "#B9E7F8", "#E8CDFB", "#FFD8E2", "#FFE3BE", "#C7EBD1", "#FBD9C0", "#D5DCF7", "#F6E6B8",
] as const;

/** Roster columns never offered as a mix attribute — they identify, not group. */
export const NON_MIXABLE_ATTRS = new Set(["name", "email", "first", "last", "student", "id"]);
