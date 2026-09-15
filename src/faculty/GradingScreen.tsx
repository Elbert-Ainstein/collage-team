"use client";

// Grading, Gradescope-style: the whole submission on one scrolling list — every
// question with what it scored, and the one being marked showing the activity's
// deduction ladder open underneath it.
//
// The rule that shapes everything here: a mark IS the picked ladder row, not the
// points that row happens to carry. Two rows may deduct the same amount, and
// storing the value would make them indistinguishable — and a newly added line
// unselectable. The score is never written from this screen either; a trigger
// recomputes it from the marks (migration 0007), so there is one writer and the
// number can't drift from what produced it.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { openResultsFor, type ResultRow } from "@/checkins/data";
import {
  INDIV_ELSEWHERE,
  isCompletion,
  SCOPE_OF,
  type Activity,
  type ActivityQuestion,
  type RubricItem,
  type SubmissionMark,
} from "@/checkins/types";
import {
  addRubricItem,
  clearMark,
  ensureRubric,
  listMarks,
  releaseMany,
  releaseMark,
  seedComboIfBlank,
  sendForReview,
  sendManyForReview,
  setActivityPoints,
  setFeedback,
  setMark,
  updateRubricItem,
} from "./facultyData";
import {
  awardFits,
  awardForDeduction,
  comboTotal,
  deductionForAward,
  pointsTotal,
  questionsFor,
  tallyQuestionPoints,
  worthOf,
  type ComboTotal,
  type PointedQuestion,
} from "./model";
import type { FacultyData } from "./FacultyApp";
import { FAvatar, FIcon } from "./icons";
import { ActivityTeamPanel } from "./ActivityTeamPanel";
import { ConfirmDialog } from "./ConfirmDialog";
import { SubmissionPages } from "./SubmissionPages";

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

// A share of the total divides, so these numbers are not always whole. Two
// places is as far as a mark is ever worth printing, and rounding at every step
// is what keeps the question rows adding up to the header.
const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (n: number) => String(round2(n));

/** What the finish button reads. Split out so the two paths are side by side. */
function releaseLabel(a: {
  releasing: boolean;
  forCompletion: boolean;
  canRelease: boolean;
  status: ResultRow["status"];
  earned: number;
  outOf: number;
}): string {
  if (a.releasing) return a.canRelease ? "Finalising…" : "Sending…";
  if (a.canRelease) {
    if (a.forCompletion) return "Finalize grade";
    if (a.status === "scored") return "Released";
    return `Release ${num(a.earned)} / ${pts(a.outOf)}`;
  }
  if (a.status === "scored") return "Released";
  if (a.forCompletion) return a.status === "needs_review" ? "Send again" : "Send for review";
  if (a.status === "needs_review") return "Sent for review";
  return `Send ${num(a.earned)} / ${pts(a.outOf)} for review`;
}

/** The finish button's tooltip: why it is lit, or why it is not. */
function releaseTitle(a: {
  forCompletion: boolean;
  canRelease: boolean;
  met: boolean | null;
  status: ResultRow["status"];
  answeredAll: boolean;
  qCount: number;
}): string {
  if (!a.canRelease && a.status === "scored") return "Released by the instructor";
  if (a.forCompletion) {
    if (a.met === null) return "Pick Complete or Not complete first";
    if (a.canRelease) return a.status === "scored" ? "Finalise the change" : "Finalise this grade";
    return a.status === "needs_review" ? "Send the change for review" : "Send this mark for review";
  }
  if (a.canRelease) {
    if (a.status === "scored") return "Already released";
    return a.answeredAll ? "Release this mark" : `Pick a line for all ${a.qCount} questions first`;
  }
  if (a.status === "needs_review") return "Waiting for the instructor to release it";
  return a.answeredAll
    ? "Send this mark to the instructor to release"
    : `Pick a line for all ${a.qCount} questions first`;
}

/**
 * An activity with no question rows still has to be gradeable, so `questions`
 * below invents one per legacy question_count. They exist only in this screen:
 * there is no row behind them and so no id anything can be stored against.
 */
const isSynthetic = (q: ActivityQuestion) => q.id.startsWith("synthetic-");

/**
 * Where a mark is filed on this screen.
 *
 * The question's own id, because a position MOVES: adding or deleting a
 * question renumbers every one below it, and a mark filed by position ends up
 * under whichever question inherits the slot — deducting from a question that
 * was never marked, and often not even visible, since the criteria are filtered
 * by the question's label. `#n` is only for the synthesised questions, which
 * belong to an activity that has no questions to renumber.
 */
const keyOf = (q: ActivityQuestion) => (isSynthetic(q) ? `#${q.position}` : q.id);

const markKey = (m: SubmissionMark) => m.question_id ?? `#${m.question_index}`;

/**
 * The row picked for one question, if any.
 *
 * Falls back to the position for a real question because a mark written before
 * 0026 carries no question_id — on a database where that migration has not been
 * run yet, this is the only thing that finds it, and grading has to keep
 * working there.
 */
function pickOf(picks: Map<string, string>, q: ActivityQuestion | undefined): string | null {
  if (!q) return null;
  return picks.get(keyOf(q)) ?? (isSynthetic(q) ? null : picks.get(`#${q.position}`)) ?? null;
}

/** One line of the header breakdown: what a piece of the week contributed. */
function TotalPart({ label, value, outOf }: { label: string; value: string; outOf: number }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: "var(--fv-2xs)",
          color: "var(--fv-muted)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
      <span className="fv-num" style={{ flex: "none", fontSize: "var(--fv-2xs)" }}>
        {value} / {outOf}
      </span>
    </div>
  );
}

/** One person or team to be graded, with the result row that holds their work. */
interface Subject {
  id: string;
  name: string;
  tint: string | null;
  result: ResultRow;
}

export function GradingScreen({
  data,
  activity,
  focus = null,
  onBack,
  onOpenCheckIn,
  onChanged,
  onError,
}: {
  data: FacultyData;
  activity: Activity;
  /**
   * Whose work to open on, when the screen was reached from a row that names
   * them — the Review tab's "Open". Null starts on the first subject as
   * always. Read once, on the way in; stepping afterwards is the stepper's.
   */
  focus?: { subjectId: string; kind: "individual" | "team" } | null;
  onBack: () => void;
  /** The Check-in sheet, where the team half is actually filled in. */
  onOpenCheckIn: () => void;
  onChanged: () => void;
  onError: (e: unknown) => void;
}) {
  const scope = SCOPE_OF[activity.type];
  const stat = data.stats.get(activity.id);
  /**
   * Which question is being marked — an index into `questions` below, and only
   * that. What a mark is FILED under is the question itself; see keyOf.
   */
  const [qIdx, setQIdx] = useState(0);
  // Questions are rows (0014), in the order the rubric puts them. An activity
  // that has none yet still grades the old way — N questions of equal value —
  // so this synthesises that shape rather than showing a grader nothing.
  const questions = useMemo<PointedQuestion[]>(() => {
    const rows = questionsFor(activity.id, data.questions);
    if (rows.length) return rows;
    return Array.from({ length: Math.max(activity.question_count, 1) }, (_, i) => ({
      id: `synthetic-${i}`,
      activity_id: activity.id,
      label: String(i + 1),
      position: i,
      created_at: "",
    })) as PointedQuestion[];
  }, [activity.id, activity.question_count, data.questions]);

  const qCount = questions.length;
  const question = questions[Math.min(qIdx, qCount - 1)] ?? questions[0];

  const [ladder, setLadder] = useState<RubricItem[] | null>(null);
  // resultId -> markKey -> rubric_item_id
  const [marks, setMarks] = useState<Map<string, Map<string, string>>>(new Map());
  const [stIdx, setStIdx] = useState(0);
  const [editIdx, setEditIdx] = useState<number | null>(null);
  /**
   * Whether the current question's ladder is folded away.
   *
   * The rows are an accordion: a click on a closed question opens it and makes
   * it current; a click on the open one folds its ladder without changing what
   * is current, so the pages on the left stay where they are. Stepping with the
   * arrows always unfolds — nobody presses → to see less.
   */
  const [folded, setFolded] = useState(false);
  const [note, setNote] = useState("");
  const [releasing, setReleasing] = useState(false);
  /**
   * Whether the instructor may send a grade to the student, or only send it
   * to the instructor (0038). Everything below that says "release" reads
   * "send for review" when this is off.
   */
  const canRelease = data.can.release;
  /** The combo warning is up: a completion in the week is not marked yet. */
  const [confirmEarly, setConfirmEarly] = useState(false);

  // A `both`-scope activity has TWO halves to mark, and picking "individual"
  // unconditionally meant the team half of every Challenge could never be
  // graded at all — the gradebook showed those tRATs as handed in and there was
  // no screen that would mark them.
  const [half, setHalf] = useState<"individual" | "team">(
    scope === "team" ? "team" : focus?.kind === "team" && scope === "both" ? "team" : "individual",
  );
  // Reset only when the scope actually MOVES. An effect also runs once after
  // mount, and resetting there would undo the half the Review tab asked for.
  const lastScope = useRef(scope);
  useEffect(() => {
    if (lastScope.current === scope) return;
    lastScope.current = scope;
    setHalf(scope === "team" ? "team" : "individual");
  }, [scope]);

  const kind: "individual" | "team" =
    scope === "both" ? half : scope === "team" ? "team" : "individual";
  const checkIn =
    data.checkIns.find((c) => c.activity_id === activity.id && c.kind === kind) ?? null;
  /**
   * Named when this half is answered on another platform — an Amplify
   * individual half, where the answers are on Amplify and nothing is handed in
   * here. The team half of the same activity is unaffected.
   */
  const elsewhere = kind === "individual" ? INDIV_ELSEWHERE[activity.type] : null;

  /**
   * Somewhere for a mark to go.
   *
   * Nobody hands in, so nobody has a row, so without this the class is empty
   * and the half cannot be graded at all — which is the whole of what the
   * marker came here to do. Only the missing rows are written, and they go in
   * empty, so opening this screen twice writes nothing the second time.
   */
  useEffect(() => {
    if (!elsewhere || !checkIn || !data.roster.length) return;
    let live = true;
    openResultsFor(
      checkIn.id,
      data.roster.map((s) => s.id),
    )
      .then((made) => {
        if (live && made) onChanged();
      })
      .catch(onError);
    return () => {
      live = false;
    };
  }, [elsewhere, checkIn?.id, data.roster, onChanged, onError]);

  // Scope decides who is graded: a team activity is marked once per team.
  const subjects: Subject[] = useMemo(() => {
    if (!checkIn) return [];

    const handedIn = (r: Pick<ResultRow, "status">) =>
      r.status === "submitted" || r.status === "needs_review" || r.status === "scored";

    // Handing in is what puts somebody on this list — except where handing in
    // is not the arrangement. On a half answered elsewhere the whole roster is
    // gradeable the moment the instructor has the other platform open.
    const rows = data.results.filter(
      (r) => r.check_in_id === checkIn.id && (elsewhere !== null || handedIn(r)),
    );
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
  }, [checkIn, data.results, data.roster, data.teams, kind, elsewhere]);

  const subject = subjects[stIdx] ?? null;

  // Clamp when the roster or the submitted set changes under us.
  useEffect(() => {
    setStIdx((i) => Math.min(i, Math.max(subjects.length - 1, 0)));
  }, [subjects.length]);

  // Land on the person the Review tab named. Once: the list is built from
  // `data`, which arrives after mount, so this waits for them to be on it and
  // then leaves the cursor to the stepper.
  const landed = useRef(false);
  useEffect(() => {
    if (landed.current || !focus) return;
    const at = subjects.findIndex((s) => s.id === focus.subjectId);
    if (at < 0) return;
    landed.current = true;
    setStIdx(at);
  }, [focus, subjects]);
  useEffect(() => {
    setQIdx((i) => Math.min(i, qCount - 1));
  }, [qCount]);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        let rows = await ensureRubric(activity, data.can.author);
        // A combo nobody has set up arrives with the course's rubric, the same
        // way it does on the Rubric page. Without this, a combo opened straight
        // from grading was one 0-point question with nothing to pick, and the
        // marker had no way to find out why.
        if (live && rows.length === 0 && (await seedComboIfBlank(activity, data.can.author))) {
          if (!live) return;
          rows = await ensureRubric(activity, data.can.author);
          if (!live) return;
          // The questions and the total moved under us; the parent holds both.
          onChanged();
        }
        if (live) setLadder(rows);
      } catch (e) {
        if (live) onError(e);
      }
    })();
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
    const next = new Map<string, Map<string, string>>();
    for (const m of rows) {
      const inner = next.get(m.result_id) ?? new Map<string, string>();
      inner.set(markKey(m), m.rubric_item_id);
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
      // editIdx points into the OPEN question's criteria, so leaving it set
      // while the list opens a different question puts the edit box on an
      // unrelated line.
      if (e.key === "ArrowLeft") {
        setEditIdx(null);
        setFolded(false);
        setQIdx((i) => Math.max(0, i - 1));
      }
      if (e.key === "ArrowRight") {
        setEditIdx(null);
        setFolded(false);
        setQIdx((i) => Math.min(qCount - 1, i + 1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [qCount]);

  const picks: Map<string, string> = subject
    ? (marks.get(subject.result.id) ?? new Map<string, string>())
    : new Map<string, string>();
  const pickedId = pickOf(picks, question);

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

  /**
   * Every question's score and the submission's, out of one walk.
   *
   * The total is the activity's points minus every deduction on the row —
   * exactly the arithmetic recompute_result_score() runs in the database
   * (0007), down to counting a mark left behind by a deleted question, because
   * that mark is still a row and the trigger still subtracts it. So the number
   * in the header and the number the student is sent cannot drift.
   *
   * The per-question figures are carved out of that same walk rather than
   * summed up somewhere else. Two places computing a score is how the two come
   * to disagree, and this screen has been bitten by it before.
   *
   * What a question is "out of" is its OWN points when 0034 lets it carry them
   * — Kelly's combo is 3, 2, 3, 2, 5, 5 and printing 3.33 against each of the
   * six is the screen disagreeing with the rubric that produced the deductions.
   * Only when EVERY question declares a worth, because a half-priced activity
   * has no honest way to share what is left over; a partly-priced one falls back
   * to the even share, which is what every activity did before.
   *
   * The even share is cut cumulatively so the shares add back up to the total
   * exactly instead of drifting by a rounding step each. A deduction bigger
   * than the share leaves that question negative rather than floored at zero: a
   * floored row stops summing to the header, and a column of numbers that does
   * not add up is worse than one that reads harshly.
   */
  const score = useMemo(() => {
    if (!ladder) return null;
    const out = pointsTotal(activity);
    const per = new Map<string, { out: number; taken: number }>();
    const priced = questions.length > 0 && questions.every((q) => q.points != null);
    if (priced) {
      for (const q of questions) {
        per.set(keyOf(q), { out: worthOf(activity, q), taken: deductionOf(pickOf(picks, q)) });
      }
    } else {
      let cut = 0;
      questions.forEach((q, i) => {
        const upto = round2((out * (i + 1)) / questions.length);
        per.set(keyOf(q), { out: round2(upto - cut), taken: deductionOf(pickOf(picks, q)) });
        cut = upto;
      });
    }
    let taken = 0;
    for (const [, id] of picks) taken += deductionOf(id);

    // What it stands at NOW is what has been awarded so far. A deduction model
    // starts at full marks and comes down, so a submission nobody had touched
    // read "30 / 30" — which is not a score, it is the absence of one. Until
    // every question has a pick, the number is the sum of the picked
    // questions' awards; once every one does, it is the database's own
    // arithmetic (total minus every deduction), which is what Release sends
    // and what the student is shown. The two agree whenever the questions'
    // worths add up to the total, which is the case the Rubric page checks.
    const marked = questions.filter((q) => pickOf(picks, q));
    const running = marked.reduce((n, q) => {
      const p = per.get(keyOf(q));
      return p ? n + (p.out - p.taken) : n;
    }, 0);
    const complete = questions.length > 0 && marked.length === questions.length;
    const earned = complete ? Math.max(round2(out - taken), 0) : round2(running);
    return { out, per, earned };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ladder, picks, questions, activity]);

  /**
   * The week's 30, when this is a combo and its week holds the completions.
   *
   * Null everywhere else, and every screen then shows what it always showed.
   */
  const week: ComboTotal | null = useMemo(() => {
    // isCompletion inline rather than the forCompletion below it: that const
    // is declared further down and this factory runs during the same render.
    if (!subject || isCompletion(activity) || half !== "individual") return null;
    return comboTotal(
      activity,
      subject.id,
      score?.earned ?? null,
      data.activities,
      data.checkIns,
      data.results,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activity, subject, half, score?.earned, data.activities, data.checkIns, data.results]);

  // A completion activity has no criteria to pick — the rubric collapses to one
  // Complete/Not complete for the whole assignment — so requiring a pick per
  // question left Release permanently disabled with no control anywhere that
  // could enable it. Completion is the instructor's judgement, not a sum.
  const forCompletion = isCompletion(activity);

  /**
   * The combo priced at the week, not at itself.
   *
   * Faculty know the week is 30 and type 30 on the combo — but the completions
   * are added from their own activities, so the combo itself is the 20 its
   * questions add up to. Priced at 30 it shows "out of 40", and every score
   * comes off 30 rather than 20, so a student who earned 15 reads 25. The
   * Rubric page reports the gap in general; this is the one shape of it that
   * has an obvious cause, said where the wrong number is on screen.
   */
  const pricedAtWeek = useMemo(() => {
    if (!week) return null;
    const tally = tallyQuestionPoints(activity, questions);
    if (tally.balance !== "under") return null;
    const added = week.auto.reduce((n, p) => n + p.worth, 0);
    if (tally.declared + added !== tally.total) return null;
    return { total: tally.total, declared: tally.declared, added };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [week, activity, questions]);
  const [repricing, setRepricing] = useState(false);
  /** Set the combo to what its questions add up to. The owner's write. */
  async function reprice() {
    if (!pricedAtWeek) return;
    setRepricing(true);
    try {
      await setActivityPoints(activity.id, pricedAtWeek.declared);
      onChanged();
    } catch (e) {
      onError(e);
    } finally {
      setRepricing(false);
    }
  }
  // Counted question by question, not by how many marks the row carries. A mark
  // left behind by a question deleted before 0026 still sits on the submission,
  // and counting rows let Release light up — and a grade go out — with a
  // question nobody had marked.
  const answered = questions.reduce((n, q) => (pickOf(picks, q) ? n + 1 : n), 0);
  const answeredAll = subject != null && (forCompletion || answered >= qCount);

  async function pick(item: RubricItem) {
    if (!subject || !question) return;
    setEditIdx(null);
    const already = pickedId === item.id;
    const key = keyOf(question);
    const qid = isSynthetic(question) ? null : question.id;
    // Optimistic: the ladder is the fastest thing on this screen and waiting on
    // a round-trip to show a checkmark makes grading feel broken.
    setMarks((prev) => {
      const next = new Map(prev);
      const inner = new Map(next.get(subject.result.id) ?? []);
      // Both keys, because a mark written before 0026 is filed by position:
      // leaving that entry behind would keep the tick on a line just cleared.
      inner.delete(key);
      inner.delete(`#${question.position}`);
      if (!already) inner.set(key, item.id);
      next.set(subject.result.id, inner);
      return next;
    });
    try {
      if (already) await clearMark(subject.result.id, question.position, qid);
      else await setMark(subject.result.id, question.position, item.id, qid);
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

  /**
   * The completion answer being offered for this subject.
   *
   * Held locally so the two buttons respond instantly and so a released mark
   * can be changed and re-finalised without leaving the screen. Seeded from the
   * row: a subject already released as Not complete must come back reading Not
   * complete, not reset to the friendlier default.
   */
  const [met, setMet] = useState<boolean | null>(null);
  // A row sent for review carries its answer too: the radios have to keep
  // showing what was sent, or the TF re-picks blind and "Send again" sends a
  // guess over a mark that was already right.
  useEffect(() => {
    if (!subject) return;
    const answered = subject.result.status === "scored" || subject.result.status === "needs_review";
    setMet(answered ? (subject.result.ci_met ?? true) : null);
  }, [subject?.result.id, subject?.result.status, subject?.result.ci_met]);

  async function release(metNow?: boolean) {
    if (!subject) return;
    setReleasing(true);
    setConfirmEarly(false);
    try {
      if (canRelease) {
        await releaseMark(subject.result.id, forCompletion, metNow ?? met ?? true);
      } else {
        await sendForReview(subject.result.id, forCompletion, metNow ?? met ?? true);
      }
      onChanged();
    } catch (e) {
      onError(e);
    } finally {
      setReleasing(false);
    }
  }

  /**
   * The button. A combo's 30 is 20 of its own plus the week's completions,
   * marked on their own pages — so releasing while one of those is still
   * unmarked sends a total that is going to change. That is asked about, not
   * refused: the instructor may well be releasing the combo first on purpose.
   * Only asked of a release; a TF sending for review is not sending anything
   * to a student yet.
   */
  const unmarked = week?.auto.filter((p) => p.earned == null) ?? [];
  function finish() {
    if (canRelease && !forCompletion && unmarked.length) {
      setConfirmEarly(true);
      return;
    }
    void release();
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
  // One definition, used by the main body and by the team-half early return —
  // two copies would drift the moment either changed.
  const halfToggle = (
    <div className="fv-seg" style={{ padding: 2, alignSelf: "flex-start", marginBottom: 12 }}>
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
  );

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

  // The TEAM half of an activity is not graded question-by-question — it is
  // marked in the room, on the check-in sheet. So show that, the same table the
  // activity page shows, rather than a per-question grader that has nothing to
  // step through and a "nothing to grade yet" card that reads as a fault.
  if (half === "team" && scope !== "indiv") {
    return (
      <div className="fv-panel">
        {header}
        {scope === "both" ? halfToggle : null}
        <ActivityTeamPanel
          activityId={activity.id}
          teams={data.teams}
          onOpenCheckIn={onOpenCheckIn}
        />
      </div>
    );
  }

  if (!subject) {
    return (
      <div className="fv-panel">
        {header}
        {scope === "both" ? halfToggle : null}
        <div className="fv-card" style={{ padding: 26, maxWidth: 520 }}>
          <div style={{ fontFamily: "var(--fv-serif)", fontSize: "var(--fv-lg)", fontWeight: 700 }}>
            Nothing to grade yet
          </div>
          <p className="fv-sub" style={{ marginTop: 8, lineHeight: 1.6, maxWidth: "56ch" }}>
            {elsewhere
              ? `This half is answered in ${elsewhere}, so there is nothing to hand in — but there ` +
                `is nobody on the roster yet either, and a mark has to belong to somebody.`
              : `No ${half === "team" ? "team has" : "student has"} handed this in. Once work ` +
                `arrives it will appear here.`}
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
            {/* This pane is a reader, so its toolbar says which question it is
                open at. Whose work it is heads the list on the right, where the
                marking happens; printing a name twice across one screen is
                noise, not reassurance. */}
            <span style={{ fontSize: "var(--fv-sm)", fontWeight: 600 }}>
              Question {question?.label ?? qIdx + 1}
            </span>
            <span className="fv-num" style={{ fontSize: "var(--fv-2xs)", color: "var(--fv-muted)" }}>
              {/* Not the row's updated_at when nothing was handed in: that is
                  the moment this screen created the row, and printing it beside
                  a student's name reads as the time they submitted. */}
              {elsewhere && !subject.result.submitted_at
                ? `answered in ${elsewhere}`
                : stamp(subject.result.submitted_at ?? subject.result.updated_at)}
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
          </div>

          {/* The student's OWN pages, at the question being marked. This was a
              placeholder — grey bars and "assigned to Question 1" — while the
              real PDF and its page mapping sat one query away. Collecting the
              mapping and then not using it is the whole feature not landing.

              There are no pages at all when the half is answered elsewhere, and
              SubmissionPages would say "nothing handed in" once per student for
              a class of eighty — a fault report for the arrangement working as
              intended. Say where the answers are instead. */}
          {/* ...unless this student really did hand something in. Amplify was a
              normal upload half until now, so those PDFs exist, and hiding one
              behind a card explaining that nothing is handed in would be the
              app lying about work a student actually did. submitted_at is the
              tell: the rows this screen opens have none. */}
          {elsewhere && !subject.result.submitted_at ? (
            <div className="fv-card" style={{ padding: 20, margin: 14, maxWidth: 560 }}>
              <div className="fv-eyebrow">Answered in {elsewhere}</div>
              <p className="fv-sub" style={{ marginTop: 8, lineHeight: 1.6, maxWidth: "58ch" }}>
                Nothing is handed in here for this half — students answer in {elsewhere}, so open
                their {elsewhere} report alongside this and record what you see. The marks, the
                feedback and the release all work exactly as they do anywhere else, and the grade
                reaches the gradebook and the Canvas export the same way.
              </p>
            </div>
          ) : (
          <SubmissionPages
            resultId={subject.result.id}
            questionId={question && !question.id.startsWith("synthetic-") ? question.id : null}
            questionLabel={question?.label ?? String(qIdx + 1)}
            // A combo's students hand in one PDF without filing pages under
            // questions (SubmitScreen), so the whole file is the normal case.
            mapped={activity.type !== "combo"}
          />
          )}
        </div>

        {/* ----------------------------------------------------- the panel */}
        <div className="fv-gradeside">
          {/* Whose work this is and what it stands at, which is what the pane
              is read top-down for. The total is the one the Release button
              sends — same object, so they cannot say different things. */}
          <div className="fv-card" style={{ padding: "12px 14px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <FAvatar name={subject.name} tint={subject.tint} size={26} />
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  fontFamily: "var(--fv-serif)",
                  fontSize: "var(--fv-base)",
                  fontWeight: 700,
                  letterSpacing: "var(--fv-tight)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {subject.name}
              </span>
              {subject.result.status === "scored" ? (
                <span className="fv-eyebrow" style={{ flex: "none", color: "var(--fv-emerald)" }}>
                  Released
                </span>
              ) : subject.result.status === "needs_review" ? (
                <span className="fv-eyebrow" style={{ flex: "none", color: "var(--fv-amber)" }}>
                  {canRelease ? "For your review" : "Sent for review"}
                </span>
              ) : null}
            </div>
            {forCompletion ? null : (
              <div
                style={{
                  marginTop: 10,
                  paddingTop: 10,
                  borderTop: "1px solid var(--fv-neutral-200)",
                }}
              >
                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <span className="fv-eyebrow" style={{ flex: 1 }}>
                    Total points
                  </span>
                  <span className="fv-num" style={{ fontSize: "var(--fv-lg)", fontWeight: 700 }}>
                    {week
                      ? week.earned == null
                        ? "—"
                        : num(week.earned)
                      : score
                        ? num(score.earned)
                        : "—"}{" "}
                    / {pts(week ? week.outOf : pointsTotal(activity))}
                  </span>
                </div>

                {/* What the 30 is made of. Without this the header is a number
                    a grader cannot check against anything on their screen —
                    they are marking out of 20 and being shown 24. */}
                {week ? (
                  <div style={{ display: "grid", gap: 3, marginTop: 8 }}>
                    <TotalPart
                      label="This combo"
                      value={score ? num(score.earned) : "—"}
                      outOf={week.own.outOf}
                    />
                    {week.auto.map((p) => (
                      <TotalPart
                        key={p.activity.id}
                        label={p.label}
                        value={p.earned == null ? "—" : num(p.earned)}
                        outOf={p.worth}
                      />
                    ))}
                    <p
                      style={{
                        fontSize: "var(--fv-2xs)",
                        color: "var(--fv-muted)",
                        lineHeight: 1.5,
                        margin: "6px 0 0",
                      }}
                    >
                      {week.pending
                        ? "A dash is a completion not yet released, so this total isn\u2019t final."
                        : "The completions were released on their own pages."}
                    </p>
                    {pricedAtWeek ? (
                      <p
                        role="alert"
                        style={{
                          fontSize: "var(--fv-2xs)",
                          color: "var(--fv-amber)",
                          lineHeight: 1.5,
                          margin: "6px 0 0",
                        }}
                      >
                        This combo is set to {pts(pricedAtWeek.total)} but its questions add up
                        to {pts(pricedAtWeek.declared)} — the completions add their{" "}
                        {pts(pricedAtWeek.added)} on top, so every score reads{" "}
                        {pricedAtWeek.added} too high.
                        {data.can.author
                          ? null
                          : ` Ask the instructor to set it to ${pts(pricedAtWeek.declared)}.`}
                      </p>
                    ) : null}
                    {pricedAtWeek && data.can.author ? (
                      <button
                        type="button"
                        className="fv-btn outline sm"
                        style={{ marginTop: 8, alignSelf: "flex-start" }}
                        disabled={repricing}
                        onClick={() => void reprice()}
                        // 0014's trigger re-scores everyone marked on it, which is
                        // the point: the scores are what is wrong.
                        title="Re-scores every submission already marked on this combo"
                      >
                        {repricing ? "Setting…" : `Set this combo to ${pts(pricedAtWeek.declared)}`}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            )}
          </div>

          {forCompletion ? (
            /* Marked complete / not complete: there is no ladder, no deduction
               and no running total, so none of that is drawn. A criteria panel
               reading "no deduction" over an activity that is not out of points
               is a whole column of numbers that mean nothing. */
            <div className="fv-card" style={{ padding: "14px 16px" }}>
              <div className="fv-eyebrow" style={{ marginBottom: 8 }}>
                Complete?
              </div>
              <div className="fv-cipick">
                <button
                  type="button"
                  role="radio"
                  aria-checked={met === true}
                  className={`fv-cichoice${met === true ? " on" : ""}`}
                  onClick={() => setMet(true)}
                  disabled={releasing}
                >
                  <span className="fv-cititle">Complete</span>
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={met === false}
                  className={`fv-cichoice${met === false ? " on" : ""}`}
                  onClick={() => setMet(false)}
                  disabled={releasing}
                >
                  <span className="fv-cititle">Not complete</span>
                </button>
              </div>
              <p
                style={{
                  fontSize: "var(--fv-2xs)",
                  color: "var(--fv-muted)",
                  lineHeight: 1.5,
                  margin: "10px 0 0",
                }}
              >
                {subject.result.status === "scored"
                  ? canRelease
                    ? "Released. Pick the other answer and finalise again to change it."
                    : "Released by the instructor. Only they can change it now."
                  : subject.result.status === "needs_review"
                    ? canRelease
                      ? "Sent for review. Finalise to release it, or pick the other answer first."
                      : "Sent for review. Pick the other answer and send again to change it."
                    : canRelease
                      ? "Pick one, then finalise. You can change it afterwards."
                      : "Pick one, then send it for review. You can change it until it is released."}
              </p>
            </div>
          ) : null}

          {/* ------------------------------------------------ every question */}
          {/* The list is the screen. A stepper showed one question at a time
              and so never showed the submission — a grader could not tell what
              a person had scored without paging the whole way through and
              adding it up. Every question is here at once with what it scored
              and which line was picked; only the criteria of the one being
              marked open underneath, because twelve open ladders is a different
              way of seeing nothing.

              Opening a question is what "current" means here — the pages on the
              left follow it, and pick() and the criteria filter both read it —
              so the open row does not close on its own click. Something has to
              be current or the reader has nothing to point at.

              A completion activity has no ladder and no per-question score, so
              it gets labels only, and only when there is more than one: the
              list is then purely how you move the pages on the left, and one
              row would be a control that does nothing. */}
          {forCompletion && qCount < 2 ? null : (
            <div className="fv-card" style={{ padding: 0, overflow: "hidden" }}>
              {questions.map((q, i) => {
                // Clamped the same way `question` is, so the open row and the
                // pages on the left are never a question apart in the frame
                // after a question is deleted.
                const open = i === Math.min(qIdx, qCount - 1);
                const expanded = open && !folded && !forCompletion;
                const here = score?.per.get(keyOf(q)) ?? null;
                const line = ladder?.find((r) => r.id === pickOf(picks, q)) ?? null;
                return (
                  <div
                    key={keyOf(q)}
                    style={{ borderTop: i ? "1px solid var(--fv-neutral-200)" : undefined }}
                  >
                    <button
                      type="button"
                      aria-expanded={expanded}
                      onClick={() => {
                        setEditIdx(null);
                        if (open) setFolded((f) => !f);
                        else {
                          setFolded(false);
                          setQIdx(i);
                        }
                      }}
                      style={{
                        display: "flex",
                        alignItems: "baseline",
                        gap: 10,
                        width: "100%",
                        padding: "9px 14px",
                        border: 0,
                        background: open ? "var(--fv-cream-400)" : "transparent",
                        font: "inherit",
                        color: "inherit",
                        textAlign: "left",
                        cursor: "pointer",
                      }}
                    >
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ fontSize: "var(--fv-xs)", fontWeight: 600 }}>
                          Question {q.label}
                        </span>
                        {/* The line that was picked, which is the only sentence
                            this app holds about why the question scored what it
                            did — and the fastest way to spot the wrong pick
                            without opening anything. */}
                        {forCompletion ? null : (
                          <span
                            style={{
                              display: "block",
                              marginTop: 2,
                              fontSize: "var(--fv-2xs)",
                              lineHeight: 1.45,
                              color: line ? "var(--fv-muted)" : "var(--fv-amber)",
                            }}
                          >
                            {line ? line.description : "Not marked yet"}
                          </span>
                        )}
                      </span>
                      {forCompletion || !here ? null : (
                        <span
                          className="fv-num"
                          style={{ flex: "none", fontSize: "var(--fv-xs)", fontWeight: 600 }}
                        >
                          {line ? num(here.out - here.taken) : "—"} / {pts(here.out)}
                        </span>
                      )}
                      {forCompletion ? null : (
                        <span
                          aria-hidden="true"
                          style={{
                            flex: "none",
                            display: "inline-flex",
                            color: "var(--fv-muted)",
                            transform: expanded ? "rotate(90deg)" : "none",
                            transition: "transform 120ms ease",
                          }}
                        >
                          <FIcon name="chevronRight" size={15} />
                        </span>
                      )}
                    </button>

                    {expanded ? (
                      <div style={{ padding: "4px 10px 12px" }}>
                        <p
                          style={{
                            fontSize: "var(--fv-2xs)",
                            color: "var(--fv-muted)",
                            lineHeight: 1.5,
                            margin: "0 4px 8px",
                          }}
                        >
                          Pick one — what it awards is this question&rsquo;s score, out of{" "}
                          {pts(worthOf(activity, q))}.
                          {data.can.rubric ? " Use the pencil to edit a line." : ""}
                        </p>

                        {forQuestion == null ? (
                          <div className="fv-sub" style={{ margin: "0 4px" }}>
                            Loading the ladder…
                          </div>
                        ) : forQuestion.length === 0 ? (
                          // Only the instructor can write criteria, so say that
                          // rather than showing an empty list that looks broken.
                          <div className="fv-sub" style={{ margin: "0 4px", lineHeight: 1.6 }}>
                            No criteria have been written for this question yet. Ask the
                            instructor to open the <strong>Rubric</strong> on the activity and add
                            some, then reload.
                          </div>
                        ) : (
                          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                            {forQuestion.map((item, ri) => (
                              <RubricRow
                                key={item.id}
                                item={item}
                                worth={worthOf(activity, q)}
                                selected={pickedId === item.id}
                                editing={data.can.rubric && editIdx === ri}
                                canEdit={data.can.rubric}
                                onPick={() => void pick(item)}
                                onToggleEdit={() => setEditIdx(editIdx === ri ? null : ri)}
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
                          disabled={!ladder || !data.can.rubric}
                          title={
                            data.can.rubric
                              ? "Adds a line to this question's criteria"
                              : "Rubric editing comes with the grading permission, which is off for TFs on this course."
                          }
                        >
                          <FIcon name="add" size={14} />
                          Add rubric item
                        </button>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}

          <div className="fv-card" style={{ padding: "12px 14px" }}>
            <div className="fv-eyebrow" style={{ marginBottom: 6 }}>
              Comments
            </div>
            <textarea
              className="fv-ta"
              rows={3}
              // Says the audience, because the audience is the whole question
              // about a box like this — and because these were written for a
              // year into a box no student screen read.
              placeholder={`What you want this ${half === "team" ? "team" : "student"} to know…`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onBlur={() => void saveNote()}
            />
            <div
              className="fv-sub"
              style={{ marginTop: 6, fontSize: "var(--fv-2xs)", lineHeight: 1.5 }}
            >
              {/* The same gate the grade itself passes through: a note is often
                  typed days before release and edited in between, and a
                  half-finished judgement must not reach the person it is about
                  ahead of the mark it explains. */}
              Shown to {half === "team" ? "the team" : "them"} with their grade, once it is released.
            </div>
          </div>

          {/* The design never draws a "done" control — it only implies one via
              the waiting count. Grading has to be able to finish somewhere, so
              it sits here, quiet, and only once every question has a pick. */}
          <button
            type="button"
            className="fv-btn primary full"
            onClick={finish}
            // A completion mark stays finalisable AFTER release: changing the
            // answer and finalising again is how it is corrected, and a button
            // that greys out on "Released" would make the two buttons above it
            // decorative. A TF, though, stops at released: 0038 refuses them
            // that write, and a button that always fails is worse than none.
            disabled={
              releasing ||
              (forCompletion
                ? met === null || (!canRelease && subject.result.status === "scored")
                : !answeredAll || subject.result.status === (canRelease ? "scored" : "needs_review") ||
                  (!canRelease && subject.result.status === "scored"))
            }
            title={releaseTitle({
              forCompletion,
              canRelease,
              met,
              status: subject.result.status,
              answeredAll,
              qCount,
            })}
          >
            {releaseLabel({
              releasing,
              forCompletion,
              canRelease,
              status: subject.result.status,
              // The week's 30 where there is one: the same figure the header
              // shows, so the two cannot say different things.
              earned: week ? (week.earned ?? 0) : (score?.earned ?? 0),
              outOf: week ? week.outOf : pointsTotal(activity),
            })}
          </button>

          {confirmEarly && subject ? (
            <ConfirmDialog
              title="Release before the week is fully marked?"
              tone="primary"
              body={
                <>
                  <div>Not marked yet for {subject.name}:</div>
                  <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
                    {unmarked.map((p) => (
                      <li key={p.activity.id}>{p.label}</li>
                    ))}
                  </ul>
                  <div style={{ marginTop: 8 }}>
                    Releasing now sends {num(week?.earned ?? 0)} / {pts(week?.outOf ?? 0)}, and the
                    total will move when the rest is marked.
                  </div>
                </>
              }
              confirmLabel="Release anyway"
              busyLabel="Releasing…"
              busy={releasing}
              onCancel={() => setConfirmEarly(false)}
              onConfirm={() => void release()}
            />
          ) : null}

          {/* Where the class stands, next to the control that moves it. The
              button above finishes one person; everything below this is about
              the other eleven, and the count belongs with them. */}
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
            {/* The missing fact. "1 of 12 marked" counts the whole class, while
                everything below counts only the people who handed something in
                — so the two disagree unless somebody says why. They do not
                contradict: nine of twelve simply have nothing to mark yet. */}
            {elsewhere ? (
              <div
                className="fv-sub"
                style={{ marginTop: 6, fontSize: "var(--fv-2xs)", lineHeight: 1.5 }}
              >
                Everyone is ready to mark: the answers are in {elsewhere}, so nothing has to be
                handed in here first.
              </div>
            ) : stat && stat.total > stat.submitted ? (
              <div
                className="fv-sub"
                style={{ marginTop: 6, fontSize: "var(--fv-2xs)", lineHeight: 1.5 }}
              >
                {stat.total - stat.submitted} of {stat.total} haven&rsquo;t handed in yet, so there
                is nothing to mark for them.
              </div>
            ) : null}
          </div>

          {/* ------------------------------------------------ release in bulk */}
          <ReleaseMany
            subjects={subjects}
            mode={canRelease ? "release" : "review"}
            forCompletion={forCompletion}
            noun={half === "team" ? "team" : "student"}
            // The same marks the question list reads, so "ready" here and a lit
            // Release button there can never disagree about one submission.
            marks={marks}
            questions={questions}
            onDone={onChanged}
            onError={onError}
          />

          {/* Only the person steps now. The question stepper was the thing
              being complained about — the list above IS the way through the
              questions, and a second control moving the same cursor would just
              be somewhere else to look. The arrow keys still step it. */}
          <div className="fv-card" style={{ padding: "12px 14px" }}>
            <Stepper
              label={`${half === "team" ? "Team" : "Student"} ${stIdx + 1} of ${subjects.length}`}
              onPrev={() => {
                setEditIdx(null);
                setStIdx((i) => Math.max(0, i - 1));
                setQIdx(0);
              }}
              onNext={() => {
                setEditIdx(null);
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
  worth,
  selected,
  editing,
  canEdit,
  onPick,
  onToggleEdit,
  onCommit,
}: {
  item: RubricItem;
  /**
   * What the question is out of. A line is STORED as a deduction and READ as
   * what it awards — the same conversion the Rubric page makes — so "Missing
   * markup" reads +0 here as it does there, not the −2 the row holds.
   */
  worth: number;
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
  const award = awardForDeduction(worth, item.deduction);

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
    // Typed as an award, stored as a deduction. Out of range is refused, not
    // clamped, the same as the Rubric page: pulling a 5 back to 3 would store
    // a rung nobody wrote.
    const rawNum = (numRef.current?.textContent ?? "").replace(/[^0-9.]/g, "");
    const n = Number.parseFloat(rawNum);
    const deduction = awardFits(worth, n) ? deductionForAward(worth, n) : saved.current.deduction;
    const description = (descRef.current?.textContent ?? "").trim() || saved.current.description;

    if (deduction === saved.current.deduction && description === saved.current.description) return;
    saved.current = { description, deduction };
    // A contentEditable is not React-controlled, so a rejected value would sit
    // on screen looking saved. Write the accepted one back.
    if (numRef.current && document.activeElement !== numRef.current) {
      numRef.current.textContent = String(awardForDeduction(worth, deduction));
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
            color:
              award >= worth
                ? "var(--fv-emerald)"
                : award <= 0
                  ? "var(--fv-destructive)"
                  : "var(--fv-navy)",
          }}
        >
          {editing ? String(award) : `+ ${award} ${award === 1 ? "pt" : "pts"}`}
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

/**
 * Release a batch of marks, choosing who.
 *
 * Collapsed to one line until opened, because the common case is releasing the
 * person in front of you and this must not compete with the button above it.
 *
 * Selection is a checkbox per subject rather than "release everything": a class
 * is rarely all finished at once, and the honest shape of "these are done, those
 * are not" is a list you tick. "All ungraded" is offered as a shortcut because
 * it is what people mean most of the time, and it selects rather than acts — you
 * still see who you are about to release before you do it.
 *
 * One write per row, not a batched update. releaseMany collects failures rather
 * than throwing, so a row the database refuses does not abandon the twenty after
 * it, and the count afterwards says exactly what happened.
 */
/** Where one submission stands, for the list that decides what may go out. */
type Readiness = "released" | "sent" | "ready" | "partial" | "none";

function ReleaseMany({
  subjects,
  mode,
  forCompletion,
  noun,
  marks,
  questions,
  onDone,
  onError,
}: {
  subjects: Subject[];
  /**
   * "release" sends grades to students; "review" sends them to the instructor
   * (0038). Same list, same ticks — only the verb and the write differ.
   */
  mode: "release" | "review";
  forCompletion: boolean;
  noun: string;
  marks: Map<string, Map<string, string>>;
  questions: ActivityQuestion[];
  onDone: () => void;
  onError: (e: unknown) => void;
}) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const qCount = questions.length;

  /**
   * How far each submission has been marked.
   *
   * Counted question by question through the same `pickOf` the question list
   * uses, never by how many mark rows the submission carries: a mark left
   * behind by a question deleted before 0026 still sits there, and counting
   * rows was what let a grade go out with a question nobody had looked at.
   *
   * A completion activity has nothing to be part-way through — Finalise is
   * both the mark and the release — so every unreleased row is `ready` and
   * the button says out loud what releasing them writes.
   */
  const state = useMemo(() => {
    const out = new Map<string, { at: Readiness; answered: number }>();
    for (const s of subjects) {
      if (s.result.status === "scored") {
        out.set(s.result.id, { at: "released", answered: qCount });
        continue;
      }
      // Sent for review: for the instructor it is ready to go out; for the TF
      // it is done, and re-sending it is only for a corrected mark.
      if (s.result.status === "needs_review") {
        out.set(s.result.id, { at: mode === "release" ? "ready" : "sent", answered: qCount });
        continue;
      }
      if (forCompletion) {
        out.set(s.result.id, { at: "ready", answered: 0 });
        continue;
      }
      const picks = marks.get(s.result.id) ?? new Map<string, string>();
      const answered = questions.reduce((n, q) => (pickOf(picks, q) ? n + 1 : n), 0);
      out.set(s.result.id, {
        at: answered >= qCount && qCount > 0 ? "ready" : answered > 0 ? "partial" : "none",
        answered,
      });
    }
    return out;
  }, [subjects, marks, questions, qCount, forCompletion, mode]);

  const atOf = (id: string): Readiness => state.get(id)?.at ?? "none";

  // Released rows stay tickable: re-releasing is how a corrected mark reaches a
  // student, and locking them would make that impossible from here. What is NOT
  // tickable is work nobody has finished marking — that is the whole point. A
  // TF cannot touch a released row at all (0038), but may re-send one.
  const canPick = (id: string) => {
    const at = atOf(id);
    if (mode === "review") return at === "ready" || at === "sent";
    return at === "ready" || at === "released";
  };

  const ready = useMemo(
    () => subjects.filter((s) => atOf(s.result.id) === "ready"),
    [subjects, state],
  );
  const unready = useMemo(
    () => subjects.filter((s) => { const a = atOf(s.result.id); return a === "partial" || a === "none"; }),
    [subjects, state],
  );

  const toggle = (id: string) => {
    if (!canPick(id)) return;
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const release = async (rows: Subject[]) => {
    if (!rows.length) return;
    setBusy(true);
    setNote(null);
    try {
      // Completion released in bulk is always COMPLETE. "Not complete" is a
      // judgement about one person's work, and a checkbox list is the wrong
      // place to make twenty of them at once — so the button says so rather
      // than leaving it to be discovered.
      //
      // Except a row that already carries an answer — one sent for review as
      // Not complete is released as what was sent, not silently upgraded.
      const batch = rows.map((r) => ({
        id: r.result.id,
        met: r.result.status === "needs_review" ? (r.result.ci_met ?? true) : true,
      }));
      const verb = mode === "release" ? "Released" : "Sent";
      const { done, failed } =
        mode === "release"
          ? await releaseMany(batch, forCompletion).then((x) => ({ done: x.released, failed: x.failed }))
          : await sendManyForReview(batch, forCompletion).then((x) => ({ done: x.sent, failed: x.failed }));
      setPicked(new Set());
      setNote(
        failed.length
          ? `${verb} ${done}. ${failed.length} did not go — reload and try those again.`
          : `${verb} ${done}.`,
      );
      onDone();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };

  if (!subjects.length) return null;

  const pickedRows = subjects.filter((s) => picked.has(s.result.id));

  return (
    <div className="fv-card" style={{ padding: "10px 12px" }}>
      <button
        type="button"
        className="fv-btn ghost sm full"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{ justifyContent: "space-between" }}
      >
        <span>{mode === "release" ? "Release grades" : "Send for review"}</span>
        {/* Counts THIS list, which is only the people who handed in. */}
        <span className="fv-sub fv-num" style={{ fontSize: "var(--fv-2xs)" }}>
          {ready.length
            ? `${ready.length} ready`
            : unready.length
              ? `${unready.length} not marked`
              : mode === "release"
                ? "all released"
                : "all sent"}
        </span>
      </button>

      {open ? (
        <>
          {/* One press for the ordinary case. The number is in the label because
              a button that releases "all" of something must say how many that
              is before it is pressed, not after. */}
          <button
            type="button"
            className="fv-btn primary sm full"
            style={{ marginTop: 10 }}
            disabled={busy || !ready.length}
            onClick={() => void release(ready)}
          >
            {busy
              ? mode === "release"
                ? "Releasing…"
                : "Sending…"
              : !ready.length
                ? mode === "release"
                  ? "Nothing is ready to release"
                  : "Nothing is ready to send"
                : mode === "review"
                  ? forCompletion
                    ? `Mark all ${ready.length} Complete and send for review`
                    : `Send all ${ready.length} graded for review`
                  : forCompletion
                    ? `Mark all ${ready.length} Complete and release`
                    : `Release all ${ready.length} graded`}
          </button>

          {unready.length && !forCompletion ? (
            <div
              className="fv-sub"
              style={{ marginTop: 6, fontSize: "var(--fv-2xs)", lineHeight: 1.5 }}
            >
              {unready.length} {unready.length === 1 ? noun : `${noun}s`} left out — their marking
              is not finished, so there is no grade to send.
            </div>
          ) : null}

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              margin: "12px 0 4px",
              borderTop: "1px solid var(--fv-neutral-200)",
              paddingTop: 10,
            }}
          >
            <span className="fv-eyebrow" style={{ flex: 1 }}>
              Or pick who goes
            </span>
            {picked.size ? (
              <button
                type="button"
                className="fv-btn ghost sm"
                disabled={busy}
                onClick={() => setPicked(new Set())}
              >
                Clear
              </button>
            ) : null}
          </div>

          <div style={{ maxHeight: 220, overflowY: "auto", margin: "0 -4px" }}>
            {subjects.map((s) => {
              const at = atOf(s.result.id);
              const answered = state.get(s.result.id)?.answered ?? 0;
              const pickable = canPick(s.result.id);
              const why =
                at === "released"
                  ? "released"
                  : at === "sent"
                    ? "sent for review"
                    : at === "ready"
                      ? s.result.status === "needs_review"
                        ? "sent for review"
                        : forCompletion
                          ? "ready"
                          : "marked"
                      : at === "partial"
                        ? `${answered} of ${qCount} marked`
                        : "not marked";
              return (
                <label
                  key={s.result.id}
                  title={
                    pickable
                      ? undefined
                      : at === "released"
                        ? "Released by the instructor"
                        : "Finish marking this one first"
                  }
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "5px 6px",
                    borderRadius: "var(--fv-r-md)",
                    fontSize: "var(--fv-xs)",
                    cursor: busy || !pickable ? "default" : "pointer",
                    opacity: pickable ? 1 : 0.55,
                    color: at === "released" ? "var(--fv-muted)" : "var(--fv-navy)",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={picked.has(s.result.id)}
                    disabled={busy || !pickable}
                    onChange={() => toggle(s.result.id)}
                  />
                  <FAvatar name={s.name} tint={s.tint} size={18} />
                  <span className="fv-ellip" style={{ flex: 1, minWidth: 0 }}>
                    {s.name}
                  </span>
                  <span
                    className="fv-sub"
                    style={{
                      fontSize: "var(--fv-2xs)",
                      whiteSpace: "nowrap",
                      color: at === "none" || at === "partial" ? "var(--fv-amber)" : undefined,
                    }}
                  >
                    {why}
                  </span>
                </label>
              );
            })}
          </div>

          <button
            type="button"
            className="fv-btn outline sm full"
            style={{ marginTop: 10 }}
            disabled={busy || !picked.size}
            onClick={() => void release(pickedRows)}
          >
            {busy
              ? mode === "release"
                ? "Releasing…"
                : "Sending…"
              : picked.size
                ? `${mode === "release" ? "Release" : "Send"} ${picked.size} ${picked.size === 1 ? noun : noun + "s"}${mode === "release" ? "" : " for review"}`
                : `Tick a ${noun} first`}
          </button>

          {note ? (
            <div
              role="status"
              className="fv-sub"
              style={{ marginTop: 8, fontSize: "var(--fv-2xs)", lineHeight: 1.5 }}
            >
              {note}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

