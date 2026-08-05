"use client";

// Check-in — the live-session sheet, filled in while a tutorial is running.
//
// Pick an activity on the left, mark the room on the right: who was absent, who
// presented each check-in, and the two 1-5 scores. It saves as you go, and what
// is recorded here is what a student on that team sees against that activity —
// so nothing is held in this component that a reload would lose.
//
// Only TEAM and INDIVIDUAL+TEAM activities are listed. A check-in is a team
// presenting to the room; an individual-only activity has no team half for the
// marks to belong to, and offering one would collect marks nothing can display.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Activity, Student, TeamWithMembers } from "@/checkins/types";
import { SCOPE_OF } from "@/checkins/types";
import {
  SCALE,
  SLOTS,
  getTutorialSheet,
  markFor,
  setTutorialAbsences,
  setTutorialMark,
  type TutorialAbsence,
  type TutorialMark,
} from "@/checkins/tutorial";
import { groupByWeek } from "./model";
import type { FacultyData } from "./FacultyApp";
import { FAvatar, FIcon } from "./icons";

export function CheckInScreen({ data }: { data: FacultyData }): JSX.Element {
  const teams = data.teams;

  // Weeks with their activities, minus the ones a check-in cannot describe.
  const groups = useMemo(() => {
    const all = groupByWeek(data.activities, data.weeks, data.stats);
    return all
      .map((g) => ({ ...g, activities: g.activities.filter((a) => SCOPE_OF[a.type] !== "indiv") }))
      .filter((g) => g.activities.length > 0);
  }, [data.activities, data.weeks, data.stats]);

  const first = groups[0]?.activities[0]?.id ?? null;
  const [selId, setSelId] = useState<string | null>(null);
  const selected: Activity | null = useMemo(
    () => groups.flatMap((g) => g.activities).find((a) => a.id === selId) ?? null,
    [groups, selId],
  );

  // Land on something rather than an empty right-hand side, and recover if the
  // chosen activity is deleted or changes type underneath.
  useEffect(() => {
    if (!selected && first) setSelId(first);
  }, [selected, first]);

  const [marks, setMarks] = useState<TutorialMark[]>([]);
  const [absences, setAbsences] = useState<TutorialAbsence[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(0);

  const load = useCallback(async () => {
    if (!selId) return;
    setLoading(true);
    setError(null);
    try {
      const sheet = await getTutorialSheet(selId);
      setMarks(sheet.marks);
      setAbsences(sheet.absences);
    } catch (e) {
      setMarks([]);
      setAbsences([]);
      setError(e instanceof Error ? e.message : "Could not open this activity's check-in.");
    } finally {
      setLoading(false);
    }
  }, [selId]);

  useEffect(() => {
    void load();
  }, [load]);

  const canEdit = data.can.runCheckIns;

  /**
   * Write one field, and put the answer back in place of the optimistic row.
   *
   * Optimistic because marking a room is rapid and repetitive — waiting on a
   * round trip per click makes it feel broken — but the server's row replaces it
   * so an id and updated_at are never invented locally.
   */
  const writeMark = async (
    teamId: string,
    slot: number,
    patch: Partial<Pick<TutorialMark, "presenter_id" | "accuracy" | "discussion">>,
  ) => {
    if (!selId || !canEdit) return;
    const before = marks;
    setMarks((prev) => {
      const at = prev.findIndex((m) => m.team_id === teamId && m.slot === slot);
      if (at < 0) {
        return [
          ...prev,
          {
            id: `pending:${teamId}:${slot}`,
            activity_id: selId,
            team_id: teamId,
            slot,
            presenter_id: null,
            accuracy: null,
            discussion: null,
            updated_at: "",
            ...patch,
          },
        ];
      }
      return prev.map((m, i) => (i === at ? { ...m, ...patch } : m));
    });

    setSaving((n) => n + 1);
    setError(null);
    try {
      // The whole slot is sent, not just the changed field: upsert writes a row,
      // and sending one column would blank the other two on an existing row.
      const current = markFor(before, teamId, slot);
      const saved = await setTutorialMark(
        { activityId: selId, teamId, slot },
        {
          presenter_id: current?.presenter_id ?? null,
          accuracy: current?.accuracy ?? null,
          discussion: current?.discussion ?? null,
          ...patch,
        },
      );
      setMarks((prev) => [
        ...prev.filter((m) => !(m.team_id === teamId && m.slot === slot)),
        saved,
      ]);
    } catch (e) {
      setMarks(before);
      setError(e instanceof Error ? e.message : "That didn't save.");
    } finally {
      setSaving((n) => n - 1);
    }
  };

  const writeAbsences = async (teamId: string, studentIds: string[]) => {
    if (!selId || !canEdit) return;
    const before = absences;
    setAbsences((prev) => [
      ...prev.filter((a) => a.team_id !== teamId),
      ...studentIds.map((student_id) => ({ activity_id: selId, team_id: teamId, student_id })),
    ]);
    setSaving((n) => n + 1);
    setError(null);
    try {
      await setTutorialAbsences(selId, teamId, studentIds);
    } catch (e) {
      setAbsences(before);
      setError(e instanceof Error ? e.message : "That didn't save.");
    } finally {
      setSaving((n) => n - 1);
    }
  };

  const absentIn = (teamId: string): string[] =>
    absences.filter((a) => a.team_id === teamId).map((a) => a.student_id);

  return (
    <div className="fv-panel">
      <div className="fv-head">
        <div>
          <h1 className="fv-h1">Check-in</h1>
          <div className="fv-sub">
            {selected
              ? "One row per team. Fill it in while the tutorial is running — it saves as you go."
              : "Pick an activity to mark."}
          </div>
        </div>
        <div style={{ flex: 1 }} />
        {saving > 0 ? (
          <span className="fv-sub" role="status" style={{ fontSize: "var(--fv-2xs)" }}>
            Saving…
          </span>
        ) : null}
      </div>

      {error ? (
        <div
          role="alert"
          style={{
            display: "flex",
            gap: 8,
            padding: "8px 12px",
            marginBottom: 12,
            flex: "none",
            border: "1px solid var(--fv-neutral-200)",
            background: "var(--fv-cream-300)",
            borderRadius: "var(--fv-r-md)",
            fontSize: "var(--fv-xs)",
            color: "var(--fv-amber)",
            lineHeight: 1.5,
          }}
        >
          <FIcon name="assignment" size={15} />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="fv-cksplit">
        <nav className="fv-cknav" aria-label="Activities you can check in">
          {groups.length === 0 ? (
            <p className="fv-sub" style={{ lineHeight: 1.55, padding: "4px 2px" }}>
              No team activities yet. A check-in belongs to work a team does together, so
              team and individual + team activities appear here.
            </p>
          ) : (
            groups.map((g) => (
              <div key={g.label} style={{ marginBottom: 14 }}>
                <div className="fv-eyebrow" style={{ padding: "0 2px 6px" }}>
                  {g.label}
                  {g.dates ? <span style={{ fontWeight: 400 }}> · {g.dates}</span> : null}
                </div>
                {g.activities.map((a) => {
                  const on = a.id === selId;
                  return (
                    <button
                      key={a.id}
                      type="button"
                      className={`fv-ckitem${on ? " on" : ""}`}
                      aria-current={on ? "true" : undefined}
                      onClick={() => setSelId(a.id)}
                    >
                      <span className="fv-ellip" style={{ flex: 1, minWidth: 0 }}>
                        {a.title}
                      </span>
                      <span
                        className="fv-badge outline"
                        style={{ fontSize: "var(--fv-2xs)", flex: "none" }}
                      >
                        {SCOPE_OF[a.type] === "team" ? "Team" : "Ind + team"}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </nav>

        <div className="fv-cksheet">
          {!selected ? null : teams.length === 0 ? (
            <div className="fv-card" style={{ padding: 26, maxWidth: 560 }}>
              <div style={{ fontFamily: "var(--fv-serif)", fontSize: "var(--fv-lg)", fontWeight: 700 }}>
                No teams yet
              </div>
              <p className="fv-sub" style={{ marginTop: 8, lineHeight: 1.6, maxWidth: "56ch" }}>
                This sheet has one row per team. Form them on the Teams tab and they will
                appear here.
              </p>
            </div>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 10 }}>
                <span
                  style={{
                    fontFamily: "var(--fv-serif)",
                    fontSize: "var(--fv-lg)",
                    fontWeight: 700,
                  }}
                >
                  {selected.title}
                </span>
                {loading ? <span className="fv-sub">Loading…</span> : null}
              </div>

              {!canEdit ? (
                <p className="fv-sub" style={{ marginBottom: 10, lineHeight: 1.55 }}>
                  You can see this sheet but not fill it in — running check-ins is a
                  permission the course owner grants on the TFs tab.
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
                        <span className="fv-eyebrow">Absent</span>
                      </th>
                      {SLOTS.map((n) => (
                        <th
                          key={n}
                          colSpan={3}
                          style={{ borderLeft: "1px solid var(--fv-neutral-200)" }}
                        >
                          <span style={{ fontWeight: 600, color: "var(--fv-navy)" }}>
                            Tutorial check-in {n}
                          </span>
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
                            <span className="fv-eyebrow">Accuracy 1–5</span>
                          </th>
                          <th>
                            <span className="fv-eyebrow">Quality of discussion 1–5</span>
                          </th>
                        </Cells>
                      ))}
                    </tr>
                  </thead>

                  <tbody>
                    {teams.map((team) => {
                      const away = absentIn(team.id);
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
                                {team.members.length - away.length}/{team.members.length}
                              </span>
                            </div>
                          </td>

                          <td style={{ padding: 6, minWidth: 150 }}>
                            <AbsentPicker
                              team={team}
                              away={away}
                              disabled={!canEdit}
                              onChange={(ids) => void writeAbsences(team.id, ids)}
                            />
                          </td>

                          {SLOTS.map((n) => {
                            const mark = markFor(marks, team.id, n);
                            // Somebody marked absent did not present. Leaving
                            // them pickable is how a sheet ends up saying a
                            // student who was not in the room spoke to it.
                            const present = team.members.filter((m) => !away.includes(m.id));
                            return (
                              <Cells key={n}>
                                <td
                                  style={{
                                    padding: 6,
                                    borderLeft: "1px solid var(--fv-neutral-200)",
                                  }}
                                >
                                  <PersonPicker
                                    options={present}
                                    value={mark?.presenter_id ?? ""}
                                    placeholder="Pick one"
                                    disabled={!canEdit}
                                    onChange={(id) =>
                                      void writeMark(team.id, n, { presenter_id: id || null })
                                    }
                                  />
                                </td>
                                <td style={{ padding: 6 }}>
                                  <Scale
                                    label={`Accuracy, check-in ${n}, ${team.name}`}
                                    value={mark?.accuracy ?? null}
                                    disabled={!canEdit}
                                    onChange={(v) => void writeMark(team.id, n, { accuracy: v })}
                                  />
                                </td>
                                <td style={{ padding: 6 }}>
                                  <Scale
                                    label={`Quality of discussion, check-in ${n}, ${team.name}`}
                                    value={mark?.discussion ?? null}
                                    disabled={!canEdit}
                                    onChange={(v) => void writeMark(team.id, n, { discussion: v })}
                                  />
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

              <p className="fv-sub" style={{ marginTop: 12, lineHeight: 1.55, maxWidth: "70ch" }}>
                Each team sees its own presenter and scores on this activity. Nobody sees
                another team&rsquo;s row, and absences are not shown to students at all.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Absences as a multi-select: any number, not two fixed slots. */
function AbsentPicker({
  team,
  away,
  disabled,
  onChange,
}: {
  team: TeamWithMembers;
  away: string[];
  disabled: boolean;
  onChange: (studentIds: string[]) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      {team.members.map((m) => {
        const on = away.includes(m.id);
        return (
          <label
            key={m.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: "var(--fv-2xs)",
              color: on ? "var(--fv-amber)" : "var(--fv-muted)",
              cursor: disabled ? "default" : "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={on}
              disabled={disabled}
              onChange={() =>
                onChange(on ? away.filter((id) => id !== m.id) : [...away, m.id])
              }
            />
            <span className="fv-ellip">{m.name}</span>
          </label>
        );
      })}
    </div>
  );
}

/** A member picker, plus an empty choice. */
function PersonPicker({
  options,
  value,
  placeholder,
  disabled,
  onChange,
}: {
  options: Student[];
  value: string;
  placeholder: string;
  disabled: boolean;
  onChange: (studentId: string) => void;
}) {
  const picked = options.find((m) => m.id === value) ?? null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      {picked ? <FAvatar name={picked.name} tint={picked.avatar_tint} size={20} /> : null}
      <select
        className="fv-in"
        style={{ minWidth: 116, height: 28, padding: "0 6px" }}
        value={value}
        disabled={disabled}
        aria-label={placeholder}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{placeholder}</option>
        {/* A presenter marked absent after the fact keeps their name on the list
            so the cell does not silently go blank and lose what was recorded. */}
        {picked && !options.some((m) => m.id === picked.id) ? (
          <option value={picked.id}>{picked.name}</option>
        ) : null}
        {options.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
    </div>
  );
}

/** 1–5 as five buttons — faster to hit during a live session than a dropdown. */
function Scale({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: number | null;
  disabled: boolean;
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
            disabled={disabled}
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
              cursor: disabled ? "default" : "pointer",
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
function Cells({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
