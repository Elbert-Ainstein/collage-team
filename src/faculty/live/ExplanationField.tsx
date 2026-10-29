"use client";

// A question's explanation in the builder: what teams read once they're done
// with the question (0051), never in the before-class round. Typed, or written
// by the model from the question and its key (/api/live-explain) — which
// replaces what's in the box, and is saved with the questions like typing.

import { useEffect, useRef, useState } from "react";
import { canExplain, explainQuestion } from "./explainClient";
import type { DraftQuestion } from "./draft";

interface Props {
  q: DraftQuestion;
  n: number;
  activityId: string;
  onChange: (explanation: string) => void;
  /** The generated text lands later, so it is merged into the question as it is then. */
  onPatch: (explanation: string) => void;
}

const message = (e: unknown): string => (e instanceof Error && e.message ? e.message : "No explanation came back. Try again.");

export function ExplanationField({ q, n, activityId, onChange, onPatch }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);

  const ready = canExplain(q);
  const generate = async () => {
    pending.current?.abort();
    const ctl = new AbortController();
    pending.current = ctl;
    setBusy(true);
    setError(null);
    try {
      onPatch(await explainQuestion(activityId, q, ctl.signal));
    } catch (e) {
      if ((e as Error)?.name !== "AbortError") setError(message(e));
    } finally {
      if (pending.current === ctl) {
        pending.current = null;
        setBusy(false);
      }
    }
  };

  return (
    <div className="lq-explain">
      <label className="fv-field">
        <span className="fv-eyebrow">Explanation</span>
        <textarea
          className="fv-ta lq-explainta"
          rows={3}
          value={q.explanation}
          placeholder="Why the answer is right"
          aria-label={`Question ${n} explanation`}
          disabled={busy}
          onChange={(e) => onChange(e.target.value)}
        />
      </label>
      <div className="lq-explainfoot">
        {error ? (
          <span className="lq-explainerr" role="alert">
            {error}
          </span>
        ) : null}
        <button
          type="button"
          className="lq-linkish"
          disabled={!ready || busy}
          title={ready ? undefined : "Finish the question and its answer first"}
          onClick={() => void generate()}
        >
          {busy ? "Writing…" : "Generate explanation"}
        </button>
      </div>
    </div>
  );
}
