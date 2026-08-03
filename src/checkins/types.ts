// DB row types (mirror supabase/migrations/0001_init.sql).

export interface Course {
  id: string;
  /** The account that owns this session; enforced by RLS. */
  owner_id: string | null;
  name: string;
  code: string | null;
  term: string | null;
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
}

export interface Activity {
  id: string;
  course_id: string;
  week: number | null;
  topic: string | null;
  title: string;
  dates_label: string | null;
  type: ActivityType;
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
  updated_at: string;
}
