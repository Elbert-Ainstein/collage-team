"use client";

// A fill_team_eval draft in the chat: what it put into the team evaluation
// form, what it could not, and Undo.
//
// Unlike a team change, it is filled in at once rather than waiting on an
// Apply here: the form IS the preview — she sees every word in place, edits it
// there, and nothing is written until she presses the builder's own button.
// Undo puts back what the fill changed, and keeps anything typed elsewhere
// since; it is offered on the latest fill only, since putting back an older
// one could also undo the newer.

import type { TeamEvalProposal } from "@/assistant/types";
import type { DraftStatus } from "./thread";

interface TeamEvalCardProps {
  proposal: TeamEvalProposal;
  status: DraftStatus;
  /** Once filled: what changed, and what the form's locks kept out. */
  changes?: string[];
  skipped?: string[];
  /** The builder's button, for "press Finish to keep it". */
  saveLabel?: string;
  /** A builder is open to fill. */
  canApply: boolean;
  /** This is the latest fill, and its builder is still open. */
  canUndo: boolean;
  onApply: () => void;
  onUndo: () => void;
  onDismiss: () => void;
}

export function TeamEvalCard(props: TeamEvalCardProps): JSX.Element {
  const { proposal, status, changes = [], skipped = [], saveLabel = "Save", canApply, canUndo } = props;
  const leftOut = [...skipped, ...proposal.notApplied];

  if (status === "undone") {
    return (
      <div className="fv-as-draft">
        <div className="fv-as-msg">Undone.</div>
      </div>
    );
  }
  if (status === "dismissed") {
    return (
      <div className="fv-as-draft">
        <div className="fv-as-quiet">Discarded.</div>
      </div>
    );
  }

  return (
    <div className="fv-as-draft">
      <span className="fv-eyebrow">Team evaluation</span>
      {status === "applied" ? (
        changes.length ? (
          <>
            <div className="fv-as-done">Filled in · press {saveLabel} to keep it</div>
            <ul>
              {changes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </>
        ) : (
          <div style={{ marginTop: 6 }}>Nothing to change — the form already says that.</div>
        )
      ) : (
        <div style={{ marginTop: 6 }}>
          {canApply ? "Ready to fill in." : "Open the evaluation and press Edit to fill this in."}
        </div>
      )}

      {leftOut.length ? (
        <>
          <span className="fv-eyebrow">Left out</span>
          <ul>
            {leftOut.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </>
      ) : null}

      {status === "applied" && canUndo && changes.length ? (
        <div className="fv-as-btns">
          <button type="button" className="fv-btn outline sm" onClick={props.onUndo}>
            Undo
          </button>
        </div>
      ) : null}
      {status === "open" ? (
        <div className="fv-as-btns">
          <button type="button" className="fv-btn primary sm" disabled={!canApply} onClick={props.onApply}>
            Fill in
          </button>
          <button type="button" className="fv-btn ghost sm" onClick={props.onDismiss}>
            Discard
          </button>
        </div>
      ) : null}
    </div>
  );
}
