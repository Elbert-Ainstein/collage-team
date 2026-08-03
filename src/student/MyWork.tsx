"use client";

// Student view — "My work" (handoff §4).
//
// Real data (props): the activity, the student's own check-in result, the
// submission stamp, and the text they wrote. Everything to do with QUESTIONS
// and PAGES is PLACEHOLDER — there is no schema for per-question page
// attachments yet — so those regions carry a "Sample" badge and their controls
// are disabled with a reason rather than pretending to work.

import { useEffect, useState } from "react";
import type { Enrolment, Assignment } from "@/checkins/studentData";
import { SIcon } from "./icons";

/* ------------------------------------------------------------- placeholder */

type QState = "done" | "draft" | "empty";

interface QuestionRow {
  id: string;
  parts: string;
  state: QState;
}

/** Seed rows from §4. Not persisted anywhere — marked "Sample" in the UI. */
const QUESTIONS: QuestionRow[] = [
  { id: "1a", parts: "P1, P2", state: "done" },
  { id: "1b", parts: "P2", state: "done" },
  { id: "2", parts: "P3", state: "done" },
  { id: "3a", parts: "P4", state: "draft" },
  { id: "3b", parts: "P4 · not attached", state: "empty" },
];

const DOT: Record<QState, string> = {
  done: "var(--emerald-600)",
  draft: "var(--navy-700)",
  empty: "var(--neutral-300)",
};

interface PageCard {
  id: string;
  tag: string;
  caption: string;
  draft: boolean;
  icon: string;
  action: string;
}

/** Seed page cards from §4, same caveat. */
const PAGES: PageCard[] = [
  { id: "P1", tag: "Q1a", caption: "Photo of worked solution", draft: false, icon: "image", action: "Replace" },
  { id: "P2", tag: "Q1a, Q1b", caption: "Photo of worked solution", draft: false, icon: "image", action: "Replace" },
  { id: "P3", tag: "Q2", caption: "Typed answer · 180 words", draft: false, icon: "assignment", action: "Edit" },
  { id: "P4", tag: "Q3a, Q3b", caption: "Nothing attached yet", draft: true, icon: "addPhoto", action: "Attach" },
];

const NO_FILES = "File attachments are not wired up yet — pages have no storage behind them.";
const SAMPLE = "Sample data from the design handoff — question and page attachments have no schema yet.";

/* ------------------------------------------------------------------ helpers */

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Sun 11:47pm" — the stamp format the handoff uses. */
function stamp(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const h = d.getHours();
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${DAYS[d.getDay()]} ${h12}:${String(d.getMinutes()).padStart(2, "0")}${h < 12 ? "am" : "pm"}`;
}

/* -------------------------------------------------------------- component */

export function MyWork(props: {
  assignment: Assignment;
  enrolment: Enrolment;
  /** Which half of the check-in this is: the student's own, or the team's. */
  mode: "indiv" | "team";
  onBack: () => void;
  onSubmit: (text: string) => Promise<void>;
}) {
  const { assignment, enrolment, mode, onBack, onSubmit } = props;
  const isTeam = mode === "team";
  const activityId = assignment.activity.id;
  const checkIn = isTeam ? assignment.teamCheckIn : assignment.indivCheckIn;
  const result = isTeam ? assignment.teamResult : assignment.myResult;
  const seeded = result?.text ?? "";

  const [text, setText] = useState(seeded);
  const [saved, setSaved] = useState(seeded);
  const [selected, setSelected] = useState(3); // §4: active row is index 3
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed when the caller swaps in a different assignment (or refetches one
  // whose stored text changed).
  useEffect(() => {
    setText(seeded);
    setSaved(seeded);
  }, [activityId, mode, seeded]);

  // Confirmation and errors belong to this activity only. Deliberately NOT
  // keyed on `seeded`: the parent refetches right after a successful submit,
  // and that must not wipe the confirmation the student just earned.
  useEffect(() => {
    setDone(false);
    setError(null);
  }, [activityId, mode]);

  const answered = QUESTIONS.filter((q) => q.state === "done").length;
  const dirty = text !== saved;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const submittedAt = stamp(result?.updated_at ?? null);
  const firstEmpty = QUESTIONS.find((q) => q.state === "empty");

  const cannotSubmit = !checkIn
    ? isTeam
      ? "This activity has no team check-in to submit to."
      : "This activity has no individual check-in to submit to."
    : isTeam && !enrolment.team
      ? "You are not on a team yet, so there is nothing to submit together."
      : result?.status === "scored"
        ? "This has already been graded. Ask your instructor to reopen it."
        : !text.trim()
          ? "Write your answer before submitting."
          : busy
            ? "Submitting…"
            : null;

  // The header state line. Nothing autosaves yet, so it says what is actually
  // true rather than the mock's "Autosaved · draft".
  const stateLine = busy
    ? "Submitting…"
    : done
      ? (isTeam ? "Submitted for the team just now" : "Submitted just now")
      : dirty
        ? "Unsaved draft · not submitted"
        : submittedAt
          ? `Submitted ${submittedAt}`
          : "Draft · not submitted";

  async function submit() {
    if (busy || cannotSubmit) return;
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      await onSubmit(text);
      setSaved(text);
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not submit. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      {/* ---------------------------------------------------------- header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 16,
        }}
      >
        <button type="button" className="sv-btn link" onClick={onBack}>
          <SIcon name="chevronLeft" size={15} />
          {assignment.activity.title}
        </button>
        <h1 className="sv-h2">{isTeam ? "Team answer" : "My work"}</h1>
        <span className="sv-sub">{stateLine}</span>
        <span style={{ flex: 1 }} />
        <span className="sv-sub sv-num" title={SAMPLE}>
          {answered} of {QUESTIONS.length} answered
        </span>
        <button
          type="button"
          className="sv-btn primary"
          onClick={submit}
          disabled={cannotSubmit !== null}
          title={
            cannotSubmit ??
            (isTeam
              ? `Submit your team's answer for ${assignment.activity.title}`
              : `Submit your answer for ${assignment.activity.title}`)
          }
        >
          {busy ? "Submitting…" : isTeam ? "Submit for team" : "Submit"}
        </button>
      </div>

      {/* ------------------------------------------------------------ body */}
      <div style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
        {/* ------------------------------------------------ question list */}
        <div className="sv-card" style={{ width: 204, flex: "none", padding: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 4px 8px" }}>
            <span className="sv-eyebrow" style={{ flex: 1 }}>
              Questions
            </span>
            <span className="sv-badge outline" title={SAMPLE}>
              Sample
            </span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {QUESTIONS.map((q, i) => (
              <button
                key={q.id}
                type="button"
                onClick={() => setSelected(i)}
                aria-pressed={i === selected}
                title={`Question ${q.id} · pages ${q.parts}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "7px 8px",
                  borderRadius: "var(--radius-md)",
                  border: 0,
                  width: "100%",
                  font: "inherit",
                  textAlign: "left",
                  cursor: "pointer",
                  color: "var(--navy)",
                  background: i === selected ? "var(--cream-400)" : "transparent",
                  transition: "background 140ms ease",
                }}
              >
                <span
                  className="sv-num"
                  style={{
                    width: 22,
                    flex: "none",
                    fontSize: "var(--text-xs)",
                    fontWeight: "var(--weight-semibold)",
                  }}
                >
                  {q.id}
                </span>
                <span
                  className="sv-ellip"
                  style={{
                    flex: 1,
                    minWidth: 0,
                    fontSize: "var(--text-xs)",
                    color: "var(--muted-foreground)",
                  }}
                >
                  {q.parts}
                </span>
                <span
                  style={{
                    width: 7,
                    height: 7,
                    flex: "none",
                    borderRadius: 999,
                    background: DOT[q.state],
                  }}
                />
              </button>
            ))}
          </div>

          <div
            style={{
              borderTop: "1px solid var(--neutral-200)",
              marginTop: 10,
              padding: "10px 4px 2px",
              fontSize: "var(--text-2xs)",
              color: "var(--muted-foreground)",
              lineHeight: 1.5,
            }}
          >
            Questions can span more than one page. Attach the page and tag it.
          </div>
        </div>

        {/* ------------------------------------------------- right column */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* the one genuinely wired part of this screen */}
          <div className="sv-card" style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="sv-eyebrow" style={{ flex: 1 }}>
                Your answer
              </span>
              <span className="sv-sub sv-num">{words === 1 ? "1 word" : `${words} words`}</span>
            </div>

            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={busy}
              placeholder="Type your answer here. You can keep editing until you submit."
              aria-label={`Your written answer for ${assignment.activity.title}`}
              style={{
                width: "100%",
                minHeight: 132,
                marginTop: 10,
                padding: "12px 13px",
                border: "1px solid var(--neutral-200)",
                borderRadius: "var(--radius-md)",
                background: "var(--cream-100)",
                color: "var(--navy)",
                font: "inherit",
                fontSize: "var(--text-sm)",
                lineHeight: 1.6,
                resize: "vertical",
              }}
            />

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                flexWrap: "wrap",
                marginTop: 10,
              }}
            >
              <span className="sv-sub" style={{ flex: 1, minWidth: 0 }}>
                {submittedAt
                  ? `Submitting replaces your ${submittedAt} submission.`
                  : "You have not submitted yet."}{" "}
                Only you and your instructor in {enrolment.course.name} can read it.
              </span>
              {done && !dirty && (
                <span className="sv-badge success">
                  <SIcon name="check" size={12} />
                  Submitted
                </span>
              )}
            </div>

            {error && (
              <div
                role="alert"
                style={{
                  marginTop: 8,
                  fontSize: "var(--text-xs)",
                  color: "var(--amber-700)",
                  lineHeight: 1.5,
                }}
              >
                {error}
              </div>
            )}
          </div>

          {/* --------------------------------------------------- pages */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 2px 8px" }}>
            <span className="sv-eyebrow" style={{ flex: 1 }}>
              Pages
            </span>
            <span className="sv-badge outline" title={SAMPLE}>
              Sample
            </span>
          </div>

          <div
            style={{
              display: "grid",
              gap: 12,
              gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
            }}
          >
            {PAGES.map((p) => (
              <div
                key={p.id}
                style={{
                  border: `1px solid ${p.draft ? "var(--cream-500)" : "var(--neutral-200)"}`,
                  background: "var(--cream-100)",
                  borderRadius: "var(--radius-lg)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "11px 13px",
                    borderBottom: "1px solid var(--neutral-200)",
                  }}
                >
                  <span
                    style={{
                      fontFamily: "var(--font-serif)",
                      fontSize: "var(--text-sm)",
                      fontWeight: "var(--weight-bold)",
                    }}
                  >
                    {p.id}
                  </span>
                  <span style={{ flex: 1 }} />
                  <span
                    className="sv-ellip"
                    style={{ fontSize: "var(--text-2xs)", color: "var(--muted-foreground)" }}
                  >
                    {p.tag}
                  </span>
                </div>

                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                    minHeight: 132,
                    padding: 18,
                    textAlign: "center",
                    color: "var(--muted-foreground)",
                    background: p.draft ? "var(--cream-300)" : "var(--neutral-100)",
                  }}
                >
                  <SIcon name={p.icon} size={22} />
                  <span style={{ fontSize: "var(--text-xs)" }}>{p.caption}</span>
                </div>

                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "10px 13px",
                    borderTop: "1px solid var(--neutral-200)",
                  }}
                >
                  <span className={`sv-badge ${p.draft ? "sky" : "success"}`}>
                    {p.draft ? "Draft" : "Attached"}
                  </span>
                  <span style={{ flex: 1 }} />
                  <button type="button" className="sv-btn link sm" disabled title={NO_FILES}>
                    {p.action}
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* ----------------------------------------------- prompt bar */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginTop: 14,
              padding: "13px 16px",
              border: "1px solid var(--neutral-200)",
              background: "var(--cream-300)",
              borderRadius: "var(--radius-lg)",
            }}
          >
            <span className="sv-sub" style={{ flex: 1, minWidth: 0 }}>
              {firstEmpty
                ? `Q${firstEmpty.id} has no page attached yet.`
                : "Every question has a page attached."}
            </span>
            <button type="button" className="sv-btn outline sm" disabled title={NO_FILES}>
              <SIcon name="add" size={15} />
              Add a page
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
