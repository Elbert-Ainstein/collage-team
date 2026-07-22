"use client";

import { activityById, useStore } from "@/store";
import { Alert, Button, PageHeader, Panel, SectionLabel, StatusBadge, AiBadge } from "@/components";
import type { Activity, RubricCriterion } from "@/types";

const LEVELS = [
  { name: "Exemplary", frac: 1 },
  { name: "Proficient", frac: 0.75 },
  { name: "Developing", frac: 0.5 },
  { name: "Beginning", frac: 0.25 },
];

export function RubricBuilder() {
  const activityId = useStore((s) => s.currentActivityId);
  const activity = useStore((s) => activityById(s, activityId))!;
  const update = useStore((s) => s._updateActivity);

  function setCriterion(id: string, patch: Partial<RubricCriterion>) {
    const rubric = activity.rubric.map((c) => (c.id === id ? { ...c, ...patch } : c));
    update(activityId, { rubric } as Partial<Activity>);
  }

  const total = activity.rubric.reduce((a, c) => a + c.points, 0);
  const oralTotal = activity.oralRubric.reduce((a, c) => a + c.points, 0);

  return (
    <>
      <PageHeader
        title="Rubric builder"
        subtitle={`${activity.title} · ${total} points`}
        actions={<Button variant="primary" icon="check_circle">Approve rubric</Button>}
      />

      {activity.rubric.map((c) => (
        <Panel key={c.id} style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <div style={{ flex: 1, fontWeight: 600, color: "var(--navy)" }}>{c.criterion}</div>
            <StatusBadge variant="outline">{c.points} pts</StatusBadge>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "var(--text-xs)", color: "var(--muted)" }}>
              <AiBadge /> AI may score
              <button className={`switch ${c.aiMayScore ? "switch--on" : ""}`} onClick={() => setCriterion(c.id, { aiMayScore: !c.aiMayScore })}>
                <span className="switch__knob" />
              </button>
            </span>
          </div>
          <div style={{ color: "var(--muted)", fontSize: "var(--text-sm)" }}>{c.description}</div>
          <div className="rubric-levels">
            {LEVELS.map((lv) => (
              <div className="rubric-level" key={lv.name}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontWeight: 500 }}>{lv.name}</span>
                  <span className="rubric-level__pts">{Math.round(c.points * lv.frac)}</span>
                </div>
                <span style={{ color: "var(--muted)" }}>
                  {lv.name === "Exemplary" ? "Fully meets the criterion" : lv.name === "Beginning" ? "Minimal evidence" : "Partial evidence"}
                </span>
              </div>
            ))}
          </div>
        </Panel>
      ))}

      <div style={{ margin: "24px 0 12px" }}>
        <SectionLabel>Oral check-in rubric</SectionLabel>
      </div>
      <Panel style={{ borderLeft: "4px solid var(--lavender-fg)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <StatusBadge variant="lavender" icon="mic">Oral check-in · {oralTotal} pts</StatusBadge>
          <Button variant="ghost" icon="edit">Edit oral rubric</Button>
        </div>
        {activity.oralRubric.map((c) => (
          <div className="criterion-row" key={c.id} style={{ gridTemplateColumns: "1fr auto" }}>
            <div>
              <div style={{ fontWeight: 500, color: "var(--navy)" }}>{c.criterion}</div>
              <div className="evidence" style={{ fontStyle: "normal" }}>{c.description}</div>
            </div>
            <StatusBadge variant="outline">{c.points} pts</StatusBadge>
          </div>
        ))}
        <div style={{ marginTop: 12 }}>
          <Alert variant="info" icon="info">
            Scored separately from the written submission — it never changes the team grade or completeness credit.
          </Alert>
        </div>
      </Panel>
    </>
  );
}
