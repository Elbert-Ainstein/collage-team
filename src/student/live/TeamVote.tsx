"use client";

// In class, as a team: everyone sees how each of them answered on their own,
// votes, and the team submits one answer at a time. Each try is marked right
// or wrong as it lands (0049); a wrong one is off the table and the team goes
// again, for less. Votes and tries go through the RPCs and come back over
// realtime, so every phone on the team shows the same thing.

import { useEffect, useRef, useState } from "react";
import type { TeamWithMembers } from "@/checkins/types";
import { canonicalAnswer, maxTries, normalizeNumber, optionLetter, TRY_CREDIT, tryCredit } from "@/live/answers";
import { castVote, lockTeamAnswer } from "@/live/data";
import { Figure } from "@/live/figure";
import { fmtPoints, type LiveModel } from "@/live/model";
import type { LiveQuestion } from "@/live/types";
import { Av, Cross, Ic, Pick, Tick, Tries, voteSummary } from "@/live/ui";
import { forStudent } from "./forStudent";

const MAX_TYPED_CHOICES = 8;
const TOAST_MS = 3200;

const firstName = (name: string) => name.split(/\s+/)[0] ?? name;

/** "1 point", "½ point", "no points". */
const worth = (n: number) => (n === 0 ? "no points" : `${fmtPoints(n)} point${n > 1 ? "s" : ""}`);

/** The rule, as it's said out loud: "1 point first try, then ½, then ¼". */
const RULE = `${fmtPoints(TRY_CREDIT[0])} point first try, then ${TRY_CREDIT.slice(1).map(fmtPoints).join(", then ")}`;

export function TeamIntro({ team, rule, onStart }: { team: TeamWithMembers; rule: "any" | "all"; onStart: () => void }) {
  return (
    <div className="lq-sscroll lq-center">
      <div className="lq-scard lq-intro">
        <span className="lq-introicon">
          <Ic name="groups" size={26} />
        </span>
        <h2 className="lq-h2">Sit with {team.name}</h2>
        <div className="lq-introteam">
          {team.members.map((s, i) => (
            <span key={s.id} className="lq-presence">
              <Av p={s} size={34} />
              <span>{i === 0 ? "You" : firstName(s.name)}</span>
            </span>
          ))}
        </div>
        <p className="lq-introline">
          {rule === "any"
            ? "See each other’s answers, agree, then one of you submits."
            : `See each other’s answers, then all ${team.members.length} pick the same one.`}
        </p>
        <p className="lq-introline lq-introrule">
          You’ll know straight away if it’s right. If it isn’t, try again — {RULE}.
        </p>
        <button type="button" className="fv-btn primary lq-teambtn" onClick={onStart}>
          Start <Ic name="arrowRight" size={16} />
        </button>
      </div>
    </div>
  );
}

function TeamPips({ m, team, current }: { m: LiveModel; team: TeamWithMembers; current: number }) {
  return (
    <div className="lq-spips">
      {m.locks(team.id).map((l, i) => {
        // The team was told as each try landed, so a finished question always shows how it went.
        const on = l ? m.rightOn(team.id, i) : null;
        const r = on === null ? null : on > 0;
        const short = l && l.answer.length <= 6;
        return (
          <span
            key={i}
            className={`lq-spip team${l ? " filled" : ""}${i === current ? " now" : ""}${r === true ? " right" : r === false ? " wrong" : ""}`}
            aria-label={`Question ${i + 1}${l ? (r === true ? `, right on try ${on}` : r === false ? ", not got" : ", done") : ""}`}
          >
            {!l ? i + 1 : short ? l.answer : r === true ? <Tick size={12} /> : r === false ? <Cross size={12} /> : "✓"}
          </span>
        );
      })}
    </div>
  );
}

/** For a typed answer: what's on the table — everyone's own answer and every vote. */
function typedChoices(m: LiveModel, team: TeamWithMembers, q: number, votes: (string | null)[]): string[] {
  const seen: string[] = [];
  for (const a of [...team.members.map((s) => m.own(s.id, q)), ...votes]) {
    if (a && !seen.includes(a)) seen.push(a);
  }
  return seen.slice(0, MAX_TYPED_CHOICES);
}

interface Toast {
  q: number;
  answer: string;
  by: string;
  right: boolean | null;
  attempt: number;
  /** That was the team's last go at it. */
  done: boolean;
}

export function TeamQuestion({
  m,
  team,
  onError,
  onTried,
}: {
  m: LiveModel;
  team: TeamWithMembers;
  onError: (message: string) => void;
  /** A try went in: read the session now rather than wait for realtime, so the verdict shows at once. */
  onTried: () => Promise<void> | void;
}) {
  const cur = m.current(team.id);
  const [pending, setPending] = useState<{ q: number; answer: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  // The vote on its way to the server, so a submit right after a tap sends the answer on screen.
  const voting = useRef<Promise<void> | null>(null);

  // A try from anyone on the team: say how it went for a moment.
  const allTries = m.questions.reduce((n, _, i) => n + m.tries(team.id, i).length, 0);
  const lastTries = useRef(allTries);
  useEffect(() => {
    if (allTries > lastTries.current) {
      const newest = m.questions
        .flatMap((_, i) => m.tries(team.id, i).map((t) => ({ t, i })))
        .sort((a, b) => Date.parse(b.t.locked_at) - Date.parse(a.t.locked_at))[0];
      if (newest) {
        const who = team.members.find((s) => s.id === newest.t.locked_by);
        setToast({
          q: newest.i,
          answer: newest.t.answer,
          by: !who ? "your team" : who.id === team.members[0].id ? "you" : firstName(who.name),
          right: newest.t.correct ?? m.right(newest.i, newest.t.answer),
          attempt: newest.t.attempt,
          done: m.locks(team.id)[newest.i] !== null,
        });
      }
    }
    lastTries.current = allTries;
  }, [allTries, m, team]);

  // Its own timer: the model above is rebuilt every second, which would keep
  // cancelling one set in that effect and leave the toast up for good.
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), TOAST_MS);
    return () => window.clearTimeout(t);
  }, [toast]);

  if (!cur) return null;
  const q = cur.q;
  const question = m.questions[q];
  const tries = m.tries(team.id, q);
  const tried = new Set(tries.map((t) => t.answer));
  const tryNo = tries.length + 1;
  const max = maxTries(question);
  // My vote: the one I just cast, until the server's copy catches up — unless
  // the team has just tried it, which takes it off the table.
  const votes = cur.votes.map((v, i) => (i === 0 && pending?.q === q && !tried.has(pending.answer) ? pending.answer : v));
  const mine = votes[0];
  const agreed = votes.length > 0 && votes[0] && votes.every((v) => v === votes[0]) ? votes[0] : null;
  const names = team.members.map((s, i) => (i === 0 ? "You" : firstName(s.name)));
  const rule = m.state.lock_rule;
  const others = votes.slice(1).filter((v) => v && v !== mine).length;
  const holdout = mine && !agreed && others === votes.length - 1 && votes.length > 2;
  const text = (a: string) => (question.kind === "mc" ? question.options[a.charCodeAt(0) - 65] ?? a : m.label(q, a));
  const short = (a: string) => (a.length > 12 ? "your answer" : a);

  const vote = (answer: string) => {
    if (tried.has(answer)) return;
    setPending({ q, answer });
    voting.current = castVote(question.id, answer).catch((e) => {
      setPending(null);
      onError(forStudent(e, "Your vote didn’t go through. Try again."));
    });
  };
  const lock = async () => {
    setBusy(true);
    try {
      await voting.current;
      await lockTeamAnswer(question, mine);
      await onTried();
    } catch (e) {
      onError(forStudent(e, "Couldn’t submit it. Try again."));
    } finally {
      setBusy(false);
    }
  };

  const choices =
    question.kind === "mc"
      ? question.options.map((_, i) => optionLetter(i))
      : [...typedChoices(m, team, q, votes).filter((a) => !tried.has(a)), ...tries.map((t) => t.answer)];
  const submitLabel = rule === "any" ? "Submit" : "Lock in";

  return (
    <>
      <div className="lq-sscroll">
        <TeamPips m={m} team={team} current={q} />
        {toast ? (
          <div className={`lq-toast${toast.right === true ? " right" : toast.right === false ? " wrong" : ""}`} role="status">
            {toast.right === true ? <Tick size={13} /> : toast.right === false ? <Cross size={13} /> : <Ic name="lock" size={14} />}
            <span>
              Question {toast.q + 1}: <b>{short(toast.answer)}</b>
              {toast.right === true
                ? ` is right — ${worth(tryCredit(toast.attempt))}`
                : toast.right === false
                  ? toast.done
                    ? " isn’t it, and that was the last try"
                    : " isn’t it — try again"
                  : " is in"}
              {toast.by === "you" ? "" : ` · ${toast.by} submitted`}
            </span>
          </div>
        ) : null}
        <div className="lq-sqrow">
          <span className="fv-eyebrow lq-sq">
            {team.name} · Question {q + 1} of {m.questions.length}
          </span>
          <span className={`lq-worth${tries.length ? " retry" : ""}`}>
            {tries.length ? `Try ${tryNo}${question.kind === "mc" ? "" : ` of ${max}`} · ` : ""}
            {tries.length ? `worth ${worth(tryCredit(tryNo))}` : `Worth ${worth(tryCredit(1))}`}
          </span>
        </div>
        <p className="lq-sstem">{question.stem}</p>
        <Figure path={question.figure_path} alt={`Figure for question ${q + 1}`} className="lq-sfig" />

        {tries.length ? (
          <div className="lq-tried" role="status">
            <Cross size={13} />
            <span>
              {tries.length === 1 ? (
                <>
                  <b>{short(tries[0].answer)}</b> isn’t it.
                </>
              ) : (
                <>Not {tries.map((t) => short(t.answer)).join(", not ")}.</>
              )}{" "}
              {tryNo === max ? "Last try" : "Try again"}
              {tryCredit(tryNo) === 0 ? " — no points left, but find it before you move on." : "."}
            </span>
          </div>
        ) : null}

        <div className="lq-ownstrip" aria-label="How each of you answered on your own">
          <span className="lq-ownlabel">On your own</span>
          {team.members.map((s, i) => (
            <span key={s.id} className="lq-ownchip">
              <Av p={s} size={22} />
              <span className="lq-ownname">{names[i]}</span>
              <Pick value={m.own(s.id, q)} right={tried.has(m.own(s.id, q) ?? "") ? false : undefined} size="sm" />
            </span>
          ))}
        </div>

        <div className="lq-choices" role="radiogroup" aria-label="Team vote">
          {choices.map((a) => {
            const out = tried.has(a);
            const voters = out ? [] : team.members.filter((_, i) => votes[i] === a);
            const on = !out && mine === a;
            return (
              <button
                key={a}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={out}
                title={out ? "Your team tried this — it isn’t right" : undefined}
                className={`lq-choice team${on ? " on" : ""}${agreed === a ? " agreed" : ""}${out ? " out" : ""}`}
                onClick={() => vote(a)}
              >
                {question.kind === "mc" ? <span className="lq-choicel">{out ? <Cross size={12} /> : a}</span> : null}
                <span className="lq-choicet">{text(a)}</span>
                {out ? (
                  <span className="lq-outtag">Tried</span>
                ) : (
                  <span className="lq-voters">
                    {voters.map((s) => (
                      <span key={s.id} className="lq-voterpop">
                        <Av p={s} size={24} ring={s.id === team.members[0].id} />
                      </span>
                    ))}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {question.kind !== "mc" ? <Propose q={question} tried={tried} onPropose={vote} /> : null}
      </div>

      <footer className={`lq-sfoot team${agreed ? " agreed" : ""}`}>
        {agreed ? (
          <>
            <span className="lq-footmsg">
              <b>All on {question.kind === "mc" ? agreed : text(agreed)}</b>
            </span>
            <button type="button" className="fv-btn primary lq-teambtn" disabled={busy} onClick={() => void lock()}>
              <Ic name="lock" size={15} /> {submitLabel} {question.kind === "mc" ? agreed : ""}
            </button>
          </>
        ) : (
          <>
            <span className="lq-footmsg">
              <b>{voteSummary(votes, names)}</b>
              <span className="fv-sub">
                {!mine
                  ? tries.length
                    ? "Pick another"
                    : "Pick one"
                  : rule === "any"
                    ? "Submit counts for the team"
                    : holdout
                      ? "You’re the holdout"
                      : `Locks when all ${team.members.length} agree`}
              </span>
            </span>
            {rule === "any" && mine ? (
              <button type="button" className="fv-btn primary lq-teambtn" disabled={busy} onClick={() => void lock()}>
                <Ic name="lock" size={15} /> Submit {question.kind === "mc" ? mine : ""}
              </button>
            ) : null}
          </>
        )}
      </footer>
    </>
  );
}

/** Put a value on the table that nobody has proposed yet. */
function Propose({ q, tried, onPropose }: { q: LiveQuestion; tried: Set<string>; onPropose: (v: string) => void }) {
  const [text, setText] = useState("");
  const parsed = q.kind === "number" ? normalizeNumber(text) : canonicalAnswer("expression", text);
  const old = parsed !== null && tried.has(parsed);
  return (
    <form
      className="lq-propose"
      onSubmit={(e) => {
        e.preventDefault();
        if (!parsed || old) return;
        onPropose(parsed);
        setText("");
      }}
    >
      <input
        className="lq-numin"
        inputMode={q.kind === "number" ? "decimal" : "text"}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        value={text}
        placeholder="Propose another answer"
        aria-label="Propose another answer"
        onChange={(e) => setText(e.target.value)}
      />
      {q.unit ? <span className="lq-numunit">{q.unit}</span> : null}
      <button type="submit" className="fv-btn outline sm" disabled={!parsed || old} title={old ? "Your team has tried that one" : undefined}>
        {old ? "Tried" : "Propose"}
      </button>
    </form>
  );
}

export function TeamDone({ m, team, meId }: { m: LiveModel; team: TeamWithMembers; meId: string }) {
  const together = m.score(team.id);
  return (
    <div className="lq-sscroll">
      <TeamPips m={m} team={team} current={-1} />
      <div className="lq-scard">
        <h2 className="lq-h2">All done</h2>
        {together !== null ? (
          <p className="lq-donescore">
            <span className="fv-num">
              <b>{fmtPoints(together)}</b> of {m.questions.length}
            </span>{" "}
            together
          </p>
        ) : null}
        <p className="fv-sub" style={{ margin: "0 0 10px" }}>
          How you did on your own shows here when your instructor closes the session.
        </p>
        <div className="lq-reviewlist">
          {m.questions.map((q, i) => {
            const own = m.own(meId, i);
            const credit = m.credit(team.id, i);
            return (
              <div key={q.id} className="lq-reviewrow">
                <span className="lq-qn">Q{i + 1}</span>
                <span className="lq-qshort">{q.stem}</span>
                <span className="lq-youteam">
                  <span className="fv-sub">You</span>
                  <Pick value={own} right={own ? m.right(i, own) : undefined} size="sm" />
                  <Ic name="arrowRight" size={12} />
                  <span className="fv-sub">Team</span>
                  <Tries m={m} teamId={team.id} q={i} />
                  {credit !== null ? <span className="lq-credit fv-num">{fmtPoints(credit)}</span> : null}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
