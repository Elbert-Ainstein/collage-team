// Live questions (0047): the rows as the app reads them.
//
// One activity of type "live" has a state row, its questions, and — readable
// only by staff, or by students once the rules in 0047 let them — a key per
// question. Students write their own answers before class; in class their
// votes and their team's tries (0049) go through the RPCs, never straight
// into the tables — and so do a team's pick of leader and its roll (0051).

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
  /**
   * Closed without its team half: the answers were released straight from
   * before class or a broken team mode (0053). Absent on a database without it.
   */
  team_skipped?: boolean;
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

/** The team is done with a question (0049): it got it right, ran out of tries, or moved on (0050). */
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

/** One member's current pick for their team's leader (0051). */
export interface LiveLeaderVote {
  activity_id: string;
  team_id: string;
  student_id: string;
  candidate_id: string;
  updated_at: string;
}

/** Where a team is in getting started (0051). No row until its first vote. */
export interface LiveTeamSetup {
  activity_id: string;
  team_id: string;
  /** Submits for the team. Not the leader any more if since marked absent. */
  leader_id: string | null;
  leader_at: string | null;
  /** When the leader last took the roll; null until they have. */
  roll_at: string | null;
}

/** Who wrote an absence: staff on the sheet, or a team leader's roll (0051). */
export type AbsenceSource = "sheet" | "roll";

/** Someone marked absent for this activity: the sheet's tutorial_absences (0016). */
export interface LiveAbsence {
  activity_id: string;
  team_id: string;
  student_id: string;
  /** The roll takes back only its own; "sheet" on a database without 0051. */
  source: AbsenceSource;
}

/** One person on a team's frozen roster for this activity (0045), as 0051 lets a team read it. */
export interface LiveRosterMember {
  team_id: string;
  student_id: string;
  /** Null when the caller may not read their name. */
  name: string | null;
  avatar_tint: string | null;
}

/** Why the answer is the answer (0051). Readable by a student only once their team is done with it. */
export interface LiveExplanation {
  question_id: string;
  activity_id: string;
  body: string;
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
  /**
   * The database has 0051: teams pick a leader and take the roll before they
   * play. False without it, and team play goes on as before.
   */
  teamSetup: boolean;
  /** The caller's team's votes for leader (every team's, for staff). Empty without 0051. */
  leaderVotes: LiveLeaderVote[];
  /** The caller's team's setup row (every team's, for staff). Empty without 0051. */
  setups: LiveTeamSetup[];
  /**
   * Who is marked absent: every team's, for staff; a student's own team once
   * team mode has started (0051), or only their own row without it (0031).
   */
  absences: LiveAbsence[];
  /**
   * The frozen roster the leader RPCs count: every team's, for staff; a
   * student's own team once team mode has started. Empty without 0051.
   */
  roster: LiveRosterMember[];
  /** Only the explanations the caller may read (0051 decides). Empty without it. */
  explanations: LiveExplanation[];
}
