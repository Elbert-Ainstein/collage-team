"use client";

// A live-questions activity, opened the way every activity opens: back to
// Activities, the Individual | Team switch, what it is on the left and who has
// done it on the right. The Team half is where it runs in class — Start team
// mode, watch the teams, Close and score.

import { useEffect, useState } from "react";
import { BriefText } from "@/checkins/BriefText";
import { deleteActivity, updateActivity } from "@/checkins/data";
import { HIDDEN_INSTANT, type Activity, type Student } from "@/checkins/types";
import { isOpenToStudents } from "@/checkins/studentData";
import { remove as removeObjects } from "@/checkins/storage";
import { closeLive, loadLive, printOldKeys, scoreLive, startTeamMode } from "@/live/data";
import { mmss, type LiveModel } from "@/live/model";
import type { LivePhase } from "@/live/types";
import { Av, Ic, LiveDot } from "@/live/ui";
import { ConfirmDialog } from "../ConfirmDialog";
import { linkToActivity, type FacultyData } from "../FacultyApp";
import { QuestionsView, StudentDetail, StudentQuestion, StudentsView, TeamDetail, TeamResults, TeamsLive } from "./LiveViews";
import { exportTeamCsv } from "./exportCsv";

type Half = "indiv" | "team";
type Tab = "questions" | "teams" | "students";
type Drill =
  | { kind: "team"; id: string }
  | { kind: "student"; id: string; via: "team" | "students" | "indiv" }
  | { kind: "question"; id: string; via: "team" | "students" | "indiv"; q: number }
  | null;

const DEFAULT_TAB: Record<LivePhase, Tab> = { individual: "questions", team: "teams", closed: "teams" };

interface Props {
  data: FacultyData;
  activity: Activity;
  m: LiveModel;
  justPublished: boolean;
  onDismissPublished: () => void;
  onBack: () => void;
  onEdit: () => void;
  /** Title, week, due date and description: the builder's first step. */
  onEditDetails: () => void;
  /** Re-read this activity's live rows now (a move here shouldn't wait for realtime). */
  reload: () => Promise<void>;
  /** Re-read the course: titles, visibility, the gradebook. */
  onChanged: () => void | Promise<void>;
  onError: (e: unknown) => void;
}

function fmtDue(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function LivePage(props: Props) {
  const { activity, m, onBack } = props;
  const [half, setHalf] = useState<Half>(m.state.phase === "individual" ? "indiv" : "team");
  const [copied, setCopied] = useState(false);
  const started = m.state.team_started_at ? Date.parse(m.state.team_started_at) : null;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (m.state.phase !== "team") return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [m.state.phase]);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(linkToActivity(activity.id, activity.course_id));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch (e) {
      props.onError(e);
    }
  };

  return (
    <div className="fv-panel lq-panel">
      <div className="fv-topbar">
        <button type="button" className="fv-back" aria-label="Back to Activities" onClick={onBack}>
          <Ic name="chevronLeft" size={16} />
        </button>
        <span className="fv-sub">{activity.week === null ? "Live questions" : `Week ${activity.week} · Live questions`}</span>
        <span style={{ flex: 1 }} />
        {m.state.phase === "team" && started !== null ? (
          <span className="lq-clock team" title="Time since team mode started">
            <LiveDot tone="team" />
            <span className="fv-num">{mmss((now - started) / 1000)}</span>
          </span>
        ) : null}
        <button type="button" className="fv-btn ghost sm" onClick={() => void copyLink()}>
          <Ic name="copy" size={15} /> {copied ? "Copied" : "Copy link"}
        </button>
      </div>

      <div className="fv-seg lq-halfseg">
        <button type="button" className={half === "indiv" ? "on" : ""} onClick={() => setHalf("indiv")}>
          Individual
        </button>
        <button type="button" className={half === "team" ? "on" : ""} onClick={() => setHalf("team")}>
          Team
          {m.state.phase === "team" ? <LiveDot tone="team" /> : null}
        </button>
      </div>

      {half === "indiv" ? <IndividualHalf {...props} onTeam={() => setHalf("team")} /> : <TeamHalf {...props} />}
    </div>
  );
}

// ------------------------------------------------------------ individual

function IndividualHalf({
  data,
  activity,
  m,
  justPublished,
  onDismissPublished,
  onEdit,
  onEditDetails,
  onBack,
  onChanged,
  onError,
  onTeam,
}: Props & { onTeam: () => void }) {
  const [drill, setDrill] = useState<Drill>(null);
  const [visBusy, setVisBusy] = useState(false);
  const [deleting, setDeleting] = useState<"ask" | "busy" | null>(null);
  const N = m.questions.length;
  const visible = isOpenToStudents(activity);
  const reveal = m.state.phase === "closed";
  const due = fmtDue(activity.due_at ?? activity.individual_due_at);
  // Whitespace-only is no description; rows written elsewhere can carry "".
  const brief = activity.source_text?.trim() ?? "";

  if (drill && drill.kind !== "team") {
    return (
      <div className="fv-scroll lq-scroll">
        {drill.kind === "student" ? (
          <StudentDetail
            m={m}
            studentId={drill.id}
            reveal={reveal}
            backLabel="Individual"
            onBack={() => setDrill(null)}
            onTeam={onTeam}
            onQuestion={(q) => setDrill({ kind: "question", id: drill.id, via: "indiv", q })}
          />
        ) : (
          <StudentQuestion
            m={m}
            studentId={drill.id}
            q={drill.q}
            reveal={reveal}
            onBack={() => setDrill({ kind: "student", id: drill.id, via: "indiv" })}
            onQuestion={(q) => setDrill({ ...drill, q })}
            onStudent={(id) => setDrill({ ...drill, id })}
          />
        )}
      </div>
    );
  }

  const done = m.students.filter((s) => N > 0 && m.answered(s.id) === N);
  const partial = m.students.filter((s) => m.answered(s.id) > 0 && m.answered(s.id) < N);
  const none = m.students.filter((s) => m.answered(s.id) === 0);
  const pct = m.students.length ? (100 * done.length) / m.students.length : 0;
  const open = (id: string) => setDrill({ kind: "student", id, via: "indiv" });

  const setVisible = async (on: boolean) => {
    setVisBusy(true);
    try {
      // NULL for visible, never now(): see ActivityDetail's switch.
      await updateActivity(activity.id, { opens_at: on ? null : HIDDEN_INSTANT });
      await onChanged();
    } catch (e) {
      onError(e);
    } finally {
      setVisBusy(false);
    }
  };

  const remove = async () => {
    setDeleting("busy");
    try {
      // Images first: the bucket's delete policy joins back to the activity
      // row, so once that's gone nobody can remove them.
      const figures = m.questions.flatMap((q) => (q.figure_path ? [q.figure_path] : []));
      if (figures.length) {
        const failed = await removeObjects("activity-files", figures);
        if (failed) throw new Error(`Couldn’t remove the question images: ${failed.message}`);
      }
      await deleteActivity(activity.id);
      await onChanged();
      onBack();
    } catch (e) {
      onError(e);
      setDeleting(null);
    }
  };

  return (
    <div className="fv-split">
      <div className="fv-left23" style={{ paddingRight: 4 }}>
        {justPublished && visible ? (
          <div className="lq-published" role="status">
            <Ic name="check" size={15} />
            <span>
              <b>Published.</b> {due ? `Students can answer on their own until ${due}.` : "Students can answer on their own now."}
            </span>
            <button type="button" className="lq-x" aria-label="Dismiss" onClick={onDismissPublished}>
              <Ic name="close" size={13} />
            </button>
          </div>
        ) : null}

        <div className="lq-typerow">
          <span className="fv-type" style={{ width: "auto", color: "var(--lq-team)" }}>
            Live questions
          </span>
          <span className="fv-badge">Individual + team</span>
        </div>
        <h1 className="fv-display lq-pagetitle">{activity.title}</h1>
        {due ? (
          <div className="fv-sub" style={{ marginTop: 8 }}>
            On their own by {due}
          </div>
        ) : null}

        {data.can.author ? (
          <div className="lq-vis" style={{ marginTop: 12 }}>
            <button
              type="button"
              className={`fv-switch${visible ? " on" : ""}`}
              role="switch"
              aria-checked={visible}
              aria-label="Visible to students"
              // Hiding it mid-session would take it off phones in the middle of a vote.
              disabled={visBusy || (visible && m.state.phase !== "individual")}
              onClick={() => void setVisible(!visible)}
            />
            <span className="fv-sub" style={visible ? undefined : { color: "var(--fv-amber)" }}>
              {visible ? "Visible to students" : "Not visible to students"}
            </span>
          </div>
        ) : null}

        {/* Same renderer the class reads it through, so a link that works here
            works on their phones. */}
        {brief ? (
          <p className="lq-desc">
            <BriefText text={brief} />
          </p>
        ) : null}
        {data.can.author ? (
          <button type="button" className="lq-linkish lq-descedit" onClick={onEditDetails}>
            {brief ? "Edit description" : "+ Description"}
          </button>
        ) : null}

        <div className="lq-badges">
          <span className="fv-badge secondary">
            {N} question{N === 1 ? "" : "s"}
          </span>
          <span className="fv-badge secondary">{activity.points_total} pts</span>
          {m.state.grading === "team" ? <span className="fv-badge secondary">Team only</span> : null}
        </div>

        {data.can.author ? (
          <div className="lq-pagebtns">
            <button type="button" className="fv-btn outline sm" onClick={onEdit}>
              <Ic name="edit" size={15} /> Edit questions
            </button>
            {m.state.phase === "individual" ? (
              <button type="button" className="fv-btn ghost sm" onClick={() => setDeleting("ask")}>
                Delete
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="fv-right13">
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          <div className="lq-bigcount">
            <span className="fv-display fv-num">{done.length}</span>
            <span className="fv-sub">of {m.students.length} submitted</span>
          </div>
          <div className="fv-track" style={{ marginTop: 12 }}>
            <i style={{ width: `${pct}%`, background: "var(--fv-emerald)" }} />
          </div>

          <Pile label="Submitted" dot="var(--fv-emerald)" list={done} m={m} onOpen={open} first startOpen={done.length <= 8} />
          <Pile label="In progress" dot="var(--fv-amber)" list={partial} m={m} onOpen={open} />
          <Pile label="Not started" dot="var(--fv-neutral-300)" list={none} m={m} onOpen={open} muted />
        </div>

        <div className="lq-rightfoot">
          <button type="button" className="fv-btn primary full" style={{ height: 40 }} onClick={onTeam}>
            {m.state.phase === "individual" ? "Go to team mode" : m.state.phase === "team" ? "Back to team mode" : "Team scores"}
            <Ic name="arrowRight" size={15} />
          </button>
        </div>
      </div>

      {deleting ? (
        <ConfirmDialog
          title={`Delete “${activity.title}”?`}
          body={
            m.students.some((s) => m.answered(s.id) > 0)
              ? "Every answer students have given goes with it."
              : "It hasn’t been answered yet."
          }
          confirmLabel="Delete"
          busy={deleting === "busy"}
          onConfirm={() => void remove()}
          onCancel={() => setDeleting(null)}
        />
      ) : null}
    </div>
  );
}

function Pile({
  label,
  dot,
  list,
  m,
  onOpen,
  muted = false,
  first = false,
  startOpen = true,
}: {
  label: string;
  dot: string;
  list: Student[];
  m: LiveModel;
  onOpen: (id: string) => void;
  muted?: boolean;
  first?: boolean;
  /** Until the instructor toggles it; an empty pile never opens on its own. */
  startOpen?: boolean;
}) {
  const [toggled, setOpen] = useState<boolean | null>(null);
  const open = toggled ?? (startOpen && list.length > 0);
  return (
    <>
      <button
        type="button"
        className="fv-group"
        style={first ? { marginTop: 18 } : { marginTop: 12, borderTop: "1px solid var(--fv-neutral-200)" }}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span className="fv-dot" style={{ background: dot }} />
        <span style={{ flex: 1, textAlign: "left", fontWeight: 600 }}>{label}</span>
        <span className="fv-sub fv-num">{list.length}</span>
        <span className={`fv-chev${open ? " open" : ""}`} style={{ color: "var(--fv-muted)" }}>
          <Ic name="chevronRight" size={16} />
        </span>
      </button>
      {open ? (
        <div className="lq-people">
          {list.map((s) => (
            <button
              key={s.id}
              type="button"
              className="fv-person lq-personbtn"
              style={muted ? { color: "var(--fv-muted)" } : undefined}
              onClick={() => onOpen(s.id)}
            >
              <Av p={s} size={22} />
              <span className="lq-personname">{s.name}</span>
              <span className="fv-sub fv-num">
                {m.answered(s.id)}/{m.questions.length}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </>
  );
}

// ------------------------------------------------------------------ team

function TeamHalf({ data, activity, m, reload, onError }: Props) {
  const phase = m.state.phase;
  const [tab, setTab] = useState<Tab>(DEFAULT_TAB[phase]);
  const [drill, setDrill] = useState<Drill>(null);
  const [reveal, setReveal] = useState(phase === "closed");
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // A phase change is the instructor's own move (or a TF's), so the screen
  // follows it to the tab that matters next instead of leaving them on the old one.
  useEffect(() => {
    setTab(DEFAULT_TAB[phase]);
    setDrill(null);
    setConfirm(null);
    if (phase === "closed") setReveal(true);
  }, [phase]);

  const N = m.questions.length;
  const finishedOwn = m.students.filter((s) => N > 0 && m.answered(s.id) === N).length;
  const teamsDone = m.teams.filter((t) => N > 0 && m.done(t.id) === N).length;
  const canRun = data.can.runCheckIns;
  const visible = isOpenToStudents(activity);

  const score = async () => {
    const snap = await loadLive(activity.id);
    if (!snap) return;
    const res = await scoreLive(snap);
    setNote(res.status === "scored" ? "Scores are in the gradebook." : "Scored — waiting in the instructor’s Review tab.");
    // The session's own scored_at, and the gradebook, both moved.
    await reload();
  };

  const run = async (move: "start" | "close" | "score") => {
    setConfirm(null);
    setBusy(true);
    setNote(null);
    try {
      if (move === "start") {
        // Keys from before 0049 get what a team's typed expression is checked
        // against as it submits. Never in the way of starting the class: without
        // prints a team's expression is only right as the key writes it until
        // scoring, which decides by the algebra regardless.
        if (data.can.author) await printOldKeys(activity.id, m.questions).catch(() => {});
        await startTeamMode(activity.id);
      }
      if (move === "close") await closeLive(activity.id);
      await reload();
      if ((move === "close" || move === "score") && data.can.grade) await score();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };

  const advance = () => {
    if (phase === "individual") {
      const left = m.students.length - finishedOwn;
      if (left > 0 && confirm === null) {
        setConfirm(`${left} student${left === 1 ? " hasn’t" : "s haven’t"} submitted.`);
        return;
      }
      void run("start");
    } else if (phase === "team") {
      const left = m.teams.length - teamsDone;
      if (left > 0 && confirm === null) {
        setConfirm(`${left} team${left === 1 ? " is" : "s are"} still working.`);
        return;
      }
      void run("close");
    }
  };

  const steps = [
    { key: "individual", label: "At home, on their own", sub: `${finishedOwn}/${m.students.length} submitted` },
    { key: "team", label: "In class, as teams", sub: phase === "individual" ? "" : `${teamsDone}/${m.teams.length} teams done` },
    { key: "closed", label: "Scored", sub: "" },
  ];
  const at = ["individual", "team", "closed"].indexOf(phase);
  const teamOfStudent = (id: string) => m.teamOf(id)?.id ?? null;

  return (
    <>
      {drill ? null : (
        <div className="lq-stepper">
          <ol className="lq-steps">
            {steps.map((st, i) => (
              <li key={st.key} className={`lq-step ${st.key}${i === at ? " now" : i < at ? " past" : ""}`}>
                <span className="lq-stepnum">{i < at ? "✓" : i + 1}</span>
                <span className="lq-steptext">
                  <span className="lq-steplabel">{st.label}</span>
                  <span className="lq-stepsub fv-num">{st.sub}</span>
                </span>
              </li>
            ))}
          </ol>
          {phase !== "closed" && canRun ? (
            <button
              type="button"
              className={`fv-btn primary lq-advance ${phase}`}
              onClick={advance}
              disabled={busy || !visible || N === 0}
              title={visible ? undefined : "Make it visible to students first"}
            >
              {phase === "individual" ? (
                <>
                  <Ic name="groups" size={17} /> {busy ? "Starting…" : "Start team mode"}
                </>
              ) : (
                <>
                  <Ic name="flag" size={17} /> {busy ? "Closing…" : data.can.grade ? "Close and score" : "Close"}
                </>
              )}
            </button>
          ) : phase === "closed" && !m.state.scored_at && data.can.grade ? (
            <button type="button" className="fv-btn primary lq-advance" disabled={busy} onClick={() => void run("score")}>
              <Ic name="flag" size={17} /> {busy ? "Scoring…" : "Score"}
            </button>
          ) : null}
        </div>
      )}

      {confirm ? (
        <div className="lq-confirm" role="alertdialog" aria-label="Confirm">
          <span>{confirm}</span>
          <div className="lq-confirmbtns">
            <button type="button" className="fv-btn ghost sm" onClick={() => setConfirm(null)}>
              Keep waiting
            </button>
            <button type="button" className="fv-btn primary sm" onClick={() => void run(phase === "individual" ? "start" : "close")}>
              {phase === "individual" ? "Start anyway" : "Close anyway"}
            </button>
          </div>
        </div>
      ) : null}

      {note ? (
        <div className="lq-published" role="status">
          <Ic name="check" size={15} />
          <span>{note}</span>
          <button type="button" className="lq-x" aria-label="Dismiss" onClick={() => setNote(null)}>
            <Ic name="close" size={13} />
          </button>
        </div>
      ) : null}

      <div className="lq-tabs" role="tablist">
        {(
          [
            ["questions", "Questions"],
            ["teams", phase === "closed" ? "Team scores" : "Teams"],
            ["students", "Students"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={`lq-tab${tab === id ? " on" : ""}`}
            onClick={() => {
              setTab(id);
              setDrill(null);
            }}
          >
            {label}
            {id === "teams" && phase === "team" ? (
              <span className="lq-tabcount fv-num">
                {teamsDone}/{m.teams.length}
              </span>
            ) : null}
          </button>
        ))}
        <button
          type="button"
          className={`fv-btn ghost sm lq-reveal${reveal ? " on" : ""}`}
          onClick={() => setReveal((r) => !r)}
          title="Keep answers hidden while you project this screen"
        >
          <Ic name={reveal ? "eye" : "eyeOff"} size={15} />
          {reveal ? "Answers shown" : "Answers hidden"}
        </button>
      </div>

      <div className="fv-scroll lq-scroll">
        {drill?.kind === "team" ? (
          <TeamDetail
            m={m}
            teamId={drill.id}
            reveal={reveal}
            onBack={() => setDrill(null)}
            onStudent={(id) => setDrill({ kind: "student", id, via: "team" })}
          />
        ) : drill?.kind === "student" ? (
          <StudentDetail
            m={m}
            studentId={drill.id}
            reveal={reveal}
            backLabel={drill.via === "team" ? m.teamOf(drill.id)?.name ?? "Team" : "Students"}
            onBack={() => {
              const t = teamOfStudent(drill.id);
              setDrill(drill.via === "team" && t ? { kind: "team", id: t } : null);
            }}
            onTeam={(id) => setDrill({ kind: "team", id })}
            onQuestion={(q) => setDrill({ kind: "question", id: drill.id, via: drill.via, q })}
          />
        ) : drill?.kind === "question" ? (
          <StudentQuestion
            m={m}
            studentId={drill.id}
            q={drill.q}
            reveal={reveal}
            onBack={() => setDrill({ kind: "student", id: drill.id, via: drill.via })}
            onQuestion={(q) => setDrill({ ...drill, q })}
            onStudent={(id) => setDrill({ ...drill, id })}
          />
        ) : tab === "questions" ? (
          <QuestionsView m={m} reveal={reveal} />
        ) : tab === "teams" ? (
          m.teams.length === 0 ? (
            <div className="fv-sub lq-empty">No teams yet. Form them on the Teams page before class.</div>
          ) : phase === "closed" ? (
            <TeamResults m={m} onTeam={(id) => setDrill({ kind: "team", id })} onExport={() => exportTeamCsv(activity.title, m)} />
          ) : (
            <TeamsLive m={m} reveal={reveal} onTeam={(id) => setDrill({ kind: "team", id })} />
          )
        ) : (
          <StudentsView m={m} reveal={reveal} onStudent={(id) => setDrill({ kind: "student", id, via: "students" })} />
        )}
      </div>
    </>
  );
}
