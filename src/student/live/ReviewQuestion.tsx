"use client";

// One question of the results, laid out the way it was answered: the numbers
// along the top (green where they had it, red where they didn't), the
// question, every choice — the right one in green, theirs in red if it
// wasn't — and why, under it. Back and Next as before class.

import { useEffect, useRef } from "react";
import type { TeamWithMembers } from "@/checkins/types";
import { optionLetter } from "@/live/answers";
import { Figure } from "@/live/figure";
import { fmtPoints, type LiveModel } from "@/live/model";
import { Ic, Tries } from "@/live/ui";
import { Explanation } from "./Explanation";

interface Props {
  m: LiveModel;
  team: TeamWithMembers | null;
  meId: string;
  q: number;
  onGo: (q: number) => void;
  /** Back to the summary. */
  onDone: () => void;
}

/** The answer as the key writes it, for a typed question. */
function keyText(m: LiveModel, q: number): string | null {
  const question = m.questions[q];
  const key = m.key(q);
  if (!question || !key) return null;
  if (question.kind === "number") return key.answer === null ? null : m.label(q, String(key.answer));
  if (question.kind === "expression") return key.accept[0] ?? null;
  return null;
}

/** Each question's number, coloured by how they did on it. */
function ResultPips({ m, meId, current, onPick }: { m: LiveModel; meId: string; current: number; onPick: (q: number) => void }) {
  return (
    <div className="lq-spips">
      {m.questions.map((q, i) => {
        const mine = m.own(meId, i);
        const right = mine ? m.right(i, mine) : false;
        return (
          <button
            key={q.id}
            type="button"
            className={`lq-spip ${right ? "right" : "wrong"}${i === current ? " now" : ""}`}
            onClick={() => onPick(i)}
            aria-label={`Question ${i + 1}, ${right ? "right" : "not right"}`}
            aria-current={i === current}
          >
            {i + 1}
          </button>
        );
      })}
    </div>
  );
}

function Choices({ m, q, mine }: { m: LiveModel; q: number; mine: string | null }) {
  const question = m.questions[q];
  const correct = m.key(q)?.correct_option ?? null;
  return (
    <div className="lq-choices" role="list" aria-label={`Question ${q + 1} choices`}>
      {question.options.map((text, i) => {
        const l = optionLetter(i);
        const isRight = i === correct;
        const isMine = mine === l;
        const tone = isRight ? " right" : isMine ? " wrong" : "";
        return (
          <div key={l} role="listitem" className={`lq-choice static${tone}`}>
            <span className="lq-choicel">{l}</span>
            <span className="lq-choicet">{text}</span>
            {/* Said, not just coloured: this is where they learn which is which. Theirs and right is "You" in green. */}
            {isMine ? <span className="lq-choicetag">You</span> : isRight ? <span className="lq-choicetag">Answer</span> : null}
            {isRight ? <span className="lq-sr">, the right answer</span> : null}
          </div>
        );
      })}
    </div>
  );
}

function Typed({ m, q, mine, right }: { m: LiveModel; q: number; mine: string | null; right: boolean }) {
  const answer = keyText(m, q);
  // Shown when they missed it, and when theirs counted but was written
  // another way (9.81 for 9.8, F*0.5 for F/2): the answer as written is worth seeing.
  const showAnswer = answer !== null && (!right || mine === null || m.label(q, mine) !== answer);
  return (
    <div className="lq-choices" role="list" aria-label={`Question ${q + 1} answers`}>
      {mine ? (
        <div role="listitem" className={`lq-choice static ${right ? "right" : "wrong"}`}>
          <span className="lq-choicek">You</span>
          <span className="lq-choicet">{m.label(q, mine)}</span>
        </div>
      ) : null}
      {showAnswer ? (
        <div role="listitem" className="lq-choice static right">
          <span className="lq-choicek">Answer</span>
          <span className="lq-choicet">{answer}</span>
        </div>
      ) : null}
    </div>
  );
}

export function ReviewQuestion({ m, team, meId, q, onGo, onDone }: Props) {
  const N = m.questions.length;
  const question = m.questions[q];
  const mine = m.own(meId, q);
  const right = mine ? m.right(q, mine) === true : false;
  const credit = team ? m.credit(team.id, q) : null;
  const last = q === N - 1;
  // Where the whole page scrolls (a phone), Next would land mid-way down the
  // next question, where the last explanation ended. Optional-called: jsdom
  // has no scrollIntoView.
  const top = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    top.current?.scrollIntoView?.({ block: "nearest" });
  }, [q]);
  return (
    <>
      {/* Keyed on the question: Next starts at its top, not where the last one was scrolled to. */}
      <div className="lq-sscroll" key={question.id}>
        <div ref={top}>
          <ResultPips m={m} meId={meId} current={q} onPick={onGo} />
        </div>
        <div className="fv-eyebrow lq-sq">
          Question {q + 1} of {N}
        </div>
        <p className="lq-sstem">{question.stem}</p>
        <Figure path={question.figure_path} alt={`Figure for question ${q + 1}`} className="lq-sfig" />
        {question.kind === "mc" ? <Choices m={m} q={q} mine={mine} /> : <Typed m={m} q={q} mine={mine} right={right} />}
        {mine ? null : <p className="lq-snone">You didn’t answer this one</p>}
        {team ? (
          <div className="lq-srespicks lq-steamline">
            <span>
              {team.name} <Tries m={m} teamId={team.id} q={q} />
              {credit !== null ? <span className="lq-credit fv-num">{fmtPoints(credit)}</span> : null}
            </span>
          </div>
        ) : null}
        <Explanation body={m.explanation(q)} />
      </div>
      <footer className="lq-sfoot">
        <button type="button" className="fv-btn outline" onClick={q === 0 ? onDone : () => onGo(q - 1)}>
          <Ic name="chevronLeft" size={15} /> Back
        </button>
        <button type="button" className="fv-btn primary" onClick={last ? onDone : () => onGo(q + 1)}>
          {last ? "Done" : "Next"}
          {last ? null : <Ic name="chevronRight" size={15} />}
        </button>
      </footer>
    </>
  );
}
