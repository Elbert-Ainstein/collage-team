"use client";

// A team evaluation's page, for the instructor and TFs.
//
// Two views of the same rows. Results: everyone, team by team, with the
// average their submitted teammates gave them in each category (themselves
// left out), what they gave themselves, whether and when they submitted, a
// flag for late — which staff can change — and what it's worth in the
// gradebook. Comments: one grid per team, the person written about down the
// side and the person writing across the top, so a row reads as everything
// said about one student; the diagonal is their own reflection.
//
// Staff always see names. Anonymity is a promise to students about each
// other, kept by team_eval_results (0058).

import { useMemo, useState } from "react";
import { deleteActivity, updateActivity } from "@/checkins/data";
import { isOpenToStudents } from "@/checkins/studentData";
import { HIDDEN_INSTANT, type Activity } from "@/checkins/types";
import { teamsOf } from "@/checkins/rosters";
import { BriefText } from "@/checkins/BriefText";
import { releaseTeamEval, scoreTeamEval, setTeamEvalLate } from "@/teameval/data";
import { buildResults, commentCell, fmtAvg, fmtPoints, type ResultRow } from "@/teameval/model";
import type { TeamEvalSnapshot } from "@/teameval/types";
import { Ic } from "@/live/ui";
import { ConfirmDialog } from "../ConfirmDialog";
import type { FacultyData } from "../FacultyApp";
import { FAvatar } from "../icons";

interface Props {
  data: FacultyData;
  activity: Activity;
  snap: TeamEvalSnapshot;
  justPublished: boolean;
  onDismissPublished: () => void;
  onBack: () => void;
  onEdit: () => void;
  onEditDetails: () => void;
  reload: () => Promise<void>;
  onChanged: () => void | Promise<void>;
  onError: (e: unknown) => void;
}

function fmtWhen(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** "Nov 16" — when a button press happened; the hour adds nothing. */
function fmtDay(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Low marks stand out: under 3 is below "meets expectations" on every default scale. */
const low = (avg: number | null) => avg !== null && avg < 3;

export function TeamEvalPage(props: Props) {
  const { data, activity, snap, justPublished, onDismissPublished, onBack, onEdit, onEditDetails, reload, onChanged, onError } = props;
  const [view, setView] = useState<"results" | "comments">("results");
  const [busy, setBusy] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<null | "ask" | "busy">(null);
  const [scored, setScored] = useState<string | null>(null);

  const dueAt = activity.due_at ?? activity.individual_due_at;
  const due = fmtWhen(dueAt);
  const visible = isOpenToStudents(activity);
  const released = Boolean(snap.settings.released_at);
  const teams = useMemo(() => teamsOf(data, activity.id), [data, activity.id]);
  const groups = useMemo(
    () => buildResults({ snapshot: snap, teams, roster: data.roster, dueAt, pointsTotal: activity.points_total }),
    [snap, teams, data.roster, dueAt, activity.points_total],
  );
  const rows = groups.flatMap((g) => g.rows);
  const onTeams = groups.filter((g) => g.team).flatMap((g) => g.rows);
  const submitted = onTeams.filter((r) => r.submission).length;
  const pct = onTeams.length ? (100 * submitted) / onTeams.length : 0;

  const run = async (key: string, job: () => Promise<void>) => {
    setBusy(key);
    try {
      await job();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(null);
    }
  };

  const setVisible = (on: boolean) =>
    run("vis", async () => {
      await updateActivity(activity.id, { opens_at: on ? null : HIDDEN_INSTANT });
      await onChanged();
    });

  const toggleRelease = () =>
    run("release", async () => {
      await releaseTeamEval(activity.id, !released);
      await reload();
    });

  const score = () =>
    run("score", async () => {
      const r = await scoreTeamEval(activity.id);
      await Promise.all([reload(), onChanged()]);
      setScored(r.status === "scored" ? "Sent" : "Sent for review");
    });

  const flag = (row: ResultRow) =>
    run(`flag-${row.student.id}`, async () => {
      // Back to the clock when that's what it would say anyway.
      const next = !row.late;
      await setTeamEvalLate(activity.id, row.student.id, next === row.clockLate ? null : next);
      await reload();
    });

  const remove = async () => {
    setDeleting("busy");
    try {
      await deleteActivity(activity.id);
      await onChanged();
      onBack();
    } catch (e) {
      onError(e);
      setDeleting(null);
    }
  };

  const brief = activity.source_text?.trim() ?? "";

  return (
    <div className="fv-panel lq-panel te-fac">
      <div className="fv-topbar">
        <button type="button" className="fv-back" aria-label="Back to Activities" onClick={onBack}>
          <Ic name="chevronLeft" size={16} />
        </button>
        <span className="fv-sub">{activity.week === null ? "Team evaluation" : `Week ${activity.week} · Team evaluation`}</span>
        <span style={{ flex: 1 }} />
        <button type="button" className="fv-iconbtn" aria-label="Refresh" title="Refresh" disabled={busy !== null} onClick={() => void run("reload", reload)}>
          <Ic name="refresh" size={15} />
        </button>
      </div>

      <div className="fv-scroll lq-scroll">
        {justPublished && visible ? (
          <div className="lq-published" role="status">
            <Ic name="check" size={15} />
            <b>Published</b>
            <button type="button" className="lq-x" aria-label="Dismiss" onClick={onDismissPublished}>
              <Ic name="close" size={13} />
            </button>
          </div>
        ) : null}

        <div className="te-pagehead">
          <div className="te-pagemain">
            <h1 className="fv-display lq-pagetitle">{activity.title}</h1>
            {due ? (
              <div className="fv-sub" style={{ marginTop: 8 }}>
                Due {due}
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
                  disabled={busy !== null}
                  onClick={() => void setVisible(!visible)}
                />
                <span className="fv-sub" style={visible ? undefined : { color: "var(--fv-amber)" }}>
                  {visible ? "Visible" : "Hidden"}
                </span>
              </div>
            ) : null}
            {brief ? (
              <p className="lq-desc">
                <BriefText text={brief} />
              </p>
            ) : null}
            {data.can.author ? (
              <button type="button" className="lq-linkish lq-descedit" onClick={onEditDetails}>
                {brief ? "Edit details" : "+ Instructions"}
              </button>
            ) : null}
            <div className="lq-badges">
              <span className="fv-badge secondary">{fmtPoints(activity.points_total)} pts</span>
              <span className="fv-badge secondary">−{fmtPoints(snap.settings.late_penalty)}% late</span>
              {snap.settings.anonymize ? <span className="fv-badge secondary">Anonymous</span> : null}
              {!snap.settings.peer_comments ? <span className="fv-badge secondary">No peer comments</span> : null}
              {snap.settings.peer_comments && !snap.settings.release_comments ? (
                <span className="fv-badge secondary">Comments private</span>
              ) : null}
            </div>
            {data.can.author ? (
              <div className="lq-pagebtns">
                <button type="button" className="fv-btn outline sm" onClick={onEdit}>
                  <Ic name="edit" size={15} /> Edit
                </button>
                <button type="button" className="fv-btn ghost sm" onClick={() => setDeleting("ask")}>
                  Delete
                </button>
              </div>
            ) : null}
          </div>

          <div className="fv-card te-statcard">
            <div className="lq-bigcount">
              <span className="fv-display fv-num">{submitted}</span>
              <span className="fv-sub">of {onTeams.length} submitted</span>
            </div>
            <div className="fv-track" style={{ marginTop: 10 }}>
              <i style={{ width: `${pct}%`, background: "var(--fv-emerald)" }} />
            </div>
            <div className="te-statbtns">
              {data.can.isOwner ? (
                <button
                  type="button"
                  className={`fv-btn ${released ? "outline" : "primary"} sm`}
                  disabled={busy !== null}
                  onClick={() => void toggleRelease()}
                >
                  <Ic name={released ? "eyeOff" : "eye"} size={15} />
                  {released ? "Hide results" : "Release results"}
                </button>
              ) : null}
              {released ? <span className="fv-sub">Released {fmtDay(snap.settings.released_at)}</span> : null}
              {data.can.grade ? (
                <button type="button" className="fv-btn outline sm" disabled={busy !== null} onClick={() => void score()}>
                  <Ic name="check" size={15} />
                  Send to gradebook
                </button>
              ) : null}
              {scored ? (
                <span className="fv-sub" role="status">
                  {scored}
                </span>
              ) : snap.settings.scored_at ? (
                <span className="fv-sub">Sent {fmtDay(snap.settings.scored_at)}</span>
              ) : null}
            </div>
          </div>
        </div>

        <div className="fv-seg te-viewseg" role="tablist">
          <button type="button" role="tab" aria-selected={view === "results"} className={view === "results" ? "on" : ""} onClick={() => setView("results")}>
            Results
          </button>
          <button type="button" role="tab" aria-selected={view === "comments"} className={view === "comments" ? "on" : ""} onClick={() => setView("comments")}>
            Comments
          </button>
        </div>

        {rows.length === 0 ? (
          <p className="fv-sub">No students yet.</p>
        ) : view === "results" ? (
          <ResultsTable
            groups={groups}
            snap={snap}
            pointsTotal={activity.points_total}
            canFlag={data.can.grade}
            busy={busy}
            onFlag={(r) => void flag(r)}
          />
        ) : (
          <CommentsView groups={groups} snap={snap} />
        )}
      </div>

      {deleting ? (
        <ConfirmDialog
          title={`Delete “${activity.title}”?`}
          body={
            snap.ratings.length ? "All ratings and comments go with it." : "Nobody has started it."
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

// ------------------------------------------------------------------ results

function ResultsTable({
  groups,
  snap,
  pointsTotal,
  canFlag,
  busy,
  onFlag,
}: {
  groups: ReturnType<typeof buildResults>;
  snap: TeamEvalSnapshot;
  pointsTotal: number;
  canFlag: boolean;
  busy: string | null;
  onFlag: (r: ResultRow) => void;
}) {
  const cats = snap.categories;
  return (
    <div className="te-tblwrap">
      <table className="fv-tbl te-tbl" role="table">
        <thead>
          <tr>
            <th className="te-namecol">Student</th>
            {cats.map((c) => (
              <th key={c.id} className="te-num" title="Teammates’ average · self below">
                {c.name}
              </th>
            ))}
            <th className="te-num">Overall</th>
            <th>Submitted</th>
            <th>Flag</th>
            <th className="te-num">Grade /{fmtPoints(pointsTotal)}</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <GroupRows key={g.team?.id ?? "none"} g={g} cats={cats} penalty={snap.settings.late_penalty} canFlag={canFlag} busy={busy} onFlag={onFlag} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GroupRows({
  g,
  cats,
  penalty,
  canFlag,
  busy,
  onFlag,
}: {
  g: ReturnType<typeof buildResults>[number];
  cats: TeamEvalSnapshot["categories"];
  penalty: number;
  canFlag: boolean;
  busy: string | null;
  onFlag: (r: ResultRow) => void;
}) {
  return (
    <>
      <tr className="fv-trteam te-teamrow">
        <td colSpan={cats.length + 5}>
          <b>{g.team?.name ?? "No team"}</b>
          <span className="fv-sub">
            {" "}
            {g.rows.filter((r) => r.submission).length}/{g.rows.length}
          </span>
        </td>
      </tr>
      {g.rows.map((r) => (
        <tr key={r.student.id} className="fv-trstu" role="row">
          <td className="te-namecol">
            <span className="te-person">
              <FAvatar name={r.student.name} tint={r.student.avatar_tint} size={22} />
              {r.student.name}
            </span>
          </td>
          {r.categories.map((c, i) => (
            <td key={cats[i].id} className={`te-num${low(c.avg) ? " low" : ""}`} title={c.n ? `${c.n} rater${c.n === 1 ? "" : "s"}` : undefined}>
              <span className="te-avg">{fmtAvg(c.avg)}</span>
              {c.self !== null ? <span className="te-self">self {c.self}</span> : null}
            </td>
          ))}
          <td className={`te-num${low(r.overall) ? " low" : ""}`}>
            <span className="te-avg">{fmtAvg(r.overall)}</span>
          </td>
          <td className="fv-sub te-when">{r.submission ? fmtWhen(r.submission.submitted_at) : "—"}</td>
          <td>
            {r.submission ? (
              <button
                type="button"
                className={`te-flag${r.late ? " on" : ""}`}
                disabled={!canFlag || busy !== null}
                aria-pressed={r.late}
                aria-label={r.late ? "Late — unflag" : "Flag late"}
                title={r.late ? `−${fmtPoints(penalty)}%${r.late !== r.clockLate ? " · set by staff" : ""}` : "Flag late"}
                onClick={() => onFlag(r)}
              >
                <Ic name="flag" size={13} />
                {r.late ? "Late" : null}
              </button>
            ) : null}
          </td>
          <td className="te-num">
            <span className="fv-num">{fmtPoints(r.grade)}</span>
          </td>
        </tr>
      ))}
    </>
  );
}

// ----------------------------------------------------------------- comments

function CommentsView({ groups, snap }: { groups: ReturnType<typeof buildResults>; snap: TeamEvalSnapshot }) {
  const teams = groups.filter((g) => g.team && g.rows.length);
  // Each prompt once, in a key, rather than above every answer in every cell.
  const qNum = new Map(snap.questions.map((q, i) => [q.id, `Q${i + 1}`]));
  // One reflection question: the Self tag already says which it is.
  const oneSelf = snap.questions.filter((q) => q.audience === "self").length === 1;
  if (!teams.length) return <p className="fv-sub">No teams yet.</p>;
  return (
    <div className="te-cgroups">
      {snap.questions.length ? (
        <ol className="te-qkey">
          {snap.questions.map((q) => (
            <li key={q.id}>
              <b>{qNum.get(q.id)}</b> {q.prompt}
            </li>
          ))}
        </ol>
      ) : null}
      {teams.map((g) => {
        const people = g.rows.map((r) => r.student);
        return (
          <section key={g.team!.id} className="te-cteam">
            <h3 className="te-h3">{g.team!.name}</h3>
            <div className="te-tblwrap">
              <table className="te-ctbl">
                <thead>
                  <tr>
                    <th className="te-corner">
                      <span className="fv-eyebrow">About ↓ · By →</span>
                    </th>
                    {people.map((p) => (
                      <th key={p.id}>
                        <span className="te-person">
                          <FAvatar name={p.name} tint={p.avatar_tint} size={20} />
                          {p.name}
                        </span>
                        {snap.submissions.some((s) => s.student_id === p.id) ? null : <span className="te-nosub">Not submitted</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {people.map((about) => (
                    <tr key={about.id}>
                      <th scope="row" className="te-rowhead">
                        <span className="te-person">
                          <FAvatar name={about.name} tint={about.avatar_tint} size={20} />
                          {about.name}
                        </span>
                      </th>
                      {people.map((by) => {
                        const cell = commentCell(snap, by.id, about.id);
                        return (
                          <td key={by.id} className={cell.self ? "te-selfcell" : undefined}>
                            {cell.self ? <span className="te-selftag">Self</span> : null}
                            {!cell.submitted ? (
                              <span className="fv-sub">—</span>
                            ) : (
                              <>
                                {cell.answers.map((a) => (
                                  <div key={a.question.id} className="te-answer" title={a.question.prompt}>
                                    {cell.self && oneSelf ? null : <span className="te-prompt">{qNum.get(a.question.id)}</span>}
                                    <p>{a.body}</p>
                                  </div>
                                ))}
                                {cell.scores.length ? (
                                  <div className="te-scores">
                                    {cell.scores.map((s) => (
                                      <div key={s.category.id} className="te-scoreline">
                                        <span>{s.category.name}</span>
                                        <b className={`te-chip s${s.score}`}>{s.score}</b>
                                        {s.reason ? <span className="te-reason">{s.reason}</span> : null}
                                      </div>
                                    ))}
                                  </div>
                                ) : null}
                              </>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
}
