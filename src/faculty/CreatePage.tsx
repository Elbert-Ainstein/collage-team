"use client";

import type { CSSProperties, ReactElement, ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useStore } from "@/store";
import { BRIDGE_ACTIVITY } from "@/seed";
import { CourseContent } from "./CourseContent";

/**
 * The Create landing reproduces the redesign's Dashboard canvas pixel-for-pixel
 * (docs/team-module/redesign/src/dashboard/dashboard.tsx): the "What do you want
 * to create?" hero with the create-card grid, Subject essentials chips, and the
 * Featured resource cards. Content/wiring is adapted to our team-centric app —
 * the marquee tile creates a team activity, and Featured points at our real
 * surfaces (team workspace, roster, analytics, student preview). No builder.
 */

// Material Symbols icon at an exact pixel size (mirrors the redesign's mIcon).
// Our shared <Icon> only exposes sm/md/lg presets, so the dashboard uses this.
function MIcon({
  name,
  size = 20,
  className = "",
  style,
}: {
  name: string;
  size?: number;
  className?: string;
  style?: CSSProperties;
}): ReactElement {
  return (
    <span
      className={`material-symbols-outlined select-none leading-none ${className}`}
      style={{ fontSize: size, width: size, height: size, overflow: "hidden", display: "inline-block", ...style }}
      aria-hidden
    >
      {name}
    </span>
  );
}

/** Small create-category card (Assessments / Flashcards style tiles). */
function CreateCard({
  tint,
  iconBg,
  icon,
  title,
  desc,
  chip,
  onClick,
}: {
  tint: string;
  iconBg: string;
  icon: string;
  title: string;
  desc: string;
  chip?: string;
  onClick?: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative flex items-start gap-3 rounded-xl border p-4 text-left transition-shadow hover:shadow-md"
      style={{ backgroundColor: tint, borderColor: "rgba(0,35,65,0.12)" }}
    >
      {chip && (
        <span className="absolute -top-2.5 right-3 rounded-md bg-navy px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-cream">
          {chip}
        </span>
      )}
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-cream" style={{ backgroundColor: iconBg }}>
        <MIcon name={icon} size={18} />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-navy">{title}</span>
        <span className="mt-0.5 block text-xs leading-4 text-navy/70">{desc}</span>
      </span>
    </button>
  );
}

function SubjectChip({ icon, label, from, to }: { icon: string; label: string; from: string; to: string }): ReactElement {
  return (
    <button type="button" className="group flex w-20 flex-col items-center gap-2">
      <span
        className="flex h-14 w-14 items-center justify-center rounded-full text-navy transition-transform group-hover:scale-105"
        style={{ backgroundImage: `linear-gradient(135deg, ${from}, ${to})` }}
      >
        <MIcon name={icon} size={22} />
      </span>
      <span className="text-xs font-medium text-navy/80">{label}</span>
    </button>
  );
}

function ResourceCard({
  icon,
  preview,
  title,
  desc,
  action,
  onClick,
}: {
  icon: string;
  preview: [string, string];
  title: string;
  desc: string;
  action: string;
  onClick: () => void;
}): ReactElement {
  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-line bg-cream-100 shadow-2xs transition-shadow hover:shadow-md">
      <div
        className="flex h-32 items-center justify-center border-b border-line"
        style={{ backgroundImage: `linear-gradient(135deg, ${preview[0]}, ${preview[1]})` }}
      >
        <span className="flex h-14 w-14 items-center justify-center rounded-xl bg-white/70 text-navy shadow-xs">
          <MIcon name={icon} size={26} />
        </span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-1.5 p-4">
        <p className="text-sm font-semibold text-navy">{title}</p>
        <p className="flex-1 text-xs leading-4 text-navy/70">{desc}</p>
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            onClick={onClick}
            className="rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-medium text-navy shadow-2xs hover:bg-cream-300"
          >
            {action}
          </button>
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }): ReactElement {
  return <h2 className="font-serif text-xl font-semibold text-black/80">{children}</h2>;
}

export function CreatePage(): ReactElement {
  const router = useRouter();
  const setCurrent = useStore((s) => s.setCurrentActivity);
  const addActivity = useStore((s) => s._addActivity);
  const setRole = useStore((s) => s.setRole);

  // The marquee tile creates a fresh team activity (its PDF is the source) and
  // opens the team workspace — activities are an uploaded brief, no builder.
  function createTeamActivity(): void {
    const id = `act-${Date.now().toString(36)}`;
    addActivity({
      ...BRIDGE_ACTIVITY,
      id,
      title: "Untitled team activity",
      objective: "Uploaded team activity.",
      description: "Your team collaborates on this brief — share resources, record discussions, and track progress.",
      status: "team-stage",
      source: { filename: "activity.pdf", pages: 4, kind: "pdf" },
    });
    setCurrent(id);
    router.push(`/i/activity/${id}`);
  }

  const openBridge = (): void => {
    setCurrent(BRIDGE_ACTIVITY.id);
    router.push(`/i/activity/${BRIDGE_ACTIVITY.id}?tab=source`);
  };
  const comingSoon = (): void => void router.push("/i/library");
  const viewAsStudent = (): void => {
    setRole("student");
    router.push("/s/activities");
  };

  return (
    <>
      {/* hero */}
      <div className="rounded-xl border border-line bg-cream-300 p-6 shadow-2xs">
        <div className="flex items-center justify-between">
          <h1 className="font-serif text-3xl font-semibold text-black/80">What do you want to create?</h1>
          <span className="flex items-center gap-1.5 text-xs font-medium text-navy/70">
            <MIcon name="school" size={15} /> Collage Academy
          </span>
        </div>
        <div className="mt-5 grid grid-cols-1 gap-3 lg:grid-cols-[1.2fr_1fr_1fr]">
          {/* marquee tile — a team activity (our team pillar's entry point) */}
          <button
            type="button"
            onClick={createTeamActivity}
            className="relative row-span-2 flex flex-col items-start gap-3 rounded-xl border p-5 text-left transition-shadow hover:shadow-md"
            style={{ backgroundColor: "rgba(220,162,253,0.16)", borderColor: "#dca2fd" }}
          >
            <span className="absolute -top-2.5 right-4 rounded-md bg-navy px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-cream">
              Team
            </span>
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-navy text-cream">
              <MIcon name="groups" size={22} />
            </span>
            <span>
              <span className="block font-serif text-xl font-semibold text-black/80">Team activity</span>
              <span className="mt-1 block text-xs leading-5 text-navy/70">
                Upload a PDF brief and your teams collaborate on it — shared resources, a recorded discussion, and an AI
                project progress report. No builder.
              </span>
            </span>
            <span className="mt-auto flex items-center gap-1.5 rounded-lg bg-navy px-3 py-1.5 text-xs font-medium text-cream">
              <MIcon name="upload" size={14} /> Upload activity
            </span>
          </button>
          <CreateCard
            tint="#d5efff"
            iconBg="#0382ed"
            icon="menu_book"
            title="Lesson"
            desc="Inline lessons with concepts, media, equations, and exercises."
            onClick={comingSoon}
          />
          <CreateCard
            tint="rgba(173,221,192,0.45)"
            iconBg="#15803d"
            icon="quiz"
            title="Assessment"
            desc="Checks for understanding with 4 question types and AI feedback."
            onClick={comingSoon}
          />
          <CreateCard
            tint="rgba(246,206,231,0.5)"
            iconBg="#9405e6"
            icon="style"
            title="Flashcards"
            desc="Flip decks with images, char limits, and student practice mode."
            chip="Soon"
            onClick={comingSoon}
          />
          <CreateCard
            tint="rgba(255,231,112,0.35)"
            iconBg="#b45309"
            icon="checklist"
            title="Worksheets"
            desc="Practice, review, and skill-building sheets from your source PDFs."
            onClick={comingSoon}
          />
        </div>
      </div>

      {/* subjects */}
      <div className="mt-8">
        <SectionTitle>Subject essentials</SectionTitle>
        <div className="mt-4 flex flex-wrap gap-4">
          <SubjectChip icon="science" label="Chemistry" from="#d5efff" to="#a2c5fd" />
          <SubjectChip icon="biotech" label="Biology" from="#adddc0" to="#a2fdc5" />
          <SubjectChip icon="functions" label="Math" from="#ffe770" to="#efdfad" />
          <SubjectChip icon="menu_book" label="ELA" from="#f6cee7" to="#dca2fd" />
          <SubjectChip icon="public" label="Social studies" from="#fdd7a2" to="#fda2a2" />
          <SubjectChip icon="record_voice_over" label="Speech" from="#dca2fd" to="#a2c5fd" />
          <SubjectChip icon="code" label="CS" from="#c2e5ff" to="#7db9ff" />
          <SubjectChip icon="palette" label="Arts" from="#f6cee7" to="#ffc9d7" />
        </div>
      </div>

      {/* featured — our real team-pillar surfaces */}
      <div className="mt-8">
        <SectionTitle>Featured in your workspace</SectionTitle>
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <ResourceCard
            icon="groups"
            preview={["#f6cee7", "#dca2fd"]}
            title="Bridge Design Decision — team activity"
            desc="The seeded team activity: a PDF brief with shared resources, a recorded team discussion, and an AI project progress report."
            action="Open workspace"
            onClick={openBridge}
          />
          <ResourceCard
            icon="diversity_3"
            preview={["#d5efff", "#a2c5fd"]}
            title="Roster & teams"
            desc="Import your class roster and organize students into project teams for the team-based activities."
            action="Manage teams"
            onClick={() => router.push("/i/team?tab=teams")}
          />
          <ResourceCard
            icon="analytics"
            preview={["#adddc0", "#a2fdc5"]}
            title="Team analytics"
            desc="Participation, discussion, and progress signals across every team — see who's on track and who needs a nudge."
            action="View analytics"
            onClick={() => router.push("/i/team?tab=analytics")}
          />
          <ResourceCard
            icon="visibility"
            preview={["#fdd7a2", "#fda2a2"]}
            title="Student experience"
            desc="Preview the student side end to end — individual prep, the team stage, discussion recording, and progress."
            action="View as student"
            onClick={viewAsStudent}
          />
        </div>
      </div>

      {/* our real course content (lessons + summatives) */}
      <CourseContent onlySubs={["lessons", "summatives"]} />
    </>
  );
}
