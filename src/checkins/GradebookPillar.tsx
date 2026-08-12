"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createCheckIn,
  listCheckIns,
  listResults,
  listTeamSets,
  listTeams,
  saveResult,
} from "./data";
import { Icon } from "./icons";
import { isCompletionMet } from "./studentData";
import type {
  Activity,
  CheckIn,
  CheckInKind,
  CheckInResult,
  CheckInScale,
  ResultStatus,
  Student,
  TeamWithMembers,
} from "./types";
import { Avatar, EmptyState, ErrorBanner, weekLabel, type PillarProps } from "./ui";

/* ---------------- constants ---------------- */

const LOOP: readonly (readonly [string, string])[] = [
  ["1", "Individual attempt"],
  ["2", "Team discussion"],
  ["3", "Resubmit"],
];

const LEGEND: readonly { g: string; label: string; color: string; bg: string }[] = [
  { g: "—", label: "not started", color: "var(--ink3)", bg: "transparent" },
  { g: "●", label: "submitted, unscored", color: "var(--blue)", bg: "var(--blueBg)" },
  { g: "⚑", label: "needs review", color: "var(--amber)", bg: "var(--amberBg)" },
  { g: "4", label: "scored", color: "var(--ink)", bg: "transparent" },
  { g: "·", label: "excused / absent", color: "var(--ink3)", bg: "transparent" },
  { g: "✓", label: "team submitted + scored", color: "var(--green)", bg: "var(--greenBg)" },
  { g: "✗", label: "marked not complete", color: "var(--amber)", bg: "var(--amberBg)" },
  { g: "··", label: "team not submitted", color: "var(--ink3)", bg: "transparent" },
  { g: "●", label: "team discussing (pulsing)", color: "var(--amber)", bg: "var(--amberBg)" },
];

const PHASES = ["Readiness", "Participation", "Milestone"];

/** Points a team check-in defaults to; individual check-ins default to 10. */
const DEFAULT_MAX: Record<CheckInKind, number> = { individual: 10, team: 15 };

type SubjectKind = "student" | "team";

interface OpenCell {
  checkInId: string;
  subjectKind: SubjectKind;
  subjectId: string;
}

interface CellVM {
  glyph: string;
  num: string;
  color: string;
  bg: string;
  glyphColor: string;
  pulse: boolean;
  title: string;
}

const msg = (e: unknown) => String((e as Error)?.message ?? e);
const rkey = (checkInId: string, kind: SubjectKind, id: string) => `${checkInId}|${kind}:${id}`;

function scaleNote(c: CheckIn): string {
  return c.scale === "ci" ? "complete / incomplete" : `out of ${c.max_points ?? 0} points`;
}

function columnMeta(c: CheckIn): string {
  const head = c.kind === "team" ? "Team · " : "Individual · ";
  const tail = c.scale === "ci" ? "C/I" : `${c.max_points ?? 0} pts`;
  return `${head}${c.phase || "Readiness"} · ${tail}`;
}

/** The visual state of one gradebook cell, mirroring the prototype's cellVM. */
function cellVM(c: CheckIn, r: CheckInResult | undefined, isTeamRow: boolean): CellVM {
  const round = c.kind === "team" ? "Round 2 · team" : "Round 1 · individual";
  const status: ResultStatus = r?.status ?? "none";
  let glyph = isTeamRow ? "··" : "—";
  let num = "";
  let color = "var(--ink3)";
  let bg = "transparent";
  let pulse = false;
  let title = `Not started · ${round}`;

  if (status === "draft") {
    glyph = "●";
    title = `Draft, not submitted · ${round}`;
  } else if (status === "submitted") {
    glyph = "●";
    color = "var(--blue)";
    bg = "var(--blueBg)";
    title = `Submitted, unscored · ${round}`;
  } else if (status === "needs_review") {
    glyph = "⚑";
    color = "var(--amber)";
    bg = "var(--amberBg)";
    title = `Needs review · ${round}`;
  } else if (status === "excused") {
    glyph = "·";
    title = `Excused / absent · ${round}`;
  } else if (status === "discussing") {
    glyph = "●";
    color = "var(--amber)";
    bg = "var(--amberBg)";
    pulse = true;
    title = `Team discussion in progress · ${round}`;
  } else if (status === "scored") {
    const notComplete = r != null && r.is_ci && !isCompletionMet(r);
    if (notComplete) {
      glyph = "✗";
    } else if (r?.is_ci) {
      glyph = "✓";
    } else {
      num = r?.score != null ? String(r.score) : "";
      glyph = isTeamRow || !num ? "✓" : "";
    }
    // A ✗ carries its own colour past this point. The three lines below are the
    // look of a mark that went well — ink, and green behind a team row — and a
    // completion that was not met wearing them is how it read as Complete.
    color = notComplete ? "var(--amber)" : "var(--ink)";
    if (notComplete) bg = "var(--amberBg)";
    else if (isTeamRow) bg = "var(--greenBg)";
    title = notComplete ? `Not complete · ${round}` : `Scored · ${round}`;
  }
  const glyphColor = glyph === "" ? "transparent" : color;
  return { glyph, num, color, bg, glyphColor, pulse, title };
}

/* ---------------- component ---------------- */

export function GradebookPillar(props: PillarProps) {
  const { courseId, roster, activities } = props;

  const [checkIns, setCheckIns] = useState<CheckIn[]>([]);
  const [results, setResults] = useState<CheckInResult[]>([]);
  const [teams, setTeams] = useState<TeamWithMembers[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [legendOpen, setLegendOpen] = useState(true);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState<{
    label: string;
    kind: CheckInKind;
    phase: string;
    scale: CheckInScale;
    activityId: string;
  }>({ label: "", kind: "individual", phase: "Readiness", scale: "points", activityId: "" });

  const [open, setOpen] = useState<OpenCell | null>(null);
  const [panelScore, setPanelScore] = useState("");
  const [modal, setModal] = useState<{ caption: string; lines: string[] } | null>(null);
  const [narrow, setNarrow] = useState(false);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const didJump = useRef(false);
  const rosterRef = useRef<Student[]>(roster);
  const activitiesRef = useRef<Activity[]>(activities);
  rosterRef.current = roster;
  activitiesRef.current = activities;

  const activityKey = activities.map((a) => a.id).join(",");
  const rosterKey = roster.map((s) => s.id).join(",");

  /* ---------- load ---------- */
  const load = useCallback(async () => {
    const acts = activitiesRef.current;
    const ros = rosterRef.current;
    try {
      const [sets, cis] = await Promise.all([
        listTeamSets(courseId),
        listCheckIns(acts.map((a) => a.id)),
      ]);
      const first = acts[0];
      const set = (first ? sets.find((s) => s.activity_id === first.id) : undefined) ?? sets[0];
      const [tms, res] = await Promise.all([
        set ? listTeams(set.id, ros) : Promise.resolve<TeamWithMembers[]>([]),
        listResults(cis.map((c) => c.id)),
      ]);
      setCheckIns(cis);
      setTeams(tms);
      setResults(res);
      setError(null);
    } catch (e) {
      setError(msg(e));
    } finally {
      setLoading(false);
    }
  }, [courseId, activityKey, rosterKey]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < 820);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  /* ---------- derived ---------- */
  const columns = useMemo(() => {
    const out: { checkIn: CheckIn; activity: Activity }[] = [];
    for (const a of activities) {
      const own = checkIns
        .filter((c) => c.activity_id === a.id)
        .sort((x, y) => x.position - y.position || x.created_at.localeCompare(y.created_at));
      for (const c of own) out.push({ checkIn: c, activity: a });
    }
    return out;
  }, [activities, checkIns]);

  const groups = useMemo(() => {
    const g: { activity: Activity; span: number }[] = [];
    for (const col of columns) {
      const last = g[g.length - 1];
      if (last && last.activity.id === col.activity.id) last.span += 1;
      else g.push({ activity: col.activity, span: 1 });
    }
    return g;
  }, [columns]);

  const resultMap = useMemo(() => {
    const m = new Map<string, CheckInResult>();
    for (const r of results) {
      const id = r.subject_type === "student" ? r.student_id : r.team_id;
      if (id) m.set(rkey(r.check_in_id, r.subject_type, id), r);
    }
    return m;
  }, [results]);

  const teamOf = useMemo(() => {
    const m = new Map<string, TeamWithMembers>();
    for (const t of teams) for (const s of t.members) m.set(s.id, t);
    return m;
  }, [teams]);

  const unassigned = useMemo(
    () => roster.filter((s) => !teamOf.has(s.id)),
    [roster, teamOf],
  );

  /** Students in the order their rows appear: team by team, then unassigned. */
  const studentOrder = useMemo(
    () => [...teams.flatMap((t) => t.members), ...unassigned],
    [teams, unassigned],
  );

  const currentWeekAct = useMemo(() => {
    const started = activities.filter((a) => a.stage >= 1);
    if (!started.length) return activities[0] ?? null;
    return started.slice().sort((a, b) => (b.week ?? 0) - (a.week ?? 0))[0];
  }, [activities]);

  const tallyCols = useMemo(() => {
    if (!currentWeekAct) return { ind: null, team: null };
    const own = columns.filter((x) => x.activity.id === currentWeekAct.id).map((x) => x.checkIn);
    return {
      ind: own.find((c) => c.kind === "individual") ?? null,
      team: own.find((c) => c.kind === "team") ?? null,
    };
  }, [columns, currentWeekAct]);

  const scoredOf = useCallback(
    (checkInId: string, kind: SubjectKind, id: string): number | null => {
      const r = resultMap.get(rkey(checkInId, kind, id));
      if (!r || r.status !== "scored" || r.is_ci || r.score == null) return null;
      return r.score;
    },
    [resultMap],
  );

  const studentTotal = useCallback(
    (s: Student) => {
      const team = teamOf.get(s.id) ?? null;
      let earned = 0;
      let possible = 0;
      for (const { checkIn: c } of columns) {
        if (c.scale === "ci") continue;
        const n =
          c.kind === "individual"
            ? scoredOf(c.id, "student", s.id)
            : team
              ? scoredOf(c.id, "team", team.id)
              : null;
        if (n != null) {
          earned += n;
          possible += c.max_points ?? 0;
        }
      }
      return { earned, possible, pct: possible ? Math.round((earned / possible) * 100) : null };
    },
    [columns, scoredOf, teamOf],
  );

  const teamTotal = useCallback(
    (teamId: string) => {
      let earned = 0;
      let possible = 0;
      for (const { checkIn: c } of columns) {
        if (c.kind !== "team" || c.scale === "ci") continue;
        const n = scoredOf(c.id, "team", teamId);
        if (n != null) {
          earned += n;
          possible += c.max_points ?? 0;
        }
      }
      return { earned, possible, pct: possible ? Math.round((earned / possible) * 100) : null };
    },
    [columns, scoredOf],
  );

  /** iRAT → tRAT lift for a week, each side as a percentage of its own max. */
  const weekLift = useCallback(
    (activityId: string) => {
      const own = columns.filter((x) => x.activity.id === activityId).map((x) => x.checkIn);
      const ind = own.find((c) => c.kind === "individual");
      const team = own.find((c) => c.kind === "team");
      if (!ind || !team || !ind.max_points || !team.max_points) return null;
      const mean = (c: CheckIn, kind: SubjectKind, ids: string[]) => {
        const v = ids.map((id) => scoredOf(c.id, kind, id)).filter((n): n is number => n != null);
        return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
      };
      const im = mean(ind, "student", roster.map((s) => s.id));
      const tm = mean(team, "team", teams.map((t) => t.id));
      if (im == null || tm == null) return null;
      const ip = Math.round((im / ind.max_points) * 100);
      const tp = Math.round((tm / team.max_points) * 100);
      return { ip, tp, d: tp - ip };
    },
    [columns, roster, scoredOf, teams],
  );

  /* ---------- jump to week ---------- */
  const jumpToWeek = useCallback((activityId: string) => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const th = wrap.querySelector<HTMLElement>(`[data-wk="${activityId}"]`);
    if (!th) return;
    const nameCell = wrap.querySelector<HTMLElement>(".t-gbname");
    const nameW = nameCell ? nameCell.offsetWidth : 210;
    const wr = wrap.getBoundingClientRect();
    const tr = th.getBoundingClientRect();
    wrap.scrollLeft += tr.left - wr.left - nameW - 8;
  }, []);

  // once on mount, after layout has settled
  useEffect(() => {
    if (loading || didJump.current || !columns.length || !currentWeekAct) return;
    didJump.current = true;
    const id = window.setTimeout(() => jumpToWeek(currentWeekAct.id), 180);
    return () => window.clearTimeout(id);
  }, [loading, columns.length, currentWeekAct, jumpToWeek]);

  /* ---------- mutations ---------- */
  const openCell = useCallback(
    (checkInId: string, subjectKind: SubjectKind, subjectId: string) => {
      const r = resultMap.get(rkey(checkInId, subjectKind, subjectId));
      setOpen({ checkInId, subjectKind, subjectId });
      setPanelScore(r && r.status === "scored" && r.score != null ? String(r.score) : "");
    },
    [resultMap],
  );

  const persist = useCallback(
    async (
      cell: OpenCell,
      patch: { status: ResultStatus; score: number | null; isCi: boolean; flagged: boolean },
    ) => {
      const subject =
        cell.subjectKind === "student"
          ? ({ type: "student", id: cell.subjectId } as const)
          : ({ type: "team", id: cell.subjectId } as const);
      setSaving(true);
      setError(null);
      try {
        const saved = await saveResult({
          checkInId: cell.checkInId,
          subject,
          status: patch.status,
          score: patch.score,
          isCi: patch.isCi,
          // `text` and the transcription fields are deliberately NOT sent.
          // They were being echoed back from whatever this page last read, so
          // marking a cell during a live session overwrote any answer handed in
          // since the page loaded — the student's work replaced by a stale copy
          // of itself. saveResult now treats an update as a patch, so omitting
          // them leaves the stored values alone.
          flagged: patch.flagged,
        });
        // optimistic merge, then reconcile with the server
        setResults((rs) => [...rs.filter((r) => r.id !== saved.id), saved]);
        setResults(await listResults(checkIns.map((c) => c.id)));
        return true;
      } catch (e) {
        setError(msg(e));
        return false;
      } finally {
        setSaving(false);
      }
    },
    [checkIns, resultMap],
  );

  const scoreFor = useCallback(
    (c: CheckIn): { score: number | null; isCi: boolean } | null => {
      if (c.scale === "ci") return { score: null, isCi: true };
      const raw = panelScore.trim();
      if (raw === "") return { score: c.max_points ?? 10, isCi: false };
      const n = Number(raw);
      if (!Number.isFinite(n)) {
        setError(`"${raw}" is not a number — enter points, or leave the box empty for full marks.`);
        return null;
      }
      return { score: n, isCi: false };
    },
    [panelScore],
  );

  const markComplete = useCallback(
    async (cell: OpenCell, c: CheckIn) => {
      const v = scoreFor(c);
      if (!v) return false;
      return persist(cell, { status: "scored", score: v.score, isCi: v.isCi, flagged: false });
    },
    [persist, scoreFor],
  );

  const markNeedsReview = useCallback(
    async (cell: OpenCell) =>
      persist(cell, { status: "needs_review", score: null, isCi: false, flagged: true }),
    [persist],
  );

  const saveAndNext = useCallback(
    async (cell: OpenCell, c: CheckIn) => {
      const ok = await markComplete(cell, c);
      if (!ok) return;
      const list =
        c.kind === "team" ? teams.map((t) => t.id) : studentOrder.map((s) => s.id);
      if (!list.length) {
        setOpen(null);
        return;
      }
      const i = list.indexOf(cell.subjectId);
      const nextId = list[(i + 1) % list.length];
      openCell(cell.checkInId, cell.subjectKind, nextId);
    },
    [markComplete, openCell, studentOrder, teams],
  );

  const addCheckIn = useCallback(
    async (input: {
      activity: Activity;
      label: string;
      kind: CheckInKind;
      phase: string;
      scale: CheckInScale;
    }) => {
      const pos = checkIns
        .filter((c) => c.activity_id === input.activity.id)
        .reduce((m, c) => Math.max(m, c.position + 1), 0);
      await createCheckIn({
        activityId: input.activity.id,
        label: input.label,
        kind: input.kind,
        phase: input.phase,
        scale: input.scale,
        maxPoints: input.scale === "ci" ? null : DEFAULT_MAX[input.kind],
        position: pos,
      });
    },
    [checkIns],
  );

  const onAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const activity = activities.find((a) => a.id === form.activityId) ?? activities[0];
    if (!activity) return;
    setSaving(true);
    setError(null);
    try {
      await addCheckIn({
        activity,
        label: form.label.trim() || "New check-in",
        kind: form.kind,
        phase: form.phase,
        scale: form.scale,
      });
      setAddOpen(false);
      setForm((f) => ({ ...f, label: "" }));
      await load();
    } catch (err) {
      setError(msg(err));
    } finally {
      setSaving(false);
    }
  };

  /** Empty-state shortcut: give a week its iRAT and its tRAT in one go. */
  const onSeedWeek = async (a: Activity) => {
    const n = a.week ?? 1;
    setSaving(true);
    setError(null);
    try {
      await addCheckIn({
        activity: a,
        label: `iRAT ${n}`,
        kind: "individual",
        phase: "Readiness",
        scale: "points",
      });
      await addCheckIn({
        activity: a,
        label: `tRAT ${n}`,
        kind: "team",
        phase: "Readiness",
        scale: "points",
      });
      await load();
    } catch (err) {
      setError(msg(err));
    } finally {
      setSaving(false);
    }
  };

  /* ---------- panel context ---------- */
  const openCol = open ? (checkIns.find((c) => c.id === open.checkInId) ?? null) : null;
  const openAct = openCol ? (activities.find((a) => a.id === openCol.activity_id) ?? null) : null;
  const openResult = open
    ? (resultMap.get(rkey(open.checkInId, open.subjectKind, open.subjectId)) ?? null)
    : null;
  const openSubjectName = open
    ? open.subjectKind === "team"
      ? (teams.find((t) => t.id === open.subjectId)?.name ?? "Team")
      : (roster.find((s) => s.id === open.subjectId)?.name ?? "Student")
    : "";
  const nextName = (() => {
    if (!open || !openCol) return null;
    const list = openCol.kind === "team" ? teams : studentOrder;
    if (!list.length) return null;
    const ids = list.map((x) => x.id);
    const i = ids.indexOf(open.subjectId);
    const nxt = list[(i + 1) % list.length];
    return nxt.name;
  })();

  /* ---------- pieces ---------- */
  const header = (
    <div className="t-row">
      <h1 className="t-h1">Check-ins</h1>
      <span className="t-sub">
        two check-ins a week — an individual iRAT then a team tRAT — grouped by week.
      </span>
      <span className="t-spacer" />
      <button
        className="t-btn primary"
        disabled={!activities.length}
        title={
          activities.length
            ? "Append a check-in column"
            : "Add an activity first — every check-in belongs to a week"
        }
        onClick={() => {
          setForm((f) => ({
            ...f,
            activityId: f.activityId || currentWeekAct?.id || activities[0]?.id || "",
          }));
          setAddOpen((v) => !v);
        }}
      >
        + Add check-in
      </button>
    </div>
  );

  const loopBar = (
    <div className="t-loopbar">
      <span className="t-kicker">The loop</span>
      {LOOP.map(([n, label]) => (
        <span className="t-looppill" key={n}>
          <span className="n">{n}</span>
          {label}
        </span>
      ))}
      <span className="t-spacer" />
      <button
        className="t-btn sm ghost"
        style={{ border: "1px solid var(--line)" }}
        disabled={!columns.length || !currentWeekAct}
        onClick={() => currentWeekAct && jumpToWeek(currentWeekAct.id)}
      >
        Jump to this week
      </button>
      <button
        className="t-btn sm ghost"
        style={{ border: "1px solid var(--line)" }}
        onClick={() => setLegendOpen((v) => !v)}
      >
        {legendOpen ? "Hide" : "Show"} cell key
      </button>
    </div>
  );

  const legend = legendOpen ? (
    <div className="t-key">
      <span className="t-kicker">Cell key</span>
      {LEGEND.map((l) => (
        <span className="t-keyitem" key={l.g + l.label}>
          <span className="t-keyglyph" style={{ color: l.color, background: l.bg }}>
            {l.g}
          </span>
          {l.label}
        </span>
      ))}
    </div>
  ) : null;

  const addForm =
    addOpen && activities.length ? (
      <form
        onSubmit={onAddSubmit}
        style={{
          border: "1px solid var(--line)",
          background: "var(--paper2)",
          borderRadius: 10,
          padding: 12,
          marginBottom: 12,
          display: "grid",
          gap: 10,
          gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))",
          alignItems: "end",
          animation: "tblFade 120ms",
        }}
      >
        <label className="t-fld">
          Label
          <input
            className="t-in"
            value={form.label}
            placeholder="e.g. iRAT 5"
            onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
          />
        </label>
        <label className="t-fld">
          Type
          <select
            className="t-in"
            value={form.kind}
            onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as CheckInKind }))}
          >
            <option value="individual">Individual</option>
            <option value="team">Team</option>
          </select>
        </label>
        <label className="t-fld">
          Phase
          <select
            className="t-in"
            value={form.phase}
            onChange={(e) => setForm((f) => ({ ...f, phase: e.target.value }))}
          >
            {PHASES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <label className="t-fld">
          Scale
          <select
            className="t-in"
            value={form.scale}
            onChange={(e) => setForm((f) => ({ ...f, scale: e.target.value as CheckInScale }))}
          >
            <option value="points">Points</option>
            <option value="ci">Complete / incomplete</option>
          </select>
        </label>
        <label className="t-fld">
          Week / activity
          <select
            className="t-in"
            value={form.activityId || activities[0]?.id || ""}
            onChange={(e) => setForm((f) => ({ ...f, activityId: e.target.value }))}
          >
            {activities.map((a) => (
              <option key={a.id} value={a.id}>
                {weekLabel(a)} · {a.title}
              </option>
            ))}
          </select>
        </label>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="submit" className="t-btn primary" disabled={saving}>
            {saving ? "Adding…" : "Append column"}
          </button>
          <button
            type="button"
            className="t-btn ghost"
            style={{ border: "1px solid var(--line)" }}
            onClick={() => setAddOpen(false)}
          >
            Cancel
          </button>
        </div>
      </form>
    ) : null;

  /* ---------- body ---------- */
  let body: React.ReactNode;

  if (loading) {
    body = <div style={{ color: "var(--ink2)", padding: 20 }}>Loading check-ins…</div>;
  } else if (!roster.length) {
    body = (
      <EmptyState
        title="No students to grade yet"
        body="This session has no roster yet. Load the session roster in Roster, then its weekly check-in columns fill in here."
      />
    );
  } else if (!activities.length) {
    body = (
      <EmptyState
        title="No weeks yet"
        body="Every check-in belongs to a week. Add an activity in Activities — each one becomes a week group here, with its individual iRAT and its team tRAT underneath."
      />
    );
  } else if (!columns.length) {
    body = (
      <EmptyState
        title="No check-ins yet"
        body={`${activities.length} week${activities.length === 1 ? "" : "s"} and ${roster.length} student${roster.length === 1 ? "" : "s"} are ready. Give a week its two check-ins — an individual iRAT, then the team tRAT — and the grid fills in.`}
        action={
          currentWeekAct ? (
            <button className="t-btn primary" disabled={saving} onClick={() => onSeedWeek(currentWeekAct)}>
              {saving ? "Adding…" : `Add ${weekLabel(currentWeekAct)} iRAT + tRAT`}
            </button>
          ) : undefined
        }
      />
    );
  } else {
    const cell = (c: CheckIn, kind: SubjectKind, id: string) => {
      const isTeamRow = kind === "team";
      const matches = (c.kind === "team") === isTeamRow;
      if (!matches) {
        const why =
          c.kind === "team"
            ? "Team check-in — recorded on the team row"
            : "Individual check-in — recorded on each student row";
        return (
          <td className="t-td" key={c.id}>
            <div className="t-cell mismatch" title={why}>
              ·
            </div>
          </td>
        );
      }
      const vm = cellVM(c, resultMap.get(rkey(c.id, kind, id)), isTeamRow);
      const ring = open && open.checkInId === c.id && open.subjectId === id;
      return (
        <td className="t-td" key={c.id}>
          <button
            className={"t-cell" + (ring ? " ring" : "")}
            title={vm.title}
            style={{ color: vm.color, background: vm.bg }}
            onClick={() => openCell(c.id, kind, id)}
          >
            <span
              className={vm.pulse ? "t-pulse" : undefined}
              style={{ color: vm.glyphColor, fontSize: 13 }}
            >
              {vm.glyph}
            </span>
            {vm.num ? <span className="t-num">{vm.num}</span> : null}
          </button>
        </td>
      );
    };

    const totalCell = (t: { earned: number; possible: number; pct: number | null }) => (
      <td className="t-gbtot">
        {t.possible ? (
          <>
            <b>
              {t.earned}/{t.possible}
            </b>{" "}
            · {t.pct}%
          </>
        ) : (
          <span style={{ color: "var(--ink3)" }}>—</span>
        )}
      </td>
    );

    const rows: React.ReactNode[] = [];
    const tallyInd = tallyCols.ind;
    const tallyTeam = tallyCols.team;
    for (const t of teams) {
      const inCount = tallyInd
        ? t.members.filter(
            (m) => (resultMap.get(rkey(tallyInd.id, "student", m.id))?.status ?? "none") !== "none",
          ).length
        : 0;
      const teamPending = tallyTeam
        ? (resultMap.get(rkey(tallyTeam.id, "team", t.id))?.status ?? "none") === "none"
        : false;
      const behind = Boolean(tallyInd) && (inCount < t.members.length - 1 || teamPending);
      const isCollapsed = Boolean(collapsed[t.id]);
      rows.push(
        <tr className="t-rowteam" key={t.id}>
          <th scope="row" className="t-gbname">
            <div className="t-namecell">
              <button
                className="t-caret"
                title={isCollapsed ? "Show members" : "Hide members"}
                onClick={() => setCollapsed((c) => ({ ...c, [t.id]: !c[t.id] }))}
              >
                <Icon name={isCollapsed ? "chevright" : "chevdown"} size={18} />
              </button>
              <span style={{ whiteSpace: "nowrap" }}>{t.name}</span>
              <span className="t-spacer" />
              <span
                className="t-num"
                title={
                  tallyInd
                    ? `${inCount} of ${t.members.length} in on ${tallyInd.label}`
                    : "No individual check-in for this week yet"
                }
                style={{
                  fontSize: 11,
                  color: behind ? "var(--amber)" : "var(--ink2)",
                  whiteSpace: "nowrap",
                }}
              >
                {inCount}/{t.members.length} in{behind ? "  ⚠" : ""}
              </span>
            </div>
          </th>
          {columns.map(({ checkIn: c }) => cell(c, "team", t.id))}
          {totalCell(teamTotal(t.id))}
        </tr>,
      );
      if (!isCollapsed) {
        for (const m of t.members) {
          rows.push(
            <tr className="t-rowstu" key={m.id}>
              <th scope="row" className="t-gbname">
                <div className="t-namecell">
                  <Avatar name={m.name} tint={m.avatar_tint} size={20} />
                  <span style={{ whiteSpace: "nowrap" }}>{m.name}</span>
                </div>
              </th>
              {columns.map(({ checkIn: c }) => cell(c, "student", m.id))}
              {totalCell(studentTotal(m))}
            </tr>,
          );
        }
      }
    }
    for (const m of unassigned) {
      rows.push(
        <tr className="t-rowstu unassigned" key={m.id}>
          <th scope="row" className="t-gbname">
            <div className="t-namecell">
              <Avatar name={m.name} tint={m.avatar_tint} size={20} />
              <span style={{ whiteSpace: "nowrap" }}>{m.name}</span>
              <span className="t-spacer" />
              <span style={{ fontSize: 11, color: "var(--amber)" }}>unassigned</span>
            </div>
          </th>
          {columns.map(({ checkIn: c }) => cell(c, "student", m.id))}
          {totalCell(studentTotal(m))}
        </tr>,
      );
    }

    body = (
      <>
        {!teams.length && columns.some((c) => c.checkIn.kind === "team") ? (
          <div className="t-warn" style={{ marginTop: 0, marginBottom: 10 }}>
            Team check-ins have nowhere to land yet — form teams in Roster and the tRAT rows appear
            here.
          </div>
        ) : null}
        <div className="t-gbwrap" ref={wrapRef}>
          <table className="t-gb">
            <thead>
              <tr>
                <th className="t-gbname hdr">Student / team</th>
                {groups.map((g) => {
                  const lift = weekLift(g.activity.id);
                  const meta = [g.activity.topic, g.activity.dates_label]
                    .filter(Boolean)
                    .join(" · ");
                  return (
                    <th className="t-grp" colSpan={g.span} data-wk={g.activity.id} key={g.activity.id}>
                      <button
                        title="Bring this week to the left edge"
                        onClick={() => jumpToWeek(g.activity.id)}
                      >
                        {weekLabel(g.activity)}
                      </button>
                      {meta ? <span className="meta">{meta}</span> : null}
                      {lift ? (
                        <span
                          className="t-lift"
                          style={{ color: lift.d >= 0 ? "var(--green)" : "var(--amber)" }}
                        >
                          iRAT {lift.ip}% → tRAT {lift.tp}% · {lift.d >= 0 ? "+" : ""}
                          {lift.d}
                        </span>
                      ) : null}
                    </th>
                  );
                })}
                <th className="t-gbtot hdr" rowSpan={2}>
                  Term total
                </th>
              </tr>
              <tr>
                <th className="t-gbname hdr" />
                {columns.map(({ checkIn: c, activity: a }) => {
                  let chipText = "";
                  let chipKind = "";
                  if (a.posted || c.posted) {
                    chipText = "Posted";
                    chipKind = "green";
                  } else if (c.kind === "team" && a.stage === 2) {
                    chipText = "Stage: Discuss";
                    chipKind = "amber";
                  } else if (c.kind === "individual" && a.stage === 1) {
                    chipText = "Stage: Individual";
                    chipKind = "amber";
                  }
                  const firstId =
                    c.kind === "team" ? teams[0]?.id : studentOrder[0]?.id;
                  return (
                    <th className="t-th" key={c.id}>
                      <button
                        title={
                          firstId
                            ? "Score this column from the top"
                            : c.kind === "team"
                              ? "No teams yet"
                              : "No students yet"
                        }
                        onClick={() =>
                          firstId && openCell(c.id, c.kind === "team" ? "team" : "student", firstId)
                        }
                      >
                        {c.label}
                      </button>
                      <div className="meta">{columnMeta(c)}</div>
                      {chipText ? (
                        <span className={"t-chip " + chipKind} style={{ marginTop: 4 }}>
                          {chipText}
                        </span>
                      ) : null}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>{rows}</tbody>
          </table>
        </div>
      </>
    );
  }

  /* ---------- cell scorer panel ---------- */
  const submittedLines = (openResult?.text ?? "").split("\n").filter((l) => l.trim().length > 0);

  const panel =
    open && openCol && openAct ? (
      <div className={narrow ? "t-narrow" : undefined}>
        <aside className="t-panel">
          <div className="t-panelhead">
            <div style={{ minWidth: 0, flex: 1 }}>
              <div
                style={{
                  fontFamily: "var(--serif)",
                  fontSize: 17,
                  fontWeight: 700,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {openSubjectName}
              </div>
              <div style={{ fontSize: 11.5, color: "var(--ink2)", marginTop: 2 }}>
                {openCol.label} · {openAct.title}
                {open.subjectKind === "team" ? " · team identity" : " · student identity"}
              </div>
            </div>
            <button
              className="t-btn ghost"
              style={{ border: "1px solid var(--line)", padding: "2px 8px" }}
              onClick={() => setOpen(null)}
            >
              ✕
            </button>
          </div>
          <div className="t-panelbody">
            <div className="t-kicker" style={{ marginBottom: 7 }}>
              {open.subjectKind === "team"
                ? "Round 2 · team submission"
                : "Round 1 · individual submission"}{" "}
              · submitted work
            </div>
            {submittedLines.length ? (
              <>
                <div
                  className="t-scan"
                  style={{ maxHeight: 150 }}
                  title="Click to enlarge"
                  onClick={() =>
                    setModal({
                      caption: `${openSubjectName} · ${openCol.label} · ${open.subjectKind === "team" ? "Round 2" : "Round 1"}`,
                      lines: submittedLines,
                    })
                  }
                >
                  {submittedLines.map((l, i) => (
                    <div className="t-scanline" key={i}>
                      {l}
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 11.5, color: "var(--ink3)", marginTop: 6 }}>
                  submitted text · click to enlarge
                </div>
              </>
            ) : (
              <div className="t-dz" style={{ cursor: "default" }}>
                <div style={{ fontSize: 12.5, color: "var(--ink2)" }}>
                  Nothing submitted for this cell yet. You can still record a score, mark it for
                  review, or leave it for the student.
                </div>
              </div>
            )}
            <div
              style={{
                marginTop: 13,
                border: "1px solid var(--line)",
                background: "var(--paper)",
                borderRadius: 10,
                padding: 11,
              }}
            >
              <div className="t-kicker" style={{ marginBottom: 6 }}>
                AI transcription
              </div>
              {openResult?.transcription ? (
                <div style={{ fontSize: 13, lineHeight: 1.55 }}>
                  <span className={openResult.flagged ? "t-flag" : undefined}>
                    {openResult.transcription}
                  </span>
                  <div style={{ fontSize: 11, color: "var(--ink3)", marginTop: 6 }}>
                    {openResult.transcription_state === "confirmed"
                      ? "Confirmed by you — confirming a transcription is not grading."
                      : "Auto transcription — confirming it is a separate step from grading."}
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: 13, color: "var(--ink3)" }}>
                  No transcription on file for this submission.
                </div>
              )}
            </div>
            <div
              style={{
                marginTop: 13,
                display: "flex",
                gap: 9,
                alignItems: "end",
                flexWrap: "wrap",
              }}
            >
              <label className="t-fld">
                Score
                <input
                  className="t-in t-num"
                  style={{ width: 88, padding: "6px 8px", fontSize: 15 }}
                  value={panelScore}
                  disabled={openCol.scale === "ci"}
                  onChange={(e) => setPanelScore(e.target.value)}
                />
              </label>
              <span style={{ fontSize: 12, color: "var(--ink2)", paddingBottom: 7 }}>
                {scaleNote(openCol)}
              </span>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
              <button
                className="t-btn green"
                disabled={saving}
                onClick={() => void markComplete(open, openCol)}
              >
                ✓ Mark complete
              </button>
              <button
                className="t-btn amber"
                disabled={saving}
                onClick={() => void markNeedsReview(open)}
              >
                ⚑ Needs review
              </button>
              <button
                className="t-btn primary"
                disabled={saving}
                onClick={() => void saveAndNext(open, openCol)}
              >
                {saving ? "Saving…" : "Save & next ↓"}
              </button>
            </div>
            <div style={{ fontSize: 11.5, color: "var(--ink2)", marginTop: 10 }}>
              Save &amp; next → {nextName ?? "top of column"}, same column. You never leave the grid.
            </div>
          </div>
        </aside>
      </div>
    ) : null;

  const modalNode = modal ? (
    <div className="t-modalback" onClick={() => setModal(null)}>
      <div className="t-modal" onClick={(e) => e.stopPropagation()}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            padding: "10px 13px",
            borderBottom: "1px solid var(--line)",
          }}
        >
          <span style={{ fontSize: 12.5, color: "var(--ink2)", flex: 1, minWidth: 0 }}>
            {modal.caption}
          </span>
          <button
            className="t-btn ghost"
            style={{ border: "1px solid var(--line)", padding: "2px 8px" }}
            onClick={() => setModal(null)}
          >
            ✕
          </button>
        </div>
        <div
          style={{
            padding: 20,
            background:
              "repeating-linear-gradient(var(--paper2) 0px,var(--paper2) 37px,var(--line2) 37px,var(--line2) 38px)",
          }}
        >
          {modal.lines.map((l, i) => (
            <div
              key={i}
              style={{ fontFamily: "var(--hand)", fontSize: 25, lineHeight: "38px", color: "var(--ink)" }}
            >
              {l}
            </div>
          ))}
        </div>
      </div>
    </div>
  ) : null;

  return (
    <section>
      <ErrorBanner error={error} />
      {header}
      {loopBar}
      {legend}
      {addForm}
      {body}
      {panel}
      {modalNode}
    </section>
  );
}
