"use client";

// Release the answers and explanations to individual mode (0053): for a class
// whose team mode couldn't run. Any time until the session is scored — before
// class, in team mode, or closed when it broke (0054) — it closes it without
// its team half: every student reads the key and the explanations beside their
// own answers, and their own answers are what gets scored.

import { useState } from "react";
import type { LiveState } from "@/live/types";
import { ConfirmDialog } from "../ConfirmDialog";

interface Props {
  state: LiveState;
  /** Pressing it also scores; otherwise the instructor scores it after. */
  grades: boolean;
  release: () => Promise<void>;
  onError: (e: unknown) => void;
}

/**
 * May it be released now? Not on a database without 0053 (no team_skipped, no
 * RPC to call), and not once scored: its grades are out.
 */
export function canRelease(state: LiveState): boolean {
  return state.team_skipped !== undefined && !(state.phase === "closed" && state.scored_at);
}

export function ReleaseAnswers({ state, grades, release, onError }: Props) {
  const [ask, setAsk] = useState<"ask" | "busy" | null>(null);
  if (!canRelease(state)) return null;

  const go = async () => {
    setAsk("busy");
    try {
      await release();
      setAsk(null);
    } catch (e) {
      onError(e);
      setAsk("ask");
    }
  };

  return (
    <>
      <button type="button" className="fv-btn outline sm full lq-release" onClick={() => setAsk("ask")}>
        Release answers and explanations to individual mode
      </button>
      {ask ? (
        <ConfirmDialog
          title="Release answers and explanations?"
          body={
            <>
              Every student sees the right answers and why beside their own.{" "}
              {grades ? "Their own answers are scored." : "The instructor scores their own answers after."} No team
              scores.
            </>
          }
          confirmLabel="Release"
          busyLabel="Releasing…"
          tone="primary"
          busy={ask === "busy"}
          onConfirm={() => void go()}
          onCancel={() => setAsk(null)}
        />
      ) : null}
    </>
  );
}
