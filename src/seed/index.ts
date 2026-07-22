// Seed data — frontend_build_spec.md §9. Boots the app into a fully populated
// demo (both roles, both modes). "Bridge Design Decision" is COLLECTIVE; the
// INDIVIDUAL variant is demoable via the mode toggle on the activity.

import type {
  Activity,
  Course,
  Member,
  OriginalResponse,
  RubricCriterion,
  Team,
} from "@/types";

export const SEED_COURSE: Course = {
  id: "course-engr101",
  name: "Introduction to Engineering",
  code: "ENGR 101",
  term: "Fall 2026",
  studentCount: 24,
  teamCount: 6,
  instructorName: "Dr. Elena Alvarez",
};

// ---- Team 3 (the demo team; Maya = "you") ----
export const MAYA: Member = { id: "m-maya", name: "Maya Chen", initials: "MC", avatarTint: "#0382ed", email: "maya.chen@harvard.edu" };
export const LIAM: Member = { id: "m-liam", name: "Liam Ortiz", initials: "LO", avatarTint: "#8a3ffc", email: "liam.ortiz@harvard.edu" };
export const PRIYA: Member = { id: "m-priya", name: "Priya Nair", initials: "PN", avatarTint: "#0e7c57", email: "priya.nair@harvard.edu" };
export const SAM: Member = { id: "m-sam", name: "Sam Whitfield", initials: "SW", avatarTint: "#ff6713", email: "sam.whitfield@harvard.edu" };

export const SEED_MEMBERS: Member[] = [MAYA, LIAM, PRIYA, SAM];

export const CURRENT_STUDENT_ID = MAYA.id;

export const SEED_TEAM_3: Team = {
  id: "team-3",
  number: 3,
  name: "Team 3",
  memberIds: [MAYA.id, LIAM.id, PRIYA.id, SAM.id],
  locked: false,
  recorderId: MAYA.id,
  targetSize: 4,
};

// A few extra teams so team management / dashboard have realistic content.
export const SEED_TEAMS: Team[] = [
  SEED_TEAM_3,
  { id: "team-4", number: 4, name: "Team 4", memberIds: ["x1", "x2", "x3"], locked: false, targetSize: 4 },
];

const RUBRIC: RubricCriterion[] = [
  { id: "r-choice", criterion: "Correct structure choice", points: 4, description: "Selects a structurally appropriate option for the span and site.", aiMayScore: true },
  { id: "r-reasoning", criterion: "Quality of reasoning", points: 6, description: "Justifies the choice against site constraints and load path.", aiMayScore: true },
  { id: "r-calc", criterion: "Load calculation accuracy", points: 6, description: "Correctly computes the axial cable load with sound method.", aiMayScore: true },
  { id: "r-units", criterion: "Units & assumptions", points: 2, description: "States assumptions and carries units correctly.", aiMayScore: true },
  { id: "r-tradeoff", criterion: "Tradeoff analysis", points: 2, description: "Identifies a meaningful design tradeoff.", aiMayScore: false },
];

const ORAL_RUBRIC: RubricCriterion[] = [
  { id: "o-clarity", criterion: "Clarity of explanation", points: 3, description: "Explains the reasoning clearly and concisely.", aiMayScore: false },
  { id: "o-depth", criterion: "Depth of understanding", points: 4, description: "Demonstrates deep grasp of the underlying concept.", aiMayScore: false },
  { id: "o-followup", criterion: "Responds to follow-up", points: 3, description: "Handles follow-up questions convincingly.", aiMayScore: false },
];

export const BRIDGE_ACTIVITY: Activity = {
  id: "act-bridge",
  title: "Bridge Design Decision",
  objective: "Evaluate structural options against site constraints and justify a load-bearing decision.",
  description: "Given a 90 m span over a deep gorge, choose a structure, defend it, and back it with a load calculation.",
  learningObjectives: [
    "Compare bridge structural systems against span and site constraints",
    "Justify a load-bearing decision with quantitative support",
    "Communicate assumptions and tradeoffs clearly",
  ],
  estimatedTime: "45 min",
  individualDue: "Wed 11:59pm",
  teamStageWhen: "Thu in class",
  gradeValue: 20,
  mode: "COLLECTIVE",
  status: "team-stage",
  questions: [
    {
      n: 1,
      type: "multiple-choice",
      prompt: "Which bridge structure is most appropriate for the proposed 90 m span over a deep gorge?",
      options: ["Beam", "Arch", "Suspension", "Cable-stayed"],
      objectiveTag: "Objective: justify a load-bearing decision",
    },
    {
      n: 2,
      type: "long-response",
      prompt: "Explain the reasoning behind your structural choice, referencing the site constraints.",
      objectiveTag: "Objective: defend a structural choice",
    },
    {
      n: 3,
      type: "numerical",
      prompt: "Calculate the expected axial load (kN) on one main cable at midspan.",
      unitHint: "e.g. 1180 kN",
      objectiveTag: "Objective: quantify the load path",
    },
    {
      n: 4,
      type: "handwritten-upload",
      prompt: "Upload your written calculations supporting Q3.",
      objectiveTag: "Objective: show your work",
    },
    {
      n: 5,
      type: "short-response",
      prompt: "Identify one important design tradeoff.",
      objectiveTag: "Objective: weigh tradeoffs",
    },
  ],
  rubric: RUBRIC,
  oralRubric: ORAL_RUBRIC,
  prepSettings: {
    requireAllAttempted: true,
    requireWrittenReasoning: true,
    requireUploadOnQ: 4,
    requireOcrConfirmation: true,
    aiCompletenessAssessment: true,
    hideCorrectnessFeedback: true,
    lockOriginalOnSubmit: true,
    awardPrepCredit: true,
  },
  teamSettings: {
    requirePrepBeforeAccess: true,
    showTeammateNames: true,
    showOriginalsOnly: true,
    showUploadsAndOcr: true,
    releaseOneQuestionAtATime: false,
    allowInstructorPause: true,
  },
  collectiveSettings: {
    allMembersEdit: true,
    requireParticipationConfirm: true,
    sameGradeForAll: true,
    showContributionHistory: true,
    startBlankWorkspace: true,
  },
  individualSettings: {
    requireEveryStudentSubmit: true,
    keepFinalsPrivate: true,
    oneSubmissionLimit: true,
    releaseFinalsAfterGrading: false,
    aiSuggestedGrading: true,
  },
};

// Other library activities (§9) — status variety for library/gradebook.
export const OTHER_ACTIVITIES: Activity[] = [
  makeStub("act-statics", "Statics Warm-up: Free-body Diagrams", "INDIVIDUAL", "grading", 15),
  makeStub("act-materials", "Materials Selection Case", "INDIVIDUAL", "draft", 20),
  makeStub("act-truss", "Truss Analysis Project Milestone", "COLLECTIVE", "scheduled", 25),
];

function makeStub(
  id: string,
  title: string,
  mode: Activity["mode"],
  status: Activity["status"],
  gradeValue: number,
): Activity {
  return {
    ...BRIDGE_ACTIVITY,
    id,
    title,
    mode,
    status,
    gradeValue,
    objective: title,
    description: title,
  };
}

// Teammates' ORIGINAL prep responses (locked, pre-class). Maya's own original
// is created live when the demo student submits prep.
const OCR_SAMPLE = "Span L = 90 m, w = 32 kN/m -> W = 2880 kN -> H = 3600 kN -> T_max ~ 1180 kN per cable.";

export function seedTeammateOriginals(): OriginalResponse[] {
  const base = (memberId: string, choice: string, load: string): OriginalResponse => ({
    memberId,
    activityId: BRIDGE_ACTIVITY.id,
    answers: {
      1: choice,
      2: `I chose ${choice.toLowerCase()} because it best carries the load across a 90 m gorge span.`,
      3: load,
      5: "Cost vs. constructability over a deep gorge.",
    },
    status: "complete",
    submittedAt: "2026-09-09T21:42:00",
    locked: true,
  });

  const liam = base(LIAM.id, "Cable-stayed", "1050");
  const priya = base(PRIYA.id, "Suspension", "1210");
  const sam = base(SAM.id, "Arch", "1400");
  sam.status = "needs-review";
  // Sam uploaded handwritten work that OCR flagged.
  sam.upload = {
    filename: "calc_bridge_load.jpg",
    imageUrl: "",
    ocrText: OCR_SAMPLE,
    ocrConfirmed: false,
    flaggedSymbols: ["T_max", "H"],
  };
  return [liam, priya, sam];
}

export const OCR_TRANSCRIPTION_SAMPLE = OCR_SAMPLE;
