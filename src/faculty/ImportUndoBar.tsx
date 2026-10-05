"use client";

// "Undo this import", on Roster & teams, for the last class-list import.
//
// At the TOP of the page, not beside the importer's own note: that note sits
// under the roster, a class-length scroll away, and an undo nobody can find is
// the same as none. Asked once when it would take students off the roster —
// the same courtesy every other roster removal on this screen gets — and not
// when it only moves people back, which costs nothing to do again.

import { useState } from "react";
import type { Student, TeamWithMembers } from "@/checkins/types";
import { ConfirmDialog } from "./ConfirmDialog";
import { importUndoText, undoImport, type ImportRecord } from "./importUndo";
import type { LastImport } from "./lastImport";
import { FIcon } from "./icons";

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** What the import did, in one line. */
function summary(r: ImportRecord): string {
  const parts = [
    r.added.length ? `added ${plural(r.added.length, "student", "students")}` : "",
    r.teams.moved.length ? `seated ${plural(r.teams.moved.length, "student", "students")}` : "",
    r.teams.created.length ? `made ${plural(r.teams.created.length, "team", "teams")}` : "",
    r.teams.renamed.length ? `renamed ${plural(r.teams.renamed.length, "team", "teams")}` : "",
    r.emails.length ? `filled in ${plural(r.emails.length, "address", "addresses")}` : "",
    r.names.length ? `corrected ${plural(r.names.length, "name", "names")}` : "",
  ].filter(Boolean);
  return parts.join(", ");
}

const bar = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  flexWrap: "wrap" as const,
  padding: "9px 12px",
  marginBottom: 14,
  border: "1px solid var(--fv-neutral-200)",
  borderRadius: "var(--fv-r-md)",
  background: "var(--fv-cream-300)",
  fontSize: "var(--fv-xs)",
  lineHeight: 1.5,
};

interface ImportUndoBarProps {
  last: LastImport;
  roster: Student[];
  teams: TeamWithMembers[];
  /** The roster on screen is still the one from before the import. */
  stale: boolean;
  onUndone: (result: string) => void;
  /** Re-read the class. Asked for after a failed undo, before any retry. */
  onRefresh: () => void;
  onDismiss: () => void;
}

export function ImportUndoBar(props: ImportUndoBarProps): JSX.Element {
  const { last, roster, teams } = props;
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** As on the assistant's drafts: no retry until the class has been re-read. */
  const [failedOn, setFailedOn] = useState<TeamWithMembers[] | null>(null);
  const reloading = props.stale || (failedOn !== null && failedOn === teams);
  const stillHere = last.record.added.filter((a) => roster.some((s) => s.id === a.studentId)).length;

  async function undo() {
    setAsking(false);
    setBusy(true);
    setError(null);
    try {
      const out = await undoImport(last.record, roster, teams);
      props.onUndone([importUndoText(out), ...out.notes].join(" "));
    } catch (e) {
      setFailedOn(teams);
      props.onRefresh();
      setError(
        `${(e as Error)?.message ?? e} Some of it may already be undone. Once the roster has been ` +
          "re-read, pressing Undo again finishes the rest.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={bar} role="status">
      <span style={{ flex: 1, minWidth: 200 }}>
        Last import, from {last.source}: {summary(last.record)}.
        {error ? <span style={{ display: "block", color: "var(--fv-destructive)", marginTop: 4 }}>{error}</span> : null}
      </span>
      <button
        type="button"
        className="fv-btn outline sm"
        disabled={busy || reloading}
        onClick={() => (stillHere ? setAsking(true) : void undo())}
      >
        {busy ? "Undoing…" : reloading ? "Checking the roster…" : "Undo this import"}
      </button>
      <button
        type="button"
        className="fv-iconbtn"
        style={{ width: 26, height: 26 }}
        aria-label="Hide — keep the import"
        title="Hide — keep the import"
        disabled={busy}
        onClick={props.onDismiss}
      >
        <FIcon name="close" size={14} />
      </button>

      {asking ? (
        <ConfirmDialog
          title="Undo this import?"
          body={
            <p style={{ margin: 0, lineHeight: 1.6 }}>
              {plural(stillHere, "student", "students")} it added come off the roster again — except anyone
              who has signed in or handed anything in since, who stay. Everyone it seated goes back to the team
              they were on, and teams it made go if they end up empty. Importing the file again puts it all back.
            </p>
          }
          confirmLabel="Undo the import"
          busy={busy}
          onConfirm={() => void undo()}
          onCancel={() => setAsking(false)}
        />
      ) : null}
    </div>
  );
}
