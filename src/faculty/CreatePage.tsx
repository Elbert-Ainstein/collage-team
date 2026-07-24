"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components";
import { useStore } from "@/store";
import { BRIDGE_ACTIVITY } from "@/seed";
import { CourseContent } from "./CourseContent";

const GEN_OPTIONS = [
  { key: "lesson", label: "Generate Lesson", icon: "menu_book" },
  { key: "summative", label: "Generate Summative", icon: "quiz" },
  { key: "activity", label: "Upload Activity", icon: "groups" }, // ← Team Module integration
  { key: "import", label: "Import Summative", icon: "upload_file" },
];

const OPTIONS = [
  { key: "lesson", title: "Create a Lesson from your sources", desc: "", icon: "menu_book", tint: "bg-sky/40 text-[#0382ed]" },
  { key: "summative", title: "Create an Assessment from sources and existing lessons", desc: "", icon: "quiz", tint: "bg-[#ffe770]/40 text-[#b45309]" },
  {
    key: "activity",
    title: "Create a team Activity by uploading your sources",
    desc: "Four-stage team-based learning — prep, discussion, submission, assessment",
    icon: "groups",
    tint: "bg-brand-purple/25 text-[#7c3aed]",
  },
  { key: "import", title: "Upload an assessment you already have", desc: "", icon: "upload_file", tint: "bg-navy/[0.06] text-muted-fg" },
];

export function CreatePage() {
  const router = useRouter();
  const setCurrent = useStore((s) => s.setCurrentActivity);
  const [gen, setGen] = useState(GEN_OPTIONS[0]);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [sources, setSources] = useState<string[]>([]);
  const isActivity = gen.key === "activity";

  function selectActivity() {
    setGen(GEN_OPTIONS[2]);
  }
  function addSource() {
    setSources((s) => [...s, "Bridge structures (reading).pdf — 6 pages"]);
  }
  function createActivity() {
    setCurrent(BRIDGE_ACTIVITY.id);
    router.push(`/i/activity/${BRIDGE_ACTIVITY.id}?tab=build`);
  }

  return (
    <>
      <div className="mx-auto max-w-3xl pt-6 text-center">
        <h1 className="font-serif text-[40px] font-semibold leading-tight tracking-tight text-black/80">
          What would you like to create?
        </h1>
        <p className="mt-2 text-base text-muted-fg">Design. Deliver. Assess.</p>
      </div>

      {/* prompt box */}
      <div className="mx-auto mt-7 max-w-3xl rounded-2xl border border-line bg-cream-100 p-4 shadow-2xs">
        {!isActivity && (
          <textarea
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Describe the lesson you want to generate — a topic, learning goals, or what it should cover…"
            className="w-full resize-none bg-transparent text-base text-navy outline-none placeholder:text-navy/40"
          />
        )}

        {isActivity && (
          <div>
            {sources.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-[#cfc6ac] bg-page p-5 text-center">
                <Icon name="upload" className="text-muted-fg" />
                <div className="text-sm font-medium text-navy">Drag &amp; drop source material for the activity, or</div>
                <div className="flex gap-2">
                  <button className="flex items-center gap-1.5 rounded-lg border border-line bg-cream-100 px-3 py-1.5 text-sm font-medium text-navy hover:bg-cream-300" onClick={addSource}>
                    <Icon name="upload_file" size="sm" /> Upload files
                  </button>
                  <button className="flex items-center gap-1.5 rounded-lg border border-line bg-cream-100 px-3 py-1.5 text-sm font-medium text-navy hover:bg-cream-300" onClick={addSource}>
                    <Icon name="auto_awesome" size="sm" /> Use sample PDF
                  </button>
                </div>
                <div className="text-[10px] text-muted-fg">slides, PDFs, docs, text, images, or video — up to 25 MB each</div>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {sources.map((s, i) => (
                  <div key={i} className="flex items-center gap-2 rounded-lg border border-line bg-page px-3 py-2 text-sm text-navy">
                    <Icon name="description" size="sm" /> <span className="flex-1">{s}</span>
                    <button className="text-navy/50 hover:text-navy" onClick={() => setSources((x) => x.filter((_, idx) => idx !== i))}>
                      <Icon name="close" size="sm" />
                    </button>
                  </div>
                ))}
                <button className="flex w-fit items-center gap-1.5 rounded-lg border border-line bg-cream-100 px-3 py-1.5 text-sm font-medium text-navy hover:bg-cream-300" onClick={addSource}>
                  <Icon name="add" size="sm" /> Add more
                </button>
              </div>
            )}
          </div>
        )}

        <div className="mt-2 flex items-center gap-2">
          <button className="flex h-8 w-8 items-center justify-center rounded-lg text-navy/60 hover:bg-navy/5 hover:text-navy" title="Attach" onClick={isActivity ? addSource : undefined}>
            <Icon name="attach_file" size="sm" />
          </button>
          <div className="relative">
            <button className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-navy hover:bg-navy/5" onClick={() => setOpen((o) => !o)}>
              <Icon name={gen.icon} size="sm" /> {gen.label} <Icon name="expand_more" size="sm" />
            </button>
            {open && (
              <div className="absolute left-0 top-full z-20 mt-1.5 min-w-56 rounded-xl border border-line bg-cream-100 p-1.5 shadow-md">
                {GEN_OPTIONS.map((o) => (
                  <button
                    key={o.key}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-navy hover:bg-navy/5"
                    onClick={() => {
                      setGen(o);
                      setOpen(false);
                    }}
                  >
                    <Icon name={o.icon} size="sm" /> {o.label}
                    {o.key === gen.key && <Icon name="check" size="sm" className="ml-auto text-navy" />}
                  </button>
                ))}
              </div>
            )}
          </div>
          {isActivity ? (
            <button
              disabled={sources.length === 0}
              onClick={createActivity}
              className="ml-auto flex items-center gap-1.5 rounded-lg bg-navy px-3.5 py-2 text-xs font-medium text-cream shadow-2xs hover:bg-navy-deep disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Icon name="upload" size="sm" /> Upload activity
            </button>
          ) : (
            <button
              className={`ml-auto flex h-9 w-9 items-center justify-center rounded-lg ${text.trim() ? "bg-navy text-cream" : "bg-[#e7e2d3] text-navy/40"}`}
              title="Generate"
            >
              <Icon name="arrow_upward" size="sm" />
            </button>
          )}
        </div>
      </div>

      {/* option rows */}
      <div className="mx-auto mt-5 max-w-3xl overflow-hidden rounded-2xl border border-line">
        {OPTIONS.map((o, i) => {
          const highlight = o.key === "lesson" || (isActivity && o.key === "activity");
          return (
            <button
              key={o.key}
              onClick={o.key === "activity" ? selectActivity : undefined}
              className={`flex w-full items-center gap-3.5 px-5 py-4 text-left transition-colors ${
                i > 0 ? "border-t border-line" : ""
              } ${highlight ? "bg-sky/20" : "bg-cream-100 hover:bg-cream-300"}`}
            >
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${o.tint}`}>
                <Icon name={o.icon} size="sm" />
              </span>
              <span>
                <span className="block text-[15px] font-semibold text-navy">{o.title}</span>
                {o.desc && <span className="mt-0.5 block text-xs text-muted-fg">{o.desc}</span>}
              </span>
            </button>
          );
        })}
      </div>

      <CourseContent onlySubs={["lessons", "summatives"]} />
    </>
  );
}
