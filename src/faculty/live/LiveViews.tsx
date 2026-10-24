"use client";

// What the instructor reads about a live activity, every view from one
// LiveModel (src/live/model.ts): teams live and scored, one team, the class
// question by question, every student, one student, one student's question.
//
// `reveal` is the "Answers shown / hidden" switch: with it off nothing on
// screen says right or wrong, so the page can be projected mid-class. Teams
// are told right or wrong as they submit and try again (0049), so a team's
// answers say which one is right — with it off they're hidden too, and only
// how many tries a team has had shows.

import { useState } from "react";
import type { Student, TeamWithMembers } from "@/checkins/types";
import { optionLetter } from "@/live/answers";
import { fmtPoints, mmss, outcomeOf, type LiveModel } from "@/live/model";
import { Av, Ic, LiveDot, Pick, Tries, voteSummary } from "@/live/ui";

/** Seconds on one question before a card asks for a look. */
const LONG = 150;

const firstName = (name: string) => name.split(/\s+/)[0] ?? name;
export const shortStem = (stem: string) => {
  const one = stem.replace(/\s+/g, " ").trim();
  return one.length > 64 ? `${one.slice(0, 62).trimEnd()}…` : one || "Untitled question";
};

const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const a = [...xs].sort((x, y) => x - y);
  return a[Math.floor(a.length / 2)];
};

const agreed = (votes: (string | null)[]): string | null => {
  const first = votes[0];
  return first && votes.every((v) => v === first) ? first : null;
};

const tryWord = (n: number) => (n === 1 ? "1 try" : `${n} tries`);

/** The team's first try at each question: what it agreed on before it was told anything. */
const firstTries = (m: LiveModel, teamId: string | null): (string | null)[] =>
  m.questions.map((_, q) => (teamId ? m.tries(teamId, q)[0]?.answer ?? null : null));

/** Seconds a team took on question q: from the lock before it (in time) to this one. */
function lockSeconds(m: LiveModel, teamId: string, q: number): number | null {
  const lock = m.locks(teamId)[q];
  const started = m.state.team_started_at ? Date.parse(m.state.team_started_at) : null;
  if (!lock || started === null) return null;
  const at = Date.parse(lock.locked_at);
  const before = m
    .locks(teamId)
    .filter((l) => l && Date.parse(l.locked_at) < at)
    .map((l) => Date.parse(l!.locked_at));
  return Math.max(0, Math.round((at - (before.length ? Math.max(...before) : started)) / 1000));
}

const avgOwn = (m: LiveModel, t: TeamWithMembers): number | null => {
  if (t.members.length === 0) return null;
  let sum = 0;
  for (const s of t.members) {
    const v = m.ownScore(s.id);
    if (v === null) return null;
    sum += v;
  }
  return sum / t.members.length;
};

export function Stat({ label, value, tone }: { label: string; value: string; tone?: "team" | "own" }) {
  return (
    <div className={`lq-stat${tone ? ` ${tone}` : ""}`}>
      <span className="fv-eyebrow">{label}</span>
      <span className="lq-statnum fv-num">{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------- teams

export function TeamsLive({ m, reveal, onTeam }: { m: LiveModel; reveal: boolean; onTeam: (id: string) => void }) {
  const [sort, setSort] = useState<"pace" | "team">("pace");
  const N = m.questions.length;

  if (m.state.phase === "individual") {
    return (
      <div className="lq-tgrid">
        {m.teams.map((t) => (
          <button key={t.id} type="button" className="lq-tcard" onClick={() => onTeam(t.id)}>
            <div className="lq-tcardhead">
              <span className="lq-tname">{t.name}</span>
              <span className="fv-sub fv-num">
                {t.members.filter((s) => m.answered(s.id) === N).length}/{t.members.length} submitted
              </span>
            </div>
            <div className="lq-memberprog">
              {t.members.map((s) => (
                <div key={s.id} className="lq-mp">
                  <Av p={s} size={22} />
                  <span className="lq-mpname">{firstName(s.name)}</span>
                  <span className="lq-mini">
                    {m.questions.map((q, i) => (
                      <i key={q.id} className={m.own(s.id, i) ? "on" : ""} />
                    ))}
                  </span>
                </div>
              ))}
            </div>
          </button>
        ))}
      </div>
    );
  }

  const done = m.teams.filter((t) => m.done(t.id) === N).length;
  const allDur = m.teams.flatMap((t) => m.durations(t.id));
  const stuck = m.teams.filter((t) => (m.current(t.id)?.since ?? 0) > LONG);
  const rows = [...m.teams].sort((a, b) => {
    if (sort === "team") return a.name.localeCompare(b.name, undefined, { numeric: true });
    const d = m.done(b.id) - m.done(a.id);
    if (d) return d;
    const fa = m.finishedAt(a.id);
    const fb = m.finishedAt(b.id);
    if (fa !== null && fb !== null) return fa - fb;
    return (m.current(a.id)?.since ?? 0) - (m.current(b.id)?.since ?? 0);
  });

  return (
    <>
      <div className="lq-gridhead">
        <span className="lq-chips">
          <span className="lq-chip fv-num">
            <b>
              {done}/{m.teams.length}
            </b>{" "}
            done
          </span>
          {allDur.length ? (
            <span className="lq-chip fv-num">
              <b>{mmss(median(allDur))}</b> per question
            </span>
          ) : null}
          {stuck.length ? (
            <span className="lq-chip warn">
              <b>{stuck.map((t) => t.name).join(", ")}</b> slow
            </span>
          ) : null}
        </span>
        <div className="fv-seg lq-sort">
          <button type="button" className={sort === "pace" ? "on" : ""} onClick={() => setSort("pace")}>
            By pace
          </button>
          <button type="button" className={sort === "team" ? "on" : ""} onClick={() => setSort("team")}>
            By team
          </button>
        </div>
      </div>
      <div className="lq-tgrid">
        {rows.map((t) => (
          <TeamCard key={t.id} m={m} team={t} reveal={reveal} onOpen={() => onTeam(t.id)} />
        ))}
      </div>
    </>
  );
}

function TeamCard({ m, team, reveal, onOpen }: { m: LiveModel; team: TeamWithMembers; reveal: boolean; onOpen: () => void }) {
  const locks = m.locks(team.id);
  const cur = m.current(team.id);
  const finished = m.finishedAt(team.id);
  const long = (cur?.since ?? 0) > LONG;
  const all = cur ? agreed(cur.votes) : null;
  const N = m.questions.length;
  const score = m.score(team.id);
  // Wrong tries on the question it's on now.
  const missed = cur ? m.tries(team.id, cur.q) : [];
  return (
    <button type="button" className={`lq-tcard${long ? " warn" : ""}${finished !== null ? " done" : ""}`} onClick={onOpen}>
      <div className="lq-tcardhead">
        <span className="lq-tname">{team.name}</span>
        {finished !== null ? (
          <span className="lq-tstate done">
            Done · <span className="fv-num">{mmss(finished)}</span>
          </span>
        ) : cur ? (
          <span className={`lq-tstate${long ? " warn" : ""}`}>
            <LiveDot tone="team" />
            Q{cur.q + 1} · <span className="fv-num">{mmss(cur.since)}</span>
          </span>
        ) : null}
      </div>

      <div className="lq-pipsrow">
        <div className="lq-pips" aria-label={`${m.done(team.id)} of ${N} locked`}>
          {locks.map((l, q) => {
            const now = cur?.q === q;
            const tries = m.tries(team.id, q);
            const on = l && reveal ? m.rightOn(team.id, q) : null;
            const r = on === null ? null : on > 0;
            return (
              <span
                key={q}
                className={`lq-pip${l ? " locked" : ""}${now ? " now" : ""}${r === true ? " right" : r === false ? " wrong" : ""}`}
                title={
                  l
                    ? reveal
                      ? `Q${q + 1}: ${tries.map((t) => m.label(q, t.answer)).join(" → ")}`
                      : `Q${q + 1}: done in ${tryWord(tries.length)}`
                    : now && tries.length
                      ? `Q${q + 1}: ${tryWord(tries.length)} so far`
                      : `Q${q + 1}`
                }
              >
                {l ? (reveal ? l.answer : q + 1) : now ? "…" : ""}
                {r === null ? null : <span className="lq-sr">{r ? ", right" : ", not right"}</span>}
                {tries.length > 1 || (now && tries.length > 0) ? <sup className="lq-piptries fv-num">{tries.length}</sup> : null}
              </span>
            );
          })}
        </div>
        {finished !== null && reveal && score !== null ? (
          <span className="lq-tscore fv-num">
            {fmtPoints(score)}/{N}
          </span>
        ) : null}
      </div>

      <div className="lq-votes">
        {team.members.map((s, i) => (
          <span key={s.id} className="lq-vote">
            <Av p={s} size={24} />
            {cur ? <span className={`lq-votebadge${cur.votes[i] ? "" : " empty"}`}>{cur.votes[i] ?? "·"}</span> : null}
          </span>
        ))}
        <span className={`lq-votesum${all ? " agree" : ""}`}>
          {finished !== null
            ? "All done"
            : cur
              ? `${missed.length ? (reveal ? `Not ${missed.map((t) => t.answer).join(", ")} · ` : `Try ${missed.length + 1} · `) : ""}${
                  all ? `All on ${all}` : voteSummary(cur.votes, team.members.map((s) => firstName(s.name)))
                }`
              : ""}
        </span>
      </div>
    </button>
  );
}

export function TeamResults({ m, onTeam, onExport }: { m: LiveModel; onTeam: (id: string) => void; onExport?: () => void }) {
  const N = m.questions.length;
  const rows = m.teams
    .map((t) => {
      const own = avgOwn(m, t);
      const bests = t.members.map((s) => m.ownScore(s.id) ?? 0);
      return {
        team: t,
        score: m.score(t.id) ?? 0,
        own,
        best: bests.length ? Math.max(...bests) : 0,
        time: m.finishedAt(t.id),
      };
    })
    .sort((a, b) => b.score - a.score || (a.time ?? 1e9) - (b.time ?? 1e9));

  const known = rows.filter((r) => r.own !== null);
  const ownAvg = known.length ? known.reduce((sum, r) => sum + (r.own ?? 0), 0) / known.length : 0;
  const teamAvg = rows.length ? rows.reduce((sum, r) => sum + r.score, 0) / rows.length : 0;
  const beatBest = rows.filter((r) => r.score > r.best).length;

  return (
    <>
      <div className="lq-gridhead">
        <span className="lq-chips">
          <span className="lq-chip fv-num">
            Own <b>{ownAvg.toFixed(1)}</b>
          </span>
          <span className="lq-chip team fv-num">
            Team <b>{teamAvg.toFixed(1)}</b>
          </span>
          <span className="lq-chip fv-num">
            <b>
              {beatBest}/{rows.length}
            </b>{" "}
            beat their best member
          </span>
        </span>
        {onExport ? (
          <button type="button" className="fv-btn outline sm" onClick={onExport}>
            Export CSV
          </button>
        ) : null}
      </div>

      <div className="fv-card lq-table" role="table" aria-label="Team scores">
        <div className="lq-tr lq-th" role="row">
          <span role="columnheader">#</span>
          <span role="columnheader">Team</span>
          <span role="columnheader" className="r">
            Score
          </span>
          <span role="columnheader" className="r lq-hide-sm">
            Own avg
          </span>
          <span role="columnheader" className="lq-hide-sm">
            By question
          </span>
          <span role="columnheader" className="r lq-hide-xs">
            Time
          </span>
          <span />
        </div>
        {rows.map((r, i) => (
          <button key={r.team.id} type="button" className="lq-tr" role="row" onClick={() => onTeam(r.team.id)}>
            <span className="lq-rank fv-num">{i + 1}</span>
            <span className="lq-teamcell">
              <span className="lq-tname">{r.team.name}</span>
              <span className="lq-names">{r.team.members.map((s) => firstName(s.name)).join(", ")}</span>
            </span>
            <span className="r lq-bigscore fv-num">
              {fmtPoints(r.score)}
              <small>/{N}</small>
            </span>
            <span className="r fv-num fv-sub lq-hide-sm">{r.own === null ? "—" : r.own.toFixed(1)}</span>
            <span className="lq-hide-sm lq-qcells">
              {m.questions.map((_, q) => {
                const tries = m.tries(r.team.id, q);
                const on = m.rightOn(r.team.id, q);
                return (
                  <Pick
                    key={q}
                    value={tries[tries.length - 1]?.answer ?? null}
                    right={tries.length && on !== null ? on > 0 : null}
                    tries={tries.length}
                    size="sm"
                  />
                );
              })}
            </span>
            <span className="r fv-num fv-sub lq-hide-xs">{r.time !== null ? mmss(r.time) : "Didn’t finish"}</span>
            <span className="lq-chev">
              <Ic name="chevronRight" size={16} />
            </span>
          </button>
        ))}
      </div>
    </>
  );
}

export function TeamDetail({
  m,
  teamId,
  reveal,
  onBack,
  onStudent,
}: {
  m: LiveModel;
  teamId: string;
  reveal: boolean;
  onBack: () => void;
  onStudent: (id: string) => void;
}) {
  const team = m.teams.find((t) => t.id === teamId);
  if (!team) return null;
  const N = m.questions.length;
  const locks = m.locks(teamId);
  const cur = m.current(teamId);
  const finished = m.finishedAt(teamId);
  const own = avgOwn(m, team);
  const score = m.score(teamId);
  return (
    <div className="lq-detail">
      <button type="button" className="lq-crumb" onClick={onBack}>
        <Ic name="chevronLeft" size={14} /> {m.state.phase === "closed" ? "Team scores" : "Teams"}
      </button>

      <div className="lq-dhead">
        <div>
          <h2 className="lq-h2">{team.name}</h2>
          <div className="lq-members">
            {team.members.map((s) => (
              <button key={s.id} type="button" className="lq-memberchip" onClick={() => onStudent(s.id)}>
                <Av p={s} size={22} />
                {s.name}
                <Ic name="chevronRight" size={13} />
              </button>
            ))}
          </div>
        </div>
        <div className="lq-dstats">
          {reveal && score !== null ? <Stat label="Together" value={`${fmtPoints(score)}/${N}`} tone="team" /> : null}
          {reveal && own !== null ? <Stat label="Avg on their own" value={`${own.toFixed(1)}/${N}`} /> : null}
          <Stat
            label={finished !== null ? "Time" : "Progress"}
            value={finished !== null ? mmss(finished) : `${m.done(teamId)}/${N} locked`}
          />
        </div>
      </div>

      <div className="lq-qrows">
        <div className="lq-qrow lq-qrowhead" aria-hidden="true">
          <span />
          <span>Each member, on their own</span>
          <span />
          <span>Team answer</span>
        </div>
        {m.questions.map((q, qi) => {
          const l = locks[qi];
          const live = cur?.q === qi ? cur : null;
          const tries = m.tries(teamId, qi);
          const credit = m.credit(teamId, qi);
          const trail = <Tries m={m} teamId={teamId} q={qi} size={tries.length > 1 ? "md" : "lg"} reveal={reveal} />;
          return (
            <div key={q.id} className={`lq-qrow${live ? " live" : ""}`}>
              <div className="lq-qrowq">
                <span className="lq-qn">Q{qi + 1}</span>
                <span className="lq-qshort">{shortStem(q.stem)}</span>
              </div>
              <div className="lq-ownpicks">
                {team.members.map((s) => {
                  const a = m.own(s.id, qi);
                  return (
                    <button key={s.id} type="button" className="lq-ownpick" onClick={() => onStudent(s.id)} title={s.name}>
                      <Av p={s} size={20} />
                      <Pick value={a} right={reveal && a ? m.right(qi, a) : undefined} size="sm" />
                    </button>
                  );
                })}
              </div>
              <span className="lq-arrow">
                <Ic name="arrowRight" size={16} />
              </span>
              <div className="lq-teampick">
                {l ? (
                  <>
                    {trail}
                    <span className="lq-teammeta fv-sub fv-num">
                      {reveal && credit !== null ? `${fmtPoints(credit)} pt · ` : ""}
                      {mmss(lockSeconds(m, teamId, qi) ?? 0)}
                    </span>
                  </>
                ) : live ? (
                  <>
                    {tries.length ? trail : null}
                    <span className="lq-livevotes">
                      {live.votes.map((v, i) => (
                        <span key={i} className="lq-vote">
                          <Av p={team.members[i]} size={20} />
                          <span className={`lq-votebadge${v ? "" : " empty"}`}>{v ?? "·"}</span>
                        </span>
                      ))}
                    </span>
                    <span className="lq-teammeta fv-sub">
                      <LiveDot tone="team" /> {mmss(live.since)}
                    </span>
                  </>
                ) : tries.length ? (
                  trail
                ) : (
                  <span className="fv-sub">{m.state.phase === "closed" ? "Not locked" : "—"}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ------------------------------------------------------------ questions

export function QuestionsView({ m, reveal }: { m: LiveModel; reveal: boolean }) {
  const showTeams = m.state.phase !== "individual";
  return (
    <div className="lq-qlist">
      {m.questions.map((q, qi) => {
        const own = new Map<string, number>();
        let ownN = 0;
        for (const s of m.students) {
          const a = m.own(s.id, qi);
          if (a) {
            own.set(a, (own.get(a) ?? 0) + 1);
            ownN++;
          }
        }
        // A team's first try: what it agreed on before it was told anything.
        // Later tries only say what was left once that was wrong.
        const team = new Map<string, number>();
        let teamN = 0;
        for (const t of m.teams) {
          const first = m.tries(t.id, qi)[0];
          if (first) {
            team.set(first.answer, (team.get(first.answer) ?? 0) + 1);
            teamN++;
          }
        }
        const rows =
          q.kind === "mc"
            ? q.options.map((_, i) => optionLetter(i))
            : [...new Set([...own.keys(), ...team.keys()])]
                .sort((a, b) => (own.get(b) ?? 0) + (team.get(b) ?? 0) - ((own.get(a) ?? 0) + (team.get(a) ?? 0)))
                .slice(0, 5);
        const shown = new Set(rows);
        const otherOwn = [...own.entries()].filter(([a]) => !shown.has(a)).reduce((n, [, c]) => n + c, 0);
        const otherTeam = [...team.entries()].filter(([a]) => !shown.has(a)).reduce((n, [, c]) => n + c, 0);
        const rightOf = (entries: Map<string, number>) =>
          [...entries.entries()].filter(([a]) => m.right(qi, a) === true).reduce((n, [, c]) => n + c, 0);
        return (
          <article key={q.id} className="fv-card lq-qcard">
            <header className="lq-qhead">
              <span className="lq-qn">Q{qi + 1}</span>
              <p className="lq-qstem">{q.stem}</p>
            </header>
            <div className="lq-qlegend">
              <span>
                <i className="lq-sw own" /> On their own · <b className="fv-num">{ownN}</b>/{m.students.length}
                {reveal && ownN ? <em className="fv-num"> · {Math.round((100 * rightOf(own)) / ownN)}% right</em> : null}
              </span>
              {showTeams ? (
                <span>
                  <i className="lq-sw team" /> As teams, first try · <b className="fv-num">{teamN}</b>/{m.teams.length}
                  {reveal && teamN ? <em className="fv-num"> · {Math.round((100 * rightOf(team)) / teamN)}% right</em> : null}
                </span>
              ) : null}
            </div>
            <div className="lq-opts">
              {rows.length === 0 ? <div className="fv-sub">No answers yet.</div> : null}
              {rows.map((a, i) => {
                const right = reveal && m.right(qi, a) === true;
                return (
                  <div key={a} className={`lq-opt${right ? " right" : ""}${q.kind === "mc" ? "" : " num"}`}>
                    <span className="lq-optl">{q.kind === "mc" ? a : ""}</span>
                    {right ? <span className="lq-sr">The right answer:</span> : null}
                    <span className="lq-opttext">{q.kind === "mc" ? q.options[i] : m.label(qi, a)}</span>
                    <Bars own={own.get(a) ?? 0} ownN={ownN} team={team.get(a) ?? 0} teamN={teamN} showTeams={showTeams} />
                  </div>
                );
              })}
              {otherOwn + otherTeam > 0 ? (
                <div className="lq-opt num">
                  <span className="lq-optl" />
                  <span className="lq-opttext fv-sub">Other answers</span>
                  <Bars own={otherOwn} ownN={ownN} team={otherTeam} teamN={teamN} showTeams={showTeams} />
                </div>
              ) : null}
            </div>
          </article>
        );
      })}
    </div>
  );
}

function Bars({ own, ownN, team, teamN, showTeams }: { own: number; ownN: number; team: number; teamN: number; showTeams: boolean }) {
  return (
    <span className="lq-bars">
      <span className="lq-bar">
        <span className="lq-trk">{own ? <i className="own" style={{ width: `max(3px, ${(100 * own) / ownN}%)` }} /> : null}</span>
        <b className="fv-num">{own}</b>
      </span>
      {showTeams ? (
        <span className="lq-bar">
          <span className="lq-trk">{team ? <i className="team" style={{ width: `max(3px, ${(100 * team) / teamN}%)` }} /> : null}</span>
          <b className="fv-num">{team}</b>
        </span>
      ) : null}
    </span>
  );
}

// ------------------------------------------------------------- students

export function StudentsView({ m, reveal, onStudent }: { m: LiveModel; reveal: boolean; onStudent: (id: string) => void }) {
  const [sort, setSort] = useState<"team" | "name">("team");
  const N = m.questions.length;
  const teamName = (s: Student) => m.teamOf(s.id)?.name ?? "No team";
  const rows = [...m.students].sort((a, b) =>
    sort === "name" ? a.name.localeCompare(b.name) : teamName(a).localeCompare(teamName(b), undefined, { numeric: true }),
  );
  const scored = reveal && m.state.phase !== "individual";
  return (
    <>
      <div className="lq-gridhead">
        <span />
        <div className="fv-seg lq-sort">
          <button type="button" className={sort === "team" ? "on" : ""} onClick={() => setSort("team")}>
            By team
          </button>
          <button type="button" className={sort === "name" ? "on" : ""} onClick={() => setSort("name")}>
            By name
          </button>
        </div>
      </div>
      <div className="fv-card lq-table lq-stable" role="table" aria-label="Students">
        <div className="lq-tr lq-th" role="row">
          <span role="columnheader">Student</span>
          <span role="columnheader" className="lq-hide-xs">
            Team
          </span>
          <span role="columnheader" className="r">
            {reveal ? "On their own" : "Answered"}
          </span>
          <span role="columnheader" className="r">
            {scored ? "With team" : ""}
          </span>
          <span role="columnheader" className="lq-hide-sm">
            Their answers
          </span>
          <span />
        </div>
        {rows.map((s) => {
          const team = m.teamOf(s.id);
          const own = reveal ? m.ownScore(s.id) : m.answered(s.id);
          const teamScore = team ? m.score(team.id) : null;
          return (
            <button key={s.id} type="button" className="lq-tr" role="row" onClick={() => onStudent(s.id)}>
              <span className="lq-namecell">
                <Av p={s} size={24} />
                {s.name}
              </span>
              <span className="fv-sub lq-hide-xs">{team?.name ?? "No team"}</span>
              <span className="r fv-num">{own === null ? "—" : `${own}/${N}`}</span>
              <span className="r fv-num lq-teamnum">{scored && teamScore !== null ? `${fmtPoints(teamScore)}/${N}` : ""}</span>
              <span className="lq-qcells lq-hide-sm">
                {m.questions.map((q, qi) => {
                  const a = m.own(s.id, qi);
                  return <Pick key={q.id} value={a} right={reveal && a ? m.right(qi, a) : undefined} size="sm" />;
                })}
              </span>
              <span className="lq-chev">
                <Ic name="chevronRight" size={16} />
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}

export function StudentDetail({
  m,
  studentId,
  reveal,
  backLabel,
  onBack,
  onTeam,
  onQuestion,
}: {
  m: LiveModel;
  studentId: string;
  reveal: boolean;
  backLabel: string;
  onBack: () => void;
  onTeam: (id: string) => void;
  onQuestion: (q: number) => void;
}) {
  const s = m.students.find((x) => x.id === studentId);
  if (!s) return null;
  const N = m.questions.length;
  const notYet = m.state.phase === "individual";
  const team = m.teamOf(studentId);
  const locks = team ? m.locks(team.id) : m.questions.map(() => null);
  const firsts = firstTries(m, team?.id ?? null);
  const matched = firsts.filter((a, q) => a !== null && a === m.own(studentId, q)).length;
  const tried = firsts.filter(Boolean).length;
  const ownScore = m.ownScore(studentId);
  const teamScore = team ? m.score(team.id) : null;
  return (
    <div className="lq-detail">
      <button type="button" className="lq-crumb" onClick={onBack}>
        <Ic name="chevronLeft" size={14} /> {backLabel}
      </button>

      <div className="lq-dhead">
        <div className="lq-person">
          <Av p={s} size={44} />
          <div>
            <h2 className="lq-h2">{s.name}</h2>
            {team ? (
              <button type="button" className="lq-linkbtn" onClick={() => onTeam(team.id)}>
                {team.name} <Ic name="chevronRight" size={13} />
              </button>
            ) : (
              <span className="fv-sub">No team</span>
            )}
          </div>
        </div>
        <div className="lq-dstats">
          {notYet ? (
            <>
              <Stat label="On their own" value={`${m.answered(studentId)}/${N} answered`} tone="own" />
              <Stat label={team ? `With ${team.name}` : "Team"} value="Not started" />
            </>
          ) : reveal && ownScore !== null ? (
            <>
              <Stat label="On their own" value={`${ownScore}/${N}`} tone="own" />
              <Stat label={team ? `With ${team.name}` : "Team"} value={teamScore === null ? "—" : `${fmtPoints(teamScore)}/${N}`} tone="team" />
            </>
          ) : (
            <Stat label="Answered on their own" value={`${m.answered(studentId)}/${N}`} tone="own" />
          )}
          {notYet ? null : <Stat label="Team went with theirs" value={tried ? `${matched} of ${tried}` : "—"} />}
        </div>
      </div>

      <div className="lq-qrows">
        <div className="lq-qrow lq-qrowhead lq-sd" aria-hidden="true">
          <span />
          <span>On their own</span>
          <span />
          <span>
            {team?.name ?? "Team"}
            {notYet ? <em className="lq-notyet">team mode not started</em> : null}
          </span>
          <span />
          <span />
        </div>
        {m.questions.map((q, qi) => {
          const own = m.own(studentId, qi);
          const l = locks[qi];
          const voting = !l && team && m.current(team.id)?.q === qi;
          const o = notYet
            ? { label: "Not answered as a team", tone: "muted" as const }
            : voting
              ? { label: "Team voting now", tone: "gain" as const }
              : !team || !firsts[qi]
                ? { label: "Team hasn’t locked this", tone: "muted" as const }
                : !reveal
                  ? { label: own === firsts[qi] ? "Team went with theirs" : "Team chose differently", tone: "muted" as const }
                  : outcomeOf(own ? m.right(qi, own) : false, m.rightOn(team.id, qi));
          return (
            <button key={q.id} type="button" className="lq-qrow lq-sd lq-clickrow" onClick={() => onQuestion(qi)}>
              <div className="lq-qrowq">
                <span className="lq-qn">Q{qi + 1}</span>
                <span className="lq-qshort">{shortStem(q.stem)}</span>
              </div>
              <div className="lq-sdpick">
                <Pick value={own} right={reveal && own ? m.right(qi, own) : undefined} size="lg" />
              </div>
              <span className="lq-arrow">
                <Ic name="arrowRight" size={16} />
              </span>
              <div className="lq-sdpick">
                {team ? <Tries m={m} teamId={team.id} q={qi} size="lg" reveal={reveal} /> : <Pick value={null} size="lg" />}
              </div>
              <span className={`lq-outcome ${o.tone}`}>{o.label}</span>
              <span className="lq-chev">
                <Ic name="chevronRight" size={16} />
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function StudentQuestion({
  m,
  studentId,
  q,
  reveal,
  onBack,
  onQuestion,
  onStudent,
}: {
  m: LiveModel;
  studentId: string;
  q: number;
  reveal: boolean;
  onBack: () => void;
  onQuestion: (q: number) => void;
  onStudent: (id: string) => void;
}) {
  const s = m.students.find((x) => x.id === studentId);
  const question = m.questions[q];
  if (!s || !question) return null;
  const N = m.questions.length;
  const team = m.teamOf(studentId);
  const own = m.own(studentId, q);
  const lock = team ? m.locks(team.id)[q] : null;
  const tries = team ? m.tries(team.id, q) : [];
  const live = team ? m.current(team.id) : null;
  const voting = live?.q === q ? live : null;
  const name = firstName(s.name);
  const text = (a: string) => (question.kind === "mc" ? question.options[a.charCodeAt(0) - 65] ?? a : m.label(q, a));
  const o =
    m.state.phase === "individual"
      ? { label: "Not answered as a team", tone: "muted" as const }
      : voting || !team || tries.length === 0
        ? { label: voting ? "Team voting now" : "Team hasn’t locked this", tone: "muted" as const }
        : reveal
          ? outcomeOf(own ? m.right(q, own) : false, m.rightOn(team.id, q))
          : { label: own === tries[0].answer ? "Team went with theirs" : "Team chose differently", tone: "muted" as const };

  // Rows: every option for multiple choice; for typed answers, what the class gave.
  const counts = new Map<string, number>();
  let given = 0;
  for (const st of m.students) {
    const a = m.own(st.id, q);
    if (a) {
      counts.set(a, (counts.get(a) ?? 0) + 1);
      given++;
    }
  }
  const rows =
    question.kind === "mc"
      ? question.options.map((_, i) => optionLetter(i))
      : [...new Set([...counts.keys(), ...(reveal ? tries.map((t) => t.answer) : [])])]
          .sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0))
          .slice(0, 6);

  return (
    <div className="lq-detail">
      <button type="button" className="lq-crumb" onClick={onBack}>
        <Ic name="chevronLeft" size={14} /> {s.name}
      </button>

      <div className="lq-sqhead">
        <div className="lq-person">
          <Av p={s} size={32} />
          <div>
            <div className="fv-eyebrow">
              {s.name}
              {team ? ` · ${team.name}` : ""}
            </div>
            <div className="lq-sqtitle">
              Question {q + 1} of {N}
            </div>
          </div>
        </div>
        <div className="lq-sqnav" role="group" aria-label="Other questions">
          <button type="button" className="fv-back" disabled={q === 0} aria-label="Previous question" onClick={() => onQuestion(q - 1)}>
            <Ic name="chevronLeft" size={15} />
          </button>
          {m.questions.map((qq, i) => (
            <button
              key={qq.id}
              type="button"
              className={`lq-sqpip${i === q ? " on" : ""}`}
              onClick={() => onQuestion(i)}
              aria-label={`Question ${i + 1}`}
              aria-current={i === q}
            >
              {i + 1}
            </button>
          ))}
          <button type="button" className="fv-back" disabled={q === N - 1} aria-label="Next question" onClick={() => onQuestion(q + 1)}>
            <Ic name="chevronRight" size={15} />
          </button>
        </div>
      </div>

      <p className="lq-sqstem">{question.stem}</p>

      <div className="lq-sqsum">
        <div className="lq-sqside">
          <span className="fv-eyebrow">{name}, on their own</span>
          <span className="lq-sqpick">
            <Pick value={own} right={reveal && own ? m.right(q, own) : undefined} size="lg" />
            <span>{own ? text(own) : "No answer"}</span>
          </span>
        </div>
        <span className="lq-arrow">
          <Ic name="arrowRight" size={18} />
        </span>
        <div className="lq-sqside team">
          <span className="fv-eyebrow">{team ? `${team.name}, together` : "No team"}</span>
          <span className="lq-sqpick">
            {team ? <Tries m={m} teamId={team.id} q={q} size="lg" reveal={reveal} /> : <Pick value={null} size="lg" />}
            <span>
              {lock
                ? reveal
                  ? text(lock.answer)
                  : "Done"
                : voting
                  ? "Voting now"
                  : m.state.phase === "individual"
                    ? "Team mode not started"
                    : "Not locked"}
            </span>
          </span>
        </div>
        <span className={`lq-outcome ${o.tone}`}>{o.label}</span>
      </div>

      <div className="fv-card lq-sqopts">
        <div className="lq-sqoptshead" aria-hidden="true">
          <span>{question.kind === "mc" ? "Options" : "Answers given"}</span>
          <span>{team ? `${team.name} on their own` : ""}</span>
          <span className="lq-hide-sm">Class</span>
        </div>
        {rows.map((a, i) => {
          const pickers = (team?.members ?? []).filter((st) => m.own(st.id, q) === a);
          const right = reveal && m.right(q, a) === true;
          const isOwn = own === a;
          // Which of the team's tries this was — hidden with the answers, since it says right or wrong.
          const teamTry = reveal ? tries.find((t) => t.answer === a) : undefined;
          const isTeam = teamTry !== undefined && (teamTry.correct ?? m.right(q, a)) === true;
          const voters = voting ? (team?.members ?? []).filter((_, vi) => voting.votes[vi] === a) : [];
          return (
            <div key={a} className={`lq-sqopt${isOwn ? " own" : ""}${isTeam ? " team" : ""}`}>
              <span className={`lq-optl${right ? " right" : ""}`}>{question.kind === "mc" ? a : ""}</span>
              {right ? <span className="lq-sr">The right answer:</span> : null}
              <span className="lq-sqopttext">
                {question.kind === "mc" ? question.options[i] : m.label(q, a)}
                <span className="lq-sqtags">
                  {isOwn ? <span className="lq-tag own">{name}’s answer</span> : null}
                  {isTeam ? (
                    <span className="lq-tag team">Team answer{teamTry.attempt > 1 ? `, try ${teamTry.attempt}` : ""}</span>
                  ) : teamTry ? (
                    <span className="lq-tag tried">Team tried</span>
                  ) : null}
                  {voters.length ? (
                    <span className="lq-tag live">
                      <LiveDot tone="team" /> {voters.length} voting
                    </span>
                  ) : null}
                </span>
              </span>
              <span className="lq-sqpickers">
                {pickers.map((st) => (
                  <button key={st.id} type="button" className="lq-sqpicker" onClick={() => onStudent(st.id)} title={st.name}>
                    <Av p={st} size={22} ring={st.id === studentId} />
                  </button>
                ))}
              </span>
              <span className="lq-sqclass fv-num lq-hide-sm">{given ? `${counts.get(a) ?? 0} of ${given}` : "—"}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
