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
import { deleteTeamResourceObjects, deleteTeamStorage } from "./purge";
import { countResourcesForTeams } from "./resources";
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

/**
 * What a team delete takes, named.
 *
 * Photos are counted apart from scores because neither implies the other: a
 * photo needs no result row to exist, so the set with a term of whiteboards on
 * it and nothing yet recorded reads as costless unless this says otherwise.
 */
function costPhrase(scores: number, photos: number): string {
  const parts: string[] = [];
  if (scores > 0) parts.push(`${scores} recorded team score${scores === 1 ? "" : "s"}`);
  if (photos > 0) parts.push(`${photos} whiteboard photo${photos === 1 ? "" : "s"}`);
  return parts.join(" and ");
}

/** The same counts with the nouns clipped, for a button sharing a card header. */
function shortCostPhrase(scores: number, photos: number): string {
  const parts: string[] = [];
  if (scores > 0) parts.push(`${scores} score${scores === 1 ? "" : "s"}`);
  if (photos > 0) parts.push(`${photos} photo${photos === 1 ? "" : "s"}`);
  return parts.join(" and ");
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
  /** What deleting the whole set would cost, once we have been and asked. */
  const [setCost, setSetCost] = useState<string | null>(null);
  const [armedTeam, setArmedTeam] = useState<string | null>(null);
  const [teamCost, setTeamCost] = useState<{ label: string; title: string } | null>(null);
  /** A pending re-form that would destroy recorded team scores, or photos. */
  const [confirmReform, setConfirmReform] = useState<
    { n: number; scores: number; photos: number; counted: boolean } | null
  >(null);

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
   *  them and every photo they hold — so ask first when there is something to
   *  lose. */
  const reformOrConfirm = async (n: number) => {
    if (!activeSet) return;
    // Photos as well as scores. Gating on scores alone waved through the exact
    // case that hurts: nudging the size box from 4 to 5 on a set nobody has
    // graded yet, which still holds every whiteboard the teams ever filed.
    // A count that FAILED must not read as a count of zero. Both of these gate
    // an irreversible delete, so the safe direction is to ask anyway and say we
    // could not tell — treating a network blip as "nothing to lose" is how the
    // dialog goes missing on exactly the set that needed it.
    let counted = true;
    const scores = await countTeamResults(activeSet.id).catch(() => {
      counted = false;
      return 0;
    });
    const photos = await countResourcesForTeams(teams.map((t) => t.id)).catch(() => {
      counted = false;
      return 0;
    });
    if (!counted || scores > 0 || photos > 0) {
      setConfirmReform({ n, scores, photos, counted });
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
    // team that no longer exists. The team's audio goes the same way, through
    // its own subject_type='team' result row.
    const doomedTeams = teams.map((t) => t.id);
    setConfirmReform(null);
    setSel(new Set());
    await run(async () => {
      await deleteTeamResourceObjects(doomedTeams);
      await deleteTeamStorage(doomedTeams);
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
      // Numbered like the auto-formed ones rather than "New team": the number
      // is what gets said out loud in the room, and a set reading Team 1..5 plus
      // a "New team" is one team nobody can refer to.
      await createTeam(setIdNow, `Team ${teams.length + 1}`, teams.length);
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
      // The team's files first — photos, and the audio hanging off its own team
      // result. Both cascade from teams as ROWS, and neither cascade reaches
      // storage, so the objects would be left behind; 0018 and 0013 only let
      // anyone remove them WHILE the rows are still there to authorise against.
      await deleteTeamResourceObjects([teamId]);
      await deleteTeamStorage([teamId]);
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

  /** Arm the set delete, then go and find out what it would actually cost. */
  const armDeleteSet = () => {
    setConfirmDeleteSet(true);
    setSetCost(null);
    if (!activeSet) return;
    void Promise.all([
      countTeamResults(activeSet.id),
      countResourcesForTeams(teams.map((t) => t.id)),
    ])
      .then(([scores, photos]) => {
        const cost = costPhrase(scores, photos);
        setSetCost(cost ? `${cost} go with them.` : "Nothing is recorded against them.");
      })
      .catch(() =>
        setSetCost(
          "Any team scores and whiteboard photos go with them — we couldn't reach the " +
            "database to count how many.",
        ),
      );
  };

  /** Deleting a set takes its teams — their scores, their photos, their audio. */
  const onDeleteSet = async () => {
    if (!activeSetId) return;
    const doomed = activeSetId;
    const doomedTeams = teams.map((t) => t.id);
    await run(async () => {
      // Same reason as onDeleteTeam, for every team in the set.
      await deleteTeamResourceObjects(doomedTeams);
      await deleteTeamStorage(doomedTeams);
      await deleteTeamSet(doomed);
      const remaining = sets.filter((s) => s.id !== doomed);
      setSets(remaining);
      setConfirmDeleteSet(false);
      setSetCost(null);
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

      {/* The toolbar.
          It used to be one flat row of four equal buttons with a sentence of
          explanation wedged between them, and Delete set — the one action here
          that destroys a term's photographs — sitting at the same weight, and
          directly beside, the one everybody presses. Three groups now, in the
          order the work happens: SHAPE the teams on the left, read where you
          are in the middle, COMMIT on the right. Delete leaves the row of
          buttons entirely.

          Team size and Auto-form are one control, because they are one action:
          both call reformOrConfirm, one at the number in the box and one at the
          number already saved. Sitting together they explain each other, which
          is what retired the sentence — it is the input's tooltip now. */}
      <div className="t-teambar">
        <div className="t-teambar-group">
          <label className="t-teambar-size">
            Team size
            <input
              type="number"
              min={2}
              max={8}
              className="t-in t-num"
              style={{ width: 56, padding: "4px 6px" }}
              value={sizeInput}
              disabled={busy}
              title="Changing the size re-forms the teams for this set. You are asked first."
              onChange={(e) => setSizeInput(e.target.value)}
              onBlur={commitSize}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
            />
          </label>
          <button className="t-btn line" onClick={onAutoForm} disabled={busy}>
            Auto-form teams
          </button>
          <button className="t-btn line" onClick={onAddTeam} disabled={busy}>
            + Add team
          </button>
        </div>

        <span className="t-spacer" />

        <span className="t-num" style={{ fontSize: 11.5, color: "var(--ink2)" }}>
          {status}
        </span>
        <button
          className={activeSet?.locked ? "t-btn green" : "t-btn primary"}
          onClick={onPublish}
          disabled={busy}
        >
          {activeSet?.locked ? "✓ Published · Locked" : "Publish teams"}
        </button>
        {/* Reachable, and no longer dressed as a peer of Publish. A link is the
            right shape for it: rare, deliberate, and asked about before it
            happens anyway. */}
        {!confirmDeleteSet && !confirmReform ? (
          <button className="t-textlink danger" onClick={armDeleteSet} disabled={busy}>
            Delete set
          </button>
        ) : null}
      </div>

      {/* The two questions, given their own row.
          Wedged into the toolbar these wrapped into the buttons and were read
          past — which is the one thing a sentence about deleting a term's
          photographs must not be. */}
      {confirmReform ? (
        <div className="t-confirmbar">
          <span style={{ fontSize: 11.5, color: "var(--amber)", flex: 1, minWidth: 240 }}>
            {confirmReform.counted
              ? `Re-forming teams deletes the current ones — ${costPhrase(
                  confirmReform.scores,
                  confirmReform.photos,
                )} would go with them, from every week, for good.`
              : "Re-forming teams deletes the current ones, and every score and photo they " +
                "hold, from every week, for good. We could not reach the database to say how " +
                "much that is — so check before you go ahead."}
          </span>
          <button className="t-btn amber" onClick={() => void doReform(confirmReform.n)} disabled={busy}>
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
        </div>
      ) : confirmDeleteSet ? (
        <div className="t-confirmbar">
          <span style={{ fontSize: 11.5, color: "var(--amber)", flex: 1, minWidth: 240 }}>
            Delete this set and its {teams.length} team{teams.length === 1 ? "" : "s"}.{" "}
            {setCost ?? "Checking what would go with them…"} Students stay on the roster.
          </span>
          {/* Disabled until the count lands: the whole point of this bar is the
              number in it, and a click that beats it is the unwarned delete all
              over again. */}
          <button className="t-btn amber" onClick={onDeleteSet} disabled={busy || setCost === null}>
            {busy ? "Deleting…" : "Delete set"}
          </button>
          <button
            className="t-btn ghost"
            style={{ border: "1px solid var(--line)" }}
            onClick={() => {
              setConfirmDeleteSet(false);
              setSetCost(null);
            }}
            disabled={busy}
          >
            Cancel
          </button>
        </div>
      ) : null}

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
                  {/* Drawn as the field it is. It used to be transparent on
                      both border and background, which made a renameable name
                      look exactly like a printed heading — the rename worked,
                      nobody could tell it was there. */}
                  <input
                    className="t-in"
                    style={{
                      flex: 1,
                      minWidth: 0,
                      fontSize: 13.5,
                      fontWeight: 600,
                      padding: "2px 6px",
                    }}
                    value={t.name}
                    aria-label="Team name"
                    title="Rename this team"
                    onChange={(e) => onTeamNameChange(t.id, e.target.value)}
                    onBlur={() => void commitTeamName(t.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                    }}
                  />
                  <span className={"t-chip" + (under ? " amber" : "")}>
                    {t.members.length} / {activeSetSize}
                  </span>
                  {/* Deleting a team cascades away every tRAT that team wrote,
                      every mark on it and every photo it filed, across all
                      weeks. It used to be one unguarded click. Arm first, and
                      say what goes — short on the button, in full on hover. */}
                  {armedTeam === t.id ? (
                    <button
                      className="t-btn sm danger"
                      title={teamCost?.title ?? "Click to delete this team"}
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
                      {teamCost?.label ?? "Delete team?"}
                    </button>
                  ) : (
                    <button
                      className="t-x"
                      title="Delete team"
                      onClick={() => {
                        setArmedTeam(t.id);
                        setTeamCost(null);
                        void Promise.all([
                          countOneTeamResults(t.id),
                          countResourcesForTeams([t.id]),
                        ])
                          .then(([scores, photos]) => {
                            const short = shortCostPhrase(scores, photos);
                            setTeamCost({
                              label: short ? `Delete team and ${short}?` : "Delete team?",
                              title: short
                                ? `Deleting this team also deletes ${costPhrase(scores, photos)}, ` +
                                  "from every week. There is no undo."
                                : "Nothing is recorded against this team.",
                            });
                          })
                          .catch(() =>
                            setTeamCost({
                              label: "Delete team? (could not check what goes with it)",
                              title:
                                "We couldn't reach the database to count them — any scores, " +
                                "photos and recordings on this team go too.",
                            }),
                          );
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
