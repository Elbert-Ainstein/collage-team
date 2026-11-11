"use client";

// In class, as a team: everyone sees how each of them answered on their own,
// votes, and the team submits one answer at a time. Each try turns green or
// red as it lands (0049); a red one is off the table and the team goes again,
// for less, as many times as it likes — or, once another try is worth
// nothing, moves on (0050). Votes and tries go through the RPCs and come back
// over realtime, so every phone on the team shows the same thing. Once the
// team has a leader (0051), everyone still votes, but only the leader submits
// and moves the team on; whoever the roll marked absent drops out of the count.
// Each phone goes where it likes (0057): Back, Next and the numbers along the
// top are always there, nobody waits for the leader to finish a question
// before looking at the next, and a vote on any open question counts.

import { useRef, useState } from "react";
import type { Student, TeamWithMembers } from "@/checkins/types";
import {
  canMoveOn,
  canonicalAnswer,
  maxTries,
  multiAnswer,
  multiIndexes,
  multiLabel,
  normalizeNumber,
  optionLetter,
  toggleOption,
  TRY_CREDIT,
  tryCredit,
} from "@/live/answers";
import { castVote, lockTeamAnswer, moveTeamOn } from "@/live/data";
import { Figure } from "@/live/figure";
import { fmtPoints, hasOptions, optionText, type LiveModel } from "@/live/model";
import { isKnownKind, type LiveQuestion } from "@/live/types";
import { Av, Ic, Pick, Tries, voteSummary } from "@/live/ui";
import { Explanation } from "./Explanation";
import { forStudent } from "./forStudent";
import { NeedsReload } from "./NeedsReload";
import { Checkbox, MultiHead } from "./OnYourOwn";

const MAX_TYPED_CHOICES = 8;

export const firstName = (name: string): string => name.split(/\s+/)[0] ?? name;

/** "1 point", "0.5 points", "no points". */
const worth = (n: number) => (n === 0 ? "no points" : n === 1 ? "1 point" : `${fmtPoints(n)} points`);

/** The rule, as it's said out loud: "1 point first try, then 0.5, then 0.25". */
const RULE = `${fmtPoints(TRY_CREDIT[0])} point first try, then ${TRY_CREDIT.slice(1).map(fmtPoints).join(", then ")}`;

/** How the team answers, as the intro says it: with a leader (0051), they submit. */
function howLine(rule: "any" | "all", n: number, leader: boolean): string {
  if (!leader) {
    return rule === "any"
      ? "See each other’s answers, agree, then one of you submits."
      : `See each other’s answers, then all ${n} pick the same one.`;
  }
  return rule === "any"
    ? "First, pick who submits for the team. Then see each other’s answers, agree, and they submit."
    : `First, pick who submits for the team. Then see each other’s answers; once all of you pick the same one, they lock it in.`;
}

export function TeamIntro({
  team,
  rule,
  leader = false,
  onStart,
}: {
  team: TeamWithMembers;
  rule: "any" | "all";
  /** The team picks a leader first (0051). */
  leader?: boolean;
  onStart: () => void;
}) {
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
        <p className="lq-introline">{howLine(rule, team.members.length, leader)}</p>
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

/** The numbers along the top: how each question went, and a tap goes to it. */
function TeamPips({ m, team, current, onPick }: { m: LiveModel; team: TeamWithMembers; current: number; onPick?: (q: number) => void }) {
  return (
    <div className="lq-spips">
      {m.locks(team.id).map((l, i) => {
        // The team was told as each try landed, so a finished question always shows how it went.
        const on = l ? m.rightOn(team.id, i) : null;
        const r = on === null ? null : on > 0;
        // A long answer doesn't fit the box: the number, in the colour.
        const short = l && l.answer.length <= 6;
        const className = `lq-spip team${l ? " filled" : ""}${i === current ? " now" : ""}${r === true ? " right" : r === false ? " wrong" : ""}`;
        const said = `Question ${i + 1}${l ? (r === true ? `, right on try ${on}` : r === false ? ", not got" : ", done") : ""}`;
        if (!onPick) {
          return (
            <span key={i} className={className}>
              <span aria-hidden="true">{short ? l.answer : i + 1}</span>
              <span className="lq-sr">{said}</span>
            </span>
          );
        }
        return (
          <button key={i} type="button" className={className} aria-label={said} aria-current={i === current} onClick={() => onPick(i)}>
            {short ? l.answer : i + 1}
          </button>
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

/** Who submits for the team, as the line above the question says it. */
function leadText(m: LiveModel, team: TeamWithMembers): string {
  const id = m.leaderOf(team.id);
  if (id === null) return "No leader yet";
  return id === team.members[0]?.id ? "You submit for the team" : `${byWhom(team, id)} submits for the team`;
}

/** The right answer in words, when this student may see the key; null otherwise. */
function keyText(m: LiveModel, q: number): string | null {
  const question = m.questions[q];
  const key = m.key(q);
  if (!question || !key) return null;
  if (question.kind === "mc") {
    return key.correct_option === null ? null : `${optionLetter(key.correct_option)} (${question.options[key.correct_option] ?? ""})`;
  }
  if (question.kind === "multi") {
    const set = multiAnswer(key.correct_options ?? []);
    return set === null ? null : `${m.label(q, set)} (${optionText(question, set) ?? ""})`;
  }
  if (question.kind === "number") return key.answer === null ? null : m.label(q, String(key.answer));
  return key.accept[0] ?? null;
}

/** Going to the leader page and the roll (0057): for everyone on the team, from any question. */
interface Pages {
  /** Open the roll — who's here. Not on a team of one. */
  onRoll?: () => void;
  /** Open the leader page — who submits, and Change leader. */
  onLeader?: () => void;
}

/**
 * Team mode on one phone. Where it is is its own: it starts on the question
 * the team is on, and then goes where its Back, Next and the numbers along
 * the top say (0057). A question the team is done with shows as it ended,
 * green or red; an open one takes votes, whichever one the team is "on"; past
 * the last is the overview, and before the first is the roll. A teammate's
 * try moves nobody else's screen.
 */
export function TeamPlay({
  m,
  team,
  meId,
  onError,
  onTried,
  onRoll,
  onLeader,
  cursor = null,
  onCursor,
}: Pages & {
  m: LiveModel;
  team: TeamWithMembers;
  meId: string;
  onError: (message: string) => void;
  onTried: () => Promise<void> | void;
  /** Where this phone was, kept by the caller so a trip to the roll or the leader page comes back to it; null to start where the team is. */
  cursor?: number | null;
  onCursor?: (q: number) => void;
}) {
  const N = m.questions.length;
  const [own, setOwn] = useState(() => m.current(team.id)?.q ?? N);
  const q = cursor ?? own;
  const go = (i: number) => {
    const at = Math.max(0, Math.min(N, i));
    setOwn(at);
    onCursor?.(at);
  };
  if (q >= N) {
    return <TeamDone m={m} team={team} meId={meId} onRoll={onRoll} onLeader={onLeader} onBack={N > 0 ? () => go(N - 1) : undefined} onPick={go} />;
  }
  return (
    <TeamQuestion
      key={q}
      m={m}
      team={team}
      q={q}
      onError={onError}
      onTried={onTried}
      onNext={() => go(q + 1)}
      hasNext={q + 1 < N}
      // Before the first question is the roll: Back opens it, where there is one.
      onBack={q > 0 ? () => go(q - 1) : onRoll}
      backLabel={q > 0 ? "Previous question" : "Who’s here"}
      onPick={go}
      onRoll={onRoll}
      onLeader={onLeader}
    />
  );
}

/** Back a question: on every team screen but the first question's. From the roll or the leader page, back to the questions. */
export function BackButton({ onBack, label = "Previous question" }: { onBack: () => void; label?: string }) {
  return (
    <button type="button" className="fv-btn outline lq-teambtn lq-backbtn" aria-label={label} onClick={onBack}>
      <Ic name="chevronLeft" size={15} />
      <span className="lq-backlabel">Back</span>
    </button>
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
  onBack,
  backLabel,
  onPick,
  onRoll,
  onLeader,
}: Pages & {
  m: LiveModel;
  team: TeamWithMembers;
  q: number;
  onError: (message: string) => void;
  /** A try went in: read the session now rather than wait for realtime, so the verdict shows at once. */
  onTried: () => Promise<void> | void;
  /** Move this phone on: always there, whether or not the team is done with this question (0057). */
  onNext?: () => void;
  /** A question is left after this one — what the Next button says. */
  hasNext?: boolean;
  /** Step back to the question before — or, from the first question, to the roll. */
  onBack?: () => void;
  /** What Back is, for a screen reader: where it goes. */
  backLabel?: string;
  /** Go straight to a question, from the numbers along the top. */
  onPick?: (q: number) => void;
}) {
  const [pending, setPending] = useState<string | null>(null);
  // Which button is waiting on the server, so only that one says so.
  const [busy, setBusy] = useState<"submit" | "move" | null>(null);
  // The vote on its way to the server, so a submit right after a tap sends the answer on screen.
  const voting = useRef<Promise<void> | null>(null);

  const question = m.questions[q];
  if (!question) return null;
  const lock = m.locks(team.id)[q];
  const done = lock !== null;
  const finished = m.locks(team.id).every((l) => l !== null);
  const tries = m.tries(team.id, q);
  const tried = new Set(tries.map((t) => t.answer));
  const last = tries[tries.length - 1];
  const tryNo = tries.length + 1;
  const max = maxTries(question);
  const movable = !done && canMoveOn(question, tries.length);
  // My vote: the one I just cast, until the server's copy catches up — unless
  // the team has just tried it, which takes it off the table.
  const votes = m.votes(team.id, q).map((v, i) => (i === 0 && pending !== null && !tried.has(pending) ? pending : v));
  // Whoever the roll marked absent (0051) is out of the count, as lock_team_answer has it.
  const away = new Set(m.absentIds(team.id));
  const seats = team.members
    .map((s, i) => ({ s, v: votes[i] ?? null, name: i === 0 ? "You" : firstName(s.name) }))
    .filter(({ s }) => !away.has(s.id));
  const hereVotes = seats.map((x) => x.v);
  const mine = done ? null : votes[0] ?? null;
  const agreed = !done && hereVotes.length > 0 && hereVotes[0] && hereVotes.every((v) => v === hereVotes[0]) ? hereVotes[0] : null;
  const rule = m.state.lock_rule;
  const others = hereVotes.slice(1).filter((v) => v && v !== mine).length;
  const holdout = mine && !agreed && others === hereVotes.length - 1 && hereVotes.length > 2;
  // Only the leader submits and moves the team on, once there is one (0051).
  const leads = m.mayLead(team.id, team.members[0]?.id ?? "");
  const leaderId = m.leaderOf(team.id);
  const leaderLine = `${leaderId ? byWhom(team, leaderId) : "Your leader"} submits for the team`;
  const text = (a: string) => optionText(question, a) ?? m.label(q, a);
  const short = (a: string) => (a.length > 12 ? "your answer" : question.kind === "mc" ? a : m.label(q, a));
  /** What the Submit button names: the letter(s), where there are any. */
  const named = (a: string) => (hasOptions(question) ? m.label(q, a) : "");
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
    setBusy("submit");
    try {
      await voting.current;
      await lockTeamAnswer(question, mine);
      await onTried();
    } catch (e) {
      onError(forStudent(e, "Couldn’t submit it. Try again."));
    } finally {
      setBusy(null);
    }
  };
  const moveOn = async () => {
    setBusy("move");
    try {
      await moveTeamOn(question.id);
      await onTried();
    } catch (e) {
      onError(forStudent(e, "Couldn’t move on. Try again."));
    } finally {
      setBusy(null);
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
      const title = tries.length >= max ? "Out of tries" : "Moved on";
      feedback = { tone: "wrong", title, sub: key ? `The answer is ${key} · no points` : "No points for this one" };
    }
  } else if (last && !mine) {
    const by = byWhom(team, last.locked_by);
    const next = tryCredit(tryNo);
    feedback = {
      tone: "wrong",
      title: "Not quite",
      sub: `${by === "You" ? "" : `${by} submitted `}${short(last.answer)} — ${next > 0 ? `pick another, worth ${worth(next)}` : question.kind === "mc" ? "no points left, but find it to move on" : "no points left: keep trying, or move on"}`,
    };
  }

  // Multiple choice: every option. Typed: what's on the table, then what's
  // been tried. Select multiple has boxes of its own (MultiVote), and lists
  // its tries under them.
  const choices =
    question.kind === "mc"
      ? question.options.map((_, i) => optionLetter(i))
      : question.kind === "multi"
        ? []
        : done
          ? tries.map((t) => t.answer)
          : [...typedChoices(m, team, q, votes).filter((a) => !tried.has(a)), ...tries.map((t) => t.answer)];
  const submitLabel = rule === "any" ? "Submit" : "Lock in";
  const moveOnButton = movable && leads ? (
    <button type="button" className="fv-btn outline lq-teambtn" disabled={busy !== null} onClick={() => void moveOn()}>
      {busy === "move" ? "Moving on…" : <>Move on <Ic name="arrowRight" size={15} /></>}
    </button>
  ) : null;
  // Always there (0057). Says more once the team is done with this one,
  // when moving on is the thing to do; otherwise it's the arrow beside Back.
  const nextName = hasNext ? "Next question" : finished ? "See how you did" : "Overview";
  const nextButton = onNext ? (
    done ? (
      <button type="button" className="fv-btn primary lq-teambtn" onClick={onNext}>
        {nextName} <Ic name="arrowRight" size={15} />
      </button>
    ) : (
      <button type="button" className="fv-btn outline lq-teambtn lq-nextbtn" aria-label={nextName} onClick={onNext}>
        <span className="lq-nextlabel">Next</span>
        <Ic name="chevronRight" size={15} />
      </button>
    )
  ) : null;

  return (
    <>
      <div className="lq-sscroll">
        <TeamPips m={m} team={team} current={q} onPick={onPick} />
        <div className="lq-sqrow">
          <span className="fv-eyebrow lq-sq">
            {team.name} · Question {q + 1} of {m.questions.length}
          </span>
          {done ? null : (
            <span className={`lq-worth${tries.length ? " retry" : ""}`}>
              {tries.length ? `Try ${tryNo} · worth ` : "Worth "}
              {worth(tryCredit(tryNo))}
            </span>
          )}
        </div>
        {m.leaders ? <LeadLine lead={leadText(m, team)} here={seats.length} of={team.members.length} onLeader={onLeader} onRoll={onRoll} /> : null}
        <p className="lq-sstem">{question.stem}</p>
        <Figure path={question.figure_path} alt={`Figure for question ${q + 1}`} className="lq-sfig" />

        <div className="lq-ownstrip" role="group" aria-label="How each of you answered on your own">
          <span className="lq-ownlabel">On your own</span>
          {seats.map(({ s, name }) => {
            const own = m.own(s.id, q);
            return (
              <span key={s.id} className="lq-ownchip">
                <Av p={s} size={22} />
                <span className="lq-ownname">{name}</span>
                <Pick value={own} right={own && tried.has(own) ? verdictOf(own) : undefined} size="sm" />
              </span>
            );
          })}
        </div>

        {!isKnownKind(question.kind) ? (
          <NeedsReload />
        ) : question.kind === "multi" ? (
          done ? (
            <MultiDone q={question} answer={lock.answer} right={on === null ? null : on > 0} keySet={m.key(q)?.correct_options ?? null} />
          ) : (
            // Keyed on the tries: a try that lands clears every box, as it clears every vote.
            <MultiVote key={tries.length} q={question} mine={mine} tried={tried} seats={seats} meId={team.members[0]?.id ?? ""} onVote={vote} />
          )
        ) : (
          <div className="lq-choices" role="radiogroup" aria-label="Team vote">
            {choices.map((a) => {
              // A tried answer is green or red by the verdict the team was given, and can't be picked again.
              const v = verdictOf(a);
              const voters = v !== null || done ? [] : team.members.filter((s, i) => votes[i] === a && !away.has(s.id));
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
        )}
        {question.kind === "multi" && tries.length ? (
          <>
            <span className="lq-triedlabel">Tried</span>
            <div className="lq-choices lq-tried" role="list" aria-label="Combinations your team has tried">
              {tries.map((t) => {
                const v = verdictOf(t.answer);
                return (
                  <div key={t.attempt} role="listitem" className={`lq-choice static multi${v === true ? " right" : v === false ? " wrong" : ""}`}>
                    <span className="lq-choicel multi">{t.answer}</span>
                    <span className="lq-choicet">{text(t.answer)}</span>
                    {v === null ? null : <span className="lq-sr">, {v ? "right" : "not right"}</span>}
                  </div>
                );
              })}
            </div>
          </>
        ) : null}
        {question.kind !== "mc" && question.kind !== "multi" && isKnownKind(question.kind) && !done ? <Propose q={question} tried={tried} onPropose={vote} /> : null}
        {done ? <Explanation body={m.explanation(q)} /> : null}
      </div>

      {/* Always there, so a screen reader hears the verdict the moment it changes. */}
      <span className="lq-sr" role="status">
        {feedback ? `${feedback.title}. ${feedback.sub}` : ""}
      </span>
      <footer className={`lq-sfoot team${feedback ? ` fb ${feedback.tone}` : agreed ? " agreed" : ""}`}>
        {onBack ? <BackButton onBack={onBack} label={backLabel} /> : null}
        {feedback ? (
          <>
            <span className="lq-footmsg lq-fb">
              <b>{feedback.title}</b>
              <span>{feedback.sub}</span>
            </span>
            <span className="lq-footbtns">
              {moveOnButton}
              {nextButton}
            </span>
          </>
        ) : agreed ? (
          <>
            <span className="lq-footmsg">
              <b>All on {hasOptions(question) ? m.label(q, agreed) : text(agreed)}</b>
              {leads ? null : <span className="fv-sub">{leaderLine}</span>}
            </span>
            <span className="lq-footbtns">
              {leads ? (
                <>
                  {moveOnButton}
                  <button type="button" className="fv-btn primary lq-teambtn" disabled={busy !== null} onClick={() => void submit()}>
                    <Ic name="lock" size={15} /> {busy === "submit" ? "Submitting…" : `${submitLabel} ${named(agreed)}`}
                  </button>
                </>
              ) : null}
              {nextButton}
            </span>
          </>
        ) : (
          <>
            <span className="lq-footmsg">
              {/* A set of letters is read out as "A, C", the way the Submit button names it. */}
              <b>{voteSummary(hereVotes.map((v) => (v !== null && question.kind === "multi" ? m.label(q, v) : v)), seats.map((x) => x.name))}</b>
              <span className="fv-sub">
                {!mine
                  ? question.kind === "multi"
                    ? "Tick all that apply"
                    : "Pick one"
                  : rule === "any"
                    ? leads
                      ? "Submit counts for the team"
                      : leaderLine
                    : holdout
                      ? "You’re the holdout"
                      : `Locks when all ${seats.length} agree`}
              </span>
            </span>
            <span className="lq-footbtns">
              {moveOnButton}
              {rule === "any" && mine && leads ? (
                <button type="button" className="fv-btn primary lq-teambtn" disabled={busy !== null} onClick={() => void submit()}>
                  <Ic name="lock" size={15} /> {busy === "submit" ? "Submitting…" : `Submit ${named(mine)}`}
                </button>
              ) : null}
              {nextButton}
            </span>
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
        inputMode="text"
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

/**
 * Select multiple in team mode (0056, 0057): the same boxes as before class.
 * Each tick makes a set, and the set is this phone's vote — "AC" — cast as
 * the boxes change, the way a tap on a multiple-choice option is. Beside each
 * option, who on the team has it ticked. A set the team has already tried
 * can't be voted: the boxes show it, the line under them says so, and the
 * vote before it stands until the boxes make a new set. So does unticking
 * the last box: an answer is at least one option.
 */
function MultiVote({
  q,
  mine,
  tried,
  seats,
  meId,
  onVote,
}: {
  q: LiveQuestion;
  mine: string | null;
  tried: Set<string>;
  seats: { s: Student; v: string | null }[];
  meId: string;
  onVote: (v: string) => void;
}) {
  // The boxes follow my vote, until a tap makes a set that can't be one.
  const [shownInstead, setShownInstead] = useState<string | null | undefined>(undefined);
  const shown = shownInstead === undefined ? mine : shownInstead;
  const on = new Set(shown ? multiIndexes(shown) : []);
  const old = shown !== null && tried.has(shown);
  const toggle = (i: number) => {
    const next = toggleOption(shown, i);
    if (next && !tried.has(next)) {
      setShownInstead(undefined);
      onVote(next);
    } else {
      setShownInstead(next);
    }
  };
  return (
    <div className="lq-numentry">
      <MultiHead count={on.size} />
      <div className="lq-choices" role="group" aria-label="Team vote, select all that apply">
        {q.options.map((text, i) => {
          const voters = seats.filter(({ v }) => v !== null && multiIndexes(v).includes(i));
          return (
            <button
              key={i}
              type="button"
              role="checkbox"
              aria-checked={on.has(i)}
              className={`lq-choice team multi${on.has(i) ? " on" : ""}`}
              onClick={() => toggle(i)}
            >
              <span className="lq-choicel">{optionLetter(i)}</span>
              <span className="lq-choicet">{text}</span>
              <span className="lq-voters">
                {voters.map(({ s }) => (
                  <span key={s.id} className="lq-voterpop">
                    <Av p={s} size={24} ring={s.id === meId} />
                  </span>
                ))}
              </span>
              <Checkbox on={on.has(i)} />
            </button>
          );
        })}
      </div>
      {/* Always there, so a screen reader hears it the moment the boxes make a tried set. */}
      <span className="lq-numhint bad" role="status">
        {old && shown ? `Your team already tried ${multiLabel(shown)} — change one` : ""}
      </span>
    </div>
  );
}

/**
 * Select multiple once the team is done with it: the boxes as the team left
 * them. Green when the set was right; red where it wasn't, with the right
 * options named when this student may see the key.
 */
function MultiDone({ q, answer, right, keySet }: { q: LiveQuestion; answer: string; right: boolean | null; keySet: number[] | null }) {
  const ticked = new Set(multiIndexes(answer));
  const key = new Set(right === false ? keySet ?? [] : []);
  return (
    <div className="lq-numentry">
      <MultiHead count={ticked.size} />
      <div className="lq-choices multi" role="list" aria-label="Your team's answer">
        {q.options.map((text, i) => {
          const isTicked = ticked.has(i);
          const tone = key.has(i) ? " right" : isTicked ? (right === true ? " right" : right === false ? " wrong" : "") : "";
          return (
            <div key={i} role="listitem" className={`lq-choice static multi${tone}`}>
              <span className="lq-choicel">{optionLetter(i)}</span>
              <span className="lq-choicet">{text}</span>
              {isTicked ? <span className="lq-choicetag">Team</span> : key.has(i) ? <span className="lq-choicetag">Answer</span> : null}
              {key.has(i) ? <span className="lq-sr">, the right answer</span> : null}
              <Checkbox on={isTicked} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** The line above the question: who submits (a tap opens the leader page), and who's here (a tap opens the roll). */
function LeadLine({ lead, here, of, onLeader, onRoll }: Pages & { lead: string; here: number; of: number }) {
  return (
    <div className="lq-leadline">
      {onLeader ? (
        <button type="button" className="fv-btn ghost sm lq-leadbtn" onClick={onLeader}>
          {lead} <Ic name="chevronRight" size={13} />
        </button>
      ) : (
        <span>{lead}</span>
      )}
      {onRoll ? (
        <button type="button" className="fv-btn ghost sm" onClick={onRoll}>
          Who’s here · {here}/{of}
        </button>
      ) : null}
    </div>
  );
}

interface TeamDoneProps extends Pages {
  m: LiveModel;
  team: TeamWithMembers;
  meId: string;
  /** Step back to the last question. */
  onBack?: () => void;
  /** Go to a question, from its row or the numbers along the top. */
  onPick?: (q: number) => void;
}

/**
 * Past the last question: every question in a list, with how the team did on
 * each — and, once the team has submitted them all, what it scored. Before
 * that it's an overview this phone stepped to (0057), and a row opens its question.
 */
export function TeamDone({ m, team, meId, onRoll, onLeader, onBack, onPick }: TeamDoneProps) {
  const N = m.questions.length;
  const finished = N > 0 && m.locks(team.id).every((l) => l !== null);
  const together = finished ? m.score(team.id) : null;
  const away = new Set(m.absentIds(team.id));
  const here = team.members.filter((s) => !away.has(s.id)).length;
  return (
    <>
      <div className="lq-sscroll">
        <TeamPips m={m} team={team} current={-1} onPick={onPick} />
        {m.leaders ? <LeadLine lead={leadText(m, team)} here={here} of={team.members.length} onLeader={onLeader} onRoll={onRoll} /> : null}
        <div className="lq-scard lq-intro lq-donecard wide">
          <span className={`lq-introicon${finished ? " lq-doneicon" : ""}`}>
            <Ic name={finished ? "check" : "groups"} size={26} />
          </span>
          <h2 className="lq-h2">{finished ? "Your team has submitted" : `${m.done(team.id)} of ${N} done`}</h2>
          {together !== null ? (
            <p className="lq-donescore">
              <span className="fv-num">
                <b>{fmtPoints(together)}</b> of {N}
              </span>{" "}
              together
            </p>
          ) : null}
          <p className="fv-sub">
            {finished ? "How you did on your own shows here when your instructor closes the session." : "Tap a question to go to it."}
          </p>
        </div>
        <div className="lq-scard">
          <div className="lq-reviewlist">
            {m.questions.map((q, i) => {
              const own = m.own(meId, i);
              const credit = m.credit(team.id, i);
              const inside = (
                <>
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
                </>
              );
              return onPick ? (
                <button key={q.id} type="button" className="lq-reviewrow" onClick={() => onPick(i)}>
                  {inside}
                </button>
              ) : (
                <div key={q.id} className="lq-reviewrow">
                  {inside}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {onBack ? (
        <footer className="lq-sfoot team">
          <BackButton onBack={onBack} />
        </footer>
      ) : null}
    </>
  );
}
