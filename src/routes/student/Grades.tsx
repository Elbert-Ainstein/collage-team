"use client";

import { activityById, teamOfMember, useStore } from "@/store";
import { AiBadge, Alert, Icon, PageHeader, Panel, SectionLabel, StatusBadge } from "@/components";
import { getReleasedGradeForStudent } from "@/services/gradingService";
import { MAYA } from "@/seed";

export function Grades() {
  const activityId = useStore((s) => s.currentActivityId);
  const activity = useStore((s) => activityById(s, activityId))!;
  const course = useStore((s) => s.course);
  useStore((s) => s.approvedGrades);
  const team = useStore((s) => teamOfMember(s, MAYA.id));
  const grade = getReleasedGradeForStudent(activityId, MAYA.id);
  const shared = activity.mode === "COLLECTIVE";

  if (!grade) {
    return (
      <>
        <PageHeader title="Grades & feedback" subtitle={activity.title} />
        <Alert variant="info" icon="hourglass_empty">
          Your submission is in — <strong>awaiting your instructor's rubric grade</strong>. You'll see the breakdown here
          once it's released.
        </Alert>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Grades & feedback" subtitle={activity.title} />

      <div
        className="stage-banner"
        style={{ background: "var(--stage-assessment-bg)", borderColor: "var(--stage-assessment-fg)", marginBottom: 20 }}
      >
        <Icon name="verified" style={{ color: "var(--stage-assessment-fg)" }} />
        <span style={{ color: "var(--stage-assessment-fg)", fontWeight: 500 }}>
          {shared ? `${team?.name} rubric result` : "Your rubric result"} · released by {course.instructorName}
        </span>
      </div>

      <div className="two-col">
        <Panel>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
            <SectionLabel>Rubric breakdown</SectionLabel>
            <StatusBadge variant="success" icon="verified">Instructor-approved</StatusBadge>
          </div>
          {activity.rubric.map((c) => {
            const score = grade.scores[c.id] ?? 0;
            const full = score === c.points;
            return (
              <div className="criterion-row" key={c.id} style={{ gridTemplateColumns: "1fr auto" }}>
                <div>
                  <div style={{ fontWeight: 500, color: "var(--navy)" }}>{c.criterion}</div>
                  {grade.feedback[c.id] && <div className="evidence" style={{ fontStyle: "normal" }}>{grade.feedback[c.id]}</div>}
                </div>
                <StatusBadge variant={full ? "success" : "warning"}>
                  {score} / {c.points}
                </StatusBadge>
              </div>
            );
          })}
        </Panel>

        <div>
          <Panel style={{ textAlign: "center", marginBottom: 14 }}>
            <div style={{ fontFamily: "var(--font-heading)", fontSize: 48, color: "var(--navy)", lineHeight: 1 }}>
              {grade.total} <span style={{ fontSize: 24, color: "var(--muted)" }}>/ {activity.gradeValue}</span>
            </div>
            <div style={{ marginTop: 10 }}>
              <StatusBadge variant={shared ? "orange" : "navy"}>
                {shared ? `Shared across ${team?.name}` : "Individual grade"}
              </StatusBadge>
            </div>
          </Panel>

          <div style={{ marginBottom: 12 }}>
            <Alert variant="ai" icon="auto_awesome">
              <strong>How this was graded:</strong> AI suggested scores against the rubric with evidence from your
              submission; your instructor reviewed and approved them.
            </Alert>
          </div>

          <StatusBadge variant="lavender">
            <AiBadge />
            Original prep preserved — completeness credit awarded separately
          </StatusBadge>
        </div>
      </div>
    </>
  );
}
