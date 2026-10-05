"use client";

// A draft that has been applied: what it did, and the button that puts it back.
//
// Undo is deterministic — teamUndo.ts replays Apply's own record backwards, checked
// against the class as it is now — so it needs no model and no second preview:
// what it will do is "put back what the line above says was done", and what it
// could not put back is listed once it has run.

import { useState } from "react";
import type { Student, TeamWithMembers } from "@/checkins/types";
import type { SeatRecord } from "./seating";
import { applyTeamUndo, planTeamUndo, teamUndoText } from "@/checkins/teamUndo";

interface AppliedCardProps {
  status: "applied" | "undone";
  outcome?: string;
  record?: SeatRecord;
  roster: Student[];
  teams: TeamWithMembers[];
  onUndone: (outcome: string) => void;
  /** Re-read the class. Asked for after a failed Undo, before any retry. */
  onRefresh: () => void;
}

export function AppliedCard(props: AppliedCardProps): JSX.Element {
  const { status, outcome, record, roster, teams } = props;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** As on Apply: no retry until the class has been re-read. See SeatingCard. */
  const [failedOn, setFailedOn] = useState<TeamWithMembers[] | null>(null);
  const reloading = failedOn !== null && failedOn === teams;

  async function undo() {
    if (!record) return;
    setBusy(true);
    setError(null);
    try {
      const out = await applyTeamUndo(planTeamUndo(record, roster, teams));
      props.onUndone([teamUndoText(out), ...out.notes].join("\n"));
    } catch (e) {
      setFailedOn(teams);
      props.onRefresh();
      setError(
        `${(e as Error)?.message ?? e} Some of it may already be back. Once the class has been ` +
          "re-read, pressing Undo again finishes the rest.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (status === "undone") {
    return (
      <div className="fv-as-draft">
        <div className="fv-as-msg">{outcome ?? "Undone."}</div>
      </div>
    );
  }

  return (
    <div className="fv-as-draft">
      <div className="fv-as-done">{outcome ?? "Applied."}</div>
      {error ? (
        <div className="fv-as-msg error" style={{ marginTop: 8 }}>
          {error}
        </div>
      ) : null}
      {record ? (
        <div className="fv-as-btns">
          <button type="button" className="fv-btn outline sm" disabled={busy || reloading} onClick={() => void undo()}>
            {busy ? "Undoing…" : reloading ? "Checking the class…" : "Undo"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
