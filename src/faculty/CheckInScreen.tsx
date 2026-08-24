"use client";

// Check-in — the live-session sheet, filled in while a tutorial is running.
//
// Pick an activity on the left, mark the room on the right: who was absent, who
// presented each check-in, and the two 1-5 scores. It saves as you go, and what
// is recorded here is what the students on that team see against that activity —
// so nothing is held in this component that a reload would lose.
//
// The unit of MARKING is the team, because this is filled in standing up while
// walking between them. The unit of SCORING is the student: everyone present
// takes the team's numbers, everyone ticked absent takes 0. That is derived from
// these same two tables by studentMarks — there is no per-student row to write
// here, and adding one would mean a second write on every tick of a checkbox.
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
  absentIds,
  getTutorialSheet,
  markFor,
  setTutorialAbsences,
  setTutorialMark,
  studentMarks,
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

  /**
   * Pick a presenter at random for one slot.
   *
   * Excludes anyone marked absent — they were not in the room — and anyone who
   * has already presented for this team on this activity, so a re-roll spreads
   * the turns rather than landing on the same person twice. When everyone
   * eligible has already gone it falls back to the whole present list, because
   * a die that refuses to roll is worse than one that repeats.
   *
   * One call per press, per cell. A "roll every team" button would fire N
   * writeMark calls that all close over the same `marks` snapshot, and one
   * failure among them would restore that snapshot over every other team's
   * roll — so this stays a single-cell action.
   */
  const roll = (team: TeamWithMembers, slot: number) => {
    if (!canEdit) return;
    const away = absentIn(team.id);
    const present = team.members.filter((m) => !away.includes(m.id));
    if (!present.length) return;

    const spoken = new Set(
      marks
        .filter((m) => m.team_id === team.id && m.slot !== slot && m.presenter_id)
        .map((m) => m.presenter_id as string),
    );
    const current = markFor(marks, team.id, slot)?.presenter_id ?? null;

    let pool = present.filter((m) => !spoken.has(m.id));
    // Re-rolling the same slot should MOVE, so exclude whoever is in it now —
    // unless they are the only one left, in which case the roll is a no-op and
    // pressing again should not clear the cell.
    const moved = pool.filter((m) => m.id !== current);
    if (moved.length) pool = moved;
    if (!pool.length) pool = present.filter((m) => m.id !== current);
    if (!pool.length) pool = present;

    const pick = pool[Math.floor(Math.random() * pool.length)];
    void writeMark(team.id, slot, { presenter_id: pick.id });
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

  const absentIn = (teamId: string): string[] => absentIds(absences, teamId);

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
                        <th key={n} colSpan={3} className="fv-ckslot">
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
                          <th className="fv-ckslot">
                            <span className="fv-eyebrow">Presenter</span>
                          </th>
                          <th>
                            <span className="fv-eyebrow">Accuracy 1–5</span>
                          </th>
                          <th className="fv-ckdisc">
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

                          <td className="fv-ckcell fv-ckabs">
                            <AbsentPicker
                              team={team}
                              away={away}
                              marks={marks}
                              absences={absences}
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
                                <td className="fv-ckcell fv-ckslot">
                                  <div className="fv-ckpres">
                                    <PersonPicker
                                      options={present}
                                      value={mark?.presenter_id ?? ""}
                                      placeholder="Pick one"
                                      disabled={!canEdit}
                                      onChange={(id) =>
                                        void writeMark(team.id, n, { presenter_id: id || null })
                                      }
                                    />
                                    <button
                                      type="button"
                                      className="fv-iconbtn fv-ckdie"
                                      disabled={!canEdit || present.length === 0}
                                      onClick={() => roll(team, n)}
                                      aria-label={`Pick a presenter at random for ${team.name}, check-in ${n}`}
                                      title={
                                        present.length === 0
                                          ? "Everyone on this team is marked absent."
                                          : "Roll a presenter — skips anyone absent or who has already presented. Press again to re-roll."
                                      }
                                    >
                                      <FIcon name="die" size={15} />
                                    </button>
                                  </div>
                                </td>
                                <td className="fv-ckcell">
                                  <Scale
                                    label={`Accuracy, check-in ${n}, ${team.name}`}
                                    value={mark?.accuracy ?? null}
                                    disabled={!canEdit}
                                    onChange={(v) => void writeMark(team.id, n, { accuracy: v })}
                                  />
                                </td>
                                <td className="fv-ckcell fv-ckdisc">
                                  <Scale
                                    tone="disc"
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
                You mark the team; the score is each student&rsquo;s. Everyone who was in the
                room gets the team&rsquo;s two numbers for that check-in, and anyone ticked
                absent gets 0. Each student sees their own numbers and their team&rsquo;s
                presenter — never another team&rsquo;s row, and never who else was away.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Absences as a multi-select: any number, not two fixed slots.
 *
 * The tick is also the score. Everyone in the room gets the team's numbers for a
 * check-in and anyone ticked here gets 0, so an away row carries its 0 next to
 * the name — the consequence of the tick, at the tick, rather than a rule the TF
 * has to have read somewhere. It only appears once the team has actually been
 * given something, because a 0 against a sheet nobody has marked yet says the
 * student failed a check-in that has not happened.
 */
function AbsentPicker({
  team,
  away,
  marks,
  absences,
  disabled,
  onChange,
}: {
  team: TeamWithMembers;
  away: string[];
  marks: TutorialMark[];
  absences: TutorialAbsence[];
  disabled: boolean;
  onChange: (studentIds: string[]) => void;
}) {
  return (
    <div className="fv-absent">
      {team.members.map((m) => {
        const on = away.includes(m.id);
        const zeroed =
          on &&
          studentMarks(marks, absences, team.id, m.id).some(
            (s) => s.accuracy !== null || s.discussion !== null,
          );
        return (
          <label
            key={m.id}
            className={`fv-absentrow${on ? " away" : ""}${disabled ? " ro" : ""}`}
            title={zeroed ? `${m.name} scores 0 on this activity's check-ins.` : undefined}
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
            {zeroed ? (
              <span style={{ marginLeft: "auto", flex: "none", fontWeight: 600 }}>0</span>
            ) : null}
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
    <div className="fv-ckpres">
      {picked ? <FAvatar name={picked.name} tint={picked.avatar_tint} size={20} /> : null}
      <select
        className="fv-in fv-ckpick"
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

/**
 * 1–5 as five buttons — faster to hit during a live session than a dropdown.
 *
 * `tone` is which of the two scales this is. They sit side by side in every
 * slot and used to render identically, so a mis-tap put a wrong score on a
 * named student and said nothing; the discussion column is round and lavender
 * where accuracy is square and navy. Shape as well as colour, because a room
 * lit for a lecture is not where you want to be telling two hues apart.
 */
function Scale({
  label,
  tone,
  value,
  disabled,
  onChange,
}: {
  label: string;
  tone?: "disc";
  value: number | null;
  disabled: boolean;
  onChange: (v: number | null) => void;
}) {
  return (
    <div role="group" aria-label={label} className={`fv-scale${tone ? ` ${tone}` : ""}`}>
      {SCALE.map((n) => {
        const on = value === n;
        return (
          <button
            key={n}
            type="button"
            className={`fv-num fv-scalebtn${on ? " on" : ""}`}
            aria-pressed={on}
            disabled={disabled}
            // Pressing the current value clears it — otherwise a mis-tap is
            // permanent and there is nowhere to put "not marked".
            onClick={() => onChange(on ? null : n)}
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
