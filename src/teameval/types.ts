// Team evaluation (0058): the rows as the app reads them.
//
// One activity of type "teameval" has a settings row, its rating categories
// (each a 1–5 scale with a sentence for every point), and its open-ended
// questions — asked about each teammate ("peer"), of the student about
// themselves ("self"), or left open for a note to the instructor
// ("instructor", 0060: optional, and anonymous). Students write ratings and
// comments only through save_team_eval; staff read every row but a note, a
// student only their own, and a student's results come back from
// team_eval_results as averages. A note loses its writer when they submit:
// it moves to te_notes, which has no author at all.

export type QuestionAudience = "peer" | "self" | "instructor";

/** The longest answer to a question the database keeps (0058). */
export const COMMENT_MAX = 10000;
/** Each category is out of this many points; an evaluation is out of 5 × categories. */
export const POINTS_PER_CATEGORY = 5;

export interface TeamEvalSettings {
  activity_id: string;
  /** Ask the open-ended questions about each teammate. */
  peer_comments: boolean;
  /** Show students what teammates wrote about them, once results are out. */
  release_comments: boolean;
  /** Show those comments without who wrote them. */
  anonymize: boolean;
  /** Points taken off a late student's grade, never below 0 (0061). Only when late_on. */
  late_points: number;
  /** Take late_points off at all. Off, a late evaluation is still marked late — it just loses nothing. */
  late_on: boolean;
  released_at: string | null;
  scored_at: string | null;
  updated_at: string;
}

export interface TeamEvalCategory {
  id: string;
  activity_id: string;
  position: number;
  name: string;
  /** What each point means: levels[0] describes a 1, levels[4] a 5. */
  levels: string[];
  created_at: string;
}

export interface TeamEvalQuestion {
  id: string;
  activity_id: string;
  position: number;
  audience: QuestionAudience;
  prompt: string;
  created_at: string;
}

export interface TeamEvalRating {
  activity_id: string;
  category_id: string;
  rater_id: string;
  ratee_id: string;
  score: number;
  updated_at: string;
}

export interface TeamEvalComment {
  activity_id: string;
  question_id: string;
  author_id: string;
  subject_id: string;
  body: string;
  updated_at: string;
}

export interface TeamEvalSubmission {
  activity_id: string;
  student_id: string;
  submitted_at: string;
  /** Null: the clock decides. True/false: staff said so. */
  late_override: boolean | null;
}

/** A submitted note to the instructor (0060): no author, no time — nothing to trace it back. */
export interface TeamEvalNote {
  id: string;
  activity_id: string;
  question_id: string;
  body: string;
}

/** Everything one evaluation needs on the instructor's screens. */
export interface TeamEvalSnapshot {
  settings: TeamEvalSettings;
  categories: TeamEvalCategory[];
  questions: TeamEvalQuestion[];
  ratings: TeamEvalRating[];
  comments: TeamEvalComment[];
  submissions: TeamEvalSubmission[];
  /** Notes to the instructor, in no order. Empty on a database without 0060. */
  notes: TeamEvalNote[];
}

/** One person on the team a student evaluates (team_eval_team). */
export interface TeamEvalMember {
  student_id: string;
  name: string;
  avatar_tint: string | null;
  is_me: boolean;
}

/** What a student loads to fill in their evaluation. */
export interface StudentTeamEval {
  settings: TeamEvalSettings;
  categories: TeamEvalCategory[];
  questions: TeamEvalQuestion[];
  team: TeamEvalMember[];
  /** Their own rows, draft or submitted. */
  ratings: TeamEvalRating[];
  comments: TeamEvalComment[];
  submission: TeamEvalSubmission | null;
}

/** A student's own results (team_eval_results), once released. */
export interface TeamEvalResults {
  released: boolean;
  anonymous?: boolean;
  comments_shown?: boolean;
  categories?: {
    category_id: string;
    self: number | null;
    /** Teammates who submitted, themselves left out. Null when none did. */
    average: number | null;
    raters: number;
  }[];
  comments?: { question_id: string; author: string | null; body: string }[];
  reflection?: { question_id: string; body: string }[];
}
