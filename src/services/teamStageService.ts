// teamStageService — collective workspace, participation confirmation, and the
// private individual-final workspace. Enforces (§11):
//  • Participation: team submit is refused until every member confirms → 409.
//  • Private finals: a student can NEVER fetch a teammate's IndividualFinalResponse
//    (unless releaseFinalsAfterGrading is ON and the grade is released) → 403.
//  • One-submission lock on both collective and individual finals → 409.

import type { CollectiveResponse, IndividualFinalResponse } from "@/types";
import { activityById, teamOfMember, useStore } from "@/store";
import { RuleViolation } from "./errors";
import { getOriginal } from "./responseService";

function now(): string {
  return new Date().toISOString();
}

// ---------- Collective ----------
export function getCollective(teamId: string, activityId: string): CollectiveResponse | undefined {
  return useStore.getState().collectives.find((c) => c.teamId === teamId && c.activityId === activityId);
}

export function ensureCollective(teamId: string, activityId: string): CollectiveResponse {
  const existing = getCollective(teamId, activityId);
  if (existing) return existing;
  const activity = activityById(useStore.getState(), activityId);
  const fresh: CollectiveResponse = {
    teamId,
    activityId,
    // §6.5 startBlankWorkspace: nothing is copied in automatically.
    text: "",
    attachments: [],
    participationConfirmed: {},
    locked: false,
  };
  // (activity is always defined for seed data; guard for safety)
  if (!activity) throw new RuleViolation("NOT_FOUND", "Activity not found.");
  useStore.getState()._upsertCollective(fresh);
  return fresh;
}

function assertUnlockedCollective(c: CollectiveResponse) {
  if (c.locked) throw new RuleViolation("ALREADY_SUBMITTED", "The team response is submitted and locked.");
}

export function editCollectiveText(
  teamId: string,
  activityId: string,
  memberId: string,
  text: string,
): CollectiveResponse {
  const c = ensureCollective(teamId, activityId);
  assertUnlockedCollective(c);
  const next: CollectiveResponse = { ...c, text, editingMemberId: memberId, lastEditedAt: now() };
  useStore.getState()._upsertCollective(next);
  return next;
}

// Explicit "copy selected original in" action (§7.6) — never automatic.
export function copyOriginalIn(
  teamId: string,
  activityId: string,
  memberId: string,
  fromMemberId: string,
  questionN: number,
): CollectiveResponse {
  const c = ensureCollective(teamId, activityId);
  assertUnlockedCollective(c);
  const original = getOriginal(fromMemberId, activityId);
  const member = useStore.getState().members.find((m) => m.id === fromMemberId);
  const snippet = original?.answers[questionN] ?? "— not attempted";
  const block = `${member?.name ?? "Teammate"} (original, Q${questionN}): ${snippet}`;
  const text = c.text ? `${c.text}\n${block}` : block;
  return editCollectiveText(teamId, activityId, memberId, text);
}

export function confirmParticipation(
  teamId: string,
  activityId: string,
  memberId: string,
  value: boolean,
): CollectiveResponse {
  const c = ensureCollective(teamId, activityId);
  assertUnlockedCollective(c);
  const next: CollectiveResponse = {
    ...c,
    participationConfirmed: { ...c.participationConfirmed, [memberId]: value },
  };
  useStore.getState()._upsertCollective(next);
  return next;
}

export function allConfirmed(teamId: string, activityId: string): boolean {
  const state = useStore.getState();
  const team = state.teams.find((t) => t.id === teamId);
  const activity = activityById(state, activityId);
  if (!team || !activity) return false;
  if (!activity.collectiveSettings.requireParticipationConfirm) return true;
  const c = getCollective(teamId, activityId);
  if (!c) return false;
  return team.memberIds.every((id) => c.participationConfirmed[id] === true);
}

// One member submits for the whole team; blocked until all confirm (§7.7).
export function submitCollective(teamId: string, activityId: string, submittedByMemberId: string): CollectiveResponse {
  const c = ensureCollective(teamId, activityId);
  assertUnlockedCollective(c);
  if (!allConfirmed(teamId, activityId)) {
    throw new RuleViolation("PARTICIPATION_INCOMPLETE", "Every member must confirm participation before the team can submit.");
  }
  const next: CollectiveResponse = { ...c, submittedBy: submittedByMemberId, submittedAt: now(), locked: true };
  useStore.getState()._upsertCollective(next);
  return next;
}

// ---------- Individual final (PRIVATE) ----------
export function getOwnFinal(memberId: string, activityId: string): IndividualFinalResponse | undefined {
  return useStore.getState().individualFinals.find((r) => r.memberId === memberId && r.activityId === activityId);
}

export function saveFinalDraft(memberId: string, activityId: string, text: string): IndividualFinalResponse {
  const existing = getOwnFinal(memberId, activityId);
  if (existing?.locked) throw new RuleViolation("ALREADY_SUBMITTED", "Your final response is submitted and locked.");
  const draft: IndividualFinalResponse = {
    memberId,
    activityId,
    text,
    attachments: existing?.attachments ?? [],
    submittedAt: null,
    locked: false,
  };
  useStore.getState()._upsertIndividualFinal(draft);
  return draft;
}

export function submitFinal(memberId: string, activityId: string, text: string): IndividualFinalResponse {
  const existing = getOwnFinal(memberId, activityId);
  const activity = activityById(useStore.getState(), activityId);
  if (existing?.locked && activity?.individualSettings.oneSubmissionLimit) {
    throw new RuleViolation("ALREADY_SUBMITTED", "You may only submit one final response.");
  }
  const submitted: IndividualFinalResponse = {
    memberId,
    activityId,
    text,
    attachments: existing?.attachments ?? [],
    submittedAt: now(),
    locked: true,
  };
  useStore.getState()._upsertIndividualFinal(submitted);
  return submitted;
}

// Privacy gate — the core §11 rule for INDIVIDUAL mode.
// A student may read ONLY their own final, unless the instructor released finals
// after grading AND the target's grade has been released.
export function getFinal(viewerId: string, targetMemberId: string, activityId: string): IndividualFinalResponse {
  const state = useStore.getState();
  if (viewerId === targetMemberId) {
    const own = getOwnFinal(targetMemberId, activityId);
    if (!own) throw new RuleViolation("NOT_FOUND", "No final response yet.");
    return own;
  }
  const activity = activityById(state, activityId);
  const released =
    !!activity?.individualSettings.releaseFinalsAfterGrading &&
    state.approvedGrades.some((g) => g.target === targetMemberId && g.activityId === activityId && g.releasedAt);
  if (!released) {
    throw new RuleViolation("PRIVATE_FINAL", "Teammates' final responses are private.");
  }
  const target = getOwnFinal(targetMemberId, activityId);
  if (!target) throw new RuleViolation("NOT_FOUND", "No final response.");
  return target;
}

// Helper for the discussion screen: which teammates are on my team (with self flag).
export function myTeam(memberId: string) {
  return teamOfMember(useStore.getState(), memberId);
}
