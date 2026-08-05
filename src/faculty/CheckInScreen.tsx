"use client";

// Check-in — the live-session sheet the instructor fills in while a tutorial is
// running: who is absent, who presented, and how each check-in went.
//
// PROTOTYPE. Nothing here is written to the database, on purpose — this is the
// shape being tried out, not the finished feature. Everything typed lives in
// this component's state and is gone on reload, and the screen says so at the
// top rather than letting somebody mark a whole session and lose it. When it is
// settled, the state below is what a table has to hold.

import { useMemo, useState } from "react";
import type { Student, TeamWithMembers } from "@/checkins/types";
import type { FacultyData } from "./FacultyApp";
import { FAvatar, FIcon } from "./icons";

/** How many tutorial check-ins one session carries. Two, per the sketch. */
const CHECK_INS = [1, 2] as const;
/** Both scales are 1-5. */
const SCALE = [1, 2, 3, 4, 5] as const;

/** What one team's row holds. Keyed by team id in `sheet` below. */
interface Row {
  /** Two absence slots, each a student id or "" for nobody. */
  absent: [string, string];
  /** Per check-in: who presented, and the two marks. */
  checkIns: {
    presenter: string;
    accuracy: number | null;
    discussion: number | null;
  }[];
}

const emptyRow = (): Row => ({
  absent: ["", ""],
  checkIns: CHECK_INS.map(() => ({ presenter: "", accuracy: null, discussion: null })),
});

export function CheckInScreen({ data }: { data: FacultyData }): JSX.Element {
  const teams = data.teams;
  const [sheet, setSheet] = useState<Record<string, Row>>({});

  const rowFor = (teamId: string): Row => sheet[teamId] ?? emptyRow();

  const edit = (teamId: string, change: (r: Row) => Row) =>
    setSheet((prev) => ({ ...prev, [teamId]: change(prev[teamId] ?? emptyRow()) }));

  // A count so the "nothing is saved" warning can say how much is at stake
  // rather than being a line nobody reads.
  const filled = useMemo(
    () =>
      Object.values(sheet).reduce(
        (n, r) =>
          n +
          r.absent.filter(Boolean).length +
          r.checkIns.reduce(
            (m, c) =>
              m + (c.presenter ? 1 : 0) + (c.accuracy != null ? 1 : 0) + (c.discussion != null ? 1 : 0),
            0,
          ),
        0,
      ),
    [sheet],
  );

  if (!teams.length) {
    return (
      <div className="fv-panel">
        <Head filled={0} />
        <div className="fv-card" style={{ padding: 26, maxWidth: 560 }}>
          <div style={{ fontFamily: "var(--fv-serif)", fontSize: "var(--fv-lg)", fontWeight: 700 }}>
            No teams yet
          </div>
          <p className="fv-sub" style={{ marginTop: 8, lineHeight: 1.6, maxWidth: "56ch" }}>
            This sheet has one row per team. Form them on the Teams tab and they will appear here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="fv-panel">
      <Head filled={filled} />

      <div className="fv-scroll">
        <div className="fv-tblwrap">
          <table className="fv-tbl">
            <thead>
              <tr>
                <th className="fv-sticky-l">
                  <span className="fv-eyebrow">Team</span>
                </th>
                <th>
                  <span className="fv-eyebrow">Absent 1</span>
                </th>
                <th>
                  <span className="fv-eyebrow">Absent 2</span>
                </th>
                {CHECK_INS.map((n) => (
                  // One group per check-in, spanning its three columns — the
                  // same two-row header the gradebook uses, so the two screens
                  // read as the same kind of table.
                  <th key={n} colSpan={3} style={{ borderLeft: "1px solid var(--fv-neutral-200)" }}>
                    <span style={{ fontWeight: 600, color: "var(--fv-navy)" }}>
                      Tutorial check-in {n}
                    </span>
                  </th>
                ))}
              </tr>
              <tr>
                <th className="fv-sticky-l" />
                <th />
                <th />
                {CHECK_INS.map((n) => (
                  <Fragmentish key={n}>
                    <th style={{ borderLeft: "1px solid var(--fv-neutral-200)" }}>
                      <span className="fv-eyebrow">Presenter</span>
                    </th>
                    <th>
                      <span className="fv-eyebrow">Accuracy 1–5</span>
                    </th>
                    <th>
                      <span className="fv-eyebrow">Quality of discussion 1–5</span>
                    </th>
                  </Fragmentish>
                ))}
              </tr>
            </thead>

            <tbody>
              {teams.map((team) => {
                const row = rowFor(team.id);
                return (
                  <tr key={team.id} className="fv-trstu">
                    <td className="fv-sticky-l">
                      <div className="fv-subject">
                        <FIcon name="groups" size={16} />
                        <span style={{ fontSize: "var(--fv-xs)", fontWeight: 600 }}>
                          {team.name}
                        </span>
                        <span
                          className="fv-sub"
                          style={{ marginLeft: "auto", fontSize: "var(--fv-2xs)" }}
                        >
                          {team.members.length}
                        </span>
                      </div>
                    </td>

                    {[0, 1].map((slot) => (
                      <td key={slot} style={{ padding: 6 }}>
                        <PersonPicker
                          team={team}
                          value={row.absent[slot]}
                          // The other slot's pick is off the list: marking the
                          // same person absent twice is never what was meant,
                          // and it would quietly halve the count.
                          exclude={row.absent[slot === 0 ? 1 : 0]}
                          placeholder="Nobody"
                          onChange={(id) =>
                            edit(team.id, (r) => {
                              const absent: [string, string] = [...r.absent] as [string, string];
                              absent[slot] = id;
                              return { ...r, absent };
                            })
                          }
                        />
                      </td>
                    ))}

                    {CHECK_INS.map((n, i) => (
                      <Fragmentish key={n}>
                        <td style={{ padding: 6, borderLeft: "1px solid var(--fv-neutral-200)" }}>
                          <PersonPicker
                            team={team}
                            value={row.checkIns[i].presenter}
                            placeholder="Pick one"
                            onChange={(id) =>
                              edit(team.id, (r) => ({
                                ...r,
                                checkIns: r.checkIns.map((c, j) =>
                                  j === i ? { ...c, presenter: id } : c,
                                ),
                              }))
                            }
                          />
                        </td>
                        <td style={{ padding: 6 }}>
                          <Scale
                            label={`Accuracy, check-in ${n}, ${team.name}`}
                            value={row.checkIns[i].accuracy}
                            onChange={(v) =>
                              edit(team.id, (r) => ({
                                ...r,
                                checkIns: r.checkIns.map((c, j) =>
                                  j === i ? { ...c, accuracy: v } : c,
                                ),
                              }))
                            }
                          />
                        </td>
                        <td style={{ padding: 6 }}>
                          <Scale
                            label={`Quality of discussion, check-in ${n}, ${team.name}`}
                            value={row.checkIns[i].discussion}
                            onChange={(v) =>
                              edit(team.id, (r) => ({
                                ...r,
                                checkIns: r.checkIns.map((c, j) =>
                                  j === i ? { ...c, discussion: v } : c,
                                ),
                              }))
                            }
                          />
                        </td>
                      </Fragmentish>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Head({ filled }: { filled: number }) {
  return (
    <>
      <div className="fv-head">
        <div>
          <h1 className="fv-h1">Check-in</h1>
          <div className="fv-sub">
            One row per team. Fill it in while the tutorial is running.
          </div>
        </div>
      </div>

      {/* Said plainly and near the top. A prototype that looks like a gradebook
          and forgets a session's marks on reload is worse than no screen. */}
      <div
        role="status"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 12px",
          marginBottom: 12,
          border: "1px solid var(--fv-neutral-200)",
          background: "var(--fv-cream-300)",
          borderRadius: "var(--fv-r-md)",
          fontSize: "var(--fv-xs)",
          color: "var(--fv-amber)",
          lineHeight: 1.5,
        }}
      >
        <FIcon name="assignment" size={15} />
        <span>
          Prototype — nothing here is saved yet.{" "}
          {filled > 0
            ? `${filled} ${filled === 1 ? "entry" : "entries"} on this sheet will be lost if you reload or leave.`
            : "Reloading or leaving this tab clears it."}
        </span>
      </div>
    </>
  );
}

/** A team member picker: the team, plus an empty choice. */
function PersonPicker({
  team,
  value,
  exclude,
  placeholder,
  onChange,
}: {
  team: TeamWithMembers;
  value: string;
  exclude?: string;
  placeholder: string;
  onChange: (studentId: string) => void;
}) {
  const options: Student[] = team.members.filter((m) => !exclude || m.id !== exclude);
  const picked = team.members.find((m) => m.id === value) ?? null;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      {picked ? <FAvatar name={picked.name} tint={picked.avatar_tint} size={20} /> : null}
      <select
        className="fv-in"
        style={{ minWidth: 116, height: 28, padding: "0 6px" }}
        value={value}
        aria-label={placeholder}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{placeholder}</option>
        {options.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
    </div>
  );
}

/** 1–5, as five buttons — faster to hit during a live session than a dropdown. */
function Scale({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  return (
    <div role="group" aria-label={label} style={{ display: "flex", gap: 2 }}>
      {SCALE.map((n) => {
        const on = value === n;
        return (
          <button
            key={n}
            type="button"
            className="fv-num"
            aria-pressed={on}
            // Pressing the current value clears it — otherwise a mis-tap is
            // permanent and there is nowhere to put "not marked".
            onClick={() => onChange(on ? null : n)}
            style={{
              width: 24,
              height: 26,
              border: "1px solid var(--fv-neutral-200)",
              borderRadius: "var(--fv-r-md)",
              background: on ? "var(--fv-navy)" : "var(--fv-cream-100)",
              color: on ? "var(--fv-cream-100)" : "var(--fv-muted)",
              fontWeight: on ? 600 : 400,
              fontSize: "var(--fv-xs)",
              cursor: "pointer",
            }}
          >
            {n}
          </button>
        );
      })}
    </div>
  );
}

/** A keyed fragment, so the grouped cells stay siblings inside <tr>/<thead>. */
function Fragmentish({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
