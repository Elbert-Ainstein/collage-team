"use client";

// The faculty Activities list, rendered in the form students see it: week
// groups, newest first, one accented row per activity.
//
// Deliberately the same design language as src/student/Assignments.tsx — same
// tokens, same row anatomy, same badges — so faculty are looking at what they
// are authoring. What differs is the right-hand side of a row: a student sees
// their own status and grade, faculty see how far the class has got.

import { SIcon } from "@/student/icons";
import { SCOPE_LABEL, TYPE_ACCENT, TYPE_LABEL, scopeOf } from "./types";
import type { Activity } from "./types";
import "@/student/student.css";

/** Live counts for one row, computed by the pillar that owns the results. */
export interface ActivityRowMeta {
  /** Where this activity has got to, e.g. "Individual" — the row's badge. */
  stage: string;
  /** The `.sv-badge` variant for that badge. */
  stageBadge: string;
  /** One short line of live counts, e.g. "12 / 18 in". */
  counts: string;
}

export interface ActivityWeeksProps {
  activities: Activity[];
  metaFor: (a: Activity) => ActivityRowMeta;
  onOpen: (id: string) => void;
  /** Start an activity in a brand-new week. */
  onNewWeek: () => void;
  /** Start an activity in the week already showing. */
  onNewActivity: () => void;
}

interface WeekGroup {
  key: string;
  label: string;
  dates: string;
  items: Activity[];
}

/** Newest week first, mirroring the student list. */
function groupByWeek(activities: Activity[]): WeekGroup[] {
  const buckets = new Map<number | null, Activity[]>();
  for (const a of activities) {
    const bucket = buckets.get(a.week);
    if (bucket) bucket.push(a);
    else buckets.set(a.week, [a]);
  }
  const keys = [...buckets.keys()].sort((x, y) => {
    if (x === null) return 1;
    if (y === null) return -1;
    return y - x;
  });
  return keys.map((week) => {
    const items = (buckets.get(week) ?? []).slice().sort((p, q) => p.position - q.position);
    return {
      key: week === null ? "none" : String(week),
      label: week === null ? "Unscheduled" : `Week ${week}`,
      dates: items.find((it) => it.dates_label)?.dates_label ?? "",
      items,
    };
  });
}

/**
 * The line under a row title. A student sees the due date here; faculty see
 * that if it is set, and otherwise how far the authoring has got.
 */
function subLine(a: Activity): string {
  if (a.dates_label) return a.dates_label;
  if (a.topic) return a.topic;
  const parts = [
    a.source_text?.trim() ? "Instructions set" : "No instructions yet",
    a.files.length ? `${a.files.length} file${a.files.length === 1 ? "" : "s"}` : null,
  ];
  return parts.filter(Boolean).join(" · ");
}

function ActivityRow({
  a,
  meta,
  onOpen,
}: {
  a: Activity;
  meta: ActivityRowMeta;
  onOpen: (id: string) => void;
}) {
  const scope = scopeOf(a);
  return (
    <button
      type="button"
      onClick={() => onOpen(a.id)}
      title={`Edit ${a.title}`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        width: "100%",
        padding: "13px 16px",
        border: "1px solid var(--neutral-200)",
        borderLeft: `3px solid ${TYPE_ACCENT[a.type]}`,
        background: "var(--cream-100)",
        borderRadius: "var(--radius-lg)",
        boxShadow: "var(--shadow)",
        font: "inherit",
        color: "var(--navy)",
        textAlign: "left",
        cursor: "pointer",
        transition: "background 140ms ease, box-shadow 140ms ease",
      }}
    >
      <span
        style={{
          flex: "none",
          width: 82,
          fontSize: "var(--text-2xs)",
          letterSpacing: "var(--tracking-wide)",
          textTransform: "uppercase",
          fontWeight: "var(--weight-semibold)",
          color: TYPE_ACCENT[a.type],
        }}
      >
        {TYPE_LABEL[a.type]}
      </span>

      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
          <span
            style={{
              fontFamily: "var(--font-serif)",
              fontSize: "var(--text-base)",
              fontWeight: "var(--weight-bold)",
              letterSpacing: "var(--tracking-tight)",
            }}
          >
            {a.title}
          </span>
          <span className="sv-badge outline">{SCOPE_LABEL[scope]}</span>
        </span>
        <span
          style={{
            display: "block",
            fontSize: "var(--text-xs)",
            color: "var(--muted-foreground)",
            marginTop: 3,
          }}
        >
          {subLine(a)}
        </span>
      </span>

      <span className={`sv-badge ${meta.stageBadge}`}>{meta.stage}</span>

      <span
        className="sv-num"
        style={{
          width: 74,
          flex: "none",
          textAlign: "right",
          fontSize: "var(--text-xs)",
          color: "var(--muted-foreground)",
        }}
      >
        {meta.counts}
      </span>

      <span style={{ color: "var(--muted-foreground)", display: "flex", alignItems: "center" }}>
        <SIcon name="chevronRight" size={18} />
      </span>
    </button>
  );
}

export function ActivityWeeks({
  activities,
  metaFor,
  onOpen,
  onNewWeek,
  onNewActivity,
}: ActivityWeeksProps) {
  const groups = groupByWeek(activities);

  return (
    <section>
      <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <h1 className="sv-h1">Activities</h1>
          <div className="sv-sub" style={{ marginTop: 4 }}>
            What your class sees, in the order they see it. Open one to edit it.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="sv-btn outline" onClick={onNewWeek}>
            <SIcon name="add" size={15} />
            Week
          </button>
          <button type="button" className="sv-btn primary" onClick={onNewActivity}>
            <SIcon name="add" size={15} />
            Activity
          </button>
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="sv-card" style={{ marginTop: 18, padding: "34px 20px", textAlign: "center" }}>
          <div className="sv-h2">No activities yet</div>
          <p className="sv-sub" style={{ margin: "8px 0 16px", maxWidth: "56ch", marginInline: "auto" }}>
            An activity is one piece of work in one week. Pick who it is for, write the
            instructions, attach the files, and assign it.
          </p>
          <button type="button" className="sv-btn primary" onClick={onNewWeek}>
            <SIcon name="add" size={15} />
            Create week 1
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 22, marginTop: 20 }}>
          {groups.map((g) => (
            <div key={g.key}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 9 }}>
                <span
                  style={{
                    fontFamily: "var(--font-serif)",
                    fontSize: "var(--text-base)",
                    fontWeight: "var(--weight-bold)",
                    letterSpacing: "var(--tracking-tight)",
                  }}
                >
                  {g.label}
                </span>
                {g.dates ? <span className="sv-sub">{g.dates}</span> : null}
                <span className="sv-rule" style={{ flex: 1 }} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {g.items.map((a) => (
                  <ActivityRow key={a.id} a={a} meta={metaFor(a)} onOpen={onOpen} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
