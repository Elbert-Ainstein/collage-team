"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Icon } from "@/components";
import { useStore } from "@/store";
import { FACULTY_COURSE } from "./seed";

const NAV = [
  { to: "/i/create", label: "Create", icon: "add_circle" },
  { to: "/i/analytics", label: "Analytics", icon: "bar_chart" },
  { to: "/i/tutor", label: "AI tutor", icon: "smart_toy" },
  { to: "/i/library", label: "Library", icon: "library_books" },
];

export function FacultySidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const setRole = useStore((s) => s.setRole);

  function viewAsStudent() {
    setRole("student");
    router.push("/s/activities");
  }

  return (
    <aside className="fac-sidebar">
      <div className="fac-brand">
        <span className="fac-logo">
          Collage
          <b>
            <span className="g1">Λ</span>
            <span className="g2">I</span>
          </b>
        </span>
        <span className="fac-brand__tools">
          <button title="Toggle theme">
            <Icon name="dark_mode" size="sm" />
          </button>
          <button title="Collapse sidebar">
            <Icon name="menu_open" size="sm" />
          </button>
        </span>
      </div>

      <nav className="fac-nav">
        {NAV.map((n) => {
          const active = pathname.startsWith(n.to);
          return (
            <Link key={n.to} href={n.to} className={`fac-navitem ${active ? "fac-navitem--active" : ""}`}>
              <Icon name={n.icon} size="sm" />
              {n.label}
            </Link>
          );
        })}
      </nav>

      <div className="fac-side-bottom">
        <button className="fac-mycourses" onClick={viewAsStudent} title="Preview the student experience">
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <Icon name="visibility" size="sm" /> View as student
          </span>
          <Icon name="chevron_right" size="sm" />
        </button>
        <div className="fac-mycourses">
          My courses
          <Icon name="chevron_right" size="sm" />
        </div>
        <div className="fac-user">
          <span className="fac-user__av">D</span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="fac-user__name">{FACULTY_COURSE.instructor}</div>
            <div className="fac-user__mail">{FACULTY_COURSE.instructorEmail}</div>
          </div>
          <Icon name="unfold_more" size="sm" style={{ color: "rgba(0,35,65,0.5)" }} />
        </div>
      </div>
    </aside>
  );
}
