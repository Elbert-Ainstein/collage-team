"use client";

// The Review tab: what the TFs have marked, waiting for the instructor.
//
// Kelly has one person grading. When he is done she wants to look the marks
// over and send them out in one press — not open each student in turn and
// press Release twelve times. So this is a list, grouped by activity, of every
// submission sent for review: who, what they will read, the note they will
// get, and a way into the grading page if something looks off. Then Release
// everything, or one activity's worth.
//
// Instructor only. A TF's finish line is Send for review, on the grading page;
// 0038 refuses them the release write, so there is nothing for them here.

import { useMemo, useState } from "react";
import { releaseMany } from "./facultyData";
import type { FacultyData } from "./FacultyApp";
import { ConfirmDialog } from "./ConfirmDialog";
import { FAvatar, FIcon } from "./icons";
import { isCompletion } from "@/checkins/types";
import { pointsTotal } from "./model";
import { reviewGroups, type ReviewGroup, type ReviewRow } from "./reviewModel";

export interface ReviewScreenProps {
  data: FacultyData;
  /** Open the grading page on this person's work. */
  onOpen: (activityId: string, subjectId: string, kind: "individual" | "team") => void;
  /** Something was released: re-read results. */
  onChanged: () => void;
  onError: (e: unknown) => void;
}

const pts = (n: number): string => `${n} ${n === 1 ? "pt" : "pts"}`;

export function ReviewScreen({ data, onOpen, onChanged, onError }: ReviewScreenProps): JSX.Element {
  const groups = useMemo(() => reviewGroups(data), [data]);
  const total = groups.reduce((n, g) => n + g.rows.length, 0);

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

  const everything = groups.flatMap((g) => g.rows);

  return (
    <div className="fv-panel">
      <div className="fv-head">
        <div>
          <h1 className="fv-h1">Review</h1>
          <div className="fv-sub">
            Check your TFs&rsquo; marking, then release it. Students see nothing until you do.
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

      {note ? (
        <div role="status" className="fv-sub" style={{ marginBottom: 12 }}>
          {note}
        </div>
      ) : null}

      {groups.length === 0 ? (
        <div className="fv-card" style={{ padding: 26, maxWidth: 560 }}>
          <div style={{ fontFamily: "var(--fv-serif)", fontSize: "var(--fv-lg)", fontWeight: 700 }}>
            Nothing waiting
          </div>
          <p className="fv-sub" style={{ marginTop: 8, lineHeight: 1.6, maxWidth: "56ch" }}>
            When a TF finishes marking, it lands here for you to check and release.
          </p>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 14 }}>
          {groups.map((g) => (
            <Group
              key={g.activity.id}
              group={g}
              busy={busy}
              onOpen={onOpen}
              onRelease={(rows) => attempt(g.activity.id, rows)}
            />
          ))}
        </div>
      )}

      {confirm ? (
        <ConfirmDialog
          title="Release before the week is fully marked?"
          tone="primary"
          body={
            <>
              <div>
                {confirm.rows.filter((r) => r.pending).length === 1
                  ? "One of these totals"
                  : `${confirm.rows.filter((r) => r.pending).length} of these totals`}{" "}
                will move — a completion in the week isn&rsquo;t marked yet:
              </div>
              <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
                {confirm.rows
                  .filter((r) => r.pending)
                  .slice(0, 8)
                  .map((r) => (
                    <li key={r.result.id}>
                      {r.subject.name} — {r.unmarked.join(", ")}
                    </li>
                  ))}
                {confirm.rows.filter((r) => r.pending).length > 8 ? <li>…</li> : null}
              </ul>
            </>
          }
          confirmLabel={`Release ${confirm.rows.length} anyway`}
          busyLabel="Releasing…"
          busy={busy !== null}
          onCancel={() => setConfirm(null)}
          onConfirm={() => void release(confirm.key, confirm.rows)}
        />
      ) : null}
    </div>
  );
}

function Group({
  group,
  busy,
  onOpen,
  onRelease,
}: {
  group: ReviewGroup;
  busy: string | null;
  onOpen: ReviewScreenProps["onOpen"];
  onRelease: (rows: ReviewRow[]) => void;
}) {
  const { activity, rows, stillMarking } = group;
  const own = pts(pointsTotal(activity));
  return (
    <section className="fv-card" style={{ padding: "12px 14px" }} aria-label={activity.title}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontFamily: "var(--fv-serif)",
              fontSize: "var(--fv-base)",
              fontWeight: 700,
              letterSpacing: "var(--fv-tight)",
            }}
          >
            {activity.title}
          </div>
          <div className="fv-sub" style={{ fontSize: "var(--fv-2xs)" }}>
            {activity.week == null ? "Unscheduled" : `Week ${activity.week}`} · {rows.length} waiting
            {stillMarking > 0
              ? ` · ${stillMarking} still being marked`
              : ""}
            {isCompletion(activity) ? "" : ` · out of ${own}`}
          </div>
        </div>
        <button
          type="button"
          className="fv-btn outline sm"
          disabled={busy !== null}
          onClick={() => onRelease(rows)}
        >
          {busy === activity.id ? "Releasing…" : `Release ${rows.length}`}
        </button>
      </div>

      <div className="fv-tblwrap">
        <table className="fv-tbl">
          <thead>
            <tr>
              <th>
                <span className="fv-eyebrow">Who</span>
              </th>
              <th>
                <span className="fv-eyebrow">They will see</span>
              </th>
              <th>
                <span className="fv-eyebrow">Note to them</span>
              </th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.result.id} className="fv-trstu">
                <td>
                  <div className="fv-subject">
                    {r.kind === "team" ? (
                      <FIcon name="groups" size={16} />
                    ) : (
                      <FAvatar name={r.subject.name} tint={r.subject.tint} size={20} />
                    )}
                    <span style={{ fontSize: "var(--fv-xs)", fontWeight: 600 }}>
                      {r.subject.name}
                    </span>
                  </div>
                </td>
                <td>
                  <span className="fv-num" style={{ fontSize: "var(--fv-xs)", fontWeight: 600 }}>
                    {r.grade}
                  </span>
                  {r.pending ? (
                    <span
                      className="fv-sub"
                      style={{ marginLeft: 8, fontSize: "var(--fv-2xs)", color: "var(--fv-amber)" }}
                      title={`Not marked yet: ${r.unmarked.join(", ")}`}
                    >
                      not final
                    </span>
                  ) : null}
                </td>
                <td>
                  <span
                    className="fv-sub fv-ellip"
                    style={{ display: "block", maxWidth: 360, fontSize: "var(--fv-2xs)" }}
                  >
                    {r.result.feedback?.trim() || "—"}
                  </span>
                </td>
                <td style={{ textAlign: "right" }}>
                  <button
                    type="button"
                    className="fv-btn ghost sm"
                    onClick={() => onOpen(activity.id, r.subject.id, r.kind)}
                    title="Open on the grading page"
                  >
                    Open
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
