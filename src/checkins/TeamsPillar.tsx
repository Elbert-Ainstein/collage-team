"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  autoFormTeams,
  createTeam,
  createTeamSet,
  deleteTeam,
  deleteTeamSet,
  listTeamSets,
  listTeams,
  moveStudents,
  renameTeam,
  setTeamLocked,
  setTeamSetLocked,
  setTeamSetSize,
} from "./data";
import {
  MIX_BY_NONE,
  TEAM_SIZE_DEFAULT,
  TEAM_SIZE_MAX,
  TEAM_SIZE_MIN,
  teamName,
  type MixBy,
} from "./constants";
import { attrTint, mixableAttrs } from "./attrs";
import type { Student, TeamCadence, TeamSet, TeamWithMembers } from "./types";
import { Avatar, EmptyState, ErrorBanner, weekLabel, type PillarProps } from "./ui";
import { Icon } from "./icons";

/** The unassigned tray, as a drop target id. */
const TRAY = "tray";
type DropTarget = string | typeof TRAY | null;

function msg(e: unknown): string {
  return String((e as Error)?.message ?? e);
}

function clampSize(n: number): number {
  if (!Number.isFinite(n)) return TEAM_SIZE_DEFAULT;
  return Math.max(TEAM_SIZE_MIN, Math.min(TEAM_SIZE_MAX, Math.round(n)));
}

interface TeamsPillarProps extends PillarProps {
  cadence: TeamCadence;
}

export function TeamsPillar({ courseId, roster, activities, refresh, cadence }: TeamsPillarProps) {
  const [sets, setSets] = useState<TeamSet[]>([]);
  const [activeSetId, setActiveSetId] = useState<string | null>(null);
  const [teams, setTeams] = useState<TeamWithMembers[]>([]);
  const [sel, setSel] = useState<Set<string>>(() => new Set<string>());
  const [dragging, setDragging] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState<DropTarget>(null);
  const [query, setQuery] = useState("");
  const [mixBy, setMixBy] = useState<MixBy>(MIX_BY_NONE);
  const [loadingSets, setLoadingSets] = useState(true);
  const [loadingTeams, setLoadingTeams] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Last name we know the DB holds for each team, so blur only writes real edits. */
  const savedNames = useRef<Record<string, string>>({});

  const applyTeams = useCallback((ts: TeamWithMembers[]) => {
    const names: Record<string, string> = {};
    ts.forEach((t) => {
      names[t.id] = t.name;
    });
    savedNames.current = names;
    setTeams(ts);
  }, []);

  // ---- load the sets for this course ----
  useEffect(() => {
    let alive = true;
    setLoadingSets(true);
    listTeamSets(courseId)
      .then((ss) => {
        if (!alive) return;
        setSets(ss);
        setActiveSetId((prev) =>
          prev && ss.some((s) => s.id === prev) ? prev : (ss[0]?.id ?? null),
        );
      })
      .catch((e: unknown) => {
        if (alive) setError(msg(e));
      })
      .finally(() => {
        if (alive) setLoadingSets(false);
      });
    return () => {
      alive = false;
    };
  }, [courseId]);

  // ---- load the teams of the working set ----
  useEffect(() => {
    if (!activeSetId) {
      applyTeams([]);
      return;
    }
    let alive = true;
    setLoadingTeams(true);
    listTeams(activeSetId, roster)
      .then((ts) => {
        if (alive) applyTeams(ts);
      })
      .catch((e: unknown) => {
        if (alive) setError(msg(e));
      })
      .finally(() => {
        if (alive) setLoadingTeams(false);
      });
    return () => {
      alive = false;
    };
  }, [activeSetId, roster, applyTeams]);

  const activeSet = useMemo(
    () => sets.find((s) => s.id === activeSetId) ?? null,
    [sets, activeSetId],
  );
  const size = activeSet?.team_size ?? TEAM_SIZE_DEFAULT;

  /** Mix-by options come from the roster's own extra columns. */
  const attrs = useMemo(() => mixableAttrs(roster), [roster]);
  useEffect(() => {
    // A roster without the current attribute (re-import, section switch) falls
    // back to a plain shuffle rather than silently mixing by nothing.
    if (mixBy !== MIX_BY_NONE && !attrs.includes(mixBy)) setMixBy(MIX_BY_NONE);
  }, [attrs, mixBy]);

  const reload = useCallback(
    async (id: string) => {
      applyTeams(await listTeams(id, roster));
    },
    [roster, applyTeams],
  );

  /** Run a mutation: surface failures, then re-read to reconcile. */
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e: unknown) {
      setError(msg(e));
      // The usual cause of a write failing here is this page being out of date
      // with the database, so re-read both the teams and the roster.
      try {
        if (activeSetId) await reload(activeSetId);
        await refresh();
      } catch {
        // keep the original failure on screen
      }
    } finally {
      setBusy(false);
    }
  };

  const teamIds = useMemo(() => teams.map((t) => t.id), [teams]);
  const assigned = useMemo(() => {
    const ids = new Set<string>();
    teams.forEach((t) => t.members.forEach((m) => ids.add(m.id)));
    return ids;
  }, [teams]);
  const unassigned = useMemo(() => roster.filter((s) => !assigned.has(s.id)), [roster, assigned]);

  // ---------- selection ----------
  const toggleSel = (studentId: string) => {
    setSel((prev) => {
      const next = new Set(prev);
      if (next.has(studentId)) next.delete(studentId);
      else next.add(studentId);
      return next;
    });
  };

  /** Optimistic membership move; the DB write follows. */
  const applyMoveLocal = (ids: string[], destTeamId: string | null) => {
    setTeams((prev) => {
      const moving: Student[] = [];
      const stripped = prev.map((t) => {
        const keep: Student[] = [];
        t.members.forEach((m) => {
          if (ids.includes(m.id)) moving.push(m);
          else keep.push(m);
        });
        return { ...t, members: keep };
      });
      if (!destTeamId) return stripped;
      const found = new Set(moving.map((m) => m.id));
      roster.forEach((s) => {
        if (ids.includes(s.id) && !found.has(s.id)) moving.push(s);
      });
      return stripped.map((t) =>
        t.id === destTeamId
          ? { ...t, members: [...t.members, ...moving].sort((a, b) => a.position - b.position) }
          : t,
      );
    });
  };

  const move = async (ids: string[], destTeamId: string | null) => {
    if (!ids.length || !activeSetId) return;
    const setIdNow = activeSetId;
    const idsNow = [...ids];
    applyMoveLocal(idsNow, destTeamId);
    setSel(new Set());
    await run(async () => {
      await moveStudents(idsNow, destTeamId, teamIds);
      await reload(setIdNow);
    });
  };

  // ---------- drag and drop ----------
  /** A drag carries the whole selection when the grabbed student is part of it. */
  const dragPayload = (studentId: string): string[] =>
    sel.has(studentId) ? Array.from(sel) : [studentId];

  const onDragStart = (e: React.DragEvent, studentId: string) => {
    const ids = dragPayload(studentId);
    setDragging(ids);
    e.dataTransfer.effectAllowed = "move";
    // A payload is required for Firefox to start the drag at all.
    e.dataTransfer.setData("text/plain", ids.join(","));
  };

  const onDragEnd = () => {
    setDragging([]);
    setDragOver(null);
  };

  const onDropOn = (target: DropTarget) => {
    if (!dragging.length) return;
    const ids = dragging;
    setDragging([]);
    setDragOver(null);
    void move(ids, target === TRAY ? null : target);
  };

  /** Drop-target handlers, shared by the team cards and the tray. */
  const dropProps = (target: DropTarget) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!dragging.length) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setDragOver(target);
    },
    onDragLeave: (e: React.DragEvent) => {
      // Ignore leaves fired while crossing a child element.
      if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
      setDragOver((prev) => (prev === target ? null : prev));
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      onDropOn(target);
    },
  });

  // ---------- mutations ----------
  /**
   * Create the set this board edits. Under the semester cadence there is one for
   * the whole course; per activity, one seeded from the roster for each.
   */
  const onCreateSet = async (activityId: string | null) => {
    await run(async () => {
      const created = await createTeamSet({ courseId, activityId, teamSize: TEAM_SIZE_DEFAULT });
      if (roster.length) await autoFormTeams(created.id, roster, TEAM_SIZE_DEFAULT, mixBy);
      setSets(await listTeamSets(courseId));
      setSel(new Set());
      setActiveSetId(created.id);
      await reload(created.id);
      // The parent tracks whether any set exists (the setup stepper).
      await refresh();
    });
  };

  const onSize = async (next: number) => {
    if (!activeSet) return;
    const n = clampSize(next);
    if (n === size) return;
    const setIdNow = activeSet.id;
    setSets((prev) => prev.map((s) => (s.id === setIdNow ? { ...s, team_size: n } : s)));
    setSel(new Set());
    await run(async () => {
      await setTeamSetSize(setIdNow, n);
      await autoFormTeams(setIdNow, roster, n, mixBy);
      await reload(setIdNow);
      setSets(await listTeamSets(courseId));
    });
  };

  const onReroll = async () => {
    if (!activeSet) return;
    const setIdNow = activeSet.id;
    setSel(new Set());
    await run(async () => {
      await autoFormTeams(setIdNow, roster, size, mixBy);
      await reload(setIdNow);
    });
  };

  const onAddTeam = async () => {
    if (!activeSet) return;
    const setIdNow = activeSet.id;
    await run(async () => {
      await createTeam(setIdNow, teamName(teams.length), teams.length);
      await reload(setIdNow);
    });
  };

  const onToggleLock = async (teamId: string) => {
    const t = teams.find((x) => x.id === teamId);
    if (!t || !activeSetId) return;
    const setIdNow = activeSetId;
    const next = !t.locked;
    setTeams((prev) => prev.map((x) => (x.id === teamId ? { ...x, locked: next } : x)));
    await run(async () => {
      await setTeamLocked(teamId, next);
      await reload(setIdNow);
    });
  };

  const onPublish = async () => {
    if (!activeSet) return;
    const setIdNow = activeSet.id;
    const next = !activeSet.locked;
    setSets((prev) => prev.map((s) => (s.id === setIdNow ? { ...s, locked: next } : s)));
    await run(async () => {
      await setTeamSetLocked(setIdNow, next);
      setSets(await listTeamSets(courseId));
    });
  };

  const onDeleteTeam = async (teamId: string) => {
    if (!activeSetId) return;
    const setIdNow = activeSetId;
    setTeams((prev) => prev.filter((t) => t.id !== teamId));
    await run(async () => {
      await deleteTeam(teamId);
      await reload(setIdNow);
    });
  };

  const onTeamNameChange = (teamId: string, value: string) => {
    setTeams((prev) => prev.map((t) => (t.id === teamId ? { ...t, name: value } : t)));
  };

  const commitTeamName = async (teamId: string) => {
    const t = teams.find((x) => x.id === teamId);
    if (!t) return;
    const name = t.name.trim() || "Untitled team";
    if (name !== t.name) onTeamNameChange(teamId, name);
    if (name === savedNames.current[teamId]) return;
    savedNames.current[teamId] = name;
    await run(async () => {
      await renameTeam(teamId, name);
    });
  };

  /** Removing a set takes its teams — and any scores recorded against them. */
  const onRemoveSet = async (setId: string) => {
    await run(async () => {
      await deleteTeamSet(setId);
      const remaining = sets.filter((s) => s.id !== setId);
      setSets(remaining);
      setSel(new Set());
      const next = remaining[0]?.id ?? null;
      setActiveSetId(next);
      if (next) await reload(next);
      else applyTeams([]);
      await refresh();
    });
  };

  // ---------- render ----------
  const header = (title: string, sub: string) => (
    <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
      <h1 className="t-h1">{title}</h1>
      <span className="t-sub">{sub}</span>
    </div>
  );

  if (roster.length === 0) {
    return (
      <section>
        {header("Teams", "Teams are built from the class roster.")}
        <ErrorBanner error={error} />
        <div style={{ marginTop: 14 }}>
          <EmptyState
            title="No students to form teams from"
            body="Add your students on the roster step first, then come back here to form and publish teams."
          />
        </div>
      </section>
    );
  }

  if (loadingSets) {
    return (
      <section>
        {header("Teams", "Loading…")}
        <ErrorBanner error={error} />
        <div style={{ color: "var(--ink2)", padding: 20 }}>Loading teams…</div>
      </section>
    );
  }

  // Activities that have no teams yet — the per-activity cadence needs one each.
  const activitiesWithoutSet = activities.filter(
    (a) => !sets.some((s) => s.activity_id === a.id),
  );

  if (sets.length === 0) {
    const semester = cadence === "semester";
    return (
      <section>
        {header(
          "Teams",
          semester
            ? "One set of teams for the semester — every activity uses it."
            : "Each activity gets its own teams.",
        )}
        <div style={{ marginTop: 14 }}>
          <ErrorBanner error={error} />
        </div>
        <EmptyState
          title={semester ? "Form the semester teams" : "Form the teams for an activity"}
          body={
            `We'll build teams of ${TEAM_SIZE_DEFAULT} from your ${roster.length} students, ` +
            `mixed as evenly as the class allows. Drag anyone between teams afterwards.`
          }
          action={
            semester ? (
              <button
                className="t-btn primary"
                onClick={() => void onCreateSet(null)}
                disabled={busy}
              >
                {busy ? "Forming…" : "Form teams"}
              </button>
            ) : activities.length ? (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {activities.map((a) => (
                  <button
                    key={a.id}
                    className="t-btn line"
                    onClick={() => void onCreateSet(a.id)}
                    disabled={busy}
                  >
                    Form teams for {weekLabel(a)}
                  </button>
                ))}
              </div>
            ) : (
              <span style={{ fontSize: 12.5, color: "var(--ink2)", maxWidth: "34ch" }}>
                Create an activity first — with this cadence, teams belong to one.
              </span>
            )
          }
        />
      </section>
    );
  }

  const selIds = Array.from(sel);
  const placed = roster.length - unassigned.length;
  const trayMatches = query.trim()
    ? unassigned.filter((s) => s.name.toLowerCase().includes(query.trim().toLowerCase()))
    : unassigned;

  /** Tab label: real names only — "team set" never appears in the UI. */
  const tabLabel = (s: TeamSet): { label: string; note: string } => {
    const a = activities.find((x) => x.id === s.activity_id);
    if (a) return { label: weekLabel(a), note: "own teams" };
    return { label: "Semester teams", note: "every activity" };
  };

  return (
    <section>
      {header(
        "Teams",
        `${roster.length} students · ` +
          (cadence === "semester"
            ? "one set of teams for the semester"
            : "teams change with each activity"),
      )}

      <div style={{ marginTop: 12 }}>
        <ErrorBanner error={error} />
      </div>

      {/* File-folder tabs: one per set, labelled with the thing it belongs to. */}
      <div className="t-foldertabs">
        {sets.map((s) => {
          const { label, note } = tabLabel(s);
          const on = s.id === activeSetId;
          return (
            <button
              key={s.id}
              className={"t-foldertab" + (on ? " on" : "")}
              onClick={() => {
                setSel(new Set());
                setActiveSetId(s.id);
              }}
            >
              <span>{label}</span>
              <span className="note">{note}</span>
            </button>
          );
        })}
        {cadence === "activity" &&
          activitiesWithoutSet.map((a) => (
            <button
              key={a.id}
              className="t-foldertab add"
              title={`Form teams for ${weekLabel(a)}`}
              onClick={() => void onCreateSet(a.id)}
              disabled={busy}
            >
              + {weekLabel(a)}
            </button>
          ))}
      </div>

      {/* Toolbar: exactly four forming controls, then status. Per-team actions
          live on the team card; per-student actions live on the student. */}
      <div className="t-boardbar">
        <div className="t-stepper" title="Team size — changing it re-forms the unlocked teams">
          <span className="lbl">Teams of</span>
          <button
            className="t-sq"
            onClick={() => void onSize(size - 1)}
            disabled={busy || size <= TEAM_SIZE_MIN}
            aria-label="Smaller teams"
          >
            −
          </button>
          <span className="t-num n">{size}</span>
          <button
            className="t-sq"
            onClick={() => void onSize(size + 1)}
            disabled={busy || size >= TEAM_SIZE_MAX}
            aria-label="Bigger teams"
          >
            +
          </button>
        </div>

        <label className="t-mixby">
          Mix by
          <select
            className="t-in"
            value={mixBy}
            onChange={(e) => setMixBy(e.target.value)}
            disabled={busy}
          >
            {attrs.map((a) => (
              <option key={a} value={a}>
                {a.replace(/\b\w/g, (c) => c.toUpperCase())}
              </option>
            ))}
            <option value={MIX_BY_NONE}>Nothing — random</option>
          </select>
        </label>

        <button className="t-btn line" onClick={() => void onReroll()} disabled={busy}>
          <Icon name="shuffle" size={15} /> Re-roll unlocked
        </button>
        <button className="t-btn line" onClick={() => void onAddTeam()} disabled={busy}>
          <Icon name="plus" size={15} /> Add team
        </button>

        <span className="t-spacer" />
        <span
          className="t-num"
          style={{
            fontSize: 11.5,
            color: unassigned.length ? "var(--amber)" : "var(--ink2)",
          }}
        >
          {unassigned.length
            ? `${unassigned.length} still unassigned`
            : `All ${roster.length} students placed`}
        </span>
        <button
          className={activeSet?.locked ? "t-btn green" : "t-btn primary"}
          onClick={() => void onPublish()}
          disabled={busy}
        >
          {activeSet?.locked ? "✓ Published" : "Publish teams"}
        </button>
      </div>

      {/* Board: unassigned tray + team cards. */}
      <div className="t-board">
        <div
          className={"t-tray" + (dragOver === TRAY ? " over" : "")}
          {...dropProps(TRAY)}
        >
          <div className="t-trayhead">
            <span className="t-kicker">Unassigned</span>
            <span className="t-num" style={{ fontSize: 11, color: "var(--ink3)" }}>
              {unassigned.length}
            </span>
          </div>
          <input
            className="t-in"
            style={{ width: "100%", fontSize: 12, padding: "5px 8px" }}
            value={query}
            placeholder="Search…"
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="t-traydrop">
            {trayMatches.length ? (
              trayMatches.map((s) => (
                <StudentRow
                  key={s.id}
                  student={s}
                  mixBy={mixBy}
                  selected={sel.has(s.id)}
                  dragging={dragging.includes(s.id)}
                  onToggle={() => toggleSel(s.id)}
                  onDragStart={(e) => onDragStart(e, s.id)}
                  onDragEnd={onDragEnd}
                />
              ))
            ) : (
              <div className="t-trayempty">
                {unassigned.length
                  ? "No match."
                  : "Everyone is placed. Drag a student here to pull them out of a team."}
              </div>
            )}
          </div>
        </div>

        <div className="t-teamgrid">
          {loadingTeams && teams.length === 0 ? (
            <div style={{ color: "var(--ink2)", padding: "10px 2px" }}>Loading teams…</div>
          ) : teams.length === 0 ? (
            <div className="t-teamsempty">
              <div style={{ fontFamily: "var(--serif)", fontSize: 16, fontWeight: 700 }}>
                No teams here yet
              </div>
              <div style={{ fontSize: 12.5, color: "var(--ink2)", marginTop: 4 }}>
                Re-roll to build teams of {size} from the roster, or add an empty team and place
                students yourself.
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 11, flexWrap: "wrap" }}>
                <button className="t-btn primary" onClick={() => void onReroll()} disabled={busy}>
                  Form teams of {size}
                </button>
                <button className="t-btn line" onClick={() => void onAddTeam()} disabled={busy}>
                  Add team
                </button>
              </div>
            </div>
          ) : (
            teams.map((t) => (
              <TeamCard
                key={t.id}
                team={t}
                size={size}
                mixBy={mixBy}
                sel={sel}
                dragging={dragging}
                over={dragOver === t.id}
                busy={busy}
                dropProps={dropProps(t.id)}
                onToggleSel={toggleSel}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
                onNameChange={onTeamNameChange}
                onNameCommit={commitTeamName}
                onToggleLock={onToggleLock}
                onDelete={onDeleteTeam}
              />
            ))
          )}
        </div>
      </div>

      {/* Selection bar: idle hint, or navy with a bulk move. */}
      <div className={"t-selbar" + (selIds.length ? " on" : "")}>
        {selIds.length ? (
          <>
            <span className="t-num" style={{ fontWeight: 600 }}>
              {selIds.length} selected
            </span>
            <span>· drag them together, or</span>
            <select
              className="t-in"
              style={{ padding: "4px 8px", fontSize: 12 }}
              value=""
              disabled={busy}
              onChange={(e) => {
                const v = e.target.value;
                if (!v) return;
                void move(selIds, v === TRAY ? null : v);
              }}
            >
              <option value="">Move to…</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
              <option value={TRAY}>Unassigned</option>
            </select>
            <button className="t-btn ghost sm" onClick={() => setSel(new Set())}>
              Clear
            </button>
          </>
        ) : (
          <span>
            Drag a student between teams — or click several and move them together.
            {placed < roster.length ? ` ${placed} of ${roster.length} placed.` : ""}
          </span>
        )}
      </div>

      {/* Removing a set is rare and destructive, so it sits below the board. */}
      {activeSet && (
        <RemoveSetRow
          label={tabLabel(activeSet).label}
          teamCount={teams.length}
          busy={busy}
          onRemove={() => void onRemoveSet(activeSet.id)}
        />
      )}
    </section>
  );
}

/** One draggable student, in a team card or the tray. */
function StudentRow({
  student,
  mixBy,
  selected,
  dragging,
  onToggle,
  onDragStart,
  onDragEnd,
}: {
  student: Student;
  mixBy: MixBy;
  selected: boolean;
  dragging: boolean;
  onToggle: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
}) {
  const tint = attrTint(student, mixBy);
  return (
    <div
      className={"t-srow" + (selected ? " sel" : "") + (dragging ? " drag" : "")}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onToggle}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      title={student.attrs?.[mixBy] ? `${student.name} · ${student.attrs[mixBy]}` : student.name}
      onKeyDown={(e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          onToggle();
        }
      }}
    >
      <Avatar name={student.name} tint={student.avatar_tint} size={20} />
      <span className="nm">{student.name}</span>
      {tint && <span className="dot" style={{ background: tint }} />}
    </div>
  );
}

/** One team card: header, mix bar, members, drop target. */
function TeamCard({
  team,
  size,
  mixBy,
  sel,
  dragging,
  over,
  busy,
  dropProps,
  onToggleSel,
  onDragStart,
  onDragEnd,
  onNameChange,
  onNameCommit,
  onToggleLock,
  onDelete,
}: {
  team: TeamWithMembers;
  size: number;
  mixBy: MixBy;
  sel: Set<string>;
  dragging: string[];
  over: boolean;
  busy: boolean;
  dropProps: {
    onDragOver: (e: React.DragEvent) => void;
    onDragLeave: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
  };
  onToggleSel: (id: string) => void;
  onDragStart: (e: React.DragEvent, id: string) => void;
  onDragEnd: () => void;
  onNameChange: (id: string, v: string) => void;
  onNameCommit: (id: string) => Promise<void>;
  onToggleLock: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const overCapacity = team.members.length > size;

  /** Mix bar: one segment per attribute value present in the team. */
  const buckets = useMemo(() => {
    if (mixBy === MIX_BY_NONE) return [];
    const counts = new Map<string, number>();
    team.members.forEach((m) => {
      const v = (m.attrs?.[mixBy] ?? "").trim();
      if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
    });
    return [...counts.entries()].map(([value, n]) => ({ value, n }));
  }, [team.members, mixBy]);

  return (
    <div
      className={
        "t-tcard" + (team.locked ? " locked" : "") + (over ? " over" : "")
      }
      {...dropProps}
    >
      <div className="t-tchead">
        <input
          className="t-tcname"
          value={team.name}
          aria-label="Team name"
          onChange={(e) => onNameChange(team.id, e.target.value)}
          onBlur={() => void onNameCommit(team.id)}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
        />
        <span className={"t-count" + (overCapacity ? " over" : "")}>
          {team.members.length}/{size}
        </span>
        <button
          className={"t-lock" + (team.locked ? " on" : "")}
          title={team.locked ? "Locked — a re-roll leaves this team alone" : "Lock this team"}
          aria-pressed={team.locked}
          onClick={() => void onToggleLock(team.id)}
          disabled={busy}
        >
          <Icon name={team.locked ? "lock" : "lockopen"} size={14} />
        </button>
        <button
          className="t-x"
          title="Delete team — its members go back to unassigned"
          onClick={() => void onDelete(team.id)}
          disabled={busy}
        >
          ✕
        </button>
      </div>

      {buckets.length > 1 && (
        <div className="t-mixbar" title={buckets.map((b) => `${b.value} ${b.n}`).join(" · ")}>
          {buckets.map((b) => (
            <span
              key={b.value}
              style={{
                flex: b.n,
                background: attrTint({ attrs: { [mixBy]: b.value } }, mixBy) ?? undefined,
              }}
            />
          ))}
        </div>
      )}

      <div className="t-tcmembers">
        {team.members.length ? (
          team.members.map((m) => (
            <StudentRow
              key={m.id}
              student={m}
              mixBy={mixBy}
              selected={sel.has(m.id)}
              dragging={dragging.includes(m.id)}
              onToggle={() => onToggleSel(m.id)}
              onDragStart={(e) => onDragStart(e, m.id)}
              onDragEnd={onDragEnd}
            />
          ))
        ) : (
          <div className="t-tcempty">Drop students here</div>
        )}
      </div>
    </div>
  );
}

/** Two-step remove, because a set takes its teams and their scores with it. */
function RemoveSetRow({
  label,
  teamCount,
  busy,
  onRemove,
}: {
  label: string;
  teamCount: number;
  busy: boolean;
  onRemove: () => void;
}) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <div style={{ marginTop: 14, display: "flex", justifyContent: "flex-end" }}>
        <button
          className="t-btn ghost sm"
          style={{ color: "var(--ink3)" }}
          onClick={() => setConfirming(true)}
        >
          Remove “{label}”
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        marginTop: 14,
        display: "flex",
        gap: 10,
        alignItems: "center",
        flexWrap: "wrap",
        justifyContent: "flex-end",
        border: "1px solid var(--amber)",
        background: "var(--amberBg)",
        borderRadius: 10,
        padding: "8px 11px",
      }}
    >
      <span style={{ fontSize: 11.5, color: "var(--amber)", flex: 1, minWidth: 240 }}>
        Remove “{label}” — its {teamCount} team{teamCount === 1 ? "" : "s"} and any scores recorded
        against them go too. Students stay on the roster.
      </span>
      <button className="t-btn amber" onClick={onRemove} disabled={busy}>
        {busy ? "Removing…" : "Remove"}
      </button>
      <button
        className="t-btn ghost"
        style={{ border: "1px solid var(--line)" }}
        onClick={() => setConfirming(false)}
        disabled={busy}
      >
        Cancel
      </button>
    </div>
  );
}
