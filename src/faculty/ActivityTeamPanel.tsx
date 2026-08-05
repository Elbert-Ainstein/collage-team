"use client";

// The Team half of an activity page: every team, what the live check-in
// recorded for them, and who was in the room.
//
// Read-only. The sheet is filled in on the Check-in tab, which is where
// somebody is standing during a tutorial; this is the same data seen from the
// activity, which is where somebody stands afterwards. Two places to edit one
// row is how they end up disagreeing.

import { useCallback, useEffect, useState } from "react";
import type { Student, TeamWithMembers } from "@/checkins/types";
import {
  SLOTS,
  getTutorialSheet,
  markFor,
  type TutorialAbsence,
  type TutorialMark,
} from "@/checkins/tutorial";
import { FAvatar, FIcon } from "./icons";

export function ActivityTeamPanel({
  activityId,
  teams,
  onOpenCheckIn,
}: {
  activityId: string;
  teams: TeamWithMembers[];
  /** Takes the instructor to the sheet where this is actually filled in. */
  onOpenCheckIn: () => void;
}): JSX.Element {
  const [marks, setMarks] = useState<TutorialMark[]>([]);
  const [absences, setAbsences] = useState<TutorialAbsence[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const sheet = await getTutorialSheet(activityId);
      setMarks(sheet.marks);
      setAbsences(sheet.absences);
    } catch (e) {
      setMarks([]);
      setAbsences([]);
      setError(e instanceof Error ? e.message : "Could not read this activity's check-in.");
    } finally {
      setLoading(false);
    }
  }, [activityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const awayIn = (teamId: string) =>
    absences.filter((a) => a.team_id === teamId).map((a) => a.student_id);

  const anything = marks.some(
    (m) => m.presenter_id !== null || m.accuracy !== null || m.discussion !== null,
  );

  return (
    <div className="fv-teampanel">
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <span className="fv-eyebrow" style={{ flex: 1 }}>
          Teams · from the live check-in
        </span>
        <button type="button" className="fv-btn outline sm" onClick={onOpenCheckIn}>
          <FIcon name="check" size={15} />
          Open check-in
        </button>
      </div>

      {error ? (
        <div
          role="alert"
          style={{
            padding: "8px 12px",
            marginBottom: 10,
            border: "1px solid var(--fv-neutral-200)",
            background: "var(--fv-cream-300)",
            borderRadius: "var(--fv-r-md)",
            fontSize: "var(--fv-xs)",
            color: "var(--fv-amber)",
            lineHeight: 1.5,
          }}
        >
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="fv-sub">Loading…</div>
      ) : teams.length === 0 ? (
        <p className="fv-sub" style={{ lineHeight: 1.6, maxWidth: "56ch" }}>
          No teams yet. Form them on the Teams tab and they will appear here, one row each.
        </p>
      ) : (
        <>
          {!anything ? (
            <p className="fv-sub" style={{ lineHeight: 1.6, maxWidth: "60ch", marginBottom: 10 }}>
              Nothing recorded for this activity yet. Every team is listed as fully present until
              the check-in says otherwise.
            </p>
          ) : null}

          <div className="fv-tblwrap">
            <table className="fv-tbl">
              <thead>
                <tr>
                  <th className="fv-sticky-l">
                    <span className="fv-eyebrow">Team</span>
                  </th>
                  <th>
                    <span className="fv-eyebrow">In the room</span>
                  </th>
                  {SLOTS.map((n) => (
                    <th key={n} colSpan={3} style={{ borderLeft: "1px solid var(--fv-neutral-200)" }}>
                      <span style={{ fontWeight: 600, color: "var(--fv-navy)" }}>Check-in {n}</span>
                    </th>
                  ))}
                </tr>
                <tr>
                  <th className="fv-sticky-l" />
                  <th />
                  {SLOTS.map((n) => (
                    <Cells key={n}>
                      <th style={{ borderLeft: "1px solid var(--fv-neutral-200)" }}>
                        <span className="fv-eyebrow">Presenter</span>
                      </th>
                      <th>
                        <span className="fv-eyebrow">Acc</span>
                      </th>
                      <th>
                        <span className="fv-eyebrow">Disc</span>
                      </th>
                    </Cells>
                  ))}
                </tr>
              </thead>

              <tbody>
                {teams.map((team) => {
                  const away = awayIn(team.id);
                  const present = team.members.filter((m) => !away.includes(m.id));
                  return (
                    <tr key={team.id} className="fv-trstu">
                      <td className="fv-sticky-l">
                        <div className="fv-subject">
                          <FIcon name="groups" size={16} />
                          <span style={{ fontSize: "var(--fv-xs)", fontWeight: 600 }}>
                            {team.name}
                          </span>
                          <span
                            className="fv-sub fv-num"
                            style={{ marginLeft: "auto", fontSize: "var(--fv-2xs)" }}
                            title={`${present.length} present of ${team.members.length}`}
                          >
                            {present.length}/{team.members.length}
                          </span>
                        </div>
                      </td>

                      {/* Present and absent in one cell, together. Two columns
                          would ask the reader to cross-reference to answer the
                          only question anyone has here: who was there. */}
                      <td style={{ padding: "6px 8px", minWidth: 190 }}>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                          {team.members.map((m) => (
                            <Person key={m.id} student={m} away={away.includes(m.id)} />
                          ))}
                        </div>
                      </td>

                      {SLOTS.map((n) => {
                        const mark = markFor(marks, team.id, n);
                        const presenter =
                          team.members.find((m) => m.id === mark?.presenter_id) ?? null;
                        return (
                          <Cells key={n}>
                            <td
                              style={{
                                padding: "6px 8px",
                                borderLeft: "1px solid var(--fv-neutral-200)",
                                minWidth: 132,
                              }}
                            >
                              {presenter ? (
                                <div
                                  style={{ display: "flex", alignItems: "center", gap: 6 }}
                                >
                                  <FAvatar
                                    name={presenter.name}
                                    tint={presenter.avatar_tint}
                                    size={20}
                                  />
                                  <span
                                    className="fv-ellip"
                                    style={{ fontSize: "var(--fv-xs)" }}
                                  >
                                    {presenter.name}
                                  </span>
                                </div>
                              ) : (
                                <span className="fv-sub" style={{ fontSize: "var(--fv-2xs)" }}>
                                  —
                                </span>
                              )}
                            </td>
                            <td style={{ padding: "6px 8px" }}>
                              <Score value={mark?.accuracy ?? null} />
                            </td>
                            <td style={{ padding: "6px 8px" }}>
                              <Score value={mark?.discussion ?? null} />
                            </td>
                          </Cells>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

/** A team member, struck through and dimmed when they were not in the room. */
function Person({ student, away }: { student: Student; away: boolean }) {
  return (
    <span
      title={away ? `${student.name} — absent` : `${student.name} — present`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "2px 7px 2px 3px",
        borderRadius: 999,
        border: `1px solid ${away ? "var(--fv-neutral-200)" : "transparent"}`,
        background: away ? "transparent" : "var(--fv-cream-300)",
        fontSize: "var(--fv-2xs)",
        color: away ? "var(--fv-muted)" : "var(--fv-navy)",
        // Struck through as well as dimmed: colour alone is not a signal
        // everybody can read, and "who was absent" is the question this cell
        // exists to answer.
        textDecoration: away ? "line-through" : "none",
      }}
    >
      <FAvatar name={student.name} tint={student.avatar_tint} size={16} />
      {student.name}
    </span>
  );
}

/** 1–5 as a number and a bar, so a column of them is scannable. */
function Score({ value }: { value: number | null }) {
  if (value == null) {
    return (
      <span className="fv-sub" style={{ fontSize: "var(--fv-2xs)" }}>
        —
      </span>
    );
  }
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span
        style={{
          width: 34,
          height: 5,
          borderRadius: 3,
          background: "var(--fv-neutral-200)",
          overflow: "hidden",
          flex: "none",
        }}
      >
        <span
          style={{
            display: "block",
            width: `${(value / 5) * 100}%`,
            height: "100%",
            borderRadius: 3,
            background: value === 5 ? "var(--fv-emerald, #059669)" : "var(--fv-navy-700)",
          }}
        />
      </span>
      <span className="fv-num" style={{ fontSize: "var(--fv-xs)" }}>
        {value}
      </span>
    </span>
  );
}

/** A keyed fragment, so the grouped cells stay siblings inside <tr>/<thead>. */
function Cells({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
