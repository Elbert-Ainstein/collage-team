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

function DashLogo() {
  return (
    <span className="select-none font-serif text-[21px] leading-7 tracking-tight text-navy">
      Collage
      <span className="font-semibold">
        <span className="bg-clip-text text-transparent" style={{ backgroundImage: "linear-gradient(115deg,#ff8bd2 10%,#c77dff 90%)" }}>
          Λ
        </span>
        <span className="bg-clip-text text-transparent" style={{ backgroundImage: "linear-gradient(115deg,#7db9ff 10%,#38a2ff 90%)" }}>
          I
        </span>
      </span>
    </span>
  );
}

export function FacultySidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const setRole = useStore((s) => s.setRole);

  function viewAsStudent() {
    setRole("student");
    router.push("/s/activities");
  }

  return (
    <aside className="flex w-60 shrink-0 flex-col px-4 pb-4 pt-4">
      <div className="flex items-center justify-between px-2 pb-5">
        <DashLogo />
        <span className="flex gap-1 text-navy/50">
          <button className="rounded-md p-1 hover:bg-navy/5 hover:text-navy" title="Toggle theme">
            <Icon name="dark_mode" size="sm" />
          </button>
          <button className="rounded-md p-1 hover:bg-navy/5 hover:text-navy" title="Collapse sidebar">
            <Icon name="menu_open" size="sm" />
          </button>
        </span>
      </div>

      <nav className="flex flex-col gap-1">
        {NAV.map((n) => {
          const active = pathname.startsWith(n.to);
          return (
            <Link
              key={n.to}
              href={n.to}
              className={`flex h-9 w-full items-center gap-2.5 rounded-lg px-3 text-sm transition-colors ${
                active ? "border border-line bg-cream-400/50 font-medium text-navy" : "border border-transparent text-navy/70 hover:bg-navy/5 hover:text-navy"
              }`}
            >
              <Icon name={n.icon} size="sm" />
              <span className="min-w-0 flex-1 truncate text-left">{n.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto flex flex-col gap-1">
        <button
          onClick={viewAsStudent}
          className="flex items-center justify-between rounded-lg px-3 py-2 text-sm text-navy/70 hover:bg-navy/5 hover:text-navy"
          title="Preview the student experience"
        >
          <span className="flex items-center gap-2">
            <Icon name="visibility" size="sm" /> View as student
          </span>
          <Icon name="chevron_right" size="sm" />
        </button>
        <button className="flex items-center justify-between rounded-lg px-3 py-2 text-sm text-navy/70 hover:bg-navy/5 hover:text-navy">
          My courses
          <Icon name="chevron_right" size="sm" />
        </button>
        <div className="mt-1 flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-navy/5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-purple text-sm font-semibold text-navy">D</div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold leading-4 text-navy">{FACULTY_COURSE.instructor}</p>
            <p className="truncate text-[10px] leading-3 text-navy/60">{FACULTY_COURSE.instructorEmail}</p>
          </div>
          <Icon name="unfold_more" size="sm" className="text-navy/50" />
        </div>
      </div>
    </aside>
  );
}
