"use client";

// In class, as a team: everyone sees how each of them answered on their own,
// votes, and the team submits one answer at a time. Each try turns green or
// red as it lands (0049); a red one is off the table and the team goes again,
// for less. Votes and tries go through the RPCs and come back over realtime,
// so every phone on the team shows the same thing.

import { useRef, useState } from "react";
import type { TeamWithMembers } from "@/checkins/types";
import { canonicalAnswer, maxTries, normalizeNumber, optionLetter, TRY_CREDIT, tryCredit } from "@/live/answers";
import { castVote, lockTeamAnswer } from "@/live/data";
import { Figure } from "@/live/figure";
import { fmtPoints, type LiveModel } from "@/live/model";
import type { LiveQuestion } from "@/live/types";
import { Av, Ic, Pick, Tries, voteSummary } from "@/live/ui";
import { forStudent } from "./forStudent";

const MAX_TYPED_CHOICES = 8;

const firstName = (name: string) => name.split(/\s+/)[0] ?? name;

/** "1 point", "0.5 points", "no points". */
const worth = (n: number) => (n === 0 ? "no points" : n === 1 ? "1 point" : `${fmtPoints(n)} points`);

/** The rule, as it's said out loud: "1 point first try, then 0.5, then 0.25". */
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
        // A long answer doesn't fit the box: the number, in the colour.
        const short = l && l.answer.length <= 6;
        return (
          <span
            key={i}
            className={`lq-spip team${l ? " filled" : ""}${i === current ? " now" : ""}${r === true ? " right" : r === false ? " wrong" : ""}`}
          >
            <span aria-hidden="true">{short ? l.answer : i + 1}</span>
            <span className="lq-sr">
              Question {i + 1}
              {l ? (r === true ? `, right on try ${on}` : r === false ? ", not got" : ", done") : ""}
            </span>
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

/** Who on the team a try came from, as the bar says it. */
function byWhom(team: TeamWithMembers, id: string | null): string {
  const who = team.members.find((s) => s.id === id);
  return !who ? "Your team" : who.id === team.members[0].id ? "You" : firstName(who.name);
}

/** The right answer in words, when this student may see the key; null otherwise. */
function keyText(m: LiveModel, q: number): string | null {
  const question = m.questions[q];
  const key = m.key(q);
  if (!question || !key) return null;
  if (question.kind === "mc") {
    return key.correct_option === null ? null : `${optionLetter(key.correct_option)} (${question.options[key.correct_option] ?? ""})`;
  }
  if (question.kind === "number") return key.answer === null ? null : m.label(q, String(key.answer));
  return key.accept[0] ?? null;
}

/**
 * Team mode on one phone. The question the team is on; then, once the team
 * has it or is out of tries, that question held in its answered state with a
 * Next button, the way Khan Academy does it; then the summary once every
 * question is done. The hold is this phone's own: a teammate pressing Next
 * moves nobody else's screen.
 */
export function TeamPlay({
  m,
  team,
  meId,
  onError,
  onTried,
}: {
  m: LiveModel;
  team: TeamWithMembers;
  meId: string;
  onError: (message: string) => void;
  onTried: () => Promise<void> | void;
}) {
  const now = m.current(team.id)?.q ?? null;
  const [seen, setSeen] = useState(now);
  const [held, setHeld] = useState<number | null>(null);
  // Decided while rendering, so the next question never flashes up before
  // the answered one. Already holding one: keep it; the rest show in the boxes.
  if (now !== seen) {
    setSeen(now);
    if (seen !== null && held === null && m.locks(team.id)[seen]) setHeld(seen);
  }
  const q = held ?? now;
  if (q === null) return <TeamDone m={m} team={team} meId={meId} />;
  return (
    <TeamQuestion
      key={q}
      m={m}
      team={team}
      q={q}
      onError={onError}
      onTried={onTried}
      onNext={held === null ? undefined : () => setHeld(null)}
      hasNext={now !== null}
    />
  );
}

type Feedback = { tone: "right" | "wrong" | "done"; title: string; sub: string };

export function TeamQuestion({
  m,
  team,
  q,
  onError,
  onTried,
  onNext,
  hasNext = true,
}: {
  m: LiveModel;
  team: TeamWithMembers;
  q: number;
  onError: (message: string) => void;
  /** A try went in: read the session now rather than wait for realtime, so the verdict shows at once. */
  onTried: () => Promise<void> | void;
  /** The team is done with this question and it's held on screen: move this phone on. */
  onNext?: () => void;
  /** A question is left after this one — what the Next button says. */
  hasNext?: boolean;
}) {
  const [pending, setPending] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The vote on its way to the server, so a submit right after a tap sends the answer on screen.
  const voting = useRef<Promise<void> | null>(null);

  const question = m.questions[q];
  if (!question) return null;
  const lock = m.locks(team.id)[q];
  const done = lock !== null;
  const tries = m.tries(team.id, q);
  const tried = new Set(tries.map((t) => t.answer));
  const last = tries[tries.length - 1];
  const tryNo = tries.length + 1;
  const max = maxTries(question);
  const cur = m.current(team.id);
  const live = !done && cur?.q === q ? cur : null;
  // My vote: the one I just cast, until the server's copy catches up — unless
  // the team has just tried it, which takes it off the table.
  const votes = (live?.votes ?? team.members.map(() => null)).map((v, i) =>
    i === 0 && pending !== null && !tried.has(pending) ? pending : v,
  );
  const mine = done ? null : votes[0];
  const agreed = !done && votes.length > 0 && votes[0] && votes.every((v) => v === votes[0]) ? votes[0] : null;
  const names = team.members.map((s, i) => (i === 0 ? "You" : firstName(s.name)));
  const rule = m.state.lock_rule;
  const others = votes.slice(1).filter((v) => v && v !== mine).length;
  const holdout = mine && !agreed && others === votes.length - 1 && votes.length > 2;
  const text = (a: string) => (question.kind === "mc" ? question.options[a.charCodeAt(0) - 65] ?? a : m.label(q, a));
  const short = (a: string) => (a.length > 12 ? "your answer" : question.kind === "number" ? m.label(q, a) : a);
  const verdictOf = (a: string): boolean | null => {
    const t = tries.find((x) => x.answer === a);
    return t ? (t.correct ?? m.right(q, a)) : null;
  };

  const vote = (answer: string) => {
    if (done || tried.has(answer)) return;
    setPending(answer);
    voting.current = castVote(question.id, answer).catch((e) => {
      setPending(null);
      onError(forStudent(e, "Your vote didn’t go through. Try again."));
    });
  };
  const submit = async () => {
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

  // What the bar at the bottom says about the last try, Khan Academy style:
  // green and Next when it's got, red when it isn't.
  const on = m.rightOn(team.id, q);
  let feedback: Feedback | null = null;
  if (done) {
    const by = byWhom(team, lock.locked_by);
    if (on === null) {
      feedback = { tone: "done", title: "Locked in", sub: `${by} submitted ${short(lock.answer)}` };
    } else if (on > 0) {
      const c = tryCredit(on);
      feedback = {
        tone: "right",
        title: "Correct!",
        sub: `${by} submitted ${short(lock.answer)} · ${c > 0 ? `+${worth(c)}` : "no points this time, but now you know it"}`,
      };
    } else {
      const key = keyText(m, q);
      feedback = { tone: "wrong", title: "Out of tries", sub: key ? `The answer is ${key} · no points` : "No points for this one" };
    }
  } else if (last && !mine) {
    const by = byWhom(team, last.locked_by);
    const next = tryCredit(tryNo);
    feedback = {
      tone: "wrong",
      title: "Not quite",
      sub: `${by === "You" ? "" : `${by} submitted `}${short(last.answer)} — ${next > 0 ? `pick another, worth ${worth(next)}` : "no points left, but find it to move on"}`,
    };
  }

  const choices =
    question.kind === "mc"
      ? question.options.map((_, i) => optionLetter(i))
      : done
        ? tries.map((t) => t.answer)
        : [...typedChoices(m, team, q, votes).filter((a) => !tried.has(a)), ...tries.map((t) => t.answer)];
  const submitLabel = rule === "any" ? "Submit" : "Lock in";

  return (
    <>
      <div className="lq-sscroll">
        <TeamPips m={m} team={team} current={q} />
        <div className="lq-sqrow">
          <span className="fv-eyebrow lq-sq">
            {team.name} · Question {q + 1} of {m.questions.length}
          </span>
          {done ? null : (
            <span className={`lq-worth${tries.length ? " retry" : ""}`}>
              {tries.length ? `Try ${tryNo}${question.kind === "mc" ? "" : ` of ${max}`} · worth ` : "Worth "}
              {worth(tryCredit(tryNo))}
            </span>
          )}
        </div>
        <p className="lq-sstem">{question.stem}</p>
        <Figure path={question.figure_path} alt={`Figure for question ${q + 1}`} className="lq-sfig" />

        <div className="lq-ownstrip" role="group" aria-label="How each of you answered on your own">
          <span className="lq-ownlabel">On your own</span>
          {team.members.map((s, i) => {
            const own = m.own(s.id, q);
            return (
              <span key={s.id} className="lq-ownchip">
                <Av p={s} size={22} />
                <span className="lq-ownname">{names[i]}</span>
                <Pick value={own} right={own && tried.has(own) ? verdictOf(own) : undefined} size="sm" />
              </span>
            );
          })}
        </div>

        <div className="lq-choices" role="radiogroup" aria-label="Team vote">
          {choices.map((a) => {
            // A tried answer is green or red by the verdict the team was given, and can't be picked again.
            const v = verdictOf(a);
            const voters = v !== null || done ? [] : team.members.filter((_, i) => votes[i] === a);
            const isMine = mine === a;
            return (
              <button
                key={a}
                type="button"
                role="radio"
                aria-checked={isMine}
                aria-label={v === null ? undefined : `${text(a)}, ${v ? "right" : "not right"}`}
                disabled={done || v !== null}
                className={`lq-choice team${isMine ? " on" : ""}${agreed === a ? " agreed" : ""}${v === true ? " right" : v === false ? " wrong" : ""}`}
                onClick={() => vote(a)}
              >
                {question.kind === "mc" ? <span className="lq-choicel">{a}</span> : null}
                <span className="lq-choicet">{text(a)}</span>
                <span className="lq-voters">
                  {voters.map((s) => (
                    <span key={s.id} className="lq-voterpop">
                      <Av p={s} size={24} ring={s.id === team.members[0].id} />
                    </span>
                  ))}
                </span>
              </button>
            );
          })}
        </div>
        {question.kind !== "mc" && !done ? <Propose q={question} tried={tried} onPropose={vote} /> : null}
      </div>

      {/* Always there, so a screen reader hears the verdict the moment it changes. */}
      <span className="lq-sr" role="status">
        {feedback ? `${feedback.title}. ${feedback.sub}` : ""}
      </span>
      <footer className={`lq-sfoot team${feedback ? ` fb ${feedback.tone}` : agreed ? " agreed" : ""}`}>
        {feedback ? (
          <>
            <span className="lq-footmsg lq-fb">
              <b>{feedback.title}</b>
              <span>{feedback.sub}</span>
            </span>
            {done && onNext ? (
              <button type="button" className="fv-btn primary lq-teambtn" onClick={onNext}>
                {hasNext ? "Next question" : "See how you did"} <Ic name="arrowRight" size={15} />
              </button>
            ) : null}
          </>
        ) : agreed ? (
          <>
            <span className="lq-footmsg">
              <b>All on {question.kind === "mc" ? agreed : text(agreed)}</b>
            </span>
            <button type="button" className="fv-btn primary lq-teambtn" disabled={busy} onClick={() => void submit()}>
              <Ic name="lock" size={15} /> {busy ? "Submitting…" : `${submitLabel} ${question.kind === "mc" ? agreed : ""}`}
            </button>
          </>
        ) : (
          <>
            <span className="lq-footmsg">
              <b>{voteSummary(votes, names)}</b>
              <span className="fv-sub">
                {!mine
                  ? "Pick one"
                  : rule === "any"
                    ? "Submit counts for the team"
                    : holdout
                      ? "You’re the holdout"
                      : `Locks when all ${team.members.length} agree`}
              </span>
            </span>
            {rule === "any" && mine ? (
              <button type="button" className="fv-btn primary lq-teambtn" disabled={busy} onClick={() => void submit()}>
                <Ic name="lock" size={15} /> {busy ? "Submitting…" : `Submit ${question.kind === "mc" ? mine : ""}`}
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
        name="proposal"
        autoComplete="off"
        inputMode={q.kind === "number" ? "decimal" : "text"}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        value={text}
        placeholder="Propose another answer…"
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
