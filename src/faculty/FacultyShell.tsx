"use client";

import { useRouter } from "next/navigation";
import { Icon } from "@/components";
import { FacultySidebar } from "./FacultySidebar";
import { FACULTY_COURSE } from "./seed";

function Stat({ icon, value, label }: { icon: string; value: React.ReactNode; label: string }) {
  return (
    <span className="flex items-center gap-1.5 rounded-full border border-line bg-cream-100 px-3 py-1.5 text-xs text-navy/80">
      <Icon name={icon} size="sm" /> <b className="font-semibold text-navy">{value}</b> {label}
    </span>
  );
}

// The redesigned Faculty Dashboard shell (top course bar + Create/Analytics/
// AI tutor/Library sidebar + floating canvas). Hosts the instructor experience;
// the Team Learning Module lives inside it (see docs/team-module/INTEGRATION-PLAN.md).
export function FacultyShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  return (
    <div className="flex h-screen min-w-[1180px] flex-col bg-cream-100 font-sans text-navy">
      <header className="flex h-14 shrink-0 items-center justify-between gap-4 px-4">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-navy">Faculty Dashboard</span>
          <span className="flex items-center gap-1.5 rounded-full border border-line bg-cream-100 px-3 py-1.5 text-xs text-navy/75">
            <Icon name="menu_book" size="sm" /> {FACULTY_COURSE.title}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Stat icon="menu_book" value={FACULTY_COURSE.lessons} label="Lessons" />
          <Stat icon="quiz" value={FACULTY_COURSE.summatives} label="Summatives" />
          <Stat icon="donut_small" value={`${FACULTY_COURSE.avgCompletion}%`} label="Avg completion" />
          <button
            onClick={() => router.push("/i/roster")}
            className="flex items-center gap-1.5 rounded-full border border-line bg-cream-100 px-3 py-1.5 text-xs text-navy/80 hover:bg-cream-300"
            title="Roster & teams"
          >
            <Icon name="group" size="sm" /> <b className="font-semibold text-navy">{FACULTY_COURSE.students}</b> Students
          </button>
          <button
            onClick={() => router.push("/i/roster")}
            className="flex items-center gap-1.5 rounded-lg bg-navy px-3.5 py-2 text-xs font-medium text-cream shadow-2xs hover:bg-navy-deep"
          >
            <Icon name="person_add" size="sm" /> Invite
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <FacultySidebar />
        <main className="min-h-0 flex-1 overflow-y-auto py-3 pr-3" data-fac-main>
          <div className="min-h-full rounded-2xl border border-line bg-page px-10 py-10 shadow-xs">{children}</div>
        </main>
      </div>
    </div>
  );
}
