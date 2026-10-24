// Live questions (0047): the rows as the app reads them.
//
// One activity of type "live" has a state row, its questions, and — readable
// only by staff, or by students once the rules in 0047 let them — a key per
// question. Students write their own answers before class; in class their
// votes and their team's tries (0049) go through the RPCs, never straight
// into the tables.

export type LivePhase = "individual" | "team" | "closed";
export type LockRule = "any" | "all";
export type ShowAnswers = "close" | "lock";
export type LiveGrading = "both" | "team";
export type LiveKind = "mc" | "number" | "expression";

export interface LiveState {
  activity_id: string;
  phase: LivePhase;
  lock_rule: LockRule;
  show_answers: ShowAnswers;
  grading: LiveGrading;
  team_started_at: string | null;
  closed_at: string | null;
  scored_at: string | null;
  updated_at: string;
}

export interface LiveQuestion {
  id: string;
  activity_id: string;
  position: number;
  kind: LiveKind;
  stem: string;
  /** Multiple choice: option texts, A first. Empty for the other kinds. */
  options: string[];
  /** Number: the unit shown beside the box. */
  unit: string | null;
  /** An object in activity-files under <activity_id>/. */
  figure_path: string | null;
  created_at: string;
}

export interface LiveKey {
  question_id: string;
  activity_id: string;
  /** Multiple choice: the index of the right option. */
  correct_option: number | null;
  /** Number: the answer and how far off still counts. */
  answer: number | null;
  tolerance: number | null;
  /** Expression: every accepted form. */
  accept: string[];
}

export interface LiveResponse {
  question_id: string;
  activity_id: string;
  student_id: string;
  answer: string;
  /** Set when the session is scored; null before. */
  correct: boolean | null;
  updated_at: string;
}

export interface LiveVote {
  question_id: string;
  activity_id: string;
  team_id: string;
  student_id: string;
  answer: string;
  updated_at: string;
}

/** The team is done with a question (0049): it got it right, or it's out of tries. */
export interface LiveLock {
  question_id: string;
  activity_id: string;
  team_id: string;
  /** The last try's answer. */
  answer: string;
  correct: boolean | null;
  locked_by: string | null;
  locked_at: string;
}

/** One try a team had at a question (0049), told right or wrong as it landed. */
export interface LiveAttempt {
  question_id: string;
  activity_id: string;
  team_id: string;
  /** 1 for the first. */
  attempt: number;
  answer: string;
  /**
   * The verdict the team was given; score_live gives it again with the key as
   * it is by then. Null only on a lock carried over from before 0049 and not
   * yet scored.
   */
  correct: boolean | null;
  locked_by: string | null;
  locked_at: string;
}

/** Everything one live activity needs on screen, for whoever is looking. */
export interface LiveSnapshot {
  state: LiveState;
  questions: LiveQuestion[];
  /** Only the keys the caller may read (0047 decides). */
  keys: LiveKey[];
  responses: LiveResponse[];
  votes: LiveVote[];
  locks: LiveLock[];
  /** Every try, the wrong ones included. Empty on a database without 0049. */
  attempts: LiveAttempt[];
}
