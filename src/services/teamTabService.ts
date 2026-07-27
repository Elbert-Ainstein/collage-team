// teamTabService — the "Team" pillar of an activity. An uploaded activity is just
// a PDF; this owns the team's collaborative workspace around it: resources, audio
// discussions, and the AI-generated Project Progress Report.
//
// Access model (from the whiteboard — F = faculty, S = student):
//   View Team            F · S
//   Team Resources       S writes (own team), F reads
//   Audio Discussion     S records, F plays back
//   Progress Report      AI-drafted, F · S read (faculty-reviewable)

import type { AudioDiscussion, ProgressReport, ResourceKind, TeamResource } from "@/types";
import { activityById, useStore } from "@/store";

function now() {
  return new Date().toISOString();
}
// Defensive reads: a browser with localStorage persisted before these slices
// existed rehydrates without them, so default to [] to survive schema drift.
function allResources(): TeamResource[] {
  return useStore.getState().teamResources ?? [];
}
function allDiscussions(): AudioDiscussion[] {
  return useStore.getState().audioDiscussions ?? [];
}
function allReports(): ProgressReport[] {
  return useStore.getState().progressReports ?? [];
}
function rid(prefix: string) {
  return `${prefix}-${allResources().length + allDiscussions().length + 1}-${Date.now().toString(36)}`;
}

export function getSource(activityId: string) {
  return activityById(useStore.getState(), activityId)?.source;
}

// ---- Team resources ----
export function getResources(teamId: string, activityId: string): TeamResource[] {
  return allResources().filter((r) => r.teamId === teamId && r.activityId === activityId);
}

export function addResource(
  teamId: string,
  activityId: string,
  kind: ResourceKind,
  name: string,
  addedBy: string,
): TeamResource {
  const r: TeamResource = { id: rid("res"), teamId, activityId, kind, name, addedBy, addedAt: now() };
  useStore.getState()._addTeamResource(r);
  // New progress feeds the report (whiteboard: "progress is added" → report).
  regenerateProgressReport(teamId, activityId);
  return r;
}

// ---- Audio discussions ----
export function getDiscussions(teamId: string, activityId: string): AudioDiscussion[] {
  return allDiscussions().filter((d) => d.teamId === teamId && d.activityId === activityId);
}

export function addDiscussion(
  teamId: string,
  activityId: string,
  title: string,
  durationSec: number,
  recordedBy: string,
): AudioDiscussion {
  const d: AudioDiscussion = { id: rid("aud"), teamId, activityId, title, durationSec, recordedBy, at: now() };
  useStore.getState()._addAudioDiscussion(d);
  regenerateProgressReport(teamId, activityId);
  return d;
}

// ---- AI Project Progress Report (✦) ----
export function getProgressReport(teamId: string, activityId: string): ProgressReport | undefined {
  return allReports().find((p) => p.teamId === teamId && p.activityId === activityId);
}

// Deterministic mock "AI" — derives a summary + completeness from the team's
// resources and discussions. A real Anthropic call slots in behind this signature.
export function regenerateProgressReport(teamId: string, activityId: string): ProgressReport {
  const resources = getResources(teamId, activityId);
  const discussions = getDiscussions(teamId, activityId);
  const kinds = new Set(resources.map((r) => r.kind));
  const highlights: string[] = [];
  if (kinds.has("proposal")) highlights.push("Proposal uploaded");
  if (kinds.has("contract")) highlights.push("Team agreement in place — roles clear");
  if (kinds.has("whiteboard")) highlights.push("Whiteboard/working sketch captured");
  if (discussions.length) highlights.push(`${discussions.length} discussion${discussions.length > 1 ? "s" : ""} recorded`);
  if (!kinds.has("report")) highlights.push("Open: final report not yet added");

  // Simple completeness heuristic across the expected artifacts + discussion.
  const signals = [kinds.has("proposal"), kinds.has("contract"), kinds.has("whiteboard"), kinds.has("report"), discussions.length > 0];
  const percentComplete = Math.round((signals.filter(Boolean).length / signals.length) * 100);

  const report: ProgressReport = {
    teamId,
    activityId,
    generatedAt: now(),
    percentComplete,
    summary: `Team has ${resources.length} resource${resources.length === 1 ? "" : "s"} and ${discussions.length} recorded discussion${discussions.length === 1 ? "" : "s"}. ${
      percentComplete >= 80 ? "On track to wrap up." : percentComplete >= 50 ? "Making solid progress." : "Early stage — keep adding work."
    }`,
    highlights,
  };
  useStore.getState()._upsertProgressReport(report);
  return report;
}
