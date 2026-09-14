"use client";

// The first screen of Check-in: a Drive-style grid of what can be checked in.
//
// One tile per activity, grouped by week, newest week first — the same order
// the sidebar list had, laid out so a TF can find this session's tutorial at a
// glance rather than scanning a column. Clicking a tile opens that activity's
// sheet; nothing is chosen for you, because a sheet that opens on whatever
// happens to be first is a sheet that gets marked against the wrong week.

import type { Activity } from "@/checkins/types";
import { SCOPE_OF } from "@/checkins/types";
import type { WeekGroup } from "./model";
import { FIcon } from "./icons";

export function CheckInPicker({
  groups,
  onOpen,
}: {
  groups: WeekGroup[];
  onOpen: (activityId: string) => void;
}): JSX.Element {
  if (groups.length === 0) {
    return (
      <p
        className="fv-sub"
        style={{ lineHeight: 1.55, padding: "4px 2px", maxWidth: "56ch" }}
      >
        No team activities yet. A check-in belongs to work a team does together,
        so team and individual + team activities appear here.
      </p>
    );
  }

  return (
    <div className="fv-ckdrive">
      {groups.map((g) => (
        <section key={g.label} className="fv-ckweek" aria-label={g.label}>
          <div className="fv-eyebrow">
            {g.label}
            {g.dates ? (
              <span style={{ fontWeight: 400 }}> · {g.dates}</span>
            ) : null}
          </div>
          <div className="fv-ckgrid">
            {g.activities.map((a) => (
              <Tile key={a.id} activity={a} onOpen={() => onOpen(a.id)} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function Tile({
  activity,
  onOpen,
}: {
  activity: Activity;
  onOpen: () => void;
}) {
  const scope = SCOPE_OF[activity.type] === "team" ? "Team" : "Ind + team";
  return (
    <button
      type="button"
      className="fv-cktile"
      onClick={onOpen}
      aria-label={`Open the check-in for ${activity.title}`}
    >
      <span className="fv-cktile-art" aria-hidden="true">
        <FIcon name="groups" size={22} />
      </span>
      <span className="fv-cktile-body">
        <span className="fv-cktile-title">{activity.title}</span>
        <span className="fv-badge outline fv-cktile-scope">{scope}</span>
      </span>
    </button>
  );
}
