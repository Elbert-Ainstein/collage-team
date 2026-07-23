"use client";

import { TabHub } from "@/shell/TabHub";
import { Dashboard } from "./Dashboard";
import { Library } from "./Library";
import { ActivityBuilder } from "./ActivityBuilder";
import { RubricBuilder } from "./RubricBuilder";
import { RosterImport } from "./RosterImport";
import { TeamManagement } from "./TeamManagement";
import { Grading } from "./Grading";
import { AIGeneration, Formation, LiveDashboard, Oral, PeerEval, Results } from "./stubs";

// Instructor navigation is consolidated into 4 hubs; each hub hosts the existing
// screens under in-page tabs (deep-linkable via ?tab=). Deferred ◇ tabs sit last.

export function OverviewHub() {
  return (
    <TabHub
      tabs={[
        { key: "dashboard", label: "Course dashboard", render: () => <Dashboard /> },
        { key: "live", label: "Live class", render: () => <LiveDashboard /> },
      ]}
    />
  );
}

export function ActivitiesHub() {
  return (
    <TabHub
      tabs={[
        { key: "library", label: "Library", render: () => <Library /> },
        { key: "builder", label: "Builder", render: () => <ActivityBuilder /> },
        { key: "rubric", label: "Rubric", render: () => <RubricBuilder /> },
        { key: "ai", label: "AI generation", deferred: true, render: () => <AIGeneration /> },
      ]}
    />
  );
}

export function RosterTeamsHub() {
  return (
    <TabHub
      tabs={[
        { key: "roster", label: "Roster", render: () => <RosterImport /> },
        { key: "teams", label: "Teams", render: () => <TeamManagement /> },
        { key: "formation", label: "Formation", deferred: true, render: () => <Formation /> },
      ]}
    />
  );
}

export function AssessmentHub() {
  return (
    <TabHub
      tabs={[
        { key: "grading", label: "Grading", render: () => <Grading /> },
        { key: "results", label: "Results", deferred: true, render: () => <Results /> },
        { key: "peer", label: "Peer evaluation", deferred: true, render: () => <PeerEval /> },
        { key: "oral", label: "Oral check-in", deferred: true, render: () => <Oral /> },
      ]}
    />
  );
}
