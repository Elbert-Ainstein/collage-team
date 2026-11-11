// Peer evaluation: the rows as the app reads them.
//
// SCAFFOLD. Mirrors the draft schema in docs/team-module/peer-eval/ — nothing
// here is in the database yet. One activity of type "peer" has one settings
// row; each student writes a score per teammate per dimension, and a comment
// per teammate when the activity asks for them. Who counts as a teammate is
// the activity's frozen roster (activity_rosters, 0045), never today's teams.

/**
 * The five behaviours a student is rated on. Keys, not labels: the wording a
 * student reads lives in dimensions.ts, so it can change without a migration.
 */
export type PeerDimension = "contributing" | "interacting" | "on_track" | "quality" | "knowledge";

/** 1 is the low anchor, 3 the middle, 5 the high; 2 and 4 sit between. */
export type PeerScore = 1 | 2 | 3 | 4 | 5;

/**
 * Where a student's written comments go. "private": the instructor only.
 * "shared": also to the student they are about, without the writer's name,
 * once the instructor releases feedback.
 */
export type PeerCommentMode = "off" | "private" | "shared";

export interface PeerSettings {
  activity_id: string;
  /** Which dimensions this evaluation asks about, in the order asked. */
  dimensions: PeerDimension[];
  /** Students rate themselves too. Needed for the over/underconfident flags. */
  include_self: boolean;
  comments: PeerCommentMode;
  /**
   * Which team set this evaluation is about. Null: the course's current set
   * when the first rating is saved, which is when the teams freeze.
   */
  team_set_id: string | null;
  /** Fewest submitted raters, on every dimension, before a student sees a summary. */
  min_raters: number;
  /** No more ratings. Set by close_peer, which also writes completion marks. */
  closed_at: string | null;
  /**
   * When students were shown their own summary. Null until the instructor
   * releases it; nothing about who rated whom is ever shown.
   */
  released_at: string | null;
  updated_at: string;
}

/** One score, from one student, about one teammate (or themselves), on one dimension. */
export interface PeerRating {
  activity_id: string;
  rater_id: string;
  ratee_id: string;
  dimension: PeerDimension;
  score: PeerScore;
  updated_at: string;
}

export interface PeerComment {
  activity_id: string;
  rater_id: string;
  ratee_id: string;
  body: string;
  /** Staff kept a shared comment from reaching the student. */
  withheld: boolean;
  updated_at: string;
}
