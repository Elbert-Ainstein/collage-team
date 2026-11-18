"use client";

// A team evaluation's results, on a page of their own so the table gets the
// whole screen.
//
// Two views of the same rows. Results: everyone, team by team, with the
// average their submitted teammates gave them in each category (themselves
// left out), what they gave themselves, when they submitted, a flag for late —
// which staff can change — and what it's worth in the gradebook. Comments:
// one grid per team, the person written about down the side and the person
// writing across the top; the diagonal is their own reflection.
//
// Releasing and sending to the gradebook live here, beside what they decide.
// Staff always see names; anonymity is a promise to students about each
// other, kept by team_eval_results (0058).

import { useMemo, useState } from "react";
import type { Activity } from "@/checkins/types";
import { teamsOf } from "@/checkins/rosters";
import { releaseTeamEval, scoreTeamEval, setTeamEvalLate } from "@/teameval/data";
import { buildResults, commentCell, fmtAvg, fmtPoints, type ResultRow } from "@/teameval/model";
import type { TeamEvalSnapshot } from "@/teameval/types";
import { Ic } from "@/live/ui";
import type { FacultyData } from "../FacultyApp";
import { FAvatar } from "../icons";
import { fmtDay, fmtWhen } from "./format";

type Tab = "results" | "comments";

interface Props {
  data: FacultyData;
  activity: Activity;
  snap: TeamEvalSnapshot;
  /** Back to the overview. */
  onBack: () => void;
  reload: () => Promise<void>;
  onChanged: () => void | Promise<void>;
  onError: (e: unknown) => void;
}

/** Low marks stand out: under 3 is below "meets expectations" on every default scale. */
const low = (avg: number | null) => avg !== null && avg < 3;

// The tab last used on this evaluation, so coming back lands where she was.
const tabKey = (activityId: string) => `te-tab-${activityId}`;
function lastTab(activityId: string): Tab {
  try {
    return window.localStorage.getItem(tabKey(activityId)) === "comments" ? "comments" : "results";
  } catch {
    return "results";
  }
}

export function TeamEvalResults({ data, activity, snap, onBack, reload, onChanged, onError }: Props) {
  const [tab, setTabState] = useState<Tab>(() => lastTab(activity.id));
  const [busy, setBusy] = useState<string | null>(null);
  const [scored, setScored] = useState<string | null>(null);

  const setTab = (t: Tab) => {
    setTabState(t);
    try {
      window.localStorage.setItem(tabKey(activity.id), t);
    } catch {
      // Private mode: it opens on Results next time, which is harmless.
    }
  };

  const dueAt = activity.due_at ?? activity.individual_due_at;
  const released = Boolean(snap.settings.released_at);
  const teams = useMemo(() => teamsOf(data, activity.id), [data, activity.id]);
  const groups = useMemo(
    () => buildResults({ snapshot: snap, teams, roster: data.roster, dueAt, pointsTotal: activity.points_total }),
    [snap, teams, data.roster, dueAt, activity.points_total],
  );
  const rows = groups.flatMap((g) => g.rows);
  const onTeams = groups.filter((g) => g.team).flatMap((g) => g.rows);
  const submitted = onTeams.filter((r) => r.submission).length;

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

  const status = [
    released ? `Released ${fmtDay(snap.settings.released_at)}` : null,
    scored ?? (snap.settings.scored_at ? `Sent ${fmtDay(snap.settings.scored_at)}` : null),
  ].filter(Boolean);

  return (
    <div className="fv-panel lq-panel te-fac">
      <div className="fv-topbar te-rtop">
        <button type="button" className="fv-back" aria-label="Back to overview" onClick={onBack}>
          <Ic name="chevronLeft" size={16} />
        </button>
        <div className="te-rtitle">
          <h1 className="fv-display">{activity.title}</h1>
          <span className="fv-sub">
            {submitted} of {onTeams.length} submitted
          </span>
        </div>
        <div className="te-ractions">
          {status.length ? (
            <span className="fv-sub" role="status">
              {status.join(" · ")}
            </span>
          ) : null}
          <button type="button" className="fv-iconbtn" aria-label="Refresh" title="Refresh" disabled={busy !== null} onClick={() => void run("reload", reload)}>
            <Ic name="refresh" size={15} />
          </button>
          {data.can.grade ? (
            <button type="button" className="fv-btn outline sm" disabled={busy !== null} onClick={() => void score()}>
              <Ic name="check" size={15} /> Send to gradebook
            </button>
          ) : null}
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
        </div>
      </div>

      <div className="fv-scroll lq-scroll">
        <div className="fv-seg te-viewseg" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "results"} className={tab === "results" ? "on" : ""} onClick={() => setTab("results")}>
            Results
          </button>
          <button type="button" role="tab" aria-selected={tab === "comments"} className={tab === "comments" ? "on" : ""} onClick={() => setTab("comments")}>
            Comments
          </button>
        </div>

        {rows.length === 0 ? (
          <p className="fv-sub">No students yet.</p>
        ) : tab === "results" ? (
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
