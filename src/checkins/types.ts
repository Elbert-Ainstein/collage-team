// DB row types (mirror supabase/migrations/0001_init.sql).

/**
 * How often teams change. Asked once at roster-import time in plain words, so
 * "team set" never has to appear in the UI.
 *   semester — one set of teams; every activity uses it unless it overrides.
 *   activity — each activity gets its own set, seeded from the roster.
 */
export type TeamCadence = "semester" | "activity";

export interface Course {
  id: string;
  name: string;
  code: string | null;
  term: string | null;
  team_cadence: TeamCadence;
  created_at: string;
}

/**
 * Extra roster columns, kept as-is so teams can be mixed by them. Keys are the
 * lower-cased column headers from the imported file ("major", "skill tag", …).
 */
export type StudentAttrs = Record<string, string>;

export interface Student {
  id: string;
  course_id: string;
  name: string;
  email: string | null;
  avatar_tint: string | null;
  attrs: StudentAttrs;
  position: number;
  created_at: string;
}

export interface FileRef {
  name: string;
  size?: string;
}

export interface Activity {
  id: string;
  course_id: string;
  week: number | null;
  topic: string | null;
  title: string;
  dates_label: string | null;
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
  /** A locked team is preserved by "Re-roll unlocked" — members and all. */
  locked: boolean;
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
  updated_at: string;
}
