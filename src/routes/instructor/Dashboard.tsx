"use client";

import { useRouter } from "next/navigation";
import { activityById, useStore } from "@/store";
import {
  Button,
  Icon,
  PageHeader,
  Panel,
  ProgressBar,
  SectionLabel,
  StageChip,
  StagePipeline,
  StatCard,
  StatusBadge,
} from "@/components";
import { getGrade } from "@/services/gradingService";
import { hasSubmittedPrep } from "@/services/responseService";

export function Dashboard() {
  const router = useRouter();
  const course = useStore((s) => s.course);
  const teams = useStore((s) => s.teams);
  const activityId = useStore((s) => s.currentActivityId);
  const activity = useStore((s) => activityById(s, activityId))!;
  const originals = useStore((s) => s.originals);
  const collectives = useStore((s) => s.collectives);
  useStore((s) => s.approvedGrades);

  const prepped = originals.filter((o) => o.locked && o.submittedAt).length;
  const needsReview = originals.filter((o) => o.status === "needs-review").length;
  const awaitingGrade = collectives.filter(
    (c) => c.locked && !getGrade(c.activityId, c.teamId)?.releasedAt,
  ).length;

  const tint = {
    blue: { fg: "var(--stage-prep-fg)", bg: "var(--stage-prep-bg)" },
    green: { fg: "var(--stage-assessment-fg)", bg: "var(--stage-assessment-bg)" },
    amber: { fg: "var(--warning-fg)", bg: "var(--warning-bg)" },
    orange: { fg: "var(--stage-collective-fg)", bg: "var(--stage-collective-bg)" },
  };

  return (
    <>
      <PageHeader
        title="Course dashboard"
        subtitle={`${course.name} · ${course.code} · ${course.term}`}
        actions={
          <>
            <Button variant="secondary" icon="upload_file" onClick={() => router.push("/i/roster")}>
              Import roster
            </Button>
            <Button variant="primary" icon="add" onClick={() => router.push("/i/activities?tab=builder")}>
              New activity
            </Button>
          </>
        }
      />

      <div className="stat-grid">
        <StatCard label="Students" icon="group" tint={tint.blue} value={course.studentCount} sub={`across ${course.teamCount} teams`} />
        <StatCard
          label="Prep complete"
          icon="task_alt"
          tint={tint.green}
          value={`${prepped}/${course.studentCount}`}
          sub={`${Math.round((prepped / course.studentCount) * 100)}% ready`}
        />
        <StatCard label="Needs review" icon="flag" tint={tint.amber} value={needsReview} sub="flagged submissions" />
        <StatCard label="Awaiting grade" icon="grading" tint={tint.orange} value={awaitingGrade} sub="teams submitted" />
      </div>

      <div className="two-col">
        <Panel>
          <SectionLabel>Active activity</SectionLabel>
          <div className="active-activity">
            <span className="tile" style={{ background: "var(--stage-discussion-bg)", color: "var(--stage-discussion-fg)" }}>
              <Icon name="engineering" />
            </span>
            <div style={{ flex: 1 }}>
              <div className="activity-card__title">{activity.title}</div>
              <div className="activity-card__meta">
                Individual due {activity.individualDue} · Team stage {activity.teamStageWhen}
              </div>
              <div style={{ marginTop: 8 }}>
                <StatusBadge variant="orange">Team stage today</StatusBadge>
              </div>
            </div>
            <Button variant="secondary" icon="sensors" onClick={() => router.push("/i/overview?tab=live")}>
              Open live view
            </Button>
          </div>
          <div style={{ marginTop: 16 }}>
            <StagePipeline mode={activity.mode} />
          </div>
        </Panel>

        <Panel>
          <SectionLabel>Prep by team</SectionLabel>
          {teams
            .filter((t) => t.memberIds.length > 0)
            .map((t) => {
              const done = t.memberIds.filter((mid) => hasSubmittedPrep(mid, activityId)).length;
              const full = done === t.memberIds.length;
              return (
                <div className="prep-team-row" key={t.id}>
                  <span>
                    {t.name} — {done}/{t.memberIds.length}
                  </span>
                  <ProgressBar pct={(done / t.memberIds.length) * 100} color={full ? "var(--success-fg)" : "var(--stage-collective-fg)"} />
                  <StageChip stage={full ? "assessment" : "prep"} label={full ? "Ready" : "Prep"} />
                </div>
              );
            })}
        </Panel>
      </div>
    </>
  );
}
