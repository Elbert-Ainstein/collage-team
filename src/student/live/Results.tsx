"use client";

// After the instructor closes the session: how they did on their own, how the
// team did, and each question's answer beside both of theirs — the team's as
// every try it took, what that question earned it, and why the answer is the
// answer when the instructor wrote that down (0051).

import type { TeamWithMembers } from "@/checkins/types";
import { fmtPoints, type LiveModel } from "@/live/model";
import { Pick, Tries } from "@/live/ui";
import { Explanation } from "./Explanation";

export function Results({ m, team: onTeam, meId }: { m: LiveModel; team: TeamWithMembers | null; meId: string }) {
  // Released without team mode (0053): there's no team half to show, and a 0
  // for a session that never happened would read as a grade.
  const team = m.state.team_skipped ? null : onTeam;
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
            <span className="fv-eyebrow">{absent ? `${team.name} · Absent` : `${team.name}, together`}</span>
            <span className="lq-statnum fv-num">
              {fmtPoints(together)}
              <small>/{N}</small>
            </span>
          </div>
        ) : null}
      </div>
      <div className="lq-sreslist">
        {m.questions.map((q, i) => {
          const mine = m.own(meId, i);
          const first = team ? m.tries(team.id, i)[0]?.answer ?? null : null;
          const on = team ? m.rightOn(team.id, i) : null;
          const credit = team ? m.credit(team.id, i) : null;
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
                    Team <Tries m={m} teamId={team.id} q={i} />
                    {credit !== null ? <span className="lq-credit fv-num">{fmtPoints(credit)}</span> : null}
                  </span>
                ) : null}
                {/* Said beside the team's; with no team, there's nothing to set it against. */}
                {team ? (
                  <span className="fv-sub">
                    {mine && mine === first
                      ? "Team went with yours"
                      : on === 1 && !mineRight
                        ? "Team got there"
                        : mineRight && on !== 1
                          ? "You had it"
                          : ""}
                  </span>
                ) : null}
              </div>
              <Explanation body={m.explanation(i)} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
