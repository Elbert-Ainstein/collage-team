"use client";

import { Icon } from "@/components";
import { FacultySidebar } from "./FacultySidebar";
import { FACULTY_COURSE } from "./seed";

// The redesigned Faculty Dashboard shell (top course bar + Create/Analytics/
// AI tutor/Library sidebar + floating canvas). Hosts the instructor experience;
// the Team Learning Module lives inside it (see docs/team-module/INTEGRATION-PLAN.md).
export function FacultyShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="faculty">
      <header className="fac-topbar">
        <div className="fac-topbar__left">
          <span className="fac-topbar__title">Faculty Dashboard</span>
          <span className="fac-course-chip">
            <Icon name="menu_book" size="sm" /> {FACULTY_COURSE.title}
          </span>
        </div>
        <div className="fac-topbar__right">
          <span className="fac-stat">
            <Icon name="menu_book" size="sm" /> <b>{FACULTY_COURSE.lessons}</b> Lessons
          </span>
          <span className="fac-stat">
            <Icon name="quiz" size="sm" /> <b>{FACULTY_COURSE.summatives}</b> Summatives
          </span>
          <span className="fac-stat">
            <Icon name="donut_small" size="sm" /> <b>{FACULTY_COURSE.avgCompletion}%</b> Avg completion
          </span>
          <span className="fac-stat">
            <Icon name="group" size="sm" /> <b>{FACULTY_COURSE.students}</b> Students
          </span>
          <button className="fac-invite">
            <Icon name="person_add" size="sm" /> Invite
          </button>
        </div>
      </header>

      <div className="fac-body">
        <FacultySidebar />
        <main className="fac-main">
          <div className="fac-canvas">{children}</div>
        </main>
      </div>
    </div>
  );
}
