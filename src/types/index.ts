// Data model — a faithful implementation of frontend_build_spec.md §3.
// This is the "client state / API shape". The services layer (src/services)
// owns all mutations and enforces the §11 hard rules against these types.

export type Role = "instructor" | "student";

export type SubmissionMode = "COLLECTIVE" | "INDIVIDUAL";

export type ActivityStatus =
  | "draft"
  | "scheduled"
  | "prep-open"
  | "team-stage"
  | "grading"
  | "released";

export type QuestionType =
  | "multiple-choice"
  | "short-response"
  | "long-response"
  | "numerical"
  | "handwritten-upload";

export type Confidence = "High" | "Medium";

export type Stage =
  | "prep"
  | "discussion"
  | "collective"
  | "individual-final"
  | "assessment";

export interface Course {
  id: string;
  name: string;
  code: string;
  term: string;
  studentCount: number;
  teamCount: number;
  instructorName: string;
}

export interface AiQuestionMeta {
  objective: string;
  sourceCitation: string;
  suggestedAnswer: string;
  completenessRule: string;
  likelyMisconception: string;
  difficulty: string;
}

export interface Question {
  n: number;
  type: QuestionType;
  prompt: string;
  options?: string[]; // MC only
  unitHint?: string; // numerical only, e.g. "e.g. 1180 kN"
  objectiveTag?: string; // shown on discussion screen
  aiMeta?: AiQuestionMeta; // AI ✦
}

export interface PrepSettings {
  requireAllAttempted: boolean;
  requireWrittenReasoning: boolean;
  requireUploadOnQ: number | null; // question number, or null
  requireOcrConfirmation: boolean;
  aiCompletenessAssessment: boolean; // AI ✦
  hideCorrectnessFeedback: boolean;
  lockOriginalOnSubmit: boolean;
  awardPrepCredit: boolean;
}

export interface TeamSettings {
  requirePrepBeforeAccess: boolean;
  showTeammateNames: boolean;
  showOriginalsOnly: boolean;
  showUploadsAndOcr: boolean;
  releaseOneQuestionAtATime: boolean; // default false
  allowInstructorPause: boolean;
}

export interface CollectiveSettings {
  allMembersEdit: boolean;
  requireParticipationConfirm: boolean;
  sameGradeForAll: boolean;
  showContributionHistory: boolean;
  startBlankWorkspace: boolean;
}

export interface IndividualSettings {
  requireEveryStudentSubmit: boolean;
  keepFinalsPrivate: boolean;
  oneSubmissionLimit: boolean;
  releaseFinalsAfterGrading: boolean; // default false
  aiSuggestedGrading: boolean; // AI ✦
}

export interface RubricCriterion {
  id: string;
  criterion: string;
  points: number;
  description: string;
  aiMayScore: boolean;
}

export interface Activity {
  id: string;
  title: string;
  objective: string;
  description: string;
  learningObjectives: string[];
  estimatedTime: string;
  individualDue: string;
  teamStageWhen: string;
  gradeValue: number; // e.g. 20 pts
  mode: SubmissionMode;
  status: ActivityStatus;
  questions: Question[];
  rubric: RubricCriterion[];
  oralRubric: RubricCriterion[];
  prepSettings: PrepSettings;
  teamSettings: TeamSettings;
  collectiveSettings: CollectiveSettings;
  individualSettings: IndividualSettings;
}

export interface Member {
  id: string;
  name: string;
  initials: string;
  avatarTint: string; // css color
  email?: string;
}

export interface Team {
  id: string;
  number: number;
  name: string;
  memberIds: string[];
  locked: boolean;
  recorderId?: string;
  targetSize: number;
}

export interface Upload {
  filename: string;
  imageUrl: string; // always kept — the original image
  ocrText: string;
  ocrConfirmed: boolean;
  flaggedSymbols: string[];
}

export type ResponseStatus = "complete" | "needs-review";

// Immutable after submit. `locked` is enforced by responseService (409-equivalent).
export interface OriginalResponse {
  memberId: string;
  activityId: string;
  answers: Record<number, string>; // qn -> value
  upload?: Upload;
  status: ResponseStatus;
  submittedAt: string | null; // null while draft
  locked: boolean;
}

export interface CollectiveResponse {
  teamId: string;
  activityId: string;
  text: string;
  attachments: string[];
  editingMemberId?: string;
  lastEditedAt?: string;
  participationConfirmed: Record<string, boolean>; // memberId -> bool
  submittedBy?: string;
  submittedAt?: string | null;
  locked: boolean;
}

// PRIVATE: a student may NEVER fetch a teammate's IndividualFinalResponse.
export interface IndividualFinalResponse {
  memberId: string;
  activityId: string;
  text: string;
  attachments: string[];
  submittedAt?: string | null;
  locked: boolean;
}

export interface AiGradeCriterion {
  score: number;
  max: number;
  evidence: string; // verbatim quote from the submission
  confidence: Confidence;
}

export interface AiGradeSuggestion {
  activityId: string;
  target: string; // teamId (collective) or memberId (individual)
  byCriterion: Record<string, AiGradeCriterion>; // criterionId -> suggestion
  total: number;
}

export interface ApprovedGrade {
  activityId: string;
  target: string; // teamId or memberId
  mode: SubmissionMode;
  scores: Record<string, number>; // criterionId -> score
  feedback: Record<string, string>; // criterionId -> feedback
  total: number;
  releasedAt: string | null;
}

export interface OralRecord {
  teamId: string;
  memberId: string;
  questionN: number;
  scores: Record<number, number>; // criterion idx -> n
  total: number;
  note?: string;
  absent: boolean;
}

export interface OralTeamResult {
  teamId: string;
  records: OralRecord[];
  averageApplied?: number;
}
