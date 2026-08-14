"use client";

// Clearing a finished course's uploaded media.
//
// The most destructive control in this app, and the only one that is not about
// a single thing you are looking at: it takes a year of recordings, handed-in
// PDFs and team photos, permanently, and leaves the course itself standing.
// Everything on this screen exists so the person pressing it knows which of
// those two halves is which — the numbers are real, the list of what survives
// is specific, and the confirmation is the course typed out by hand.
//
// It lives at the bottom of Activities because there is no course settings
// screen in this app and Activities is the course: the weeks, the year, the
// gradebook. This sits under the last week, and only once the last week is
// months behind — a control this destructive should not be on screen in
// October.
//
// The counting, the ordering and the resumability all belong to
// src/checkins/purge.ts. Nothing here counts anything of its own, so what the
// dialog promises and what the sweep does cannot drift apart.
//
// These bytes have no backup. Supabase's nightly backup covers Postgres and
// explicitly not storage objects, so once this runs the only copy of a
// recording is one somebody pulled out of the bucket themselves. The manifest
// from exportTerm.ts is what is left: the record of what existed, who handed it
// in and where it sat. Taking it is a step, not a suggestion — the confirmation
// does not unlock until the file has been downloaded.

import type { ResultRow } from "@/checkins/data";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  clearCourseArtifacts,
  previewCourseArtifacts,
  type BucketArtifacts,
  type ClearBucket,
  type ClearOutcome,
  type ClearProgress,
  type CourseArtifacts,
} from "@/checkins/purge";
import type {
  Activity,
  ActivityQuestion,
  CheckIn,
  Course,
  Student,
  TeamWithMembers,
} from "@/checkins/types";
import { downloadCsv, gradesCsv, listArtifacts, manifestCsv, safeFilename } from "./exportTerm";
import { FIcon } from "./icons";

/** Everything inside the dialog that can hold focus, in tab order. */
const FOCUSABLE =
  "button:not(:disabled), [href], input, select, textarea, [tabindex]:not([tabindex='-1'])";

const DAY = 24 * 60 * 60 * 1000;

/**
 * How quiet a course has to be before this is offered at all.
 *
 * Two months since the last deadline and since anyone last handed anything in
 * or marked it. A course in session has work moving through it every week, so
 * this cannot surface while one is running, and it still arrives in time for
 * the summer, which is when a year's media actually gets cleared. Deliberately
 * derived rather than asked for: an end date typed into a field in September is
 * a promise the app would then have to keep, and this feature must never act on
 * its own.
 */
const QUIET_DAYS = 60;

/**
 * The same gate for a course that carries no dates at all.
 *
 * Longer than an academic year, deliberately. The only thing left to measure
 * then is created_at, which is when the instructor AUTHORED the week — set a
 * term up over the summer and sixty days from that lands in October with the
 * class running. Nothing sits untouched for thirteen months by accident.
 */
const UNDATED_QUIET_DAYS = 400;

/**
 * The newest deadline on this course, across every column that holds one.
 *
 * All three, because due_at (0007) is written in exactly one place — the date
 * field on the activity screen — and createActivity never sets it, so an
 * instructor who never opens that field has nothing but the older per-scope
 * columns that ActivityDetail and the student's Assignments list still read as
 * fallbacks. Taking due_at alone made null the normal case and quietly turned
 * this into a measure of when rows were made.
 *
 * opens_at is deliberately not read — an activity that is simply switched off
 * carries HIDDEN_INSTANT, which is the year 9999 and would hold every course
 * open forever.
 */
function lastDueAt(activities: Activity[]): number | null {
  let latest: number | null = null;
  for (const a of activities) {
    for (const iso of [a.due_at, a.individual_due_at, a.team_due_at]) {
      if (!iso) continue;
      const at = Date.parse(iso);
      if (Number.isNaN(at)) continue;
      if (latest == null || at > latest) latest = at;
    }
  }
  return latest;
}

/**
 * The last time a person did something on this course.
 *
 * The strongest signal there is, and better than any deadline: a due date is a
 * plan, this is what happened. submitted_at is a student handing work in, and
 * updated_at is bumped by grading too — so the newest of the two across the
 * course is the last time anyone submitted or marked anything, which is what
 * "nobody is using this course any more" actually means.
 */
function lastWorkAt(results: ResultRow[]): number | null {
  let latest: number | null = null;
  for (const r of results) {
    for (const iso of [r.submitted_at, r.updated_at]) {
      if (!iso) continue;
      const at = Date.parse(iso);
      if (Number.isNaN(at)) continue;
      if (latest == null || at > latest) latest = at;
    }
  }
  return latest;
}

/** When the last week was added — the last resort, on the long window. */
function lastCreatedAt(activities: Activity[]): number | null {
  let latest: number | null = null;
  for (const a of activities) {
    const at = Date.parse(a.created_at);
    if (Number.isNaN(at)) continue;
    if (latest == null || at > latest) latest = at;
  }
  return latest;
}

interface Quiet {
  at: number;
  days: number;
  /** Whether `at` is something that happened, or only when a row was made. */
  dated: boolean;
}

/**
 * When this course went quiet, and how long quiet has to be to count.
 *
 * Work and deadlines together, newest wins: a course last graded in June and
 * last due in May went quiet in June, and taking the newer of the two means
 * neither signal can drag the date backwards. Only when there is neither does
 * this fall back to when the rows were made, and then on the long window.
 */
function quietSince(activities: Activity[], results: ResultRow[] | undefined): Quiet | null {
  const worked = results ? lastWorkAt(results) : null;
  const due = lastDueAt(activities);
  if (worked != null || due != null) {
    return { at: Math.max(worked ?? 0, due ?? 0), days: QUIET_DAYS, dated: true };
  }
  const made = lastCreatedAt(activities);
  return made == null ? null : { at: made, days: UNDATED_QUIET_DAYS, dated: false };
}

function fmtDay(at: number | string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
}

const n = (x: number): string => x.toLocaleString();

/** Bytes -> "4.2 GB". Only the photos ever have a number to render. */
function human(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb < 1) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (mb < 1024) return `${Math.round(mb)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

/**
 * What a bucket can honestly say about its size.
 *
 * Only team photos record one. Recordings store a duration and submissions a
 * page count, and neither converts to bytes — so those two say so rather than
 * printing a guessed average, which is the last thing this dialog should do.
 */
function sizeNote(b: BucketArtifacts): string {
  if (b.objects === 0) return "none left";
  if (b.bytes == null || (b.bytes === 0 && b.unsized === b.objects)) {
    return "size isn't recorded for these";
  }
  if (b.unsized === 0) return human(b.bytes);
  return `${human(b.bytes)}, plus ${n(b.unsized)} whose size was never recorded`;
}

const BUCKET_LABEL: Record<ClearBucket, string> = {
  recordings: "recordings",
  submissions: "handed-in PDFs",
  resources: "team photos",
};

const BUCKET_ORDER: ClearBucket[] = ["recordings", "submissions", "resources"];

function progressLine(p: ClearProgress): string {
  const what = BUCKET_LABEL[p.bucket];
  if (p.step === "scan") return `Finding the ${what}…`;
  if (p.step === "objects") return `Deleting ${what} — ${n(p.done)} of ${n(p.total)}`;
  return `Clearing the ${what} out of the database — ${n(p.done)} of ${n(p.total)}`;
}

type Phase = "counting" | "ready" | "running" | "done";

interface Problem {
  text: string;
  /**
   * Whether this failed before anything was touched or part-way through it.
   * The way out is counting either way; this is what the screen says about it.
   */
  retry: "count" | "clear";
}

const say = (e: unknown): string => String((e as Error)?.message ?? e);

export function ClearArtifacts({
  course,
  activities,
  /** Only the owner may do this — every delete policy involved authorises them. */
  canClear,
  onCleared,
  roster = [],
  teams = [],
  checkIns,
  results,
  questions,
}: {
  course: Course;
  activities: Activity[];
  canClear: boolean;
  /** Refresh: the course row now carries the date it was cleared on. */
  onCleared: () => void;
  /**
   * The rest of the course, for the two files that come off this screen and for
   * knowing when it really went quiet. Optional so the call site can be wired
   * separately, and each one degrades on its own terms: without the roster and
   * the teams the manifest still lists every object but cannot name whose it
   * was, without results the quiet gate falls back to deadlines, and without
   * check-ins, results and questions the gradebook is not offered at all.
   */
  roster?: Student[];
  teams?: TeamWithMembers[];
  checkIns?: CheckIn[];
  results?: ResultRow[];
  questions?: ActivityQuestion[];
}): JSX.Element | null {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("counting");
  const [found, setFound] = useState<CourseArtifacts | null>(null);
  const [progress, setProgress] = useState<ClearProgress | null>(null);
  const [outcome, setOutcome] = useState<ClearOutcome | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [typed, setTyped] = useState("");
  const [manifest, setManifest] = useState<{ rows: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveProblem, setSaveProblem] = useState<string | null>(null);

  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const panel = useRef<HTMLDivElement | null>(null);
  const confirmBox = useRef<HTMLInputElement | null>(null);

  // Activities is not remounted when the sidebar switches courses, so without
  // this a dialog left open would go on showing one session's counts above a
  // button that now clears the other one.
  useEffect(() => {
    setOpen(false);
    setFound(null);
    setProblem(null);
    setProgress(null);
    setOutcome(null);
    setTyped("");
    // The manifest names one course's files, so it is no evidence at all about
    // the other one.
    setManifest(null);
    setSaveProblem(null);
  }, [course.id]);

  const count = useCallback(async () => {
    setPhase("counting");
    setProblem(null);
    try {
      const artifacts = await previewCourseArtifacts(course.id);
      if (!live.current) return;
      setFound(artifacts);
      setPhase("ready");
    } catch (e) {
      if (!live.current) return;
      // No numbers means no button. Everything below reads `found`, so leaving
      // it null is what keeps the confirmation unpressable — a dialog that
      // could not count must not offer to delete.
      setFound(null);
      setProblem({ text: say(e), retry: "count" });
    }
  }, [course.id]);

  const start = useCallback(async () => {
    setPhase("running");
    setProblem(null);
    setProgress(null);
    try {
      const done = await clearCourseArtifacts(course.id, (p) => {
        if (live.current) setProgress(p);
      });
      if (!live.current) return;
      setOutcome(done);
      setPhase("done");
    } catch (e) {
      if (!live.current) return;
      // Out of "running" whatever happened, or Cancel stays disabled and the
      // person is trapped in a dialog that has already stopped.
      setPhase("ready");
      // The counts on screen are stale the moment this throws — some of what
      // they described is already gone. The failure replaces them rather than
      // sitting under numbers that are no longer true.
      setFound(null);
      setProblem({ text: say(e), retry: "clear" });
    }
  }, [course.id]);

  const named = (what: string) =>
    `${safeFilename(course.code?.trim() || course.name, course.term, what)}.csv`;

  // Built here rather than from `found`: the counts are three numbers, and this
  // is the row-by-row record — the only thing that will still be able to answer
  // "what was on this course" once the objects are gone.
  const takeManifest = async () => {
    setSaving(true);
    setSaveProblem(null);
    try {
      const rows = await listArtifacts(course.id, roster, teams);
      if (!live.current) return;
      downloadCsv(named("artifacts-manifest"), manifestCsv(rows));
      setManifest({ rows: rows.length });
    } catch (e) {
      if (live.current) setSaveProblem(say(e));
    } finally {
      if (live.current) setSaving(false);
    }
  };

  const gradable = checkIns != null && results != null && questions != null && roster.length > 0;
  const takeGrades = () => {
    if (!checkIns || !results || !questions) return;
    setSaveProblem(null);
    try {
      downloadCsv(
        named("grades"),
        gradesCsv({ course, students: roster, activities, checkIns, results, questions }),
      );
    } catch (e) {
      setSaveProblem(say(e));
    }
  };

  // Focus lands in the box you have to type in. Enter is deliberately not wired
  // to the confirm button anywhere in here, so focusing it cannot turn a stray
  // keypress into a year of deleted work.
  useEffect(() => {
    if (open && phase === "ready" && !problem) confirmBox.current?.focus();
  }, [open, phase, problem]);

  // Closing the tab mid-sweep is survivable — the run resumes — but it is still
  // not what anyone means to do, so the browser asks.
  useEffect(() => {
    if (phase !== "running") return;
    const hold = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", hold);
    return () => window.removeEventListener("beforeunload", hold);
  }, [phase]);

  // Read below, not returned on: the banner is what this becomes once the run
  // is over AND the dialog has been dismissed. Returning it the moment `outcome`
  // lands is what made the Finished summary unreachable — setPhase("done")
  // re-rendered straight into the banner, taking the dialog and the Done button
  // with it, so close() never ran and onCleared() never fired.
  const clearedAt = outcome?.clearedAt ?? course.artifacts_cleared_at ?? null;

  const openDialog = () => {
    setOpen(true);
    setTyped("");
    setOutcome(null);
    void count();
  };

  const close = () => {
    if (phase === "running") return;
    setOpen(false);
    setProblem(null);
    setProgress(null);
    if (phase === "done") onCleared();
  };

  // Said once the course is cleared, to anyone who can see the course — a TF
  // grading it needs this sentence as much as the instructor does, because the
  // grading screen will say "No PDF" against work that was really handed in.
  if (clearedAt && !open) {
    return (
      <div
        style={{
          display: "flex",
          gap: 10,
          alignItems: "flex-start",
          marginTop: 20,
          padding: "11px 13px",
          border: "1px solid var(--fv-neutral-200)",
          borderRadius: "var(--fv-r-lg)",
          background: "var(--fv-cream-100)",
          fontSize: "var(--fv-xs)",
          color: "var(--fv-muted)",
          lineHeight: 1.6,
        }}
      >
        <span style={{ color: "var(--fv-emerald)", display: "flex", flex: "none", marginTop: 1 }}>
          <FIcon name="check" size={15} />
        </span>
        <span>
          Uploaded media was cleared on {fmtDay(clearedAt)}. The recordings, the handed-in PDFs
          and the team photos are gone — everything else on this page is the record of the year
          and is still here: the grades, the marks, what students wrote, your feedback, the
          roster, the teams, and every activity with its questions and rubric.
        </span>
      </div>
    );
  }

  if (!canClear) return null;

  // ?? catches null and not "", so a course whose code is the empty string made
  // the expected string "" — which an untouched input already matches, arming
  // the danger button under a label reading "Type  to confirm". An empty string
  // is not something you can ask anyone to type deliberately, so fall through to
  // the name, and if there is nothing to type either, do not offer this at all.
  const expected = course.code?.trim() || course.name.trim();
  if (!expected) return null;

  const quiet = quietSince(activities, results);
  const since = quiet && Date.now() - quiet.at >= quiet.days * DAY ? quiet : null;
  // The gates decide whether to OFFER this. A dialog that is already up is past
  // that question, and taking it off the screen mid-run would answer it wrong.
  if (!since && !open) return null;

  // Case-insensitive on purpose: typing the course out is the deliberation, and
  // holding shift is not the part that makes it deliberate.
  const matches = typed.trim().toLowerCase() === expected.toLowerCase();
  const empty =
    found != null &&
    found.recordings.objects + found.submissions.objects + found.resources.objects === 0 &&
    found.submissionPages === 0;
  // Nothing to destroy means nothing for a manifest to record, and requiring a
  // file that would list nothing is ceremony. Everywhere else it is the gate.
  const needManifest = found != null && !empty && manifest == null;
  const canPress = phase === "ready" && !problem && found != null && matches && !needManifest;

  return (
    <>
      {since ? (
        <div
          className="fv-card"
          style={{
            display: "flex",
            gap: 14,
            alignItems: "flex-start",
            flexWrap: "wrap",
            marginTop: 20,
            padding: "14px 16px",
          }}
        >
          <div style={{ flex: 1, minWidth: 300 }}>
            <div className="fv-eyebrow">The year looks finished</div>
            <p
              style={{
                margin: "6px 0 0",
                fontSize: "var(--fv-xs)",
                color: "var(--fv-muted)",
                lineHeight: 1.6,
                maxWidth: "72ch",
              }}
            >
              {since.dated
                ? `Nothing has been due, handed in or marked on this course since ${fmtDay(since.at)}.`
                : `Nothing on this course carries a date, and the last week on it was added ${fmtDay(since.at)}.`}{" "}
              When you are done with it you can clear what was uploaded — the recordings, the
              handed-in PDFs and the team photos. The grades stay, and so does everything students
              wrote and every document you gave them.
            </p>
          </div>
          <button
            type="button"
            className="fv-btn outline sm"
            style={{ flex: "none" }}
            onClick={openDialog}
          >
            Review what would be cleared
          </button>
        </div>
      ) : null}

      {open ? (
        <div
          className="fv-overlay"
          role="presentation"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              close();
              return;
            }
            if (e.key !== "Tab") return;
            // Keep Tab inside the dialog; behind it is a whole course of
            // controls that are not answering this question.
            const items = Array.from(panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
            if (items.length === 0) return;
            const first = items[0];
            const last = items[items.length - 1];
            const active = document.activeElement;
            if (e.shiftKey && active === first) {
              e.preventDefault();
              last.focus();
            } else if (!e.shiftKey && active === last) {
              e.preventDefault();
              first.focus();
            }
          }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div
            className="fv-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="fv-clear-title"
            style={{ maxWidth: 560 }}
            ref={panel}
          >
            <h2 className="fv-dialogtitle" id="fv-clear-title">
              {phase === "done" ? "Cleared" : `Clear the uploaded media on ${expected}?`}
            </h2>

            <div className="fv-dialogbody">
              {problem ? (
                <Failed problem={problem} />
              ) : phase === "counting" ? (
                <p style={{ margin: 0 }}>Counting what is on this course…</p>
              ) : phase === "running" ? (
                <Running progress={progress} />
              ) : phase === "done" && outcome ? (
                <Finished outcome={outcome} />
              ) : found ? (
                <Ready
                  found={found}
                  empty={empty}
                  expected={expected}
                  typed={typed}
                  onType={setTyped}
                  boxRef={confirmBox}
                  exports={
                    <Exports
                      required={!empty}
                      taken={manifest?.rows ?? null}
                      saving={saving}
                      problem={saveProblem}
                      onManifest={() => void takeManifest()}
                      onGrades={gradable ? takeGrades : null}
                    />
                  }
                />
              ) : null}
            </div>

            <div className="fv-dialogbtns">
              <button
                type="button"
                className="fv-btn ghost sm"
                disabled={phase === "running"}
                onClick={close}
              >
                {phase === "done" ? "Done" : "Cancel"}
              </button>

              {phase === "done" ? null : problem ? (
                // Both ways out count first, including the one after a failed
                // sweep: that failure wiped the numbers off the screen, and the
                // second press must not be the one made with less in front of
                // you than the first. Counting comes back to the gated button
                // with the typed confirmation still standing.
                <button type="button" className="fv-btn outline sm" onClick={() => void count()}>
                  {problem.retry === "clear" ? "Count what is left" : "Count again"}
                </button>
              ) : (
                <button
                  type="button"
                  className="fv-btn danger sm"
                  disabled={!canPress}
                  title={
                    canPress
                      ? undefined
                      : phase === "running"
                        ? "Working through it"
                        : needManifest
                          ? "Download the manifest first"
                          : `Type ${expected} to confirm`
                  }
                  onClick={() => void start()}
                >
                  {phase === "running" ? "Clearing…" : "Clear the uploaded media"}
                </button>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

/** One bucket's line in the list of what goes. */
function Goes({ what, files, note }: { what: string; files: string; note: string }) {
  return (
    <div
      style={{
        display: "flex",
        gap: 12,
        alignItems: "baseline",
        padding: "7px 0",
        borderTop: "1px solid var(--fv-neutral-200)",
      }}
    >
      <span style={{ flex: 1, minWidth: 0 }}>
        <span
          style={{
            display: "block",
            fontSize: "var(--fv-xs)",
            fontWeight: 600,
            color: "var(--fv-navy)",
          }}
        >
          {what}
        </span>
        <span style={{ display: "block", fontSize: "var(--fv-2xs)" }}>{note}</span>
      </span>
      <span
        className="fv-num"
        style={{ flex: "none", fontSize: "var(--fv-sm)", color: "var(--fv-navy)" }}
      >
        {files}
      </span>
    </div>
  );
}

function Ready({
  found,
  empty,
  expected,
  typed,
  onType,
  boxRef,
  exports,
}: {
  found: CourseArtifacts;
  /** Decided by the caller, which gates the button on the same answer. */
  empty: boolean;
  expected: string;
  typed: string;
  onType: (v: string) => void;
  boxRef: React.RefObject<HTMLInputElement>;
  /** The two files to take first. Sits above the box, because it comes first. */
  exports: JSX.Element;
}) {
  const files = found.recordings.objects + found.submissions.objects + found.resources.objects;

  return (
    <>
      <p style={{ margin: 0 }}>
        {empty
          ? "There is nothing uploaded left on this course. Clearing now only writes the date, so this stops being offered."
          : "These are counted the same way they will be deleted, not estimated. They go from storage and from the database, permanently, and there is no undo in this app."}
      </p>

      {empty ? null : (
        <div style={{ marginTop: 12 }}>
          <Goes
            what="Recordings"
            files={n(found.recordings.objects)}
            note={sizeNote(found.recordings)}
          />
          <Goes
            what="Handed-in PDFs"
            files={n(found.submissions.objects)}
            note={sizeNote(found.submissions)}
          />
          <Goes
            what="Team photos"
            files={n(found.resources.objects)}
            note={sizeNote(found.resources)}
          />
          <Goes
            what="Which page answers which question"
            files={n(found.submissionPages)}
            note="rows, not files — they point into PDFs that are about to go"
          />
          <div
            style={{
              display: "flex",
              gap: 12,
              alignItems: "baseline",
              padding: "8px 0 0",
              borderTop: "1px solid var(--fv-neutral-300)",
              color: "var(--fv-navy)",
              fontWeight: 600,
              fontSize: "var(--fv-xs)",
            }}
          >
            <span style={{ flex: 1 }}>Files in total</span>
            <span className="fv-num" style={{ fontSize: "var(--fv-sm)" }}>
              {n(files)}
            </span>
          </div>
          <p style={{ marginTop: 8, marginBottom: 0, fontSize: "var(--fv-2xs)" }}>
            Only the photos carry a size in the database, so the recordings and the PDFs are
            counted rather than measured. A total in gigabytes here would be a guess.
          </p>
        </div>
      )}

      <div
        style={{
          marginTop: 14,
          padding: "10px 12px",
          border: "1px solid var(--fv-neutral-200)",
          borderRadius: "var(--fv-r-md)",
          background: "var(--fv-cream-300)",
        }}
      >
        <div className="fv-eyebrow">What stays</div>
        <ul style={{ margin: "7px 0 0", paddingLeft: 17, lineHeight: 1.6 }}>
          <li>Every grade and every mark, exactly as they stand.</li>
          <li>Every answer a student typed, and every word of feedback you wrote back.</li>
          <li>The roster, the teams and the team sets.</li>
          <li>Every activity, with its questions and its rubric.</li>
          <li>
            Your assignment documents. Those are yours, they are tiny, and next year starts from
            them — nothing here touches them.
          </li>
        </ul>
      </div>

      {exports}

      <label style={{ display: "block", marginTop: 14 }}>
        <span style={{ display: "block", marginBottom: 6 }}>
          Type <strong style={{ color: "var(--fv-navy)" }}>{expected}</strong> to confirm you mean
          this course.
        </span>
        <input
          className="fv-in"
          ref={boxRef}
          style={{ color: "var(--fv-navy)" }}
          value={typed}
          spellCheck={false}
          autoComplete="off"
          aria-label={`Type ${expected} to confirm`}
          placeholder={expected}
          onChange={(e) => onType(e.target.value)}
        />
      </label>
    </>
  );
}

/**
 * The record, taken before the thing it records is destroyed.
 *
 * A required step and not a suggestion, because there is no other copy: the
 * database has a nightly backup and the storage buckets have none, so after
 * this run the manifest is the whole of what is left about what was here.
 */
function Exports({
  required,
  taken,
  saving,
  problem,
  onManifest,
  onGrades,
}: {
  required: boolean;
  /** Rows in the manifest that was downloaded, or null if it has not been. */
  taken: number | null;
  saving: boolean;
  problem: string | null;
  onManifest: () => void;
  /** Null when the call site has not passed the gradebook data through. */
  onGrades: (() => void) | null;
}) {
  return (
    <div
      style={{
        marginTop: 14,
        padding: "10px 12px",
        border: "1px solid var(--fv-neutral-300)",
        borderRadius: "var(--fv-r-md)",
        background: "var(--fv-cream-100)",
      }}
    >
      <div className="fv-eyebrow">Take the record first</div>
      <p style={{ margin: "7px 0 0", lineHeight: 1.6 }}>
        The manifest is one row per uploaded file: who it came from, which activity it belongs to,
        when it arrived, its size where the database holds one, and where it sits in storage. It is
        the record of what was here — it is not the files. Nothing on this screen downloads a
        recording, a PDF or a photo, and the nightly backup does not hold them either: that backup
        covers the database, and storage objects are not in it. After this runs the files are gone
        for good unless they were pulled out of the buckets separately
        (docs/backup-runbook.md).
      </p>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
        <button type="button" className="fv-btn outline sm" disabled={saving} onClick={onManifest}>
          {saving
            ? "Listing every file…"
            : taken != null
              ? "Download the manifest again"
              : "Download the manifest"}
        </button>
        {onGrades ? (
          <button type="button" className="fv-btn ghost sm" onClick={onGrades}>
            Download the grades
          </button>
        ) : null}
      </div>

      {taken != null ? (
        <div style={{ display: "flex", gap: 7, alignItems: "flex-start", marginTop: 9 }}>
          <span style={{ color: "var(--fv-emerald)", display: "flex", flex: "none", marginTop: 1 }}>
            <FIcon name="check" size={14} />
          </span>
          <span>
            Manifest saved — {n(taken)} files listed. Once this runs it is the only record of them.
          </span>
        </div>
      ) : (
        <p style={{ marginTop: 9, marginBottom: 0 }}>
          {required
            ? "The confirmation below stays locked until you have taken it."
            : "There are no files left to list, so there is nothing for a manifest to record."}
        </p>
      )}

      {problem ? (
        <p style={{ marginTop: 9, marginBottom: 0, color: "var(--fv-destructive)" }}>{problem}</p>
      ) : null}
    </div>
  );
}

function Running({ progress }: { progress: ClearProgress | null }) {
  const at = progress ? BUCKET_ORDER.indexOf(progress.bucket) : 0;
  const pct =
    progress && progress.total > 0
      ? `${Math.min(100, Math.round((progress.done / progress.total) * 100))}%`
      : "0%";

  return (
    <>
      <p style={{ margin: 0 }}>
        Working through it a hundred files at a time. On a full year this takes a few minutes.
      </p>

      <div style={{ marginTop: 12 }} role="status" aria-live="polite">
        <div className="fv-track">
          <i style={{ width: pct, background: "var(--fv-navy-700)" }} />
        </div>
        <div className="fv-progcap">
          {progress ? progressLine(progress) : "Starting…"}
        </div>
      </div>

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 12 }}>
        {BUCKET_ORDER.map((b, i) => (
          <span
            key={b}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              fontSize: "var(--fv-2xs)",
              color: i <= at ? "var(--fv-navy)" : "var(--fv-neutral-400)",
            }}
          >
            <span
              className="fv-dot"
              style={{
                background:
                  i < at
                    ? "var(--fv-emerald)"
                    : i === at
                      ? "var(--fv-navy-700)"
                      : "var(--fv-neutral-300)",
              }}
              aria-hidden="true"
            />
            {BUCKET_LABEL[b]}
          </span>
        ))}
      </div>

      <p style={{ marginTop: 12, marginBottom: 0 }}>
        Leave this tab open. If it stops anyway — you close it, the connection drops — nothing is
        left half-deleted in a way you have to repair: what has gone is gone and the rest is
        untouched, so opening this again finishes the job. It starts each set of files from the
        beginning rather than from the one it stopped on, though, so a second run late in a big
        course can take about as long as the first.
      </p>
    </>
  );
}

function Finished({ outcome }: { outcome: ClearOutcome }) {
  return (
    <>
      <p style={{ margin: 0 }}>
        This run removed {n(outcome.recordings)} recordings, {n(outcome.submissions)} handed-in
        PDFs, {n(outcome.resources)} team photos and {n(outcome.submissionPages)} page mappings.
      </p>
      <p style={{ marginTop: 10, marginBottom: 0 }}>
        Every grade, every mark, every written answer and every rubric is still here, and the
        course is marked cleared as of {fmtDay(outcome.clearedAt)}.
      </p>
    </>
  );
}

function Failed({ problem }: { problem: Problem }) {
  return (
    <>
      <p style={{ margin: 0, color: "var(--fv-destructive)" }}>{problem.text}</p>
      <p style={{ marginTop: 10, marginBottom: 0 }}>
        {problem.retry === "count"
          ? "Nothing has been touched — this was only the count. Try again, and if it keeps failing your sign-in may have lapsed: reload the page."
          : "It stopped part-way. What was deleted is gone, the rest is exactly where it was, and nothing is half-deleted, so running it again is safe. It does not resume at the file it stopped on: it walks each set from the start and re-sends the deletes for files that have already gone. That is harmless, but on a slow connection near the end of a large course the second run can take as long as the first. Count what is left first — the numbers on screen were true before this failed, not after."}
      </p>
    </>
  );
}
