"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  autoFormTeams,
  countOneTeamResults,
  countTeamResults,
  createTeam,
  createTeamSet,
  deleteTeam,
  deleteTeamSet,
  listTeamSets,
  listTeams,
  moveStudents,
  renameTeam,
  setTeamSetLocked,
  setTeamSetSize,
} from "./data";
import { deleteTeamResourceObjects } from "./purge";
import type { Activity, Student, TeamSet, TeamWithMembers } from "./types";
import { Avatar, EmptyState, ErrorBanner, weekLabel, type PillarProps } from "./ui";

const DEFAULT_SIZE = 4;
const UNASSIGNED = "__un__";

function msg(e: unknown): string {
  return String((e as Error)?.message ?? e);
}

function clampSize(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_SIZE;
  return Math.max(2, Math.min(8, Math.round(n)));
}

/** Label for a team set: its own name, else the activity it belongs to. */
function labelForSet(s: TeamSet, activities: Activity[]): string {
  if (s.name) return s.name;
  const a = activities.find((x) => x.id === s.activity_id);
  return a ? `${weekLabel(a)} · teams` : "All-class teams";
}

export function TeamsPillar(props: PillarProps) {
  const { courseId, roster, activities, refresh } = props;

  const [sets, setSets] = useState<TeamSet[]>([]);
  const [activeSetId, setActiveSetId] = useState<string | null>(null);
  const [teams, setTeams] = useState<TeamWithMembers[]>([]);
  const [sel, setSel] = useState<Set<string>>(() => new Set<string>());
  const [queries, setQueries] = useState<Record<string, string>>({});
  const [sizeInput, setSizeInput] = useState(String(DEFAULT_SIZE));
  const [creatingSet, setCreatingSet] = useState(false);
  const [newSetActivity, setNewSetActivity] = useState("");
  const [loadingSets, setLoadingSets] = useState(true);
  const [loadingTeams, setLoadingTeams] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDeleteSet, setConfirmDeleteSet] = useState(false);
  const [armedTeam, setArmedTeam] = useState<string | null>(null);
  const [teamCost, setTeamCost] = useState<string | null>(null);
  /** A pending re-form that would destroy recorded team scores. */
  const [confirmReform, setConfirmReform] = useState<{ n: number; scores: number } | null>(null);

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

  // ---- load team sets for this course ----
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
  const activeSetKey = activeSet?.id;
  const activeSetSize = activeSet?.team_size ?? DEFAULT_SIZE;

  // keep the size box in step with the working set
  useEffect(() => {
    setSizeInput(String(activeSetSize));
  }, [activeSetKey, activeSetSize]);

  const reload = useCallback(
    async (id: string) => {
      applyTeams(await listTeams(id, roster));
    },
    [roster, applyTeams],
  );

  /** Run a mutation: surface failures, then re-read the teams to reconcile. */
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e: unknown) {
      setError(msg(e));
      // Re-read both the teams and the roster: the usual cause of a write
      // failing here is that this page is out of date with the database.
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
  const unassigned = useMemo(
    () => roster.filter((s) => !assigned.has(s.id)),
    [roster, assigned],
  );
  const underN = teams.filter((t) => t.members.length < activeSetSize).length;
  const status =
    unassigned.length === 0
      ? underN === 0
        ? `All ${roster.length} students placed`
        : `All placed · ${underN} under target`
      : `${unassigned.length} unassigned · ${underN} under target`;

  // ---------- selection ----------
  const toggleSel = (studentId: string, on: boolean) => {
    setSel((prev) => {
      const next = new Set(prev);
      if (on) next.add(studentId);
      else next.delete(studentId);
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

  // ---------- mutations ----------
  const onCreateSet = async () => {
    const activityId = newSetActivity || null;
    const act = activities.find((a) => a.id === activityId) ?? null;
    const name = act
      ? `${act.title} · teams of ${DEFAULT_SIZE}`
      : `Whole session · teams of ${DEFAULT_SIZE}`;
    await run(async () => {
      const created = await createTeamSet({
        courseId,
        activityId,
        name,
        teamSize: DEFAULT_SIZE,
      });
      if (roster.length) await autoFormTeams(created.id, roster, DEFAULT_SIZE);
      setSets(await listTeamSets(courseId));
      setCreatingSet(false);
      setNewSetActivity("");
      setSel(new Set());
      setActiveSetId(created.id);
      await reload(created.id);
      // The parent tracks whether any team set exists (setup guide), so a
      // created/deleted set has to be reported upward.
      await refresh();
    });
  };

  /** Re-forming deletes the teams, cascading away any scores recorded against
   *  them — so ask first when there is something to lose. */
  const reformOrConfirm = async (n: number) => {
    if (!activeSet) return;
    const scores = await countTeamResults(activeSet.id).catch(() => 0);
    if (scores > 0) {
      setConfirmReform({ n, scores });
      return;
    }
    await doReform(n);
  };

  const doReform = async (n: number) => {
    if (!activeSet) return;
    const setIdNow = activeSet.id;
    // Re-forming DROPS every team in the set and builds new ones, so it is a
    // delete like the other two — and the least obviously so, because it reads
    // as nudging a number. Without this, changing the team size from 4 to 5
    // destroyed the whole set's whiteboard photos: the rows cascade, the
    // objects do not, and 0018 authorises removal by joining back through the
    // team that no longer exists.
    const doomedTeams = teams.map((t) => t.id);
    setConfirmReform(null);
    setSel(new Set());
    await run(async () => {
      await deleteTeamResourceObjects(doomedTeams);
      if (n !== activeSetSize) {
        setSets((prev) => prev.map((s) => (s.id === setIdNow ? { ...s, team_size: n } : s)));
        await setTeamSetSize(setIdNow, n);
      }
      await autoFormTeams(setIdNow, roster, n);
      await reload(setIdNow);
      setSets(await listTeamSets(courseId));
    });
  };

  const commitSize = async () => {
    if (!activeSet) return;
    const n = clampSize(Number(sizeInput));
    setSizeInput(String(n));
    if (n === activeSetSize) return;
    await reformOrConfirm(n);
  };


  const onAutoForm = async () => {
    if (!activeSet) return;
    await reformOrConfirm(activeSetSize);
  };

  const onAddTeam = async () => {
    if (!activeSet) return;
    const setIdNow = activeSet.id;
    await run(async () => {
      await createTeam(setIdNow, "New team", teams.length);
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
      // The team's photos first. team_resources cascades from teams, and the
      // cascade does not reach storage — so the objects would be left behind,
      // and 0018 only lets the course owner remove them WHILE the team row is
      // still there to authorise against.
      await deleteTeamResourceObjects([teamId]);
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

  /** Deleting a set takes its teams — and any team scores recorded against them. */
  const onDeleteSet = async () => {
    if (!activeSetId) return;
    const doomed = activeSetId;
    const doomedTeams = teams.map((t) => t.id);
    await run(async () => {
      // Same reason as onDeleteTeam, for every team in the set.
      await deleteTeamResourceObjects(doomedTeams);
      await deleteTeamSet(doomed);
      const remaining = sets.filter((s) => s.id !== doomed);
      setSets(remaining);
      setConfirmDeleteSet(false);
      setSel(new Set());
      const next = remaining[0]?.id ?? null;
      setActiveSetId(next);
      if (next) await reload(next);
      else applyTeams([]);
      await refresh();
    });
  };

  // ---------- render ----------
  const header = (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: 12,
        flexWrap: "wrap",
        marginBottom: 4,
      }}
    >
      <h1 className="t-h1">Teams</h1>
    </div>
  );

  if (roster.length === 0) {
    return (
      <section>
        {header}
        <ErrorBanner error={error} />
        <div style={{ marginTop: 14 }}>
          <EmptyState
            title="No students to form teams from"
            body="Teams are built from the class roster. Add your students on the Roster screen above, then come back here to form and publish teams."
          />
        </div>
      </section>
    );
  }

  if (loadingSets) {
    return (
      <section>
        {header}
        <ErrorBanner error={error} />
        <div style={{ color: "var(--ink2)", padding: 20 }}>Loading teams…</div>
      </section>
    );
  }

  const setPicker = (
    <label
      className="t-fld"
      style={{ minWidth: 240, textAlign: "left", display: "grid", gap: 4 }}
    >
      Team set for
      <select
        className="t-in"
        value={newSetActivity}
        onChange={(e) => setNewSetActivity(e.target.value)}
      >
        <option value="">Whole session (not tied to an activity)</option>
        {activities.map((a) => (
          <option key={a.id} value={a.id}>
            {weekLabel(a)} · {a.title}
          </option>
        ))}
      </select>
    </label>
  );

  if (sets.length === 0) {
    return (
      <section>
        {header}
        <div style={{ marginTop: 14 }}>
          <ErrorBanner error={error} />
        </div>
        <EmptyState
          title="No team set yet"
          body={`Create the first set and we'll form teams of ${DEFAULT_SIZE} from your ${roster.length} students. Pick the activity it belongs to, or keep it all-class. Teams are assigned by faculty — self-selection is not offered.`}
          action={
            <div style={{ display: "flex", gap: 9, alignItems: "flex-end", flexWrap: "wrap" }}>
              {setPicker}
              <button className="t-btn primary" onClick={onCreateSet} disabled={busy}>
                {busy ? "Creating…" : "Create team set"}
              </button>
            </div>
          }
        />
      </section>
    );
  }

  const activeActivity = activeSet
    ? (activities.find((a) => a.id === activeSet.activity_id) ?? null)
    : null;
  const selIds = Array.from(sel);

  return (
    <section>
      {header}

      <ErrorBanner error={error} />

      {/* team set selector — sets are per activity */}
      <div
        style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          alignItems: "center",
          margin: "12px 0",
        }}
      >
        <span className="t-kicker">Team set</span>
        {sets.map((s) => (
          <button
            key={s.id}
            className={"t-pill" + (s.id === activeSetId ? " on" : "")}
            onClick={() => {
              setSel(new Set());
              setActiveSetId(s.id);
            }}
          >
            {labelForSet(s, activities)}
          </button>
        ))}
        <button
          className="t-pill"
          onClick={() => setCreatingSet((v) => !v)}
          title="Create another team set"
        >
          {creatingSet ? "Cancel" : "+ New set"}
        </button>
        <span className="t-spacer" />
        <span style={{ fontSize: 11.5, color: "var(--ink2)" }}>
          {activeActivity
            ? `Used by ${weekLabel(activeActivity)} · ${activeActivity.title}`
            : "Whole-session set — not tied to an activity"}
        </span>
      </div>

      {creatingSet && (
        <div
          className="t-card"
          style={{
            display: "flex",
            gap: 9,
            alignItems: "flex-end",
            flexWrap: "wrap",
            marginBottom: 14,
          }}
        >
          {setPicker}
          <button className="t-btn primary" onClick={onCreateSet} disabled={busy}>
            {busy ? "Creating…" : `Create set · teams of ${DEFAULT_SIZE}`}
          </button>
          <span style={{ fontSize: 11.5, color: "var(--ink3)" }}>
            teams are formed from the roster right away — you can adjust them after
          </span>
        </div>
      )}

      {/* toolbar */}
      <div
        style={{
          border: "1px solid var(--line)",
          background: "var(--paper2)",
          borderRadius: 10,
          padding: 11,
          display: "flex",
          gap: 10,
          flexWrap: "wrap",
          alignItems: "center",
          marginBottom: 14,
        }}
      >
        <label
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
            color: "var(--ink2)",
          }}
        >
          Team size
          <input
            type="number"
            min={2}
            max={8}
            className="t-in t-num"
            style={{ width: 56, padding: "4px 6px" }}
            value={sizeInput}
            disabled={busy}
            onChange={(e) => setSizeInput(e.target.value)}
            onBlur={commitSize}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
          />
        </label>
        <span style={{ fontSize: 11.5, color: "var(--ink3)" }}>
          changing the size re-forms the teams for this set
        </span>
        <button className="t-btn line" onClick={onAutoForm} disabled={busy}>
          Auto-form teams
        </button>
        <button className="t-btn line" onClick={onAddTeam} disabled={busy}>
          + Add team
        </button>
        <button
          className={activeSet?.locked ? "t-btn green" : "t-btn primary"}
          onClick={onPublish}
          disabled={busy}
        >
          {activeSet?.locked ? "✓ Published · Locked" : "Publish teams"}
        </button>
        {confirmReform ? (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
              border: "1px solid var(--amber)",
              background: "var(--amberBg)",
              borderRadius: 10,
              padding: "4px 6px 4px 11px",
            }}
          >
            <span style={{ fontSize: 11.5, color: "var(--amber)" }}>
              Re-forming teams deletes the current ones — {confirmReform.scores} recorded team
              score{confirmReform.scores === 1 ? "" : "s"} would go with them.
            </span>
            <button
              className="t-btn amber"
              onClick={() => void doReform(confirmReform.n)}
              disabled={busy}
            >
              Re-form anyway
            </button>
            <button
              className="t-btn ghost"
              style={{ border: "1px solid var(--line)" }}
              onClick={() => {
                setConfirmReform(null);
                setSizeInput(String(activeSetSize));
              }}
              disabled={busy}
            >
              Cancel
            </button>
          </span>
        ) : confirmDeleteSet ? (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
              border: "1px solid var(--amber)",
              background: "var(--amberBg)",
              borderRadius: 10,
              padding: "4px 6px 4px 11px",
            }}
          >
            <span style={{ fontSize: 11.5, color: "var(--amber)" }}>
              Delete this set — its {teams.length} team{teams.length === 1 ? "" : "s"} and any team
              scores recorded against them go too. Students stay on the roster.
            </span>
            <button className="t-btn amber" onClick={onDeleteSet} disabled={busy}>
              {busy ? "Deleting…" : "Delete set"}
            </button>
            <button
              className="t-btn ghost"
              style={{ border: "1px solid var(--line)" }}
              onClick={() => setConfirmDeleteSet(false)}
              disabled={busy}
            >
              Cancel
            </button>
          </span>
        ) : (
          <button
            className="t-btn ghost"
            style={{ border: "1px solid var(--line)", color: "var(--amber)" }}
            onClick={() => setConfirmDeleteSet(true)}
            disabled={busy}
          >
            Delete set
          </button>
        )}
        <span className="t-spacer" />
        <span className="t-num" style={{ fontSize: 11.5, color: "var(--ink2)" }}>
          {status}
        </span>
      </div>

      {/* bulk move bar */}
      {selIds.length > 0 && (
        <div className="t-movebar">
          <span className="t-num" style={{ fontWeight: 600 }}>
            {selIds.length} selected
          </span>
          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              color: "var(--ink2)",
            }}
          >
            Move to
            <select
              className="t-in"
              style={{ padding: "5px 8px" }}
              value=""
              disabled={busy}
              onChange={(e) => {
                const v = e.target.value;
                if (!v) return;
                void move(selIds, v === UNASSIGNED ? null : v);
              }}
            >
              <option value="">Choose…</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
              <option value={UNASSIGNED}>Unassigned</option>
            </select>
          </label>
          <button
            className="t-btn ghost"
            style={{ border: "1px solid var(--line)" }}
            onClick={() => setSel(new Set())}
          >
            Clear
          </button>
        </div>
      )}

      {/* team cards */}
      {loadingTeams && teams.length === 0 ? (
        <div style={{ color: "var(--ink2)", padding: "10px 2px" }}>Loading teams…</div>
      ) : teams.length === 0 ? (
        <div
          style={{
            border: "1px dashed var(--line)",
            background: "var(--paper2)",
            borderRadius: 10,
            padding: 18,
          }}
        >
          <div style={{ fontFamily: "var(--serif)", fontSize: 16, fontWeight: 700 }}>
            No teams in this set yet
          </div>
          <div style={{ fontSize: 12.5, color: "var(--ink2)", marginTop: 4 }}>
            Auto-form teams of {activeSetSize} from the {roster.length} students on the roster, or
            add an empty team and place students yourself.
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 11, flexWrap: "wrap" }}>
            <button className="t-btn primary" onClick={onAutoForm} disabled={busy}>
              Auto-form teams
            </button>
            <button className="t-btn line" onClick={onAddTeam} disabled={busy}>
              + Add team
            </button>
          </div>
        </div>
      ) : (
        <div className="t-grid t-cards2">
          {teams.map((t) => {
            const under = t.members.length < activeSetSize;
            const q = queries[t.id] ?? "";
            const matches = q.trim()
              ? unassigned
                  .filter((s) => s.name.toLowerCase().includes(q.trim().toLowerCase()))
                  .slice(0, 4)
              : [];
            // A team below the target size is not a problem to be flagged — a
            // set of two students makes teams of one, and an amber card on
            // every one of them says nothing anyone can act on. An EMPTY team
            // still gets a line, because that one is unfinished work.
            const warn = t.members.length === 0 ? "No students yet" : "";
            return (
              <div className="t-teamcard" key={t.id}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    className="t-in"
                    style={{
                      flex: 1,
                      minWidth: 0,
                      borderColor: "transparent",
                      background: "transparent",
                      fontSize: 13.5,
                      fontWeight: 600,
                      padding: "2px 4px",
                    }}
                    value={t.name}
                    aria-label="Team name"
                    onChange={(e) => onTeamNameChange(t.id, e.target.value)}
                    onBlur={() => void commitTeamName(t.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                    }}
                  />
                  <span className={"t-chip" + (under ? " amber" : "")}>
                    {t.members.length} / {activeSetSize}
                  </span>
                  {/* Deleting a team cascades away every tRAT that team wrote
                      and every mark on it, across all weeks. It used to be one
                      unguarded click. Arm first, and say what goes. */}
                  {armedTeam === t.id ? (
                    <button
                      className="t-btn sm danger"
                      title={teamCost ?? "Click to delete this team"}
                      onBlur={() => {
                        setArmedTeam(null);
                        setTeamCost(null);
                      }}
                      onClick={() => {
                        setArmedTeam(null);
                        setTeamCost(null);
                        void onDeleteTeam(t.id);
                      }}
                    >
                      {teamCost ?? "Delete team?"}
                    </button>
                  ) : (
                    <button
                      className="t-x"
                      title="Delete team"
                      onClick={() => {
                        setArmedTeam(t.id);
                        setTeamCost(null);
                        void countOneTeamResults(t.id)
                          .then((n) =>
                            setTeamCost(
                              n === 0
                                ? "Delete team?"
                                : `Delete team and ${n} recorded ${n === 1 ? "score" : "scores"}?`,
                            ),
                          )
                          .catch(() => setTeamCost("Delete team? (could not check its scores)"));
                      }}
                    >
                      ✕
                    </button>
                  )}
                </div>

                <div
                  style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 9 }}
                >
                  {t.members.map((m) => (
                    <div
                      className={"t-memberrow" + (sel.has(m.id) ? " sel" : "")}
                      key={m.id}
                    >
                      <input
                        type="checkbox"
                        className="t-selbox"
                        checked={sel.has(m.id)}
                        aria-label={`Select ${m.name}`}
                        onChange={(e) => toggleSel(m.id, e.target.checked)}
                      />
                      <Avatar name={m.name} tint={m.avatar_tint} size={20} />
                      <span
                        style={{
                          fontSize: 12.5,
                          flex: 1,
                          minWidth: 0,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {m.name}
                      </span>
                    </div>
                  ))}
                </div>

                {warn && (
                  <div className="t-warn">
                    <span>⚑</span>
                    <span>{warn}</span>
                  </div>
                )}

                <div style={{ marginTop: 9 }}>
                  <input
                    className="t-in"
                    style={{ width: "100%", padding: "4px 6px", fontSize: 12 }}
                    value={q}
                    placeholder="Add student…"
                    onChange={(e) =>
                      setQueries((prev) => ({ ...prev, [t.id]: e.target.value }))
                    }
                  />
                </div>
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 6 }}>
                  {matches.map((s) => (
                    <button
                      key={s.id}
                      className="t-btn ghost"
                      style={{
                        border: "1px dashed var(--line)",
                        fontSize: 11.5,
                        padding: "2px 7px",
                        borderRadius: 12,
                      }}
                      disabled={busy}
                      onClick={() => {
                        setQueries((prev) => ({ ...prev, [t.id]: "" }));
                        void move([s.id], t.id);
                      }}
                    >
                      + {s.name}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* unassigned pool */}
      <div
        style={{
          border: "1px solid var(--line)",
          background: "var(--paper2)",
          borderRadius: 10,
          padding: 11,
          marginTop: 16,
        }}
      >
        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "baseline",
            flexWrap: "wrap",
            marginBottom: 8,
          }}
        >
          <span className="t-kicker">Unassigned roster · select, then move to a team</span>
          <span className="t-num" style={{ fontSize: 11.5, color: "var(--ink2)" }}>
            {unassigned.length} of {roster.length}
          </span>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {unassigned.length ? (
            unassigned.map((s) => (
              <label
                key={s.id}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  border: `1px solid ${sel.has(s.id) ? "var(--blue)" : "var(--line)"}`,
                  borderRadius: 14,
                  padding: "2px 8px 2px 6px",
                  background: "var(--paper)",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  className="t-selbox"
                  checked={sel.has(s.id)}
                  onChange={(e) => toggleSel(s.id, e.target.checked)}
                />
                <Avatar name={s.name} tint={s.avatar_tint} size={18} />
                <span style={{ fontSize: 12 }}>{s.name}</span>
              </label>
            ))
          ) : (
            <span style={{ fontSize: 12, color: "var(--ink3)" }}>Every student is placed.</span>
          )}
        </div>
        <div style={{ marginTop: 9, fontSize: 11.5, color: "var(--ink3)" }}>
          Students are added or removed on the Roster screen — this pool follows the class list.
        </div>
      </div>
    </section>
  );
}
