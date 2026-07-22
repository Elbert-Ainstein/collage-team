"use client";

import { useRouter } from "next/navigation";
import { useStore } from "@/store";
import { Icon } from "@/components";
import type { Role } from "@/types";

export function RoleRail() {
  const role = useStore((s) => s.role);
  const setRole = useStore((s) => s.setRole);
  const router = useRouter();

  function switchTo(next: Role) {
    setRole(next);
    router.push(next === "instructor" ? "/i/dashboard" : "/s/activities");
  }

  return (
    <nav className="rail" aria-label="Role">
      <div className="rail__brand" title="Collage AI">
        ✦
      </div>
      <button
        className={`rail__btn ${role === "instructor" ? "rail__btn--active" : ""}`}
        onClick={() => switchTo("instructor")}
        title="Instructor"
        aria-pressed={role === "instructor"}
      >
        <Icon name="school" />
      </button>
      <button
        className={`rail__btn ${role === "student" ? "rail__btn--active" : ""}`}
        onClick={() => switchTo("student")}
        title="Student"
        aria-pressed={role === "student"}
      >
        <Icon name="person" />
      </button>
    </nav>
  );
}
