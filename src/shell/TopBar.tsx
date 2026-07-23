"use client";

import { usePathname } from "next/navigation";
import { useStore } from "@/store";
import { Icon } from "@/components";
import { SEED_TEAM_3 } from "@/seed";

// Instructor hubs (leaf of /i/*).
const INSTRUCTOR_LABELS: Record<string, string> = {
  overview: "Overview",
  activities: "Activities",
  roster: "Roster & teams",
  grading: "Assessment",
};

// Student screens (leaf of /s/*).
const STUDENT_LABELS: Record<string, string> = {
  activities: "My activities",
  prep: "Individual prep",
  ocr: "OCR review",
  confirm: "Preparation submitted",
  discussion: "Team discussion",
  collective: "Team's final response",
  individual: "My final response",
  participation: "Participation",
  grades: "Grades & feedback",
};

export function TopBar() {
  const course = useStore((s) => s.course);
  const pathname = usePathname();
  const isStudent = pathname.startsWith("/s");
  const leaf = pathname.split("/").filter(Boolean).pop() ?? "";
  const context = (isStudent ? STUDENT_LABELS : INSTRUCTOR_LABELS)[leaf] ?? "";

  return (
    <header className="topbar">
      <div className="breadcrumb">
        <span className="breadcrumb__code">{course.code}</span>
        <Icon name="chevron_right" size="sm" />
        <span>{context}</span>
      </div>
      <div className="topbar__right">
        {isStudent && (
          <span className="team-badge">
            <Icon name="groups" size="sm" />
            {SEED_TEAM_3.name}
          </span>
        )}
        <Icon name="notifications" />
        <Icon name="help_outline" />
      </div>
    </header>
  );
}
