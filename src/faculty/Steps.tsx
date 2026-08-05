"use client";

// The two-step strip across the top of authoring a new activity.
//
// Labelled bars rather than numbered dots: the labels are what say where you
// are, and a number beside a word that already reads as an ordinal ("Details")
// is a second way of saying the same thing. A step already passed stays filled,
// so the strip reads as progress rather than as a selector.
//
// Only shown while an activity is being CREATED. Editing one later is not a
// sequence — you open the thing you want and change it — and a wizard bar over
// a page somebody came back to would suggest there is more to do.

export interface Step {
  key: string;
  label: string;
}

export function Steps({
  steps,
  current,
  onGo,
}: {
  steps: Step[];
  /** Index of the step being shown. */
  current: number;
  /** Go back to an earlier step. Later ones are not reachable by clicking. */
  onGo?: (index: number) => void;
}): JSX.Element {
  return (
    <ol className="fv-steps" aria-label="Creating an activity">
      {steps.map((s, i) => {
        const done = i < current;
        const on = i === current;
        // Back is allowed, forward is not: step two writes against what step
        // one saved, so skipping ahead would build a rubric for an activity
        // whose shape has not been committed.
        const clickable = done && Boolean(onGo);
        return (
          <li key={s.key} className="fv-step">
            {clickable ? (
              <button
                type="button"
                className={`fv-steplabel${on ? " on" : ""}${done ? " done" : ""}`}
                onClick={() => onGo?.(i)}
              >
                {s.label}
              </button>
            ) : (
              <span
                className={`fv-steplabel${on ? " on" : ""}${done ? " done" : ""}`}
                aria-current={on ? "step" : undefined}
              >
                {s.label}
              </span>
            )}
            <span className={`fv-stepbar${done || on ? " on" : ""}`} aria-hidden="true" />
          </li>
        );
      })}
    </ol>
  );
}

/** The one sequence there is. Named here so both screens agree on the wording. */
export const NEW_ACTIVITY_STEPS: Step[] = [
  { key: "basics", label: "Activity" },
  { key: "rubric", label: "Questions & grading" },
];
