"use client";

// Release the answers and explanations to individual mode (0053): for a class
// whose team mode couldn't run. Any time before the session closes, it closes
// it without its team half: every student reads the key and the explanations
// beside their own answers, and their own answers are what gets scored.

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

export function ReleaseAnswers({ state, grades, release, onError }: Props) {
  const [ask, setAsk] = useState<"ask" | "busy" | null>(null);
  // A database without 0053 has no team_skipped, and no RPC to call.
  if (state.team_skipped === undefined || state.phase === "closed") return null;

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
              {grades ? "Their own answers are scored." : "The instructor scores their own answers after."} Team mode
              won’t run for this one.
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
