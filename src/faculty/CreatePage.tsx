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
  { key: "activity", label: "Generate Activity", icon: "groups" }, // ← Team Module integration
  { key: "import", label: "Import Summative", icon: "upload_file" },
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
  function removeSource(i: number) {
    setSources((s) => s.filter((_, idx) => idx !== i));
  }
  // Activities are created by uploading source material directly (no wizard).
  function createActivity() {
    setCurrent(BRIDGE_ACTIVITY.id);
    router.push(`/i/activity/${BRIDGE_ACTIVITY.id}?tab=build`);
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
            isActivity
              ? "Optional: describe the team activity — the decision students must justify, or what it should cover…"
              : "Describe the lesson you want to generate — a topic, learning goals, or what it should cover…"
          }
        />

        {/* Activity creation is upload-first (no wizard): drop source material here. */}
        {isActivity && (
          <div className="fac-upload">
            {sources.length === 0 ? (
              <div className="fac-upload__drop">
                <Icon name="upload" style={{ color: "var(--muted-fg)" }} />
                <div className="fac-upload__hint">
                  Drag &amp; drop source material for the activity, or
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="wiz__btn" onClick={addSource}>
                    <Icon name="upload_file" size="sm" /> Upload files
                  </button>
                  <button className="wiz__btn" onClick={addSource}>
                    <Icon name="auto_awesome" size="sm" /> Use sample PDF
                  </button>
                </div>
                <div style={{ fontSize: "var(--text-2xs)", color: "var(--muted-fg)" }}>
                  slides, PDFs, docs, text, images, or video — up to 25 MB each
                </div>
              </div>
            ) : (
              <div className="fac-upload__list">
                {sources.map((s, i) => (
                  <div key={i} className="fac-upload__file">
                    <Icon name="description" size="sm" /> <span style={{ flex: 1 }}>{s}</span>
                    <button className="fac-icon-btn" onClick={() => removeSource(i)}>
                      <Icon name="close" size="sm" />
                    </button>
                  </div>
                ))}
                <button className="wiz__btn" onClick={addSource} style={{ alignSelf: "flex-start" }}>
                  <Icon name="add" size="sm" /> Add more
                </button>
              </div>
            )}
          </div>
        )}

        <div className="fac-prompt__bar">
          <button className="fac-icon-btn" title="Attach source material" onClick={isActivity ? addSource : undefined}>
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
          {isActivity ? (
            <button
              className="fac-gen-cta"
              style={{ marginLeft: "auto" }}
              disabled={sources.length === 0}
              onClick={createActivity}
            >
              <Icon name="auto_awesome" size="sm" /> Generate activity
            </button>
          ) : (
            <button className={`fac-send ${text.trim() ? "fac-send--on" : ""}`} title="Generate">
              <Icon name="arrow_upward" size="sm" />
            </button>
          )}
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
        <button className={`fac-option ${isActivity ? "fac-option--primary" : ""}`} onClick={selectActivity}>
          <span className="fac-option__icon" style={{ background: "var(--stage-discussion-bg)", color: "var(--stage-discussion-fg)" }}>
            <Icon name="groups" size="sm" />
          </span>
          <span>
            <span className="fac-option__title">Create a team Activity by uploading your sources</span>
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
