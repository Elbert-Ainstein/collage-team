"use client";

import { Stub } from "@/routes/Stub";

// Real-layout "coming soon" screens for the ◇ deferred tabs. Kept behind their
// hub's deferred tab (which shows a "soon" marker). Feature-flagged for the pilot.

export function LiveDashboard() {
  return (
    <Stub
      title="Live class"
      subtitle="Real-time team status during the in-class session. Status view ships in M4; controls (Release Q · Pause · Announce) are deferred."
      milestone="M4"
    />
  );
}

export function AIGeneration() {
  return (
    <Stub
      title="AI activity generation"
      subtitle="Generate editable questions, answer keys, completeness rules, and rubric hints from your source materials — nothing auto-publishes."
      milestone="◇ deferred"
    />
  );
}

export function Formation() {
  return (
    <Stub
      title="Team formation"
      subtitle="Criteria-based team formation wizard (skills, schedule, balanced distribution)."
      milestone="◇ deferred"
    />
  );
}

export function Results() {
  return (
    <Stub
      title="Results & analytics"
      subtitle="Submission rates, rubric performance, original→final change, and team convergence."
      milestone="◇ deferred"
    />
  );
}

export function PeerEval() {
  return (
    <Stub
      title="Peer evaluation"
      subtitle="Teammate ratings with forced differentiation and a grade-adjustment factor."
      milestone="◇ deferred"
    />
  );
}

export function Oral() {
  return (
    <Stub
      title="Oral check-in"
      subtitle="Random-selection oral check-in — scored on a separate rubric that never changes the written grade."
      milestone="◇ deferred"
    />
  );
}
