"use client";

// After the instructor closes the session: how they did on their own and how
// the team did, every question in a list, and Review answers — which goes
// through them one at a time the way they were answered, the right answer
// and why under each (ReviewQuestion). Try them again goes through them
// fresh, checked here and saved nowhere (Practice).

import { useState } from "react";
import type { TeamWithMembers } from "@/checkins/types";
import { fmtPoints, type LiveModel } from "@/live/model";
import { Ic, Pick } from "@/live/ui";
import { Practice } from "./Practice";
import { ReviewQuestion } from "./ReviewQuestion";

export function Results({ m, team: onTeam, meId }: { m: LiveModel; team: TeamWithMembers | null; meId: string }) {
  // Released without team mode (0053): there's no team half to show, and a 0
  // for a session that never happened would read as a grade.
  const team = m.state.team_skipped ? null : onTeam;
  // Null: the summary. Otherwise the question being reviewed.
  const [at, setAt] = useState<number | null>(null);
  const [practising, setPractising] = useState(false);
  const N = m.questions.length;
  const own = m.ownScore(meId);
  // Marked absent by the team's leader (0051) or on the sheet: the team's
  // points went to the people in the room, as 0031 has it, and not to them.
  const absent = team !== null && m.isAbsent(meId);
  const together = m.memberScore(meId);

  if (own === null) {
    return (
      <div className="lq-sscroll">
        <div className="lq-scard">
          <h2 className="lq-h2">Session closed</h2>
          <p className="fv-sub">Your results will show here soon.</p>
        </div>
      </div>
    );
  }

  if (practising && N > 0) {
    return <Practice m={m} onDone={() => setPractising(false)} />;
  }

  if (at !== null && at < N) {
    return <ReviewQuestion m={m} team={team} meId={meId} q={at} onGo={setAt} onDone={() => setAt(null)} />;
  }

  return (
    <>
      <div className="lq-sscroll">
        <div className="lq-sresults">
          <div className="lq-stat own">
            <span className="fv-eyebrow">You, on your own</span>
            <span className="lq-statnum fv-num">
              {own}
              <small>/{N}</small>
            </span>
          </div>
          {team && together !== null ? (
            <div className="lq-stat team">
              <span className="fv-eyebrow">{absent ? `${team.name} · Absent` : `${team.name}, together`}</span>
              <span className="lq-statnum fv-num">
                {fmtPoints(together)}
                <small>/{N}</small>
              </span>
            </div>
          ) : null}
        </div>
        <div className="lq-reviewlist">
          {m.questions.map((q, i) => {
            const mine = m.own(meId, i);
            return (
              <button key={q.id} type="button" className="lq-reviewrow" onClick={() => setAt(i)}>
                <span className="lq-qn">Q{i + 1}</span>
                <span className="lq-qshort">{q.stem}</span>
                <Pick value={mine} right={mine ? m.right(i, mine) : undefined} size="sm" />
              </button>
            );
          })}
        </div>
      </div>
      <footer className="lq-sfoot">
        <button type="button" className="fv-btn outline" disabled={N === 0} onClick={() => setPractising(true)}>
          Try them again
        </button>
        <button type="button" className="fv-btn primary" disabled={N === 0} onClick={() => setAt(0)}>
          Review answers <Ic name="chevronRight" size={15} />
        </button>
      </footer>
    </>
  );
}
