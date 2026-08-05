"use client";

// Grading, Gradescope-style: one question of one submission at a time, marked
// by picking a line off the activity's deduction ladder.
//
// The rule that shapes everything here: a mark IS the picked ladder row, not the
// points that row happens to carry. Two rows may deduct the same amount, and
// storing the value would make them indistinguishable — and a newly added line
// unselectable. The score is never written from this screen either; a trigger
// recomputes it from the marks (migration 0007), so there is one writer and the
// number can't drift from what produced it.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  IS_COMPLETION,
  SCOPE_OF,
  type Activity,
  type ActivityQuestion,
  type CheckInResult,
  type RubricItem,
} from "@/checkins/types";
import {
  addRubricItem,
  clearMark,
  ensureRubric,
  listMarks,
  releaseMark,
  setFeedback,
  setMark,
  updateRubricItem,
} from "./facultyData";
import { pointsTotal, questionsFor } from "./model";
import type { FacultyData } from "./FacultyApp";
import { FAvatar, FIcon } from "./icons";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function stamp(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const h = d.getHours();
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${DAYS[d.getDay()]} ${h12}:${String(d.getMinutes()).padStart(2, "0")}${h < 12 ? "am" : "pm"}`;
}

const pts = (n: number) => `${n} ${n === 1 ? "pt" : "pts"}`;

/** One person or team to be graded, with the result row that holds their work. */
interface Subject {
  id: string;
  name: string;
  tint: string | null;
  result: CheckInResult;
}

export function GradingScreen({
  data,
  activity,
  onBack,
  onChanged,
  onError,
}: {
  data: FacultyData;
  activity: Activity;
  onBack: () => void;
  onChanged: () => void;
  onError: (e: unknown) => void;
}) {
  const scope = SCOPE_OF[activity.type];
  const stat = data.stats.get(activity.id);
  /** Which question is being marked — its POSITION, which is what a mark records. */
  const [qIdx, setQIdx] = useState(0);
  // Questions are rows (0013), in the order the rubric puts them. An activity
  // that has none yet still grades the old way — N questions of equal value —
  // so this synthesises that shape rather than showing a grader nothing.
  const questions = useMemo(() => {
    const rows = questionsFor(activity.id, data.questions);
    if (rows.length) return rows;
    return Array.from({ length: Math.max(activity.question_count, 1) }, (_, i) => ({
      id: `synthetic-${i}`,
      activity_id: activity.id,
      label: String(i + 1),
      position: i,
      created_at: "",
    })) as ActivityQuestion[];
  }, [activity.id, activity.question_count, data.questions]);

  const qCount = questions.length;
  const question = questions[Math.min(qIdx, qCount - 1)] ?? questions[0];

  const [ladder, setLadder] = useState<RubricItem[] | null>(null);
  // resultId -> questionIndex -> rubric_item_id
  const [marks, setMarks] = useState<Map<string, Map<number, string>>>(new Map());
  const [stIdx, setStIdx] = useState(0);
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [releasing, setReleasing] = useState(false);

  // A `both`-scope activity has TWO halves to mark, and picking "individual"
  // unconditionally meant the team half of every Challenge could never be
  // graded at all — the gradebook showed those tRATs as handed in and there was
  // no screen that would mark them.
  const [half, setHalf] = useState<"individual" | "team">(
    scope === "team" ? "team" : "individual",
  );
  useEffect(() => {
    setHalf(scope === "team" ? "team" : "individual");
  }, [scope]);

  // Scope decides who is graded: a team activity is marked once per team.
  const subjects: Subject[] = useMemo(() => {
    const kind = scope === "both" ? half : scope === "team" ? "team" : "individual";
    const checkIn = data.checkIns.find((c) => c.activity_id === activity.id && c.kind === kind);
    if (!checkIn) return [];

    const handedIn = (r: CheckInResult) =>
      r.status === "submitted" || r.status === "needs_review" || r.status === "scored";

    const rows = data.results.filter((r) => r.check_in_id === checkIn.id && handedIn(r));
    const out: Subject[] = [];
    if (kind === "team") {
      for (const t of data.teams) {
        const r = rows.find((x) => x.team_id === t.id);
        if (r) out.push({ id: t.id, name: t.name, tint: null, result: r });
      }
    } else {
      for (const s of data.roster) {
        const r = rows.find((x) => x.student_id === s.id);
        if (r) out.push({ id: s.id, name: s.name, tint: s.avatar_tint, result: r });
      }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }, [activity.id, data.checkIns, data.results, data.roster, data.teams, scope, half]);

  const subject = subjects[stIdx] ?? null;

  // Clamp when the roster or the submitted set changes under us.
  useEffect(() => {
    setStIdx((i) => Math.min(i, Math.max(subjects.length - 1, 0)));
  }, [subjects.length]);
  useEffect(() => {
    setQIdx((i) => Math.min(i, qCount - 1));
  }, [qCount]);

  useEffect(() => {
    let live = true;
    ensureRubric(activity, data.can.author)
      .then((rows) => live && setLadder(rows))
      .catch(onError);
    return () => {
      live = false;
    };
    // The ladder belongs to the activity; re-fetching on every prop change would
    // fight the inline editing below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activity.id, data.can.author]);

  const loadMarks = useCallback(async () => {
    const ids = subjects.map((s) => s.result.id);
    if (!ids.length) return;
    const rows = await listMarks(ids);
    const next = new Map<string, Map<number, string>>();
    for (const m of rows) {
      const inner = next.get(m.result_id) ?? new Map<number, string>();
      inner.set(m.question_index, m.rubric_item_id);
      next.set(m.result_id, inner);
    }
    setMarks(next);
  }, [subjects]);

  useEffect(() => {
    loadMarks().catch(onError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadMarks]);

  useEffect(() => {
    setNote(subject?.result.feedback ?? "");
  }, [subject?.result.id, subject?.result.feedback]);

  // Left/right steps questions, but not while someone is typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      const typing =
        el instanceof HTMLElement &&
        (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if (typing) return;
      if (e.key === "ArrowLeft") setQIdx((i) => Math.max(0, i - 1));
      if (e.key === "ArrowRight") setQIdx((i) => Math.min(qCount - 1, i + 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [qCount]);

  const picks = subject ? (marks.get(subject.result.id) ?? new Map<number, string>()) : new Map();
  const pickedId = picks.get(qIdx) ?? null;

  /**
   * The lines that may be picked for the question on screen.
   *
   * Its own criteria, plus any that carry no question at all — the shared
   * ladder, which is what every activity written before per-question criteria
   * has and what many still want. Offering the whole rubric here would let a
   * grader deduct question 4's points from question 1.
   */
  const forQuestion = useMemo(() => {
    if (!ladder) return null;
    const label = question?.label ?? null;
    return ladder.filter((r) => !r.question_label || r.question_label === label);
  }, [ladder, question?.label]);
  const deductionOf = (id: string | null) =>
    ladder?.find((r) => r.id === id)?.deduction ?? 0;

  /** What the pick on this question costs — a deduction off the activity total. */
  const takenHere = deductionOf(pickedId);
  const runningTotal = useMemo(() => {
    if (!ladder) return null;
    let taken = 0;
    for (const [, id] of picks) taken += deductionOf(id);
    return Math.max(pointsTotal(activity) - taken, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ladder, picks, questions]);

  const answeredAll = subject != null && picks.size >= qCount;

  async function pick(item: RubricItem) {
    if (!subject) return;
    setEditIdx(null);
    const already = pickedId === item.id;
    // Optimistic: the ladder is the fastest thing on this screen and waiting on
    // a round-trip to show a checkmark makes grading feel broken.
    setMarks((prev) => {
      const next = new Map(prev);
      const inner = new Map(next.get(subject.result.id) ?? []);
      if (already) inner.delete(qIdx);
      else inner.set(qIdx, item.id);
      next.set(subject.result.id, inner);
      return next;
    });
    try {
      if (already) await clearMark(subject.result.id, qIdx);
      else await setMark(subject.result.id, qIdx, item.id);
      onChanged();
    } catch (e) {
      onError(e);
      await loadMarks().catch(() => undefined);
    }
  }

  async function addLine() {
    if (!ladder || !forQuestion) return;
    try {
      // Attached to the question being marked, not to the whole activity: this
      // button sits inside "Question 3 rubric", and a line added from there
      // that then appeared under every question would be a surprise nobody
      // asked for. The shared ladder is written on the Rubric page.
      const row = await addRubricItem(activity.id, ladder, question?.label ?? null);
      setLadder([...ladder, row]);
      // The index is into the FILTERED list, which is what the rows below are
      // rendered from — the new line lands at its end.
      setEditIdx(forQuestion.length);
    } catch (e) {
      onError(e);
    }
  }

  async function commitLine(item: RubricItem, patch: { description?: string; deduction?: number }) {
    try {
      await updateRubricItem(item.id, patch);
      setLadder((rows) => (rows ?? []).map((r) => (r.id === item.id ? { ...r, ...patch } : r)));
    } catch (e) {
      onError(e);
    }
  }

  async function release() {
    if (!subject) return;
    setReleasing(true);
    try {
      await releaseMark(subject.result.id, IS_COMPLETION[activity.type]);
      onChanged();
    } catch (e) {
      onError(e);
    } finally {
      setReleasing(false);
    }
  }

  async function saveNote() {
    if (!subject || note === (subject.result.feedback ?? "")) return;
    try {
      await setFeedback(subject.result.id, note);
      onChanged();
    } catch (e) {
      onError(e);
    }
  }

  const weekLine =
    activity.week == null
      ? "Unscheduled"
      : `Week ${activity.week}${
          data.weeks.find((w) => w.week === activity.week)?.dates_label
            ? ` · ${data.weeks.find((w) => w.week === activity.week)?.dates_label}`
            : ""
        }`;

  const header = (
    <div className="fv-topbar">
      <button type="button" className="fv-back" onClick={onBack} aria-label="Back to the activity">
        <FIcon name="chevronLeft" size={18} />
      </button>
      <span
        style={{
          fontFamily: "var(--fv-serif)",
          fontSize: "var(--fv-lg)",
          fontWeight: 700,
          letterSpacing: "var(--fv-tight)",
        }}
      >
        {activity.title}
      </span>
      <span className="fv-sub">{weekLine}</span>
    </div>
  );

  // Grading is a course-wide permission. RLS and the guard trigger reject the
  // write anyway, but letting someone mark a whole submission and only then
  // discover they may not is the wrong way to find out.
  if (!data.can.grade) {
    return (
      <div className="fv-panel">
        {header}
        <div className="fv-card" style={{ padding: 26, maxWidth: 520 }}>
          <div style={{ fontFamily: "var(--fv-serif)", fontSize: "var(--fv-lg)", fontWeight: 700 }}>
            Grading is turned off for teaching fellows
          </div>
          <p className="fv-sub" style={{ marginTop: 8, lineHeight: 1.6, maxWidth: "56ch" }}>
            The instructor controls this on the TFs tab, for every fellow on the course at once.
            Ask them to turn on <strong>Grading</strong> and reload.
          </p>
        </div>
      </div>
    );
  }

  if (!subject) {
    return (
      <div className="fv-panel">
        {header}
        <div className="fv-card" style={{ padding: 26, maxWidth: 520 }}>
          <div style={{ fontFamily: "var(--fv-serif)", fontSize: "var(--fv-lg)", fontWeight: 700 }}>
            Nothing to grade yet
          </div>
          <p className="fv-sub" style={{ marginTop: 8, lineHeight: 1.6, maxWidth: "56ch" }}>
            No {half === "team" ? "team has" : "student has"} handed this in. Once work arrives it
            will appear here, one question at a time.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="fv-panel">
      {header}

      <div className="fv-gradebody">
        {/* ------------------------------------------------ the submission */}
        <div className="fv-subpane">
          <div className="fv-subtool">
            <FAvatar name={subject.name} tint={subject.tint} size={24} />
            <span style={{ fontSize: "var(--fv-sm)", fontWeight: 600 }}>{subject.name}</span>
            <span className="fv-num" style={{ fontSize: "var(--fv-2xs)", color: "var(--fv-muted)" }}>
              {stamp(subject.result.submitted_at ?? subject.result.updated_at)}
            </span>
            <span style={{ flex: 1 }} />
            {scope === "both" ? (
              <div className="fv-seg" style={{ padding: 2 }}>
                {(["individual", "team"] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    className={half === k ? "on" : ""}
                    onClick={() => {
                      setHalf(k);
                      setStIdx(0);
                      setQIdx(0);
                    }}
                  >
                    {k === "individual" ? "Individual" : "Team"}
                  </button>
                ))}
              </div>
            ) : null}
            <span style={{ fontSize: "var(--fv-xs)", color: "var(--fv-muted)" }}>
              Question {qIdx + 1}
            </span>
            <button
              type="button"
              className="fv-iconbtn"
              style={{ width: 26, height: 26 }}
              aria-label="Open the submission in a new tab"
              title="Opening submissions in their own tab needs file storage, which is not wired yet"
              disabled
            >
              <FIcon name="openInNew" size={15} />
            </button>
          </div>

          <div className="fv-viewer">
            <div className="fv-sheet">
              <div
                className="fv-eyebrow"
                style={{ fontFamily: "var(--fv-sans)" }}
              >
                Question {qIdx + 1}
              </div>
              <p className="fv-prompt">
                {activity.source_text?.trim() ||
                  `Question ${question?.label ?? qIdx + 1} of ${qCount} for ${activity.title}. The prompt is set on the activity; add one with “Edit activity”.`}
              </p>
              <div
                style={{ height: 1, background: "var(--fv-neutral-200)", margin: "20px 0 0" }}
              />
              {subject.result.text?.trim() ? (
                <p
                  style={{
                    fontSize: 15,
                    lineHeight: 1.6,
                    marginTop: 20,
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {subject.result.text}
                </p>
              ) : (
                <>
                  {/* No file storage yet, so a handed-in-but-empty row is drawn
                      as a page rather than pretending there is nothing here. */}
                  <div className="fv-bars">
                    {[92, 78, 86, 64, 90, 71, 83, 56, 74].map((w, i) => (
                      <i
                        key={w}
                        style={{
                          width: `${w}%`,
                          background:
                            i % 2 === 0 ? "var(--fv-neutral-200)" : "var(--fv-neutral-100)",
                        }}
                      />
                    ))}
                  </div>
                  <div
                    style={{
                      textAlign: "center",
                      marginTop: 26,
                      fontSize: "var(--fv-2xs)",
                      color: "var(--fv-muted)",
                      fontFamily: "var(--fv-sans)",
                    }}
                  >
                    Page {qIdx + 1} of {qCount} · assigned to Question {question?.label ?? qIdx + 1}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* ----------------------------------------------------- the panel */}
        <div className="fv-gradeside">
          <div className="fv-card" style={{ padding: "12px 14px" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span className="fv-eyebrow" style={{ flex: 1 }}>
                Progress
              </span>
              <span className="fv-num" style={{ fontSize: "var(--fv-xs)", color: "var(--fv-muted)" }}>
                {stat ? `${stat.graded} of ${stat.total} ${stat.verb}` : "—"}
              </span>
            </div>
            <div className="fv-track" style={{ height: 8, marginTop: 8 }}>
              <i
                style={{
                  width: stat && stat.total ? `${(stat.graded / stat.total) * 100}%` : "0%",
                  background: "var(--fv-emerald)",
                }}
              />
            </div>
          </div>

          <div className="fv-card" style={{ padding: "14px 16px" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span className="fv-eyebrow" style={{ flex: 1 }}>
                Question {question?.label ?? qIdx + 1} rubric
              </span>
              <span className="fv-num" style={{ fontSize: "var(--fv-sm)", fontWeight: 600 }}>
                {takenHere > 0 ? `− ${pts(takenHere)}` : "no deduction"}
              </span>
            </div>
            <p
              style={{
                fontSize: "var(--fv-2xs)",
                color: "var(--fv-muted)",
                lineHeight: 1.5,
                margin: "6px 0 10px",
              }}
            >
              Pick one — its points come off the {pts(pointsTotal(activity))} this activity is out
              of.{data.can.author ? " Use the pencil to edit a line." : ""}
            </p>

            {forQuestion == null ? (
              <div className="fv-sub">Loading the ladder…</div>
            ) : forQuestion.length === 0 ? (
              // Only the instructor can write criteria, so say that rather than
              // showing an empty list that looks broken.
              <div className="fv-sub" style={{ lineHeight: 1.6 }}>
                No criteria have been written for this question yet. Ask the instructor to open
                the <strong>Rubric</strong> on the activity and add some, then reload.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 2, margin: "0 -4px" }}>
                {forQuestion.map((item, i) => (
                  <RubricRow
                    key={item.id}
                    item={item}
                    selected={pickedId === item.id}
                    editing={data.can.author && editIdx === i}
                    canEdit={data.can.author}
                    onPick={() => void pick(item)}
                    onToggleEdit={() => setEditIdx(editIdx === i ? null : i)}
                    onCommit={(patch) => void commitLine(item, patch)}
                  />
                ))}
              </div>
            )}

            <button
              type="button"
              className="fv-btn outline sm full"
              style={{ marginTop: 10 }}
              onClick={() => void addLine()}
              disabled={!ladder || !data.can.author}
              title={
                data.can.author
                  ? "Adds a line to this question's criteria"
                  : "Only the instructor who owns this course can change the rubric."
              }
            >
              <FIcon name="add" size={14} />
              Add rubric item
            </button>
            <div
              className="fv-num"
              style={{ marginTop: 8, fontSize: "var(--fv-2xs)", color: "var(--fv-muted)" }}
            >
              Submission so far · {runningTotal ?? "—"} / {pts(pointsTotal(activity))}
            </div>
          </div>

          <div className="fv-card" style={{ padding: "12px 14px" }}>
            <div className="fv-eyebrow" style={{ marginBottom: 6 }}>
              Additional comments
            </div>
            <textarea
              className="fv-ta"
              rows={3}
              placeholder="Comments for this student…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onBlur={() => void saveNote()}
            />
          </div>

          {/* The design never draws a "done" control — it only implies one via
              the waiting count. Grading has to be able to finish somewhere, so
              it sits here, quiet, and only once every question has a pick. */}
          <button
            type="button"
            className="fv-btn primary full"
            onClick={() => void release()}
            disabled={!answeredAll || releasing || subject.result.status === "scored"}
            title={
              subject.result.status === "scored"
                ? "Already released"
                : answeredAll
                  ? "Release this mark"
                  : `Pick a line for all ${qCount} questions first`
            }
          >
            {subject.result.status === "scored"
              ? "Released"
              : releasing
                ? "Releasing…"
                : `Release ${runningTotal ?? 0} / ${pts(pointsTotal(activity))}`}
          </button>

          <div className="fv-card" style={{ padding: "12px 14px" }}>
            <Stepper
              label={`Question ${question?.label ?? qIdx + 1} of ${qCount}`}
              onPrev={() => setQIdx((i) => Math.max(0, i - 1))}
              onNext={() => setQIdx((i) => Math.min(qCount - 1, i + 1))}
              prevOk={qIdx > 0}
              nextOk={qIdx < qCount - 1}
            />
            <div style={{ borderTop: "1px solid var(--fv-neutral-200)", paddingTop: 10, marginTop: 10 }}>
              <Stepper
                label={`${half === "team" ? "Team" : "Student"} ${stIdx + 1} of ${subjects.length}`}
                onPrev={() => {
                  setStIdx((i) => Math.max(0, i - 1));
                  setQIdx(0);
                }}
                onNext={() => {
                  setStIdx((i) => Math.min(subjects.length - 1, i + 1));
                  setQIdx(0);
                }}
                prevOk={stIdx > 0}
                nextOk={stIdx < subjects.length - 1}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stepper({
  label,
  onPrev,
  onNext,
  prevOk,
  nextOk,
}: {
  label: string;
  onPrev: () => void;
  onNext: () => void;
  prevOk: boolean;
  nextOk: boolean;
}) {
  return (
    <div className="fv-navgrid">
      <button
        type="button"
        className="fv-arrow"
        onClick={onPrev}
        disabled={!prevOk}
        aria-label={`Previous — ${label}`}
      >
        <FIcon name="chevronLeft" size={15} />
      </button>
      <span
        className="fv-num"
        style={{ flex: 1, textAlign: "center", fontSize: "var(--fv-xs)", color: "var(--fv-muted)" }}
      >
        {label}
      </span>
      <button
        type="button"
        className="fv-arrow"
        onClick={onNext}
        disabled={!nextOk}
        aria-label={`Next — ${label}`}
      >
        <FIcon name="chevronRight" size={15} />
      </button>
    </div>
  );
}

function RubricRow({
  item,
  selected,
  editing,
  canEdit,
  onPick,
  onToggleEdit,
  onCommit,
}: {
  item: RubricItem;
  selected: boolean;
  editing: boolean;
  /** Writing rubric_items is owner-only, so a TF must not see the pencil. */
  canEdit: boolean;
  onPick: () => void;
  onToggleEdit: () => void;
  onCommit: (patch: { description?: string; deduction?: number }) => void;
}) {
  const numRef = useRef<HTMLSpanElement | null>(null);
  const descRef = useRef<HTMLSpanElement | null>(null);
  // Enter blurs before the keydown handler runs, so a commit fires twice in one
  // event while `item` is still the old props. Comparing against what was last
  // written makes the duplicate a no-op instead of a second write.
  const saved = useRef({ description: item.description, deduction: item.deduction });

  useEffect(() => {
    if (!editing) return;
    const el = descRef.current;
    if (!el) return;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }, [editing]);

  const commit = () => {
    const rawNum = (numRef.current?.textContent ?? "").replace(/[^0-9.]/g, "");
    const n = Number.parseFloat(rawNum);
    const deduction = Number.isFinite(n) && n >= 0 ? Math.min(n, 99) : saved.current.deduction;
    const description = (descRef.current?.textContent ?? "").trim() || saved.current.description;

    if (deduction === saved.current.deduction && description === saved.current.description) return;
    saved.current = { description, deduction };
    // A contentEditable is not React-controlled, so a rejected value would sit
    // on screen looking saved. Write the accepted one back.
    if (numRef.current && document.activeElement !== numRef.current) {
      numRef.current.textContent = String(deduction);
    }
    onCommit({ description, deduction });
  };

  return (
    <div className={`fv-rrow${selected ? " sel" : ""}${editing ? " editing" : ""}`}>
      <button
        type="button"
        onClick={onPick}
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 9,
          flex: 1,
          minWidth: 0,
          border: 0,
          background: "transparent",
          font: "inherit",
          color: "inherit",
          textAlign: "left",
          cursor: "pointer",
          padding: 0,
        }}
        aria-pressed={selected}
      >
        <span className="fv-check">{selected ? <FIcon name="check" size={14} /> : null}</span>
        <span
          ref={numRef}
          className={editing ? "fv-edit" : undefined}
          contentEditable={editing}
          suppressContentEditableWarning
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "Escape") {
              e.preventDefault();
              commit();
              onToggleEdit();
            }
          }}
          onBlur={commit}
          style={{
            flex: "none",
            fontSize: "var(--fv-xs)",
            fontWeight: 600,
            fontVariantNumeric: "tabular-nums",
            color: item.deduction === 0 ? "var(--fv-emerald)" : "var(--fv-destructive)",
          }}
        >
          {editing ? String(item.deduction) : `− ${item.deduction} ${item.deduction === 1 ? "pt" : "pts"}`}
        </span>
        <span
          ref={descRef}
          className={editing ? "fv-edit" : undefined}
          contentEditable={editing}
          suppressContentEditableWarning
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "Escape") {
              e.preventDefault();
              commit();
              onToggleEdit();
            }
          }}
          onBlur={commit}
          style={{ fontSize: "var(--fv-xs)", lineHeight: 1.5, flex: 1, minWidth: 0 }}
        >
          {item.description}
        </span>
      </button>
      {canEdit ? (
        <button
          type="button"
          className="fv-iconbtn"
          style={{ width: 22, height: 22, flex: "none" }}
          onClick={onToggleEdit}
          aria-label={editing ? "Stop editing this line" : "Edit this line"}
        >
          <FIcon name="edit" size={13} />
        </button>
      ) : null}
    </div>
  );
}
