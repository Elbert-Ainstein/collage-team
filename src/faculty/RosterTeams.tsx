"use client";

import { TabHub } from "@/shell/TabHub";
import { RosterImport } from "@/routes/instructor/RosterImport";
import { TeamManagement } from "@/routes/instructor/TeamManagement";
import { Stub } from "@/routes/Stub";

// Roster & teams — reached from the top course bar (Students / Invite), NOT the
// sidebar (per the fixed four-item nav). Hosts the import wizard + team management.
export function RosterTeams() {
  return (
    <>
      <div className="fac-section">
        <div className="fac-section__title">Roster &amp; teams</div>
        <div className="fac-section__sub">
          Import your class roster, organize students into teams, and manage roles — for {`Physical Science 101`}.
        </div>
      </div>
      <TabHub
        tabs={[
          { key: "roster", label: "Roster", render: () => <RosterImport /> },
          { key: "teams", label: "Teams", render: () => <TeamManagement /> },
          { key: "formation", label: "Formation", deferred: true, render: () => (
            <Stub title="Team formation" subtitle="Criteria-based team formation (skills, schedule, balanced distribution)." milestone="◇ deferred" />
          ) },
        ]}
      />
    </>
  );
}
