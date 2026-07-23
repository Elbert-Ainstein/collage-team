"use client";

import { activityById, memberById, useStore } from "@/store";
import { Avatar, HBar, Panel, SectionLabel, StatusBadge } from "@/components";
import { gradebookCell } from "@/services/gradingService";
import { hasSubmittedPrep } from "@/services/responseService";
import { Dashboard } from "@/routes/instructor/Dashboard";
import { SEED_TEAM_3 } from "@/seed";

// Analytics hub — course monitoring (the dashboard) + the cross-activity gradebook
// + results, per the integration plan (§2.3). No sidebar item of its own beyond the
// fixed "Analytics" nav.
export function Analytics() {
  const activityId = useStore((s) => s.currentActivityId);
  const activity = useStore((s) => activityById(s, activityId))!;
  useStore((s) => s.approvedGrades);
  useStore((s) => s.originals);
  const shared = activity.mode === "COLLECTIVE";

  const onTime = Math.round(
    (SEED_TEAM_3.memberIds.filter((m) => hasSubmittedPrep(m, activityId)).length / SEED_TEAM_3.memberIds.length) * 100,
  );

  return (
    <>
      <Dashboard />

      <div style={{ marginTop: 36 }}>
        <div className="fac-section__title" style={{ marginBottom: 16 }}>Gradebook</div>
        <Panel>
          <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
            <StatusBadge variant="sky">Individual = completeness of prep</StatusBadge>
            <StatusBadge variant={shared ? "orange" : "navy"}>
              Submission = {shared ? "shared team grade" : "individual final grade"}
            </StatusBadge>
          </div>
          <table className="grid-table">
            <thead>
              <tr>
                <th>Student</th>
                <th>{activity.title}</th>
              </tr>
            </thead>
            <tbody>
              {SEED_TEAM_3.memberIds.map((mid) => {
                const m = memberById(useStore.getState(), mid)!;
                const cell = gradebookCell(activityId, mid);
                return (
                  <tr key={mid}>
                    <td>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                        <Avatar member={m} size={26} /> {m.name}
                      </span>
                    </td>
                    <td>
                      <span style={{ display: "inline-flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                        <StatusBadge variant="sky">
                          Individual {cell.prepEarned}/{cell.prepMax}
                        </StatusBadge>
                        <StatusBadge variant={shared ? "orange" : "navy"}>
                          {shared ? "Team" : "Individual"}{" "}
                          {cell.submissionScore == null ? "—" : `${cell.submissionScore}/${cell.submissionMax}`}
                        </StatusBadge>
                        {cell.flag && <StatusBadge variant="warning">reviewed</StatusBadge>}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>
      </div>

      <div style={{ marginTop: 36 }}>
        <div className="fac-section__title" style={{ marginBottom: 16 }}>Preparation → performance</div>
        <Panel>
          <SectionLabel>How prep relates to the final rubric</SectionLabel>
          <HBar label="Prep complete" value={88} max={100} tint="var(--stage-assessment-fg)" />
          <HBar label="On-time in this team" value={onTime} max={100} tint="var(--stage-prep-fg)" />
          <HBar label="OCR issues" value={8} max={100} tint="var(--warning-fg)" />
          <div style={{ marginTop: 8, fontSize: "var(--text-xs)", color: "var(--muted-fg)" }}>
            Students who completed prep on time averaged ~3.2 points higher on the final rubric.
          </div>
        </Panel>
      </div>
    </>
  );
}
