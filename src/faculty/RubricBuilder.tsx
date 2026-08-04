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
import type { Activity, FileRef, RubricItem } from "@/checkins/types";
import {
  activityFileUrl,
  addRubricItem,
  countMarksForRubricItem,
  deleteRubricItem,
  ensureRubric,
  removeActivityFile,
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
  /** null is the shared ladder written before per-question criteria existed. */
  label: string | null;
  heading: string;
  items: RubricItem[];
}

/**
 * Every block the right pane shows, in order: the shared ladder if there is
 * one, then question 1..N, each followed by its own sub-questions.
 *
 * Questions with no criteria are still listed — an empty question is the whole
 * reason to be on this screen, and hiding it would leave nowhere to press.
 */
function groupsFor(activity: Activity, items: RubricItem[]): Group[] {
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
    out.push({ label: null, heading: "Applies to every question", items: shared });
  }

  // Sub-questions the criteria name, even ones whose number is past the
  // activity's question count — a stale row must not vanish silently.
  const extra = [...byQuestion.keys()].filter((l) => {
    const n = baseOf(l);
    return n == null || n > activity.question_count;
  });

  for (let q = 1; q <= activity.question_count; q += 1) {
    out.push({
      label: String(q),
      heading: `Question ${q}`,
      items: byQuestion.get(String(q)) ?? [],
    });
    const subs = [...byQuestion.keys()].filter((l) => l !== String(q) && baseOf(l) === q);
    for (const sub of subs.sort(byLabel)) {
      out.push({
        label: sub,
        heading: `Question ${sub}`,
        items: byQuestion.get(sub) ?? [],
      });
    }
  }
  for (const label of extra.sort(byLabel)) {
    out.push({ label, heading: `Question ${label}`, items: byQuestion.get(label) ?? [] });
  }
  return out;
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
  const [pending, setPending] = useState<RubricItem | null>(null);
  const [cost, setCost] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    ensureRubric(activity, canEdit)
      .then((rows) => {
        if (live) setItems(rows);
      })
      .catch(onError);
    return () => {
      live = false;
    };
  }, [activity, canEdit, onError]);

  const groups = useMemo(() => groupsFor(activity, items ?? []), [activity, items]);

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

  const week = activity.week == null ? "Unscheduled" : `Week ${activity.week}`;
  const total = pointsTotal(activity);

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
        <div className="fv-sub" style={{ marginTop: 4 }}>
          {activity.question_count} {activity.question_count === 1 ? "question" : "questions"} ×{" "}
          {activity.points_per_question} {unit(activity.points_per_question)} = {total} pts. Each
          criterion takes its points off the question it belongs to.
        </div>
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
              Grading criteria
            </span>
            <span className="fv-sub fv-num" style={{ fontSize: "var(--fv-2xs)" }}>
              {items?.length ?? 0} in total
            </span>
          </div>

          <div className="fv-panebody">
            {items == null ? (
              <div className="fv-sub" style={{ padding: 14 }}>
                Loading criteria…
              </div>
            ) : items.length === 0 && !canEdit ? (
              // Only the owner may write rubric_items, so a TF who arrives
              // first has nothing to seed and should be told why.
              <div className="fv-sub" style={{ padding: 14, lineHeight: 1.6 }}>
                The instructor has not set criteria for this activity yet.
              </div>
            ) : (
              groups.map((g) => {
                const isSub = g.label != null && g.label !== String(baseOf(g.label) ?? "");
                const base = g.label == null ? null : baseOf(g.label);
                return (
                  <div className="fv-qblock" key={g.label ?? "shared"}>
                    <div className={`fv-qhead${isSub ? " sub" : ""}`}>
                      <span className="fv-qname" style={{ padding: 0 }}>
                        {g.heading}
                      </span>
                      {/* Points are a property of a QUESTION. A sub-question
                          shares its parent's, so printing the full value beside
                          each one would read as several times the marks that
                          exist. */}
                      {g.label == null ? (
                        <span className="fv-badge">shared</span>
                      ) : isSub ? null : (
                        <span className="fv-sub fv-num" style={{ fontSize: "var(--fv-2xs)" }}>
                          {activity.points_per_question} {unit(activity.points_per_question)}
                        </span>
                      )}
                      {canEdit && base != null && !isSub ? (
                        <button
                          type="button"
                          className="fv-btn ghost sm"
                          style={{ height: 22, padding: "0 8px", fontSize: "var(--fv-2xs)" }}
                          title={`Add a sub-question under question ${base}`}
                          onClick={() =>
                            add(
                              nextSub(
                                base,
                                (items ?? [])
                                  .map((x) => x.question_label)
                                  .filter((l): l is string => Boolean(l)),
                              ),
                            )
                          }
                        >
                          <FIcon name="add" size={13} />
                          Sub-question
                        </button>
                      ) : null}
                    </div>

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
          </div>
        </div>
      </div>

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
