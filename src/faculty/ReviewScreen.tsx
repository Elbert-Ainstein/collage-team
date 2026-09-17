"use client";

// The Review tab: what the TFs have marked, waiting for the instructor.
//
// Kelly has one person grading. When he is done she wants to look the marks
// over and send them out — not open each student in turn and press Release
// twelve times. It opens the way Check-in does: a grid of the activities with
// marks waiting, and the page for ONE activity once a tile is clicked — every
// student sent, the grade they will read, the note they will get, and a way
// into the grading page if something looks off. Then Release that activity's
// worth from its page, or everything from the picker.
//
// Which page is open belongs to FacultyApp, on the URL as ?s=review&a=<id>,
// so a reload lands back on the same activity and back returns to the picker.
//
// Instructor only. A TF's finish line is Send for review, on the grading page;
// 0038 refuses them the release write, so there is nothing for them here.

import { useEffect, useMemo, useState } from "react";
import { releaseMany } from "./facultyData";
import type { FacultyData } from "./FacultyApp";
import { ConfirmDialog } from "./ConfirmDialog";
import { FIcon } from "./icons";
import { isCompletion } from "@/checkins/types";
import { pointsTotal } from "./model";
import { ReviewPicker } from "./ReviewPicker";
import { ReviewTable } from "./ReviewTable";
import {
  reviewGroups,
  reviewWeeks,
  waitingRows,
  type ReviewGroup,
  type ReviewRow,
} from "./reviewModel";

export interface ReviewScreenProps {
  data: FacultyData;
  /** The open activity, or null for the picker. Owned by FacultyApp. */
  selId: string | null;
  /**
   * Open one activity's page, or null for the picker. `correction` says this
   * is not somewhere the instructor chose to go — the open activity has
   * nothing waiting any more — so the owner replaces the URL rather than
   * pushing one that back would bounce off again.
   */
  onSelect: (activityId: string | null, opts?: { correction?: boolean }) => void;
  /** Open the grading page on this person's work. */
  onOpen: (activityId: string, subjectId: string, kind: "individual" | "team") => void;
  /** Something was released: re-read results. */
  onChanged: () => void;
  onError: (e: unknown) => void;
}

const pts = (n: number): string => `${n} ${n === 1 ? "pt" : "pts"}`;

export function ReviewScreen({
  data,
  selId,
  onSelect,
  onOpen,
  onChanged,
  onError,
}: ReviewScreenProps): JSX.Element {
  const groups = useMemo(() => reviewGroups(data), [data]);
  const weeks = useMemo(() => reviewWeeks(groups, data.weeks), [groups, data.weeks]);
  const total = groups.reduce((n, g) => n + waitingRows(g.rows).length, 0);
  const selected: ReviewGroup | null = useMemo(
    () => groups.find((g) => g.activity.id === selId) ?? null,
    [groups, selId],
  );

  // The open activity has nothing waiting — released, from here or the grading
  // page, or a pasted link named one that never did — so fall back to the
  // picker rather than showing a page with no rows on it. The note survives:
  // "Released 12." is read on the picker, where the tile has just gone.
  useEffect(() => {
    if (selId && !selected) onSelect(null, { correction: true });
  }, [selId, selected, onSelect]);

  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  /** Rows about to go out that carry a total which is not final yet. */
  const [confirm, setConfirm] = useState<{ key: string; rows: ReviewRow[] } | null>(null);

  const release = async (key: string, rows: ReviewRow[]) => {
    if (!rows.length) return;
    setBusy(key);
    setNote(null);
    setConfirm(null);
    try {
      // Released as what was sent: a Not complete stays Not complete. The
      // completion flag is per row, and releaseMany's `completion` is only
      // read as the value to write, so it is passed per row here.
      let released = 0;
      const failed: string[] = [];
      const byCompletion = new Map<boolean, ReviewRow[]>();
      for (const r of rows) {
        const list = byCompletion.get(r.result.is_ci) ?? [];
        byCompletion.set(r.result.is_ci, [...list, r]);
      }
      for (const [completion, list] of byCompletion) {
        const out = await releaseMany(
          list.map((r) => ({ id: r.result.id, met: r.result.ci_met ?? true })),
          completion,
        );
        released += out.released;
        failed.push(...out.failed);
      }
      setNote(
        failed.length
          ? `Released ${released}. ${failed.length} did not go — reload and try those again.`
          : `Released ${released}.`,
      );
      onChanged();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(null);
    }
  };

  /** Ask first when a total in the batch is going to move; otherwise just go. */
  const attempt = (key: string, rows: ReviewRow[]) => {
    if (rows.some((r) => r.pending)) {
      setConfirm({ key, rows });
      return;
    }
    void release(key, rows);
  };

  const noteBox = note ? (
    <div role="status" className="fv-sub" style={{ marginBottom: 12, flex: "none" }}>
      {note}
    </div>
  ) : null;

  const dialog = confirm ? (
    <ConfirmDialog
      title="Release before the week is fully marked?"
      tone="primary"
      body={<NotFinal rows={confirm.rows} />}
      confirmLabel={`Release ${confirm.rows.length} anyway`}
      busyLabel="Releasing…"
      busy={busy !== null}
      onCancel={() => setConfirm(null)}
      onConfirm={() => void release(confirm.key, confirm.rows)}
    />
  ) : null;

  if (!selected) {
    const everything = groups.flatMap((g) => waitingRows(g.rows));
    return (
      <div className="fv-panel">
        <div className="fv-head">
          <div>
            <h1 className="fv-h1">Review</h1>
            <div className="fv-sub">
              Pick an activity to check your TFs&rsquo; marking. Students see nothing until you
              release it.
            </div>
          </div>
          <div style={{ flex: 1 }} />
          <button
            type="button"
            className="fv-btn primary"
            disabled={busy !== null || total === 0}
            onClick={() => attempt("all", everything)}
          >
            {busy === "all"
              ? "Releasing…"
              : total === 0
                ? "Nothing to release"
                : `Release all ${total}`}
          </button>
        </div>
        {noteBox}
        {groups.length === 0 ? <NothingWaiting /> : <ReviewPicker weeks={weeks} onOpen={onSelect} />}
        {dialog}
      </div>
    );
  }

  const { activity, rows, stillMarking } = selected;
  // Only these go out when Release is pressed: a batch released earlier stays
  // on the page, marked, and is never sent twice.
  const waiting = waitingRows(rows);
  const releasedCount = rows.length - waiting.length;
  return (
    <div className="fv-panel">
      <div className="fv-topbar">
        <button
          type="button"
          className="fv-back"
          aria-label="Back to all activities"
          onClick={() => onSelect(null)}
        >
          <FIcon name="chevronLeft" size={18} />
        </button>
        <div style={{ minWidth: 0 }}>
          <h1 className="fv-h1">{activity.title}</h1>
          <div className="fv-sub">
            {activity.week == null ? "Unscheduled" : `Week ${activity.week}`} · {waiting.length}{" "}
            waiting
            {releasedCount > 0 ? ` · ${releasedCount} released` : ""}
            {stillMarking > 0 ? ` · ${stillMarking} still being marked` : ""}
            {isCompletion(activity) ? "" : ` · out of ${pts(pointsTotal(activity))}`}
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          className="fv-btn primary"
          disabled={busy !== null || waiting.length === 0}
          onClick={() => attempt(activity.id, waiting)}
        >
          {busy === activity.id ? "Releasing…" : `Release ${waiting.length}`}
        </button>
      </div>

      {noteBox}

      <div className="fv-scroll">
        <ReviewTable rows={rows} onOpen={(subjectId, kind) => onOpen(activity.id, subjectId, kind)} />
      </div>
      {dialog}
    </div>
  );
}

function NothingWaiting() {
  return (
    <div className="fv-card" style={{ padding: 26, maxWidth: 560 }}>
      <div style={{ fontFamily: "var(--fv-serif)", fontSize: "var(--fv-lg)", fontWeight: 700 }}>
        Nothing waiting
      </div>
      <p className="fv-sub" style={{ marginTop: 8, lineHeight: 1.6, maxWidth: "56ch" }}>
        When a TF finishes marking, it lands here for you to check and release.
      </p>
    </div>
  );
}

/** The body of the warning: whose total will move, and what is not marked yet. */
function NotFinal({ rows }: { rows: ReviewRow[] }) {
  const pending = rows.filter((r) => r.pending);
  return (
    <>
      <div>
        {pending.length === 1 ? "One of these totals" : `${pending.length} of these totals`} will
        move — a completion in the week isn&rsquo;t marked yet:
      </div>
      <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
        {pending.slice(0, 8).map((r) => (
          <li key={r.result.id}>
            {r.subject.name} — {r.unmarked.join(", ")}
          </li>
        ))}
        {pending.length > 8 ? <li>…</li> : null}
      </ul>
    </>
  );
}
