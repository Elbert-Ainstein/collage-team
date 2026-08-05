"use client";

// The rubric builder: the assignment on the left, its criteria on the right.
//
// The shape Gradescope uses, for the reason Gradescope uses it — criteria are
// written WHILE reading the question they mark, so the document has to stay on
// screen. Nothing here is a draft: every edit writes straight to the same
// rubric_items rows the grading screen marks against.
//
// Questions are not a table. They are `activities.question_count` numbered 1..N,
// and a sub-question exists exactly when a criterion names it ("2b") — so
// adding one is adding its first criterion, and the last criterion leaving takes
// the sub-question with it.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Activity, ActivityQuestion, FileRef, RubricItem } from "@/checkins/types";
import {
  activityFileUrl,
  addQuestion,
  addRubricItem,
  countMarksForRubricItem,
  deleteQuestion,
  deleteRubricItem,
  ensureQuestions,
  ensureRubric,
  removeActivityFile,
  setRubricQuestion,
  syncQuestionTotals,
  updateQuestion,
  updateRubricItem,
  uploadActivityFile,
} from "./facultyData";
import { pointsTotal } from "./model";
import { ConfirmDialog } from "./ConfirmDialog";
import { FIcon } from "./icons";

const unit = (n: number) => (n === 1 ? "pt" : "pts");

/** "2b" -> 2. A label that does not start with a number belongs to nothing. */
function baseOf(label: string): number | null {
  const n = Number.parseInt(label, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** "2" then "2a" then "2b" — numbers before their own sub-questions. */
function byLabel(a: string, b: string): number {
  const na = baseOf(a) ?? 0;
  const nb = baseOf(b) ?? 0;
  if (na !== nb) return na - nb;
  return a.localeCompare(b);
}

/** The next free whole number: the question after the last one. */
function nextTop(taken: string[]): string {
  const used = new Set(taken);
  for (let n = 1; n < 500; n += 1) {
    if (!used.has(String(n))) return String(n);
  }
  return String(taken.length + 1);
}

/** The next free sub-question letter under a question: 2a, 2b, 2c… */
function nextSub(question: number, taken: string[]): string {
  const used = new Set(taken);
  for (let i = 0; i < 26; i += 1) {
    const label = `${question}${String.fromCharCode(97 + i)}`;
    if (!used.has(label)) return label;
  }
  return `${question}z`;
}

interface Group {
  /** The question row, or null for the ladder that applies to every question. */
  question: ActivityQuestion | null;
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
function groupsFor(questions: ActivityQuestion[], items: RubricItem[]): Group[] {
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
      heading: `Question ${q.label}`,
      items: byQuestion.get(q.label) ?? [],
    });
  }

  for (const label of [...byQuestion.keys()].filter((l) => !named.has(l)).sort(byLabel)) {
    out.push({
      question: null,
      label,
      heading: `Question ${label}`,
      items: byQuestion.get(label) ?? [],
      orphan: true,
    });
  }
  return out;
}

/** The heading of one question: what it is called, and what it is worth. */
function QuestionHead({
  group,
  canEdit,
  onRename,
  onRepoint,
  onSub,
  onDelete,
}: {
  group: Group;
  canEdit: boolean;
  onRename: (label: string) => void;
  onRepoint: (points: number) => void;
  onSub: () => void;
  onDelete: () => void;
}) {
  const q = group.question;
  const [label, setLabel] = useState(q?.label ?? "");
  const [pts, setPts] = useState(String(q?.points ?? 0));

  useEffect(() => setLabel(q?.label ?? ""), [q?.label]);
  useEffect(() => setPts(String(q?.points ?? 0)), [q?.points]);

  const isSub = q != null && q.label !== String(baseOf(q.label) ?? "");

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

  return (
    <div className={`fv-qhead${isSub ? " sub" : ""}`}>
      <span className="fv-sub" style={{ flex: "none", fontSize: "var(--fv-2xs)" }}>
        Question
      </span>
      <input
        className="fv-qname"
        style={{ flex: "none", width: 56 }}
        aria-label="Question number"
        disabled={!canEdit}
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onBlur={() => {
          const next = label.trim();
          // An empty or duplicate label would address criteria that can never
          // be found again, so the field goes back to what is stored.
          if (!next || next === q.label) {
            setLabel(q.label);
            return;
          }
          onRename(next);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setLabel(q.label);
            e.currentTarget.blur();
          }
        }}
      />
      <span style={{ flex: 1 }} />
      <input
        className="fv-qname fv-num"
        style={{ flex: "none", width: 48, textAlign: "right" }}
        aria-label={`Points for question ${q.label}`}
        inputMode="numeric"
        disabled={!canEdit}
        value={pts}
        onChange={(e) => setPts(e.target.value)}
        onBlur={() => {
          const parsed = Number.parseFloat(pts.replace(/[^\d.]/g, ""));
          const next = Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : q.points;
          setPts(String(next));
          if (next !== q.points) onRepoint(next);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
      <span className="fv-sub" style={{ flex: "none", fontSize: "var(--fv-2xs)" }}>
        {unit(q.points)}
      </span>
      {canEdit && !isSub ? (
        <button
          type="button"
          className="fv-btn ghost sm"
          style={{ height: 22, padding: "0 8px", fontSize: "var(--fv-2xs)", flex: "none" }}
          title={`Add a sub-question under question ${q.label}`}
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
          aria-label={`Delete question ${q.label}`}
          onClick={onDelete}
        >
          <FIcon name="close" size={13} />
        </button>
      ) : null}
    </div>
  );
}

/** One criterion: a deduction and what earns it. Both save on blur. */
function CriterionRow({
  item,
  canEdit,
  onCommit,
  onDelete,
}: {
  item: RubricItem;
  canEdit: boolean;
  onCommit: (patch: { description?: string; deduction?: number }) => void;
  onDelete: () => void;
}) {
  const [desc, setDesc] = useState(item.description);
  const [pts, setPts] = useState(String(item.deduction));

  // Adopt a value that changed underneath — a failed write is reverted by the
  // parent, and the field has to show what was actually stored.
  useEffect(() => setDesc(item.description), [item.description]);
  useEffect(() => setPts(String(item.deduction)), [item.deduction]);

  const commitPts = () => {
    const parsed = Number.parseFloat(pts.replace(/[^\d.-]/g, ""));
    const next = Number.isFinite(parsed) && parsed >= 0 ? Math.min(Math.round(parsed), 99) : item.deduction;
    setPts(String(next));
    if (next !== item.deduction) onCommit({ deduction: next });
  };

  const commitDesc = () => {
    const next = desc.replace(/\s+/g, " ").trim() || item.description;
    setDesc(next);
    if (next !== item.description) onCommit({ description: next });
  };

  return (
    <div className="fv-crit">
      <span
        className="fv-critpts"
        style={{ display: "flex", alignItems: "center", gap: 3, justifyContent: "flex-end" }}
      >
        <span aria-hidden="true" style={{ color: "var(--fv-muted)" }}>
          −
        </span>
        <input
          className="fv-in quiet fv-num"
          style={{ width: 40, padding: "3px 5px", textAlign: "right" }}
          inputMode="numeric"
          aria-label={`Points deducted for “${item.description}”`}
          disabled={!canEdit}
          value={pts}
          onChange={(e) => setPts(e.target.value)}
          onBlur={commitPts}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
        />
        <span style={{ fontSize: "var(--fv-2xs)", color: "var(--fv-muted)" }}>
          {unit(item.deduction)}
        </span>
      </span>

      <input
        className="fv-in quiet fv-critdesc"
        style={{ padding: "3px 6px", fontSize: "var(--fv-sm)" }}
        aria-label="Criterion"
        placeholder="What loses these points?"
        disabled={!canEdit}
        value={desc}
        onChange={(e) => setDesc(e.target.value)}
        onBlur={commitDesc}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
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
  const file: FileRef | null = activity.files?.[0] ?? null;
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const picker = useRef<HTMLInputElement | null>(null);

  // A signed URL is minted per view and expires; it is never stored on the row.
  useEffect(() => {
    let live = true;
    if (!file?.path) {
      setUrl(null);
      return;
    }
    setLoading(true);
    activityFileUrl(file)
      .then((next) => {
        if (live) setUrl(next);
      })
      .catch((e) => {
        if (live) onError(e);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [file?.path, onError]);

  const take = useCallback(
    (picked: File | null | undefined) => {
      if (!picked) return;
      setBusy(true);
      uploadActivityFile(activity, picked)
        .then(() => onChanged())
        .catch(onError)
        .finally(() => setBusy(false));
    },
    [activity, onChanged, onError],
  );

  return (
    <div className="fv-rubricdoc">
      <div className="fv-panehead">
        <span className="fv-eyebrow" style={{ flex: 1 }}>
          {file ? file.name : "Assignment document"}
        </span>
        {file?.size ? (
          <span className="fv-sub fv-num" style={{ fontSize: "var(--fv-2xs)" }}>
            {file.size}
          </span>
        ) : null}
        {url ? (
          <a
            className="fv-btn ghost sm"
            style={{ height: 22, padding: "0 8px", fontSize: "var(--fv-2xs)" }}
            href={url}
            target="_blank"
            rel="noreferrer"
          >
            <FIcon name="openInNew" size={13} />
            Open
          </a>
        ) : null}
        {canEdit && file ? (
          <>
            <button
              type="button"
              className="fv-btn ghost sm"
              style={{ height: 22, padding: "0 8px", fontSize: "var(--fv-2xs)" }}
              disabled={busy}
              onClick={() => picker.current?.click()}
            >
              Replace
            </button>
            <button
              type="button"
              className="fv-btn ghost sm"
              style={{
                height: 22,
                padding: "0 8px",
                fontSize: "var(--fv-2xs)",
                color: "var(--fv-destructive)",
              }}
              disabled={busy}
              onClick={() => {
                setBusy(true);
                removeActivityFile(activity)
                  .then(() => onChanged())
                  .catch(onError)
                  .finally(() => setBusy(false));
              }}
            >
              Remove
            </button>
          </>
        ) : null}
      </div>

      <input
        ref={picker}
        type="file"
        accept="application/pdf,image/*"
        style={{ display: "none" }}
        onChange={(e) => {
          take(e.target.files?.[0]);
          // Clear it, or picking the same file twice fires no change event.
          e.target.value = "";
        }}
      />

      {/* An iframe rather than a PDF library: every browser this app supports
          renders a PDF natively, and a viewer bundle would be the single
          largest thing shipped for one pane of one screen. */}
      {url ? (
        <iframe className="fv-embed" src={url} title={file?.name ?? "Assignment document"} />
      ) : (
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
          {loading || busy ? (
            <span className="fv-sub">{busy ? "Uploading…" : "Opening the document…"}</span>
          ) : file ? (
            // A row written before 0012 recorded a file NAME and no bytes.
            <div className="fv-sub" style={{ textAlign: "center", maxWidth: "40ch", lineHeight: 1.6 }}>
              <div style={{ fontWeight: 600, color: "var(--fv-navy)" }}>{file.name}</div>
              This activity lists a file but has nothing stored for it. Upload it again to read it
              here while you write the criteria.
              {canEdit ? (
                <div style={{ marginTop: 12 }}>
                  <button
                    type="button"
                    className="fv-btn outline sm"
                    onClick={() => picker.current?.click()}
                  >
                    <FIcon name="fileUpload" size={15} />
                    Upload it
                  </button>
                </div>
              ) : null}
            </div>
          ) : canEdit ? (
            <button
              type="button"
              className={`fv-dz${over ? " over" : ""}`}
              style={{ maxWidth: 420, width: "100%" }}
              onClick={() => picker.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(true);
              }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setOver(false);
                take(e.dataTransfer.files?.[0]);
              }}
            >
              <span style={{ color: "var(--fv-muted)" }}>
                <FIcon name="fileUpload" size={24} />
              </span>
              <span style={{ fontWeight: 600 }}>Add the assignment PDF</span>
              <span className="fv-sub" style={{ fontSize: "var(--fv-xs)" }}>
                Drop it here or click to choose. Students on the course can read it once the
                activity is visible to them.
              </span>
            </button>
          ) : (
            <span className="fv-sub">The instructor has not added a document for this activity.</span>
          )}
        </div>
      )}
    </div>
  );
}

export function RubricBuilder({
  activity,
  canEdit = true,
  onDone,
  onChanged,
  onError,
}: {
  activity: Activity;
  /** Criteria and the document are the instructor's; a TF reads both. */
  canEdit?: boolean;
  onDone: () => void;
  /** The document lives on the activity row, so uploading it changes `data`. */
  onChanged: () => void | Promise<void>;
  onError: (e: unknown) => void;
}): JSX.Element {
  const [items, setItems] = useState<RubricItem[] | null>(null);
  const [questions, setQuestions] = useState<ActivityQuestion[] | null>(null);
  const [pending, setPending] = useState<RubricItem | null>(null);
  const [pendingQ, setPendingQ] = useState<ActivityQuestion | null>(null);
  const [cost, setCost] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    // Both seed on read. An activity authored before questions were rows
    // arrives here as a count and leaves as the same questions, written down.
    Promise.all([ensureRubric(activity, canEdit), ensureQuestions(activity, canEdit)])
      .then(([ladder, qs]) => {
        if (!live) return;
        setItems(ladder);
        setQuestions(qs);
      })
      .catch(onError);
    return () => {
      live = false;
    };
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

  /**
   * Add a question, or a sub-question of one.
   *
   * A new question is worth what the last one is worth. Guessing a number is
   * unavoidable — every question has to be out of something — and matching its
   * neighbour is right far more often than any constant would be.
   */
  const addQ = useCallback(
    (parent?: ActivityQuestion) => {
      const rows = questions;
      if (!rows) return;
      const taken = rows.map((q) => q.label);
      const label = parent
        ? nextSub(baseOf(parent.label) ?? rows.length + 1, taken)
        : nextTop(taken);
      const points = parent ? parent.points : (rows[rows.length - 1]?.points ?? 1);
      setBusy(true);
      addQuestion(activity.id, rows, label, points, parent)
        .then((next) => {
          setQuestions(next);
          return onChanged();
        })
        .catch(onError)
        .finally(() => setBusy(false));
    },
    [activity.id, questions, onChanged, onError],
  );

  const patchQ = useCallback(
    (q: ActivityQuestion, patch: { label?: string; points?: number }) => {
      const before = questions;
      setQuestions((prev) => prev?.map((x) => (x.id === q.id ? { ...x, ...patch } : x)) ?? prev);

      // A renamed question takes its criteria with it: they are addressed by
      // label, so leaving them behind would strand them under a heading that no
      // longer exists and quietly stop them being offered while grading.
      const renamed = patch.label != null && patch.label !== q.label;
      if (renamed) {
        setItems((prev) =>
          prev?.map((it) =>
            it.question_label === q.label ? { ...it, question_label: patch.label ?? null } : it,
          ) ?? prev,
        );
      }

      void (async () => {
        try {
          await updateQuestion(q.id, patch);
          if (renamed) {
            const moving = (before ?? []).length ? items ?? [] : [];
            await Promise.all(
              moving
                .filter((it) => it.question_label === q.label)
                .map((it) => setRubricQuestion(it.id, patch.label ?? null)),
            );
          }
          if (patch.points != null) {
            const next = (before ?? []).map((x) =>
              x.id === q.id ? { ...x, ...patch } : x,
            );
            await syncQuestionTotals(activity.id, next);
            await onChanged();
          }
        } catch (e) {
          setQuestions(before);
          onError(e);
        }
      })();
    },
    [activity.id, questions, items, onChanged, onError],
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
  const armQ = useCallback((q: ActivityQuestion, own: RubricItem[]) => {
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
  const total = pointsTotal(activity, questions ?? []);

  return (
    <div className="fv-panel">
      <div className="fv-topbar">
        <button type="button" className="fv-back" aria-label="Back to activity" onClick={onDone}>
          <FIcon name="chevronLeft" size={18} />
        </button>
        <span className="fv-sub">
          {activity.title} · {week}
        </span>
        <div style={{ flex: 1 }} />
        <button type="button" className="fv-btn primary sm" onClick={onDone}>
          Done
        </button>
      </div>

      <div style={{ marginBottom: 12 }}>
        <h1 className="fv-display" style={{ fontSize: 26, lineHeight: 1.16 }}>
          Rubric
        </h1>
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
              Questions & criteria
            </span>
            <span className="fv-sub fv-num" style={{ fontSize: "var(--fv-2xs)" }}>
              {total} pts
            </span>
          </div>

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
            ) : (
              groups.map((g) => {
                return (
                  <div className="fv-qblock" key={g.question?.id ?? g.label ?? "shared"}>
                    <QuestionHead
                      group={g}
                      canEdit={canEdit && !busy}
                      onRename={(label) => g.question && patchQ(g.question, { label })}
                      onRepoint={(points) => g.question && patchQ(g.question, { points })}
                      onSub={() => g.question && addQ(g.question)}
                      onDelete={() => g.question && armQ(g.question, g.items)}
                    />

                    {g.items.length === 0 ? (
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
                            canEdit={canEdit}
                            onCommit={(patch) => commit(item.id, patch)}
                            onDelete={() => arm(item)}
                          />
                        ))
                    )}

                    {canEdit ? (
                      <div className="fv-qfoot">
                        <button
                          type="button"
                          className="fv-btn outline sm"
                          style={{ height: 26, padding: "0 9px", fontSize: "var(--fv-2xs)" }}
                          onClick={() => add(g.label)}
                        >
                          <FIcon name="add" size={13} />
                          Add criterion
                        </button>
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
                    No questions yet — this activity is out of 0 pts until you add one.
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {pendingQ ? (
        <ConfirmDialog
          title={`Are you sure you'd like to delete question ${pendingQ.label}?`}
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
