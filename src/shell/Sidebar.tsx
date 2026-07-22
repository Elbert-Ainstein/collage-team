"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { activityById, useStore } from "@/store";
import { Avatar, Icon, StatusBadge } from "@/components";
import { canAccessTeamStage } from "@/services/responseService";
import { MAYA } from "@/seed";

interface NavEntry {
  to: string;
  label: string;
  icon: string;
  tag?: "MVP" | "soon";
  locked?: boolean;
  lockReason?: string;
}
interface NavGroup {
  label: string;
  items: NavEntry[];
}

const INSTRUCTOR_GROUPS: NavGroup[] = [
  {
    label: "Teaching",
    items: [
      { to: "/i/dashboard", label: "Course dashboard", icon: "dashboard" },
      { to: "/i/library", label: "Activity library", icon: "library_books" },
    ],
  },
  {
    label: "Roster & teams",
    items: [
      { to: "/i/roster", label: "Roster & import", icon: "upload_file" },
      { to: "/i/teams", label: "Team management", icon: "groups" },
      { to: "/i/formation", label: "Team formation", icon: "hub", tag: "soon" },
    ],
  },
  {
    label: "Authoring",
    items: [
      { to: "/i/builder", label: "Activity builder", icon: "construction" },
      { to: "/i/ai", label: "AI generation", icon: "auto_awesome", tag: "soon" },
      { to: "/i/rubric", label: "Rubric builder", icon: "rule" },
    ],
  },
  {
    label: "Class & assessment",
    items: [
      { to: "/i/live", label: "Live dashboard", icon: "sensors" },
      { to: "/i/grading", label: "Grading", icon: "grading" },
      { to: "/i/results", label: "Results & analytics", icon: "insights", tag: "soon" },
      { to: "/i/peer-eval", label: "Peer evaluation", icon: "reviews", tag: "soon" },
    ],
  },
];

export function Sidebar() {
  const role = useStore((s) => s.role);
  return (
    <aside className="sidebar">
      <div className="sidebar__scroll">{role === "instructor" ? <InstructorNav /> : <StudentNav />}</div>
      <UserCard />
    </aside>
  );
}

function InstructorNav() {
  return (
    <>
      {INSTRUCTOR_GROUPS.map((g) => (
        <div className="nav-group" key={g.label}>
          <div className="nav-group__label">{g.label}</div>
          {g.items.map((it) => (
            <NavItem key={it.to} entry={it} />
          ))}
        </div>
      ))}
    </>
  );
}

function StudentNav() {
  const currentActivityId = useStore((s) => s.currentActivityId);
  const activity = useStore((s) => activityById(s, currentActivityId));
  // Subscribe to originals so the gate recomputes when prep is submitted.
  useStore((s) => s.originals);
  const canTeam = canAccessTeamStage(MAYA.id, currentActivityId);

  const finalTo = activity?.mode === "COLLECTIVE" ? "/s/collective" : "/s/individual";

  return (
    <>
      <div className="nav-group">
        <div className="nav-group__label">Learn</div>
        <NavItem entry={{ to: "/s/activities", label: "My activities", icon: "checklist" }} />
      </div>

      <div className="nav-scoped">
        <div className="nav-scoped__title">{activity?.title ?? "Activity"}</div>
        <NavItem entry={{ to: "/s/prep", label: "Individual prep", icon: "person" }} />
        <NavItem
          entry={{
            to: "/s/discussion",
            label: "Team discussion",
            icon: "groups",
            locked: !canTeam,
            lockReason: "Submit prep first",
          }}
        />
        <NavItem
          entry={{
            to: finalTo,
            label: "Final submission",
            icon: activity?.mode === "COLLECTIVE" ? "diversity_3" : "draw",
            locked: !canTeam,
            lockReason: "Submit prep first",
          }}
        />
        <NavItem entry={{ to: "/s/grades", label: "Grades & feedback", icon: "verified" }} />
      </div>
    </>
  );
}

function NavItem({ entry }: { entry: NavEntry }) {
  const pathname = usePathname();
  if (entry.locked) {
    return (
      <div className="nav-item nav-item--locked" title={entry.lockReason}>
        <Icon name="lock" size="sm" />
        {entry.label}
        <Icon name="lock" size="sm" className="nav-item__tag" />
      </div>
    );
  }
  const isActive = pathname === entry.to;
  return (
    <Link href={entry.to} className={`nav-item ${isActive ? "nav-item--active" : ""}`}>
      <Icon name={entry.icon} size="sm" />
      {entry.label}
      {entry.tag === "soon" && (
        <span className="nav-item__tag">
          <StatusBadge variant="outline">soon</StatusBadge>
        </span>
      )}
    </Link>
  );
}

function UserCard() {
  const role = useStore((s) => s.role);
  const course = useStore((s) => s.course);
  const isInstructor = role === "instructor";
  const member = isInstructor
    ? { id: "inst", name: course.instructorName, initials: "EA", avatarTint: "#002341" }
    : MAYA;
  return (
    <div className="user-card">
      <Avatar member={member} size={36} />
      <div>
        <div className="user-card__name">{member.name}</div>
        <div className="user-card__sub">
          {isInstructor ? "Instructor" : "Student"} · {course.code}
        </div>
      </div>
    </div>
  );
}
