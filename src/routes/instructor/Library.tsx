"use client";

import { useRouter } from "next/navigation";
import { useStore } from "@/store";
import { AiBadge, Button, Icon, PageHeader, Panel, StatusBadge } from "@/components";
import type { Activity } from "@/types";

const STATUS_BADGE: Record<Activity["status"], { variant: "orange" | "lavender" | "outline" | "sky" | "success"; label: string }> = {
  "team-stage": { variant: "orange", label: "Team stage today" },
  grading: { variant: "lavender", label: "Grading" },
  released: { variant: "success", label: "Released" },
  draft: { variant: "outline", label: "Draft" },
  scheduled: { variant: "sky", label: "Scheduled" },
  "prep-open": { variant: "sky", label: "Prep open" },
};

export function Library() {
  const router = useRouter();
  const activities = useStore((s) => s.activities);
  const setCurrent = useStore((s) => s.setCurrentActivity);

  function open(a: Activity) {
    setCurrent(a.id);
    router.push("/i/builder");
  }

  return (
    <>
      <PageHeader
        title="Activity library"
        subtitle="Every team-based activity in this course."
        actions={
          <>
            <Button variant="secondary" icon="add" onClick={() => router.push("/i/builder")}>
              Create manually
            </Button>
            <Button variant="primary" icon="auto_awesome" onClick={() => router.push("/i/ai")}>
              Generate with AI
            </Button>
          </>
        }
      />
      <div className="lib-grid">
        {activities.map((a) => {
          const badge = STATUS_BADGE[a.status];
          return (
            <Panel key={a.id} pad={false}>
              <button className="lib-card" onClick={() => open(a)}>
                <span className="tile" style={{ background: "var(--stage-prep-bg)", color: "var(--stage-prep-fg)" }}>
                  <Icon name="engineering" />
                </span>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <div className="activity-card__title" style={{ fontSize: "var(--text-base)" }}>
                      {a.title}
                    </div>
                    <StatusBadge variant={badge.variant}>{badge.label}</StatusBadge>
                  </div>
                  <div className="activity-card__meta">
                    {a.questions.length} questions ·{" "}
                    <Icon name={a.mode === "COLLECTIVE" ? "diversity_3" : "person"} size="sm" />{" "}
                    {a.mode === "COLLECTIVE" ? "Collective" : "Individual"}
                  </div>
                </div>
              </button>
            </Panel>
          );
        })}
      </div>
      <div style={{ marginTop: 14 }}>
        <StatusBadge variant="outline">
          <AiBadge /> AI generation available behind the pilot flag
        </StatusBadge>
      </div>
    </>
  );
}
