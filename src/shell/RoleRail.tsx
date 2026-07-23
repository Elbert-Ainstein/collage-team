"use client";

import { usePathname, useRouter } from "next/navigation";
import { useStore } from "@/store";
import { Icon } from "@/components";
import type { Role } from "@/types";

export function RoleRail() {
  const setRole = useStore((s) => s.setRole);
  const router = useRouter();
  const pathname = usePathname();
  const isInstructor = pathname.startsWith("/i");

  function switchTo(next: Role) {
    setRole(next); // keeps the "/" landing redirect in sync
    router.push(next === "instructor" ? "/i/overview" : "/s/activities");
  }

  return (
    <nav className="rail" aria-label="Role">
      <div className="rail__brand" title="Collage AI">
        ✦
      </div>
      <button
        className={`rail__btn ${isInstructor ? "rail__btn--active" : ""}`}
        onClick={() => switchTo("instructor")}
        title="Instructor"
        aria-pressed={isInstructor}
      >
        <Icon name="school" />
      </button>
      <button
        className={`rail__btn ${!isInstructor ? "rail__btn--active" : ""}`}
        onClick={() => switchTo("student")}
        title="Student"
        aria-pressed={!isInstructor}
      >
        <Icon name="person" />
      </button>
    </nav>
  );
}
