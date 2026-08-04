// DB row types (mirror supabase/migrations/0001_init.sql).

export interface Course {
  id: string;
  /** The account that owns this session; enforced by RLS. */
  owner_id: string | null;
  name: string;
  code: string | null;
  term: string | null;
  /** The week whose team discussions are running right now, if any. */
  live_week: number | null;
  /** Course-wide, not per person — every TF on the course gets the same. */
  tf_can_grade: boolean;
  tf_can_checkin: boolean;
  created_at: string;
}

/** Account kind. Faculty get the gradebook app; students get the student view. */
export type Role = "faculty" | "student";

export interface Profile {
  id: string;
  role: Role;
  full_name: string | null;
  created_at: string;
}

/**
 * The design keys its layout off SCOPE, not type — type only picks a label and
 * an accent colour. Getting this backwards is the easiest mistake to make here.
 */
export type ActivityType = "challenge" | "combo" | "skills" | "amplify";
export type Scope = "indiv" | "team" | "both";

export const SCOPE_OF: Record<ActivityType, Scope> = {
  challenge: "both",
  combo: "indiv",
  skills: "indiv",
  amplify: "team",
};

export const TYPE_LABEL: Record<ActivityType, string> = {
  challenge: "Challenge",
  combo: "Combo",
  skills: "Skills",
  amplify: "Amplify",
};

export const SCOPE_LABEL: Record<Scope, string> = {
  both: "Individual + team",
  indiv: "Individual",
  team: "Team",
};

export interface Student {
  id: string;
  /** Set when a student account claims this roster row (matched on email). */
  user_id?: string | null;
  course_id: string;
  name: string;
  email: string | null;
  avatar_tint: string | null;
  position: number;
  created_at: string;
}

export interface FileRef {
  name: string;
  size?: string;
  /**
   * Where the bytes are, in the `activity-files` bucket: `<activity_id>/<file>`.
   * Absent on rows written before 0012, which recorded a file NAME and nothing
   * else — those cannot be opened, only listed.
   */
  path?: string;
  /** MIME type as the browser reported it, so a viewer knows what it has. */
  mime?: string;
}

/**
 * What `opens_at` is set to when faculty simply switch an activity off.
 *
 * Visibility is one column and the rule is `opens_at <= now()`, so "not
 * visible, no date in mind" needs an instant that will never arrive rather than
 * a second column that could disagree with the first. Anything at or past this
 * reads as off; the UI never prints it as a date.
 */
export const HIDDEN_INSTANT = "9999-12-31T00:00:00.000Z";

/** Whether this instant is the "switched off" sentinel rather than a schedule. */
export function isHiddenInstant(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const at = Date.parse(iso);
  // A generous threshold rather than string equality: the column round-trips
  // through Postgres, which may hand back a different but equal rendering.
  return !Number.isNaN(at) && at >= Date.parse("9000-01-01T00:00:00.000Z");
}

export interface Activity {
  id: string;
  course_id: string;
  week: number | null;
  topic: string | null;
  title: string;
  dates_label: string | null;
  type: ActivityType;
  /**
   * How the activity is worked and marked. The total is the PRODUCT of these
   * two — there is deliberately no points_total column for it to drift from.
   */
  question_count: number;
  points_per_question: number;
  /** One instant, replacing the older per-scope due columns below. */
  due_at: string | null;
  stage: number; // 0 setup,1 individual,2 discuss,3 resubmit,4 closed
  resubmit_mode: "team" | "individual" | "choice";
  source_text: string | null;
  files: FileRef[];
  opens_at: string | null;
  individual_due_at: string | null;
  team_due_at: string | null;
  posted: boolean;
  position: number;
  created_at: string;
}

export interface TeamSet {
  id: string;
  course_id: string;
  activity_id: string | null;
  name: string | null;
  team_size: number | null;
  locked: boolean;
  created_at: string;
}

export interface Team {
  id: string;
  team_set_id: string;
  name: string;
  position: number;
  created_at: string;
}

/** A team with its resolved member students (composed client-side). */
export interface TeamWithMembers extends Team {
  members: Student[];
}

export type CheckInKind = "individual" | "team";
export type CheckInScale = "points" | "ci";

export interface CheckIn {
  id: string;
  activity_id: string;
  label: string;
  kind: CheckInKind;
  phase: string | null;
  scale: CheckInScale;
  max_points: number | null;
  posted: boolean;
  position: number;
  created_at: string;
}

export type ResultStatus =
  | "none"
  | "draft"
  | "submitted"
  | "needs_review"
  | "scored"
  | "excused"
  | "discussing";

export interface CheckInResult {
  id: string;
  check_in_id: string;
  subject_type: "student" | "team";
  student_id: string | null;
  team_id: string | null;
  status: ResultStatus;
  score: number | null;
  is_ci: boolean;
  text: string | null;
  files: FileRef[];
  transcription: string | null;
  transcription_state: "none" | "auto" | "confirmed";
  flagged: boolean;
  /** When the student handed it in. updated_at is bumped by grading too. */
  submitted_at: string | null;
  /** The instructor's note back. `text` is the student's own work. */
  feedback: string | null;
  updated_at: string;
}

// ---------------------------------------------- the faculty Activities design

export interface CourseWeek {
  id: string;
  course_id: string;
  week: number;
  dates_label: string | null;
  created_at: string;
}

/** One line of an activity's deduction ladder. */
export interface RubricItem {
  id: string;
  activity_id: string;
  row_index: number;
  description: string;
  deduction: number;
  /** Base ladder rows cannot be deleted; faculty-added ones can. */
  is_custom: boolean;
  /**
   * Which question or sub-question this criterion belongs to — "1", "2b".
   * NULL is the shared ladder written before 0012: it applies to every
   * question, and the builder shows it as such rather than hiding it.
   */
  question_label: string | null;
  created_at: string;
}

/**
 * Which ladder ROW was picked for one question of one submission.
 *
 * The row, not its point value: two rows may carry the same deduction, and
 * storing the value would make them indistinguishable and un-selectable.
 */
export interface SubmissionMark {
  id: string;
  result_id: string;
  question_index: number;
  rubric_item_id: string;
  created_at: string;
}

export interface CourseTF {
  id: string;
  course_id: string;
  name: string;
  email: string | null;
  avatar_tint: string | null;
  /** Set once the TF signs up with the address they were added under. */
  user_id: string | null;
  position: number;
  created_at: string;
}

/**
 * Per-type defaults: questions x points-per-question. The total is always the
 * product — never stored beside them, or the two drift.
 */
export const QUESTION_SHAPE: Record<ActivityType, { count: number; per: number }> = {
  challenge: { count: 5, per: 1 },
  combo: { count: 10, per: 5 },
  amplify: { count: 3, per: 1 },
  skills: { count: 5, per: 2 },
};

/** Challenge and Amplify are marked complete/incomplete; the others carry points. */
export const IS_COMPLETION: Record<ActivityType, boolean> = {
  challenge: true,
  combo: false,
  amplify: true,
  skills: false,
};

export const TYPE_ACCENT: Record<ActivityType, string> = {
  challenge: "var(--fv-orange)",
  combo: "var(--fv-navy-700)",
  amplify: "var(--fv-lavender)",
  skills: "var(--fv-sky)",
};
