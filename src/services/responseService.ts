// responseService — owns the individual-prep lifecycle and enforces the
// immutable-originals rule (§2, §11) and the prep gate (§4, §11).
//
// Hard rules enforced here:
//  • An OriginalResponse becomes read-only at submit; any later edit → 409.
//  • Teammates see ONLY submitted originals — never drafts.
//  • Team-stage reads are refused before prep is submitted (when the activity
//    requires it) → 403.

import type { OriginalResponse, Upload } from "@/types";
import { activityById, teamOfMember, useStore } from "@/store";
import { RuleViolation } from "./errors";

function now(): string {
  return new Date().toISOString();
}

export function getOriginal(memberId: string, activityId: string): OriginalResponse | undefined {
  return useStore.getState().originals.find((r) => r.memberId === memberId && r.activityId === activityId);
}

export function hasSubmittedPrep(memberId: string, activityId: string): boolean {
  const r = getOriginal(memberId, activityId);
  return !!r && r.locked && !!r.submittedAt;
}

// ---- Draft (pre-submit) ----
export function saveDraftPrep(
  memberId: string,
  activityId: string,
  answers: Record<number, string>,
  upload?: Upload,
): OriginalResponse {
  const existing = getOriginal(memberId, activityId);
  if (existing?.locked) {
    throw new RuleViolation("IMMUTABLE_ORIGINAL", "This original response is locked and cannot be edited.");
  }
  const draft: OriginalResponse = {
    memberId,
    activityId,
    answers,
    upload: upload ?? existing?.upload,
    status: "complete",
    submittedAt: null,
    locked: false,
  };
  useStore.getState()._upsertOriginal(draft);
  return draft;
}

// Student confirms/corrects the OCR transcription (§7.3). Only valid on a draft;
// the original image is always kept — this only updates the interpreted text.
export function confirmOcr(memberId: string, activityId: string, correctedText: string): OriginalResponse {
  const existing = getOriginal(memberId, activityId);
  if (!existing) throw new RuleViolation("NOT_FOUND", "No draft found.");
  if (existing.locked) throw new RuleViolation("IMMUTABLE_ORIGINAL", "This response is locked.");
  if (!existing.upload) throw new RuleViolation("NOT_FOUND", "No upload to transcribe.");
  const upload: Upload = { ...existing.upload, ocrText: correctedText, ocrConfirmed: true };
  return saveDraftPrep(memberId, activityId, existing.answers, upload);
}

export interface PrepValidation {
  ok: boolean;
  missing: string[];
}

// Validates against the activity's prepSettings (§6.5). Completeness only —
// never correctness.
export function validatePrep(
  activityId: string,
  answers: Record<number, string>,
  upload?: Upload,
): PrepValidation {
  const activity = activityById(useStore.getState(), activityId);
  if (!activity) return { ok: false, missing: ["Activity not found"] };
  const ps = activity.prepSettings;
  const missing: string[] = [];

  for (const q of activity.questions) {
    if (q.type === "handwritten-upload") continue; // handled by requireUploadOnQ
    const val = (answers[q.n] ?? "").toString().trim();
    if (ps.requireAllAttempted && val === "") {
      missing.push(`Q${q.n} not attempted`);
      continue;
    }
    if (ps.requireWrittenReasoning && (q.type === "long-response" || q.type === "short-response") && val === "") {
      missing.push(`Q${q.n} needs written reasoning`);
    }
  }

  if (ps.requireUploadOnQ != null) {
    if (!upload) {
      missing.push(`Q${ps.requireUploadOnQ} requires uploaded work`);
    } else if (ps.requireOcrConfirmation && !upload.ocrConfirmed) {
      missing.push(`OCR transcription must be confirmed`);
    }
  }

  return { ok: missing.length === 0, missing };
}

// ---- Submit (locks the original permanently) ----
export function submitPrep(
  memberId: string,
  activityId: string,
  answers: Record<number, string>,
  upload?: Upload,
): OriginalResponse {
  const existing = getOriginal(memberId, activityId);
  if (existing?.locked) {
    throw new RuleViolation("ALREADY_SUBMITTED", "Preparation has already been submitted and is locked.");
  }
  const check = validatePrep(activityId, answers, upload);
  if (!check.ok) {
    throw new RuleViolation("PREP_VALIDATION", `Preparation incomplete: ${check.missing.join(", ")}`);
  }
  const activity = activityById(useStore.getState(), activityId)!;
  const needsReview = activity.prepSettings.aiCompletenessAssessment && !!upload && !upload.ocrConfirmed;
  const submitted: OriginalResponse = {
    memberId,
    activityId,
    answers,
    upload,
    status: needsReview ? "needs-review" : "complete",
    submittedAt: now(),
    locked: activity.prepSettings.lockOriginalOnSubmit ? true : false,
  };
  useStore.getState()._upsertOriginal(submitted);
  return submitted;
}

// Explicit immutability guard — any attempt to change a locked original is a 409.
// Used by both UI guards and the rule-enforcement test suite.
export function editOriginal(
  memberId: string,
  activityId: string,
  answers: Record<number, string>,
): OriginalResponse {
  const existing = getOriginal(memberId, activityId);
  if (!existing) throw new RuleViolation("NOT_FOUND", "No original response found.");
  if (existing.locked) {
    throw new RuleViolation("IMMUTABLE_ORIGINAL", "Original responses are immutable after submission.");
  }
  return saveDraftPrep(memberId, activityId, answers, existing.upload);
}

// ---- Prep gate (§4) ----
export function canAccessTeamStage(memberId: string, activityId: string): boolean {
  const activity = activityById(useStore.getState(), activityId);
  if (!activity) return false;
  if (!activity.teamSettings.requirePrepBeforeAccess) return true;
  return hasSubmittedPrep(memberId, activityId);
}

// Teammates' ORIGINAL responses — read-only, submitted-only, prep-gated.
export function getTeammateOriginals(viewerId: string, activityId: string): OriginalResponse[] {
  if (!canAccessTeamStage(viewerId, activityId)) {
    throw new RuleViolation("PREP_GATE", "Submit your individual preparation before entering the team stage.");
  }
  const state = useStore.getState();
  const team = teamOfMember(state, viewerId);
  if (!team) return [];
  return state.originals.filter(
    (r) => r.activityId === activityId && team.memberIds.includes(r.memberId) && r.locked && !!r.submittedAt,
  );
}
