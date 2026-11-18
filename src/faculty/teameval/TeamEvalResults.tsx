"use client";

// A team evaluation's results, on a page of their own.
//
// Every team as a card, each member on a 1–5 line: their teammates' average
// and what they gave themselves. Clicking anyone opens everything about them
// in a side panel — each teammate's scores and reasons, every comment about
// them, their reflection. The full table is one toggle away. Releasing and
// sending to the gradebook live here, beside the scores they decide.
//
// Staff always see names; anonymity is a promise to students about each
// other, kept by team_eval_results (0058).

import { useEffect, useMemo, useState } from "react";
import type { Activity } from "@/checkins/types";
import { teamsOf } from "@/checkins/rosters";
import { releaseTeamEval, scoreTeamEval, setTeamEvalLate } from "@/teameval/data";
import { buildResults, fmtAvg, fmtPoints, type ResultRow, type TeamGroup } from "@/teameval/model";
import { ScoreTrack } from "@/teameval/ScoreTrack";
import type { TeamEvalSnapshot } from "@/teameval/types";
import { Ic } from "@/live/ui";
import type { FacultyData } from "../FacultyApp";
import { FAvatar } from "../icons";
import { fmtDay, fmtWhen } from "./format";

type View = "cards" | "table";

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

// The view last used on this evaluation, so coming back lands where she was.
const viewKey = (activityId: string) => `te-view-${activityId}`;
function lastView(activityId: string): View {
  try {
    return window.localStorage.getItem(viewKey(activityId)) === "table" ? "table" : "cards";
  } catch {
    return "cards";
  }
}

export function TeamEvalResults({ data, activity, snap, onBack, reload, onChanged, onError }: Props) {
  const [view, setViewState] = useState<View>(() => lastView(activity.id));
  const [busy, setBusy] = useState<string | null>(null);
  const [scored, setScored] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const setView = (v: View) => {
    setViewState(v);
    try {
      window.localStorage.setItem(viewKey(activity.id), v);
    } catch {
      // Private mode: it opens on Cards next time, which is harmless.
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
    `${submitted} of ${onTeams.length} submitted`,
    released ? `Released ${fmtDay(snap.settings.released_at)}` : null,
    scored ?? (snap.settings.scored_at ? `Sent ${fmtDay(snap.settings.scored_at)}` : null),
  ].filter(Boolean);

  // The panel's ‹ › walk everyone on a team, in the order the cards show them.
  const order = onTeams.map((r) => r.student.id);
  const openRow = rows.find((r) => r.student.id === openId) ?? null;
  const step = (d: 1 | -1) => {
    const next = openRow ? order[order.indexOf(openRow.student.id) + d] : undefined;
    return next ?? null;
  };

  return (
    <div className="fv-panel lq-panel te-fac">
      <div className="fv-topbar te-rtop">
        <button type="button" className="fv-back" aria-label="Back to overview" onClick={onBack}>
          <Ic name="chevronLeft" size={16} />
        </button>
        <div className="te-rtitle">
          <h1 className="fv-display">{activity.title}</h1>
          <span className="fv-sub" role="status">
            {status.join(" · ")}
          </span>
        </div>
        <div className="te-ractions">
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
        {rows.length === 0 ? (
          <p className="fv-sub">No students yet.</p>
        ) : (
          <>
            <div className="fv-seg te-viewseg" role="tablist">
              <button type="button" role="tab" aria-selected={view === "cards"} className={view === "cards" ? "on" : ""} onClick={() => setView("cards")}>
                Cards
              </button>
              <button type="button" role="tab" aria-selected={view === "table"} className={view === "table" ? "on" : ""} onClick={() => setView("table")}>
                Table
              </button>
            </div>
            {view === "cards" ? (
              <TeamCards groups={groups} onOpen={setOpenId} />
            ) : (
              <ResultsTable
                groups={groups}
                snap={snap}
                pointsTotal={activity.points_total}
                canFlag={data.can.grade}
                busy={busy}
                onFlag={(r) => void flag(r)}
                onOpen={setOpenId}
              />
            )}
          </>
        )}
      </div>

      {openRow ? (
        <StudentPanel
          row={openRow}
          snap={snap}
          pointsTotal={activity.points_total}
          canFlag={data.can.grade}
          busy={busy}
          onFlag={() => void flag(openRow)}
          onClose={() => setOpenId(null)}
          prev={step(-1)}
          next={step(1)}
          onGo={setOpenId}
        />
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------ team cards

function TeamCards({ groups, onOpen }: { groups: TeamGroup[]; onOpen: (id: string) => void }) {
  return (
    <div className="te-cards">
      {groups.map((g) => (
        <section key={g.team?.id ?? "none"} className="fv-card te-teamcard">
          <header className="te-teamhead">
            <h3 className="te-h3">{g.team?.name ?? "No team"}</h3>
            <span className="fv-sub">
              {g.rows.filter((r) => r.submission).length}/{g.rows.length} submitted
            </span>
          </header>
          <ul className="te-members">
            {g.rows.map((r) => (
              <li key={r.student.id}>
                <button type="button" className="te-member" onClick={() => onOpen(r.student.id)}>
                  <span className="te-person">
                    <FAvatar name={r.student.name} tint={r.student.avatar_tint} size={24} />
                    <span className="te-membername">{r.student.name}</span>
                  </span>
                  <ScoreTrack team={r.overall} self={r.selfOverall} label={`${r.student.name}: teammates ${fmtAvg(r.overall)}, self ${fmtAvg(r.selfOverall)}`} />
                  <span className={`te-memberavg${low(r.overall) ? " low" : ""}`}>{fmtAvg(r.overall)}</span>
                  <span className="te-memberflags">
                    {!r.submission && g.team ? <span className="te-chip-flag missing">Missing</span> : r.late ? <span className="te-chip-flag late">Late</span> : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <p className="fv-sub te-legend">
        <span className="te-key-dot team" /> teammates’ average <span className="te-key-dot self" /> self
      </p>
    </div>
  );
}

// --------------------------------------------------------- student panel

function StudentPanel({
  row,
  snap,
  pointsTotal,
  canFlag,
  busy,
  onFlag,
  onClose,
  prev,
  next,
  onGo,
}: {
  row: ResultRow;
  snap: TeamEvalSnapshot;
  pointsTotal: number;
  canFlag: boolean;
  busy: string | null;
  onFlag: () => void;
  onClose: () => void;
  prev: string | null;
  next: string | null;
  onGo: (id: string) => void;
}) {
  const id = row.student.id;
  const submitted = new Set(snap.submissions.map((s) => s.student_id));
  const mates = (row.team?.members ?? []).filter((m) => m.id !== id);
  const nameOf = (sid: string) => row.team?.members.find((m) => m.id === sid)?.name ?? "A teammate";
  const first = (name: string) => name.split(/\s+/)[0];
  const peerQs = snap.questions.filter((q) => q.audience === "peer");
  const reflection = submitted.has(id)
    ? snap.questions
        .filter((q) => q.audience === "self")
        .flatMap((q) => {
          const c = snap.comments.find((x) => x.question_id === q.id && x.author_id === id && x.subject_id === id);
          return c ? [{ q, body: c.body }] : [];
        })
    : [];

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight" && next) onGo(next);
      if (e.key === "ArrowLeft" && prev) onGo(prev);
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onClose, onGo, next, prev]);

  return (
    <div className="te-sheetwrap" role="dialog" aria-modal="true" aria-label={row.student.name}>
      <button type="button" className="te-sheetback" aria-label="Close" onClick={onClose} />
      <aside className="te-sheet">
        <header className="te-sheethead">
          <span className="te-person">
            <FAvatar name={row.student.name} tint={row.student.avatar_tint} size={32} />
            <span>
              <b className="te-sheetname">{row.student.name}</b>
              <span className="fv-sub te-sheetsub">{row.team?.name ?? "No team"}</span>
            </span>
          </span>
          <span className="te-sheetnav">
            <button type="button" className="fv-iconbtn" aria-label="Previous student" disabled={!prev} onClick={() => prev && onGo(prev)}>
              <Ic name="chevronLeft" size={16} />
            </button>
            <button type="button" className="fv-iconbtn" aria-label="Next student" disabled={!next} onClick={() => next && onGo(next)}>
              <Ic name="chevronRight" size={16} />
            </button>
            <button type="button" className="fv-iconbtn" aria-label="Close" onClick={onClose}>
              <Ic name="close" size={16} />
            </button>
          </span>
        </header>

        <div className="te-sheetbody">
          <div className="te-sheetstatus">
            <span>{row.submission ? `Submitted ${fmtWhen(row.submission.submitted_at)}` : "Not submitted"}</span>
            {row.submission ? (
              <button
                type="button"
                className={`te-flag${row.late ? " on" : ""}`}
                disabled={!canFlag || busy !== null}
                aria-pressed={row.late}
                onClick={onFlag}
              >
                <Ic name="flag" size={13} /> {row.late ? "Late" : "Flag late"}
              </button>
            ) : null}
            <span className="te-sheetgrade">
              <b className="fv-num">{fmtPoints(row.grade)}</b>
              <span className="fv-sub"> / {fmtPoints(pointsTotal)}</span>
            </span>
          </div>

          <section className="te-sheetsec">
            <h3 className="te-h3">Scores</h3>
            <div className="te-scorerows">
              {snap.categories.map((c, i) => {
                const cat = row.categories[i];
                const given = mates.flatMap((m) => {
                  const r = snap.ratings.find((x) => x.category_id === c.id && x.rater_id === m.id && x.ratee_id === id);
                  return r && submitted.has(m.id) ? [{ who: first(m.name), score: r.score, reason: r.reason }] : [];
                });
                return (
                  <div key={c.id} className="te-scorerow">
                    <div className="te-scorehead">
                      <span className="te-scorename">{c.name}</span>
                      <span className={`te-memberavg${low(cat.avg) ? " low" : ""}`}>{fmtAvg(cat.avg)}</span>
                    </div>
                    <div className="te-givers">
                      {given.map((g) => (
                        <span key={g.who} className="te-giver">
                          {g.who} <b className={`te-chip s${g.score}`}>{g.score}</b>
                        </span>
                      ))}
                      {cat.self !== null ? (
                        <span className="te-giver self">
                          Self <b className={`te-chip s${cat.self}`}>{cat.self}</b>
                        </span>
                      ) : null}
                    </div>
                    {given
                      .filter((g) => g.reason)
                      .map((g) => (
                        <p key={g.who} className="te-why-line">
                          <b>{g.who}:</b> {g.reason}
                        </p>
                      ))}
                  </div>
                );
              })}
            </div>
          </section>

          {peerQs.length ? (
            <section className="te-sheetsec">
              <h3 className="te-h3">What teammates said</h3>
              {peerQs.map((q) => {
                const said = snap.comments.filter(
                  (x) => x.question_id === q.id && x.subject_id === id && x.author_id !== id && submitted.has(x.author_id),
                );
                return (
                  <div key={q.id} className="te-cq">
                    <span className="te-prompt">{q.prompt}</span>
                    {said.length ? (
                      <ul>
                        {said.map((x) => (
                          <li key={x.author_id}>
                            <span className="te-by-name">{nameOf(x.author_id)}</span>
                            <p>{x.body}</p>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="fv-sub">Nothing yet</p>
                    )}
                  </div>
                );
              })}
            </section>
          ) : null}

          {reflection.length ? (
            <section className="te-sheetsec te-mine">
              <h3 className="te-h3">Their reflection</h3>
              {reflection.map((r) => (
                <div key={r.q.id} className="te-cq">
                  {reflection.length > 1 ? <span className="te-prompt">{r.q.prompt}</span> : null}
                  <p>{r.body}</p>
                </div>
              ))}
            </section>
          ) : null}
        </div>
      </aside>
    </div>
  );
}

// ----------------------------------------------------------------- table

function ResultsTable({
  groups,
  snap,
  pointsTotal,
  canFlag,
  busy,
  onFlag,
  onOpen,
}: {
  groups: ReturnType<typeof buildResults>;
  snap: TeamEvalSnapshot;
  pointsTotal: number;
  canFlag: boolean;
  busy: string | null;
  onFlag: (r: ResultRow) => void;
  onOpen: (id: string) => void;
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
            <GroupRows key={g.team?.id ?? "none"} g={g} cats={cats} penalty={snap.settings.late_penalty} canFlag={canFlag} busy={busy} onFlag={onFlag} onOpen={onOpen} />
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
  onOpen,
}: {
  g: ReturnType<typeof buildResults>[number];
  cats: TeamEvalSnapshot["categories"];
  penalty: number;
  canFlag: boolean;
  busy: string | null;
  onFlag: (r: ResultRow) => void;
  onOpen: (id: string) => void;
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
            <button type="button" className="te-person te-linkname" onClick={() => onOpen(r.student.id)}>
              <FAvatar name={r.student.name} tint={r.student.avatar_tint} size={22} />
              {r.student.name}
            </button>
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

