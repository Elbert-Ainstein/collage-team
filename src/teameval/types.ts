// Team evaluation (0058): the rows as the app reads them.
//
// One activity of type "teameval" has a settings row, its rating categories
// (each a 1–5 scale with a sentence for every point), and its open-ended
// questions — asked about each teammate ("peer") or of the student about
// themselves ("self"). Students write ratings and comments only through
// save_team_eval; staff read every row, a student only their own, and a
// student's results come back from team_eval_results as averages.

export type QuestionAudience = "peer" | "self";

export interface TeamEvalSettings {
  activity_id: string;
  /** Ask the open-ended questions about each teammate. */
  peer_comments: boolean;
  /** Show students what teammates wrote about them, once results are out. */
  release_comments: boolean;
  /** Show those comments without who wrote them. */
  anonymize: boolean;
  /** Every rating comes with a sentence saying why. */
  explain_ratings: boolean;
  /** Percent of the points taken off a late submission. */
  late_penalty: number;
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
  reason: string | null;
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

/** Everything one evaluation needs on the instructor's screens. */
export interface TeamEvalSnapshot {
  settings: TeamEvalSettings;
  categories: TeamEvalCategory[];
  questions: TeamEvalQuestion[];
  ratings: TeamEvalRating[];
  comments: TeamEvalComment[];
  submissions: TeamEvalSubmission[];
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
    self_reason: string | null;
    /** Teammates who submitted, themselves left out. Null when none did. */
    average: number | null;
    raters: number;
    reasons: { author: string | null; score: number; text: string }[];
  }[];
  comments?: { question_id: string; author: string | null; body: string }[];
  reflection?: { question_id: string; body: string }[];
}
