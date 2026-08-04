"use client";

// Student view — "My work" (handoff §4).
//
// Real data (props): the activity, the student's own check-in result, the
// submission stamp, and the text they wrote. Everything to do with QUESTIONS
// and PAGES is PLACEHOLDER — there is no schema for per-question page
// attachments yet — so those regions carry a "Sample" badge and their controls
// are disabled with a reason rather than pretending to work.

import { useEffect, useRef, useState } from "react";
import { isSubmissionConflict, type Enrolment, type Assignment } from "@/checkins/studentData";
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

/** Milliseconds, or null for anything that is not a usable timestamp. */
function ms(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

function message(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

/* ------------------------------------------------------------------- drafts */

/**
 * Unsent typing, kept on the device only.
 *
 * NOT in the database: the team row is shared, so autosaving keystrokes there
 * would turn every pause in a discussion into the overwrite this screen now
 * guards against. localStorage is per-person by construction.
 */
interface Draft {
  text: string;
  /** When it was typed, so a stale draft never beats a newer submission. */
  at: string;
}

const DRAFT_PREFIX = "collage.student.draft.v1";

/**
 * Keyed by the row being written AND by which half is being written. The
 * individual and team check-ins already have different ids, but spelling the
 * half out means a future shared id cannot make the two drafts collide.
 */
function draftKey(mode: "indiv" | "team", checkInId: string, subjectId: string): string {
  return `${DRAFT_PREFIX}:${mode}:${checkInId}:${subjectId}`;
}

function loadDraft(key: string): Draft | null {
  const raw = window.localStorage.getItem(key);
  if (!raw) return null;
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null) return null;
  const d = parsed as Partial<Draft>;
  if (typeof d.text !== "string" || typeof d.at !== "string") return null;
  return { text: d.text, at: d.at };
}

/** What a lost race looks like on screen: both versions, and a choice. */
interface Conflict {
  /** The stored text that beat us there. */
  theirs: string;
  /** Its version stamp — both the thing to display and the thing to write over. */
  at: string | null;
  /** What this student had written when they pressed Submit. */
  mine: string;
  resolved: "mine" | "theirs" | null;
}

/* -------------------------------------------------------------- component */

export function MyWork(props: {
  assignment: Assignment;
  enrolment: Enrolment;
  /** Which half of the check-in this is: the student's own, or the team's. */
  mode: "indiv" | "team";
  onBack: () => void;
  /**
   * Write the answer. `expectedUpdatedAt` is the version this screen was
   * editing; the caller must pass it through to submitMyWork/submitTeamWork so
   * a write that lost a race fails loudly instead of overwriting a teammate.
   */
  onSubmit: (text: string, expectedUpdatedAt: string | null) => Promise<void>;
}) {
  const { assignment, enrolment, mode, onBack, onSubmit } = props;
  const isTeam = mode === "team";
  const activityId = assignment.activity.id;
  const checkIn = isTeam ? assignment.teamCheckIn : assignment.indivCheckIn;
  const result = isTeam ? assignment.teamResult : assignment.myResult;
  const seeded = result?.text ?? "";
  const serverStamp = result?.updated_at ?? null;
  const subjectId = isTeam ? enrolment.team?.id ?? null : enrolment.student.id;
  const key = checkIn && subjectId ? draftKey(mode, checkIn.id, subjectId) : null;

  // The box and the last known stored version move together. Every question
  // asked of one ("is this dirty", "did the server change under us") is a
  // question about the pair, and holding them apart made the answer depend on
  // which effect happened to run first.
  const [box, setBox] = useState<{ text: string; saved: string }>({ text: seeded, saved: seeded });
  const { text, saved } = box;
  const setText = (v: string) => setBox((b) => ({ ...b, text: v }));

  // The version this screen is writing over. Local, because after a conflict it
  // is ahead of what the parent last fetched.
  const [expected, setExpected] = useState<string | null>(serverStamp);
  const [restoredAt, setRestoredAt] = useState<string | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  /** The key whose draft restore has finished; see the persist effect below. */
  const restoredFor = useRef<string | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [selected, setSelected] = useState(3); // §4: active row is index 3
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A different assignment (or the other half of this one) is a different piece
  // of work: reset everything, then hand back any draft left on this device.
  //
  // Deliberately not keyed on `seeded` or `key`, both of which move when the
  // parent refetches after a submit — re-running then would throw away a
  // restored draft. The effect below adopts server changes instead.
  useEffect(() => {
    setBox({ text: seeded, saved: seeded });
    setExpected(serverStamp);
    setDone(false);
    setError(null);
    setConflict(null);
    setRestoredAt(null);
    setDraftError(null);
    if (!key) return;
    try {
      const d = loadDraft(key);
      if (!d) return;
      const typedAt = ms(d.at);
      const storedAt = ms(serverStamp);
      // A draft matching the stored answer is spent. One that merely LOOKS
      // older is not deleted: `d.at` is this device's clock and `updated_at`
      // may be another device's or the server's, so a few minutes of skew would
      // otherwise erase typing that was genuinely newer. Leave it on disk and
      // simply prefer the server copy.
      if (d.text === seeded) {
        window.localStorage.removeItem(key);
        return;
      }
      if (typedAt !== null && storedAt !== null && typedAt <= storedAt) return;
      setBox({ text: d.text, saved: seeded });
      setRestoredAt(d.at);
    } catch (e) {
      setDraftError(message(e, "Could not read the draft saved on this device."));
    } finally {
      // The persist effect below runs in this same commit with a closure that
      // still says "not dirty", and would delete the draft we just restored.
      // React also re-runs mount effects under StrictMode, which turned that
      // into "autosave silently eats your work" in development.
      restoredFor.current = key;
    }
  }, [activityId, mode]);

  // The stored answer moved — our own submit landing, or the parent refetching.
  // Adopt it into the box only when there is nothing unsaved in it: a refetch
  // that arrives mid-sentence must not erase what is being typed.
  useEffect(() => {
    setBox((b) => (b.text === b.saved ? { text: seeded, saved: seeded } : { ...b, saved: seeded }));
  }, [seeded]);

  useEffect(() => {
    setExpected(serverStamp);
  }, [serverStamp]);

  const answered = QUESTIONS.filter((q) => q.state === "done").length;
  const dirty = text !== saved;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const submittedAt = stamp(serverStamp);
  const firstEmpty = QUESTIONS.find((q) => q.state === "empty");

  // Keep the draft in step with the box. Debounced so a fast typist is not
  // writing to disk on every keystroke, and removed the moment the text matches
  // what is stored, so nothing stale can be restored later.
  useEffect(() => {
    if (!key || restoredFor.current !== key) return;

    const write = () => {
      const draft: Draft = { text, at: new Date().toISOString() };
      try {
        window.localStorage.setItem(key, JSON.stringify(draft));
        setDraftError(null);
      } catch (e) {
        setDraftError(
          message(e, "Could not save a draft on this device") +
            " — copy your answer somewhere safe before leaving this page.",
        );
      }
    };

    if (!dirty) {
      // A failure to CLEAR is not worth telling a student about — there is
      // nothing they can do with it, and it would paint a red line on an
      // untouched answer box in any browser with storage blocked.
      try {
        window.localStorage.removeItem(key);
      } catch {
        // nothing to do
      }
      return;
    }

    const t = window.setTimeout(write, 400);
    return () => {
      window.clearTimeout(t);
      // Flush on the way out. This screen lives inside the persistent shell, so
      // a sidebar click unmounts it — and beforeunload does not fire on a
      // client-side navigation. Without this, everything typed since the last
      // pause is gone with no prompt, which is the case this feature exists for.
      write();
    };
  }, [key, dirty, text]);

  // The draft survives a reload, but the browser still has to ask: a student
  // who closes the tab expecting their work to be handed in should be stopped.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const unresolved = conflict !== null && conflict.resolved === null;

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
            : unresolved
              ? "Choose which version to keep first."
              : null;

  const stateLine = busy
    ? "Submitting…"
    : unresolved
      ? "Not submitted — a newer version is already saved"
      : done
        ? (isTeam ? "Submitted for the team just now" : "Submitted just now")
        : dirty
          ? restoredAt
            ? `Unsaved draft from ${stamp(restoredAt) ?? "earlier"}, restored on this device · not submitted`
            : "Unsaved draft, kept on this device · not submitted"
          : submittedAt
            ? `Submitted ${submittedAt}`
            : "Draft · not submitted";

  /**
   * One write. `over` is the version being replaced — normally what this screen
   * read, and after a conflict the version the student chose to write over.
   */
  async function write(value: string, over: string | null) {
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      await onSubmit(value, over);
      setBox((b) => ({ ...b, saved: value }));
      setRestoredAt(null);
      setConflict((c) => (c && c.resolved === null ? { ...c, mine: value, resolved: "mine" } : c));
      setDone(true);
    } catch (e) {
      if (isSubmissionConflict(e)) {
        // Not an error the student caused, and not one they can retry their way
        // out of — they have to be shown the other version and asked.
        setConflict({
          theirs: e.current?.text ?? "",
          at: e.current?.updated_at ?? null,
          mine: value,
          resolved: null,
        });
      } else {
        setError(message(e, "Could not submit. Try again."));
      }
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (busy || cannotSubmit) return;
    await write(text, expected);
  }

  /** Replace the stored version with this student's. Theirs stays on screen. */
  async function keepMine() {
    if (!conflict || busy) return;
    setExpected(conflict.at);
    await write(text, conflict.at);
  }

  /** Take the stored version into the box. Theirs is now ours; mine stays on screen. */
  function useTheirs() {
    if (!conflict) return;
    setBox({ text: conflict.theirs, saved: conflict.theirs });
    setExpected(conflict.at);
    setRestoredAt(null);
    setDone(false);
    setConflict({ ...conflict, resolved: "theirs" });
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

            {conflict && (
              <div
                role={conflict.resolved === null ? "alert" : undefined}
                style={{
                  marginTop: 12,
                  border: "1px solid var(--cream-500)",
                  background: "var(--cream-300)",
                  borderRadius: "var(--radius-lg)",
                  padding: 14,
                }}
              >
                <div style={{ fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--navy)" }}>
                  {conflict.resolved === null
                    ? isTeam
                      ? "A newer version was saved while you were writing"
                      : "This was submitted somewhere else while you were writing"
                    : conflict.resolved === "mine"
                      ? isTeam
                        ? "Your version replaced the saved one"
                        : "Your version replaced the other one"
                      : "You kept the other version"}
                </div>

                <p
                  className="sv-sub"
                  style={{ marginTop: 6, lineHeight: 1.6, maxWidth: "62ch" }}
                >
                  {conflict.resolved === null ? (
                    <>
                      Nothing was overwritten. What is stored now
                      {conflict.at ? ` — saved ${stamp(conflict.at) ?? "just now"}` : ""} is below;
                      what you wrote is still in the box above. Choose which one the{" "}
                      {isTeam ? "team" : "answer"} should end up with, or copy anything you need
                      from one into the other first.
                    </>
                  ) : (
                    <>
                      Both versions stay on this screen until you leave it, so you can still copy
                      anything you need out of the one you did not keep.
                    </>
                  )}
                </p>

                <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
                  <div>
                    <span className="sv-eyebrow">
                      {conflict.resolved === "theirs" ? "Yours, not submitted" : "Yours"}
                    </span>
                    <div
                      style={{
                        marginTop: 4,
                        padding: "10px 12px",
                        border: "1px solid var(--neutral-200)",
                        borderRadius: "var(--radius-md)",
                        background: "var(--cream-100)",
                        fontSize: "var(--text-sm)",
                        lineHeight: 1.6,
                        whiteSpace: "pre-wrap",
                        color: "var(--navy)",
                        maxHeight: 180,
                        overflow: "auto",
                      }}
                    >
                      {conflict.mine.trim() || "(you had written nothing)"}
                    </div>
                  </div>

                  <div>
                    <span className="sv-eyebrow">
                      {conflict.resolved === "mine" ? "Replaced" : "Saved version"}
                      {conflict.at ? ` · ${stamp(conflict.at) ?? ""}` : ""}
                    </span>
                    <div
                      style={{
                        marginTop: 4,
                        padding: "10px 12px",
                        border: "1px solid var(--neutral-200)",
                        borderRadius: "var(--radius-md)",
                        background: "var(--cream-100)",
                        fontSize: "var(--text-sm)",
                        lineHeight: 1.6,
                        whiteSpace: "pre-wrap",
                        color: "var(--navy)",
                        maxHeight: 180,
                        overflow: "auto",
                      }}
                    >
                      {conflict.theirs.trim() ||
                        (conflict.at
                          ? "(the saved version is empty)"
                          : "(the submission was removed — submitting will create it again)")}
                    </div>
                  </div>
                </div>

                {conflict.resolved === null && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      flexWrap: "wrap",
                      marginTop: 12,
                    }}
                  >
                    <button
                      type="button"
                      className="sv-btn primary sm"
                      onClick={() => void keepMine()}
                      disabled={busy || !text.trim()}
                      title={
                        !text.trim()
                          ? "Write your answer before submitting."
                          : isTeam
                            ? "Submit your version over the saved one. It stays on screen so you can still copy from it."
                            : "Submit your version over the saved one."
                      }
                    >
                      Keep mine
                    </button>
                    <button
                      type="button"
                      className="sv-btn outline sm"
                      onClick={useTheirs}
                      disabled={busy}
                      title="Put the saved version in the box. Yours stays on screen so you can still copy from it."
                    >
                      Use theirs
                    </button>
                    <span className="sv-sub" style={{ minWidth: 0 }}>
                      Keeping yours replaces the saved version.
                    </span>
                  </div>
                )}
              </div>
            )}

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

            {draftError && (
              <div
                role="alert"
                style={{
                  marginTop: 8,
                  fontSize: "var(--text-xs)",
                  color: "var(--amber-700)",
                  lineHeight: 1.5,
                }}
              >
                {draftError}
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
