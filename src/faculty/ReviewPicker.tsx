"use client";

// The first screen of Review: a Drive-style grid of what is waiting.
//
// One tile per activity with marks sent for review, grouped by week, newest
// first — the same shape Check-in opens on, so an instructor who has learned
// one has learned the other. The tile carries the two numbers that decide
// whether to open it now: how many are waiting, and how many the TF still has
// on their desk. Nothing is chosen for you; the page for one activity only
// opens once its tile is clicked.

import type { ReviewGroup, ReviewWeek } from "./reviewModel";
import { FIcon } from "./icons";

export function ReviewPicker({
  weeks,
  onOpen,
}: {
  weeks: ReviewWeek[];
  onOpen: (activityId: string) => void;
}): JSX.Element {
  return (
    <div className="fv-ckdrive">
      {weeks.map((w) => (
        <section key={String(w.week)} className="fv-ckweek" aria-label={w.label}>
          <div className="fv-eyebrow">
            {w.label}
            {w.dates ? <span style={{ fontWeight: 400 }}> · {w.dates}</span> : null}
          </div>
          <div className="fv-ckgrid">
            {w.groups.map((g) => (
              <Tile key={g.activity.id} group={g} onOpen={() => onOpen(g.activity.id)} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function Tile({ group, onOpen }: { group: ReviewGroup; onOpen: () => void }) {
  const { activity, rows, stillMarking } = group;
  return (
    <button
      type="button"
      className="fv-cktile"
      onClick={onOpen}
      aria-label={`Review ${activity.title}`}
    >
      <span className="fv-cktile-art" aria-hidden="true">
        <FIcon name="assignment" size={22} />
      </span>
      <span className="fv-cktile-body">
        <span className="fv-cktile-title">{activity.title}</span>
        <span className="fv-badge fv-cktile-scope">
          {rows.length} waiting
        </span>
        {stillMarking > 0 ? (
          <span className="fv-sub" style={{ fontSize: "var(--fv-2xs)" }}>
            {stillMarking} still being marked
          </span>
        ) : null}
      </span>
    </button>
  );
}
