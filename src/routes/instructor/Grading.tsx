"use client";

import { useEffect, useMemo, useState } from "react";
import { activityById, memberById, useStore } from "@/store";
import {
  AiBadge,
  Alert,
  Avatar,
  Button,
  Icon,
  PageHeader,
  Panel,
  SectionLabel,
  StatusBadge,
} from "@/components";
import {
  approveAndRelease,
  gradebookCell,
  getGrade,
  getSubmissionText,
  getSuggestion,
  saveGradeDraft,
  suggestGrade,
} from "@/services/gradingService";
import { SEED_TEAM_3 } from "@/seed";

export function Grading() {
  const activityId = useStore((s) => s.currentActivityId);
  const activity = useStore((s) => activityById(s, activityId))!;
  const [view, setView] = useState<"submissions" | "gradebook">("submissions");

  return (
    <>
      <PageHeader
        title="Grading"
        subtitle={`${activity.title} — assessed for correctness & quality against the approved rubric.`}
        actions={
          <div className="segmented">
            <button className={view === "submissions" ? "on" : ""} onClick={() => setView("submissions")}>
              Submissions
            </button>
            <button className={view === "gradebook" ? "on" : ""} onClick={() => setView("gradebook")}>
              Gradebook
            </button>
          </div>
        }
      />
      {view === "submissions" ? <Submissions /> : <Gradebook />}
    </>
  );
}

function Submissions() {
  const activityId = useStore((s) => s.currentActivityId);
  const activity = useStore((s) => activityById(s, activityId))!;
  const teams = useStore((s) => s.teams);
  const collectives = useStore((s) => s.collectives);
  const individualFinals = useStore((s) => s.individualFinals);
  useStore((s) => s.approvedGrades);
  const isTeam = activity.mode === "COLLECTIVE";

  // Queue: teams (COLLECTIVE) or students (INDIVIDUAL) with submission status.
  const queue = useMemo(() => {
    if (isTeam) {
      return teams
        .filter((t) => t.memberIds.length > 0)
        .map((t) => {
          const c = collectives.find((x) => x.teamId === t.id && x.activityId === activityId);
          return { id: t.id, label: t.name, submitted: !!c?.locked, graded: !!getGrade(activityId, t.id)?.releasedAt };
        });
    }
    return SEED_TEAM_3.memberIds.map((mid) => {
      const f = individualFinals.find((x) => x.memberId === mid && x.activityId === activityId);
      const m = memberById(useStore.getState(), mid)!;
      return { id: mid, label: m.name, submitted: !!f?.locked, graded: !!getGrade(activityId, mid)?.releasedAt };
    });
  }, [isTeam, teams, collectives, individualFinals, activityId]);

  const firstSubmitted = queue.find((q) => q.submitted)?.id ?? queue[0]?.id ?? null;
  const [selected, setSelected] = useState<string | null>(firstSubmitted);
  const target = selected ?? firstSubmitted;

  return (
    <div className="grading-layout">
      <Panel pad={false} style={{ padding: 8 }}>
        <SectionLabel>{isTeam ? "Teams" : "Students"}</SectionLabel>
        {queue.map((q) => (
          <button
            key={q.id}
            className={`queue-item ${q.id === target ? "queue-item--active" : ""}`}
            onClick={() => setSelected(q.id)}
          >
            <span
              className="dot"
              style={{ background: q.graded ? "var(--success-fg)" : q.submitted ? "var(--stage-collective-fg)" : "#cbc3ae" }}
            />
            <span style={{ flex: 1 }}>
              <div style={{ fontWeight: 500 }}>{q.label}</div>
              <div className="queue-item__sub">{q.graded ? "Graded ✓" : q.submitted ? "Submitted" : "Not submitted"}</div>
            </span>
          </button>
        ))}
      </Panel>

      {target ? (
        <GradePanel activityId={activityId} target={target} isTeam={isTeam} />
      ) : (
        <Panel>
          <Alert variant="info">No submissions yet.</Alert>
        </Panel>
      )}
    </div>
  );
}

function GradePanel({ activityId, target, isTeam }: { activityId: string; target: string; isTeam: boolean }) {
  const activity = useStore((s) => activityById(s, activityId))!;
  useStore((s) => s.aiSuggestions);
  useStore((s) => s.approvedGrades);
  const mode = activity.mode;
  const text = getSubmissionText(activityId, target, mode);
  const suggestion = getSuggestion(activityId, target);
  const grade = getGrade(activityId, target);
  const released = !!grade?.releasedAt;

  const [scores, setScores] = useState<Record<string, number>>({});
  const [feedback, setFeedback] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  // Generate the AI suggestion once a submitted target is selected (never auto-released).
  useEffect(() => {
    let active = true;
    if (text != null && !suggestion) {
      setLoading(true);
      suggestGrade(activityId, target, mode).finally(() => active && setLoading(false));
    }
    return () => {
      active = false;
    };
  }, [activityId, target, mode, text, suggestion]);

  // Seed the editable scores from the approved grade (if any) else the AI suggestion.
  useEffect(() => {
    const init: Record<string, number> = {};
    const fb: Record<string, string> = {};
    for (const c of activity.rubric) {
      init[c.id] = grade?.scores[c.id] ?? suggestion?.byCriterion[c.id]?.score ?? 0;
      fb[c.id] = grade?.feedback[c.id] ?? "";
    }
    setScores(init);
    setFeedback(fb);
  }, [activity.rubric, suggestion, grade, target]);

  const total = Object.values(scores).reduce((a, b) => a + b, 0);
  const targetName = isTeam ? useStore.getState().teams.find((t) => t.id === target)?.name : memberById(useStore.getState(), target)?.name;

  if (text == null) {
    return (
      <Panel>
        <Alert variant="warning">{targetName} has not submitted yet — nothing to grade.</Alert>
      </Panel>
    );
  }

  return (
    <div>
      <Panel style={{ marginBottom: 16 }}>
        <div className="member-card__head">
          <Icon name={isTeam ? "diversity_3" : "person"} />
          <div style={{ flex: 1 }}>
            <div className="member-card__name">{targetName}</div>
            <div className="member-card__sub">Submitted response{released && " · graded & released"}</div>
          </div>
          {released && <StatusBadge variant="success" icon="check">Released</StatusBadge>}
        </div>
        <div className="answer-block" style={{ marginTop: 8 }}>{text}</div>
        <div style={{ marginTop: 10 }}>
          <StatusBadge variant="orange" icon="attach_file">calc_bridge_load.jpg · <AiBadge>OCR</AiBadge></StatusBadge>
        </div>
      </Panel>

      <Panel>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <div style={{ fontWeight: 600, color: "var(--navy)" }}>Rubric-based grading</div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {suggestion && <StatusBadge variant="orange"><AiBadge>AI-suggested</AiBadge></StatusBadge>}
            <span style={{ fontFamily: "var(--font-heading)", fontSize: "var(--text-2xl)", color: "var(--navy)" }}>
              {total} / {activity.gradeValue}
            </span>
          </div>
        </div>

        {loading && !suggestion && <Alert variant="info">Generating AI suggestion…</Alert>}

        {activity.rubric.map((c) => {
          const sug = suggestion?.byCriterion[c.id];
          return (
            <div className="criterion-row" key={c.id}>
              <div>
                <div style={{ fontWeight: 500, color: "var(--navy)" }}>{c.criterion}</div>
                {sug && (
                  <div className="evidence">
                    <AiBadge>Evidence:</AiBadge> {sug.evidence}
                  </div>
                )}
              </div>
              {sug && (
                <StatusBadge variant={sug.confidence === "High" ? "success" : "warning"}>
                  {sug.confidence} confidence
                </StatusBadge>
              )}
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <input
                  className="score-input"
                  type="number"
                  min={0}
                  max={c.points}
                  value={scores[c.id] ?? 0}
                  disabled={released}
                  onChange={(e) => setScores({ ...scores, [c.id]: Math.max(0, Math.min(c.points, Number(e.target.value))) })}
                />
                <span style={{ color: "var(--muted)" }}>/ {c.points}</span>
              </span>
            </div>
          );
        })}

        <div style={{ margin: "14px 0" }}>
          <Alert variant="info">
            The AI suggestion and your grade are kept separate. Adjust any score to override — both are preserved in the
            record. Nothing reaches students until you release.
          </Alert>
        </div>

        {!released ? (
          <div style={{ display: "flex", gap: 10 }}>
            <Button variant="secondary" icon="save" onClick={() => saveGradeDraft(activityId, target, mode, scores, feedback)}>
              Save draft
            </Button>
            <Button variant="primary" icon="check_circle" onClick={() => approveAndRelease(activityId, target, mode, scores, feedback)}>
              {isTeam ? "Approve & release team grade" : "Approve & release grade"}
            </Button>
          </div>
        ) : (
          <Alert variant="success" icon="check_circle">
            Released {new Date(grade!.releasedAt!).toLocaleString()} · {targetName}
            {isTeam ? " and every team member" : ""} can now see the rubric breakdown.
          </Alert>
        )}
      </Panel>
    </div>
  );
}

function Gradebook() {
  const activityId = useStore((s) => s.currentActivityId);
  const activity = useStore((s) => activityById(s, activityId))!;
  useStore((s) => s.approvedGrades);
  useStore((s) => s.originals);
  const shared = activity.mode === "COLLECTIVE";

  return (
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
                      Individual {cell.prepEarned}/{cell.prepMax} (completeness)
                    </StatusBadge>
                    <StatusBadge variant={shared ? "orange" : "navy"}>
                      {shared ? "Team" : "Individual"}{" "}
                      {cell.submissionScore == null ? "—" : `${cell.submissionScore}/${cell.submissionMax}`} (
                      {shared ? "shared grade" : "final grade"})
                    </StatusBadge>
                    {cell.flag && <StatusBadge variant="warning">reviewed</StatusBadge>}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div style={{ marginTop: 14, fontSize: "var(--text-xs)", color: "var(--muted)", lineHeight: 1.5 }}>
        Completeness credit and the graded submission are stored separately for every student — the completeness grade is
        never affected by the correctness of the final work.
      </div>
    </Panel>
  );
}
