"use client";

// In class, as a team: everyone sees how each of them answered on their own,
// votes, and the team locks one answer per question. Votes and locks go
// through 0047's RPCs and come back over realtime, so every phone on the team
// shows the same thing.

import { useEffect, useRef, useState } from "react";
import type { TeamWithMembers } from "@/checkins/types";
import { canonicalAnswer, normalizeNumber, optionLetter } from "@/live/answers";
import { castVote, lockTeamAnswer } from "@/live/data";
import { Figure } from "@/live/figure";
import type { LiveModel } from "@/live/model";
import type { LiveQuestion } from "@/live/types";
import { Av, Ic, Pick, voteSummary } from "@/live/ui";
import { forStudent } from "./forStudent";

const MAX_TYPED_CHOICES = 8;
const TOAST_MS = 3200;

const firstName = (name: string) => name.split(/\s+/)[0] ?? name;

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
        <button type="button" className="fv-btn primary lq-teambtn" onClick={onStart}>
          Start <Ic name="arrowRight" size={16} />
        </button>
      </div>
    </div>
  );
}

function TeamPips({ m, team, current }: { m: LiveModel; team: TeamWithMembers; current: number }) {
  const reveal = m.state.show_answers === "lock";
  return (
    <div className="lq-spips">
      {m.locks(team.id).map((l, i) => {
        const r = l && reveal ? m.right(i, l.answer) : null;
        return (
          <span
            key={i}
            className={`lq-spip team${l ? " filled" : ""}${i === current ? " now" : ""}${r === true ? " right" : r === false ? " wrong" : ""}`}
            aria-label={`Question ${i + 1}${l ? `, locked as ${l.answer}` : ""}`}
          >
            {l ? (l.answer.length > 6 ? "✓" : l.answer) : i + 1}
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

export function TeamQuestion({ m, team, onError }: { m: LiveModel; team: TeamWithMembers; onError: (message: string) => void }) {
  const cur = m.current(team.id);
  const [pending, setPending] = useState<{ q: number; answer: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ q: number; answer: string; by: string } | null>(null);
  const lastDone = useRef(m.done(team.id));

  // A lock from anyone on the team: say so for a moment, then move on.
  const done = m.done(team.id);
  useEffect(() => {
    if (done > lastDone.current) {
      const locks = m.locks(team.id);
      const newest = locks
        .map((l, i) => (l ? { l, i } : null))
        .filter((x): x is NonNullable<typeof x> => x !== null)
        .sort((a, b) => Date.parse(b.l.locked_at) - Date.parse(a.l.locked_at))[0];
      if (newest) {
        const who = team.members.find((s) => s.id === newest.l.locked_by);
        setToast({ q: newest.i, answer: newest.l.answer, by: !who ? "your team" : who.id === team.members[0].id ? "you" : firstName(who.name) });
      }
    }
    lastDone.current = done;
  }, [done, m, team]);

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
  // My vote: the one I just cast, until the server's copy catches up.
  const votes = cur.votes.map((v, i) => (i === 0 && pending?.q === q ? pending.answer : v));
  const mine = votes[0];
  const agreed = votes.length > 0 && votes[0] && votes.every((v) => v === votes[0]) ? votes[0] : null;
  const names = team.members.map((s, i) => (i === 0 ? "You" : firstName(s.name)));
  const rule = m.state.lock_rule;
  const others = votes.slice(1).filter((v) => v && v !== mine).length;
  const holdout = mine && !agreed && others === votes.length - 1 && votes.length > 2;
  const text = (a: string) => (question.kind === "mc" ? question.options[a.charCodeAt(0) - 65] ?? a : m.label(q, a));

  const vote = async (answer: string) => {
    setPending({ q, answer });
    try {
      await castVote(question.id, answer);
    } catch (e) {
      setPending(null);
      onError(forStudent(e, "Your vote didn’t go through. Try again."));
    }
  };
  const lock = async () => {
    setBusy(true);
    try {
      await lockTeamAnswer(question.id);
    } catch (e) {
      onError(forStudent(e, "Couldn’t lock it. Try again."));
    } finally {
      setBusy(false);
    }
  };

  const choices = question.kind === "mc" ? question.options.map((_, i) => optionLetter(i)) : typedChoices(m, team, q, votes);

  return (
    <>
      <div className="lq-sscroll">
        <TeamPips m={m} team={team} current={q} />
        {toast ? (
          <div className="lq-toast" role="status">
            <Ic name="lock" size={14} /> Question {toast.q + 1} locked as <b>{toast.answer.length > 12 ? "your answer" : toast.answer}</b> by {toast.by}
          </div>
        ) : null}
        <div className="fv-eyebrow lq-sq">
          {team.name} · Question {q + 1} of {m.questions.length}
        </div>
        <p className="lq-sstem">{question.stem}</p>
        <Figure path={question.figure_path} alt={`Figure for question ${q + 1}`} className="lq-sfig" />

        <div className="lq-ownstrip" aria-label="How each of you answered on your own">
          <span className="lq-ownlabel">On your own</span>
          {team.members.map((s, i) => (
            <span key={s.id} className="lq-ownchip">
              <Av p={s} size={22} />
              <span className="lq-ownname">{names[i]}</span>
              <Pick value={m.own(s.id, q)} size="sm" />
            </span>
          ))}
        </div>

        <div className="lq-choices" role="radiogroup" aria-label="Team vote">
          {choices.map((a) => {
            const voters = team.members.filter((_, i) => votes[i] === a);
            const on = mine === a;
            return (
              <button
                key={a}
                type="button"
                role="radio"
                aria-checked={on}
                className={`lq-choice team${on ? " on" : ""}${agreed === a ? " agreed" : ""}`}
                onClick={() => void vote(a)}
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
        {question.kind !== "mc" ? <Propose q={question} onPropose={(v) => void vote(v)} /> : null}
      </div>

      <footer className={`lq-sfoot team${agreed ? " agreed" : ""}`}>
        {agreed ? (
          <>
            <span className="lq-footmsg">
              <b>All on {question.kind === "mc" ? agreed : text(agreed)}</b>
            </span>
            <button type="button" className="fv-btn primary lq-teambtn" disabled={busy} onClick={() => void lock()}>
              <Ic name="lock" size={15} /> {rule === "any" ? "Submit" : "Lock in"} {question.kind === "mc" ? agreed : ""}
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
function Propose({ q, onPropose }: { q: LiveQuestion; onPropose: (v: string) => void }) {
  const [text, setText] = useState("");
  const parsed = q.kind === "number" ? normalizeNumber(text) : canonicalAnswer("expression", text);
  return (
    <form
      className="lq-propose"
      onSubmit={(e) => {
        e.preventDefault();
        if (!parsed) return;
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
      <button type="submit" className="fv-btn outline sm" disabled={!parsed}>
        Propose
      </button>
    </form>
  );
}

export function TeamDone({ m, team, meId }: { m: LiveModel; team: TeamWithMembers; meId: string }) {
  const reveal = m.state.show_answers === "lock";
  return (
    <div className="lq-sscroll">
      <TeamPips m={m} team={team} current={-1} />
      <div className="lq-scard">
        <h2 className="lq-h2">All locked</h2>
        <p className="fv-sub" style={{ margin: "0 0 10px" }}>
          Results show here when your instructor closes the session.
        </p>
        <div className="lq-reviewlist">
          {m.questions.map((q, i) => {
            const l = m.locks(team.id)[i];
            const own = m.own(meId, i);
            return (
              <div key={q.id} className="lq-reviewrow">
                <span className="lq-qn">Q{i + 1}</span>
                <span className="lq-qshort">{q.stem}</span>
                <span className="lq-youteam">
                  <span className="fv-sub">You</span>
                  <Pick value={own} right={reveal && own ? m.right(i, own) : undefined} size="sm" />
                  <Ic name="arrowRight" size={12} />
                  <span className="fv-sub">Team</span>
                  <Pick value={l?.answer ?? null} right={reveal && l ? m.right(i, l.answer) : undefined} size="sm" />
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
