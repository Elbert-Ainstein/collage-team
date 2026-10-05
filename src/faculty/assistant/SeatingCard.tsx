"use client";

// One seat_students draft, drawn against the class as it is right now.
//
// The plan is recomputed from the draft on every render rather than kept from
// when it arrived: a refresh between the answer and the press — somebody else
// moving a student, a team deleted in another tab — has to show up here before
// Apply, not as a surprise after it.

import { useMemo, useState } from "react";
import type { SeatProposal } from "@/assistant/types";
import type { Student, TeamWithMembers } from "@/checkins/types";
import { AppliedCard } from "./AppliedCard";
import { applySeating, planSeating, type SeatOutcome, type SeatRecord } from "./seating";
import type { Refs } from "./snapshot";
import type { DraftStatus } from "./thread";

/** Enough of a long list to see its shape; the rest is one press away. */
const SHOW = 12;

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function outcomeText(out: SeatOutcome): string {
  const parts = [
    out.moved ? `moved ${plural(out.moved, "student", "students")}` : "",
    out.created ? `made ${plural(out.created, "team", "teams")}` : "",
    out.renamed ? `renamed ${plural(out.renamed, "team", "teams")}` : "",
  ].filter(Boolean);
  return parts.length ? `Applied — ${parts.join(", ")}. Nothing was deleted.` : "Applied.";
}

export function SeatingCard(props: {
  courseId: string;
  proposal: SeatProposal;
  refs: Refs;
  roster: Student[];
  teams: TeamWithMembers[];
  status: DraftStatus;
  outcome?: string;
  record?: SeatRecord;
  onApplied: (outcome: string, record: SeatRecord) => void;
  onUndone: (outcome: string) => void;
  /** Re-read the class. Asked for after a failed Apply, before any retry. */
  onRefresh: () => void;
  onDismiss: () => void;
}): JSX.Element {
  const { proposal, refs, roster, teams, status } = props;
  const seating = useMemo(() => planSeating(proposal, refs, roster, teams), [proposal, refs, roster, teams]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  /**
   * The teams a failed Apply was planned against. Until the refresh it asked
   * for brings new ones, a retry would plan from before the writes that DID
   * land — make the new teams a second time and leave a student on both — so
   * Apply stays shut while this is still the array on screen.
   */
  const [failedOn, setFailedOn] = useState<TeamWithMembers[] | null>(null);
  const reloading = failedOn !== null && failedOn === teams;

  const nothing = !seating.changes.length && !seating.renames.length;
  const shown = all ? seating.changes : seating.changes.slice(0, SHOW);

  async function apply() {
    setBusy(true);
    setError(null);
    try {
      const out = await applySeating(props.courseId, seating);
      props.onApplied(outcomeText(out), out.record);
    } catch (e) {
      // The writes are made one at a time, so some may have landed. The class
      // is re-read, the preview is redrawn from it, and a second press only
      // does what is still left — a team made the first time is joined, not
      // made again (see planSeating's new-team rule).
      setFailedOn(teams);
      props.onRefresh();
      setError(
        `${(e as Error)?.message ?? e} Some of it may have been written — the preview above ` +
          "is redrawn from the class as it is now, so pressing Apply again finishes the rest.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (status === "dismissed") return <div className="fv-as-quiet">Draft discarded — nothing was changed.</div>;
  // Not the plan again: it is redrawn from the refreshed class, where everyone
  // is already in place, and would read as a draft with nothing in it.
  if (status === "applied" || status === "undone") {
    return (
      <AppliedCard
        status={status}
        outcome={props.outcome}
        record={props.record}
        roster={roster}
        teams={teams}
        onUndone={props.onUndone}
        onRefresh={props.onRefresh}
      />
    );
  }

  return (
    <div className="fv-as-draft">
      {seating.problems.length ? (
        <>
          <span className="fv-eyebrow">Can't apply this draft</span>
          <ul className="fv-as-warn">
            {seating.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          <div className="fv-as-quiet" style={{ marginTop: 4 }}>
            Nothing has been changed. Ask again — naming the students and teams exactly helps.
          </div>
        </>
      ) : null}

      {nothing && !seating.problems.length ? (
        <div>Nothing to change — everyone is already where this draft puts them.</div>
      ) : null}

      {seating.changes.length ? (
        <>
          <span className="fv-eyebrow">{plural(seating.changes.length, "student moves", "students move")}</span>
          <ul>
            {shown.map((c) => (
              <li key={c.student.id}>
                {c.student.name} <span className="fv-as-arrow">— {c.from ?? "no team"} →</span>{" "}
                <strong>{c.to}</strong>
                {c.toNew ? " (new)" : ""}
              </li>
            ))}
          </ul>
          {seating.changes.length > SHOW ? (
            <button type="button" className="fv-btn ghost sm" onClick={() => setAll(!all)}>
              {all ? "Show fewer" : `Show all ${seating.changes.length}`}
            </button>
          ) : null}
        </>
      ) : null}

      {seating.renames.length ? (
        <>
          <span className="fv-eyebrow">Renamed</span>
          <ul>
            {seating.renames.map((r) => (
              <li key={r.teamId}>
                {r.from} <span className="fv-as-arrow">→</span> <strong>{r.to}</strong>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {seating.after.length ? (
        <>
          <span className="fv-eyebrow">Afterwards</span>
          <div className="fv-as-after">
            {seating.after.map((a, i) => (
              <span key={`${i}-${a.name}`}>
                <strong>{a.name}</strong>
                {a.isNew ? " (new)" : ""} · {plural(a.count, "student", "students")}
              </span>
            ))}
          </div>
        </>
      ) : null}

      {seating.unresolved.length ? (
        <>
          <span className="fv-eyebrow">Not moved</span>
          <ul className="fv-as-warn">
            {seating.unresolved.map((u, i) => (
              <li key={`${i}-${u.entry}`}>
                <strong>{u.entry}</strong> — {u.reason}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <div className="fv-as-quiet" style={{ marginTop: 10 }}>
        {seating.emptied.length
          ? `${seating.emptied.join(", ")} ${seating.emptied.length === 1 ? "ends" : "end"} up with nobody and ` +
            `${seating.emptied.length === 1 ? "is" : "are"} left in place — deleting a team deletes its photos ` +
            "and recordings, so that stays on Form teams. "
          : ""}
        Anyone this draft does not mention stays on their team. Nothing is deleted.
      </div>
      {error ? <div className="fv-as-msg error" style={{ marginTop: 8 }}>{error}</div> : null}
      <div className="fv-as-btns">
        {!nothing && !seating.problems.length ? (
          <button type="button" className="fv-btn primary sm" disabled={busy || reloading} onClick={() => void apply()}>
            {busy ? "Applying…" : reloading ? "Checking the class…" : "Apply"}
          </button>
        ) : null}
        <button type="button" className="fv-btn outline sm" disabled={busy} onClick={props.onDismiss}>
          {nothing || seating.problems.length ? "Dismiss" : "Discard"}
        </button>
      </div>
    </div>
  );
}
