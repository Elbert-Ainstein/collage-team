"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import {
  createActivity,
  createCheckIn,
  listCheckIns,
  listResultsFull as listResults,
  listTeamSets,
  listTeams,
  saveResult,
  setCheckInsPosted,
  updateActivity,
} from "./data";
import type {
  Activity,
  CheckIn,
  CheckInResult,
  ResultStatus,
  Student,
  TeamSet,
  TeamWithMembers,
} from "./types";
import { Avatar, EmptyState, ErrorBanner, weekLabel } from "./ui";
import type { PillarProps } from "./ui";

/* ---------------- constants + tiny helpers ---------------- */

const STAGES = ["Setup", "Individual", "Discuss", "Resubmit", "Closed"];
const IN_STATUSES: ResultStatus[] = ["submitted", "scored", "needs_review"];

type ChipKind = "" | "blue" | "amber" | "green" | "purple";
type Lens = "faculty" | "student";
type FacultyTab = "source" | "submission" | "discussion" | "progress";
type Mode = Activity["resubmit_mode"];

function isIn(r: CheckInResult | null): boolean {
  return r != null && IN_STATUSES.indexOf(r.status) >= 0;
}
function started(r: CheckInResult | null): boolean {
  return r != null && r.status !== "none";
}
function fmtDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
function headline(a: Activity): string {
  return a.week != null ? `${weekLabel(a)} · ${a.title}` : a.title;
}
function paras(text: string | null): string[] {
  if (!text || !text.trim()) return [];
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}
function pct(n: number, d: number): number {
  return d > 0 ? Math.round((n / d) * 100) : 0;
}
function glyphFor(r: CheckInResult | null): { g: string; color: string; label: string } {
  if (!r || r.status === "none") return { g: "—", color: "var(--ink3)", label: "not started" };
  if (r.status === "scored") return { g: "✓", color: "var(--green)", label: "scored" };
  if (r.status === "needs_review") return { g: "⚑", color: "var(--amber)", label: "needs review" };
  if (r.status === "submitted") return { g: "●", color: "var(--blue)", label: "submitted" };
  if (r.status === "discussing") return { g: "··", color: "var(--amber)", label: "discussing" };
  if (r.status === "excused") return { g: "–", color: "var(--ink3)", label: "excused" };
  return { g: "··", color: "var(--ink3)", label: "draft" };
}
function r2ChipFor(r: CheckInResult | null): { text: string; kind: ChipKind } {
  if (!r || r.status === "none") return { text: "Not submitted ··", kind: "" };
  if (r.status === "scored") return { text: "Submitted ✓", kind: "green" };
  if (r.status === "needs_review") return { text: "Needs review ⚑", kind: "amber" };
  if (r.status === "discussing") return { text: "Discussing…", kind: "amber" };
  if (r.status === "submitted") return { text: "Submitted ●", kind: "blue" };
  return { text: "Draft ··", kind: "" };
}

function Chip({ text, kind }: { text: string; kind?: ChipKind }) {
  return <span className={"t-chip" + (kind ? " " + kind : "")}>{text}</span>;
}

function StageBar({
  stage,
  onPick,
  busy,
}: {
  stage: number;
  onPick: (i: number) => void;
  busy: boolean;
}) {
  return (
    <div className="t-stagebar">
      {STAGES.map((label, i) => (
        <button
          key={label}
          type="button"
          className={"t-seg " + (i < stage ? "done" : i === stage ? "cur" : "todo")}
          style={{
            fontFamily: "inherit",
            cursor: busy ? "progress" : "pointer",
            background: i > stage ? "transparent" : undefined,
          }}
          disabled={busy}
          title={`Move this week to “${label}”`}
          onClick={() => onPick(i)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

const TH: React.CSSProperties = {
  textAlign: "left",
  padding: "7px 11px",
  borderBottom: "1px solid var(--line)",
  fontSize: 10.5,
  letterSpacing: ".09em",
  textTransform: "uppercase",
  color: "var(--ink3)",
  fontWeight: 500,
};
const TD: React.CSSProperties = {
  padding: "7px 11px",
  borderBottom: "1px solid var(--line2)",
};

/* ---------------- the pillar ---------------- */

export function ActivitiesPillar({ courseId, roster, activities, refresh }: PillarProps) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // pillar-owned data
  const [checkIns, setCheckIns] = useState<CheckIn[]>([]);
  const [results, setResults] = useState<CheckInResult[]>([]);
  const [teamSets, setTeamSets] = useState<TeamSet[]>([]);
  const [teamsBySet, setTeamsBySet] = useState<Record<string, TeamWithMembers[]>>({});

  // navigation
  const [openId, setOpenId] = useState<string | null>(null);
  const [lens, setLens] = useState<Lens>("faculty");
  const [tab, setTab] = useState<FacultyTab>("source");

  // optimistic overlays
  const [pendingStage, setPendingStage] = useState<Record<string, number>>({});
  const [pendingPosted, setPendingPosted] = useState<Record<string, boolean>>({});

  // new-activity form
  const [newOpen, setNewOpen] = useState(false);
  const [fWeek, setFWeek] = useState("1");
  const [fTitle, setFTitle] = useState("");
  const [fTopic, setFTopic] = useState("");
  const [fDates, setFDates] = useState("");
  const [fMode, setFMode] = useState<Mode>("team");
  const [fCadence, setFCadence] = useState(true);

  // source editor
  const [sourceDraft, setSourceDraft] = useState<string | null>(null);

  // student lens
  const [asId, setAsId] = useState<string>("");
  const [step, setStep] = useState(1);
  const [r1Draft, setR1Draft] = useState<string | null>(null);
  const [r1File, setR1File] = useState<string>("");
  const [r2Draft, setR2Draft] = useState<string | null>(null);
  const [fork, setFork] = useState<"team" | "own" | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  /* ---------- load ---------- */
  // Key on ids, not array identity, so a parent that rebuilds these arrays on
  // every render cannot spin this effect.
  const activityIdsKey = activities.map((a) => a.id).join(",");
  const rosterIdsKey = roster.map((s) => s.id).join(",");
  const rosterRef = useRef<Student[]>(roster);
  rosterRef.current = roster;

  const load = useCallback(async () => {
    const ids = activityIdsKey ? activityIdsKey.split(",") : [];
    const cis = await listCheckIns(ids);
    const res = await listResults(cis.map((c) => c.id));
    const sets = await listTeamSets(courseId);
    const map: Record<string, TeamWithMembers[]> = {};
    for (const s of sets) map[s.id] = await listTeams(s.id, rosterRef.current);
    setCheckIns(cis);
    setResults(res);
    setTeamSets(sets);
    setTeamsBySet(map);
  }, [courseId, activityIdsKey, rosterIdsKey]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    load()
      .catch((e: unknown) => {
        if (alive) setError(String((e as Error)?.message ?? e));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [load]);

  // keep the "preview as" student valid
  useEffect(() => {
    setAsId((prev) => (roster.some((s) => s.id === prev) ? prev : (roster[0]?.id ?? "")));
  }, [roster]);

  /* ---------- derived ---------- */
  const activity = activities.find((a) => a.id === openId) ?? null;

  const stageOf = (a: Activity): number => pendingStage[a.id] ?? a.stage;
  const postedOf = (a: Activity): boolean => pendingPosted[a.id] ?? a.posted;

  const checkInsOf = (activityId: string): CheckIn[] =>
    checkIns.filter((c) => c.activity_id === activityId);
  const iColOf = (activityId: string): CheckIn | null =>
    checkInsOf(activityId).find((c) => c.kind === "individual") ?? null;
  const tColOf = (activityId: string): CheckIn | null =>
    checkInsOf(activityId).find((c) => c.kind === "team") ?? null;

  const setForActivity = (a: Activity): TeamSet | null =>
    teamSets.find((s) => s.activity_id === a.id) ??
    teamSets.find((s) => s.activity_id === null) ??
    teamSets[0] ??
    null;
  const teamsFor = (a: Activity): TeamWithMembers[] => {
    const s = setForActivity(a);
    return s ? (teamsBySet[s.id] ?? []) : [];
  };

  const resultFor = (
    col: CheckIn | null,
    kind: "student" | "team",
    id: string | null | undefined,
  ): CheckInResult | null => {
    if (!col || !id) return null;
    return (
      results.find(
        (r) =>
          r.check_in_id === col.id &&
          r.subject_type === kind &&
          (kind === "student" ? r.student_id : r.team_id) === id,
      ) ?? null
    );
  };

  const r1CountOf = (a: Activity): number => {
    const col = iColOf(a.id);
    return roster.filter((s) => isIn(resultFor(col, "student", s.id))).length;
  };
  const r2CountOf = (a: Activity): number => {
    const col = tColOf(a.id);
    if (a.resubmit_mode === "individual") {
      return roster.filter((s) => isIn(resultFor(col, "student", s.id))).length;
    }
    return teamsFor(a).filter((t) => isIn(resultFor(col, "team", t.id))).length;
  };
  const r2DenomOf = (a: Activity): number =>
    a.resubmit_mode === "individual" ? roster.length : teamsFor(a).length;

  const chipsFor = (a: Activity): { text: string; kind: ChipKind }[] => {
    const out: { text: string; kind: ChipKind }[] = [];
    if (a.dates_label) out.push({ text: a.dates_label, kind: "" });
    const opens = fmtDate(a.opens_at);
    if (opens) out.push({ text: `Opens ${opens}`, kind: "" });
    const ind = fmtDate(a.individual_due_at);
    if (ind) out.push({ text: `Individual due ${ind}`, kind: "amber" });
    const team = fmtDate(a.team_due_at);
    if (team) out.push({ text: `Team due ${team}`, kind: "" });
    if (!out.length) out.push({ text: stageOf(a) === 0 ? "Not published" : "No dates set", kind: "" });
    return out;
  };

  const nextWeek = (): number => {
    const weeks = activities.map((a) => a.week ?? 0);
    return (weeks.length ? Math.max(...weeks) : 0) + 1;
  };

  /* ---------- mutations ---------- */
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e: unknown) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const setStage = (a: Activity, i: number) => {
    if (i === stageOf(a)) return;
    setPendingStage((p) => ({ ...p, [a.id]: i })); // optimistic
    void run(async () => {
      await updateActivity(a.id, { stage: i });
      await refresh();
    }).then(() => setPendingStage((p) => {
      const next = { ...p };
      delete next[a.id];
      return next;
    }));
  };

  const openWorkspace = (id: string) => {
    setOpenId(id);
    setLens("faculty");
    setTab("source");
    setStep(1);
    setSourceDraft(null);
    setR1Draft(null);
    setR2Draft(null);
    setR1File("");
    setFork(null);
  };

  const startNew = () => {
    setFWeek(String(nextWeek()));
    setFTitle("");
    setFTopic("");
    setFDates("");
    setFMode("team");
    setFCadence(true);
    setNewOpen(true);
  };

  const submitNew = () =>
    run(async () => {
      const week = Number(fWeek);
      const a = await createActivity({
        courseId,
        week: Number.isFinite(week) && week > 0 ? week : nextWeek(),
        title: fTitle.trim(),
        topic: fTopic.trim(),
        datesLabel: fDates.trim(),
        resubmitMode: fMode,
      });
      if (fCadence) {
        await createCheckIn({
          activityId: a.id,
          label: "iRAT",
          kind: "individual",
          phase: "Readiness",
          scale: "points",
          maxPoints: 10,
          position: 0,
        });
        await createCheckIn({
          activityId: a.id,
          label: "tRAT",
          kind: "team",
          phase: "Readiness",
          scale: "points",
          maxPoints: 15,
          position: 1,
        });
      }
      setNewOpen(false);
      openWorkspace(a.id);
      await refresh(); // the id list changes → the load effect re-runs on its own
    });

  const addCadence = (a: Activity) =>
    run(async () => {
      if (!iColOf(a.id)) {
        await createCheckIn({
          activityId: a.id,
          label: "iRAT",
          kind: "individual",
          phase: "Readiness",
          scale: "points",
          maxPoints: 10,
          position: 0,
        });
      }
      if (!tColOf(a.id)) {
        await createCheckIn({
          activityId: a.id,
          label: "tRAT",
          kind: "team",
          phase: "Readiness",
          scale: "points",
          maxPoints: 15,
          position: 1,
        });
      }
      await load();
    });

  const saveSource = (a: Activity) =>
    run(async () => {
      const text = (sourceDraft ?? "").trim();
      await updateActivity(a.id, { source_text: text ? text : null });
      setSourceDraft(null);
      await refresh();
    });

  const togglePosted = (a: Activity, posted: boolean) => {
    const ids = checkInsOf(a.id).map((c) => c.id);
    setPendingPosted((p) => ({ ...p, [a.id]: posted })); // optimistic
    void run(async () => {
      await setCheckInsPosted(ids, posted);
      await updateActivity(a.id, { posted });
      await refresh();
      await load();
    }).then(() => setPendingPosted((p) => {
      const next = { ...p };
      delete next[a.id];
      return next;
    }));
  };

  const submitR1 = (a: Activity, me: Student, body: string) =>
    run(async () => {
      const col = iColOf(a.id);
      if (!col) throw new Error("This activity has no individual check-in yet.");
      await saveResult({
        checkInId: col.id,
        subject: { type: "student", id: me.id },
        status: "submitted",
        text: body,
      });
      setR1Draft(null);
      setR1File("");
      setStep(2);
      await load();
    });

  const submitR2 = (
    a: Activity,
    subject: { type: "student"; id: string } | { type: "team"; id: string },
    body: string,
  ) =>
    run(async () => {
      const col = tColOf(a.id);
      if (!col) throw new Error("This activity has no team check-in yet.");
      await saveResult({ checkInId: col.id, subject, status: "submitted", text: body });
      setR2Draft(null);
      await load();
    });

  /* ---------- render: shared bits ---------- */

  const banner = <ErrorBanner error={error} />;

  const noCheckIns = (a: Activity, what: string) => (
    <div className="t-card" style={{ padding: 14 }}>
      <div style={{ fontSize: 12.5, color: "var(--ink2)", marginBottom: 10, maxWidth: "60ch" }}>
        {what} This week has no check-in columns yet — the standard cadence is an individual iRAT
        out of 10 and a team tRAT out of 15.
      </div>
      <button className="t-btn primary" disabled={busy} onClick={() => void addCadence(a)}>
        Add iRAT + tRAT to {weekLabel(a)}
      </button>
    </div>
  );

  /* ---------- render: activity list ---------- */

  function activityList() {
    return (
      <section>
        <div className="t-row">
          <h1 className="t-h1">Activities</h1>
          <span className="t-sub">
            Each activity runs the loop once and owns its weekly check-in columns.
          </span>
          <span className="t-spacer" />
          <button className="t-btn primary" onClick={startNew} disabled={newOpen}>
            + New activity
          </button>
        </div>

        {banner}
        {newOpen && newActivityForm()}

        {loading ? (
          <div style={{ color: "var(--ink2)", fontSize: 13, padding: "18px 2px" }}>
            Loading activities…
          </div>
        ) : activities.length === 0 ? (
          !newOpen && (
            <EmptyState
              title="No activities yet"
              body="An activity is one week of the loop: students attempt it alone, discuss it in their team, then resubmit. Start with week 1 — you can add its iRAT and tRAT columns at the same time."
              action={
                <button className="t-btn primary" onClick={startNew}>
                  Create week 1
                </button>
              }
            />
          )
        ) : (
          <div className="t-grid t-cards3">
            {activities.map((a) => {
              const set = setForActivity(a);
              const teams = teamsFor(a);
              const r1 = r1CountOf(a);
              const r2 = r2CountOf(a);
              const denom = r2DenomOf(a);
              const counts2 =
                a.resubmit_mode === "individual"
                  ? `${r2}/${denom} individual resubmissions`
                  : `${r2}/${denom} team answers in`;
              return (
                <div className="t-card" key={a.id}>
                  <div style={{ display: "flex", gap: 2, marginBottom: 11 }}>
                    <StageBar stage={stageOf(a)} busy={busy} onPick={(i) => setStage(a, i)} />
                  </div>
                  <button
                    style={{
                      border: 0,
                      background: "transparent",
                      padding: 0,
                      textAlign: "left",
                      fontFamily: "var(--serif)",
                      fontSize: 19,
                      fontWeight: 700,
                      color: "var(--ink)",
                      letterSpacing: "-.015em",
                      cursor: "pointer",
                    }}
                    onClick={() => openWorkspace(a.id)}
                  >
                    {headline(a)}
                  </button>
                  {a.topic && (
                    <div style={{ fontSize: 12, color: "var(--ink2)", marginTop: 3 }}>{a.topic}</div>
                  )}
                  <div style={{ fontSize: 12, color: "var(--ink2)", marginTop: 4 }}>
                    {set
                      ? `${set.name || "Team set"} · ${teams.length} team${teams.length === 1 ? "" : "s"}${set.locked ? " · locked" : ""}`
                      : "No team set for this week yet"}
                  </div>
                  <div className="t-num" style={{ fontSize: 12.5, color: "var(--ink)", marginTop: 9 }}>
                    {r1}/{roster.length} individual attempts in
                  </div>
                  <div className="t-num" style={{ fontSize: 12, color: "var(--ink2)", marginTop: 2 }}>
                    {counts2}
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 11 }}>
                    {chipsFor(a).map((c) => (
                      <Chip key={c.text} text={c.text} kind={c.kind} />
                    ))}
                    {postedOf(a) && <Chip text="Posted" kind="green" />}
                  </div>
                  <div
                    style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center", flexWrap: "wrap" }}
                  >
                    <button className="t-btn line" onClick={() => openWorkspace(a.id)}>
                      Open workspace
                    </button>
                    <span style={{ fontSize: 11.5, color: "var(--ink3)" }}>
                      Round 2 mode: {a.resubmit_mode}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    );
  }

  function newActivityForm() {
    const modes: { id: Mode; label: string; note: string }[] = [
      { id: "team", label: "team", note: "one shared answer per team" },
      { id: "individual", label: "individual", note: "each student resubmits their own" },
      { id: "choice", label: "choice", note: "each student picks team or own" },
    ];
    const active = modes.find((m) => m.id === fMode);
    return (
      <div className="t-card" style={{ padding: 15, marginBottom: 14, maxWidth: 720 }}>
        <div className="t-kicker" style={{ marginBottom: 9 }}>
          New activity · one week of the loop
        </div>
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <label className="t-fld" style={{ width: 96 }}>
              Week
              <input
                className="t-in t-num"
                type="number"
                min={1}
                value={fWeek}
                onChange={(e) => setFWeek(e.target.value)}
              />
            </label>
            <label className="t-fld" style={{ flex: 2, minWidth: 220 }}>
              Title
              <input
                className="t-in"
                autoFocus
                value={fTitle}
                placeholder="e.g. Membrane Transport — Case 4"
                onChange={(e) => setFTitle(e.target.value)}
              />
            </label>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <label className="t-fld" style={{ flex: 1, minWidth: 180 }}>
              Topic
              <input
                className="t-in"
                value={fTopic}
                placeholder="e.g. Membrane Transport"
                onChange={(e) => setFTopic(e.target.value)}
              />
            </label>
            <label className="t-fld" style={{ flex: 1, minWidth: 180 }}>
              Dates label
              <input
                className="t-in"
                value={fDates}
                placeholder="e.g. Sep 2–6"
                onChange={(e) => setFDates(e.target.value)}
              />
            </label>
          </div>
          <div>
            <div className="t-kicker" style={{ marginBottom: 6 }}>
              Round 2 mode
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              {modes.map((m) => (
                <button
                  key={m.id}
                  className={"t-pill" + (fMode === m.id ? " on" : "")}
                  onClick={() => setFMode(m.id)}
                >
                  {m.label}
                </button>
              ))}
              <span style={{ fontSize: 11.5, color: "var(--ink3)" }}>{active ? active.note : ""}</span>
            </div>
          </div>
          <label
            style={{
              display: "flex",
              gap: 8,
              alignItems: "flex-start",
              fontSize: 12.5,
              color: "var(--ink2)",
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              className="t-selbox"
              style={{ marginTop: 2 }}
              checked={fCadence}
              onChange={(e) => setFCadence(e.target.checked)}
            />
            <span>
              Also create this week&rsquo;s two check-ins — <strong>iRAT</strong> (individual, out of
              10) and <strong>tRAT</strong> (team, out of 15). This is the standard cadence.
            </span>
          </label>
          <div style={{ display: "flex", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
            <button
              className="t-btn primary"
              disabled={!fTitle.trim() || busy}
              onClick={() => void submitNew()}
            >
              Create activity
            </button>
            <button
              className="t-btn ghost"
              style={{ border: "1px solid var(--line)" }}
              onClick={() => setNewOpen(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ---------- render: workspace ---------- */

  function workspace(a: Activity) {
    const posted = postedOf(a);
    return (
      <section>
        <div
          style={{
            border: "1px solid var(--line)",
            background: "var(--paper2)",
            borderRadius: 10,
            padding: 13,
            marginBottom: 12,
          }}
        >
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <button
              className="t-btn ghost"
              style={{ border: "1px solid var(--line)" }}
              onClick={() => setOpenId(null)}
            >
              ← Activities
            </button>
            <h1
              style={{
                margin: 0,
                fontFamily: "var(--serif)",
                fontSize: 22,
                fontWeight: 700,
                letterSpacing: "-.015em",
              }}
            >
              {headline(a)}
            </h1>
            {posted && <Chip text="Posted" kind="green" />}
            <span className="t-spacer" />
            <div className="t-lensbox">
              <button
                className={"t-lens" + (lens === "faculty" ? " on" : "")}
                onClick={() => setLens("faculty")}
              >
                View as faculty
              </button>
              <button
                className={"t-lens" + (lens === "student" ? " on" : "")}
                onClick={() => setLens("student")}
              >
                View as student
              </button>
            </div>
          </div>
          <div style={{ display: "flex", gap: 2, marginTop: 11, flexWrap: "wrap" }}>
            <StageBar stage={stageOf(a)} busy={busy} onPick={(i) => setStage(a, i)} />
          </div>
          <div style={{ fontSize: 11.5, color: "var(--ink2)", marginTop: 7 }}>
            Individual attempt → Team discussion → Resubmit · Round 2 mode: {a.resubmit_mode}
          </div>
        </div>
        {banner}
        {lens === "faculty" ? wsFaculty(a) : wsStudent(a)}
      </section>
    );
  }

  function wsFaculty(a: Activity) {
    const tabs: { id: FacultyTab; label: string }[] = [
      { id: "source", label: "Source" },
      { id: "submission", label: "Submission" },
      { id: "discussion", label: "Discussion" },
      { id: "progress", label: "Progress" },
    ];
    return (
      <>
        <nav className="t-tabs">
          {tabs.map((t) => (
            <button
              key={t.id}
              className={"t-tab" + (tab === t.id ? " on" : "")}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
        {tab === "source" && facSource(a)}
        {tab === "submission" && facSubmission(a)}
        {tab === "discussion" && facDiscussion(a)}
        {tab === "progress" && facProgress(a)}
      </>
    );
  }

  /* ---- Source ---- */
  function facSource(a: Activity) {
    const body = paras(a.source_text);
    const editing = sourceDraft !== null;
    return (
      <div className="t-grid t-autofit">
        <div className="t-card" style={{ padding: 15 }}>
          <div className="t-kicker" style={{ marginBottom: 8 }}>
            Source · read-only
          </div>
          <div
            style={{
              fontSize: 12,
              color: "var(--ink2)",
              marginBottom: 12,
              paddingBottom: 9,
              borderBottom: "1px solid var(--line2)",
            }}
          >
            The original upload is shown as-is.
          </div>
          <h2
            style={{
              margin: "0 0 9px",
              fontFamily: "var(--serif)",
              fontSize: 18,
              fontWeight: 700,
              letterSpacing: "-.01em",
            }}
          >
            {a.title}
          </h2>
          {body.length ? (
            body.map((p, i) => (
              <p
                key={i}
                style={{
                  margin: "0 0 9px",
                  fontSize: 13.5,
                  color: "var(--ink)",
                  maxWidth: "66ch",
                  whiteSpace: "pre-wrap",
                }}
              >
                {p}
              </p>
            ))
          ) : (
            <p style={{ margin: "0 0 9px", fontSize: 13, color: "var(--ink3)", maxWidth: "60ch" }}>
              No source yet. Paste the prompt, reading, or case body below — students see exactly this
              text in step 1.
            </p>
          )}

          <div style={{ marginTop: 12, borderTop: "1px solid var(--line2)", paddingTop: 11 }}>
            {editing ? (
              <>
                <textarea
                  className="t-in"
                  rows={7}
                  style={{ width: "100%", padding: 8, fontSize: 13, resize: "vertical" }}
                  value={sourceDraft ?? ""}
                  placeholder="Paste the activity brief. Leave a blank line between paragraphs."
                  onChange={(e) => setSourceDraft(e.target.value)}
                />
                <div style={{ display: "flex", gap: 8, marginTop: 9, flexWrap: "wrap" }}>
                  <button
                    className="t-btn primary"
                    disabled={busy}
                    onClick={() => void saveSource(a)}
                  >
                    Save source
                  </button>
                  <button
                    className="t-btn ghost"
                    style={{ border: "1px solid var(--line)" }}
                    onClick={() => setSourceDraft(null)}
                  >
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <button
                className="t-btn line"
                onClick={() => setSourceDraft(a.source_text ?? "")}
              >
                {a.source_text ? "Edit source text" : "Add source text"}
              </button>
            )}
          </div>
        </div>

        <div className="t-card" style={{ padding: 15 }}>
          <div className="t-kicker" style={{ marginBottom: 9 }}>
            Attached files
          </div>
          {a.files.length ? (
            a.files.map((f, i) => (
              <div
                key={f.name + i}
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "baseline",
                  padding: "7px 0",
                  borderBottom: "1px solid var(--line2)",
                  fontSize: 13,
                }}
              >
                <span style={{ color: "var(--ink3)" }}>
                  <Icon name="file" size={16} />
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>{f.name}</span>
                <span className="t-num" style={{ fontSize: 11.5, color: "var(--ink3)" }}>
                  {f.size ?? ""}
                </span>
              </div>
            ))
          ) : (
            <div style={{ fontSize: 12.5, color: "var(--ink3)", maxWidth: "50ch" }}>
              No files attached to this activity. v1 stores file names only — the source text above is
              what students read.
            </div>
          )}
        </div>
      </div>
    );
  }

  /* ---- Submission ---- */
  function facSubmission(a: Activity) {
    const iCol = iColOf(a.id);
    const tCol = tColOf(a.id);
    if (!iCol && !tCol) return noCheckIns(a, "Submissions land in check-in columns.");
    const teams = teamsFor(a);
    const r1 = r1CountOf(a);
    const r2 = r2CountOf(a);
    const denom = r2DenomOf(a);
    const flagged = roster.filter(
      (s) => resultFor(iCol, "student", s.id)?.status === "needs_review",
    ).length;
    const r2kind =
      a.resubmit_mode === "team"
        ? "team answer"
        : a.resubmit_mode === "individual"
          ? "individual resubmission"
          : "student's choice";
    const r2note =
      a.resubmit_mode === "team"
        ? "one shared answer per team"
        : "each identity is recorded separately";
    return (
      <>
        <div className="t-grid t-cards2" style={{ marginBottom: 14 }}>
          <div className="t-card" style={{ padding: 14 }}>
            <div className="t-kicker">Round 1 · individual attempt</div>
            <div
              className="t-num"
              style={{ fontFamily: "var(--serif)", fontSize: 30, fontWeight: 700, margin: "7px 0 2px" }}
            >
              {r1} / {roster.length}
            </div>
            <div style={{ fontSize: 12.5, color: "var(--ink2)" }}>
              individual attempts in · {flagged} flagged for review
            </div>
          </div>
          <div className="t-card" style={{ padding: 14 }}>
            <div className="t-kicker">Round 2 · {r2kind}</div>
            <div
              className="t-num"
              style={{ fontFamily: "var(--serif)", fontSize: 30, fontWeight: 700, margin: "7px 0 2px" }}
            >
              {r2} / {denom}
            </div>
            <div style={{ fontSize: 12.5, color: "var(--ink2)" }}>{r2note}</div>
          </div>
          <div className="t-card" style={{ padding: 14 }}>
            <div style={{ fontSize: 12.5, color: "var(--ink2)" }}>
              Faculty see what was submitted — per student and per team. Confirming a transcription is
              a separate step from grading.
            </div>
            <div style={{ fontSize: 11.5, color: "var(--ink3)", marginTop: 8 }}>
              {iCol ? `Round 1 column: ${iCol.label}` : "No individual column"} ·{" "}
              {tCol ? `Round 2 column: ${tCol.label}` : "No team column"}
            </div>
          </div>
        </div>

        <div className="t-kicker" style={{ margin: "0 0 7px" }}>
          Round 1 · per student
        </div>
        {roster.length === 0 ? (
          <div className="t-card" style={{ padding: 14, fontSize: 12.5, color: "var(--ink2)" }}>
            No students on the roster yet — add the roster first and Round 1 rows appear here.
          </div>
        ) : (
          <div className="t-card" style={{ padding: 0, overflowX: "auto", marginBottom: 16 }}>
            <table
              style={{ borderCollapse: "collapse", width: "100%", fontSize: 13, minWidth: 520 }}
            >
              <thead>
                <tr>
                  {["Student", "Round 1", "Score", "Submitted"].map((x) => (
                    <th key={x} style={TH}>
                      {x}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {roster.map((s) => {
                  const r = resultFor(iCol, "student", s.id);
                  const g = glyphFor(r);
                  return (
                    <tr key={s.id}>
                      <td style={TD}>
                        <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
                          <Avatar name={s.name} tint={s.avatar_tint} size={20} />
                          <span>{s.name}</span>
                        </span>
                      </td>
                      <td style={{ ...TD, color: g.color }}>
                        {g.g} {g.label}
                      </td>
                      <td className="t-num" style={TD}>
                        {r && r.score != null ? `${r.score}${iCol?.max_points != null ? ` / ${iCol.max_points}` : ""}` : "—"}
                      </td>
                      <td style={{ ...TD, color: "var(--ink2)", fontSize: 12.5 }}>
                        {isIn(r) && r ? fmtDate(r.updated_at) || "—" : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="t-kicker" style={{ margin: "0 0 7px" }}>
          Round 2 · per team
        </div>
        {teams.length === 0 ? (
          <div className="t-card" style={{ padding: 14, fontSize: 12.5, color: "var(--ink2)" }}>
            No teams for this week yet. Build the team set in Teams — Round 2 rows appear here once
            teams exist.
          </div>
        ) : (
          <div className="t-card" style={{ padding: 0, overflowX: "auto" }}>
            <table
              style={{ borderCollapse: "collapse", width: "100%", fontSize: 13, minWidth: 520 }}
            >
              <thead>
                <tr>
                  {["Team", "Round 1 in", "Round 2", "Members"].map((x) => (
                    <th key={x} style={TH}>
                      {x}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {teams.map((t) => {
                  const r1in = t.members.filter((m) =>
                    started(resultFor(iCol, "student", m.id)),
                  ).length;
                  const cell = r2ChipFor(resultFor(tCol, "team", t.id));
                  return (
                    <tr key={t.id}>
                      <td style={{ ...TD, fontWeight: 500 }}>{t.name}</td>
                      <td className="t-num" style={TD}>
                        {r1in} / {t.members.length}
                      </td>
                      <td style={TD}>
                        <Chip text={cell.text} kind={cell.kind} />
                      </td>
                      <td style={{ ...TD, color: "var(--ink2)", fontSize: 12.5 }}>
                        {t.members.map((m) => m.name.split(" ")[0]).join(", ") || "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </>
    );
  }

  /* ---- Discussion ---- */
  function facDiscussion(a: Activity) {
    const teams = teamsFor(a);
    const iCol = iColOf(a.id);
    const tCol = tColOf(a.id);
    return (
      <>
        <div
          style={{
            border: "1px solid var(--line)",
            background: "var(--paper3)",
            borderRadius: 10,
            padding: "10px 12px",
            fontSize: 12.5,
            color: "var(--ink2)",
            marginBottom: 13,
          }}
        >
          You see what each team{" "}
          <strong style={{ color: "var(--ink)", fontWeight: 600 }}>submitted</strong> in Round 2 —
          not their private working space. Faculty see what teams submit, not their working space:
          notes, files and chatter a team keeps while discussing are never surfaced here.
        </div>
        {teams.length === 0 ? (
          <EmptyState
            title="No teams for this week"
            body="The discussion step needs teams. Build this week's team set in Teams, then each team's Round 2 submission shows up here."
            action={null}
          />
        ) : (
          <div className="t-grid t-cards3">
            {teams.map((t) => {
              const r = resultFor(tCol, "team", t.id);
              const submitted = isIn(r);
              const status = submitted
                ? "Round 2 submitted"
                : r?.status === "discussing"
                  ? "Discussion in progress"
                  : "Nothing submitted";
              const kind: ChipKind = submitted ? "green" : r?.status === "discussing" ? "amber" : "";
              const r1in = t.members.filter((m) =>
                isIn(resultFor(iCol, "student", m.id)),
              ).length;
              return (
                <div className="t-card" key={t.id}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600 }}>{t.name}</span>
                    <span className="t-spacer" />
                    <Chip text={status} kind={kind} />
                  </div>
                  <div
                    style={{ marginTop: 10, borderTop: "1px solid var(--line2)", paddingTop: 9 }}
                  >
                    <div className="t-kicker" style={{ marginBottom: 5 }}>
                      Round 2 · submitted answer
                    </div>
                    <div
                      style={{
                        fontSize: 13,
                        color: submitted ? "var(--ink)" : "var(--ink3)",
                        maxWidth: "60ch",
                        whiteSpace: "pre-wrap",
                      }}
                    >
                      {submitted ? (r?.text?.trim() || "(submitted with no text)") : "— not submitted —"}
                    </div>
                    <div style={{ fontSize: 11.5, color: "var(--ink2)", marginTop: 6 }}>
                      {submitted && r
                        ? `Submitted on behalf of the team · Round 2 · ${fmtDate(r.updated_at) || "recorded"}`
                        : "Round 2 is still open for this team"}
                    </div>
                  </div>
                  <div
                    style={{ marginTop: 11, borderTop: "1px solid var(--line2)", paddingTop: 9 }}
                  >
                    <div className="t-kicker" style={{ marginBottom: 6 }}>
                      Discussion · metadata only
                    </div>
                    <div style={{ fontSize: 12, color: "var(--ink2)" }}>
                      {t.members.length} member{t.members.length === 1 ? "" : "s"} · {r1in} of{" "}
                      {t.members.length} brought a Round 1 attempt into the discussion
                    </div>
                    <div style={{ fontSize: 11.5, color: "var(--ink3)", marginTop: 5 }}>
                      The team&rsquo;s working resources stay in their space and are not shown to
                      faculty.
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </>
    );
  }

  /* ---- Progress ---- */
  function facProgress(a: Activity) {
    const iCol = iColOf(a.id);
    const tCol = tColOf(a.id);
    const teams = teamsFor(a);
    const r1 = r1CountOf(a);
    const r2 = r2CountOf(a);
    const denom = r2DenomOf(a);
    const discussing =
      a.resubmit_mode === "individual"
        ? roster.filter((s) => started(resultFor(tCol, "student", s.id))).length
        : teams.filter((t) => started(resultFor(tCol, "team", t.id))).length;
    const discussDenom = a.resubmit_mode === "individual" ? roster.length : teams.length;

    const funnel = [
      { label: "① Individual attempt", value: `${r1} / ${roster.length}`, p: pct(r1, roster.length) },
      {
        label: "② Team discussion started",
        value: `${discussing} / ${discussDenom}`,
        p: pct(discussing, discussDenom),
      },
      { label: "③ Resubmitted", value: `${r2} / ${denom}`, p: pct(r2, denom) },
    ];

    const posted = postedOf(a);
    const cols = checkInsOf(a.id);

    const unassigned = roster.filter((s) => !teams.some((t) => t.members.some((m) => m.id === s.id)));

    const studentRow = (s: Student, indent: number) => {
      const g = glyphFor(resultFor(iCol, "student", s.id));
      return (
        <div
          key={s.id}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: `5px 0 5px ${indent}px`,
            borderBottom: "1px solid var(--line2)",
            fontSize: 12.5,
          }}
        >
          <span style={{ width: 14, color: g.color }}>{g.g}</span>
          <span
            style={{
              flex: 1,
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {s.name}
          </span>
          <span style={{ fontSize: 11.5, color: "var(--ink2)", whiteSpace: "nowrap" }}>
            Round 1 · {g.label}
          </span>
        </div>
      );
    };

    return (
      <div className="t-grid t-autofit">
        <div className="t-card" style={{ padding: 14 }}>
          <div className="t-kicker" style={{ marginBottom: 11 }}>
            Loop funnel
          </div>
          {funnel.map((f) => (
            <div key={f.label} style={{ marginBottom: 11 }}>
              <div style={{ display: "flex", fontSize: 12.5, marginBottom: 4 }}>
                <span>{f.label}</span>
                <span className="t-spacer" />
                <span className="t-num" style={{ color: "var(--ink2)" }}>
                  {f.value}
                </span>
              </div>
              <div
                style={{
                  height: 7,
                  background: "var(--paper3)",
                  border: "1px solid var(--line2)",
                  borderRadius: 1,
                  overflow: "hidden",
                }}
              >
                <div style={{ height: "100%", width: `${f.p}%`, background: "var(--ink)" }} />
              </div>
            </div>
          ))}
        </div>

        <div className="t-card" style={{ padding: 14 }}>
          <div className="t-kicker" style={{ marginBottom: 9 }}>
            Who&rsquo;s done
          </div>
          {roster.length === 0 ? (
            <div style={{ fontSize: 12.5, color: "var(--ink2)" }}>
              No students yet — add the roster and this list fills in.
            </div>
          ) : (
            <>
              {teams.map((t) => {
                const tr = resultFor(tCol, "team", t.id);
                const done = isIn(tr);
                return (
                  <div key={t.id}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "5px 0",
                        borderBottom: "1px solid var(--line2)",
                        fontSize: 12.5,
                      }}
                    >
                      <span style={{ width: 14, color: done ? "var(--green)" : "var(--ink3)" }}>
                        {done ? "✓" : "··"}
                      </span>
                      <span style={{ flex: 1, fontWeight: 600 }}>{t.name}</span>
                      <span style={{ fontSize: 11.5, color: "var(--ink2)" }}>Round 2 · team</span>
                    </div>
                    {t.members.map((m) => studentRow(m, 16))}
                  </div>
                );
              })}
              {unassigned.length > 0 && (
                <>
                  {teams.length > 0 && (
                    <div
                      className="t-kicker"
                      style={{ marginTop: 9, marginBottom: 2 }}
                    >
                      Not on a team
                    </div>
                  )}
                  {unassigned.map((s) => studentRow(s, 0))}
                </>
              )}
            </>
          )}
        </div>

        <div className="t-card" style={{ padding: 14 }}>
          <div className="t-kicker" style={{ marginBottom: 8 }}>
            Post to gradebook
          </div>
          <div style={{ fontSize: 12.5, color: "var(--ink2)", marginBottom: 11 }}>
            Writes this activity&rsquo;s Round 1 and Round 2 scores into its check-in columns and
            marks the headers Posted.
          </div>
          {cols.length === 0 ? (
            <button className="t-btn primary" disabled={busy} onClick={() => void addCadence(a)}>
              Add iRAT + tRAT first
            </button>
          ) : (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <button
                className={posted ? "t-btn green" : "t-btn primary"}
                disabled={busy}
                onClick={() => togglePosted(a, true)}
              >
                {posted ? "✓ Posted to gradebook" : "Post check-ins to gradebook"}
              </button>
              {posted && (
                <button
                  className="t-btn ghost"
                  style={{ border: "1px solid var(--line)" }}
                  disabled={busy}
                  onClick={() => togglePosted(a, false)}
                >
                  Un-post
                </button>
              )}
            </div>
          )}
          <div style={{ fontSize: 11.5, color: "var(--ink2)", marginTop: 9 }}>
            {posted
              ? "Column headers in Check-ins now read Posted."
              : `Affects ${cols.length} column${cols.length === 1 ? "" : "s"} owned by this activity.`}
          </div>
        </div>
      </div>
    );
  }

  /* ---- Student lens ---- */
  function wsStudent(a: Activity) {
    const me = roster.find((s) => s.id === asId) ?? null;
    if (!me) {
      return (
        <EmptyState
          title="Nobody to preview as"
          body="The student lens shows one student's view of this week. Add the roster first, then pick a student to preview."
          action={null}
        />
      );
    }

    const iCol = iColOf(a.id);
    const tCol = tColOf(a.id);
    if (!iCol && !tCol) return noCheckIns(a, "The student view writes into check-in columns.");

    const teams = teamsFor(a);
    const myTeam = teams.find((t) => t.members.some((m) => m.id === me.id)) ?? null;
    const r1 = resultFor(iCol, "student", me.id);
    const r1done = isIn(r1);
    const mode = a.resubmit_mode;
    const teamR2 = resultFor(tCol, "team", myTeam?.id);
    const ownR2 = resultFor(tCol, "student", me.id);
    // An explicit pick wins; otherwise fall back to whatever already exists.
    const decidedFork: "team" | "own" | null =
      fork ?? (isIn(ownR2) ? "own" : isIn(teamR2) ? "team" : null);
    const asTeam = mode === "team" || (mode === "choice" && decidedFork === "team");
    const r2 = mode === "individual" ? ownR2 : asTeam ? teamR2 : ownR2;
    const r2done = isIn(r2);

    const pickStudent = (id: string) => {
      setAsId(id);
      setStep(1);
      setR1Draft(null);
      setR2Draft(null);
      setR1File("");
      setFork(null);
    };

    const steps = [
      {
        num: "1",
        label: "Your attempt",
        state: r1done ? "Submitted ✓ · Round 1" : "Draft · Round 1",
      },
      {
        num: "2",
        label: "Team discussion",
        state: r1done
          ? `Open · private to ${myTeam ? myTeam.name : "your team"}`
          : "Opens after Round 1",
      },
      {
        num: "3",
        label: mode === "team" ? "Team answer" : "Resubmit",
        state: r1done ? (r2done ? "Submitted ✓ · Round 2" : "Ready · Round 2") : "Locked",
      },
    ];

    const strip: { text: string; kind: ChipKind }[] = [];
    if (iCol) {
      strip.push({
        text: `${iCol.label} · Round 1 · ${r1done ? "submitted ●" : "draft —"}`,
        kind: r1done ? "blue" : "",
      });
    }
    if (tCol) {
      strip.push({
        text: `${tCol.label} · Round 2 · ${mode === "team" ? "team" : mode === "individual" ? "your own" : "your choice"}${r2done ? " · submitted ✓" : ""}`,
        kind: r2done ? "green" : "",
      });
    }

    return (
      <>
        <div
          style={{
            display: "flex",
            gap: 9,
            alignItems: "center",
            flexWrap: "wrap",
            border: "1px dashed var(--line)",
            background: "var(--paper3)",
            borderRadius: 10,
            padding: "8px 11px",
            marginBottom: 12,
          }}
        >
          <span className="t-kicker">Preview</span>
          <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5 }}>
            <span style={{ color: "var(--ink2)" }}>Previewing as</span>
            <select
              className="t-in"
              style={{ padding: "4px 6px", fontSize: 12.5 }}
              value={me.id}
              onChange={(e) => pickStudent(e.target.value)}
            >
              {roster.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <Avatar name={me.name} tint={me.avatar_tint} size={22} />
          <span style={{ fontSize: 11.5, color: "var(--ink3)", flex: 1, minWidth: 200 }}>
            There is no sign-in in v1 — this is a faculty preview of one student&rsquo;s view.
            Anything you submit here is written to the database under that student&rsquo;s name.
          </span>
        </div>

        <div style={{ display: "flex", gap: 9, flexWrap: "wrap", marginBottom: 14 }}>
          {steps.map((s, i) => {
            const locked = i > 0 && !r1done;
            return (
              <button
                key={s.num}
                className={
                  "t-stepcard" + (step === i + 1 ? " on" : "") + (locked ? " locked" : "")
                }
                onClick={() => {
                  if (locked) return;
                  setStep(i + 1);
                }}
                title={locked ? "Submit your own answer first to unlock the team step" : undefined}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className="t-lnum">{s.num}</span>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{s.label}</span>
                </span>
                <span style={{ fontSize: 11.5, color: "var(--ink2)" }}>{s.state}</span>
              </button>
            );
          })}
        </div>

        <div
          style={{
            border: "1px solid var(--line)",
            background: "var(--paper3)",
            borderRadius: 10,
            padding: "9px 11px",
            fontSize: 12,
            color: "var(--ink2)",
            marginBottom: 14,
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <span className="t-kicker">Your check-ins</span>
          {strip.map((c) => (
            <Chip key={c.text} text={c.text} kind={c.kind} />
          ))}
          <span style={{ fontSize: 11.5, color: "var(--ink3)" }}>
            Only your own row — peers&rsquo; scores are never shown to students.
          </span>
        </div>

        {step === 1 && stuStep1(a, me, iCol, r1, r1done)}
        {step === 2 && stuStep2(a, me, myTeam, iCol, r1done)}
        {step === 3 &&
          stuStep3(a, me, myTeam, mode, r1done, r2done, r2, asTeam, decidedFork)}
      </>
    );
  }

  function stuStep1(
    a: Activity,
    me: Student,
    iCol: CheckIn | null,
    r1: CheckInResult | null,
    r1done: boolean,
  ) {
    const body = paras(a.source_text);
    const text = r1Draft ?? r1?.text ?? "";
    const canSubmit = Boolean(iCol) && (text.trim().length > 0 || r1File.length > 0);
    const compose = () => {
      const parts = [text.trim()];
      if (r1File) {
        parts.push(`Attached: ${r1File} — file name recorded only; v1 does not upload the file.`);
      }
      return parts.filter(Boolean).join("\n\n");
    };
    return (
      <div className="t-card" style={{ padding: 14, marginBottom: 12 }}>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 9,
            flexWrap: "wrap",
            marginBottom: 11,
          }}
        >
          <span className="t-lnum">1</span>
          <h2 className="t-h2">
            Your attempt{" "}
            <span style={{ fontWeight: 400, color: "var(--ink2)", fontSize: 12.5 }}>
              · Round 1 · individual
            </span>
          </h2>
          <span className="t-spacer" />
          <Chip
            text={
              r1done
                ? "Submitted ✓ — editable until the deadline"
                : "Saved as draft — only you can see this."
            }
            kind={r1done ? "green" : ""}
          />
        </div>

        {!iCol && (
          <div className="t-warn" style={{ marginBottom: 11 }}>
            <span>⚑</span>
            <span>
              This week has no individual check-in column, so Round 1 has nowhere to land. Add the
              standard cadence from the Progress tab.
            </span>
          </div>
        )}

        <div
          className="t-grid"
          style={{
            gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))",
            alignItems: "start",
          }}
        >
          <div
            style={{
              border: "1px solid var(--line2)",
              background: "var(--paper)",
              borderRadius: 10,
              padding: 12,
            }}
          >
            <div className="t-kicker" style={{ marginBottom: 7 }}>
              Brief · read-only
            </div>
            <h3 style={{ margin: "0 0 8px", fontFamily: "var(--serif)", fontSize: 16, fontWeight: 700 }}>
              {a.title}
            </h3>
            {body.length ? (
              body.map((p, i) => (
                <p
                  key={i}
                  style={{
                    margin: "0 0 8px",
                    fontSize: 13,
                    color: "var(--ink2)",
                    maxWidth: "60ch",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {p}
                </p>
              ))
            ) : (
              <p style={{ margin: 0, fontSize: 13, color: "var(--ink3)" }}>
                Your instructor has not posted the brief for this week yet.
              </p>
            )}
          </div>

          <div>
            <input
              ref={fileRef}
              type="file"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) setR1File(f.name);
                e.target.value = "";
              }}
            />
            <div
              className="t-dz"
              style={{
                borderColor: r1File ? "var(--green)" : "var(--line)",
                background: r1File ? "var(--greenBg)" : "var(--paper)",
              }}
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const f = e.dataTransfer.files?.[0];
                if (f) setR1File(f.name);
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 3 }}>
                <Icon name="upload" size={15} /> Upload your answer
              </div>
              <div style={{ fontSize: 12, color: "var(--ink2)" }}>
                or take a photo of handwritten work
              </div>
              <div style={{ fontSize: 11.5, color: "var(--ink3)", marginTop: 7 }}>
                {r1File
                  ? `${r1File} — the file name is recorded with your answer; v1 does not upload the file itself.`
                  : "Picking a file records its name with your answer — v1 does not upload bytes."}
              </div>
            </div>
            <textarea
              className="t-in"
              rows={4}
              placeholder="…or type your answer"
              style={{ width: "100%", marginTop: 9, padding: 8, fontSize: 13, resize: "vertical" }}
              value={text}
              onChange={(e) => setR1Draft(e.target.value)}
            />
            <div
              style={{
                display: "flex",
                gap: 9,
                alignItems: "center",
                marginTop: 9,
                flexWrap: "wrap",
              }}
            >
              <button
                className={r1done ? "t-btn" : "t-btn primary"}
                style={r1done ? { borderColor: "var(--ink)" } : undefined}
                disabled={!canSubmit || busy}
                onClick={() => void submitR1(a, me, compose())}
              >
                {r1done ? "Update Round 1 submission" : "Submit Round 1"}
              </button>
              <span style={{ fontSize: 12, color: "var(--ink2)" }}>
                {r1done
                  ? "Your Round 1 attempt is recorded under your name only."
                  : "Draft — nobody else can see this yet."}
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  function stuStep2(
    a: Activity,
    me: Student,
    myTeam: TeamWithMembers | null,
    iCol: CheckIn | null,
    r1done: boolean,
  ) {
    const peers = myTeam ? myTeam.members : [];
    return (
      <div className="t-card" style={{ padding: 14, marginBottom: 12 }}>
        <div
          style={{ display: "flex", alignItems: "baseline", gap: 9, flexWrap: "wrap", marginBottom: 5 }}
        >
          <span className="t-lnum">2</span>
          <h2 className="t-h2">
            Team discussion{" "}
            <span style={{ fontWeight: 400, color: "var(--ink2)", fontSize: 12.5 }}>
              · {myTeam ? myTeam.name : "your team"} · private
            </span>
          </h2>
        </div>
        <div style={{ fontSize: 12, color: "var(--ink2)", marginBottom: 11 }}>
          These team resources stay private to your team — faculty see what you submit, not your
          working space.
        </div>

        {!myTeam ? (
          <div className="t-warn">
            <span>⚑</span>
            <span>
              {me.name.split(" ")[0]} is not on a team for {weekLabel(a)} yet. Ask your instructor to
              place you — Round 1 still counts on its own.
            </span>
          </div>
        ) : (
          <div
            className="t-grid"
            style={{ gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))" }}
          >
            {peers.map((p) => {
              const pr = resultFor(iCol, "student", p.id);
              const shared = r1done && isIn(pr);
              return (
                <div
                  key={p.id}
                  style={{
                    border: "1px solid var(--line2)",
                    background: "var(--paper)",
                    borderRadius: 10,
                    padding: 10,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                    <Avatar name={p.name} tint={p.avatar_tint} size={20} />
                    <span
                      style={{
                        fontSize: 12.5,
                        fontWeight: 500,
                        flex: 1,
                        minWidth: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {p.name}
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: shared ? "var(--ink2)" : "var(--ink3)",
                      maxWidth: "44ch",
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {!r1done
                      ? "Hidden until you submit Round 1."
                      : shared
                        ? (pr?.text?.trim() || "Submitted with no text.")
                        : "No Round 1 attempt yet."}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--ink3)", marginTop: 6 }}>
                    {r1done && shared
                      ? "Round 1 · individual · shared inside the team"
                      : "Round 1 · individual"}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  function stuStep3(
    a: Activity,
    me: Student,
    myTeam: TeamWithMembers | null,
    mode: Mode,
    r1done: boolean,
    r2done: boolean,
    r2: CheckInResult | null,
    asTeam: boolean,
    decidedFork: "team" | "own" | null,
  ) {
    const title =
      mode === "team"
        ? "Team answer · one shared submission"
        : mode === "choice"
          ? "Resubmit · team or your own"
          : "Resubmit your own answer";
    const note =
      mode === "team"
        ? `Any member uploads; it counts for everyone in ${myTeam ? myTeam.name : "the team"}.`
        : mode === "choice"
          ? "Choose how your Round 2 answer is counted. This choice is recorded with the submission."
          : "Each member resubmits individually; your Round 2 answer counts only for you.";
    const text = r2Draft ?? r2?.text ?? "";
    const needsTeam = asTeam && !myTeam;

    return (
      <div className="t-card" style={{ padding: 14, opacity: r1done ? 1 : 0.62 }}>
        <div
          style={{ display: "flex", alignItems: "baseline", gap: 9, flexWrap: "wrap", marginBottom: 5 }}
        >
          <span className="t-lnum">3</span>
          <h2 className="t-h2">{title}</h2>
          <span className="t-spacer" />
          <span style={{ fontSize: 11.5, color: "var(--ink2)" }}>Round 2</span>
        </div>
        <div style={{ fontSize: 12.5, color: "var(--ink2)", marginBottom: 11 }}>{note}</div>

        {!r1done ? (
          <div className="t-warn">
            <span>⚑</span>
            <span>Submit your own answer first to unlock the team step.</span>
          </div>
        ) : mode === "choice" && !decidedFork ? (
          <div className="t-grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}>
            <button
              style={{
                border: "1px solid var(--line)",
                background: "var(--paper)",
                borderRadius: 10,
                padding: 12,
                textAlign: "left",
                display: "block",
                cursor: "pointer",
                color: "var(--ink)",
              }}
              onClick={() => setFork("team")}
            >
              <span style={{ display: "block", fontSize: 13, fontWeight: 600 }}>Submit as team</span>
              <span style={{ display: "block", fontSize: 12, color: "var(--ink2)", marginTop: 4 }}>
                A team answer counts for everyone.
              </span>
            </button>
            <button
              style={{
                border: "1px solid var(--line)",
                background: "var(--paper)",
                borderRadius: 10,
                padding: 12,
                textAlign: "left",
                display: "block",
                cursor: "pointer",
                color: "var(--ink)",
              }}
              onClick={() => setFork("own")}
            >
              <span style={{ display: "block", fontSize: 13, fontWeight: 600 }}>
                Submit my own answer
              </span>
              <span style={{ display: "block", fontSize: 12, color: "var(--ink2)", marginTop: 4 }}>
                Your own answer counts only for you.
              </span>
            </button>
          </div>
        ) : needsTeam ? (
          <>
            <div className="t-warn">
              <span>⚑</span>
              <span>
                A team answer needs a team. {me.name.split(" ")[0]} is not placed in{" "}
                {weekLabel(a)}&rsquo;s team set yet
                {mode === "choice" ? " — you can submit your own answer instead." : "."}
              </span>
            </div>
            {mode === "choice" && (
              <button className="t-btn line" style={{ marginTop: 9 }} onClick={() => setFork("own")}>
                Submit my own answer instead
              </button>
            )}
          </>
        ) : (
          <>
            <textarea
              className="t-in"
              rows={3}
              placeholder={asTeam ? "Your team's Round 2 answer" : "Your own Round 2 answer"}
              style={{ width: "100%", padding: 8, fontSize: 13, resize: "vertical" }}
              value={text}
              onChange={(e) => setR2Draft(e.target.value)}
            />
            <div
              style={{ display: "flex", gap: 9, alignItems: "center", marginTop: 9, flexWrap: "wrap" }}
            >
              <button
                className={r2done ? "t-btn green" : "t-btn primary"}
                disabled={busy || !text.trim()}
                onClick={() =>
                  void submitR2(
                    a,
                    asTeam && myTeam
                      ? { type: "team", id: myTeam.id }
                      : { type: "student", id: me.id },
                    text.trim(),
                  )
                }
              >
                {r2done
                  ? "Submitted ✓ — update Round 2"
                  : asTeam
                    ? "Submit team answer"
                    : "Submit my own answer"}
              </button>
              <span style={{ fontSize: 12, color: "var(--ink2)" }}>
                {r2done && r2
                  ? asTeam
                    ? `Recorded on behalf of ${myTeam ? myTeam.name : "the team"} · Round 2 · team identity`
                    : "Round 2 · individual identity — counts only for you"
                  : asTeam
                    ? "A team answer counts for everyone."
                    : "Your own answer counts only for you."}
              </span>
              {mode === "choice" && !r2done && (
                <button className="t-btn ghost" style={{ border: "1px solid var(--line)" }} onClick={() => setFork(null)}>
                  Change choice
                </button>
              )}
            </div>
          </>
        )}
      </div>
    );
  }

  return activity ? workspace(activity) : activityList();
}
