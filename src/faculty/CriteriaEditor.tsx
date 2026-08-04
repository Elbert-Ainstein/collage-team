"use client";

// The grading criteria editor: one activity's deduction ladder.
//
// The same rubric_items rows the grading screen marks against — one store, so an
// edit here shows up immediately while marking. There is no draft copy.

import { useCallback, useEffect, useRef, useState } from "react";
import type { Activity, RubricItem } from "@/checkins/types";
import { addRubricItem, deleteRubricItem, ensureRubric, updateRubricItem } from "./facultyData";
import { pointsTotal } from "./model";
import { FIcon } from "./icons";

const unit = (n: number) => (n === 1 ? "pt" : "pts");

interface Patch {
  description: string;
  deduction: number;
}

/**
 * Put an accepted value back into a contentEditable.
 *
 * React does not own the text inside one, so a rejected edit would otherwise
 * stay on screen looking saved. Skipped while the element has focus — rewriting
 * it there would drop the caret to the start mid-edit.
 */
function rewrite(el: HTMLSpanElement | null, value: string): void {
  if (!el || el.innerText === value) return;
  if (typeof document !== "undefined" && document.activeElement === el) return;
  el.innerText = value;
}

function LadderRow({
  item,
  editing,
  canEdit = true,
  onToggleEdit,
  onCommit,
  onDelete,
}: {
  item: RubricItem;
  editing: boolean;
  canEdit?: boolean;
  onToggleEdit: () => void;
  onCommit: (patch: Patch) => void;
  onDelete: () => void;
}) {
  const numRef = useRef<HTMLSpanElement | null>(null);
  const descRef = useRef<HTMLSpanElement | null>(null);
  const [armed, setArmed] = useState(false);
  // What the row was last written with. Enter blurs first, so commit runs twice
  // in one event, and the `item` prop has not re-rendered in between — comparing
  // against the props would send the same write twice.
  const saved = useRef<Patch>({ description: item.description, deduction: item.deduction });

  // The caret belongs at the end of the description: that is the field faculty
  // are almost always here to change.
  useEffect(() => {
    if (!editing) {
      setArmed(false);
      return;
    }
    const el = descRef.current;
    if (!el) return;
    el.focus();
    el.scrollIntoView({ block: "nearest" });
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }, [editing]);

  // window.confirm is suppressed in this app, so the ✕ arms first and deletes on
  // the second click. Disarm on its own so a stray click cannot linger as a trap.
  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), 4000);
    return () => window.clearTimeout(t);
  }, [armed]);

  const commit = useCallback(() => {
    const prev = saved.current;
    const description =
      (descRef.current?.innerText ?? "").replace(/\s+/g, " ").trim() || prev.description;

    // A contentEditable can hold anything. Keep the stored deduction unless the
    // text reads as a whole number that is not negative.
    const raw = (numRef.current?.innerText ?? "").replace(/[^\d.-]/g, "").trim();
    const parsed = Number.parseFloat(raw);
    const deduction =
      Number.isFinite(parsed) && parsed >= 0 ? Math.min(Math.round(parsed), 99) : prev.deduction;

    rewrite(descRef.current, description);
    rewrite(numRef.current, String(deduction));

    if (description !== prev.description || deduction !== prev.deduction) {
      saved.current = { description, deduction };
      onCommit({ description, deduction });
    }
  }, [onCommit]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLSpanElement>) => {
    if (e.key !== "Enter" && e.key !== "Escape") return;
    e.preventDefault();
    e.currentTarget.blur();
    commit();
    onToggleEdit();
  };

  const editable = {
    contentEditable: editing,
    suppressContentEditableWarning: true,
    onBlur: editing ? commit : undefined,
    onKeyDown: editing ? onKeyDown : undefined,
    role: editing ? ("textbox" as const) : undefined,
  };

  return (
    <div className={`fv-ladderrow${editing ? " editing" : ""}`}>
      <span
        className={`fv-pts ${item.deduction === 0 ? "zero" : "off"}`}
        style={{ display: "flex", alignItems: "baseline", gap: 2, whiteSpace: "nowrap" }}
      >
        <span aria-hidden="true">−</span>
        <span
          {...editable}
          ref={numRef}
          className={editing ? "fv-edit" : undefined}
          aria-label={editing ? "Points deducted" : undefined}
          style={{ minWidth: 16, textAlign: "center", outline: "none", cursor: editing ? "text" : undefined }}
        >
          {item.deduction}
        </span>
        <span>{unit(item.deduction)}</span>
      </span>

      <span
        {...editable}
        ref={descRef}
        className={editing ? "fv-edit" : undefined}
        aria-label={editing ? "Criterion" : undefined}
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: "var(--fv-sm)",
          lineHeight: 1.55,
          outline: "none",
          cursor: editing ? "text" : undefined,
        }}
      >
        {item.description}
      </span>

      {canEdit ? (
      <button
        type="button"
        className="fv-iconbtn"
        aria-label={editing ? "Finish editing criterion" : "Edit criterion"}
        aria-pressed={editing}
        onClick={() => {
          if (editing) commit();
          onToggleEdit();
        }}
        style={{
          width: 24,
          height: 24,
          borderRadius: "var(--fv-r-md)",
          color: editing ? "var(--fv-navy)" : undefined,
          background: editing ? "var(--fv-cream-400)" : undefined,
        }}
      >
        <FIcon name="edit" size={15} />
      </button>
      ) : null}

      {/* Only faculty-added rows can go; the base ladder is fixed. */}
      {canEdit && item.is_custom ? (
        <button
          type="button"
          className="fv-iconbtn"
          aria-label={armed ? "Confirm delete criterion" : "Delete criterion"}
          title={armed ? "Click again to delete" : "Delete criterion"}
          onClick={() => (armed ? onDelete() : setArmed(true))}
          onBlur={() => setArmed(false)}
          style={{
            width: 24,
            height: 24,
            borderRadius: "var(--fv-r-md)",
            color: armed ? "var(--fv-destructive)" : undefined,
            background: armed ? "var(--fv-neutral-100)" : undefined,
          }}
        >
          <FIcon name="close" size={15} />
        </button>
      ) : null}
    </div>
  );
}

export function CriteriaEditor({
  activity,
  canEdit = true,
  onDone,
  onError,
}: {
  activity: Activity;
  /** Criteria are the instructor's to write; a TF reads them while marking. */
  canEdit?: boolean;
  onDone: () => void;
  onError: (e: unknown) => void;
}): JSX.Element {
  const [items, setItems] = useState<RubricItem[] | null>(null);
  const [editId, setEditId] = useState<string | null>(null);

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
  }, [activity, onError]);

  const commit = useCallback(
    (id: string, patch: Patch) => {
      // Optimistic: the row already reads the new value on screen, and a failed
      // write surfaces through onError rather than silently reverting.
      setItems((prev) => prev?.map((x) => (x.id === id ? { ...x, ...patch } : x)) ?? prev);
      updateRubricItem(id, patch).catch(onError);
    },
    [onError],
  );

  const remove = useCallback(
    (id: string) => {
      setItems((prev) => prev?.filter((x) => x.id !== id) ?? prev);
      setEditId((cur) => (cur === id ? null : cur));
      deleteRubricItem(id).catch(onError);
    },
    [onError],
  );

  const add = useCallback(() => {
    const rows = items;
    if (!rows) return;
    addRubricItem(activity.id, rows)
      .then((row) => {
        setItems((prev) => [...(prev ?? []), row]);
        setEditId(row.id);
      })
      .catch(onError);
  }, [activity.id, items, onError]);

  const week = activity.week == null ? "Unscheduled" : `Week ${activity.week}`;
  const total = pointsTotal(activity);

  return (
    <div className="fv-panel">
      <div className="fv-topbar" style={{ marginBottom: 20 }}>
        <button type="button" className="fv-back" aria-label="Back to activity" onClick={onDone}>
          <FIcon name="chevronLeft" size={18} />
        </button>
        <span className="fv-sub">
          {activity.title} · {week}
        </span>
      </div>

      <div className="fv-scroll">
        <div style={{ maxWidth: 620 }}>
          <h1 className="fv-display" style={{ fontSize: 28, lineHeight: 1.16 }}>
            Grading criteria
          </h1>
          <p
            style={{
              margin: "10px 0 0",
              fontSize: "var(--fv-sm)",
              lineHeight: 1.6,
              color: "var(--fv-muted)",
            }}
          >
            Each of the {activity.question_count} questions is worth {activity.points_per_question}{" "}
            {unit(activity.points_per_question)} — {total} pts in total. Pick one line per question
            while grading; the points shown come off that question.
          </p>

          {items == null ? (
            <div className="fv-sub" style={{ marginTop: 20 }}>
              Loading criteria…
            </div>
          ) : items.length === 0 ? (
            // Only the owner may write rubric_items, so a TF who gets here first
            // sees nothing to seed. Saying so beats an empty card.
            <div className="fv-sub" style={{ marginTop: 20, lineHeight: 1.6, maxWidth: "56ch" }}>
              The instructor has not set criteria for this activity yet. They appear the first
              time the instructor opens this screen.
            </div>
          ) : (
            <div className="fv-card fv-ladder" style={{ maxWidth: 620, marginTop: 20 }}>
              <div className="fv-ladderhead" style={{ alignItems: "center" }}>
                <span className="fv-eyebrow" style={{ width: 56, flex: "none" }}>
                  Points
                </span>
                <span className="fv-eyebrow" style={{ flex: 1 }}>
                  Criterion
                </span>
              </div>

              {/* Own container so `.fv-ladderrow:first-of-type` (no top rule) lands
                  on the first row rather than being shadowed by the head strip. */}
              <div>
                {items.map((item) => (
                  <LadderRow
                    key={item.id}
                    item={item}
                    editing={canEdit && editId === item.id}
                    canEdit={canEdit}
                    onToggleEdit={() => setEditId((cur) => (cur === item.id ? null : item.id))}
                    onCommit={(patch) => commit(item.id, patch)}
                    onDelete={() => remove(item.id)}
                  />
                ))}
              </div>

              {canEdit ? (
                <div style={{ padding: "12px 14px", borderTop: "1px solid var(--fv-neutral-200)" }}>
                  <button type="button" className="fv-btn outline sm" onClick={add}>
                    <FIcon name="add" size={15} />
                    Add criterion
                  </button>
                </div>
              ) : null}
            </div>
          )}

          {/* Each row is written the moment it is committed, so "Save criteria" is
              a way out, not a commit point. Both buttons do the same thing. */}
          <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
            {canEdit ? (
              <>
                <button type="button" className="fv-btn primary" onClick={onDone}>
                  Save criteria
                </button>
                <button type="button" className="fv-btn ghost" onClick={onDone}>
                  Cancel
                </button>
              </>
            ) : (
              <button type="button" className="fv-btn primary" onClick={onDone}>
                Back to the activity
              </button>
            )}
          </div>
          <div style={{ fontSize: "var(--fv-2xs)", color: "var(--fv-muted)", marginTop: 10 }}>
            {canEdit
              ? "Applies to every submission for this activity. TFs with grading permission use these criteria."
              : "These are the instructor's criteria for this activity. You mark against them; only the instructor can change them."}
          </div>
        </div>
      </div>
    </div>
  );
}
