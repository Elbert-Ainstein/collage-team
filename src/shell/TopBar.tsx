"use client";

import { usePathname } from "next/navigation";
import { useStore } from "@/store";
import { Icon } from "@/components";
import { SEED_TEAM_3 } from "@/seed";

const CONTEXT_LABELS: Record<string, string> = {
  dashboard: "Course dashboard",
  library: "Activity library",
  roster: "Roster & import",
  teams: "Team management",
  builder: "Activity builder",
  rubric: "Rubric builder",
  live: "Live dashboard",
  grading: "Grading",
  results: "Results & analytics",
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
  const context = CONTEXT_LABELS[leaf] ?? "";

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
