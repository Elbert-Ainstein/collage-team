"use client";

// After the instructor closes the session: how they did on their own, how the
// team did, and each question's answer beside both of theirs.

import type { TeamWithMembers } from "@/checkins/types";
import type { LiveModel } from "@/live/model";
import { Pick } from "@/live/ui";

export function Results({ m, team, meId }: { m: LiveModel; team: TeamWithMembers | null; meId: string }) {
  const N = m.questions.length;
  const own = m.ownScore(meId);
  const together = team ? m.score(team.id) : null;
  const locks = team ? m.locks(team.id) : m.questions.map(() => null);

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

  return (
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
            <span className="fv-eyebrow">{team.name}, together</span>
            <span className="lq-statnum fv-num">
              {together}
              <small>/{N}</small>
            </span>
          </div>
        ) : null}
      </div>
      <div className="lq-sreslist">
        {m.questions.map((q, i) => {
          const mine = m.own(meId, i);
          const t = locks[i]?.answer ?? null;
          const key = m.key(i);
          const keyText =
            q.kind === "mc"
              ? key?.correct_option !== null && key?.correct_option !== undefined
                ? q.options[key.correct_option]
                : null
              : q.kind === "number"
                ? key?.answer !== null && key?.answer !== undefined
                  ? m.label(i, String(key.answer))
                  : null
                : key?.accept[0] ?? null;
          const mineRight = mine ? m.right(i, mine) : false;
          const teamRight = t ? m.right(i, t) : false;
          return (
            <div key={q.id} className="lq-scard lq-sres">
              <div className="lq-sreshead">
                <span className="lq-qn">Q{i + 1}</span>
                <span className="lq-qshort">{q.stem}</span>
              </div>
              {keyText ? (
                <div className="lq-sresanswer">
                  {q.kind === "mc" && key?.correct_option != null ? <Pick value={String.fromCharCode(65 + key.correct_option)} size="sm" /> : null}
                  <span>{keyText}</span>
                </div>
              ) : null}
              <div className="lq-srespicks">
                <span>
                  You <Pick value={mine} right={mine ? mineRight : undefined} size="sm" />
                </span>
                {team ? (
                  <span>
                    Team <Pick value={t} right={t ? teamRight : undefined} size="sm" />
                  </span>
                ) : null}
                <span className="fv-sub">
                  {mine && mine === t ? "Team went with yours" : teamRight && !mineRight ? "Team got there" : mineRight && !teamRight ? "You had it" : ""}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
