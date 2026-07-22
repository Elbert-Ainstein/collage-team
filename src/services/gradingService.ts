// gradingService — AI-suggested rubric grading + instructor approve/release,
// and gradebook derivation. Enforces (§11):
//  • Nothing AI-generated reaches students without an instructor action: the AI
//    suggestion is stored separately and never shown to students; only a RELEASED
//    ApprovedGrade appears in the student grade view.
//  • Completeness credit (prep) and correctness (rubric) stay two separate values.
//  • BOTH the AI suggestion and the approved grade persist.

import type { AiGradeSuggestion, ApprovedGrade, SubmissionMode } from "@/types";
import { activityById, teamOfMember, useStore } from "@/store";
import { aiGradingAdapter } from "./adapters/aiGradingAdapter";
import { hasSubmittedPrep } from "./responseService";
import { RuleViolation } from "./errors";

function now() {
  return new Date().toISOString();
}

export const PREP_CREDIT_MAX = 5;

// The submission text under grading. COLLECTIVE → team's shared text; INDIVIDUAL
// → the student's private final text.
export function getSubmissionText(activityId: string, target: string, mode: SubmissionMode): string | null {
  const s = useStore.getState();
  if (mode === "COLLECTIVE") {
    const c = s.collectives.find((x) => x.teamId === target && x.activityId === activityId);
    return c?.locked ? c.text : null;
  }
  const f = s.individualFinals.find((x) => x.memberId === target && x.activityId === activityId);
  return f?.locked ? f.text : null;
}

export function getSuggestion(activityId: string, target: string): AiGradeSuggestion | undefined {
  return useStore.getState().aiSuggestions.find((x) => x.activityId === activityId && x.target === target);
}

export function getGrade(activityId: string, target: string): ApprovedGrade | undefined {
  return useStore.getState().approvedGrades.find((x) => x.activityId === activityId && x.target === target);
}

// Generate (and persist) the AI rubric suggestion. Marked AI (✦) in the UI; never
// auto-released.
export async function suggestGrade(activityId: string, target: string, mode: SubmissionMode): Promise<AiGradeSuggestion> {
  const activity = activityById(useStore.getState(), activityId);
  if (!activity) throw new RuleViolation("NOT_FOUND", "Activity not found.");
  const text = getSubmissionText(activityId, target, mode);
  if (text == null) throw new RuleViolation("NOT_FOUND", "No submitted response to grade.");
  const suggestion = await aiGradingAdapter.suggest({ activityId, target, text }, activity.rubric);
  useStore.getState()._upsertAiSuggestion(suggestion);
  return suggestion;
}

// Instructor edits → save a draft grade (not released). Both AI + instructor
// grades persist; the instructor's scores can override any criterion.
export function saveGradeDraft(
  activityId: string,
  target: string,
  mode: SubmissionMode,
  scores: Record<string, number>,
  feedback: Record<string, string>,
): ApprovedGrade {
  const total = Object.values(scores).reduce((a, b) => a + b, 0);
  const existing = getGrade(activityId, target);
  const grade: ApprovedGrade = {
    activityId,
    target,
    mode,
    scores,
    feedback,
    total,
    releasedAt: existing?.releasedAt ?? null,
  };
  useStore.getState()._upsertApprovedGrade(grade);
  return grade;
}

// Approve & release — the explicit instructor action that makes the grade visible
// to students. For COLLECTIVE, the same released grade applies to every member.
export function approveAndRelease(
  activityId: string,
  target: string,
  mode: SubmissionMode,
  scores: Record<string, number>,
  feedback: Record<string, string>,
): ApprovedGrade {
  const total = Object.values(scores).reduce((a, b) => a + b, 0);
  const grade: ApprovedGrade = { activityId, target, mode, scores, feedback, total, releasedAt: now() };
  useStore.getState()._upsertApprovedGrade(grade);
  const activity = activityById(useStore.getState(), activityId);
  if (activity) useStore.getState()._updateActivity(activityId, { status: "released" });
  return grade;
}

// ---- Student-facing: only a RELEASED grade is visible ----
export function getReleasedGradeForStudent(activityId: string, studentId: string): ApprovedGrade | undefined {
  const s = useStore.getState();
  const activity = activityById(s, activityId);
  if (!activity) return undefined;
  const target = activity.mode === "COLLECTIVE" ? teamOfMember(s, studentId)?.id : studentId;
  if (!target) return undefined;
  const grade = getGrade(activityId, target);
  return grade?.releasedAt ? grade : undefined;
}

// ---- Gradebook (§6.10): completeness (prep) and submission kept separate ----
export interface GradebookCell {
  prepEarned: number;
  prepMax: number;
  submissionScore: number | null;
  submissionMax: number;
  shared: boolean; // team grade vs individual
  flag?: "reviewed";
}

export function gradebookCell(activityId: string, studentId: string): GradebookCell {
  const s = useStore.getState();
  const activity = activityById(s, activityId)!;
  const prepped = hasSubmittedPrep(studentId, activityId);
  const prepEarned = activity.prepSettings.awardPrepCredit && prepped ? PREP_CREDIT_MAX : 0;

  const shared = activity.mode === "COLLECTIVE";
  const target = shared ? teamOfMember(s, studentId)?.id : studentId;
  const grade = target ? getGrade(activityId, target) : undefined;

  // Completeness credit is NEVER affected by the correctness of the final work.
  const original = s.originals.find((o) => o.memberId === studentId && o.activityId === activityId);
  const flag = original?.status === "needs-review" ? "reviewed" : undefined;

  return {
    prepEarned,
    prepMax: PREP_CREDIT_MAX,
    submissionScore: grade ? grade.total : null,
    submissionMax: activity.gradeValue,
    shared,
    flag,
  };
}
