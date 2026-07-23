"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components";
import { CourseContent } from "./CourseContent";

const GEN_OPTIONS = [
  { key: "lesson", label: "Generate Lesson", icon: "menu_book" },
  { key: "summative", label: "Generate Summative", icon: "quiz" },
  { key: "activity", label: "Generate Activity", icon: "groups" }, // ← Team Module integration
  { key: "import", label: "Import Summative", icon: "upload_file" },
];

export function CreatePage() {
  const router = useRouter();
  const [gen, setGen] = useState(GEN_OPTIONS[0]);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");

  function goActivityBuilder() {
    router.push("/i/activities?tab=builder");
  }

  return (
    <>
      <div className="fac-hero">
        <h1>What would you like to create?</h1>
        <div className="fac-hero__sub">Design. Deliver. Assess.</div>
      </div>

      <div className="fac-prompt">
        <textarea
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={
            gen.key === "activity"
              ? "Describe the team activity — topic, the decision students must justify, or what it should cover…"
              : "Describe the lesson you want to generate — a topic, learning goals, or what it should cover…"
          }
        />
        <div className="fac-prompt__bar">
          <button className="fac-icon-btn" title="Attach source material">
            <Icon name="attach_file" size="sm" />
          </button>
          <div className="fac-gen-select">
            <button className="fac-gen-btn" onClick={() => setOpen((o) => !o)}>
              <Icon name={gen.icon} size="sm" /> {gen.label} <Icon name="expand_more" size="sm" />
            </button>
            {open && (
              <div className="fac-menu">
                {GEN_OPTIONS.map((o) => (
                  <button
                    key={o.key}
                    onClick={() => {
                      setGen(o);
                      setOpen(false);
                    }}
                  >
                    <Icon name={o.icon} size="sm" /> {o.label}
                    {o.key === gen.key && <Icon name="check" size="sm" className="check" />}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            className={`fac-send ${text.trim() ? "fac-send--on" : ""}`}
            title="Generate"
            onClick={() => gen.key === "activity" && goActivityBuilder()}
          >
            <Icon name="arrow_upward" size="sm" />
          </button>
        </div>
      </div>

      <div className="fac-options">
        <button className="fac-option fac-option--primary">
          <span className="fac-option__icon" style={{ background: "var(--stage-prep-bg)", color: "var(--stage-prep-fg)" }}>
            <Icon name="menu_book" size="sm" />
          </span>
          <span>
            <span className="fac-option__title">Create a Lesson from your sources</span>
          </span>
        </button>
        <button className="fac-option">
          <span className="fac-option__icon" style={{ background: "var(--stage-collective-bg)", color: "var(--stage-collective-fg)" }}>
            <Icon name="quiz" size="sm" />
          </span>
          <span>
            <span className="fac-option__title">Create an Assessment from sources and existing lessons</span>
          </span>
        </button>
        <button className="fac-option" onClick={goActivityBuilder}>
          <span className="fac-option__icon" style={{ background: "var(--stage-discussion-bg)", color: "var(--stage-discussion-fg)" }}>
            <Icon name="groups" size="sm" />
          </span>
          <span>
            <span className="fac-option__title">Create a team Activity from sources &amp; lessons</span>
            <span className="fac-option__desc">Four-stage team-based learning — prep, discussion, submission, assessment</span>
          </span>
        </button>
        <button className="fac-option">
          <span className="fac-option__icon" style={{ background: "rgba(0,35,65,0.06)", color: "var(--muted-fg)" }}>
            <Icon name="upload_file" size="sm" />
          </span>
          <span>
            <span className="fac-option__title">Upload an assessment you already have</span>
          </span>
        </button>
      </div>

      <CourseContent />
    </>
  );
}
