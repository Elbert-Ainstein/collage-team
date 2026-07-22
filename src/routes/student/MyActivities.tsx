"use client";

import { useRouter } from "next/navigation";
import { useStore } from "@/store";
import { Icon, PageHeader, Panel, StatusBadge } from "@/components";
import { STAGE_META } from "@/components/StageChip";
import { hasSubmittedPrep } from "@/services/responseService";
import { MAYA } from "@/seed";
import type { Activity, Stage } from "@/types";

function currentStage(a: Activity): Stage {
  if (a.status === "released") return "assessment";
  if (a.status === "grading") return "assessment";
  if (a.status === "team-stage") return "discussion";
  return "prep";
}

export function MyActivities() {
  const activities = useStore((s) => s.activities);
  const router = useRouter();
  useStore((s) => s.originals); // reactivity

  return (
    <>
      <PageHeader title="My activities" subtitle="Your team-based learning activities for this course." />
      <div className="activity-list">
        {activities.map((a) => {
          const stage = currentStage(a);
          const meta = STAGE_META[stage];
          const prepped = hasSubmittedPrep(MAYA.id, a.id);
          const isActive = a.id === "act-bridge";
          return (
            <Panel key={a.id} pad={false}>
              <button
                className="activity-card"
                onClick={() => router.push(isActive ? "/s/prep" : "/s/prep")}
                disabled={!isActive}
                style={{ opacity: isActive ? 1 : 0.6 }}
              >
                <span className="tile" style={{ background: meta.bg, color: meta.fg }}>
                  <Icon name={meta.icon} />
                </span>
                <div className="activity-card__body">
                  <div className="activity-card__title">{a.title}</div>
                  <div className="activity-card__meta">
                    {a.status === "team-stage" ? "Team stage open now" : `Due ${a.individualDue}`} ·{" "}
                    {prepped ? "Prep complete" : `${a.questions.length} questions`}
                  </div>
                </div>
                {a.status === "team-stage" && <StatusBadge variant="lavender">Team discussion</StatusBadge>}
                {a.status === "released" && <StatusBadge variant="success">Graded</StatusBadge>}
                {(a.status === "draft" || a.status === "scheduled") && (
                  <StatusBadge variant="outline">Not started</StatusBadge>
                )}
                <Icon name="chevron_right" className="icon" style={{ color: "var(--muted-2)" }} />
              </button>
            </Panel>
          );
        })}
      </div>
    </>
  );
}
