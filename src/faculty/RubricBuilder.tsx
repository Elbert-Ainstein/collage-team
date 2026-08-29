"use client";

// The rubric builder: the assignment on the left, its criteria on the right.
//
// The shape Gradescope uses, for the reason Gradescope uses it — criteria are
// written WHILE reading the question they mark, so the document has to stay on
// screen. Nothing here is a draft: every edit writes straight to the same
// rubric_items rows the grading screen marks against.
//
// A question is a NAME and a place in the order. It used to be only "1", "2",
// "2a", and three separate things read structure back out of that text; they
// now ask `numbered()` first and fall back to `position`, which is what has
// actually ordered this list all along. Kelly's questions are called
// "Challenge Problem 1: At Home Effort", and criteria are still filed under
// them by that name (0012), so renaming one has to carry them with it.
//
// A criterion is WRITTEN as what it awards and STORED as what it deducts. The
// activity still has ONE total and that is still the only number a score comes
// off; 0034 lets a question say what IT is out of, which is the number the
// award is read against — the same "+1" is a deduction of 2 on a 3-point
// question and of 1 on a 2-point one. All of that conversion is in model.ts.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Activity, ActivityQuestion, FileRef, RubricItem } from "@/checkins/types";
import { isCompletion } from "@/checkins/types";
import { updateActivity } from "@/checkins/data";
import { RESIGN_MS } from "@/checkins/storage";
import { restampReleased } from "./facultyData";
import {
  activityFileUrls,
  addActivityFile,
  addQuestion,
  addRubricItem,
  countMarksForRubricItem,
  deleteQuestion,
  deleteRubricItem,
  ensureQuestions,
  ensureRubric,
  removeActivityFileAt,
  seedRubricTemplate,
  setQuestionPoints,
  setRubricQuestion,
  updateQuestion,
  updateRubricItem,
} from "./facultyData";
import { ATTACHMENT_ACCEPT, kindOf, refuseFile } from "./activityFiles";
import { COMBO_TEMPLATE } from "./comboRubric";
import {
  awardFits,
  awardForDeduction,
  deductionForAward,
  pointsTotal,
  tallyQuestionPoints,
  worthOf,
  type PointedQuestion,
} from "./model";
import { ConfirmDialog } from "./ConfirmDialog";
import { FIcon } from "./icons";
import { NEW_ACTIVITY_STEPS, Steps } from "./Steps";

const unit = (n: number) => (n === 1 ? "pt" : "pts");

/** "2b" -> 2. A label that does not start with a number belongs to nothing. */
function baseOf(label: string): number | null {
  const n = Number.parseInt(label, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Whether a label is still running on the numbering, rather than being a name.
 *
 * Everything that used to parse a label asks this first. A question keeps its
 * place in the order because the order is `position` — renumbered on every add
 * and delete by facultyData, and what `groupsFor` walks — and never the text.
 * baseOf only ever fed three things: what the NEXT label is called, whether a
 * block is drawn as a sub-question, and how strays are sorted. None of those
 * can be read out of "Challenge Problem 1: At Home Effort", so each of them
 * falls back rather than mis-parsing it into question 1.
 */
function numbered(label: string): boolean {
  return /^\d+$/.test(label);
}

/**
 * The two shapes a sub-question's name takes: "2a", and "Tutorial 1 (a)".
 *
 * The old test was "not exactly its own base number", which every free-text
 * name passes — so naming a question drew it indented and took its
 * Sub-question button away.
 */
function isSubLabel(label: string): boolean {
  return /^\d+[a-z]+$/i.test(label) || /\s\([a-z]\)$/i.test(label);
}

/** What a block is called: "Question 2", or just the name she typed. */
function headingFor(label: string): string {
  return /^\d/.test(label) ? `Question ${label}` : label;
}

/** "2" then "2a" then "2b" — numbers before their own sub-questions. */
function byLabel(a: string, b: string): number {
  const na = baseOf(a) ?? 0;
  const nb = baseOf(b) ?? 0;
  if (na !== nb) return na - nb;
  return a.localeCompare(b);
}

/**
 * The name a new question arrives with, before anyone types over it.
 *
 * Counted from how many questions there are rather than from 1: once all six
 * are named, every small number is "free" again, and handing her a seventh
 * question called "1" underneath six named ones is a worse guess than "7".
 */
function nextTop(taken: string[]): string {
  const used = new Set(taken);
  for (let n = taken.length + 1; n <= taken.length + 500; n += 1) {
    if (!used.has(String(n))) return String(n);
  }
  return String(taken.length + 1);
}

/**
 * The next free sub-question of one question: 2a, 2b, 2c…
 *
 * A named parent has no number to hang a letter off, so its sub-questions read
 * "Tutorial Screen 1 (a)" instead. Either way the row goes directly under its
 * parent by position, which is the part that actually places it.
 */
function nextSub(parent: ActivityQuestion, taken: string[]): string {
  const used = new Set(taken);
  const stem = baseOf(parent.label);
  const make = (letter: string) =>
    numbered(parent.label) && stem != null ? `${stem}${letter}` : `${parent.label} (${letter})`;
  for (let i = 0; i < 26; i += 1) {
    const label = make(String.fromCharCode(97 + i));
    if (!used.has(label)) return label;
  }
  return make("z");
}

interface Group {
  /** The question row, or null for the ladder that applies to every question. */
  question: PointedQuestion | null;
  /** null is the shared ladder written before per-question criteria existed. */
  label: string | null;
  heading: string;
  items: RubricItem[];
  /**
   * Criteria naming a question that is no longer on the rubric. Shown rather
   * than hidden: they are still gradeable rows, and silently dropping them
   * would leave marks nobody can account for.
   */
  orphan?: boolean;
}

/**
 * Every block the right pane shows: the shared ladder if there is one, then the
 * questions in the order faculty put them in.
 *
 * Questions with no criteria are still listed — an empty question is the whole
 * reason to be on this screen, and hiding it would leave nowhere to press.
 */
function groupsFor(questions: PointedQuestion[], items: RubricItem[]): Group[] {
  const byQuestion = new Map<string, RubricItem[]>();
  const shared: RubricItem[] = [];
  for (const item of items) {
    const label = item.question_label;
    if (!label) {
      shared.push(item);
      continue;
    }
    byQuestion.set(label, [...(byQuestion.get(label) ?? []), item]);
  }

  const out: Group[] = [];
  if (shared.length) {
    out.push({
      question: null,
      label: null,
      heading: "Applies to every question",
      items: shared,
    });
  }

  const named = new Set<string>();
  for (const q of questions) {
    named.add(q.label);
    out.push({
      question: q,
      label: q.label,
      heading: headingFor(q.label),
      items: byQuestion.get(q.label) ?? [],
    });
  }

  for (const label of [...byQuestion.keys()].filter((l) => !named.has(l)).sort(byLabel)) {
    out.push({
      question: null,
      label,
      heading: headingFor(label),
      items: byQuestion.get(label) ?? [],
      orphan: true,
    });
  }
  return out;
}

/** The heading of one question: what it is called, and what it is out of. */
function QuestionHead({
  group,
  canEdit,
  scored,
  total,
  onRename,
  onPoints,
  onSub,
  onDelete,
}: {
  group: Group;
  canEdit: boolean;
  /** Out of points. A completion activity has no per-question worth to set. */
  scored: boolean;
  /** The activity total — what an unpointed question's criteria come off. */
  total: number;
  /** Returns what is wrong with the name, or null when it was accepted. */
  onRename: (label: string) => string | null;
  onPoints: (points: number | null) => void;
  onSub: () => void;
  onDelete: () => void;
}) {
  const q = group.question;
  const [label, setLabel] = useState(q?.label ?? "");
  const [pts, setPts] = useState(q?.points == null ? "" : String(q.points));
  const [warn, setWarn] = useState<string | null>(null);

  useEffect(() => setLabel(q?.label ?? ""), [q?.label]);
  useEffect(() => setPts(q?.points == null ? "" : String(q.points)), [q?.points]);

  const isSub = q != null && isSubLabel(q.label);

  if (!q) {
    return (
      <div className="fv-qhead">
        <span className="fv-qname" style={{ padding: 0 }}>
          {group.heading}
        </span>
        <span className="fv-badge">{group.orphan ? "not on the rubric" : "shared"}</span>
      </div>
    );
  }

  const commitPts = () => {
    const raw = pts.trim();
    if (raw === "") {
      if (q.points != null) onPoints(null);
      return;
    }
    const parsed = Number.parseFloat(raw.replace(/[^\d.]/g, ""));
    if (!Number.isFinite(parsed) || parsed < 0) {
      setPts(q.points == null ? "" : String(q.points));
      return;
    }
    const next = Math.round(parsed * 1e6) / 1e6;
    setPts(String(next));
    if (next !== q.points) onPoints(next);
  };

  return (
    <>
      <div className={`fv-qhead${isSub ? " sub" : ""}`}>
        {/* "Question 2" reads right; "Question Challenge Problem 1: At Home
            Effort" does not, so the word goes away once she has named it. */}
        {headingFor(q.label) !== q.label ? (
          <span className="fv-sub" style={{ flex: "none", fontSize: "var(--fv-2xs)" }}>
            Question
          </span>
        ) : null}
        <input
          className="fv-qname"
          style={{ flex: 1, minWidth: 0 }}
          aria-label="Question name"
          placeholder="Name this question"
          disabled={!canEdit}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={() => {
            const next = label.trim();
            // An empty label would address criteria that can never be found
            // again, so the field goes back to what is stored. A duplicate is
            // refused by the caller, which knows the other questions — and her
            // typing STAYS on screen with the reason, since reverting it would
            // throw away a whole sentence she has to type again to fix.
            if (!next || next === q.label) {
              setLabel(q.label);
              setWarn(null);
              return;
            }
            setWarn(onRename(next));
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              setLabel(q.label);
              setWarn(null);
              e.currentTarget.blur();
            }
          }}
        />
        {/* What THIS question is out of (0034). Empty is unset, not zero: its
            criteria come off the activity's total, which is what every criterion
            in the course did before there was anywhere else to put a number. */}
        {scored ? (
          <span
            style={{ display: "flex", alignItems: "center", gap: 4, flex: "none" }}
            title={`Blank means this question has no points of its own — its criteria come off the activity's ${total}.`}
          >
            <span className="fv-sub" style={{ fontSize: "var(--fv-2xs)" }}>
              out of
            </span>
            <input
              className="fv-in quiet fv-num"
              style={{ width: 44, padding: "3px 5px", textAlign: "right" }}
              inputMode="decimal"
              placeholder="—"
              aria-label={`Points for “${q.label}”`}
              disabled={!canEdit}
              value={pts}
              onChange={(e) => setPts(e.target.value)}
              onBlur={commitPts}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") {
                  setPts(q.points == null ? "" : String(q.points));
                  e.currentTarget.blur();
                }
              }}
            />
            <span className="fv-sub" style={{ fontSize: "var(--fv-2xs)" }}>
              pts
            </span>
          </span>
        ) : null}
        {canEdit && !isSub ? (
          <button
            type="button"
            className="fv-btn ghost sm"
            style={{ height: 22, padding: "0 8px", fontSize: "var(--fv-2xs)", flex: "none" }}
            title={`Add a sub-question under ${headingFor(q.label)}`}
            onClick={onSub}
          >
            <FIcon name="add" size={13} />
            Sub-question
          </button>
        ) : null}
        {canEdit ? (
          <button
            type="button"
            className="fv-iconbtn"
            style={{ width: 22, height: 22, flex: "none" }}
            aria-label={`Delete ${headingFor(q.label)}`}
            onClick={onDelete}
          >
            <FIcon name="close" size={13} />
          </button>
        ) : null}
      </div>
      {warn ? (
        <div
          className="fv-sub"
          style={{
            padding: "0 12px 8px 26px",
            fontSize: "var(--fv-2xs)",
            lineHeight: 1.5,
            color: "var(--fv-destructive)",
          }}
        >
          {warn}
        </div>
      ) : null}
    </>
  );
}

/**
 * One rung: what it awards, and what earns it. Both save on blur.
 *
 * She types "+1"; the row stores a deduction, because that is what
 * recompute_result_score subtracts. `worth` is the QUESTION's, never the
 * activity's — the identical "+1" is a deduction of 2 on her 3-point At Home
 * Effort and of 1 on her 2-point Mark-up.
 */
function CriterionRow({
  item,
  worth,
  canEdit,
  onCommit,
  onDelete,
}: {
  item: RubricItem;
  worth: number;
  canEdit: boolean;
  onCommit: (patch: { description?: string; deduction?: number }) => void;
  onDelete: () => void;
}) {
  const award = awardForDeduction(worth, item.deduction);
  const [desc, setDesc] = useState(item.description);
  const [pts, setPts] = useState(String(award));
  const [warn, setWarn] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement | null>(null);

  // Adopt a value that changed underneath — a failed write is reverted by the
  // parent, and the field has to show what was actually stored. Re-pointing the
  // question moves this too: the deduction has not changed, but what it awards
  // has, which is the shift she needs to see rather than be told about.
  useEffect(() => setDesc(item.description), [item.description]);
  useEffect(() => setPts(String(award)), [award]);

  // Her longest rung — the At Home Effort +3 — runs to about 180 characters,
  // and in a one-line box that is a slot showing eight words of it at a time.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [desc]);

  const commitPts = () => {
    // The minus stays in: a rung stored before its question was re-pointed
    // DOWN reads as a negative award, and stripping the sign would turn a
    // focus and a tab into a silent rewrite of somebody's grading.
    const parsed = Number.parseFloat(pts.replace(/[^\d.-]/g, ""));
    if (!Number.isFinite(parsed)) {
      setPts(String(award));
      setWarn(null);
      return;
    }
    if (!awardFits(worth, parsed)) {
      // Not clamped into range: pulling a 5 back to 3 would store a rung she
      // never wrote, and she would find out from a transcript.
      setPts(String(award));
      setWarn(
        parsed === award
          ? null
          : `A rung awards between 0 and the ${worth} ${unit(worth)} this question is out of.`,
      );
      return;
    }
    setWarn(null);
    setPts(String(parsed));
    const next = deductionForAward(worth, parsed);
    if (next !== item.deduction) onCommit({ deduction: next });
  };

  const commitDesc = () => {
    const next = desc.replace(/\s+/g, " ").trim() || item.description;
    setDesc(next);
    if (next !== item.description) onCommit({ description: next });
  };

  return (
    <div className="fv-crit" style={{ flexWrap: "wrap" }}>
      <span
        className="fv-critpts"
        style={{ display: "flex", alignItems: "center", gap: 3, justifyContent: "flex-end" }}
      >
        <span aria-hidden="true" style={{ color: "var(--fv-muted)" }}>
          +
        </span>
        <input
          className="fv-in quiet fv-num"
          style={{ width: 40, padding: "3px 5px", textAlign: "right" }}
          inputMode="decimal"
          aria-label={`Points awarded for “${item.description}”`}
          disabled={!canEdit}
          value={pts}
          onChange={(e) => setPts(e.target.value)}
          onBlur={commitPts}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
        />
        <span style={{ fontSize: "var(--fv-2xs)", color: "var(--fv-muted)" }}>{unit(award)}</span>
      </span>

      <textarea
        ref={box}
        className="fv-in quiet fv-critdesc"
        style={{
          padding: "3px 6px",
          fontSize: "var(--fv-sm)",
          resize: "none",
          overflow: "hidden",
          lineHeight: 1.45,
          minHeight: 26,
        }}
        rows={1}
        aria-label="What earns these points"
        placeholder="What earns these points?"
        disabled={!canEdit}
        value={desc}
        onChange={(e) => setDesc(e.target.value)}
        onBlur={commitDesc}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
      />

      {/* The base ladder from 0007 is fixed — only criteria written here go. */}
      {canEdit && item.is_custom ? (
        <button
          type="button"
          className="fv-iconbtn"
          style={{ width: 24, height: 24, flex: "none", borderRadius: "var(--fv-r-md)" }}
          aria-label={`Delete criterion “${item.description}”`}
          onClick={onDelete}
        >
          <FIcon name="close" size={14} />
        </button>
      ) : null}

      {warn ? (
        <div
          className="fv-sub"
          style={{
            flexBasis: "100%",
            paddingLeft: 72,
            fontSize: "var(--fv-2xs)",
            lineHeight: 1.5,
            color: "var(--fv-destructive)",
          }}
        >
          {warn}
        </div>
      ) : null}
    </div>
  );
}

/** How an attachment is addressed on the row — see removeActivityFileAt. */
const keyOf = (ref: FileRef) => ref.path ?? ref.name;

/**
 * The controls in the pane's head. Small, but 24px is the floor a pointer
 * target is allowed to be (WCAG 2.2 SC 2.5.8) and these were sitting at 22.
 */
const HEAD_BTN: React.CSSProperties = { height: 24, padding: "0 8px", fontSize: "var(--fv-2xs)" };

/**
 * Which attachment this pane opens on.
 *
 * The first PDF, and only then the first attachment. An activity carries a
 * LIST now, so files[0] is merely whichever went up first — which can easily be
 * a photograph of the board sitting in front of the brief every criterion on
 * the right is being written against. Past the PDF nothing is ranked: the order
 * is the instructor's.
 */
function openingFile(held: readonly FileRef[]): FileRef | null {
  return held.find((ref) => kindOf(ref) === "pdf") ?? held[0] ?? null;
}

/** The middle of the pane when there is a sentence to read rather than a document. */
function PaneNote({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        overflowY: "auto",
      }}
    >
      {children}
    </div>
  );
}

/** The left pane: whatever document the criteria are being written against. */
function DocumentPane({
  activity,
  canEdit,
  onChanged,
  onError,
}: {
  activity: Activity;
  canEdit: boolean;
  onChanged: () => void | Promise<void>;
  onError: (e: unknown) => void;
}) {
  const held = useMemo<FileRef[]>(() => activity.files ?? [], [activity.files]);
  // Which one the grader switched to, by key. Null means "whichever this pane
  // opens on" — and so does a key that has stopped being on the row, which is
  // what lands the view somewhere sensible after the file on screen is removed.
  const [chosen, setChosen] = useState<string | null>(null);
  const [urls, setUrls] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<"" | "uploading" | "removing">("");
  const [refused, setRefused] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  // The ref Remove was pressed against, carried from the press to the answer.
  // The dialog deletes THIS attachment — not whatever the pane is showing by
  // the time somebody confirms it.
  const [confirming, setConfirming] = useState<FileRef | null>(null);
  const picker = useRef<HTMLInputElement | null>(null);
  // Set while the picker is open on behalf of Replace: the attachment the
  // incoming file stands in for, or null when one is simply being added. A ref
  // because the picker answers in its own event, long after the click.
  const replacing = useRef<FileRef | null>(null);

  const shown = useMemo(
    () => held.find((ref) => keyOf(ref) === chosen) ?? openingFile(held),
    [held, chosen],
  );
  const url = shown?.path ? (urls.get(shown.path) ?? null) : null;

  const pathKey = held
    .map((ref) => ref.path)
    .filter((p): p is string => Boolean(p))
    .join("\n");

  // Signed URLs are minted per view and expire; none of them is ever stored on
  // the row. One batch call for the whole list, not one per attachment:
  // switching between the two halves of a two-file brief should not be a round
  // trip, and six serial calls to open one pane is the load this app spent a
  // perf pass getting rid of.
  //
  // Keyed on the PATHS, never on `held`. onChanged refetches the course after
  // every write and on the way back from every other screen, and activity.files
  // arrives as a fresh array carrying the identical refs — an effect keyed on
  // that identity re-signs on each one, and because a new URL is a new src the
  // iframe underneath is torn down and rebuilt, losing the page the grader was
  // on. Same shape as ActivityDetail's list, deliberately.
  useEffect(() => {
    if (!pathKey) {
      setUrls(new Map());
      setLoading(false);
      return;
    }
    let live = true;
    setLoading(true);
    // Rebuilt from the key rather than read out of the closure, so there is no
    // second answer to "which paths is this run about" that can drift from the
    // dependency. activityFileUrls reads nothing off a ref but its path.
    const refs = pathKey.split("\n").map((path) => ({ name: path, path }));
    const sign = () => {
      activityFileUrls(refs)
        .then((next) => {
          if (live) setUrls(next);
        })
        .catch((e) => {
          if (live) onError(e);
        })
        .finally(() => {
          if (live) setLoading(false);
        });
    };
    sign();
    // An hour of reading a brief and writing criteria against it is a normal
    // sitting on this screen, and a signed URL does not last one. Without this
    // the document silently dies mid-rubric and the only cure is a reload.
    const tick = window.setInterval(sign, RESIGN_MS);
    return () => {
      live = false;
      window.clearInterval(tick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathKey, onError]);

  const take = useCallback(
    (picked: File | null | undefined, swap: FileRef | null) => {
      if (!picked) return;
      setRefused(null);
      // Asked here first so a 40 MB video is refused in the time it takes to
      // say so, rather than after carrying it. addActivityFile asks the same
      // question again against a fresh read, and that is the one that enforces.
      const no = refuseFile(picked, held.length);
      if (no) {
        setRefused(no);
        return;
      }
      setBusy("uploading");
      // Replace ADDS and only then drops, and drops BY PATH. The other order
      // loses the instructor's document for good if the upload then fails, and
      // dropping by position would take whichever attachment is first on the
      // row — which since this pane opens on the first PDF is very often not
      // the one on screen. Two costs, both deliberate: the replacement lands at
      // the end of the list rather than in the slot it replaced, and Replace is
      // refused outright on an activity already holding the maximum, because
      // for a moment there would be one too many.
      addActivityFile(activity, picked)
        .then(async (next) => {
          const added: FileRef | undefined = next[next.length - 1];
          if (swap) await removeActivityFileAt(activity, keyOf(swap));
          // Show what was just uploaded, whichever one it stood in for.
          setChosen(added ? keyOf(added) : null);
          await onChanged();
        })
        .catch(onError)
        .finally(() => setBusy(""));
    },
    [activity, held.length, onChanged, onError],
  );

  const pick = (swap: FileRef | null) => {
    replacing.current = swap;
    picker.current?.click();
  };

  const drop = (target: FileRef) => {
    setBusy("removing");
    removeActivityFileAt(activity, keyOf(target))
      .then(() => {
        setChosen(null);
        return onChanged();
      })
      .catch(onError)
      .finally(() => {
        setBusy("");
        setConfirming(null);
      });
  };

  return (
    <div className="fv-rubricdoc">
      <div className="fv-panehead">
        <span
          className="fv-eyebrow"
          style={{
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            // A filename is not an eyebrow label, and upper-casing it disagrees
            // with the switcher below, which shows the same name as it is.
            textTransform: shown ? "none" : undefined,
          }}
        >
          {shown ? shown.name : "Assignment document"}
        </span>
        {shown?.size ? (
          <span className="fv-sub fv-num" style={{ fontSize: "var(--fv-2xs)" }}>
            {shown.size}
          </span>
        ) : null}
        {url ? (
          <a className="fv-btn ghost sm" style={HEAD_BTN} href={url} target="_blank" rel="noreferrer">
            <FIcon name="openInNew" size={13} />
            Open
          </a>
        ) : null}
        {canEdit && shown ? (
          // Both act on `shown`, the attachment named to their left, and both
          // address it by its own path. Nothing here reads files[0].
          <>
            <button
              type="button"
              className="fv-btn ghost sm"
              style={HEAD_BTN}
              disabled={busy !== ""}
              onClick={() => pick(shown)}
            >
              Replace
            </button>
            <button
              type="button"
              className="fv-btn ghost sm"
              style={{ ...HEAD_BTN, color: "var(--fv-destructive)" }}
              disabled={busy !== ""}
              onClick={() => setConfirming(shown)}
            >
              Remove
            </button>
          </>
        ) : null}
      </div>

      {held.length > 1 ? (
        <div
          role="group"
          aria-label="Attachments on this activity"
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            flex: "none",
            padding: "7px 14px",
            borderBottom: "1px solid var(--fv-neutral-200)",
            background: "var(--fv-cream-300)",
          }}
        >
          {held.map((ref, i) => {
            const on = shown ? keyOf(ref) === keyOf(shown) : false;
            return (
              // Indexed, because two refs written before 0012 can carry the
              // same name and nothing else to tell them apart.
              <button
                key={`${i}:${keyOf(ref)}`}
                type="button"
                className={`fv-btn ${on ? "outline" : "ghost"} sm`}
                style={{
                  height: 24,
                  padding: "0 9px",
                  fontSize: "var(--fv-xs)",
                  fontWeight: on ? 700 : 500,
                  maxWidth: 220,
                }}
                aria-pressed={on}
                onClick={() => setChosen(keyOf(ref))}
              >
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                  {ref.name}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}

      {refused ? (
        <div
          role="alert"
          style={{
            flex: "none",
            padding: "8px 14px",
            borderBottom: "1px solid var(--fv-neutral-200)",
            color: "var(--fv-destructive)",
            fontSize: "var(--fv-xs)",
            lineHeight: 1.5,
          }}
        >
          {refused}
        </div>
      ) : null}

      <input
        ref={picker}
        type="file"
        accept={ATTACHMENT_ACCEPT}
        style={{ display: "none" }}
        onChange={(e) => {
          const swap = replacing.current;
          replacing.current = null;
          take(e.target.files?.[0], swap);
          // Clear it, or picking the same file twice fires no change event.
          e.target.value = "";
        }}
      />

      {/* `loading && !url` and not a bare `loading`: a re-sign while the
          document is already up would otherwise swap the iframe for "Opening
          the document…" and put the grader back at page one. */}
      {busy !== "" || (loading && !url) ? (
        <PaneNote>
          <span className="fv-sub">
            {busy === "uploading"
              ? "Uploading…"
              : busy === "removing"
                ? "Removing…"
                : "Opening the document…"}
          </span>
        </PaneNote>
      ) : shown && url ? (
        kindOf(shown) === "image" ? (
          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflow: "auto",
              padding: 12,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "var(--fv-neutral-100)",
            }}
          >
            {/* Not the PDF iframe: a browser handed a PNG in a frame shows it
                at its own pixel size against black, and a phone photograph of a
                worksheet is four times the width of this pane. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={url}
              alt={shown.name}
              style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", display: "block" }}
            />
          </div>
        ) : kindOf(shown) === "pdf" ? (
          // An iframe rather than a PDF library: every browser this app supports
          // renders a PDF natively, and a viewer bundle would be the single
          // largest thing shipped for one pane of one screen.
          <iframe className="fv-embed" src={url} title={shown.name} />
        ) : (
          <PaneNote>
            <div className="fv-sub" style={{ textAlign: "center", maxWidth: "40ch", lineHeight: 1.6 }}>
              <div style={{ fontWeight: 600, color: "var(--fv-navy)" }}>{shown.name}</div>
              This one can&rsquo;t be shown in the pane. Open it in a new tab to read it.
            </div>
          </PaneNote>
        )
      ) : shown ? (
        <PaneNote>
          <div className="fv-sub" style={{ textAlign: "center", maxWidth: "40ch", lineHeight: 1.6 }}>
            <div style={{ fontWeight: 600, color: "var(--fv-navy)" }}>{shown.name}</div>
            {shown.path
              ? // A path that would not sign. The bytes may well be there; what
                // failed is this browser's permission to be handed a link to
                // them, and nobody should be told to re-upload over that.
                "This file could not be opened just now. Reload the page, and ask whoever set the activity up if it keeps happening."
              : // A row written before 0012 recorded a file NAME and no bytes.
                "This activity lists a file but has nothing stored for it. Upload it again to read it here while you write the criteria."}
            {canEdit && !shown.path ? (
              <div style={{ marginTop: 12 }}>
                <button
                  type="button"
                  className="fv-btn outline sm"
                  onClick={() => pick(shown)}
                >
                  <FIcon name="fileUpload" size={15} />
                  Upload it
                </button>
              </div>
            ) : null}
          </div>
        </PaneNote>
      ) : canEdit ? (
        <PaneNote>
          <button
            type="button"
            className={`fv-dz${over ? " over" : ""}`}
            style={{ maxWidth: 420, width: "100%" }}
            onClick={() => pick(null)}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              take(e.dataTransfer.files?.[0], null);
            }}
          >
            <span style={{ color: "var(--fv-muted)" }}>
              <FIcon name="fileUpload" size={24} />
            </span>
            <span style={{ fontWeight: 600 }}>Add the assignment PDF</span>
            <span className="fv-sub" style={{ fontSize: "var(--fv-xs)" }}>
              Drop it here or click to choose. Students on the course can read it once the activity
              is visible to them. The full set of attachments is managed on the activity page.
            </span>
          </button>
        </PaneNote>
      ) : (
        <PaneNote>
          <span className="fv-sub">The instructor has not added a document for this activity.</span>
        </PaneNote>
      )}

      {confirming ? (
        <ConfirmDialog
          title="Remove this attachment?"
          body={
            <>
              <div style={{ color: "var(--fv-navy)", fontWeight: 600 }}>{confirming.name}</div>
              <div style={{ marginTop: 6 }}>
                It comes off this activity for everyone, including students who can already see it.
                {held.length === 2
                  ? " The other attachment stays where it is."
                  : held.length > 2
                    ? ` The other ${held.length - 1} attachments stay where they are.`
                    : ""}
              </div>
            </>
          }
          confirmLabel="Remove attachment"
          busy={busy === "removing"}
          onConfirm={() => drop(confirming)}
          onCancel={() => setConfirming(null)}
        />
      ) : null}
    </div>
  );
}

export function RubricBuilder({
  activity,
  canEdit = true,
  wizard = false,
  onDone,
  onStep1,
  onChanged,
  onError,
}: {
  activity: Activity;
  /** Criteria and the document are the instructor's; a TF reads both. */
  canEdit?: boolean;
  /** Step 2 of creating an activity, rather than an edit of an existing one. */
  wizard?: boolean;
  /** Leave for good. In the wizard this is Finish, and it ends the sequence. */
  onDone: () => void;
  /** Back to step 1, WITHOUT ending the sequence. Wizard only. */
  onStep1?: () => void;
  /** The document lives on the activity row, so uploading it changes `data`. */
  onChanged: () => void | Promise<void>;
  onError: (e: unknown) => void;
}): JSX.Element {
  const [items, setItems] = useState<RubricItem[] | null>(null);
  const [questions, setQuestions] = useState<PointedQuestion[] | null>(null);
  const [pending, setPending] = useState<RubricItem | null>(null);
  const [pendingQ, setPendingQ] = useState<PointedQuestion | null>(null);
  const [cost, setCost] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Set for the one visit where the standard combo rubric was written in. */
  const [filled, setFilled] = useState(false);

  /**
   * Whether this activity is a blank Combo waiting for the course's rubric.
   *
   * The points test is what stops a seeded rubric coming back from the dead: an
   * activity is created out of 0, seeding sets it to 20, so a combo somebody
   * deliberately emptied has a total on it and is left alone. Without it,
   * deleting all six questions would just re-write them on the next visit.
   */
  const blankCombo =
    canEdit &&
    activity.type === "combo" &&
    !isCompletion(activity) &&
    items != null &&
    questions != null &&
    items.length === 0 &&
    questions.length === 0;

  // The note below belongs to one activity. This screen is reused across
  // activities without unmounting, so without this it would follow you onto the
  // next rubric and claim credit for something it did not write.
  useEffect(() => {
    setFilled(false);
  }, [activity.id]);

  // Kept out of the effect's deps on purpose. Seeding has to tell the parent to
  // refetch — the activity's total moves from 0 to 20 and this screen reads it
  // for the running tally — and a parent that hands down a fresh callback each
  // render would turn that dependency into a loop.
  const changedRef = useRef(onChanged);
  useEffect(() => {
    changedRef.current = onChanged;
  });

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        // Both seed on read. An activity authored before questions were rows
        // arrives here as a count and leaves as the same questions, written down.
        let [ladder, qs] = await Promise.all([
          ensureRubric(activity, canEdit),
          ensureQuestions(activity, canEdit),
        ]);

        // Every combo in AP 50 is marked against the same rubric, so a new one
        // arrives with it already written rather than with a blank page and
        // twenty-four rungs to retype. seedRubricTemplate refuses outright if
        // there is anything here, so this cannot overwrite anybody's work — and
        // everything it writes is ordinary rows, editable and deletable.
        if (
          live &&
          canEdit &&
          ladder.length === 0 &&
          qs.length === 0 &&
          activity.type === "combo" &&
          !isCompletion(activity) &&
          pointsTotal(activity) === 0 &&
          (await seedRubricTemplate(activity, COMBO_TEMPLATE))
        ) {
          if (!live) return;
          setFilled(true);
          [ladder, qs] = await Promise.all([
            ensureRubric(activity, canEdit),
            ensureQuestions(activity, canEdit),
          ]);
          if (!live) return;
          await changedRef.current();
        }

        if (!live) return;
        setItems(ladder);
        setQuestions(qs);
      } catch (e) {
        if (live) onError(e);
      }
    })();
    return () => {
      live = false;
    };
  }, [activity, canEdit, onError]);

  /** Write the standard combo rubric in by hand, for a combo that is priced. */
  const fillCombo = useCallback(() => {
    setBusy(true);
    seedRubricTemplate(activity, COMBO_TEMPLATE)
      .then(async (done) => {
        if (!done) return;
        setFilled(true);
        const [ladder, qs] = await Promise.all([
          ensureRubric(activity, canEdit),
          ensureQuestions(activity, canEdit),
        ]);
        setItems(ladder);
        setQuestions(qs);
        await changedRef.current();
      })
      .catch(onError)
      .finally(() => setBusy(false));
  }, [activity, canEdit, onError]);

  const groups = useMemo(
    () => groupsFor(questions ?? [], items ?? []),
    [questions, items],
  );

  const commit = useCallback(
    (id: string, patch: { description?: string; deduction?: number }) => {
      const before = items;
      // Optimistic, then put the stored value back if the write is refused —
      // an edit that only LOOKS saved is how someone grades against a criterion
      // the database never accepted.
      setItems((prev) => prev?.map((x) => (x.id === id ? { ...x, ...patch } : x)) ?? prev);
      updateRubricItem(id, patch).catch((e) => {
        setItems(before);
        onError(e);
      });
    },
    [items, onError],
  );

  const add = useCallback(
    (label: string | null) => {
      const rows = items;
      if (!rows) return;
      addRubricItem(activity.id, rows, label)
        .then((row) => setItems((prev) => [...(prev ?? []), row]))
        .catch(onError);
    },
    [activity.id, items, onError],
  );

  // ------------------------------------------------------------- questions

  /** Add a question, or a sub-question of one. */
  const addQ = useCallback(
    (parent?: PointedQuestion) => {
      const rows = questions;
      if (!rows) return;
      const taken = rows.map((q) => q.label);
      const label = parent ? nextSub(parent, taken) : nextTop(taken);
      setBusy(true);
      addQuestion(activity.id, rows, label, parent)
        .then((next) => {
          setQuestions(next);
          return onChanged();
        })
        .catch(onError)
        .finally(() => setBusy(false));
    },
    [activity.id, questions, onChanged, onError],
  );

  /**
   * Rename a question, and take its criteria with it.
   *
   * 0026 keys a MARK to the question's id, so renaming cannot lose anyone's
   * grade. But a criterion still points at its question by LABEL (0012), and
   * that is the pair that can come apart: GradingScreen offers a grader the
   * lines whose `question_label` matches the question in front of them, so a
   * question renamed without its criteria has an empty ladder and the criteria
   * become strays. Nobody is unmarked and no score moves — but the next
   * submission graded is graded against nothing, silently.
   *
   * Two writes, two tables, and no transaction available from the client. So
   * the question goes first and, if the criteria fail to follow, its name is
   * put back: a half-move is the one outcome that must not survive, and the
   * rename is the reversible half. Returns what is wrong with the name, or
   * null — the field keeps her typing and shows the reason.
   */
  const renameQ = useCallback(
    (q: PointedQuestion, label: string): string | null => {
      const before = questions;
      const beforeItems = items;
      // `unique (activity_id, label)` would refuse this as a database error
      // with nowhere useful to put it, and criteria are filed BY name, so two
      // questions sharing one is genuinely ambiguous rather than merely untidy.
      if ((before ?? []).some((x) => x.id !== q.id && x.label === label)) {
        return `Another question is already called “${label}”. Criteria are filed under a question by name, so two cannot share one.`;
      }

      setQuestions((prev) => prev?.map((x) => (x.id === q.id ? { ...x, label } : x)) ?? prev);
      setItems((prev) =>
        prev?.map((it) => (it.question_label === q.label ? { ...it, question_label: label } : it)) ??
        prev,
      );

      void (async () => {
        const moving = (beforeItems ?? []).filter((it) => it.question_label === q.label);
        try {
          await updateQuestion(q.id, { label });
          try {
            await Promise.all(moving.map((it) => setRubricQuestion(it.id, label)));
          } catch (e) {
            await updateQuestion(q.id, { label: q.label }).catch(() => {});
            await Promise.all(
              moving.map((it) => setRubricQuestion(it.id, q.label).catch(() => {})),
            );
            throw e;
          }
        } catch (e) {
          setQuestions(before);
          setItems(beforeItems);
          onError(e);
        }
      })();
      return null;
    },
    [questions, items, onError],
  );

  /**
   * Set what one question is out of.
   *
   * Nothing else moves: not the activity total, not the deductions underneath.
   * Re-pointing 3 to 5 leaves a stored deduction of 2 awarding +3 where it
   * awarded +1, and the rungs on screen renumber to say so — rewriting them to
   * hold the awards still would regrade everyone already marked.
   */
  const pointsQ = useCallback(
    (q: PointedQuestion, points: number | null) => {
      const before = questions;
      setQuestions((prev) => prev?.map((x) => (x.id === q.id ? { ...x, points } : x)) ?? prev);
      setQuestionPoints(q.id, points).catch((e) => {
        setQuestions(before);
        onError(e);
      });
    },
    [questions, onError],
  );

  // Deleting a criterion cascades its marks and re-scores everyone marked with
  // it — upward, since the deduction disappears. Say how many before deleting.
  const arm = useCallback((item: RubricItem) => {
    setPending(item);
    setCost(null);
    countMarksForRubricItem(item.id)
      .then((n) =>
        setCost(
          n === 0
            ? "Nobody has been marked with this line yet."
            : `${n} submission${n === 1 ? "" : "s"} marked with this line will be re-scored upward.`,
        ),
      )
      .catch(() => setCost("Could not check how many submissions use this line."));
  }, []);

  const confirmDelete = useCallback(() => {
    const item = pending;
    if (!item) return;
    setPending(null);
    setCost(null);
    setItems((prev) => prev?.filter((x) => x.id !== item.id) ?? prev);
    deleteRubricItem(item.id).catch(onError);
  }, [pending, onError]);

  /** Deleting a question takes its criteria — and their marks — with it. */
  const armQ = useCallback((q: PointedQuestion, own: RubricItem[]) => {
    setPendingQ(q);
    setCost(null);
    if (own.length === 0) {
      setCost("It has no criteria of its own.");
      return;
    }
    Promise.all(own.map((it) => countMarksForRubricItem(it.id)))
      .then((counts) => {
        const marks = counts.reduce((a, b) => a + b, 0);
        setCost(
          marks === 0
            ? `Its ${own.length} criteri${own.length === 1 ? "on" : "a"} go with it. Nobody has been marked with any of them.`
            : `Its ${own.length} criteri${own.length === 1 ? "on" : "a"} go with it, and ${marks} recorded mark${marks === 1 ? "" : "s"} will be re-scored.`,
        );
      })
      .catch(() => setCost("Could not check what would be deleted with it."));
  }, []);

  const confirmDeleteQ = useCallback(() => {
    const q = pendingQ;
    const rows = questions;
    if (!q || !rows) return;
    setPendingQ(null);
    setCost(null);
    setBusy(true);
    setItems((prev) => prev?.filter((it) => it.question_label !== q.label) ?? prev);
    deleteQuestion(activity.id, q, rows)
      .then((next) => {
        setQuestions(next);
        return onChanged();
      })
      .catch(onError)
      .finally(() => setBusy(false));
  }, [activity.id, pendingQ, questions, onChanged, onError]);

  const week = activity.week == null ? "Unscheduled" : `Week ${activity.week}`;
  const total = pointsTotal(activity);

  // 3 + 2 + 3 + 2 + 5 + 5 against the 20 the combo is out of. Finding out these
  // came to 19 after grading is the whole reason this line is on screen.
  const tally = useMemo(
    () => tallyQuestionPoints(activity, questions ?? []),
    [activity, questions],
  );

  // Marked complete/incomplete, or out of points (0019). Held locally so the
  // switch answers immediately, and reconciled from the row when the parent
  // refetches — the row is the authority, not this.
  const [completion, setCompletion] = useState(isCompletion(activity));
  const [ciBusy, setCiBusy] = useState(false);
  useEffect(() => {
    setCompletion(isCompletion(activity));
  }, [activity]);

  const setCi = useCallback(
    (next: boolean) => {
      setCompletion(next);
      setCiBusy(true);
      updateActivity(activity.id, { completion: next })
        // Already-released marks carry is_ci from whatever the rule was when
        // they were released. Leaving them behind splits one activity into two
        // grading regimes — half the class reading "Complete" and half reading
        // "7 / 10" off the same column — so the flip carries them with it.
        .then(() => restampReleased(activity.id, next))
        .then(() => onChanged())
        .catch((e) => {
          setCompletion(!next);
          onError(e);
        })
        .finally(() => setCiBusy(false));
    },
    [activity.id, onChanged, onError],
  );

  return (
    <div className="fv-panel">
      <div className="fv-topbar">
        <button
          type="button"
          className="fv-back"
          aria-label={wizard ? "Back to the activity's details" : "Back to activity"}
          onClick={wizard && onStep1 ? onStep1 : onDone}
        >
          <FIcon name="chevronLeft" size={18} />
        </button>
        <span className="fv-sub">
          {activity.title} · {week}
        </span>
        <div style={{ flex: 1 }} />
        <button type="button" className="fv-btn primary sm" onClick={onDone}>
          {wizard ? "Finish" : "Done"}
        </button>
      </div>

      {wizard ? <Steps steps={NEW_ACTIVITY_STEPS} current={1} onGo={onStep1} /> : null}

      <div style={{ marginBottom: 12 }}>
        <h1 className="fv-display" style={{ fontSize: 26, lineHeight: 1.16 }}>
          {wizard ? "Questions & grading" : "Rubric"}
        </h1>
        {wizard ? (
          <p className="fv-sub" style={{ marginTop: 6, lineHeight: 1.55, maxWidth: "68ch" }}>
            List the questions students will map their pages to, and say how each one is
            marked. Both are needed either way — the questions are what a student attaches a
            page to when they hand in.
          </p>
        ) : null}
      </div>

      <div className="fv-rubric">
        <DocumentPane
          activity={activity}
          canEdit={canEdit}
          onChanged={onChanged}
          onError={onError}
        />

        <div className="fv-rubricside">
          <div className="fv-panehead">
            <span className="fv-eyebrow" style={{ flex: 1 }}>
              Questions &amp; criteria
            </span>
            <span className="fv-sub fv-num" style={{ fontSize: "var(--fv-2xs)" }}>
              {completion ? "Completion" : `${total} pts`}
            </span>
          </div>

          {/* How it is marked, above the ladder it governs. A switch rather
              than two radio buttons: it is one question with a yes and a no,
              and the sentence under it changes to say what the answer means. */}
          {/* Both answers on screen at once, side by side, each saying what it
              means. A lone switch labelled "Marked for completion" makes you
              work out what OFF is — and the two answers are not opposites in
              any obvious way, so guessing is easy and wrong. */}
          <div className="fv-ciband">
            <span className="fv-eyebrow" style={{ flex: "none" }}>
              How is this marked?
            </span>
            <div className="fv-cipick" role="radiogroup" aria-label="How this activity is marked">
              <button
                type="button"
                role="radio"
                aria-checked={!completion}
                className={`fv-cichoice${!completion ? " on" : ""}`}
                disabled={!canEdit || ciBusy}
                onClick={() => setCi(false)}
              >
                <span className="fv-cititle">Out of points</span>
                <span className="fv-cihint">
                  Each question carries a ladder, and picking a rung while grading awards what it
                  says out of the {total} this is out of.
                </span>
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={completion}
                className={`fv-cichoice${completion ? " on" : ""}`}
                disabled={!canEdit || ciBusy}
                onClick={() => setCi(true)}
              >
                <span className="fv-cititle">Complete / Not complete</span>
                <span className="fv-cihint">
                  One answer for the whole assignment. Questions are still needed — they are what
                  a student attaches pages to.
                </span>
              </button>
            </div>
          </div>

          {/* Where her questions stand against the activity total. Nothing is
              rescaled to make them agree — a score still comes off the
              activity's total, so the gap is reported and she decides which
              number was wrong. Silent while no question carries points of its
              own, which is every activity written before 0034. */}
          {!completion && tally.balance !== "unset" ? (
            <div
              className="fv-cirow fv-sub"
              style={{
                gap: 8,
                alignItems: "flex-start",
                lineHeight: 1.5,
                borderBottom: "1px solid var(--fv-neutral-200)",
                color: tally.note ? "var(--fv-amber)" : undefined,
              }}
            >
              {tally.note ? null : (
                <span style={{ flex: "none", marginTop: 1 }}>
                  <FIcon name="check" size={14} />
                </span>
              )}
              <span>
                {tally.note ??
                  `Your ${tally.set} questions add up to ${tally.declared}, which is what this activity is out of.`}
              </span>
            </div>
          ) : null}

          {/* Said once, on the visit it happened. Everything below is hers to
              edit or delete, and somebody who did not press a button deserves
              to be told where six named questions came from. */}
          {filled ? (
            <div
              className="fv-cirow fv-sub"
              style={{
                gap: 8,
                alignItems: "flex-start",
                lineHeight: 1.5,
                borderBottom: "1px solid var(--fv-neutral-200)",
              }}
            >
              <span style={{ flex: "none", marginTop: 1 }}>
                <FIcon name="check" size={14} />
              </span>
              <span>
                Started from the standard combo rubric. Rename a question, change what it is
                worth, edit a rung or delete any of it — none of it is fixed.
              </span>
            </div>
          ) : null}

          <div className="fv-panebody">
            {items == null || questions == null ? (
              <div className="fv-sub" style={{ padding: 14 }}>
                Loading the rubric…
              </div>
            ) : questions.length === 0 && items.length === 0 && !canEdit ? (
              // Only the owner may write these rows, so a TF who arrives first
              // has nothing to seed and should be told why.
              <div className="fv-sub" style={{ padding: 14, lineHeight: 1.6 }}>
                The instructor has not set up this rubric yet.
              </div>
            ) : blankCombo ? (
              // Reached when the combo carries a total already, so the load
              // above left it alone. The offer is still worth making — the
              // rubric is the same one either way — it just is not made behind
              // her back on an activity somebody has started pricing.
              <div
                style={{
                  padding: 14,
                  display: "grid",
                  gap: 11,
                  justifyItems: "start",
                  lineHeight: 1.6,
                }}
              >
                <span className="fv-sub">
                  Nothing here yet. Every combo in this course is marked the same way — two
                  challenge problems, each out of 3 for the work done at home and 2 for the
                  mark-up, then the two tutorial screens at 5 apiece.
                </span>
                <button
                  type="button"
                  className="fv-btn outline sm"
                  disabled={busy}
                  onClick={fillCombo}
                >
                  <FIcon name="assignment" size={15} />
                  Use the standard combo rubric
                </button>
              </div>
            ) : (
              groups.map((g) => {
                // What the rungs under this heading are read against. A shared
                // or stray block has no question, so it is read against the
                // activity total — the number it has always come off.
                const own = g.question?.points ?? null;
                const worth = worthOf(activity, g.question);
                const top = g.items.length
                  ? Math.max(...g.items.map((it) => awardForDeduction(worth, it.deduction)))
                  : null;
                return (
                  <div className="fv-qblock" key={g.question?.id ?? g.label ?? "shared"}>
                    <QuestionHead
                      group={g}
                      canEdit={canEdit && !busy}
                      scored={!completion}
                      total={total}
                      onRename={(label) =>
                        g.question ? renameQ(g.question, label) : "This block has no question row."
                      }
                      onPoints={(points) => g.question && pointsQ(g.question, points)}
                      onSub={() => g.question && addQ(g.question)}
                      onDelete={() => g.question && armQ(g.question, g.items)}
                    />

                    {completion ? (
                      // Nothing to ladder: the whole assignment is one answer.
                      // The criteria rows are not deleted — switching back
                      // should not throw away what somebody wrote.
                      <div className="fv-cirow fv-sub">
                        <FIcon name="check" size={14} />
                        Complete / Not complete — for the whole assignment
                      </div>
                    ) : g.items.length === 0 ? (
                      <div
                        className="fv-sub"
                        style={{ padding: "8px 12px 8px 26px", fontSize: "var(--fv-xs)" }}
                      >
                        No criteria yet.
                      </div>
                    ) : (
                      g.items
                        .slice()
                        .sort((a, b) => a.row_index - b.row_index)
                        .map((item) => (
                          <CriterionRow
                            key={item.id}
                            item={item}
                            worth={worth}
                            canEdit={canEdit}
                            onCommit={(patch) => commit(item.id, patch)}
                            onDelete={() => arm(item)}
                          />
                        ))
                    )}

                    {!completion && (canEdit || top != null) ? (
                      <div
                        className="fv-qfoot"
                        style={{ display: "flex", alignItems: "center", gap: 10 }}
                      >
                        {canEdit ? (
                          <button
                            type="button"
                            className="fv-btn outline sm"
                            style={{ height: 26, padding: "0 9px", fontSize: "var(--fv-2xs)" }}
                            onClick={() => add(g.label)}
                          >
                            <FIcon name="add" size={13} />
                            Add criterion
                          </button>
                        ) : null}
                        <span style={{ flex: 1 }} />
                        {/* The ladder adding up, where she can see it while
                            writing it: her top rung has to reach what the
                            question is out of, or full marks are unreachable
                            on it and every score comes in low by the gap.
                            Only a question with points of its own is held to
                            that — an unpointed one is read against the whole
                            activity, where a top rung short of the total is
                            what every rubric written before 0034 looks like. */}
                        {top != null ? (
                          <span
                            className="fv-sub fv-num"
                            style={{
                              fontSize: "var(--fv-2xs)",
                              textAlign: "right",
                              color:
                                own != null && top < worth ? "var(--fv-amber)" : undefined,
                            }}
                          >
                            {own == null
                              ? `Best rung +${top} of the activity's ${worth}`
                              : top < worth
                                ? `Best rung +${top} of ${worth} — nothing here awards the full ${worth}`
                                : `Best rung +${top} of ${worth}`}
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}

            {/* The only way questions come into being. There is no count to
                type anywhere else, so an activity has exactly the questions
                someone added here. */}
            {canEdit && questions != null ? (
              <div style={{ padding: 12 }}>
                <button
                  type="button"
                  className="fv-btn outline sm"
                  disabled={busy}
                  onClick={() => addQ()}
                >
                  <FIcon name="add" size={15} />
                  Add question
                </button>
                {questions.length === 0 ? (
                  <div
                    className="fv-sub"
                    style={{ marginTop: 8, fontSize: "var(--fv-2xs)", lineHeight: 1.5 }}
                  >
                    {completion
                      ? "No questions yet — students need at least one to attach a page to."
                      : "No questions yet — this activity is out of 0 pts until you add one."}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {pendingQ ? (
        <ConfirmDialog
          title={`Are you sure you'd like to delete “${pendingQ.label}”?`}
          body={<>{cost ?? "Checking what would be deleted with it…"}</>}
          confirmLabel="Delete question"
          busy={busy}
          onConfirm={confirmDeleteQ}
          onCancel={() => {
            setPendingQ(null);
            setCost(null);
          }}
        />
      ) : null}

      {pending ? (
        <ConfirmDialog
          title="Delete this criterion?"
          body={
            <>
              <div style={{ color: "var(--fv-navy)", fontWeight: 600 }}>{pending.description}</div>
              <div style={{ marginTop: 6 }}>{cost ?? "Checking what this affects…"}</div>
            </>
          }
          confirmLabel="Delete criterion"
          onConfirm={confirmDelete}
          onCancel={() => {
            setPending(null);
            setCost(null);
          }}
        />
      ) : null}
    </div>
  );
}
