// What a student reads for each dimension: a name and three anchors.
//
// The five dimensions follow the structure of CATME's behaviourally anchored
// scale (Ohland et al., 2012) — the same five areas of team behaviour, rated
// 1–5 with descriptions at 1, 3 and 5. The WORDING here is our own and short
// on purpose. CATME's instrument text is copyrighted; using it verbatim needs
// their permission, and it also runs to a paragraph per anchor, which is the
// opposite of a screen a student can answer in two minutes.

import type { PeerDimension, PeerScore } from "./types";

export interface DimensionText {
  key: PeerDimension;
  /** Shown as the screen's title. */
  label: string;
  /** One line each. Index 0 is a 1, index 1 a 3, index 2 a 5. */
  anchors: readonly [low: string, mid: string, high: string];
}

export const DIMENSIONS: Readonly<Record<PeerDimension, DimensionText>> = {
  contributing: {
    key: "contributing",
    label: "Contributing to the work",
    anchors: [
      "Did little of the work, or late; others covered.",
      "Did a fair share, on time.",
      "Did more than a fair share, and did it well.",
    ],
  },
  interacting: {
    key: "interacting",
    label: "Working with teammates",
    anchors: [
      "Hard to reach; brushed off others' ideas.",
      "Listened, shared ideas, answered messages.",
      "Drew everyone in and built on their ideas.",
    ],
  },
  on_track: {
    key: "on_track",
    label: "Keeping the team on track",
    anchors: [
      "Lost track of what was due.",
      "Noticed when things slipped and said so.",
      "Kept the plan and steered the team back.",
    ],
  },
  quality: {
    key: "quality",
    label: "Expecting quality",
    anchors: [
      "Fine with work that was wrong or unfinished.",
      "Wanted it right and checked it.",
      "Held the team to its best work.",
    ],
  },
  knowledge: {
    key: "knowledge",
    label: "Knowing the material",
    anchors: [
      "Lacked what the task needed; didn't catch up.",
      "Knew enough to do their part.",
      "Knew it well and helped others learn it.",
    ],
  },
};

/** Every dimension, in the order a new evaluation asks them. */
export const DEFAULT_DIMENSIONS: readonly PeerDimension[] = [
  "contributing",
  "interacting",
  "on_track",
  "quality",
  "knowledge",
];

export const SCORES: readonly PeerScore[] = [1, 2, 3, 4, 5];

/** The anchor text a score sits on, or null for the in-between 2 and 4. */
export function anchorFor(dimension: PeerDimension, score: PeerScore): string | null {
  const [low, mid, high] = DIMENSIONS[dimension].anchors;
  if (score === 1) return low;
  if (score === 3) return mid;
  if (score === 5) return high;
  return null;
}

/** Narrows anything read from the database to a dimension this build knows. */
export function isDimension(value: unknown): value is PeerDimension {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(DIMENSIONS, value);
}
