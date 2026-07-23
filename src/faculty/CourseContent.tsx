"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components";
import { useStore } from "@/store";
import { LESSONS, SUMMATIVES, type ContentRow } from "./seed";
import type { Activity } from "@/types";

type Sub = "lessons" | "summatives" | "activities";
const FILTERS = ["All", "Published", "Draft", "Closed"] as const;

const STATUS_CLS: Record<string, string> = {
  Published: "bg-[#e7f5ef] text-[#0e7c57]",
  Draft: "bg-[#fff4e5] text-[#b45309]",
  Closed: "bg-navy/[0.06] text-muted-fg",
  Scheduled: "bg-[#e0f2fe] text-[#0369a1]",
  "Team stage": "bg-[#fff0e6] text-[#ff6713]",
  Grading: "bg-[#f3e8ff] text-[#7c3aed]",
  Released: "bg-[#e7f5ef] text-[#0e7c57]",
};

function Badge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_CLS[status] ?? STATUS_CLS.Closed}`}>
      {status}
    </span>
  );
}

function activityStatusLabel(a: Activity): string {
  switch (a.status) {
    case "team-stage": return "Team stage";
    case "grading": return "Grading";
    case "released": return "Released";
    case "scheduled": return "Scheduled";
    case "draft": return "Draft";
    default: return "Published";
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
    <section className="mt-12">
      <h2 className="mb-4 font-serif text-[26px] font-semibold text-black/80">Course content</h2>

      <div className="mb-4 flex gap-6 border-b border-line">
        <Tab id="lessons" active={sub} onClick={setSub} icon="menu_book" label="Lessons" count={LESSONS.length} />
        <Tab id="summatives" active={sub} onClick={setSub} icon="quiz" label="Summatives" count={SUMMATIVES.length} />
        <Tab id="activities" active={sub} onClick={setSub} icon="groups" label="Activities" count={activities.length} />
      </div>

      <div className="mb-1 flex gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium ${filter === f ? "bg-navy text-cream" : "text-muted-fg hover:bg-navy/5"}`}
          >
            {f}
          </button>
        ))}
        <button className="rounded-lg px-2 py-1.5 text-muted-fg hover:bg-navy/5" title="Refresh">
          <Icon name="refresh" size="sm" />
        </button>
      </div>

      <div className="grid grid-cols-[1fr_130px_150px_170px] items-center gap-3 border-b border-line px-1.5 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-fg">
        <span>{sub === "activities" ? "Activity" : sub === "summatives" ? "Summative" : "Lesson"}</span>
        <span>Status</span>
        <span>Due</span>
        <span />
      </div>

      {sub !== "activities" &&
        visible.map((r) => (
          <div key={r.id} className="grid grid-cols-[1fr_130px_150px_170px] items-center gap-3 border-b border-line px-1.5 py-3.5">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky/40 text-[#0382ed]">
                <Icon name={sub === "summatives" ? "quiz" : "menu_book"} size="sm" />
              </span>
              <span className="text-sm font-semibold text-navy">{r.title}</span>
            </div>
            <Badge status={r.status} />
            <span className="text-sm text-muted-fg">{r.due ? `Due ${r.due}` : "No due date"}</span>
            <div className="flex items-center justify-end gap-2">
              <button className="flex items-center gap-1.5 rounded-lg bg-navy px-3.5 py-2 text-xs font-medium text-cream hover:bg-navy-deep">
                <Icon name="auto_awesome" size="sm" /> Generate
              </button>
              <button className="rounded-lg p-1.5 text-navy/50 hover:bg-navy/5">
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
            <div key={a.id} className="grid grid-cols-[1fr_130px_150px_170px] items-center gap-3 border-b border-line px-1.5 py-3.5">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-purple/25 text-[#7c3aed]">
                  <Icon name="groups" size="sm" />
                </span>
                <div>
                  <div className="text-sm font-semibold text-navy">{a.title}</div>
                  <div className="text-xs text-muted-fg">
                    {a.questions.length} questions · {a.mode === "COLLECTIVE" ? "Collective" : "Individual"} · {a.gradeValue} pts
                  </div>
                </div>
              </div>
              <Badge status={label} />
              <span className="text-sm text-muted-fg">{a.individualDue ? `Due ${a.individualDue}` : "No due date"}</span>
              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={() => {
                    setCurrent(a.id);
                    router.push(`/i/activity/${a.id}?tab=${grade ? "grade" : "build"}`);
                  }}
                  className="flex items-center gap-1.5 rounded-lg bg-navy px-3.5 py-2 text-xs font-medium text-cream hover:bg-navy-deep"
                >
                  <Icon name={grade ? "grading" : "edit"} size="sm" /> {grade ? "Grade" : "Open"}
                </button>
                <button className="rounded-lg p-1.5 text-navy/50 hover:bg-navy/5">
                  <Icon name="more_vert" size="sm" />
                </button>
              </div>
            </div>
          );
        })}
    </section>
  );
}

function Tab({ id, active, onClick, icon, label, count }: { id: Sub; active: Sub; onClick: (s: Sub) => void; icon: string; label: string; count: number }) {
  const on = active === id;
  return (
    <button
      onClick={() => onClick(id)}
      className={`-mb-px flex items-center gap-2 border-b-2 px-0.5 py-2.5 text-sm font-medium ${on ? "border-navy text-navy" : "border-transparent text-muted-fg hover:text-navy"}`}
    >
      <Icon name={icon} size="sm" /> {label}
      <span className="rounded-full bg-navy/[0.08] px-1.5 py-0.5 text-[10px] text-navy/70">{count}</span>
    </button>
  );
}
