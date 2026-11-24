"use client";

// A team evaluation's results, on a page of their own.
//
// Every team as a card, each member on a 1–5 line: their teammates' average
// and what they gave themselves. Clicking anyone opens their own page — each
// teammate's scores in a table, every comment about them, their
// reflection — with previous and next to walk the class. The full table is
// one toggle away. Releasing and sending to the gradebook live here, beside
// the scores they decide.
//
// Staff always see names; anonymity is a promise to students about each
// other, kept by team_eval_results (0058). The one exception is the notes
// students leave the instructor: those arrive without names (0060), under
// the scores.

import { useEffect, useMemo, useState } from "react";
import type { Activity } from "@/checkins/types";
import { teamsOf } from "@/checkins/rosters";
import { releaseTeamEval, scoreTeamEval, setTeamEvalLate } from "@/teameval/data";
import { buildResults, fmtAvg, fmtPoints, outOf, type ResultRow, type TeamGroup } from "@/teameval/model";
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
    () => buildResults({ snapshot: snap, teams, roster: data.roster, dueAt }),
    [snap, teams, data.roster, dueAt],
  );
  const total = outOf(snap.categories);
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
      const sent = r.status === "scored" ? "Sent" : "Sent for review";
      // Submitted, but no teammate did: nothing to grade them on yet.
      setScored(r.unrated ? `${sent} · ${r.unrated} not rated yet` : sent);
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

  if (openRow) {
    return (
      <StudentPage
        row={openRow}
        snap={snap}
        pointsTotal={total}
        canFlag={data.can.grade}
        busy={busy}
        onFlag={() => void flag(openRow)}
        onBack={() => setOpenId(null)}
        prev={step(-1)}
        next={step(1)}
        onGo={setOpenId}
      />
    );
  }

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
                pointsTotal={total}
                canFlag={data.can.grade}
                busy={busy}
                onFlag={(r) => void flag(r)}
                onOpen={setOpenId}
              />
            )}
          </>
        )}
        <NotesToYou snap={snap} />
      </div>

    </div>
  );
}

// ------------------------------------------------------- notes to the instructor

/** What students left the instructor: no names, in no order (0060). Nothing at all when the form asks for none. */
function NotesToYou({ snap }: { snap: TeamEvalSnapshot }) {
  const asked = snap.questions.filter((q) => q.audience === "instructor");
  if (!asked.length) return null;
  return (
    <section className="te-notes" aria-label="Notes to you">
      <div className="te-qboxhead">
        <h2 className="te-h2">Notes to you</h2>
        <span className="te-reads">
          <Ic name="eyeOff" size={13} />
          Anonymous
        </span>
      </div>
      {asked.map((q) => {
        const said = snap.notes.filter((n) => n.question_id === q.id);
        return (
          <div key={q.id} className="te-cq">
            {asked.length > 1 ? <span className="te-prompt">{q.prompt}</span> : null}
            {said.length ? (
              <ul>
                {said.map((n) => (
                  <li key={n.id}>
                    <p>{n.body}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="fv-sub">None yet</p>
            )}
          </div>
        );
      })}
    </section>
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
                  <ScoreTrack team={r.overall} label={`${r.student.name}: teammates’ average ${fmtAvg(r.overall)}`} />
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
        <span className="te-key-dot team" /> teammates’ average across categories, out of 5
      </p>
    </div>
  );
}

// ---------------------------------------------------------- student page

function StudentPage({
  row,
  snap,
  pointsTotal,
  canFlag,
  busy,
  onFlag,
  onBack,
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
  onBack: () => void;
  prev: string | null;
  next: string | null;
  onGo: (id: string) => void;
}) {
  const id = row.student.id;
  const submitted = new Set(snap.submissions.map((s) => s.student_id));
  const mates = (row.team?.members ?? []).filter((m) => m.id !== id);
  const nameOf = (sid: string) => row.team?.members.find((m) => m.id === sid)?.name ?? "A teammate";
  const first = (name: string) => name.split(/\s+/)[0];
  const scoreOf = (raterId: string, categoryId: string) =>
    submitted.has(raterId)
      ? snap.ratings.find((x) => x.category_id === categoryId && x.rater_id === raterId && x.ratee_id === id) ?? null
      : null;
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
      if (e.target instanceof HTMLElement && /input|textarea|select/i.test(e.target.tagName)) return;
      if (e.key === "Escape") onBack();
      if (e.key === "ArrowRight" && next) onGo(next);
      if (e.key === "ArrowLeft" && prev) onGo(prev);
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onBack, onGo, next, prev]);

  return (
    <div className="fv-panel lq-panel te-fac">
      <div className="fv-topbar te-rtop">
        <button type="button" className="fv-back" aria-label="Back to results" onClick={onBack}>
          <Ic name="chevronLeft" size={16} />
        </button>
        <div className="te-rtitle">
          <h1 className="fv-display">{row.student.name}</h1>
          <span className="fv-sub">
            {row.team?.name ?? "No team"} · {row.submission ? `Submitted ${fmtWhen(row.submission.submitted_at)}` : "Not submitted"}
          </span>
        </div>
        <div className="te-ractions">
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
          <span className="te-grade" title={gradeNote(row, snap.settings.late_penalty)}>
            <b className="fv-num">{row.grade === null ? "—" : fmtPoints(row.grade)}</b>
            <span className="fv-sub"> / {fmtPoints(pointsTotal)}</span>
          </span>
          <button type="button" className="fv-iconbtn" aria-label="Previous student" disabled={!prev} onClick={() => prev && onGo(prev)}>
            <Ic name="chevronLeft" size={16} />
          </button>
          <button type="button" className="fv-iconbtn" aria-label="Next student" disabled={!next} onClick={() => next && onGo(next)}>
            <Ic name="chevronRight" size={16} />
          </button>
        </div>
      </div>

      <div className="fv-scroll lq-scroll">
        <div className="te-sgrid">
          <section>
            <h2 className="te-h2 te-first">Scores</h2>
            <div className="te-tblwrap">
              <table className="fv-tbl te-tbl te-stable">
                <thead>
                  <tr>
                    <th>Category</th>
                    {mates.map((m) => (
                      <th key={m.id} className={`te-num${submitted.has(m.id) ? "" : " te-muted"}`} title={submitted.has(m.id) ? undefined : "Hasn’t submitted"}>
                        {first(m.name)}
                      </th>
                    ))}
                    <th className="te-num te-avgcol">Teammates’ avg</th>
                    <th className="te-num te-selfcol">Self</th>
                  </tr>
                </thead>
                <tbody>
                  {snap.categories.map((c, i) => {
                    const cat = row.categories[i];
                    return (
                      <tr key={c.id}>
                        <td>{c.name}</td>
                        {mates.map((m) => {
                          const r = scoreOf(m.id, c.id);
                          return (
                            <td key={m.id} className="te-num">
                              {r ? r.score : <span className="fv-sub">—</span>}
                            </td>
                          );
                        })}
                        <td className="te-num te-avgcol">
                          <span className="te-avg">{fmtAvg(cat.avg)}</span>
                        </td>
                        {/* Apart from the average, which never counts it. */}
                        <td className="te-num te-selfcol">{cat.self ?? "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="te-totalrow">
                    <td colSpan={mates.length + 1}>Total</td>
                    <td className="te-num te-avgcol">
                      <b className="fv-num">{row.points === null ? "—" : fmtPoints(row.points)}</b>
                      <span className="fv-sub"> / {fmtPoints(pointsTotal)}</span>
                    </td>
                    <td className="te-selfcol" />
                  </tr>
                </tfoot>
              </table>
            </div>
            {row.late && row.points !== null && row.grade !== null ? (
              <p className="fv-sub te-gradenote">
                Late: −{fmtPoints(snap.settings.late_penalty)}% → {fmtPoints(row.grade)}
              </p>
            ) : null}
          </section>

          <section>
            {peerQs.length ? (
              <>
                <h2 className="te-h2 te-first">What teammates said</h2>
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
              </>
            ) : null}

            {reflection.length ? (
              <>
                <h2 className="te-h2">Their reflection</h2>
                {reflection.map((r) => (
                  <div key={r.q.id} className="te-cq te-mine">
                    {reflection.length > 1 ? <span className="te-prompt">{r.q.prompt}</span> : null}
                    <p>{r.body}</p>
                  </div>
                ))}
              </>
            ) : null}
          </section>
        </div>
      </div>
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
            <th className="te-namecol" rowSpan={2}>
              Student
            </th>
            <th className="te-groupth" colSpan={cats.length}>
              Teammates’ average <span className="te-groupsub">out of 5</span>
            </th>
            <th rowSpan={2}>Submitted</th>
            <th rowSpan={2}>Late</th>
            <th className="te-num" rowSpan={2}>
              Grade /{fmtPoints(pointsTotal)}
            </th>
          </tr>
          <tr>
            {cats.map((c) => (
              <th key={c.id} className="te-num te-catth">
                {c.name}
              </th>
            ))}
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
        <td colSpan={cats.length + 4}>
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
            <td key={cats[i].id} className="te-num" title={c.n ? `${c.n} rater${c.n === 1 ? "" : "s"}` : undefined}>
              <span className="te-avg">{fmtAvg(c.avg)}</span>
            </td>
          ))}
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
          <td className="te-num" title={gradeNote(r, penalty)}>
            <span className="fv-num">{r.grade === null ? "—" : fmtPoints(r.grade)}</span>
          </td>
        </tr>
      ))}
    </>
  );
}


/** How a grade came to be, for a tooltip. */
function gradeNote(r: ResultRow, penalty: number): string {
  if (!r.submission) return "Didn’t submit: 0";
  if (r.points === null) return "No teammate has rated them yet";
  const sum = `Sum of averages ${fmtPoints(r.points)}`;
  return r.late ? `${sum}, less ${fmtPoints(penalty)}% late` : sum;
}
