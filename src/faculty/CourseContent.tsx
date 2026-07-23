"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components";
import { useStore } from "@/store";
import { LESSONS, SUMMATIVES, type ContentRow } from "./seed";
import type { Activity } from "@/types";

type Sub = "lessons" | "summatives" | "activities";
const FILTERS = ["All", "Published", "Draft", "Closed"] as const;

const STATUS_STYLE: Record<string, { bg: string; fg: string }> = {
  Published: { bg: "var(--success-bg)", fg: "var(--success-fg)" },
  Draft: { bg: "var(--warning-bg)", fg: "var(--warning-fg)" },
  Closed: { bg: "rgba(0,35,65,0.06)", fg: "var(--muted-fg)" },
  Scheduled: { bg: "var(--sky-bg)", fg: "var(--sky-fg)" },
  "Team stage": { bg: "var(--stage-collective-bg)", fg: "var(--stage-collective-fg)" },
  Grading: { bg: "var(--lavender-bg)", fg: "var(--lavender-fg)" },
  Released: { bg: "var(--success-bg)", fg: "var(--success-fg)" },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLE[status] ?? STATUS_STYLE.Closed;
  return (
    <span className="fac-badge" style={{ background: s.bg, color: s.fg }}>
      {status}
    </span>
  );
}

// Map an Activity's lifecycle status to a faculty-list label + row action.
function activityStatusLabel(a: Activity): string {
  switch (a.status) {
    case "team-stage":
      return "Team stage";
    case "grading":
      return "Grading";
    case "released":
      return "Released";
    case "scheduled":
      return "Scheduled";
    case "draft":
      return "Draft";
    default:
      return "Published";
  }
}

export function CourseContent() {
  const router = useRouter();
  const activities = useStore((s) => s.activities);
  const setCurrent = useStore((s) => s.setCurrentActivity);
  const [sub, setSub] = useState<Sub>("lessons");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("All");

  const rows: ContentRow[] = sub === "lessons" ? LESSONS : sub === "summatives" ? SUMMATIVES : [];
  const visible = filter === "All" ? rows : rows.filter((r) => r.status === filter);

  return (
    <section className="fac-course">
      <h2>Course content</h2>

      <div className="fac-subtabs">
        <Tab id="lessons" active={sub} onClick={setSub} icon="menu_book" label="Lessons" count={LESSONS.length} />
        <Tab id="summatives" active={sub} onClick={setSub} icon="quiz" label="Summatives" count={SUMMATIVES.length} />
        <Tab id="activities" active={sub} onClick={setSub} icon="groups" label="Activities" count={activities.length} />
      </div>

      <div className="fac-filters">
        {FILTERS.map((f) => (
          <button key={f} className={`fac-filter ${filter === f ? "fac-filter--on" : ""}`} onClick={() => setFilter(f)}>
            {f}
          </button>
        ))}
        <button className="fac-filter" title="Refresh">
          <Icon name="refresh" size="sm" />
        </button>
      </div>

      <div className="fac-list">
        <div className="fac-list__head">
          <span>{sub === "activities" ? "Activity" : sub === "summatives" ? "Summative" : "Lesson"}</span>
          <span>Status</span>
          <span>Due</span>
          <span />
        </div>

        {sub !== "activities" &&
          visible.map((r) => (
            <div className="fac-row" key={r.id}>
              <div className="fac-row__title">
                <span className="fac-row__icon">
                  <Icon name={sub === "summatives" ? "quiz" : "menu_book"} size="sm" />
                </span>
                <span className="fac-row__name">{r.title}</span>
              </div>
              <StatusBadge status={r.status} />
              <span className="fac-row__due">{r.due ? `Due ${r.due}` : "No due date"}</span>
              <div className="fac-row__actions">
                <button className="fac-gen-cta">
                  <Icon name="auto_awesome" size="sm" /> Generate
                </button>
                <button className="fac-icon-btn">
                  <Icon name="more_vert" size="sm" />
                </button>
              </div>
            </div>
          ))}

        {sub === "activities" &&
          activities.map((a) => {
            const label = activityStatusLabel(a);
            const grade = a.status === "grading" || a.status === "team-stage";
            return (
              <div className="fac-row" key={a.id}>
                <div className="fac-row__title">
                  <span className="fac-row__icon" style={{ background: "var(--stage-discussion-bg)", color: "var(--stage-discussion-fg)" }}>
                    <Icon name="groups" size="sm" />
                  </span>
                  <div>
                    <div className="fac-row__name">{a.title}</div>
                    <div className="fac-option__desc">
                      {a.questions.length} questions · {a.mode === "COLLECTIVE" ? "Collective" : "Individual"} · {a.gradeValue} pts
                    </div>
                  </div>
                </div>
                <StatusBadge status={label} />
                <span className="fac-row__due">{a.individualDue ? `Due ${a.individualDue}` : "No due date"}</span>
                <div className="fac-row__actions">
                  <button
                    className="fac-gen-cta"
                    onClick={() => {
                      setCurrent(a.id);
                      router.push(grade ? "/i/grading" : "/i/activities?tab=builder");
                    }}
                  >
                    <Icon name={grade ? "grading" : "edit"} size="sm" /> {grade ? "Grade" : "Open"}
                  </button>
                  <button className="fac-icon-btn">
                    <Icon name="more_vert" size="sm" />
                  </button>
                </div>
              </div>
            );
          })}
      </div>
    </section>
  );
}

function Tab({
  id,
  active,
  onClick,
  icon,
  label,
  count,
}: {
  id: Sub;
  active: Sub;
  onClick: (s: Sub) => void;
  icon: string;
  label: string;
  count: number;
}) {
  return (
    <button className={`fac-subtab ${active === id ? "fac-subtab--active" : ""}`} onClick={() => onClick(id)}>
      <Icon name={icon} size="sm" /> {label}
      <span className="fac-subtab__count">{count}</span>
    </button>
  );
}
